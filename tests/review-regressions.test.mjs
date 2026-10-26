// Regressions for the independent code review of 22 Oct (findings 2, 5, 6, 7, 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, utimes, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createStore } from '../preview/storage.mjs';
import { Model, tempDir, richState, sampleState } from './helpers.mjs';

const EVIL = 'x"><img src=x onerror=alert(1)>';

test('#2 ids and other values that reach links/attributes must be plain', () => {
  const cases = {
    'entry id': (s) => { s.entries[0].id = EVIL; },
    'category': (s) => { s.entries[0].category = EVIL; },
    'kind': (s) => { s.entries[0].type = EVIL; },
    'suggestion id': (s) => { s.entries.find((e) => e.id === 'example-1').pending[0].pid = EVIL; },
    'observation id': (s) => { s.journal[0].id = EVIL; },
    'observation entry': (s) => { s.journal[0].entryId = EVIL; },
    'relation target': (s) => { s.entries[0].relations = [{ rel: 'related to', target: EVIL, certainty: 'known' }]; },
    'correspondence id': (s) => { s.correspondences = [{ id: EVIL, item: 'a', association: 'b', certainty: 'personal' }]; },
    'template kind': (s) => { s.templates = [{ id: 't1', name: 'n', type: EVIL, category: 'practices', blocks: [] }]; },
    'draft key': (s) => { s.drafts[EVIL] = s.drafts['example-3']; },
    'undo entry': (s) => { s.undo.push({ type: 'revision', entryId: EVIL, beforeV: 1 }); }
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const s = richState(); mutate(s);
    assert.equal(Model.migrate(s).state, null, name);
  }
  assert.deepEqual(Model.migrate(richState()).errors, [], 'normal ids still fine');
});

test('#6 files that validate can be shown: absent fields are filled, wrong types refused', () => {
  const r = Model.migrate({ entries: [{ id: 'a', versions: [{ v: 1, title: 't', blocks: [] }] }], journal: [] });
  assert.deepEqual(r.errors, []);
  const v = r.state.entries[0].versions[0];
  assert.deepEqual([v.summary, v.date, v.editorial, v.experimental], ['', '', 'Draft', false]);
  for (const mutate of [(s) => { s.entries[0].versions[0].date = 5; }, (s) => { s.journal[0].meaning = 5; }, (s) => { s.journal[0].date = {}; }]) {
    const s = richState(); mutate(s);
    assert.equal(Model.migrate(s).state, null);
  }
  const md = Model.toMarkdown(r.state, 'today');   // must not throw
  assert.match(md, /### t/);
});

test('#5 merge treats any difference (e.g. a new relation) as differing, and reports differing observations', () => {
  const mine = richState();
  const theirs = JSON.parse(JSON.stringify(mine));
  theirs.entries.find((e) => e.id === 'example-1').relations = [{ rel: 'used in', target: 'example-8', certainty: 'likely' }];
  theirs.journal[0].followUps = [{ date: 'd', by: 'b', text: 'new' }];
  const plan = Model.mergePlan(mine, theirs);
  assert.deepEqual(plan.differing.map((e) => e.id), ['example-1']);
  assert.deepEqual(plan.differingObs.map((o) => o.id), ['o-1']);
  // key order and the local "touched" marker don't count as differences
  const reordered = JSON.parse(JSON.stringify(mine));
  reordered.entries = reordered.entries.map((e) => Object.fromEntries(Object.entries(e).reverse()));
  reordered.entries[0].touched = 123;
  assert.equal(Model.mergePlan(mine, reordered).differing.length, 0);
});

test('#7 a save waits for another process holding the lock; a stale lock is cleared', async () => {
  const t = await tempDir();
  try {
    const s = createStore(t.dir);
    const a = await s.save(sampleState(), null, 'seed');
    const lock = join(t.dir, 'grimoire.lock');
    await writeFile(lock, '99999');                       // "another process" is saving
    const started = Date.now();
    setTimeout(() => writeFile(lock, '').then(() => import('node:fs/promises')).then((m) => m.rm(lock)), 150);
    const r = await s.save(richState(), a.etag, 'edit');
    assert.ok(r.ok);
    assert.ok(Date.now() - started >= 120, 'waited for the lock');
    await writeFile(lock, '99999');
    const old = new Date(Date.now() - 60000); await utimes(lock, old, old);   // left behind by a crash
    const r2 = await s.save(sampleState(), r.etag, 'edit');
    assert.ok(r2.ok, 'stale lock removed');
    await assert.rejects(stat(lock), 'lock released after saving');
  } finally { await t.cleanup(); }
});

test('#8 server code is not served under any capitalisation; pages carry a strict CSP', async () => {
  const t = await tempDir(); const P = 20000 + Math.floor(Math.random() * 20000);
  const p = await new Promise((ok, fail) => {
    const c = spawn(process.execPath, [fileURLToPath(new URL('../preview/serve.mjs', import.meta.url)), '--port', String(P), '--data', t.dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const timer = setTimeout(() => fail(new Error(out)), 8000);
    c.stdout.on('data', (d) => { out += d; if (out.includes('Data folder')) { clearTimeout(timer); ok(c); } });
  });
  const get = (path) => new Promise((ok, fail) => { const r = http.request({ host: '127.0.0.1', port: P, path, headers: { Host: `127.0.0.1:${P}` } }, (res) => { res.resume(); res.on('end', () => ok(res)); }); r.on('error', fail); r.end(); });
  try {
    for (const f of ['/Serve.mjs', '/STORAGE.mjs', '/Phone.mjs', '/serve.mjs']) assert.equal((await get(f)).statusCode, 404, f);
    const page = await get('/');
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  } finally { p.kill(); await t.cleanup(); }
});

test('tags (versioned with the entry) and retiring (kept, never deleted) round-trip; malformed ones refused', () => {
  const s = richState();
  const collar = s.entries.find((e) => e.id === 'example-1');
  collar.versions[collar.versions.length - 1].tags = ['oak', 'protection'];
  collar.retired = true;
  const r = Model.parseImport(JSON.stringify(Model.envelope(s)));
  assert.deepEqual(r.errors, []);
  const c2 = r.state.entries.find((e) => e.id === 'example-1');
  assert.deepEqual(c2.versions[c2.versions.length - 1].tags, ['oak', 'protection']);
  assert.equal(c2.retired, true);
  assert.equal(c2.versions.length, collar.versions.length, 'retiring keeps every version');
  assert.match(Model.toMarkdown(r.state, 'd'), /Tags: oak, protection/);
  for (const mutate of [(e) => { e.versions[0].tags = 'oak'; }, (e) => { e.versions[0].tags = ['']; }, (e) => { e.versions[0].tags = ['x'.repeat(41)]; }, (e) => { e.retired = 'yes'; }]) {
    const t = richState(); mutate(t.entries.find((e) => e.id === 'example-1'));
    assert.equal(Model.migrate(t).state, null);
  }
});
