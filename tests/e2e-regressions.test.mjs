// Regressions from the real-browser end-to-end pass (22 Oct). Focus handling and the phone tab bar were
// verified in a real browser; this covers what can be checked without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp } from './app-harness.mjs';
import { Model, richState } from './helpers.mjs';

test('opening the editor without changing anything is not an "unsaved draft"; a real change is', () => {
  const app = loadApp();
  const s = richState(); delete s.drafts['example-3'];
  app.load(Model.normalize(s));
  app.show('#/entry/example-1/edit');                         // creates an in-memory draft identical to the entry
  assert.ok(app.S.drafts['example-1'], 'the editor has its working copy');
  assert.doesNotMatch(app.show('#/'), /unsaved draft/, 'Home does not list an untouched draft');
  assert.doesNotMatch(app.show('#/entry/example-1'), /Unsaved draft/, 'the entry does not claim an unsaved draft');
  app.S.drafts['example-1'].title = 'Changed title';
  const home = app.show('#/');
  assert.match(home, /Changed title<\/a> <span class="muted">— unsaved draft/, 'a real change is listed, under the title being typed');
  assert.match(app.show('#/entry/example-1'), /Unsaved draft/);
});

test('phone layout keeps focused fields clear of the bottom tab bar', () => {
  const css = readFileSync(new URL('../preview/styles.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /scroll-padding-bottom:\s*calc\(5rem/);
});
