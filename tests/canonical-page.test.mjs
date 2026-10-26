import test from 'node:test';
import assert from 'node:assert/strict';
import { richState, Model } from './helpers.mjs';
import { loadApp } from './app-harness.mjs';

test('missing revision Undo leaves entry history and metadata untouched', () => {
  const app = loadApp(); const state = richState();
  const e = state.entries[0];
  state.undo = [{ type: 'revision', entryId: e.id, beforeV: 99999, label: 'missing revision' }];
  app.load(state);
  const before = JSON.stringify(app.S.entries);
  app.undo();
  assert.equal(JSON.stringify(app.S.entries), before);
  assert.equal(app.S.undo.length, 0);
});

test('expandable sections survive native export/import and render safely; existing sections stay open', () => {
  const state = richState(); const e = state.entries[0];
  const v = e.versions.at(-1);
  v.blocks = [{ kind: 'source', by: 'Test', heading: '<Chart>', text: '### Atlas\n\n| Body | Position |\n| --- | --- |\n| <script> | Example |\n\n[Source](https://example.com)\n\n[Unsafe](javascript:alert)', collapsible: true },
    { kind: 'note', by: 'Test', heading: 'Existing', text: 'Visible' }];
  const parsed = Model.parseImport(JSON.stringify(Model.envelope(state)));
  assert.deepEqual(parsed.errors, []);
  const app = loadApp(); app.load(parsed.state);
  const html = app.show('#/entry/' + e.id);
  assert.match(html, /<details class="passage k-source">\s*<summary>&lt;Chart&gt;<\/summary>/);
  assert.match(html, /<section class="passage k-note">/);
  assert.match(html, /<table><thead>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<h3>Atlas<\/h3>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(app.show('#/entry/' + e.id + '/edit'), /name="collapsible" checked/);
  v.blocks[0].collapsible = 'yes';
  assert.ok(Model.validate(state).errors.some(x => x.includes('collapsible')));
});
