// Shared test helpers. Every test works in its own temporary folder; real data is never touched.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
export const Model = require('../preview/model.js');
export const ROOT = new URL('..', import.meta.url);

export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'grimoire-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// The sample content shipped with the app, loaded the way the browser loads it.
export function sampleState() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../preview/data.js', import.meta.url), 'utf8'), ctx);
  return Model.normalize({ entries: ctx.window.GRIMOIRE_SAMPLE.entries, journal: ctx.window.GRIMOIRE_SAMPLE.journal });
}

// A state exercising everything that must survive: history, suggestions (open/declined), journal links,
// unsaved drafts, undo history, a sigil with statement of intent and marks.
export function richState() {
  const s = sampleState();
  const collar = s.entries.find((e) => e.id === 'example-1');
  const v1 = collar.versions[0];
  collar.versions.push(Object.assign(JSON.parse(JSON.stringify(v1)), { v: 2, editor: 'Author', date: '2026-10-22', note: 'edit' }));
  collar.versions[1].blocks[0].text += '\n\nAdded line.';
  collar.versions.push(Object.assign(JSON.parse(JSON.stringify(v1)), { v: 3, editor: 'Author', date: '2026-10-22', note: 'Undo: restored version 1' }));
  collar.pending.push({ pid: 's-1', by: 'Kimi', date: '2026-10-22', baseV: 1, note: 'alt', content: { title: 'Alt', summary: '', editorial: 'Draft', experimental: true, blocks: [] }, status: 'declined', decidedBy: 'Author' });
  collar.pending.push({ pid: 's-2', by: 'Claude (AI)', date: '2026-10-22', baseV: 3, note: '', content: { title: 'Example exercise 1', summary: '', editorial: 'Draft', experimental: true, blocks: [{ kind: 'proposal', by: 'Claude (AI, pasted by Author)', heading: 'AI suggestion', text: 'x' }] }, status: 'open' });
  s.journal.push({ id: 'o-1', entryId: 'example-1', v: 2, date: '2026-10-22', by: 'Author', happened: 'Held it.', meaning: '', next: '' });
  s.entries.push({ id: 'sigil-1', type: 'sigil', category: 'symbols', sources: [], sourceNote: '', related: [], pending: [], versions: [{
    v: 1, editor: 'Author', date: '2026-10-22', note: 'Started from the Sigil template', title: 'Clear sight <&> "kin"', summary: '', editorial: 'Draft', experimental: false,
    blocks: [{ kind: 'note', by: 'Author', heading: 'Statement of intent', text: 'Truth seen among chosen kin & ]]> edge', hint: 'h' }],
    sigil: { marks: [{ d: 'M40 100 L160 100', tx: 5, ty: 0, s: 1.15, status: 'exploratory', meaning: 'seeing', root: 'vor' }, { d: 'M100 40 L100 160', tx: 0, ty: 0, s: 1, status: 'proposed', meaning: '', root: '' }] } }] });
  s.drafts['example-3'] = Object.assign(JSON.parse(JSON.stringify(s.entries.find((e) => e.id === 'example-3').versions[0])), { base: 1, note: 'half-finished' });
  s.drafts['example-3'].summary = 'Unsaved summary edit';
  s.undo = [{ type: 'revision', entryId: 'example-1', beforeV: 1, label: 'edit' }, { type: 'observation', id: 'o-1', label: 'new observation' }];
  s.writer = 'Zephyr';
  s.seq = 9;
  return s;
}
