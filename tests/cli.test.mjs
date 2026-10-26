// O4: an assistant can work with the grimoire locally, but only through reviewable, attributed suggestions.

import test from 'node:test';

import assert from 'node:assert/strict';

import { writeFile, readdir } from 'node:fs/promises';

import { join } from 'node:path';

import { createStore } from '../preview/storage.mjs';

import { run } from '../tools/grimoire.mjs';

import { tempDir, richState } from './helpers.mjs';



async function setup() {

  const t = await tempDir();

  const store = createStore(t.dir);

  await store.save(richState(), null, 'seed');

  const lines = [];

  const cli = (...args) => run(args.concat(['--data', t.dir]), (l) => lines.push(l));

  return { t, store, lines, cli };

}



test('CLI reads: list, show (any version), search', async () => {

  const { t, lines, cli } = await setup();

  try {

    await cli('list', '--category', 'technomancy');

    assert.match(lines.join('\n'), /example-1\tExample exercise 1/);

    lines.length = 0; await cli('show', 'example-1', '--version', '2');

    assert.match(lines[0], /version 2 of 3/);

    assert.match(lines[0], /Added line\./);

    lines.length = 0; await cli('show', 'sigil-1');

    assert.match(lines[0], /earlier form: unknown \(not recorded\)/);

    lines.length = 0; await cli('search', 'held', 'it');

    assert.match(lines.join('\n'), /journal\to-1/);

    await assert.rejects(cli('show', 'nope'), /No entry with id/);

  } finally { await t.cleanup(); }

});



test('CLI suggest: attributed, pending, accepted text untouched, backed up first', async () => {

  const { t, store, cli } = await setup();

  try {

    const before = (await store.load()).state.entries.find((e) => e.id === 'example-1');

    await writeFile(join(t.dir, 'note.md'), 'Consider a cork-lined collar for grip.');

    await cli('suggest', 'example-1', '--by', 'Claude (AI)', '--heading', 'Grip idea', '--text-file', join(t.dir, 'note.md'));

    const after = (await store.load()).state.entries.find((e) => e.id === 'example-1');

    assert.deepEqual(after.versions, before.versions, 'no version added or changed');

    const p = after.pending[after.pending.length - 1];

    assert.equal(p.status, 'open');

    assert.equal(p.by, 'Claude (AI)');

    const last = p.content.blocks[p.content.blocks.length - 1];

    assert.deepEqual([last.kind, last.by, last.heading, last.text], ['proposal', 'Claude (AI)', 'Grip idea', 'Consider a cork-lined collar for grip.']);

    assert.ok((await readdir(join(t.dir, 'backups'))).length >= 1, 'a backup exists before the write');

    await assert.rejects(cli('suggest', 'example-1', '--text', 'x'), /Missing --by/);

  } finally { await t.cleanup(); }

});



test('CLI propose-correspondence is marked as a proposal, never as adopted', async () => {

  const { t, store, cli } = await setup();

  try {

    await cli('propose-correspondence', '--item', 'Rowan', '--association', 'protection', '--tradition', 'Folk', '--source', 'TEST', '--by', 'Kimi (AI)');

    const c = (await store.load()).state.correspondences.find((x) => x.item === 'Rowan');

    assert.equal(c.certainty, 'proposed');

    assert.equal(c.addedBy, 'Kimi (AI)');

  } finally { await t.cleanup(); }

});


test('readable Markdown copy: current versions, rationale with explicit unknowns, correspondences, journal follow-ups', async () => {
  const { t, store, cli } = await setup();
  try {
    const st = (await store.load()).state;
    st.correspondences = [{ id: 'c1', item: 'Oak', association: 'endurance', tradition: 'Folk', source: '', certainty: 'personal', note: '', addedBy: 'Author', date: '2026-10-22', history: [] }];
    st.journal[0].followUps = [{ date: '2026-10-22', by: 'Author', text: 'Calmer second time.' }];
    await store.save(st, (await store.load()).etag, 'edit');
    const out = join(t.dir, 'readable.md');
    await cli('export-markdown', '--out', out);
    const md = (await import('node:fs')).readFileSync(out, 'utf8');
    assert.match(md, /### Example exercise 1/);
    assert.match(md, /version 3 · last edited by Author/);
    assert.match(md, /earlier form: unknown \(not recorded\)/);
    assert.match(md, /\*\*Oak\*\* — endurance · Folk · Personal association · no source recorded/);
    assert.match(md, /Follow-up 2026-10-22 \(Author\): Calmer second time\./);
    assert.doesNotMatch(md, /Unsaved summary edit/, 'unsaved drafts are not presented as entry text');
  } finally { await t.cleanup(); }
});
