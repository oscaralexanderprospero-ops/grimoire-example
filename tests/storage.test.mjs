import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createStore, etagOf } from '../preview/storage.mjs';
import { Model, tempDir, richState, sampleState } from './helpers.mjs';

async function withStore(fn) {
  const t = await tempDir();
  try { await fn(createStore(t.dir), t.dir); } finally { await t.cleanup(); }
}
const backups = async (dir) => (await fs.readdir(join(dir, 'backups'))).sort();

test('empty folder loads as "no grimoire yet"', () => withStore(async (store) => {
  const r = await store.load();
  assert.equal(r.state, null);
  assert.equal(r.etag, null);
}));

test('saved state survives a restart (new store instance on the same folder)', () => withStore(async (store, dir) => {
  const s = richState();
  const w = await store.save(s, null, 'seed');
  assert.ok(w.ok);
  const again = createStore(dir);
  const r = await again.load();
  assert.deepEqual(r.state, s);
  assert.equal(r.etag, w.etag);
  assert.equal(r.etag, etagOf(s));
  const onDisk = JSON.parse(await fs.readFile(join(dir, 'grimoire.json'), 'utf8'));
  assert.equal(onDisk.format, Model.FORMAT);
  assert.equal(onDisk.schemaVersion, Model.SCHEMA_VERSION);
}));

test('a save based on an old version is refused and the refused copy is kept', () => withStore(async (store, dir) => {
  const a = await store.save(sampleState(), null, 'seed');
  const b = richState();
  assert.ok((await store.save(b, a.etag, 'edit')).ok);
  const stale = sampleState(); stale.writer = 'Kimi';
  const c = await store.save(stale, a.etag, 'edit');            // based on a, but file is now b
  assert.ok(c.conflict);
  assert.deepEqual(c.state, b, 'conflict returns the current saved version');
  assert.match(c.backup, /conflict-unsaved\.json$/);
  const kept = await store.readBackup(c.backup);
  assert.equal(kept.state.writer, 'Kimi', 'refused version is recoverable');
  assert.deepEqual((await store.load()).state, b, 'file unchanged');
  assert.ok((await backups(dir)).some((n) => n.endsWith('conflict-unsaved.json')));
}));

test('an outside edit to the data file (e.g. Claude editing it) is detected as a conflict', () => withStore(async (store, dir) => {
  const a = await store.save(sampleState(), null, 'seed');
  const file = join(dir, 'grimoire.json');
  const obj = JSON.parse(await fs.readFile(file, 'utf8'));
  obj.state.entries[0].versions[0].summary = 'Edited outside the app';
  await fs.writeFile(file, JSON.stringify(obj));
  const r = await store.save(sampleState(), a.etag, 'edit');
  assert.ok(r.conflict);
  assert.equal(r.state.entries[0].versions[0].summary, 'Edited outside the app');
}));

test('conflict-overwrite keeps the other version in backups first', () => withStore(async (store, dir) => {
  await store.save(sampleState(), null, 'seed');
  const mine = richState();
  const r = await store.save(mine, 'stale-etag', 'conflict-overwrite');
  assert.ok(r.ok);
  assert.ok((await backups(dir)).some((n) => n.endsWith('-conflict-overwrite.json')));
  assert.deepEqual((await store.load()).state, mine);
}));

test('invalid state is refused and the file is untouched', () => withStore(async (store, dir) => {
  const a = await store.save(sampleState(), null, 'seed');
  const before = await fs.readFile(join(dir, 'grimoire.json'), 'utf8');
  const r = await store.save({ entries: [{ id: 'x', versions: [] }], journal: [] }, a.etag, 'edit');
  assert.ok(r.invalid && r.invalid.length);
  assert.equal(await fs.readFile(join(dir, 'grimoire.json'), 'utf8'), before);
}));

test('import makes a backup first; restore brings it back and backs up what it replaces', () => withStore(async (store) => {
  const a = await store.save(sampleState(), null, 'seed');
  const imported = richState();
  const b = await store.save(imported, a.etag, 'import');
  assert.ok(b.ok);
  const list = await store.listBackups();
  const pre = list.find((x) => x.reason === 'import');
  assert.ok(pre, 'pre-import backup exists');
  assert.equal(pre.summary.entries, 8);
  const r = await store.restore(pre.name);
  assert.ok(r.ok);
  assert.deepEqual((await store.load()).state, sampleState());
  const after = await store.listBackups();
  const beforeRestore = after.find((x) => x.reason === 'before-restore');
  assert.equal(beforeRestore.summary.entries, 9, 'the imported version was kept before restoring');
}));

test('a corrupt data file is never overwritten by a normal save; restore still works', () => withStore(async (store, dir) => {
  const a = await store.save(sampleState(), null, 'seed');
  await store.save(richState(), a.etag, 'import');                    // creates a backup to restore from
  const file = join(dir, 'grimoire.json');
  await fs.writeFile(file, '{ this is not json');
  const l = await store.load();
  assert.ok(l.corrupt);
  const s = await store.save(sampleState(), null, 'edit');
  assert.ok(s.blocked);
  assert.equal(await fs.readFile(file, 'utf8'), '{ this is not json');
  const name = (await store.listBackups()).find((x) => x.reason === 'import').name;
  assert.ok((await store.restore(name)).ok);
  assert.deepEqual((await store.load()).state, sampleState());
  const kept = (await store.listBackups()).find((x) => x.reason === 'before-restore');
  assert.equal(await fs.readFile(join(dir, 'backups', kept.name), 'utf8'), '{ this is not json', 'corrupt file kept as found');
}));

test('saves leave no temporary files behind', () => withStore(async (store, dir) => {
  let e = (await store.save(sampleState(), null, 'seed')).etag;
  for (let i = 0; i < 5; i++) { const s = sampleState(); s.seq = i + 2; e = (await store.save(s, e, 'edit')).etag; }
  const names = await fs.readdir(dir);
  assert.deepEqual(names.filter((n) => n.includes('.tmp')), []);
}));

test('concurrent saves are serialized: exactly one of two racing writers wins', () => withStore(async (store) => {
  const a = await store.save(sampleState(), null, 'seed');
  const x = sampleState(); x.writer = 'Zephyr';
  const y = sampleState(); y.writer = 'Claude';
  const [rx, ry] = await Promise.all([store.save(x, a.etag, 'edit'), store.save(y, a.etag, 'edit')]);
  assert.equal([rx, ry].filter((r) => r.ok).length, 1);
  assert.equal([rx, ry].filter((r) => r.conflict).length, 1);
}));

test('an older-format file is migrated with a backup on first save', () => withStore(async (store, dir) => {
  const legacy = await fs.readFile(new URL('./fixtures/legacy-preview-export-2026-10-13.json', import.meta.url), 'utf8');
  await fs.writeFile(join(dir, 'grimoire.json'), legacy);
  const l = await store.load();
  assert.equal(l.schemaVersion, 0);
  assert.equal(l.state.entries.length, 9);
  const r = await store.save(l.state, l.etag, 'edit');
  assert.ok(r.ok);
  assert.ok((await backups(dir)).some((n) => n.endsWith('-migrate.json')));
  const onDisk = JSON.parse(await fs.readFile(join(dir, 'grimoire.json'), 'utf8'));
  assert.equal(onDisk.schemaVersion, Model.SCHEMA_VERSION);
}));

test('backup names cannot be used to read other files', () => withStore(async (store) => {
  assert.ok((await store.readBackup('../grimoire.json')).error);
  assert.ok((await store.readBackup('..\\..\\x.json')).error);
}));
