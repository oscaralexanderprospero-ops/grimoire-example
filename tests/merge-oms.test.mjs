import test from 'node:test';

import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';

import { spawnSync } from 'node:child_process';

import { fileURLToPath } from 'node:url';

import { Model, richState, tempDir } from './helpers.mjs';

import { convertEntries, htmlToText } from '../tools/convert-oms-lattice.mjs';



const FIX = new URL('./fixtures/oms-lattice/', import.meta.url);

const fixtures = () => readdirSync(FIX).filter((n) => /^LA-\d+\.json$/.test(n)).map((n) => JSON.parse(readFileSync(new URL(n, FIX), 'utf8')));



test('merge adds only what is new, skips identical, never changes differing entries', () => {

  const mine = richState();

  const theirs = JSON.parse(JSON.stringify(mine));

  theirs.entries.find((e) => e.id === 'example-1').versions[0].title = 'Changed elsewhere';

  theirs.entries.push({ id: 'new-1', type: 'article', category: 'lattice', sources: [], sourceNote: '', related: [], pending: [], versions: [{ v: 1, title: 'New', summary: '', editorial: 'Draft', experimental: false, blocks: [] }] });

  theirs.journal.push({ id: 'o-new', entryId: 'new-1', v: 1, date: '', by: 'Z', happened: 'x', meaning: '', next: '' });

  theirs.journal.push({ id: 'o-diff', entryId: 'example-1', v: 1, date: '', by: 'Z', happened: 'y', meaning: '', next: '' });

  theirs.correspondences = [{ id: 'c-new', item: 'Ash', association: 'connection', tradition: 'Norse', source: 's', certainty: 'sourced' }];

  const plan = Model.mergePlan(mine, theirs);

  assert.deepEqual(plan.addEntries.map((e) => e.id), ['new-1']);

  assert.deepEqual(plan.differing.map((e) => e.id), ['example-1']);

  assert.equal(plan.sameEntries.length, mine.entries.length - 1);

  const res = Model.applyMerge(mine, plan, { copies: false });

  assert.deepEqual(Model.validate(res.state).errors, []);

  assert.equal(res.state.entries.find((e) => e.id === 'example-1').versions[0].title, 'Example exercise 1', 'existing entry untouched');

  assert.ok(res.state.journal.some((o) => o.id === 'o-new'));

  assert.ok(!res.state.journal.some((o) => o.id === 'o-diff'), 'an observation on a differing entry is not attached to different text');

  assert.equal(res.skippedObs.length, 1);

  assert.equal(res.state.correspondences.length, 1);

  const res2 = Model.applyMerge(mine, plan, { copies: true });

  const copy = res2.state.entries.find((e) => e.id === 'example-1-imported');

  assert.ok(copy && /\(imported copy\)$/.test(copy.versions[0].title));

  assert.equal(res2.state.journal.find((o) => o.id === 'o-diff').entryId, 'example-1-imported');

  assert.deepEqual(Model.validate(res2.state).errors, []);

  const again = Model.mergePlan(res.state, theirs);

  assert.equal(again.addEntries.length + again.addObs.length + again.addCorr.length, 0, 'merging the same file twice adds nothing more');

});



test('OMS converter keeps every revision with its author, labels status, and decides nothing', () => {

  const st = convertEntries(fixtures());

  assert.deepEqual(Model.validate(st).errors, []);

  const tree = st.entries.find((e) => e.id === 'oms-la-9001');

  assert.equal(tree.versions.length, 2);

  assert.deepEqual(tree.versions.map((v) => v.editor), ['Test author', 'Second author']);

  assert.match(tree.versions[1].note, /OMS revision 2 \(edit\): second/);

  assert.ok(tree.versions.every((v) => v.editorial === 'Draft'));

  assert.ok(tree.versions.every((v) => v.blocks.every((b) => b.kind !== 'decision')), 'nothing is relabelled as a decision');

  assert.match(tree.sources[0].label, /status "proposed"/);

  assert.equal(tree.sources[1].ref, 'test#LA-9001');

  assert.deepEqual(tree.related, ['oms-la-9002']);

  assert.deepEqual(tree.relations, [{ rel: 'related to', target: 'oms-la-9002', certainty: 'known', note: 'n', by: 'OMS Lattice wiki' }]);

  const body = tree.versions[1].blocks[0].text;

  assert.match(body, /Quoted text & more, see \[\[Test Vine\|the vine\]\]\./);

  assert.match(body, /- one\n- two/);

  assert.match(tree.versions[1].blocks.find((b) => b.heading === 'Relations').text, /related to: \[\[Test Vine\]\] \(known\) — n/);

  const vine = st.entries.find((e) => e.id === 'oms-la-9002');

  const gap = vine.versions[1].blocks.find((b) => b.kind === 'gap');

  assert.match(gap.text, /whether it pumps \(open\)/);

  assert.match(gap.text, /“It pumps\.” — Doc A/);

  assert.match(gap.text, /“It does not\.” — Doc B/);

  assert.equal(htmlToText('<p>a &lt;b&gt; &#8212; c</p>', () => null), 'a <b> — c');

  assert.equal(Model.mergePlan(st, convertEntries(fixtures())).addEntries.length, 0, 'stable ids: converting again adds nothing');

});



test('OMS converter CLI: dry run by default, and refuses to write inside the source folder', async () => {

  const tool = fileURLToPath(new URL('../tools/convert-oms-lattice.mjs', import.meta.url));

  const from = fileURLToPath(FIX);

  const dry = spawnSync(process.execPath, [tool, '--from', from], { encoding: 'utf8' });

  assert.equal(dry.status, 0, dry.stderr);

  assert.match(dry.stdout, /Dry run only/);

  assert.match(dry.stdout, /2 Draft entries with 4 versions/);

  const inside = spawnSync(process.execPath, [tool, '--from', from, '--out', from + 'out.json'], { encoding: 'utf8' });

  assert.equal(inside.status, 2);

  const t = await tempDir();

  try {

    const out = t.dir + '/oms.json';

    const ok = spawnSync(process.execPath, [tool, '--from', from, '--out', out], { encoding: 'utf8' });

    assert.equal(ok.status, 0, ok.stderr);

    const r = Model.parseImport(readFileSync(out, 'utf8'));

    assert.deepEqual(r.errors, []);

    assert.equal(r.state.entries.length, 2);

  } finally { await t.cleanup(); }

  assert.deepEqual(readdirSync(FIX).sort(), ['.lock', 'LA-9001.json', 'LA-9002.json'], 'source folder unchanged');

});

