// Writes small MADE-UP entries shaped like OMS Lattice wiki files (no real OMS content).
// Run once: node tests/fixtures/make-oms-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const dir = new URL('./oms-lattice/', import.meta.url);
mkdirSync(dir, { recursive: true });
const mk = (id, title, status, body, rels, extra) => Object.assign({
  id, type: 'concept', title, aliases: ['Alt ' + title], status, summary: 'Made-up test entry', body, fields: { 'In short': 'fixture' }, relations: rels, pieces: [], archived: false,
  created: '2026-10-01 10:00', created_by: 'Test',
  source: { import_key: 'k-' + id, parts: [{ source_id: 'test#' + id, doc: 'Made-up doc', section: '1', doc_modified: '2026-10-01', source_author: 'not recorded', approval_status: 'unresolved', review: 'needs review' }] },
  v: 2,
  revisions: [
    { n: 1, at: '2026-10-01 10:00', by: 'Test author', kind: 'import', note: 'first', snapshot: { title, aliases: [], status, summary: 'old', body: '<p>Old text</p>', fields: {}, relations: [], pieces: [], type: 'concept' } },
    { n: 2, at: '2026-10-02 11:00', by: 'Second author', kind: 'edit', note: 'second', snapshot: { title, aliases: ['Alt ' + title], status, summary: 'Made-up test entry', body, fields: { 'In short': 'fixture' }, relations: rels, pieces: [], type: 'concept' } }
  ]
}, extra || {});

writeFileSync(new URL('LA-9001.json', dir), JSON.stringify(mk('LA-9001', 'Test Tree', 'proposed',
  '<p><em>Quoted</em> text &amp; more, see <a href="/lattice/LA-9002" rel="noopener">the vine</a>.</p><ul><li>one</li><li>two</li></ul>',
  [{ rel: 'related to', target: 'LA-9002', certainty: 'known', note: 'n' }]), null, 1));
writeFileSync(new URL('LA-9002.json', dir), JSON.stringify(mk('LA-9002', 'Test Vine', 'idea', '<p>Vine &lt;text&gt;</p>', [],
  { conflicts: [{ about: 'whether it pumps', status: 'open', sides: [{ quote: 'It pumps.', doc: 'Doc A' }, { quote: 'It does not.', doc: 'Doc B' }] }] }), null, 1));
writeFileSync(new URL('.lock', dir), '');
console.log('fixtures written');
