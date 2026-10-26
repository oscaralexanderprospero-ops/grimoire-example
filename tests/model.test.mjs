import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Model, sampleState, richState } from './helpers.mjs';

test('shipped sample content is valid', () => {
  const r = Model.validate(sampleState());
  assert.deepEqual(r.errors, []);
});

test('full export → import round trip keeps history, suggestions, journal links, drafts and undo', () => {
  const s = richState();
  const file = JSON.stringify(Model.envelope(s, { exportedAt: '2026-10-22T00:00:00Z' }));
  const r = Model.parseImport(file);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.state, s);
  const collar = r.state.entries.find((e) => e.id === 'example-1');
  assert.deepEqual(collar.versions.map((v) => v.v), [1, 2, 3]);
  assert.equal(collar.pending.find((p) => p.pid === 's-1').status, 'declined');
  const obs = r.state.journal.find((o) => o.id === 'o-1');
  assert.ok(collar.versions.some((v) => v.v === obs.v), 'observation still points at an existing version');
  assert.equal(r.state.drafts['example-3'].summary, 'Unsaved summary edit');
  assert.equal(r.state.undo.length, 2);
  assert.deepEqual(Model.summarize(r.state), { entries: 9, versions: 11, observations: 1, drafts: 1, suggestions: 2, correspondences: 0, undoSteps: 2 });
});

test('legacy preview export (13 Oct, entries + journal only) imports', () => {
  const text = readFileSync(new URL('./fixtures/legacy-preview-export-2026-10-13.json', import.meta.url), 'utf8');
  const r = Model.parseImport(text);
  assert.deepEqual(r.errors, []);
  assert.equal(r.from, 'legacy preview export');
  assert.equal(r.state.entries.length, 9);
  assert.equal(r.state.journal.length, 1);
  assert.deepEqual(r.state.drafts, {});
  assert.deepEqual(r.state.undo, []);
  assert.equal(r.state.entries.find((e) => e.id === 'example-1').versions.length, 3);
  assert.equal(r.state.exportedAt, undefined, 'export metadata is not mixed into the state');
});

test('malformed imports are refused with reasons and never throw', () => {
  const cases = {
    'not json': '{oops',
    'array': '[]',
    'other format': JSON.stringify({ format: 'something-else', state: {} }),
    'newer schema': JSON.stringify({ format: Model.FORMAT, schemaVersion: Model.SCHEMA_VERSION + 1, state: { entries: [], journal: [] } }),
    'no entries': JSON.stringify({ hello: 1 }),
    'entry without versions': JSON.stringify({ entries: [{ id: 'a', versions: [] }], journal: [] }),
    'duplicate ids': JSON.stringify({ entries: [{ id: 'a', versions: [{ v: 1, title: 't', blocks: [] }] }, { id: 'a', versions: [{ v: 1, title: 't', blocks: [] }] }], journal: [] }),
    'versions out of order': JSON.stringify({ entries: [{ id: 'a', versions: [{ v: 2, title: 't', blocks: [] }, { v: 1, title: 't', blocks: [] }] }], journal: [] }),
    'bad block': JSON.stringify({ entries: [{ id: 'a', versions: [{ v: 1, title: 't', blocks: [{ kind: 'note' }] }] }], journal: [] }),
    'bad mark status': JSON.stringify({ entries: [{ id: 'a', versions: [{ v: 1, title: 't', blocks: [], sigil: { marks: [{ d: 'M0 0', status: 'canon', meaning: '' }] } }] }], journal: [] })
  };
  for (const [name, text] of Object.entries(cases)) {
    const r = Model.parseImport(text);
    assert.equal(r.state, null, name);
    assert.ok(r.errors.length > 0, name);
  }
});

test('dangling journal links are reported as warnings, not silently dropped', () => {
  const s = richState();
  s.journal.push({ id: 'o-x', entryId: 'gone', v: 1, date: '', by: '', happened: 'x', meaning: '', next: '' });
  s.journal.push({ id: 'o-y', entryId: 'example-1', v: 99, date: '', by: '', happened: 'x', meaning: '', next: '' });
  const r = Model.migrate(s);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 2);
  assert.equal(r.state.journal.length, 3);
});

test('normalize fills defaults without removing content', () => {
  const n = Model.normalize({ entries: [{ id: 'a', versions: [{ v: 1, title: 't', blocks: [] }] }], journal: [] });
  assert.deepEqual(n.entries[0].pending, []);
  assert.equal(n.entries[0].type, 'article');
  assert.deepEqual(n.drafts, {});
  assert.equal(n.writer, 'Author');
});

test('sigil SVG carries the statement of intent, marks and statuses, safely escaped', () => {
  const s = richState();
  const v = s.entries.find((e) => e.id === 'sigil-1').versions[0];
  const svg = Model.buildSvg({ title: v.title, sigil: v.sigil, intent: Model.statementOf(v), date: '2026-10-22', by: 'Author' });
  assert.match(svg, /<desc>Statement of intent: Truth seen among chosen kin &amp; \]\]&gt; edge\./);
  assert.match(svg, /<title>Clear sight &lt;&amp;&gt; &quot;kin&quot;<\/title>/);
  const cdata = svg.match(/<metadata id="grimoire-sigil"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/);
  assert.ok(cdata, 'metadata block present');
  const meta = JSON.parse(cdata[1].replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>'));
  assert.equal(meta.statementOfIntent, 'Truth seen among chosen kin & ]]> edge');
  assert.equal(meta.marks.length, 2);
  assert.equal(meta.marks[0].root, 'vor');
  assert.match(svg, /data-status="exploratory"[^>]*stroke-dasharray/);
  assert.match(svg, /No mark is an approved glyph/);
  assert.equal((svg.match(/<path /g) || []).length, 2);
});

test('an unstated intent is labelled, not invented', () => {
  const svg = Model.buildSvg({ title: 't', sigil: { marks: [] }, intent: '', date: 'd', by: 'b' });
  assert.match(svg, /Statement of intent: \(not stated\)/);
});

// Regressions from Zephyr's review (22 Oct): malformed payloads must be refused, not thrown on or "repaired".
test('envelope with null or non-object state is refused without throwing', () => {
  for (const st of [null, 5, 'x', []]) {
    const r = Model.parseImport(JSON.stringify({ format: Model.FORMAT, schemaVersion: 1, state: st }));
    assert.equal(r.state, null);
    assert.ok(r.errors.length);
  }
});

test('present-but-malformed fields are refused, never silently reset', () => {
  const base = () => ({ entries: [{ id: 'a', versions: [{ v: 1, title: 't', blocks: [] }] }], journal: [] });
  const bad = {
    'journal object': (s) => { s.journal = { important: 'observation' }; },
    'drafts list': (s) => { s.drafts = ['keep me']; },
    'undo object': (s) => { s.undo = { step: 1 }; },
    'undo step without type': (s) => { s.undo = [{ label: 'x' }]; },
    'pending object': (s) => { s.entries[0].pending = { p: 1 }; },
    'related text': (s) => { s.entries[0].related = 'example-1'; },
    'sources object': (s) => { s.entries[0].sources = { label: 'x' }; },
    'writer number': (s) => { s.writer = 3; },
    'seq text': (s) => { s.seq = 'nine'; }
  };
  for (const [name, mutate] of Object.entries(bad)) {
    const s = base(); mutate(s);
    for (const wrapped of [s, { format: Model.FORMAT, schemaVersion: 1, state: s }]) {
      const r = Model.migrate(wrapped);
      assert.equal(r.state, null, name);
      assert.ok(r.errors.length, name);
    }
  }
  // absent fields are still filled in for older files
  const ok = Model.migrate(base());
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.state.drafts, {});
  assert.deepEqual(ok.state.entries[0].pending, []);
});

test('sigil mark transforms must be numbers; SVG output stays numeric and escaped', () => {
  const evil = { d: 'M0 0 L10 10', tx: '0) " onload="alert(1)', ty: 0, s: 1, status: 'exploratory', meaning: '' };
  const st = { entries: [{ id: 'a', versions: [{ v: 1, title: 't', blocks: [], sigil: { marks: [evil] } }] }], journal: [] };
  assert.equal(Model.migrate(st).state, null, 'non-numeric tx refused on import');
  const badPath = { d: 'M0 0"/><script>', status: 'exploratory', meaning: '' };
  assert.equal(Model.migrate({ entries: [{ id: 'a', versions: [{ v: 1, title: 't', blocks: [], sigil: { marks: [badPath] } }] }], journal: [] }).state, null, 'unexpected path characters refused');
  // Even if such a value reaches buildSvg directly, nothing but numbers lands in the transform.
  const svg = Model.buildSvg({ title: 't', sigil: { marks: [evil, Object.assign({}, evil, { tx: Infinity, s: NaN })] }, intent: 'i', date: 'd', by: 'b' });
  assert.doesNotMatch(svg, /onload/);
  assert.equal((svg.match(/transform="translate\(0 0\) translate\(100 100\) scale\(1\) translate\(-100 -100\)"/g) || []).length, 2);
});

// ---- Owner requirements (grimoire-owner-requirements.md) ----
test('O1: a spell can be Finished with an empty Practical safety section (no gate)', () => {
  const s = sampleState();
  s.entries.push({ id: 'spell-1', type: 'spell', category: 'practices', sources: [], sourceNote: '', related: [], pending: [], versions: [{ v: 1, editor: 'Author', date: '2026-10-22', title: 'A spell', summary: '', editorial: 'Finished', experimental: false,
    blocks: [{ kind: 'note', by: 'Author', heading: 'Intention', text: 'x' }, { kind: 'note', by: 'Author', heading: 'Practical safety', text: '' }] }] });
  assert.deepEqual(Model.validate(s).errors, []);
});

test('O3: correspondences from many traditions, including conflicting ones, coexist and round-trip', () => {
  const s = richState();
  s.correspondences = [
    { id: 'c1', item: 'Oak', association: 'endurance', tradition: 'Folk', source: 'family practice', certainty: 'personal', note: '', addedBy: 'Author', date: '2026-10-22', history: [] },
    { id: 'c2', item: 'Oak', association: 'thunder', tradition: 'Norse', source: 'named book', certainty: 'sourced', note: 'Struck often by lightning.', addedBy: 'Author', date: '2026-10-22', history: [] },
    { id: 'c3', item: 'Oak', association: 'shelter', tradition: 'Lattice', source: '', certainty: 'unknown', note: '', addedBy: 'Zephyr', date: '2026-10-22', retired: true,
      history: [{ item: 'Oak', association: 'roof', tradition: 'Lattice', source: '', certainty: 'proposed', note: '', addedBy: 'Zephyr', date: '2026-10-21', replacedBy: 'Author', replacedOn: '2026-10-22' }] }
  ];
  const r = Model.parseImport(JSON.stringify(Model.envelope(s)));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.state.correspondences, s.correspondences);
  assert.equal(new Set(r.state.correspondences.map((c) => c.tradition)).size, 3);
  assert.equal(r.state.correspondences[2].history.length, 1, 'earlier wording kept');
  for (const bad of [{ id: 'x', item: '', association: 'a', certainty: 'personal' }, { id: 'x', item: 'a', association: 'b', certainty: 'canon' }, { id: 'x', item: 'a', association: 'b', certainty: 'personal', retired: 'yes' }]) {
    const t = richState(); t.correspondences = [bad];
    assert.equal(Model.migrate(t).state, null, JSON.stringify(bad));
  }
});

test('O5: mark rationale survives export/import and unknown origins stay explicit in SVG', () => {
  const s = richState();
  const sig = s.entries.find((e) => e.id === 'sigil-1').versions[0].sigil;
  Object.assign(sig.marks[0], { natural: 'horizon line', origin: 'April master root vor', why: 'sight runs along the horizon', source: 'Author, 22 Oct' });
  const r = Model.parseImport(JSON.stringify(Model.envelope(s)));
  assert.deepEqual(r.errors, []);
  assert.equal(r.state.entries.find((e) => e.id === 'sigil-1').versions[0].sigil.marks[0].natural, 'horizon line');
  const svg = Model.buildSvg({ title: 't', sigil: sig, intent: 'i', date: 'd', by: 'b' });
  const meta = JSON.parse(svg.match(/CDATA\[([\s\S]*?)\]\]><\/metadata>/)[1]);
  assert.equal(meta.marks[0].rationale.origin, 'April master root vor');
  assert.equal(meta.marks[1].rationale.origin, 'unknown (not recorded)', 'no invented origin');
  const t = richState(); t.entries.find((e) => e.id === 'sigil-1').versions[0].sigil.marks[0].origin = 42;
  assert.equal(Model.migrate(t).state, null, 'non-text rationale refused');
});

// Regressions from Zephyr's second review (22 Oct)
test('an envelope whose state lacks the entries or journal list is refused (no empty replacement)', () => {
  for (const st of [{}, { entries: [] }, { journal: [] }, { entries: [], journal: null }]) {
    const r = Model.parseImport(JSON.stringify({ format: Model.FORMAT, schemaVersion: 1, state: st }));
    assert.equal(r.state, null, JSON.stringify(st));
    assert.ok(r.errors.length);
  }
  assert.equal(Model.parseImport(JSON.stringify({ entries: [] })).state, null, 'legacy without journal refused too');
  assert.ok(Model.parseImport(JSON.stringify({ format: Model.FORMAT, schemaVersion: 1, state: { entries: [], journal: [] } })).state, 'an explicitly empty grimoire is still valid');
});

test('journal links to an already-invalid entry give errors, not a crash', () => {
  for (const versions of [null, 'x', {}]) {
    const r = Model.parseImport(JSON.stringify({ entries: [{ id: 'a', versions }], journal: [{ id: 'o', entryId: 'a', v: 1, happened: 'x' }] }));
    assert.equal(r.state, null);
    assert.ok(r.errors.length);
  }
});

test('custom templates and journal follow-ups round-trip; malformed ones are refused', () => {
  const s = richState();
  s.templates = [{ id: 'tpl-1', name: 'Moon working', type: 'spell', category: 'practices', title: 'Untitled moon working', custom: true, about: 'x', experimental: false, blocks: [['Intention', 'note', 'What for?'], ['Why it is this way', 'rationale', '']] }];
  s.journal[0].followUps = [{ date: '2026-10-22', by: 'Author', text: 'Tried again; calmer.' }];
  const r = Model.parseImport(JSON.stringify(Model.envelope(s)));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.state.templates, s.templates);
  assert.equal(r.state.journal[0].followUps[0].text, 'Tried again; calmer.');
  assert.equal(r.state.journal[0].happened, 'Held it.', 'original observation unchanged');
  for (const mutate of [(t) => { t.templates = {}; }, (t) => { t.templates = [{ id: 'x', name: 'n', type: 'spell', category: 'c', blocks: [['only two', 'note']] }]; }, (t) => { t.journal[0].followUps = 'text'; }, (t) => { t.journal[0].followUps = [{ text: 'x' }]; }]) {
    const t = richState(); mutate(t);
    assert.equal(Model.migrate(t).state, null);
  }
});

test('typed relations: valid ones round-trip; unknown kinds, self-links and bad certainty are refused; loops are detected', () => {
  const s = richState();
  const collar = s.entries.find((e) => e.id === 'example-1');
  collar.relations = [{ rel: 'used in', target: 'example-8', certainty: 'likely', note: 'n', by: 'Author', date: '2026-10-22' }];
  const r = Model.parseImport(JSON.stringify(Model.envelope(s)));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.state.entries.find((e) => e.id === 'example-1').relations, collar.relations);
  for (const bad of [{ rel: 'married to', target: 'example-8', certainty: 'known' }, { rel: 'used in', target: 'example-1', certainty: 'known' }, { rel: 'used in', target: 'example-8', certainty: 'certain' }]) {
    const t = richState(); t.entries.find((e) => e.id === 'example-1').relations = [bad];
    assert.equal(Model.migrate(t).state, null, JSON.stringify(bad));
  }
  const t = richState(); t.entries.find((e) => e.id === 'example-1').relations = [{ rel: 'related to', target: 'gone', certainty: 'known' }];
  assert.equal(Model.migrate(t).warnings.filter((w) => /not present/.test(w)).length, 1, 'missing target is a warning');
  const ents = [{ id: 'a', relations: [{ rel: 'derived from', target: 'b', certainty: 'known' }] }, { id: 'b', relations: [{ rel: 'derived from', target: 'c', certainty: 'known' }] }, { id: 'c', relations: [] }];
  assert.equal(Model.derivationLoop(ents, 'c', 'a'), true, 'c derived from a would close a → b → c → a');
  assert.equal(Model.derivationLoop(ents, 'a', 'c'), false);
});
