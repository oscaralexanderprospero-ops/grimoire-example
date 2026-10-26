// Converts COPIES of OMS Lattice wiki entries (LA-NNNN.json) into a Grimoire import file.
// Read-only towards OMS: it only reads the entry files; it never writes, locks or calls the OMS app.
// Dry run by default (prints what it would produce). Use --out <file> to write the import file,
// then bring it in from the Grimoire's "Data and backups" page with "Add what's new".
//
//   node tools/convert-oms-lattice.mjs [--from <OMS entries folder>] [--out imports/oms-lattice.json]
//
// Mapping (deliberately conservative):
// - Every OMS revision snapshot becomes a Grimoire version, keeping its author, time and note.
// - OMS status (idea / proposed / canon / retired) is recorded as a source label; entries come in as Draft.
//   Nothing is marked as Author's decision: the text is labelled "Source summary" from OMS.
// - Relations become related links plus a readable "Relations" section with their certainty and notes.
// - Recorded source conflicts become "Source gap or conflict" sections, both sides quoted, undecided.
// - Ids are stable (oms-la-0001), so re-running and merging again adds nothing twice.
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Model = require('../preview/model.js');
const DEFAULT_FROM = './example-imports';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c) => c[0] === '#' ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10)) : (ENT[c.toLowerCase()] ?? m));

// Small, predictable HTML → plain text with [[links]]; the Grimoire renders paragraphs and "- " lists.
export function htmlToText(html, titleOf) {
  let s = String(html || '');
  s = s.replace(/<a\b[^>]*href="\/lattice\/(LA-\d+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, id, inner) => {
    const text = decode(inner.replace(/<[^>]+>/g, '')).trim();
    const t = titleOf(id);
    return t ? (t === text ? `[[${t}]]` : `[[${t}|${text}]]`) : text;
  });
  s = s.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/(p|div|h[1-6]|blockquote|ul|ol|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  s = decode(s).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export function convertEntries(raw, opts = {}) {
  const byId = new Map(raw.map((e) => [e.id, e]));
  const gid = (id) => `oms-${id.toLowerCase()}`;
  const titleOf = (id) => (byId.has(id) ? byId.get(id).title : null);
  const entries = raw.map((e) => {
    const relBlock = (rels) => (rels || []).filter((r) => r && r.target).map((r) => `- ${r.rel || 'related to'}: ${titleOf(r.target) ? `[[${titleOf(r.target)}]]` : r.target} (${r.certainty || 'certainty not recorded'})${r.note ? ' — ' + r.note : ''}`).join('\n');
    const fieldBlock = (f, aliases) => [aliases && aliases.length ? `- Also known as: ${aliases.join(', ')}` : '']
      .concat(Object.entries(f || {}).filter(([, v]) => String(v || '').trim()).map(([k, v]) => `- ${k}: ${String(v).replace(/\n+/g, ' ')}`)).filter(Boolean).join('\n');
    const toContent = (snap, by) => {
      const blocks = [{ kind: 'source', by: `OMS Lattice wiki (${by || 'author not recorded'})`, heading: '', text: htmlToText(snap.body, titleOf) || '(no body text)' }];
      const fb = fieldBlock(snap.fields, snap.aliases);
      if (fb) blocks.push({ kind: 'source', by: 'OMS Lattice wiki', heading: 'Details', text: fb });
      const rb = relBlock(snap.relations);
      if (rb) blocks.push({ kind: 'source', by: 'OMS Lattice wiki', heading: 'Relations', text: rb });
      return { title: snap.title || e.id, summary: snap.summary || '', editorial: 'Draft', experimental: false, blocks };
    };
    const revs = (e.revisions || []).filter((r) => r && r.snapshot);
    const versions = (revs.length ? revs : [{ n: 1, at: e.created, by: e.created_by, kind: 'current', note: '', snapshot: e }]).map((r, i) => Object.assign(toContent(r.snapshot, r.by), {
      v: i + 1, editor: r.by || 'not recorded', date: String(r.at || '').slice(0, 10), note: `OMS revision ${r.n} (${r.kind || 'edit'})${r.note ? ': ' + r.note : ''}`
    }));
    // Recorded conflicts: both sides quoted, left undecided.
    if (Array.isArray(e.conflicts) && e.conflicts.length) {
      const text = e.conflicts.map((c) => `${c.about || 'Unnamed question'} (${c.status || 'status not recorded'})\n\n` + (c.sides || []).map((s) => `- “${s.quote || ''}” — ${s.doc || 'source not named'}${s.section ? ', ' + s.section : ''}`).join('\n')).join('\n\n');
      versions[versions.length - 1].blocks.push({ kind: 'gap', by: 'OMS Lattice wiki', heading: 'Recorded source conflicts', text });
    }
    const parts = (e.source && Array.isArray(e.source.parts)) ? e.source.parts : [];
    const sources = [{ label: `OMS Lattice wiki ${e.id} — status "${e.status}", ${e.type}${e.archived ? ', archived in OMS' : ''}`, ref: opts.fromLabel ? `${opts.fromLabel}\\${e.id}.json` : `${e.id}.json`, date: String((revs[revs.length - 1] || {}).at || e.created || '').slice(0, 10), certainty: `Imported copy; OMS status "${e.status}" kept as recorded, not re-verified` }]
      .concat(parts.map((p) => ({ label: `${p.doc || 'Document not named'}${p.section ? ' — ' + p.section : ''}`, ref: p.source_id || '', date: p.doc_modified || '', certainty: `Approval: ${p.approval_status || 'unknown'}; author: ${p.source_author || 'not recorded'}${p.review ? '; ' + p.review : ''}` })));
    return {
      id: gid(e.id), type: 'article', category: 'lattice', sources,
      sourceNote: `Copied from the OMS Lattice wiki (${e.id}, OMS version ${e.v}). Edits here do not change OMS.`,
      related: (e.relations || []).map((r) => r && byId.has(r.target) ? gid(r.target) : null).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i),
      pending: [],
      // Typed relations from the current OMS state (kinds the Grimoire knows; others stay in the Relations text).
      relations: (e.relations || []).filter((r) => r && byId.has(r.target) && r.target !== e.id && Model.RELATIONS[r.rel] && Model.REL_CERTAINTY.includes(r.certainty))
        .map((r) => ({ rel: r.rel, target: gid(r.target), certainty: r.certainty, note: r.note || '', by: 'OMS Lattice wiki' })),
      origin: { system: 'OMS Lattice wiki', id: e.id, omsVersion: e.v, digest: createHash('sha256').update(JSON.stringify(e)).digest('hex').slice(0, 16) },
      versions
    };
  });
  return Model.normalize({ entries, journal: [], correspondences: [] });
}

async function main() {
  const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const from = resolve(arg('from') || DEFAULT_FROM);
  const out = arg('out') ? resolve(arg('out')) : null;
  if (out) {
    const rel = relative(from, out);
    if (!rel.startsWith('..') && !isAbsolute(rel)) { console.error('Refusing to write inside the OMS folder.'); process.exit(2); }
  }
  const names = (await fs.readdir(from)).filter((n) => /^LA-\d+\.json$/.test(n)).sort();
  const raw = [], bad = [];
  for (const n of names) {
    try { raw.push(JSON.parse(await fs.readFile(join(from, n), 'utf8'))); } catch (e) { bad.push(`${n}: ${e.message}`); }
  }
  const state = convertEntries(raw, { fromLabel: from });
  const v = Model.validate(state);
  const sum = Model.summarize(state);
  console.log(`Read ${names.length} OMS Lattice files from ${from} (read-only).`);
  if (bad.length) console.log(`Skipped ${bad.length} unreadable file(s):\n  ${bad.join('\n  ')}`);
  console.log(`Would produce ${sum.entries} Draft entries with ${sum.versions} versions (every OMS revision kept).`);
  console.log(`Validation: ${v.errors.length} errors, ${v.warnings.length} warnings.${v.errors.length ? '\n  ' + v.errors.join('\n  ') : ''}`);
  if (!out) { console.log('Dry run only. Add --out <file> to write the import file.'); return; }
  if (v.errors.length) { console.error('Not written: validation errors.'); process.exit(1); }
  await fs.mkdir(dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(Model.envelope(state, { exportedAt: new Date().toISOString(), note: `Converted from copies of the OMS Lattice wiki (${names.length} files). Import with "Add what's new".` }), null, 1));
  console.log(`Wrote ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
