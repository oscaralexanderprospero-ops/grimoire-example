// Command-line access to the local grimoire, for Author or an assistant (e.g. Claude in a Claude Code session).

// Reads freely. Writes ONLY reviewable things: suggestions (which change nothing until accepted in the app)

// and correspondences marked "proposed". It never edits accepted text, versions, journal or decisions.

// Writes go through the same storage as the app: atomic, conflict-checked, with backups.

//

//   node tools/grimoire.mjs list [--category lattice] [--type spell]

//   node tools/grimoire.mjs show <entry-id> [--version N]

//   node tools/grimoire.mjs search <words...>

//   node tools/grimoire.mjs suggest <entry-id> --by "Claude (AI)" --heading "Suggested variation" --text-file note.md [--note "why"]

//   node tools/grimoire.mjs export-markdown --out readable.md

//   node tools/grimoire.mjs propose-correspondence --item Oak --association endurance --tradition Folk --source "..." --by "Claude (AI)" [--note "..."]

//   Options: --data <folder> (default <repo>/data or GRIMOIRE_DATA)

import { promises as fs } from 'node:fs';

import { join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';

import { createStore } from '../preview/storage.mjs';



const require = createRequire(import.meta.url);

const Model = require('../preview/model.js');

const REPO = fileURLToPath(new URL('..', import.meta.url));



export function parseArgs(argv) {

  const pos = [], opt = {};

  for (let i = 0; i < argv.length; i++) {

    if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; }

    else pos.push(argv[i]);

  }

  return { pos, opt };

}



const cur = (e) => e.versions[e.versions.length - 1];

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const KIND = { source: 'Source summary', decision: 'Decision', proposal: 'Proposal', adaptation: 'Adaptation', interpretation: 'Interpretation', rationale: 'Rationale', fiction: 'In-world fiction', gap: 'Source gap or conflict', note: 'Note' };



export function entryAsText(e, v) {

  const lines = [`# ${v.title}`, '', `id: ${e.id} · ${e.type || 'article'} · ${e.category} · ${v.editorial}${v.experimental ? ' · Experimental' : ''} · version ${v.v} of ${cur(e).v} · last edited by ${v.editor || 'unknown'} ${v.date || ''}`];

  if (v.summary) lines.push('', v.summary);

  v.blocks.forEach((b) => { lines.push('', `## ${b.heading || '(untitled section)'}  [${KIND[b.kind] || b.kind} · ${b.by}]`, '', b.text || '(not written yet)'); });

  if (v.sigil) {

    lines.push('', '## Sigil marks');

    v.sigil.marks.forEach((m, i) => lines.push(`${i + 1}. ${m.meaning || '(no meaning stated)'}${m.root ? ' [' + m.root + ']' : ''} — ${Model.STATUS_LABEL[m.status]}; natural: ${m.natural || '—'}; earlier form: ${m.origin || 'unknown (not recorded)'}; why: ${m.why || '—'}; source: ${m.source || '—'}`));

  }

  if (e.sources.length) { lines.push('', '## Sources'); e.sources.forEach((s) => lines.push(`- ${s.label}${s.date ? ' · ' + s.date : ''} (${s.certainty})${s.ref ? ' — ' + s.ref : ''}`)); }

  if (e.relations && e.relations.length) { lines.push('', '## Relations'); e.relations.forEach((r) => lines.push(`- ${r.rel} ${r.target} (${r.certainty})${r.note ? ' — ' + r.note : ''}`)); }

  const open = (e.pending || []).filter((p) => p.status === 'open');

  if (open.length) lines.push('', `Open suggestions: ${open.map((p) => `${p.pid} by ${p.by}`).join(', ')}`);

  return lines.join('\n');

}



export async function run(argv, out = console.log) {

  const { pos, opt } = parseArgs(argv);

  const cmd = pos[0];

  const store = createStore(resolve(opt.data || process.env.GRIMOIRE_DATA || join(REPO, 'data')));

  const loaded = await store.load();

  if (loaded.corrupt) throw new Error(loaded.error);

  if (!loaded.state) throw new Error(`No grimoire yet in ${store.dir}. Start the app once (start-grimoire.cmd) to create it.`);

  const st = loaded.state;

  const find = (id) => { const e = st.entries.find((x) => x.id === id); if (!e) throw new Error(`No entry with id "${id}". Use "list" or "search".`); return e; };

  const need = (k) => { if (!opt[k] || opt[k] === true) throw new Error(`Missing --${k}`); return String(opt[k]); };

  const write = async (state, what) => {

    const r = await store.save(state, loaded.etag, 'edit');

    if (r.conflict) throw new Error('The grimoire changed while this command ran. Nothing was written; run it again.');

    if (r.invalid || r.blocked) throw new Error('Not written: ' + (r.blocked || r.invalid.join('; ')));

    out(`${what} Saved to ${store.file} (an open app tab picks it up when you return to it).`);

  };



  if (cmd === 'list') {

    st.entries.filter((e) => (!opt.category || e.category === opt.category) && (!opt.type || (e.type || 'article') === opt.type))

      .forEach((e) => out(`${e.id}\t${cur(e).title}\t${e.category}\t${cur(e).editorial}\tv${cur(e).v}`));

    return;

  }

  if (cmd === 'show') {

    const e = find(pos[1]);

    const v = opt.version ? e.versions.find((x) => x.v === Number(opt.version)) : cur(e);

    if (!v) throw new Error(`Entry ${e.id} has no version ${opt.version}`);

    out(entryAsText(e, v));

    return;

  }

  if (cmd === 'search') {

    const terms = pos.slice(1).join(' ').toLowerCase().split(/\s+/).filter(Boolean);

    if (!terms.length) throw new Error('Give some words to search for.');

    st.entries.forEach((e) => { const v = cur(e); const hay = [v.title, v.summary].concat(v.blocks.map((b) => `${b.heading} ${b.text}`)).join(' ').toLowerCase(); if (terms.every((t) => hay.includes(t))) out(`entry\t${e.id}\t${v.title}`); });

    st.journal.forEach((o) => { if (terms.every((t) => `${o.happened} ${o.meaning} ${o.next}`.toLowerCase().includes(t))) out(`journal\t${o.id}\t${o.entryId} v${o.v}`); });

    (st.correspondences || []).forEach((c) => { if (terms.every((t) => `${c.item} ${c.association} ${c.tradition} ${c.note || ''}`.toLowerCase().includes(t))) out(`correspondence\t${c.id}\t${c.item} — ${c.association} (${c.tradition || 'no tradition'})`); });

    return;

  }

  if (cmd === 'suggest') {

    const e = find(pos[1]);

    const by = need('by');

    const text = opt['text-file'] ? (await fs.readFile(resolve(String(opt['text-file'])), 'utf8')).trim() : need('text');

    if (!text) throw new Error('The suggestion text is empty.');

    const content = JSON.parse(JSON.stringify((({ title, summary, editorial, experimental, blocks, sigil }) => (sigil ? { title, summary, editorial, experimental, blocks, sigil } : { title, summary, editorial, experimental, blocks }))(cur(e))));

    content.blocks.push({ kind: 'proposal', by, heading: String(opt.heading && opt.heading !== true ? opt.heading : 'Suggestion'), text });

    const pid = `s-cli-${Date.now().toString(36)}`;

    e.pending.push({ pid, by, date: today(), baseV: cur(e).v, note: String(opt.note && opt.note !== true ? opt.note : 'Added from the command line'), content, status: 'open' });

    await write(st, `Suggestion ${pid} recorded on "${cur(e).title}" — it changes nothing until accepted in the app.`);

    return;

  }

  if (cmd === 'propose-correspondence') {

    const c = { id: `c-cli-${Date.now().toString(36)}`, item: need('item'), association: need('association'), tradition: String(opt.tradition && opt.tradition !== true ? opt.tradition : ''),

      source: String(opt.source && opt.source !== true ? opt.source : ''), certainty: 'proposed', note: String(opt.note && opt.note !== true ? opt.note : ''), addedBy: need('by'), date: today(), history: [] };

    st.correspondences = (st.correspondences || []).concat([c]);

    await write(st, `Proposed correspondence ${c.id} (${c.item} — ${c.association}), marked "Proposal (not yet adopted)".`);

    return;

  }

  if (cmd === 'export-markdown') {

    const file = resolve(need('out'));

    await fs.writeFile(file, Model.toMarkdown(st, today()));

    out(`Wrote a readable copy to ${file} (for reading; not an import format).`);

    return;

  }

  out('Commands: list, show <id>, search <words>, suggest <id> --by ... --text-file ..., propose-correspondence --item ... --association ... --by ..., export-markdown --out file.md');

}



if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {

  run(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });

}

