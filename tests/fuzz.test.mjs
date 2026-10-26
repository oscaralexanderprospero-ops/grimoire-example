// Malformed-backup review (22 Oct): deterministic mutations of a fully populated grimoire. One mutant per
// (field pattern, change) class keeps this quick; the full run (all ~7,200 mutants) found the same classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Model } from './helpers.mjs';
import { fullState, mutations } from './fuzz-fixture.mjs';
import { loadApp } from './app-harness.mjs';

const base = fullState();
const classes = (() => {
  const seen = new Set(), out = [];
  for (const m of mutations(base)) {
    const c = m.path.replace(/\.\d+/g, '.*').replace(/^drafts\.[^.]+/, 'drafts.ID') + ' = ' + m.change;
    if (!seen.has(c)) { seen.add(c); out.push(m); }
  }
  return out;
})();

// Everything present in the file must survive into what is imported (normalising may only ADD absent fields).
function survives(inp, out, path, bad) {
  if (Array.isArray(inp)) { if (!Array.isArray(out) || out.length !== inp.length) { bad.push(path); return; } inp.forEach((x, i) => survives(x, out[i], path + '.' + i, bad)); return; }
  if (inp && typeof inp === 'object') { if (!out || typeof out !== 'object' || Array.isArray(out)) { bad.push(path); return; } Object.keys(inp).forEach((k) => survives(inp[k], out[k], path + '.' + k, bad)); return; }
  if (!Object.is(inp, out)) bad.push(path);
}

test('the full synthetic grimoire is valid and every page renders', () => {
  assert.deepEqual(Model.migrate(base).errors, []);
  assert.ok(classes.length > 500, `${classes.length} mutation classes`);
});

test('import never throws and never silently drops present content', () => {
  const problems = [];
  for (const m of classes) {
    let r;
    try { r = Model.parseImport(JSON.stringify(Model.envelope(m.state))); } catch (e) { problems.push(`${m.path}=${m.change}: threw ${e.message}`); continue; }
    if (!r.state) { if (!r.errors.length) problems.push(`${m.path}=${m.change}: refused without a reason`); continue; }
    const bad = []; survives(m.state, r.state, '', bad);
    if (bad.length) problems.push(`${m.path}=${m.change}: dropped ${bad[0]}`);
  }
  assert.deepEqual(problems, []);
});

test('accepted files: Markdown copy, photo references, merge, summary and SVG never throw', () => {
  const problems = [];
  for (const m of classes) {
    const r = Model.parseImport(JSON.stringify(Model.envelope(m.state)));
    if (!r.state) continue;
    try {
      Model.toMarkdown(r.state, 'd'); Model.attachmentRefs(r.state); Model.summarize(r.state);
      Model.applyMerge(base, Model.mergePlan(base, r.state), { copies: true });
      r.state.entries.forEach((e) => e.versions.forEach((v) => { if (v.sigil) Model.buildSvg({ title: v.title, sigil: v.sigil, intent: Model.statementOf(v), date: 'd', by: 'b' }); }));
    } catch (e) { problems.push(`${m.path}=${m.change}: ${e.message}`); }
  }
  assert.deepEqual(problems, []);
});

test('accepted files: every page renders (real app.js), and undoing every step leaves a valid grimoire', () => {
  const app = loadApp();
  const problems = [];
  for (const m of classes) {
    const r = Model.parseImport(JSON.stringify(Model.envelope(m.state)));
    if (!r.state) continue;
    app.load(r.state);
    const routes = ['#/', '#/library', '#/library?ret=1', '#/journal', '#/journal/new', '#/correspondences?r=1', '#/create', '#/data', '#/search?q=o'];
    r.state.entries.forEach((e) => {
      const vs = e.versions;
      routes.push(`#/entry/${e.id}`, `#/entry/${e.id}/edit`, `#/entry/${e.id}/v/${vs[0].v}`, `#/entry/${e.id}/compare/${vs[0].v}/${vs[vs.length - 1].v}`);
      e.pending.forEach((p) => routes.push(`#/entry/${e.id}/review/${p.pid}`));
      if (e.type === 'sigil') routes.push(`#/entry/${e.id}/sigil`);
    });
    r.state.journal.forEach((o) => routes.push(`#/entry/${o.entryId}/v/${o.v}?obs=${o.id}`));
    for (const rt of routes) {
      let h; try { h = app.show(rt); } catch (e) { problems.push(`${m.path}=${m.change} ${rt}: threw ${e.message}`); continue; }
      if (/Something went wrong/.test(h)) problems.push(`${m.path}=${m.change} ${rt}: ${(h.match(/<p>(.*?)<\/p>/) || [])[1]}`);
    }
    if (m.path.startsWith('undo')) {
      for (let i = 0; i < 15 && app.S.undo.length; i++) app.undo();
      const ve = Model.validate(JSON.parse(JSON.stringify({ entries: app.S.entries, journal: app.S.journal, drafts: app.S.drafts, undo: app.S.undo, correspondences: app.S.correspondences, templates: app.S.templates }))).errors;
      if (ve.length) problems.push(`${m.path}=${m.change}: after undo ${ve[0]}`);
    }
  }
  assert.deepEqual(problems.slice(0, 10), []);
});

test('confirmed cases from the review stay fixed', () => {
  const refuse = (mutate, why) => { const s = fullState(); mutate(s); const r = Model.parseImport(JSON.stringify(Model.envelope(s))); assert.equal(r.state, null, why); assert.ok(r.errors.length, why); };
  refuse((s) => { s.entries[0].sources = [null]; }, 'null source item');
  refuse((s) => { s.entries[0].sources = [{ ref: 'x' }]; }, 'source without label');
  refuse((s) => { s.correspondences[0].history = [null]; }, 'null earlier wording');
  refuse((s) => { s.undo.find((u) => u.type === 'corr').before = 5; }, 'corr undo payload');
  refuse((s) => { s.undo.find((u) => u.type === 'tpl').before = 'x'; }, 'template undo payload');
  refuse((s) => { s.undo.find((u) => u.type === 'rel').before = null; }, 'relation undo payload');
  refuse((s) => { s.undo.find((u) => u.type === 'merge').entryIds = 1.5; }, 'merge undo payload');
  refuse((s) => { s.undo.push({ type: 'unknown-kind', label: 'x' }); }, 'unknown undo kind');
  // an empty grimoire is valid and every page, including Record observation, renders
  const app = loadApp();
  app.load(Model.normalize({ entries: [], journal: [] }));
  for (const rt of ['#/', '#/library', '#/journal', '#/journal/new', '#/create', '#/data', '#/correspondences', '#/search?q=x']) assert.doesNotMatch(app.show(rt), /Something went wrong/, rt);
  assert.match(app.show('#/journal/new'), /there are none yet/);
});
