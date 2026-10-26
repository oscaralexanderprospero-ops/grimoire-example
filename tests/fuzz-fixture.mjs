// A deterministic, fully populated synthetic grimoire (every feature present) and a deterministic
// mutation generator, shared by the import fuzz test and the in-browser render check.
import { richState } from './helpers.mjs';

export function fullState() {
  const s = richState();
  const collar = s.entries.find((e) => e.id === 'example-1');
  const last = collar.versions[collar.versions.length - 1];
  last.tags = ['oak', 'collar'];
  last.blocks[0].text += '\n\n![photo](att:' + 'a'.repeat(32) + '.png)';
  collar.relations = [{ rel: 'used in', target: 'example-8', certainty: 'likely', note: 'n', by: 'Author', date: '2026-10-22' }];
  s.entries.find((e) => e.id === 'example-2').retired = true;
  s.journal[0].photos = [{ id: 'b'.repeat(32) + '.jpg', caption: 'c' }];
  s.journal[0].followUps = [{ date: '2026-10-22', by: 'Author', text: 'again' }];
  s.correspondences = [
    { id: 'c1', item: 'Oak', association: 'endurance', tradition: 'Folk', source: 's', certainty: 'personal', note: 'n', addedBy: 'Author', date: '2026-10-22', history: [{ item: 'Oak', association: 'old', tradition: 'Folk', source: '', certainty: 'proposed', note: '', replacedBy: 'Author', replacedOn: '2026-10-21' }] },
    { id: 'c2', item: 'Oak', association: 'thunder', tradition: 'Norse', source: 'b', certainty: 'sourced', retired: true }
  ];
  s.templates = [{ id: 'tpl-1', name: 'Moon', type: 'spell', category: 'practices', title: 'Untitled moon', custom: true, about: 'a', experimental: false, blocks: [['Intention', 'note', 'p'], ['Why', 'rationale', '']] }];
  s.undo = [
    { type: 'revision', entryId: 'example-1', beforeV: 1, label: 'edit' },
    { type: 'observation', id: 'o-1', label: 'obs' },
    { type: 'suggestion', entryId: 'example-1', pid: 's-2', label: 'sugg' },
    { type: 'decline', entryId: 'example-1', pid: 's-1', label: 'decl' },
    { type: 'corr', id: 'c1', before: null, label: 'corr' },
    { type: 'tpl', id: 'tpl-1', before: null, label: 'tpl' },
    { type: 'follow', id: 'o-1', label: 'follow' },
    { type: 'rel', entryId: 'example-1', before: [], label: 'rel' },
    { type: 'retire', entryId: 'example-2', before: false, label: 'retire' },
    { type: 'merge', entryIds: [], obsIds: [], corrIds: [], label: 'merge' },
    { type: 'capture', entryId: 'example-8', label: 'capture' }
  ];
  return s;
}

// Every value in the tree (except inside long prose) is, in turn: deleted (object members), and replaced
// by null, 0, -1, 1.5, '', 'x', true, [], {}, and an HTML-ish string. Deterministic order.
const REPLACEMENTS = [null, 0, -1, 1.5, '', 'x', true, [], {}, '"><img src=x onerror=1>'];
export function* mutations(state) {
  const paths = [];
  (function walk(v, path) {
    paths.push(path);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, path.concat(i)));
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k], path.concat(k)));
  })(state, []);
  for (const path of paths) {
    if (!path.length) continue;
    const parentPath = path.slice(0, -1), key = path[path.length - 1];
    const original = get(state, path);
    const variants = [];
    if (typeof key === 'string') variants.push({ kind: 'delete' });
    REPLACEMENTS.forEach((r) => { if (JSON.stringify(r) !== JSON.stringify(original)) variants.push({ kind: 'set', value: r }); });
    for (const v of variants) {
      const m = JSON.parse(JSON.stringify(state));
      const parent = get(m, parentPath);
      if (v.kind === 'delete') delete parent[key]; else parent[key] = JSON.parse(JSON.stringify(v.value));
      yield { path: path.join('.'), change: v.kind === 'delete' ? 'delete' : JSON.stringify(v.value), state: m };
    }
  }
}
export function get(o, path) { return path.reduce((x, k) => (x == null ? undefined : x[k]), o); }
