/* Lattice Age Grimoire — the app in the browser.

   Saves through the local server (preview/serve.mjs) to the data folder on this laptop; opened without

   the server it works in memory only and says so. No browser storage; no network beyond the local server. */

(function () {

  'use strict';



  const OFFLINE_PHONE = !!(window.GrimoireApp && window.GrimoireApp.offlineMode && window.GrimoireApp.offlineMode());

  const PEOPLE = ['Author', 'Zephyr', 'Claude', 'Kimi', 'DeepSeek', 'Guest'];

  const KINDS = {

    source: 'Source summary',

    decision: 'Decision',

    proposal: 'Proposal',

    adaptation: 'Adaptation',

    interpretation: 'Interpretation',

    rationale: 'Rationale',

    fiction: 'In-world fiction',

    gap: 'Source gap or conflict',

    note: 'Note'

  };

  const OBS_CAVEAT = 'An observation records what happened. It does not establish how or why it happened.';

  const TYPES = { article: 'Article', spell: 'Spell or ritual', sigil: 'Sigil' };

  // Templates are starting structure only: headed, labelled sections with prompts. [heading, passage label, prompt]

  const TEMPLATES = [

    { id: 'spell', type: 'spell', name: 'Spell or ritual', category: 'practices', title: 'Untitled spell or ritual',

      about: 'Intention, materials, steps, symbolism, practical safety, variations and sources — all free text.',

      blocks: [

        ['Intention', 'note', 'What is this for, in a sentence or two?'],

        ['Materials', 'note', 'Each item, where it comes from, and any substitutions.'],

        ['Steps', 'note', '1. First step\n2. Next step'],

        ['Symbolism', 'interpretation', 'What each element means to you, and where that meaning comes from.'],

        ['Practical safety', 'note', 'Physical safety only: fire and smoke, blades, plant or oil toxicity, skin contact, ingestion, allergies, permission to use the site, consent of anyone involved.'],

        ['Variations', 'proposal', 'Alternatives worth keeping, even if not chosen.'],

        ['Why it is this way', 'rationale', 'Reasons for the choices above: natural associations, earlier-language roots, where each came from. Write "unknown" rather than guess.'],

        ['Sources', 'source', 'Your own practice, a tradition, a book, a conversation — and how sure you are.']

      ] },

    { id: 'sigil', type: 'sigil', name: 'Sigil', category: 'symbols', title: 'Untitled sigil',

      about: 'State the meaning, then draw marks that each carry part of it. Exports as SVG.',

      blocks: [

        ['Statement of intent', 'note', 'The sentence or Example symbols roots the sigil should be readable as.'],

        ['Construction notes', 'note', 'How the marks were chosen and combined.']

      ] },

    { id: 'article', type: 'article', name: 'Article', category: 'unsorted', title: 'Untitled article',

      about: 'A blank page with one section, for lore, philosophy or anything else.',

      blocks: [['', 'note', 'Start writing…']] },

    { id: 'reading', type: 'article', name: 'Divination reading', category: 'tarot', title: 'Untitled reading',

      about: 'Question, method, what was drawn, and what it might mean — with what was drawn recorded before any interpretation.',

      blocks: [

        ['Question', 'note', 'What was asked, and when.'],

        ['Method and spread', 'note', 'Which deck or method, which spread or positions.'],

        ['What was drawn', 'note', 'Cards or signs in order and position. Record this before interpreting.'],

        ['What it might mean', 'interpretation', 'Your reading, in its own terms.'],

        ['Afterwards', 'note', 'Come back later: what actually happened. Kept apart from the reading above.']

      ] },

    { id: 'experiment', type: 'article', name: 'Technomancy experiment', category: 'technomancy', title: 'Untitled experiment', experimental: true,

      about: 'Hypothesis, setup, measurements, and interpretation kept apart from the measurements.',

      blocks: [

        ['Hypothesis', 'proposal', 'What do you expect, and what would count against it?'],

        ['Setup', 'note', 'Equipment, materials, conditions.'],

        ['Measurements', 'note', 'What will be measured, how, and with what.'],

        ['Interpretation', 'interpretation', 'Kept separate from the measurements.']

      ] }

  ];

  // Example symbols roots: April master only (via Zephyr's recovery notes). Conflicts stay open; no glyph shapes are approved.

  const ROOTS = [['', 'No root'], ['el-', 'el- — sacred, elevated'], ['sei', 'sei — truth, unveiled reality'], ['vor', 'vor — sight, perception'], ['mel', 'mel — friendship, alliance, chosen kinship']];

  const MARK_STATUS = { exploratory: 'Exploratory mark', proposed: 'Proposed glyph', approved: 'Approved glyph (Author)' };

  const SHAPES = {

    'Vertical line': 'M100 40 L100 160', 'Horizontal line': 'M40 100 L160 100', 'Circle': 'M140 100 A40 40 0 1 1 60 100 A40 40 0 1 1 140 100',

    'Dot': 'M104 100 A4 4 0 1 1 96 100 A4 4 0 1 1 104 100', 'Triangle': 'M100 50 L145 140 L55 140 Z', 'Arc': 'M50 120 Q100 40 150 120', 'Diagonal': 'M55 145 L145 55'

  };

  const AI_ASKS = [['missing', 'Draft the empty sections'], ['variations', 'Suggest variations'], ['safety', 'Review practical safety'], ['meanings', 'Suggest meanings for sigil marks'], ['wording', 'Tighten the wording']];



  const clone = (o) => JSON.parse(JSON.stringify(o));

  const Model = window.GrimoireModel;

  const seedState = () => Model.normalize({ entries: clone(window.GRIMOIRE_SAMPLE.entries), journal: clone(window.GRIMOIRE_SAMPLE.journal) });

  const S = {

    categories: window.GRIMOIRE_SAMPLE.categories.concat([{ id: 'dreams', name: 'Dreams' }, { id: 'astral-travel', name: 'Astral Travel' }, { id: 'trance', name: 'Trance' }, { id: 'astrology', name: 'Astrology', hideEmpty: true }, { id: 'unsorted', name: 'Unsorted captures', hideEmpty: true }]),

    entries: [], journal: [], undo: [], drafts: {}, writer: 'Author', seq: 1, correspondences: [], templates: [],

    // Storage status for this tab. mode: loading | saved (local server) | memory (no server) | error

    store: { mode: 'loading', etag: null, savedAt: null, error: null, conflict: null, dataDir: '', corrupt: false }

  };

  // Everything in PERSIST is saved, exported and restored: entries with all versions and suggestions,

  // the journal, unsaved drafts, the undo history and the last "writing as" choice.

  const PERSIST = ['entries', 'journal', 'drafts', 'undo', 'writer', 'seq', 'correspondences', 'templates'];

  // A draft that still matches its entry exactly (the editor was only opened) is not real unsaved work:

  // it isn't saved, listed as an unsaved draft, or allowed to cause a conflict in another tab.

  const canon = (x) => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.keys(x).sort().reduce((o, k) => { o[k] = canon(x[k]); return o; }, {}) : x;

  const sameContentAny = (a, b) => JSON.stringify(canon(contentOf(a))) === JSON.stringify(canon(contentOf(b)));

  const draftChanged = (id) => { const d = S.drafts[id], e = S.entries.find((x) => x.id === id); return !!d && (!e || !sameContentAny(d, e.versions[e.versions.length - 1])); };

  const changedDrafts = () => Object.keys(S.drafts).filter(draftChanged).reduce((o, id) => { o[id] = S.drafts[id]; return o; }, {});

  const snapshot = () => { const o = {}; PERSIST.forEach((k) => { o[k] = k === 'drafts' ? changedDrafts() : S[k]; }); return clone(o); };

  function loadState(st) { const n = Model.normalize(st); PERSIST.forEach((k) => { S[k] = n[k]; }); }



  // ---------- helpers ----------

  const $ = (sel, root) => (root || document).querySelector(sel);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  const fmtDate = (d) => {

    const t = new Date(d + 'T12:00:00');

    return isNaN(t) ? esc(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  };

  const uid = (p) => p + '-' + Date.now().toString(36) + '-' + (S.seq++);

  const entry = (id) => S.entries.find((e) => e.id === id);

  const cur = (e) => e.versions[e.versions.length - 1];

  const ver = (e, n) => e.versions.find((v) => v.v === n);

  const cat = (id) => S.categories.find((c) => c.id === id) || { id, name: id };

  const byTitle = (t) => S.entries.find((e) => cur(e).title.toLowerCase() === t.trim().toLowerCase());

  const wordCount = (t) => { const n = (String(t || '').match(/\S+/g) || []).length; return `${n} word${n === 1 ? '' : 's'}`; };

  const allTags = () => [...new Set(S.entries.flatMap((e) => cur(e).tags || []))].sort();

  const dupTitle = (title, selfId) => {

    const t = String(title || '').trim().toLowerCase();

    const other = t && S.entries.find((x) => x.id !== selfId && cur(x).title.trim().toLowerCase() === t);

    return other ? `Another entry is already called “${cur(other).title}”. That's allowed, but links by title will go to the first one.` : '';

  };

  const contentOf = (v) => Object.assign({ title: v.title, summary: v.summary, editorial: v.editorial, experimental: v.experimental, blocks: clone(v.blocks) }, v.sigil ? { sigil: clone(v.sigil) } : {}, v.tags && v.tags.length ? { tags: v.tags.slice() } : {});

  const parseTags = (s) => [...new Set(String(s || '').split(',').map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean))];

  const sameContent = (a, b) => JSON.stringify(contentOf(a)) === JSON.stringify(contentOf(b));

  const opts = (list, sel) => list.map((x) => {

    const [val, lab] = Array.isArray(x) ? x : [x, x];

    return `<option value="${esc(val)}"${val === sel ? ' selected' : ''}>${esc(lab)}</option>`;

  }).join('');

  const peopleOpts = (sel) => {

    const list = PEOPLE.includes(sel) || !sel ? PEOPLE : PEOPLE.concat([sel]);

    return opts(list, sel);

  };



  // Minimal prose renderer: paragraphs, "- " lists, "1. " lists, [[Title]] / [[Title|label]] links.

  function inline(text) {

    return esc(text).replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, label) => {

      const t = target.replace(/&#39;/g, "'").replace(/&amp;/g, '&');

      const hit = byTitle(t);

      const shown = label || target;

      if (hit) return `<a href="#/entry/${hit.id}">${shown}</a>`;

      return `<span class="missing">${shown}</span> <a href="#/capture?title=${encodeURIComponent(t)}" class="muted">(no entry yet — capture one)</a>`;

    });

  }

  function prose(text) {

    return String(text || '').split(/\n\s*\n/).map((para) => {

      const lines = para.split('\n');

      if (lines.length >= 2 && /^\|.*\|$/.test(lines[0]) && /^\|[\s:|\-]+\|$/.test(lines[1])) {

        const cells = (line) => line.trim().slice(1, -1).split('|').map(x => x.trim());

        return '<div class="table-scroll" tabindex="0" role="region" aria-label="Reference table"><table><thead><tr>' + cells(lines[0]).map(x => '<th scope="col">' + inline(x) + '</th>').join('') + '</tr></thead><tbody>' + lines.slice(2).map(line => '<tr>' + cells(line).map(x => '<td>' + inline(x) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';

      }

      if (lines.length === 1 && /^#{1,6} /.test(lines[0])) return '<h3>' + inline(lines[0].replace(/^#{1,6} /, '')) + '</h3>';

      if (lines.every((l) => /^\s*-\s+/.test(l))) return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ''))}</li>`).join('') + '</ul>';

      if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) return '<ol>' + lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('') + '</ol>';

      const img = lines.length === 1 && /^!\[([^\]]*)\]\(att:([0-9a-f]{32}\.(?:jpg|png|webp|gif))\)$/.exec(lines[0].trim());

      if (img) return `<figure class="att"><a href="attachments/${img[2]}" target="_blank" rel="noopener"><img src="attachments/${img[2]}" alt="${esc(img[1] || 'Photo')}" loading="lazy"></a>${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ''}</figure>`;

      return `<p>${lines.map(inline).join('<br>')}</p>`;

    }).join('');

  }

  const linkTargets = (text) => Array.from(String(text).matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)).map((m) => m[1].trim().toLowerCase());



  function chips(e, v) {

    const out = [`<li class="chip">${esc(v.editorial)}</li>`];

    if (e.retired) out.push('<li class="chip sample">Retired</li>');

    (v.tags || []).forEach((t) => out.push(`<li><a class="chip" href="#/library?tag=${esc(encodeURIComponent(t))}">${esc(t)}</a></li>`));

    if (e.type && e.type !== 'article') out.push(`<li class="chip">${esc(TYPES[e.type])}</li>`);

    if (v.experimental) out.push('<li class="chip exp">Experimental</li>');

    if (e.sample) out.push('<li class="chip sample">Sample written for this prototype</li>');

    return `<ul class="chips" aria-label="Status">${out.join('')}</ul>`;

  }

  const lastEdit = (e) => String(cur(e).date || '');



  // ---------- toast & undo ----------

  let toastTimer;

  function toast(msg, withUndo) {

    const t = $('#toast');

    t.innerHTML = `<span>${esc(msg)}</span>` + (withUndo ? '<button type="button" data-action="undo">Undo</button>' : '');

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => { t.innerHTML = ''; }, 9000);

  }

  function renderUndo() {

    const last = S.undo[S.undo.length - 1];

    $('#undo-slot').innerHTML = last ? `<button type="button" data-action="undo" title="Undo ${esc(last.label)}">Undo: ${esc(last.label)}</button>` : '';

  }

  function undo() {

    const a = S.undo[S.undo.length - 1];

    if (!a) return;

    try { applyUndo(a); S.undo.pop(); }

    catch (err) { console.error(err); S.undo.pop(); toast('That undo step could not be applied (its record is incomplete). Nothing was changed.'); }

    render(false);

  }

  function applyUndo(a) {

    const e = a.entryId && entry(a.entryId);

    if (a.type === 'revision' && e) {

      const before = ver(e, a.beforeV);

      if (!before) { toast('Cannot restore that version: it is missing from this entry. Entry history was not changed.'); return; }

      e.touched = Date.now();

      e.versions.push(Object.assign(contentOf(before), { v: cur(e).v + 1, editor: S.writer, date: today(), note: `Undo: restored version ${a.beforeV}` }));

      if (a.pid) { const p = e.pending.find((x) => x.pid === a.pid); if (p) { p.status = 'open'; delete p.decidedBy; } }

      toast(`Restored version ${a.beforeV} as version ${cur(e).v}.`);

    } else if (a.type === 'observation') {

      S.journal = S.journal.filter((o) => o.id !== a.id);

      toast('Observation removed.');

    } else if (a.type === 'suggestion' && e) {

      e.pending = e.pending.filter((p) => p.pid !== a.pid);

      toast('Suggestion withdrawn.');

    } else if (a.type === 'decline' && e) {

      const p = e.pending.find((x) => x.pid === a.pid); if (p) { p.status = 'open'; delete p.decidedBy; }

      toast('Suggestion reopened.');

    } else if (a.type === 'rel' && e) {

      e.relations = a.before;

      toast('Relation change undone.');

    } else if (a.type === 'retire' && e) {

      if (a.before) e.retired = true; else delete e.retired;

      toast('Change undone.');

    } else if (a.type === 'tpl') {

      if (a.before === null) S.templates = S.templates.filter((t) => t.id !== a.id);

      else S.templates.push(a.before);

      toast('Template change undone.');

    } else if (a.type === 'follow') {

      const o = S.journal.find((x) => x.id === a.id);

      if (o && o.followUps) o.followUps.pop();

      toast('Follow-up removed.');

    } else if (a.type === 'merge') {

      const ids = new Set(a.entryIds), obs = new Set(a.obsIds), cs = new Set(a.corrIds);

      S.entries = S.entries.filter((x) => !ids.has(x.id));

      S.journal = S.journal.filter((o) => !obs.has(o.id));

      S.correspondences = S.correspondences.filter((c) => !cs.has(c.id));

      Object.keys(S.drafts).forEach((id) => { if (ids.has(id)) delete S.drafts[id]; });

      toast('Removed what that import added.');

    } else if (a.type === 'corr') {

      const i = S.correspondences.findIndex((c) => c.id === a.id);

      if (a.before === null) { if (i >= 0) S.correspondences.splice(i, 1); }

      else if (i >= 0) S.correspondences[i] = a.before; else S.correspondences.push(a.before);

      toast('Correspondence change undone.');

    } else if (a.type === 'capture') {

      S.entries = S.entries.filter((x) => x.id !== a.entryId);

      if (location.hash.indexOf('#/entry/' + a.entryId) === 0) { location.hash = '#/'; }

      toast('Capture removed.');

    }

    render(false);

  }



  // ---------- persistence (local server) ----------

  let saveTimer = null, saving = false, again = false, lastSaved = '';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isDirty = () => JSON.stringify(snapshot()) !== lastSaved;

  function setStatus() {

    const st = S.store, el = $('#store-status');

    if (!el) return;

    const t = st.savedAt ? new Date(st.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

    let msg;

    if (st.mode === 'loading') msg = 'Loading…';

    else if (st.mode === 'memory') msg = '<strong>Not saving.</strong> This page was opened without the grimoire\'s local server, so changes live only in this tab. Start it with <code>start-grimoire.cmd</code> to save. <a href="#/data">Export</a>';

    else if (st.mode === 'error') msg = `<strong>Not saved.</strong> ${esc(st.error)} Your changes are still in this tab. <a href="#/data">Data and backups</a>`;

    else if (st.conflict) msg = '<strong>Saving paused:</strong> the grimoire was changed elsewhere. <a href="#/data">Choose which version to keep</a> — nothing has been lost.';

    else if (saving || isDirty()) msg = 'Saving…';

    else msg = `Saved on this ${OFFLINE_PHONE ? 'phone' : 'laptop'}${t ? ' at ' + t : ''}. <a href="#/data">Data and backups</a>`;

    if (st.syncWarning) msg += `<strong> Sync queue warning:</strong> ${esc(st.syncWarning)}`;

    el.innerHTML = msg;

  }

  function schedulePersist() {

    if (S.store.mode !== 'saved' || S.store.conflict) return;

    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => saveNow('edit'), 500);

  }

  // Returns { ok } | { conflict } | { error } | undefined (nothing to save / queued behind a save in progress)

  async function saveNow(reason) {

    clearTimeout(saveTimer);

    if (reason === 'edit' && (S.store.mode !== 'saved' || S.store.conflict)) return;

    const state = snapshot(); const text = JSON.stringify(state);

    if (reason === 'edit' && text === lastSaved) return;

    if (saving) { again = true; return; }

    saving = true; setStatus();

    let out;

    try {

      const r = await fetch('api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseEtag: S.store.etag, reason, state }) });

      const j = await r.json().catch(() => ({}));

      if (r.status === 409) {

        S.store.conflict = { etag: j.etag, state: j.state, keptAs: j.keptAs };

        toast('Saving paused: the grimoire was changed elsewhere. Nothing has been lost — see Data and backups.');

        out = { conflict: true };

      } else if (!r.ok) {

        S.store.mode = 'error'; S.store.corrupt = !!j.corrupt;

        S.store.error = (j.error || 'The server refused the save.') + (j.details ? ' ' + j.details.slice(0, 3).join('; ') : '');

        out = { error: S.store.error };

      } else {

        S.store.etag = j.etag; S.store.savedAt = j.savedAt; S.store.mode = 'saved'; S.store.error = null; lastSaved = text;

        S.store.syncWarning = j.syncWarning || null;

        if (j.syncWarning) toast('Saved locally, but sync queue needs attention: ' + j.syncWarning);

        out = { ok: true, syncWarning: j.syncWarning || null };

      }

    } catch (e) {

      S.store.mode = 'error'; S.store.error = 'The grimoire\'s local server is not reachable. Retrying…';

      setTimeout(() => { if (S.store.mode === 'error' && !S.store.corrupt) { S.store.mode = 'saved'; saveNow('edit'); } }, 5000);

      out = { error: 'The local server is not reachable.' };

    } finally {

      saving = false; setStatus();

      if (again) { again = false; saveNow('edit'); }

    }

    return out;

  }

  async function settle() { while (saving) await sleep(50); }



  async function checkForOutsideChanges() {

    if (S.store.mode !== 'saved' || saving || S.store.conflict || isDirty()) return;

    try {

      const r = await fetch('api/state', { cache: 'no-store' });

      if (!r.ok) return;

      const j = await r.json();

      if (j.state && j.etag !== S.store.etag && !isDirty()) {

        loadState(j.state); S.store.etag = j.etag; S.store.savedAt = j.savedAt; lastSaved = JSON.stringify(snapshot());

        render(false);

        toast('Updated with changes saved elsewhere.');

      }

    } catch (e) { /* offline: the next save reports it */ }

  }



  async function keepCopyAsBackup() {

    // A deliberately stale save: the server refuses it and keeps it in backups as "conflict-unsaved".

    try {

      const r = await fetch('api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseEtag: 'keep-as-backup', reason: 'edit', state: snapshot() }) });

      return (await r.json()).keptAs || null;

    } catch (e) { return null; }

  }

  async function resolveConflict(which) {

    const c = S.store.conflict;

    if (!c) return;

    if (which === 'mine') {

      S.store.conflict = null;

      const r = await saveNow('conflict-overwrite');

      toast(r && r.ok ? 'Kept this tab\'s version. The version it replaced was backed up first.' : 'Could not save this tab\'s version.');

    } else {

      const kept = await keepCopyAsBackup();

      loadState(c.state); S.store.etag = c.etag; S.store.conflict = null; lastSaved = JSON.stringify(snapshot());

      toast('Loaded the saved version.' + (kept ? ' This tab\'s version is in backups.' : ''));

    }

    S.backups = null;

    render(false);

    focusMain();

  }

  function focusMain() { const h = $('main h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } }



  async function readImport(file) {

    if (!file) return;

    S.importPreview = { name: file.name, result: Model.parseImport(await file.text()) };

    render(false);

    const n = $('#import-result'); if (n) n.focus();

  }

  const MAX_PHOTO = 15 * 1024 * 1024;

  async function uploadPhoto(file, expect) {

    if (file.size > MAX_PHOTO) throw new Error(`this photo is ${(file.size / 1048576).toFixed(1)} MB; the limit is 15 MB. Use a smaller copy (most phones can share a reduced size).`);

    const r = await fetch('api/attachments' + (expect ? '?expect=' + encodeURIComponent(expect) : ''), { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });

    const j = await r.json().catch(() => ({}));

    if (!r.ok) throw new Error(j.error || (r.status === 413 ? 'the photo is larger than 15 MB' : 'upload refused'));

    return j.id;

  }

  // Put an import file's embedded photos back on this laptop before its entries arrive.

  async function restorePhotos(ip) {

    const att = ip.result.attachments || {};

    const ids = Object.keys(att);

    if (!ids.length) return true;

    if (S.store.mode !== 'saved') { toast('This file includes photos, which need the local server; they will not show in this tab.'); return true; }

    try {

      for (const id of ids) {

        const bin = atob(att[id]); const bytes = new Uint8Array(bin.length);

        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        const ext = id.split('.')[1];

        await uploadPhoto(new Blob([bytes], { type: { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext] }), id);

      }

      return true;

    } catch (e) { toast('Import stopped: a photo in the file could not be restored (' + e.message + '). Nothing was changed.'); return false; }

  }

  async function applyImport() {

    const ip = S.importPreview;

    if (!ip || !ip.result.state) return;

    await settle();

    if (S.store.mode === 'saved') {

      // Save this tab's latest changes (drafts included) first, so the pre-import backup contains them.

      await saveNow('edit');

      if (S.store.conflict || S.store.mode !== 'saved' || isDirty()) { toast('Import not applied: this tab\'s latest changes could not be saved first. Nothing was replaced.'); render(false); return; }

    } else {

      exportSession();   // not saving: download a copy of the current contents before replacing them

    }

    if (!(await restorePhotos(ip))) return;

    const prev = snapshot();

    loadState(ip.result.state);

    S.importPreview = null;

    if (S.store.mode === 'saved') {

      const r = await saveNow('import');

      if (!r || !r.ok) { loadState(prev); render(false); toast('Import not applied: ' + ((r && r.error) || (r && r.conflict && 'the grimoire was changed elsewhere') || 'unknown problem') + '.'); return; }

      S.backups = null;

      toast('Imported. The previous version was backed up first.');

    } else {

      lastSaved = '';

      toast('Imported into this tab only — it is not being saved. The previous contents were downloaded first.');

    }

    location.hash = '#/';

  }

  async function applyMergeImport() {

    const ip = S.importPreview;

    if (!ip || !ip.result.state) return;

    const copies = !!($('#merge-copies') && $('#merge-copies').checked);

    await settle();

    if (S.store.mode === 'saved') {

      await saveNow('edit');

      if (S.store.conflict || S.store.mode !== 'saved' || isDirty()) { toast('Not added: this tab’s latest changes could not be saved first.'); render(false); return; }

    }

    if (!(await restorePhotos(ip))) return;

    const prev = snapshot();

    const res = Model.applyMerge(prev, Model.mergePlan(prev, ip.result.state), { copies });

    loadState(res.state);

    S.undo.push({ type: 'merge', entryIds: res.added.entryIds, obsIds: res.added.obsIds, corrIds: res.added.corrIds, label: `adding ${res.added.entryIds.length} entries from ${ip.name}` });

    S.importPreview = null;

    if (S.store.mode === 'saved') {

      const r = await saveNow('import');

      if (!r || !r.ok) { loadState(prev); render(false); toast('Not added: ' + ((r && r.error) || 'the grimoire was changed elsewhere') + '.'); return; }

    }

    toast(`Added ${res.added.entryIds.length} entries, ${res.added.obsIds.length} observations, ${res.added.corrIds.length} correspondences${res.skippedObs.length ? `; ${res.skippedObs.length} observations skipped` : ''}. Undo removes them.`, true);

    location.hash = '#/library';

  }



  async function doRestore(name) {

    if (S.store.conflict) { toast('Choose which version to keep first.'); return; }

    await settle();

    await saveNow('edit');   // so the latest edits are inside the "before restore" backup

    if (S.store.mode !== 'saved' && isDirty()) await exportSession();   // can't save: download this tab's copy first

    if (S.store.mode === 'saved' && (S.store.conflict || isDirty())) { toast('Restore not applied: this tab\'s latest changes could not be saved first. Nothing was replaced.'); render(false); return; }

    try {

      const r = await fetch('api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });

      const j = await r.json();

      if (!r.ok) throw new Error(j.error || 'Restore failed');

      loadState(j.state);

      Object.assign(S.store, { etag: j.etag, mode: 'saved', error: null, corrupt: false, savedAt: new Date().toISOString() });

      lastSaved = JSON.stringify(snapshot());

      S.restoreAsk = null; S.backups = null;

      toast('Restored. The version it replaced was backed up first.');

      render(false);

    } catch (e) { toast('Restore failed: ' + e.message); }

  }

  async function loadBackups() {

    S.backups = { loading: true }; render(false);

    try { const r = await fetch('api/backups', { cache: 'no-store' }); const j = await r.json(); S.backups = { list: j.backups, dir: j.dir }; }

    catch (e) { S.backups = { error: 'Could not list backups.' }; }

    render(false);

  }



  async function boot() {

    let j = null;

    if (location.protocol === 'http:' || location.protocol === 'https:') {

      try {

        const r = await fetch('api/state', { cache: 'no-store' });

        j = await r.json();

        if (!r.ok) Object.assign(S.store, { mode: 'error', error: j.error || 'Could not load the grimoire.', corrupt: !!j.corrupt, dataDir: j.dataDir || '' });

      } catch (e) { j = null; }

    }

    if (S.store.mode === 'error') loadState(seedState());          // shown, never saved over the unreadable file

    else if (!j) { S.store.mode = 'memory'; loadState(seedState()); lastSaved = JSON.stringify(snapshot()); }

    else {

      S.store.dataDir = j.dataDir || '';

      if (j.state) {

        loadState(j.state);

        Object.assign(S.store, { mode: 'saved', etag: j.etag, savedAt: j.savedAt });

        lastSaved = JSON.stringify(snapshot());

        if (j.warnings && j.warnings.length) toast(`Loaded with ${j.warnings.length} warning(s) — see Data and backups.`);

        S.loadWarnings = j.warnings || [];

      } else {

        loadState(seedState());

        S.store.mode = 'saved';

        await saveNow('seed');

      }

    }

    render(false);

  }



  // ---------- routing ----------

  function parse() {

    const h = location.hash.replace(/^#/, '') || '/';

    const [path, qs] = h.split('?');

    const q = new URLSearchParams(qs || '');

    const parts = path.split('/').filter(Boolean);

    return { parts, q };

  }



  function setNav(section) {

    document.querySelectorAll('[data-nav]').forEach((a) => {

      if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');

    });

  }



  function renderTree(activeId) {

    const active = activeId && entry(activeId);

    $('#libtree').innerHTML = S.categories.map((c) => {

      const list = S.entries.filter((e) => e.category === c.id && !e.retired);

      if (!list.length && c.hideEmpty) return '';

      const open = active && active.category === c.id;

      const items = list.length

        ? '<ul>' + list.map((e) => `<li><a href="#/entry/${e.id}"${e.id === activeId ? ' aria-current="page"' : ''}>${esc(cur(e).title)}</a></li>`).join('') + '</ul>'

        : '<p class="muted" style="margin:.2rem 0 .5rem .9rem">No entries yet</p>';

      return `<details${open ? ' open' : ''}><summary>${esc(c.name)} <span class="muted">(${list.length})</span></summary>${items}</details>`;

    }).join('');

  }



  function render(focus) {

    const { parts, q } = parse();

    const main = $('#main');

    let html = '';

    let section = '';

    let activeId = null;

    try {

      if (!parts.length) { section = 'home'; html = viewHome(); }

      else if (parts[0] === 'library') { section = 'library'; html = viewLibrary(q); }

      else if (parts[0] === 'journal' && parts[1] === 'new') { section = 'journal'; html = viewObserveForm(q.get('entry'), q.get('v')); }

      else if (parts[0] === 'journal') { section = 'journal'; html = viewJournal(q); }

      else if (parts[0] === 'capture') { section = 'home'; html = viewCapture(q); }

      else if (parts[0] === 'create') { section = 'create'; html = viewCreate(q); }

      else if (parts[0] === 'search') { html = viewSearch(q.get('q') || '', q.get('in') || ''); }

      else if (parts[0] === 'data') { html = viewData(); }

      else if (parts[0] === 'correspondences') { section = 'library'; html = viewCorrespondences(q); }

      else if (parts[0] === 'entry' && entry(parts[1])) {

        section = 'library'; activeId = parts[1];

        const e = entry(parts[1]);

        if (parts[2] === 'edit') html = viewEdit(e);

        else if (parts[2] === 'v') html = viewEntry(e, parseInt(parts[3], 10), q.get('obs'));

        else if (parts[2] === 'review') html = viewReview(e, parts[3]);

        else if (parts[2] === 'compare') html = viewCompare(e, parseInt(parts[3], 10), parseInt(parts[4], 10));

        else if (parts[2] === 'observe') html = viewObserveForm(e.id);

        else if (parts[2] === 'sigil' && e.type === 'sigil') html = viewSigilWorkshop(e);

        else html = viewEntry(e);

      } else { html = '<div class="reading"><h1 tabindex="-1">Not found</h1><p>That page doesn\'t exist in the grimoire. <a href="#/">Return home</a>.</p></div>'; }

    } catch (err) {

      console.error(err);

      html = `<div class="reading"><h1 tabindex="-1">Something went wrong</h1><p>${esc(err.message)}</p></div>`;

    }

    main.innerHTML = html;

    setNav(section);

    renderTree(activeId);

    renderUndo();

    schedulePersist();

    setStatus();

    const sq = $('#q'); if (parts[0] === 'search') sq.value = q.get('q') || '';

    main.querySelectorAll('textarea').forEach(autosize);

    if (focus) { const h1 = main.querySelector('h1'); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus(); } window.scrollTo(0, 0); }

  }

  function autosize(t) { t.rows = Math.min(28, Math.max(4, t.value.split('\n').length + Math.ceil(t.value.length / 90))); }



  // ---------- views ----------

  function card(e) {

    const v = cur(e);

    return `<li class="card"><h3><a href="#/entry/${e.id}">${esc(v.title)}</a></h3>

      <p>${esc(v.summary)}</p>${chips(e, v)}

      <p class="muted">${esc(cat(e.category).name)} · version ${v.v} · ${esc(v.editor)}, ${fmtDate(v.date)}</p></li>`;

  }



  function viewHome() {

    const drafts = Object.keys(S.drafts).filter((id) => entry(id) && draftChanged(id));

    const recent = S.entries.slice().sort((a, b) => ((b.touched || 0) - (a.touched || 0)) || lastEdit(b).localeCompare(lastEdit(a)))

      .filter((e) => !drafts.includes(e.id)).slice(0, Math.max(0, 3 - drafts.length));

    const cont = drafts.map((id) => `<li><a href="#/entry/${id}/edit">${esc(S.drafts[id].title || cur(entry(id)).title)}</a> <span class="muted">— unsaved draft</span></li>`)

      .concat(recent.map((e) => `<li><a href="#/entry/${e.id}">${esc(cur(e).title)}</a> <span class="muted">— ${esc(cur(e).editorial)}</span></li>`)).join('');

    return `<div class="reading">

      <h1>Welcome back</h1>

      <p class="lead">A living grimoire for practice, lore and experiment.</p>

      <div class="starts">

        <section class="start"><h2>Continue</h2><ul>${cont}</ul></section>

        <section class="start"><h2>Capture</h2><p>A short note — the title and category are optional.</p><p><a href="#/capture">Capture a thought</a></p></section>

        <section class="start"><h2>Create</h2><p>A spell, ritual, sigil or experiment from a template.</p><p><a href="#/create">Start something new</a></p></section>

        <section class="start"><h2>Browse</h2><p>${S.categories.filter((c) => !c.hideEmpty).length} categories, ${S.entries.length} entries.</p><p><a href="#/library">Open the library</a></p></section>

      </div>

      <details class="meta"><summary>Guide — what to try</summary><div>

        <ol>

          <li>Open <a href="#/entry/example-1">Removable staff collar</a> and choose <strong>Edit</strong>. Change a passage, then <strong>Save version</strong>. You'll see version 2.</li>

          <li>Press <strong>Undo</strong>: version 3 restores version 1's text, and history keeps all three.</li>

          <li><strong>Record observation</strong> on the entry. It links to the version you choose.</li>

          <li>Open <a href="#/journal">Journal</a> and follow "version used" to read that exact version.</li>

          <li>Try <strong>Propose for review</strong> while writing as Kimi, then accept or decline it.</li>

          <li>Record <a href="#/correspondences">correspondences</a> from any tradition, each with its source; differing ones stay side by side.</li>

          <li>Open an older version from an entry's Details to compare it or restore it. Nothing is ever removed from the history.</li>

          <li><a href="#/data">Data and backups</a>: export, import (replace, or add what's new), restore a backup, or download a readable copy. Press <kbd>/</kbd> anywhere to search.</li>

          <li>Open <a href="#/create">Create</a>: start a spell from the template, or a sigil — draw marks, give each a meaning, export SVG.</li>

          <li>On any entry, open <strong>AI help — not connected</strong>: copy a request, paste a reply back, and it arrives as a suggestion to review.</li>

        </ol>

        <p class="hint">${OFFLINE_PHONE ? 'Changes save automatically on this phone, including without a network connection' : 'Changes save automatically to this laptop while the grimoire runs through its local server'} (see <a href="#/data">Data and backups</a>). "Writing as" is an attribution label, not a sign-in.</p>

      </div></details>

    </div>`;

  }



  function viewLibrary(q) {

    const c = q.get('cat') || '', ed = q.get('ed') || '', ex = q.get('ex') || '', ty = q.get('ty') || '', by = q.get('by') || '', tag = q.get('tag') || '', ret = q.get('ret') === '1';

    const people = [...new Set(S.entries.flatMap((e) => e.versions.flatMap((v) => [v.editor].concat(v.blocks.map((b) => b.by)))).filter(Boolean))].sort();

    const list = S.entries.filter((e) => {

      const v = cur(e);

      return (!c || e.category === c) && (!ed || v.editorial === ed) && (!ex || String(!!v.experimental) === ex) && (!ty || (e.type || 'article') === ty)

        && (!by || e.versions.some((x) => x.editor === by || x.blocks.some((b) => b.by === by)))

        && (!tag || (v.tags || []).includes(tag)) && (ret ? e.retired : !e.retired);

    });

    const groups = S.categories.filter((k) => !c || k.id === c).map((k) => {

      const items = list.filter((e) => e.category === k.id);

      if (!items.length && (k.hideEmpty || ed || ex || ty || by || tag || ret)) return '';

      return `<section><h2>${esc(k.name)}</h2>${items.length ? `<ul class="cards">${items.map(card).join('')}</ul>` : '<p class="muted">No entries yet.</p>'}</section>`;

    }).join('');

    return `<div class="reading">

      <h1>Library</h1>

      <p><a href="#/correspondences">Correspondences</a> — associations across every tradition, each with its source.</p>

      <form class="filters" data-form="filters" aria-label="Filter entries">

        <div class="field"><label for="f-cat">Category</label><select id="f-cat" name="cat">${opts([['', 'All categories']].concat(S.categories.map((k) => [k.id, k.name])), c)}</select></div>

        <div class="field"><label for="f-ed">Editorial state</label><select id="f-ed" name="ed">${opts([['', 'Any'], 'Draft', 'Finished'], ed)}</select></div>

        <div class="field"><label for="f-ex">Experimental</label><select id="f-ex" name="ex">${opts([['', 'Any'], ['true', 'Experimental'], ['false', 'Not experimental']], ex)}</select></div>

        <div class="field"><label for="f-ty">Kind</label><select id="f-ty" name="ty">${opts([['', 'Any kind']].concat(Object.keys(TYPES).map((k) => [k, TYPES[k]])), ty)}</select></div>

        <div class="field"><label for="f-by">Contributor</label><select id="f-by" name="by">${opts([['', 'Anyone']].concat(people), by)}</select></div>

        <div class="field"><label for="f-tag">Tag</label><select id="f-tag" name="tag">${opts([['', 'Any tag']].concat(allTags()), tag)}</select></div>

        <div class="field"><label for="f-ret">Showing</label><select id="f-ret" name="ret">${opts([['', 'Current entries'], ['1', 'Retired entries']], ret ? '1' : '')}</select></div>

      </form>

      <p class="muted" aria-live="polite">${list.length} ${list.length === 1 ? 'entry' : 'entries'} shown.</p>

      ${groups || '<p>No entries match these filters.</p>'}

    </div>`;

  }



  // Typed relations: this entry's own, plus the inverse of relations other entries make to it.

  function relationsHtml(e, readOnly) {

    const own = (e.relations || []).map((r, i) => ({ r, i, other: entry(r.target), label: r.rel }));

    const incoming = [];

    S.entries.forEach((o) => (o.relations || []).forEach((r) => { if (r.target === e.id) incoming.push({ r, other: o, label: Model.RELATIONS[r.rel] }); }));

    const li = (x, mine) => `<li>${esc(x.label)} <a href="#/entry/${x.other ? x.other.id : ''}">${x.other ? esc(cur(x.other).title) : esc(x.r.target) + ' (missing)'}</a> <span class="muted">(${esc(x.r.certainty)}${x.r.by ? ', added by ' + esc(x.r.by) : ''})</span>${x.r.note ? ` — ${esc(x.r.note)}` : ''}${mine && !readOnly ? ` <button type="button" class="linkish" data-action="rel-remove" data-id="${e.id}" data-i="${x.i}">remove</button>` : ''}</li>`;

    const others = S.entries.filter((x) => x.id !== e.id).map((x) => [x.id, cur(x).title]).sort((a, b) => a[1].localeCompare(b[1]));

    const form = readOnly ? '' : (S.relFor === e.id ? `<form class="stack card" data-form="rel" data-id="${e.id}" novalidate aria-label="Add a relation">

        <div class="row">

          <div class="field"><label for="rel-kind">This entry is…</label><select id="rel-kind" name="rel">${opts(Object.keys(Model.RELATIONS))}</select></div>

          <div class="field" style="flex:1 1 14rem"><label for="rel-target">…which entry</label><select id="rel-target" name="target">${opts(others)}</select></div>

          <div class="field"><label for="rel-cert">How sure</label><select id="rel-cert" name="certainty">${opts(Model.REL_CERTAINTY)}</select></div>

        </div>

        <div class="field"><label for="rel-note">Note <span class="muted">(optional: why, and from where)</span></label><input id="rel-note" name="note" type="text"></div>

        <div class="field"><label for="rel-by">Writing as</label><select id="rel-by" name="by">${peopleOpts(S.writer)}</select></div>

        <p id="rel-err" class="notice" role="alert" hidden></p>

        <div class="actions" style="margin:0"><button type="submit" class="primary">Add relation</button><button type="button" data-action="rel-cancel">Cancel</button></div></form>`

      : `<div class="actions" style="margin:.3rem 0 0"><button type="button" data-action="rel-open" data-id="${e.id}">Add a relation</button></div>`);

    if (!own.length && !incoming.length && readOnly) return '';

    return `<h2>Relations</h2>

      ${own.length || incoming.length ? `<ul>${own.map((x) => li(x, true)).join('')}${incoming.map((x) => li(x, false)).join('')}</ul>` : '<p class="muted">None yet. Relations say how entries connect — "derived from", "used in", "variant of" — and how sure that is.</p>'}

      ${form}`;

  }



  function backlinks(e) {

    const t = cur(e).title.toLowerCase();

    return S.entries.filter((o) => o.id !== e.id && (o.related.includes(e.id) || cur(o).blocks.some((b) => linkTargets(b.text).includes(t))));

  }



  function viewEntry(e, n, obsId) {

    const latest = cur(e);

    const v = n ? ver(e, n) : latest;

    if (!v) return `<div class="reading"><h1>Version not found</h1><p><a href="#/entry/${e.id}">Go to the current version</a></p></div>`;

    const old = v !== latest;

    const obs = obsId && S.journal.find((o) => o.id === obsId);

    const contributors = Array.from(new Set(e.versions.map((x) => x.editor).concat(...e.versions.map((x) => x.blocks.map((b) => b.by)))));

    const open = e.pending.filter((p) => p.status === 'open');

    const declined = e.pending.filter((p) => p.status === 'declined');

    const journal = S.journal.filter((o) => o.entryId === e.id);

    const bl = backlinks(e);

    const related = e.related.map(entry).filter(Boolean);

    const draft = draftChanged(e.id) ? S.drafts[e.id] : null;



    let banner = '';

    if (old) {

      banner = `<div class="notice" role="note"><p><strong>You're reading version ${v.v} of ${latest.v}</strong> — read-only.${obs ? ` This is the version used for the observation on ${fmtDate(obs.date)} by ${esc(obs.by)}.` : ''}</p>

        <p><a href="#/entry/${e.id}">Go to the current version (${latest.v})</a> · <a href="#/entry/${e.id}/compare/${v.v}/${latest.v}">Compare with the current version</a>${obs ? ` · <a href="#/journal?entry=${e.id}">Back to the journal</a>` : ''}</p>

        <div class="actions" style="margin:.4rem 0 0"><button type="button" data-action="restore-version" data-id="${e.id}" data-v="${v.v}">Restore this version as a new version</button></div></div>`;

    }

    const notices = [];

    if (!old && draft) notices.push(`<div class="notice"><p><strong>Unsaved draft</strong>, started from version ${draft.base}.</p><p class="actions" style="margin:.4rem 0 0"><a href="#/entry/${e.id}/edit">Resume editing</a> <button type="button" data-action="discard-draft" data-id="${e.id}">Discard draft</button></p></div>`);

    if (!old) open.forEach((p) => notices.push(`<div class="notice"><p><strong>Suggestion awaiting review</strong> from ${esc(p.by)}, ${fmtDate(p.date)}${p.note ? ` — “${esc(p.note)}”` : ''}. It hasn't changed the entry.</p><p style="margin:.3rem 0 0"><a href="#/entry/${e.id}/review/${p.pid}">Review the suggestion</a></p></div>`));



    const history = e.versions.slice().reverse().map((x) => `<li>${x === v ? '<strong>' : ''}Version ${x.v}${x === v ? ' (shown)</strong>' : ''} — ${esc(x.editor)}, ${fmtDate(x.date)}${x.note ? `: ${esc(x.note)}` : ''}${x.acceptedBy ? ` (accepted by ${esc(x.acceptedBy)})` : ''}${x !== v ? ` · <a href="#/entry/${e.id}/v/${x.v}">read</a>` : ''}${x.v > e.versions[0].v ? ` · <a href="#/entry/${e.id}/compare/${e.versions[e.versions.indexOf(x) - 1].v}/${x.v}">what changed</a>` : ''}</li>`).join('');



    return `<article class="reading">

      ${banner}

      <p class="crumb"><a href="#/library?cat=${e.category}">${esc(cat(e.category).name)}</a></p>

      <h1>${esc(v.title)}</h1>

      ${v.summary ? `<p class="lead">${esc(v.summary)}</p>` : ''}

      ${chips(e, v)}

      <p class="attrib">Version ${v.v} · last edited by ${esc(v.editor)}, ${fmtDate(v.date)} · started by ${esc(e.versions[0].editor)}</p>

      ${!old ? `<div class="actions">

        <button type="button" data-action="go" data-href="#/entry/${e.id}/edit">Edit</button>

        <button type="button" data-action="go" data-href="#/entry/${e.id}/observe">Record observation</button>

        <button type="button" data-action="go" data-href="#/create?from=${e.id}">Save sections as a template</button>

        <button type="button" data-action="retire-entry" data-id="${e.id}">${e.retired ? 'Bring back into the library' : 'Retire this entry'}</button>

      </div>` : ''}

      ${!old && e.type === 'sigil' ? `<div class="actions"><button type="button" data-action="go" data-href="#/entry/${e.id}/sigil">Open sigil workshop</button></div>` : ''}

      ${notices.join('')}

      ${v.sigil || e.type === 'sigil' ? sigilFigure(e, v) : ''}

      <details class="meta"><summary>Details — sources, history, links (${e.sources.length} source${e.sources.length === 1 ? '' : 's'}, ${e.versions.length} version${e.versions.length === 1 ? '' : 's'})</summary><div>

        ${e.sourceNote ? `<h3>Source note</h3><p>${esc(e.sourceNote)}</p>` : ''}

        <h3>Sources</h3>${e.sources.length ? `<ul>${e.sources.map((s) => `<li>${esc(s.label)}${s.date ? ` · ${esc(s.date)}` : ''}<br><span class="muted">Certainty: ${esc(s.certainty)}</span><br><span class="ref">${esc(s.ref)}</span></li>`).join('')}</ul>` : '<p class="muted">No source recorded.</p>'}

        <h3>Contributors</h3><p>${contributors.map(esc).join(', ')}</p>

        <h3>Version history</h3><ul>${history}</ul>

        <h3>Linked from</h3>${bl.length ? `<ul>${bl.map((o) => `<li><a href="#/entry/${o.id}">${esc(cur(o).title)}</a></li>`).join('')}</ul>` : '<p class="muted">Nothing links here yet.</p>'}

        ${declined.length ? `<h3>Alternatives not adopted</h3><ul>${declined.map((p) => `<li>Suggestion by ${esc(p.by)}, ${fmtDate(p.date)} — declined by ${esc(p.decidedBy)} · <a href="#/entry/${e.id}/review/${p.pid}">read it</a></li>`).join('')}</ul>` : ''}

      </div></details>

      ${v.blocks.map((b) => `<${b.collapsible ? 'details' : 'section'} class="passage k-${esc(b.kind)}">

        ${b.collapsible ? `<summary>${esc(b.heading || 'Section')}</summary>` : ''}

        <p class="plabel">${esc(KINDS[b.kind] || b.kind)} <span>· ${esc(b.by)}</span></p>

        ${b.heading && !b.collapsible ? `<h2>${esc(b.heading)}</h2>` : ''}

        ${b.text.trim() ? `<div class="prose">${prose(b.text)}</div>` : `<p class="muted">Not written yet${b.hint ? ' - ' + esc(b.hint.split('\n')[0]) : ''}</p>`}</${b.collapsible ? 'details' : 'section'}>`).join('')}

      ${!old ? aiPanel(e) : ''}

      ${related.length ? `<h2>Related entries</h2><ul>${related.map((o) => `<li><a href="#/entry/${o.id}">${esc(cur(o).title)}</a></li>`).join('')}</ul>` : ''}

      ${relationsHtml(e, old)}

      <h2>Journal for this entry</h2>

      ${journal.length ? `<ul class="cards">${journal.map(obsCard).join('')}</ul>` : '<p class="muted">No observations recorded yet.</p>'}

    </article>`;

  }



  function obsCard(o) {

    const e = entry(o.entryId);

    const latest = e ? cur(e).v : o.v;

    return `<li class="obs">

      <p style="margin:0"><strong>${fmtDate(o.date)}</strong> · ${esc(o.by)} · ${e ? `<a href="#/entry/${e.id}">${esc(cur(e).title)}</a>` : 'removed entry'}</p>

      <p class="muted" style="margin:.2rem 0 0">Version used: ${e ? `<a href="#/entry/${e.id}/v/${o.v}?obs=${o.id}">version ${o.v}</a>` : `version ${o.v}`}${latest !== o.v ? ` (current is ${latest})` : ' (current)'}</p>

      ${(o.photos || []).length ? `<div class="thumbs">${o.photos.map((p) => `<a href="attachments/${esc(p.id)}" target="_blank" rel="noopener"><img src="attachments/${esc(p.id)}" alt="${esc(p.caption || 'Photo from this observation')}" loading="lazy"></a>`).join('')}</div>` : ''}

      <dl><dt>What happened</dt><dd>${esc(o.happened)}</dd>

      ${o.meaning ? `<dt>What it might mean</dt><dd>${esc(o.meaning)}</dd>` : ''}

      ${o.next ? `<dt>What to change next time</dt><dd>${esc(o.next)}</dd>` : ''}</dl>

      ${(o.followUps || []).length ? `<div class="followups"><p class="muted" style="margin:.5rem 0 .2rem">Follow-ups (the original observation is unchanged):</p><ul>${o.followUps.map((f) => `<li><strong>${fmtDate(f.date)}</strong> · ${esc(f.by)}: ${esc(f.text)}</li>`).join('')}</ul></div>` : ''}

      ${S.followFor === o.id ? `<form class="stack" data-form="follow" data-id="${esc(o.id)}" novalidate style="margin-top:.5rem">

          <div class="field"><label for="fu-text">Follow-up note</label><textarea id="fu-text" name="text"></textarea></div>

          <div class="field"><label for="fu-by">Writing as</label><select id="fu-by" name="by">${peopleOpts(S.writer)}</select></div>

          <p id="fu-err" class="notice" role="alert" hidden></p>

          <div class="actions" style="margin:0"><button type="submit" class="primary">Add follow-up</button><button type="button" data-action="follow-cancel">Cancel</button></div></form>`

        : `<div class="actions" style="margin:.5rem 0 0">${e ? `<button type="button" data-action="go" data-href="#/journal/new?entry=${e.id}&v=${o.v}">Practise again</button>` : ''}<button type="button" data-action="follow-open" data-id="${esc(o.id)}">Add a follow-up</button></div>`}</li>`;

  }



  function viewJournal(q) {

    const f = q.get('entry') || '';

    const list = S.journal.filter((o) => !f || o.entryId === f).slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));

    return `<div class="reading">

      <h1>Journal</h1>

      <p class="lead">Observations from practice, each linked to the version of the entry that was used.</p>

      <p class="hint">${OBS_CAVEAT}</p>

      <div class="actions"><button type="button" data-action="go" data-href="#/journal/new${f ? '?entry=' + esc(encodeURIComponent(f)) : ''}">Record observation</button></div>

      <form class="filters" data-form="jfilter"><div class="field"><label for="jf">Entry</label>

        <select id="jf" name="entry">${opts([['', 'All entries']].concat(S.entries.map((e) => [e.id, cur(e).title])), f)}</select></div></form>

      ${list.length ? `<ul class="cards">${list.map(obsCard).join('')}</ul>` : '<p class="muted">No observations yet. Nothing is pre-filled: observations appear here as you record them.</p>'}

    </div>`;

  }



  function viewObserveForm(entryId, wantV) {

    const e = entryId && entry(entryId);

    const pick = e || S.entries[0];

    if (!pick) return '<div class="reading"><h1>Record observation</h1><p>An observation belongs to an entry, and there are none yet. <a href="#/create">Create one</a> or <a href="#/capture">capture a thought</a> first.</p></div>';

    const versions = pick.versions.slice().reverse().map((x) => [String(x.v), `Version ${x.v} — ${x.editor}, ${fmtDate(x.date)}${x === cur(pick) ? ' (current)' : ''}`]);

    return `<div class="reading">

      <p class="crumb">${e ? `<a href="#/entry/${e.id}">${esc(cur(e).title)}</a>` : '<a href="#/journal">Journal</a>'}</p>

      <h1>Record observation</h1>

      <p class="hint">${OBS_CAVEAT} Keep what happened apart from what it might mean.</p>

      <form class="stack" data-form="observe" novalidate>

        <div class="row">

          <div class="field"><label for="o-entry">Entry practised</label><select id="o-entry" name="entry" data-change="obs-entry">${opts(S.entries.map((x) => [x.id, cur(x).title]), pick.id)}</select></div>

          <div class="field"><label for="o-v">Version used</label><select id="o-v" name="v">${opts(versions, wantV && ver(pick, parseInt(wantV, 10)) ? String(parseInt(wantV, 10)) : String(cur(pick).v))}</select></div>

        </div>

        <div class="row">

          <div class="field"><label for="o-date">Date</label><input id="o-date" name="date" type="date" value="${today()}"></div>

          <div class="field"><label for="o-by">Writing as</label><select id="o-by" name="by">${peopleOpts(S.writer)}</select></div>

        </div>

        <div class="field"><label for="o-h">What happened <span class="muted">(required)</span></label>

          <p class="hint" id="o-h-hint">What you did and noticed — conditions, materials, timings.</p>

          <textarea id="o-h" name="happened" aria-describedby="o-h-hint" required></textarea></div>

        <div class="field"><label for="o-m">What it might mean</label>

          <p class="hint" id="o-m-hint">Interpretation, in its own terms.</p>

          <textarea id="o-m" name="meaning" aria-describedby="o-m-hint"></textarea></div>

        <div class="field"><label for="o-n">What to change next time</label><textarea id="o-n" name="next"></textarea></div>

        <div class="field"><label for="o-photos">Photos <span class="muted">(optional — JPEG, PNG, WebP or GIF, kept on this laptop)</span></label><input id="o-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></div>

        <p id="o-err" class="notice" role="alert" hidden></p>

        <div class="actions"><button type="submit" class="primary">Save observation</button>

          <button type="button" data-action="go" data-href="${e ? '#/entry/' + e.id : '#/journal'}">Cancel</button></div>

      </form></div>`;

  }



  function viewCapture(q) {

    return `<div class="reading">

      <h1>Capture a thought</h1>

      <p class="hint">This becomes a Draft entry. You can add a title and category now or later.</p>

      <form class="stack" data-form="capture" novalidate>

        <div class="field"><label for="c-text">Note <span class="muted">(required)</span></label><textarea id="c-text" name="text"></textarea></div>

        <div class="row">

          <div class="field"><label for="c-title">Title <span class="muted">(optional)</span></label><input id="c-title" name="title" type="text" value="${esc(q.get('title') || '')}"></div>

          <div class="field"><label for="c-cat">Category <span class="muted">(optional)</span></label><select id="c-cat" name="cat">${opts([['unsorted', 'Decide later']].concat(S.categories.filter((c) => !c.hideEmpty).map((c) => [c.id, c.name])), 'unsorted')}</select></div>

          <div class="field"><label for="c-by">Writing as</label><select id="c-by" name="by">${peopleOpts(S.writer)}</select></div>

        </div>

        <p id="c-err" class="notice" role="alert" hidden></p>

        <div class="actions"><button type="submit" class="primary">Save note</button><button type="button" data-action="go" data-href="#/">Cancel</button></div>

      </form></div>`;

  }



  function draftFor(e) {

    if (!S.drafts[e.id]) S.drafts[e.id] = Object.assign(contentOf(cur(e)), { base: cur(e).v, note: '' });

    return S.drafts[e.id];

  }



  function viewEdit(e) {

    const d = draftFor(e);

    const stale = d.base !== cur(e).v;

    const blocks = d.blocks.map((b, i) => `<fieldset class="block-edit" data-block="${i}">

      <legend>Section ${i + 1}</legend>

      <div class="row">

        <div class="field"><label for="b${i}-k">Passage label</label><select id="b${i}-k" name="kind">${opts(Object.keys(KINDS).map((k) => [k, KINDS[k]]), b.kind)}</select></div>

        <div class="field"><label for="b${i}-by">Credited to</label><input id="b${i}-by" name="by" type="text" value="${esc(b.by)}"></div>

      </div>

      <div class="field"><label for="b${i}-h">Heading</label><input id="b${i}-h" name="heading" type="text" value="${esc(b.heading)}"></div>

      <label><input type="checkbox" name="collapsible"${b.collapsible ? ' checked' : ''}> Expandable section (starts closed)</label>

      <div class="field"><label for="b${i}-t">Text</label><textarea id="b${i}-t" name="text" placeholder="${esc(b.hint || '')}" aria-describedby="b${i}-wc">${esc(b.text)}</textarea><p class="hint wc" id="b${i}-wc">${wordCount(b.text)}</p></div>

      <div class="actions" style="margin:0">

        <button type="button" data-action="block-up" data-i="${i}"${i === 0 ? ' disabled' : ''}>Move up</button>

        <button type="button" data-action="block-remove" data-i="${i}">Remove section</button>

      </div></fieldset>`).join('');

    return `<div class="reading">

      <p class="crumb"><a href="#/entry/${e.id}">${esc(cur(e).title)}</a></p>

      <div class="edit-head"><h1>Editing: ${esc(cur(e).title)}</h1><button type="button" data-action="focus-mode" aria-pressed="${document.body.classList.contains('focus')}">${document.body.classList.contains('focus') ? 'Leave focus mode' : 'Focus mode'}</button></div>

      ${e.type === 'sigil' ? `<p><a href="#/entry/${e.id}/sigil">Open the sigil workshop</a> to draw and give marks meaning. It shares this draft.</p>` : ''}

      <p class="hint">Edits stay in this draft until you save a version or propose them. Leaving this page keeps the draft. Use <code>[[Entry title]]</code> to link to another entry, or the link picker below.</p>

      ${stale ? `<div class="notice" role="note"><p>This draft started from version ${d.base}; the entry is now at version ${cur(e).v}. Saving will replace the current text with this draft.</p></div>` : ''}

      <form class="stack" data-form="edit" data-id="${e.id}" novalidate>

        <div class="field"><label for="e-title">Title</label><input id="e-title" name="title" type="text" value="${esc(d.title)}" aria-describedby="e-title-dup"><p class="hint" id="e-title-dup" aria-live="polite">${esc(dupTitle(d.title, e.id))}</p></div>

        <div class="field"><label for="e-sum">Short summary</label><textarea id="e-sum" name="summary">${esc(d.summary)}</textarea></div>

        <div class="row">

          <div class="field"><label for="e-ed">Editorial state</label><select id="e-ed" name="editorial">${opts(['Draft', 'Finished'], d.editorial)}</select></div>

          <div class="field" style="flex:1 1 14rem"><label for="e-tags">Tags <span class="muted">(comma-separated)</span></label><input id="e-tags" name="tags" type="text" list="e-tag-list" value="${esc((d.tags || []).join(', '))}" placeholder="e.g. moon, oak, protection"><datalist id="e-tag-list">${allTags().map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>

          <div class="field"><span class="lbl">Experimental</span><label><input type="checkbox" name="experimental"${d.experimental ? ' checked' : ''}> This entry tests a hypothesis</label></div>

        </div>

        ${blocks}

        <div><button type="button" data-action="block-add">Add section</button></div>

        <div class="row">

          <div class="field" style="flex:1 1 14rem"><label for="e-link">Link to another entry</label><input id="e-link" type="text" list="e-link-list" placeholder="Start typing a title"></div>

          <div class="field"><span class="lbl">&nbsp;</span><button type="button" data-action="insert-link">Insert into the section I was writing</button></div>

        </div>

        <div class="row">

          <div class="field" style="flex:1 1 14rem"><label for="e-photo">Add a photo to the section I was writing</label><input id="e-photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></div>

          <div class="field" style="flex:1 1 12rem"><label for="e-photo-cap">Caption <span class="muted">(optional)</span></label><input id="e-photo-cap" type="text"></div>

          <datalist id="e-link-list">${S.entries.filter((x) => x.id !== e.id).map((x) => `<option value="${esc(cur(x).title)}">`).join('')}</datalist>

        </div>

        <div class="row">

          <div class="field" style="flex:1 1 16rem"><label for="e-note">Revision note <span class="muted">(optional)</span></label><input id="e-note" name="note" type="text" value="${esc(d.note)}" placeholder="What changed and why"></div>

          <div class="field"><label for="e-by">Writing as</label><select id="e-by" name="writer">${peopleOpts(S.writer)}</select></div>

        </div>

        <p id="e-err" class="notice" role="alert" hidden></p>

        <div class="actions">

          <button type="submit" class="primary" name="mode" value="save">Save version</button>

          <button type="submit" name="mode" value="propose">Propose for review</button>

          <button type="button" data-action="cancel-edit" data-id="${e.id}">Cancel</button>

        </div>

        <p class="hint">"Propose for review" records a suggestion without changing the entry. "Cancel" discards this draft.</p>

      </form></div>`;

  }



  function viewCompare(e, a, b) {

    const va = ver(e, a), vb = ver(e, b);

    if (!va || !vb) return `<div class="reading"><h1>Version not found</h1><p><a href="#/entry/${e.id}">Back to the entry</a></p></div>`;

    const blockText = (x) => x ? `[${KINDS[x.kind] || x.kind} · ${x.by}]\n${x.heading ? x.heading + '\n' : ''}\n${x.text}` : '';

    const row = (label, x, y) => `<h2>${label}${x === y ? ' <span class="muted">· unchanged</span>' : ' <span class="changed">· changed</span>'}</h2>

      ${x === y ? '' : `<div class="compare"><div><h3>Version ${a}</h3>${x ? prose(x) : '<p class="muted">(empty)</p>'}</div><div><h3>Version ${b}</h3>${y ? prose(y) : '<p class="muted">(empty)</p>'}</div></div>`}`;

    const n = Math.max(va.blocks.length, vb.blocks.length);

    let sections = '';

    for (let i = 0; i < n; i++) sections += row(`Section ${i + 1}`, blockText(va.blocks[i]), blockText(vb.blocks[i]));

    const marks = (x) => x.sigil ? x.sigil.marks.map((m, i) => `${i + 1}. ${m.meaning || '(no meaning)'} — ${MARK_STATUS[m.status]}`).join('\n') : '';

    return `<div class="reading wide">

      <p class="crumb"><a href="#/entry/${e.id}">${esc(cur(e).title)}</a></p>

      <h1>Version ${a} and version ${b}</h1>

      <p class="attrib">Version ${a}: ${esc(va.editor)}, ${fmtDate(va.date)}${va.note ? ' — ' + esc(va.note) : ''}<br>Version ${b}: ${esc(vb.editor)}, ${fmtDate(vb.date)}${vb.note ? ' — ' + esc(vb.note) : ''}</p>

      ${row('Title', va.title, vb.title)}${row('Summary', va.summary, vb.summary)}

      ${row('Status', `${va.editorial}${va.experimental ? ', Experimental' : ''}`, `${vb.editorial}${vb.experimental ? ', Experimental' : ''}`)}

      ${sections}${va.sigil || vb.sigil ? row('Sigil marks', marks(va), marks(vb)) : ''}

      <p><a href="#/entry/${e.id}/v/${a}">Read version ${a}</a> · <a href="#/entry/${e.id}/v/${b}">Read version ${b}</a></p>

    </div>`;

  }



  function viewReview(e, pid) {

    const p = e.pending.find((x) => x.pid === pid);

    if (!p) return `<div class="reading"><h1>Suggestion not found</h1><p><a href="#/entry/${e.id}">Back to the entry</a></p></div>`;

    const c = cur(e);

    const pr = p.content;

    const row = (label, a, b) => `<h2>${label}${a === b ? '' : ' <span class="changed">· changed</span>'}</h2>

      <div class="compare"><div><h3>Current (version ${c.v})</h3>${a ? prose(a) : '<p class="muted">(empty)</p>'}</div><div><h3>Proposed</h3>${b ? prose(b) : '<p class="muted">(empty)</p>'}</div></div>`;

    const blockText = (b) => b ? `[${KINDS[b.kind] || b.kind} · ${b.by}]\n${b.heading ? b.heading + '\n' : ''}\n${b.text}` : '';

    const n = Math.max(c.blocks.length, pr.blocks.length);

    let sections = '';

    for (let i = 0; i < n; i++) sections += row(`Section ${i + 1}`, blockText(c.blocks[i]), blockText(pr.blocks[i]));

    const decided = p.status !== 'open';

    return `<div class="reading">

      <p class="crumb"><a href="#/entry/${e.id}">${esc(c.title)}</a></p>

      <h1>Suggestion from ${esc(p.by)}</h1>

      <p class="attrib">Proposed ${fmtDate(p.date)}, based on version ${p.baseV}${p.note ? ` — “${esc(p.note)}”` : ''}. Status: <strong>${esc(p.status === 'open' ? 'awaiting review' : p.status + (p.decidedBy ? ' by ' + p.decidedBy : ''))}</strong>.</p>

      ${p.baseV !== c.v && !decided ? `<div class="notice" role="note"><p>The entry has changed since this suggestion was made (version ${p.baseV} → ${c.v}). Accepting it replaces the current text.</p></div>` : ''}

      ${row('Title', c.title, pr.title)}

      ${row('Summary', c.summary, pr.summary)}

      ${row('Status', `${c.editorial}${c.experimental ? ', Experimental' : ''}`, `${pr.editorial}${pr.experimental ? ', Experimental' : ''}`)}

      ${sections}

      ${decided ? '' : `<form class="stack" data-form="review" data-id="${e.id}" data-pid="${p.pid}">

        <div class="field"><label for="r-by">Deciding as</label><select id="r-by" name="writer">${peopleOpts(S.writer)}</select></div>

        <div class="actions"><button type="submit" class="primary" name="mode" value="accept">Accept as new version</button>

        <button type="submit" name="mode" value="decline">Decline (keep as an alternative)</button>

        <button type="button" data-action="go" data-href="#/entry/${e.id}">Decide later</button></div></form>`}

    </div>`;

  }



  function viewSearch(query, scope) {

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    if (!terms.length) return '<div class="reading"><h1>Search</h1><p>Type something in the search box above.</p></div>';

    const hl = (s) => { let out = esc(s); terms.forEach((t) => { out = out.replace(new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); }); return out; };

    const snip = (text) => {

      const low = text.toLowerCase(); const i = Math.min(...terms.map((t) => { const k = low.indexOf(t); return k < 0 ? Infinity : k; }));

      if (!isFinite(i)) return '';

      const s = Math.max(0, i - 70); return (s ? '…' : '') + hl(text.slice(s, i + 130).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a)) + '…';

    };

    const results = [];

    S.entries.forEach((e) => {

      const v = cur(e);

      const fields = [v.title, v.summary, cat(e.category).name, v.editor, TYPES[e.type] || '', (v.tags || []).join(' ')].concat(v.blocks.map((b) => `${b.heading} ${b.text} ${b.by}`), v.sigil ? v.sigil.marks.map((m) => `${m.meaning} ${m.root}`) : []);

      const hay = fields.join(' \n ').toLowerCase();

      if (terms.every((t) => hay.includes(t))) {

        const score = terms.reduce((s, t) => s + (v.title.toLowerCase().includes(t) ? 5 : 0) + (String(v.summary || '').toLowerCase().includes(t) ? 2 : 0) + 1, 0);

        const body = v.blocks.map((b) => b.text).join(' ');

        results.push({ score, html: `<li class="card"><h3><a href="#/entry/${e.id}">${hl(v.title)}</a></h3><p>${hl(v.summary)}</p>${snip(body) ? `<p class="muted">${snip(body)}</p>` : ''}<p class="muted">Entry · ${esc(cat(e.category).name)}</p></li>` });

      }

    });

    S.journal.forEach((o) => {

      const text = `${o.happened}\n${o.meaning}\n${o.next}`;

      if (terms.every((t) => (text + ' ' + o.by).toLowerCase().includes(t))) {

        const e = entry(o.entryId);

        results.push({ score: 0, html: `<li class="card"><h3><a href="#/entry/${o.entryId}/v/${o.v}?obs=${o.id}">Observation, ${fmtDate(o.date)}</a></h3><p class="muted">${snip(text)}</p><p class="muted">Journal · ${esc(o.by)} · ${e ? esc(cur(e).title) : ''} version ${o.v}</p></li>` });

      }

    });

    S.correspondences.forEach((c) => {

      const text = `${c.item} — ${c.association} (${c.tradition}) ${c.source} ${c.note || ''}`;

      if (terms.every((t) => text.toLowerCase().includes(t))) {

        results.push({ score: 1, html: `<li class="card"><h3><a href="#/correspondences?q=${encodeURIComponent(c.item)}">${hl(c.item)} — ${hl(c.association)}</a></h3><p class="muted">Correspondence · ${hl(c.tradition || 'no tradition named')} · ${esc(Model.CERTAINTY[c.certainty])}${c.retired ? ' · retired' : ''}</p></li>` });

      }

    });

    results.sort((a, b) => b.score - a.score);

    results.forEach((r) => { r.kind = /<p class="muted">Correspondence ·/.test(r.html) ? 'corr' : /Journal ·/.test(r.html) ? 'journal' : 'entries'; });

    const shown = results.filter((r) => !scope || r.kind === scope);

    const count = (k) => results.filter((r) => !k || r.kind === k).length;

    const tab = (k, label) => `<a href="#/search?q=${encodeURIComponent(query)}${k ? '&in=' + k : ''}"${(scope || '') === k ? ' aria-current="true" class="chip chip-on"' : ' class="chip"'}>${label} (${count(k)})</a>`;

    return `<div class="reading"><h1>Search: “${esc(query)}”</h1>

      <nav class="chips" aria-label="Narrow results">${tab('', 'Everything')}${tab('entries', 'Entries')}${tab('journal', 'Journal')}${tab('corr', 'Correspondences')}</nav>

      <p class="muted" aria-live="polite">${shown.length} result${shown.length === 1 ? '' : 's'}.</p>

      ${shown.length ? `<ul class="cards">${shown.map((r) => r.html).join('')}</ul>` : '<p>No matches. Try fewer words.</p>'}</div>`;

  }



  // ---------- correspondences (all traditions, every row sourced) ----------

  function corrForm(c) {

    const isNew = !c.id;

    const items = [...new Set(S.correspondences.map((x) => x.item))].sort();

    const trads = [...new Set(S.correspondences.map((x) => x.tradition).filter(Boolean))].sort();

    return `<form class="stack card" data-form="corr" data-id="${esc(c.id || '')}" novalidate aria-labelledby="corr-h">

      <h2 id="corr-h" style="margin-top:.2rem">${isNew ? 'Add a correspondence' : 'Edit correspondence'}</h2>

      <div class="row">

        <div class="field"><label for="cr-item">Item</label><input id="cr-item" name="item" type="text" list="cr-items" value="${esc(c.item || '')}" placeholder="e.g. Oak, Mercury, Tuesday"></div>

        <div class="field"><label for="cr-assoc">Association</label><input id="cr-assoc" name="association" type="text" value="${esc(c.association || '')}" placeholder="e.g. endurance"></div>

      </div>

      <div class="row">

        <div class="field"><label for="cr-trad">Tradition</label><input id="cr-trad" name="tradition" type="text" list="cr-trads" value="${esc(c.tradition || '')}" placeholder="e.g. Hermetic, folk, personal, Lattice"></div>

        <div class="field"><label for="cr-cert">How it's held</label><select id="cr-cert" name="certainty">${opts(Object.keys(Model.CERTAINTY).map((k) => [k, Model.CERTAINTY[k]]), c.certainty || 'personal')}</select></div>

      </div>

      <div class="field"><label for="cr-src">Source</label><input id="cr-src" name="source" type="text" value="${esc(c.source || '')}" placeholder="Book, teacher, conversation, your own practice"></div>

      <div class="field"><label for="cr-note">Why / notes</label><p class="hint" id="cr-note-hint">Natural associations, earlier-language roots, how it came about. Leave out what isn't known rather than guessing.</p><textarea id="cr-note" name="note" aria-describedby="cr-note-hint">${esc(c.note || '')}</textarea></div>

      <div class="field"><label for="cr-by">Writing as</label><select id="cr-by" name="writer">${peopleOpts(S.writer)}</select></div>

      <datalist id="cr-items">${items.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>

      <datalist id="cr-trads">${trads.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>

      <p id="cr-err" class="notice" role="alert" hidden></p>

      <div class="actions"><button type="submit" class="primary">${isNew ? 'Add' : 'Save changes'}</button><button type="button" data-action="corr-cancel">Cancel</button></div>

    </form>`;

  }



  function viewCorrespondences(q) {

    const term = (q.get('q') || '').trim().toLowerCase(), trad = q.get('t') || '', cert = q.get('c') || '', retired = q.get('r') === '1';

    if (q.get('add') === '1' && !S.corrEdit) S.corrEdit = 'new';

    const all = S.correspondences;

    const rows = all.filter((c) => (retired || !c.retired) && (!trad || c.tradition === trad) && (!cert || c.certainty === cert)

      && (!term || `${c.item} ${c.association} ${c.tradition} ${c.source} ${c.note || ''}`.toLowerCase().includes(term)));

    const groups = new Map();

    rows.forEach((c) => { const k = c.item.trim().toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });

    const keys = [...groups.keys()].sort();

    const trads = [...new Set(all.map((c) => c.tradition).filter(Boolean))].sort();

    const editing = S.corrEdit === 'new' ? {} : S.corrEdit ? all.find((c) => c.id === S.corrEdit) : null;

    const row = (c) => `<li class="corr-row${c.retired ? ' retired' : ''}">

      <p style="margin:0"><strong>${esc(c.association)}</strong> · ${esc(c.tradition || 'no tradition named')}${c.retired ? ' · <em>retired</em>' : ''}</p>

      <p class="muted" style="margin:.1rem 0">${esc(Model.CERTAINTY[c.certainty])} · ${c.source ? 'Source: ' + esc(c.source) : 'No source recorded'} · added by ${esc(c.addedBy || 'unknown')}${c.date ? ', ' + fmtDate(c.date) : ''}</p>

      ${c.note ? `<div class="prose small">${prose(c.note)}</div>` : ''}

      ${c.history && c.history.length ? `<details><summary>Earlier wording (${c.history.length})</summary><ul>${c.history.slice().reverse().map((h) => `<li>${esc(h.association)} · ${esc(h.tradition || '—')} · ${esc(Model.CERTAINTY[h.certainty] || h.certainty)} · ${esc(h.source || 'no source')}${h.note ? ' — ' + esc(h.note) : ''} <span class="muted">(replaced by ${esc(h.replacedBy)}, ${fmtDate(h.replacedOn)})</span></li>`).join('')}</ul></details>` : ''}

      <div class="actions" style="margin:.3rem 0 0"><button type="button" data-action="corr-edit" data-id="${esc(c.id)}">Edit</button>

        <button type="button" data-action="corr-retire" data-id="${esc(c.id)}">${c.retired ? 'Restore' : 'Retire'}</button></div></li>`;

    return `<div class="reading">

      <p class="crumb"><a href="#/library">Library</a></p>

      <h1>Correspondences</h1>

      <p class="lead">Associations from every tradition you draw on. Each row keeps its own source and how firmly it's held; when traditions differ, both stay.</p>

      ${editing ? corrForm(editing) : '<div class="actions"><button type="button" class="primary" data-action="corr-new">Add a correspondence</button></div>'}

      <form class="filters" data-form="corrfilter" role="search" aria-label="Filter correspondences">

        <div class="field"><label for="cf-q">Find</label><input id="cf-q" name="q" type="search" value="${esc(q.get('q') || '')}"></div>

        <div class="field"><label for="cf-t">Tradition</label><select id="cf-t" name="t">${opts([['', 'All traditions']].concat(trads), trad)}</select></div>

        <div class="field"><label for="cf-c">How it's held</label><select id="cf-c" name="c">${opts([['', 'Any']].concat(Object.keys(Model.CERTAINTY).map((k) => [k, Model.CERTAINTY[k]])), cert)}</select></div>

        <div class="field"><span class="lbl">Retired</span><label><input type="checkbox" name="r"${retired ? ' checked' : ''}> Show retired</label></div>

        <div class="field"><span class="lbl">&nbsp;</span><button type="submit">Apply</button></div>

      </form>

      <p class="muted" aria-live="polite">${rows.length} of ${all.length} correspondence${all.length === 1 ? '' : 's'} shown.</p>

      ${!all.length ? '<p>None recorded yet. Nothing here is pre-filled or generated: every row is one someone added, with its source.</p>' : ''}

      ${keys.map((k) => {

        const list = groups.get(k);

        const nTrad = new Set(list.map((c) => (c.tradition || '').toLowerCase())).size;

        const nAssoc = new Set(list.map((c) => c.association.trim().toLowerCase())).size;

        return `<section class="card corr-group"><h2 style="margin-top:.2rem">${esc(list[0].item)}</h2>

          ${nAssoc > 1 && nTrad > 1 ? `<p class="hint">${nTrad} traditions, ${nAssoc} different associations — kept side by side, not reconciled.</p>` : ''}

          <ul class="corr-list">${list.map(row).join('')}</ul></section>`;

      }).join('')}

    </div>`;

  }



  // ---------- authoring: templates, sigil workshop, AI help ----------

  const allTemplates = () => TEMPLATES.concat(S.templates);

  function viewCreate(q) {

    const from = q && q.get('from') && entry(q.get('from'));

    const saveForm = from ? `<form class="stack card" data-form="tpl" data-id="${from.id}" novalidate aria-labelledby="tpl-h">

        <h2 id="tpl-h" style="margin-top:.2rem">Save the sections of “${esc(cur(from).title)}” as a template</h2>

        <p class="hint">Only the structure is saved — section headings, passage labels and prompts — not the text.</p>

        <p class="muted">Sections: ${cur(from).blocks.map((b) => esc(b.heading || 'untitled section')).join(', ')}</p>

        <div class="field"><label for="tpl-name">Template name</label><input id="tpl-name" name="name" type="text" value="${esc(cur(from).title)}"></div>

        <p id="tpl-err" class="notice" role="alert" hidden></p>

        <div class="actions"><button type="submit" class="primary">Save template</button><button type="button" data-action="go" data-href="#/entry/${from.id}">Cancel</button></div></form>` : '';

    return `<div class="reading">

      <h1>Create</h1>

      <p class="lead">Start from a template. It becomes a normal Draft entry, with versions, suggestions and a journal. Every section stays free text.</p>

      ${saveForm}

      <ul class="cards">${allTemplates().map((t) => `<li class="card"><h3>${esc(t.name)}${t.custom ? ' <span class="chip">Your template</span>' : ''}</h3><p>${esc(t.about)}</p>

        <p class="muted">Sections: ${t.blocks.map((b) => esc(b[0] || 'one untitled section')).join(', ')}</p>

        <div class="actions" style="margin:.5rem 0 0"><button type="button" data-action="new-from" data-t="${esc(t.id)}">New from “${esc(t.name)}”</button>${t.custom ? `<button type="button" data-action="tpl-remove" data-t="${esc(t.id)}">Remove template</button>` : ''}</div></li>`).join('')}

        <li class="card"><h3>Correspondence</h3><p>Record an association — item, association, tradition, source and how certain it is. Every tradition is welcome; differing ones sit side by side.</p>

          <div class="actions" style="margin:.5rem 0 0"><button type="button" data-action="go" data-href="#/correspondences?add=1">Add a correspondence</button></div></li>

        ${S.templates.length ? '' : '<li class="card"><h3>Your own templates</h3><p>Open any entry and choose <strong>Save sections as a template</strong> to reuse its structure here.</p></li>'}

      </ul></div>`;

  }



  function newFromTemplate(tid) {

    const t = allTemplates().find((x) => x.id === tid);

    const id = uid(t.type);

    const v1 = { v: 1, editor: S.writer, date: today(), note: `Started from the ${t.name} template`, title: t.title, summary: '', editorial: 'Draft', experimental: !!t.experimental,

      blocks: t.blocks.map(([heading, kind, hint]) => ({ kind, by: S.writer, heading, text: '', hint })) };

    if (t.type === 'sigil') v1.sigil = { marks: [] };

    S.entries.push({ id, type: t.type, touched: Date.now(), category: t.category, sources: [], sourceNote: '', related: [], pending: [], versions: [v1] });

    S.undo.push({ type: 'capture', entryId: id, label: `new ${t.name.toLowerCase()}` });

    toast(`New ${t.name.toLowerCase()} created as a Draft.`, true);

    location.hash = `#/entry/${id}/${t.type === 'sigil' ? 'sigil' : 'edit'}`;

  }



  const GUIDE = '<g class="guide" aria-hidden="true"><circle cx="100" cy="100" r="80"/><path d="M100 15 V185 M15 100 H185"/></g>';

  const markTransform = Model.markTransform;   // numbers only

  const newMark = (d) => ({ d, tx: 0, ty: 0, s: 1, status: 'exploratory', meaning: '', root: '' });

  function sigilPaths(sg, sel) {

    return sg.marks.map((m, i) => `<path d="${esc(m.d)}" transform="${markTransform(m)}" vector-effect="non-scaling-stroke" class="mark st-${esc(m.status)}${sel === i ? ' sel' : ''}"><title>Mark ${i + 1}: ${esc(MARK_STATUS[m.status])}${m.meaning ? ' — ' + esc(m.meaning) : ''}</title></path>`).join('');

  }

  function readingHtml(sg) {

    if (!sg.marks.length) return '<p class="muted">No marks yet.</p>';

    const missing = sg.marks.filter((m) => !m.meaning.trim()).length;

    const why = (m) => {

      const bits = [];

      if (m.natural) bits.push(`Natural association: ${esc(m.natural)}`);

      bits.push(`Earlier language or form: ${m.origin ? esc(m.origin) : 'unknown (not recorded)'}`);

      if (m.why) bits.push(`Reason chosen: ${esc(m.why)}`);

      if (m.source) bits.push(`Source: ${esc(m.source)}`);

      return `<br><span class="muted why-line">${bits.join(' · ')}</span>`;

    };

    return `<ol class="reading-list">${sg.marks.map((m) => `<li>${m.meaning.trim() ? esc(m.meaning) : '<em>no meaning stated</em>'}${m.root ? ` <span class="muted">(${esc(m.root)})</span>` : ''} <span class="muted">· ${esc(MARK_STATUS[m.status])}</span>${why(m)}</li>`).join('')}</ol>

      ${missing ? `<p class="hint">${missing} mark${missing > 1 ? 's have' : ' has'} no stated meaning. Readable-meaning rule (Claude's reading of the notes, not yet confirmed by Author): every mark should carry a stated meaning.</p>` : ''}

      ${sg.marks.some((m) => m.status === 'approved') ? '' : '<p class="hint">No approved glyphs: every mark here is exploratory or proposed.</p>'}`;

  }

  function sigilFigure(e, v) {

    const sg = v.sigil || { marks: [] };

    return `<figure class="sigil-fig">

      <svg viewBox="0 0 200 200" role="img" aria-label="Sigil ${esc(v.title)}, ${sg.marks.length} mark${sg.marks.length === 1 ? '' : 's'}">${GUIDE}${sigilPaths(sg, -1)}</svg>

      <figcaption><h2>Reading</h2>${readingHtml(sg)}

      ${sg.marks.length && v === cur(e) ? `<div class="actions"><button type="button" data-action="export-svg" data-id="${e.id}">Export SVG</button></div>` : ''}</figcaption></figure>`;

  }



  function viewSigilWorkshop(e) {

    const d = draftFor(e);

    if (!d.sigil) d.sigil = { marks: [] };

    const sg = d.sigil;

    const sel = S.sel && S.sel.id === e.id ? S.sel.i : -1;

    const isAuthor = S.writer === 'Author';

    const mv = (dx, dy, lab, sym) => `<button type="button" data-action="mark-move" data-dx="${dx}" data-dy="${dy}" aria-label="Move ${lab}">${sym}</button>`;

    return `<div class="reading wide">

      <p class="crumb"><a href="#/entry/${e.id}">${esc(cur(e).title)}</a></p>

      <h1>Sigil workshop</h1>

      <p class="hint">State the meaning first, then draw with a mouse, pen or finger, or add shapes with the buttons. Give every mark a meaning. Exploratory marks are dashed. This draft is shared with the text editor: <a href="#/entry/${e.id}/edit">edit the title and sections</a>.</p>

      <div class="notice" role="note"><p><strong>Example symbols status:</strong> the roots offered come from the April master only. The p/b/w and thar/thal conflicts are unresolved, and no glyph shapes are approved (the September plates are "V3 draft proposed").</p></div>

      <div class="field meaning-first"><label for="s-meaning">1. Meaning — state it first</label>

        <p class="hint" id="s-meaning-hint">The sentence or Example symbols roots this sigil should be readable as. Saved as the "Statement of intent" section.</p>

        <textarea id="s-meaning" aria-describedby="s-meaning-hint">${esc((d.blocks.find((b) => b.heading === 'Statement of intent') || { text: '' }).text)}</textarea></div>

      <h2>2. Marks</h2>

      <div class="workshop">

        <div>

          <svg id="canvas" viewBox="0 0 200 200" role="img" aria-label="Sigil canvas with ${sg.marks.length} mark${sg.marks.length === 1 ? '' : 's'}. Draw with a pointer, or use the shape buttons." data-id="${e.id}">${GUIDE}${sigilPaths(sg, sel)}</svg>

          <div class="toolbar" role="group" aria-label="Add a shape">${Object.keys(SHAPES).map((k) => `<button type="button" data-action="mark-add" data-shape="${esc(k)}">${esc(k)}</button>`).join('')}</div>

          <div class="toolbar" role="group" aria-label="Adjust the selected mark">${sel >= 0 && sg.marks[sel]

            ? `<span class="muted">Mark ${sel + 1}:</span>${mv(-5, 0, 'left', '←')}${mv(0, -5, 'up', '↑')}${mv(0, 5, 'down', '↓')}${mv(5, 0, 'right', '→')}

               <button type="button" data-action="mark-scale" data-f="1.15">Larger</button><button type="button" data-action="mark-scale" data-f="0.87">Smaller</button>`

            : '<span class="muted">Select a mark to move or resize it.</span>'}</div>

        </div>

        <div>

          <h2 style="margin-top:0">Marks and meaning</h2>

          ${sg.marks.length ? `<ol class="mark-list">${sg.marks.map((m, i) => `<li class="mark-row${i === sel ? ' sel' : ''}">

            <div class="row"><button type="button" data-action="mark-select" data-i="${i}" aria-pressed="${i === sel}">Mark ${i + 1}${i === sel ? ' (selected)' : ''}</button>

              <button type="button" data-action="mark-remove" data-i="${i}">Remove</button></div>

            <div class="field"><label for="m${i}-meaning">Meaning</label><input id="m${i}-meaning" type="text" data-mark-field="meaning" data-i="${i}" value="${esc(m.meaning)}"></div>

            <div class="row">

              <div class="field"><label for="m${i}-root">Example symbols root</label><select id="m${i}-root" data-mark-field="root" data-i="${i}">${opts(ROOTS, m.root)}</select></div>

              <div class="field"><label for="m${i}-st">Status</label><select id="m${i}-st" data-mark-field="status" data-i="${i}">${Object.keys(MARK_STATUS).map((k) => `<option value="${k}"${k === m.status ? ' selected' : ''}${k === 'approved' && !isAuthor && m.status !== 'approved' ? ' disabled' : ''}>${esc(MARK_STATUS[k])}</option>`).join('')}</select></div>

            </div>

            <details class="why"${m.natural || m.origin || m.why || m.source ? ' open' : ''}><summary>Why this mark</summary>

              <div class="field"><label for="m${i}-natural">Natural association</label><input id="m${i}-natural" type="text" data-mark-field="natural" data-i="${i}" value="${esc(m.natural || '')}" placeholder="e.g. a branch, a river's bend, the mouth shape of the sound"></div>

              <div class="field"><label for="m${i}-origin">Earlier language or earlier form</label><input id="m${i}-origin" type="text" data-mark-field="origin" data-i="${i}" value="${esc(m.origin || '')}" placeholder="Leave blank if unknown — it will say so"></div>

              <div class="field"><label for="m${i}-why">Reason chosen</label><input id="m${i}-why" type="text" data-mark-field="why" data-i="${i}" value="${esc(m.why || '')}"></div>

              <div class="field"><label for="m${i}-src">Source</label><input id="m${i}-src" type="text" data-mark-field="source" data-i="${i}" value="${esc(m.source || '')}" placeholder="Who or what this came from"></div>

            </details></li>`).join('')}</ol>` : '<p class="muted">No marks yet.</p>'}

          <h2>Reading</h2><div id="reading">${readingHtml(sg)}</div>

        </div>

      </div>

      <form class="stack" data-form="sigil" data-id="${e.id}" novalidate>

        <div class="row">

          <div class="field" style="flex:1 1 16rem"><label for="s-note">Revision note <span class="muted">(optional)</span></label><input id="s-note" name="note" type="text" value="${esc(d.note)}"></div>

          <div class="field"><label for="s-by">Writing as</label><select id="s-by" name="writer">${peopleOpts(S.writer)}</select></div>

        </div>

        <p id="s-err" class="notice" role="alert" hidden></p>

        <div class="actions">

          <button type="submit" class="primary" value="save">Save version</button>

          <button type="submit" value="propose">Propose for review</button>

          <button type="button" data-action="export-svg" data-id="${e.id}" data-draft="1">Export SVG of this draft</button>

          <button type="button" data-action="cancel-edit" data-id="${e.id}">Cancel</button>

        </div>

        <p class="hint">"Approved glyph" can only be chosen while writing as Author. It is still an attribution label, not a verified approval.</p>

      </form></div>`;

  }



  function markAction(a, b) {

    const e = entry(parse().parts[1]);

    if (!e) return;

    const sg = draftFor(e).sigil || (draftFor(e).sigil = { marks: [] });

    const cur_ = S.sel && S.sel.id === e.id ? S.sel.i : -1;

    const i = b.dataset.i != null ? parseInt(b.dataset.i, 10) : cur_;

    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

    if (a === 'mark-add') { sg.marks.push(newMark(SHAPES[b.dataset.shape])); S.sel = { id: e.id, i: sg.marks.length - 1 }; }

    else if (a === 'mark-select') S.sel = { id: e.id, i: cur_ === i ? -1 : i };

    else if (a === 'mark-remove') { sg.marks.splice(i, 1); S.sel = { id: e.id, i: -1 }; }

    else if (a === 'mark-move' && sg.marks[i]) { const m = sg.marks[i]; m.tx = clamp((m.tx || 0) + Number(b.dataset.dx), -100, 100); m.ty = clamp((m.ty || 0) + Number(b.dataset.dy), -100, 100); }

    else if (a === 'mark-scale' && sg.marks[i]) { const m = sg.marks[i]; m.s = Math.round(clamp((m.s || 1) * Number(b.dataset.f), 0.2, 3) * 100) / 100; }

    const selector = Object.keys(b.dataset).map((k) => `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${b.dataset[k]}"]`).join('');

    render(false);

    const again = (a === 'mark-select' || a === 'mark-remove') ? null : $(selector);

    (again || $(`[data-action="mark-select"][data-i="${S.sel.i}"]`) || $('[data-action="mark-add"]')).focus();

  }



  function refreshSigil() {

    const e = entry(parse().parts[1]);

    const sg = S.drafts[e.id].sigil;

    $('#canvas').innerHTML = GUIDE + sigilPaths(sg, S.sel && S.sel.id === e.id ? S.sel.i : -1);

    $('#reading').innerHTML = readingHtml(sg);

  }



  // Freehand drawing on the canvas.

  const SVGNS = 'http://www.w3.org/2000/svg';

  let drawing = null;

  const toSvg = (svg, ev) => { const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const r = pt.matrixTransform(svg.getScreenCTM().inverse()); return [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10]; };

  const pathOf = (pts) => 'M' + pts.map((p) => p.join(' ')).join(' L');

  document.addEventListener('pointerdown', (ev) => {

    const svg = ev.target.closest && ev.target.closest('#canvas');

    if (!svg || ev.button > 0) return;

    ev.preventDefault();

    svg.setPointerCapture(ev.pointerId);

    drawing = { svg, pts: [toSvg(svg, ev)], el: document.createElementNS(SVGNS, 'path') };

    drawing.el.setAttribute('class', 'mark st-exploratory sel');

    drawing.el.setAttribute('vector-effect', 'non-scaling-stroke');

    svg.appendChild(drawing.el);

  });

  document.addEventListener('pointermove', (ev) => {

    if (!drawing) return;

    const p = toSvg(drawing.svg, ev), last = drawing.pts[drawing.pts.length - 1];

    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return;

    drawing.pts.push(p);

    drawing.el.setAttribute('d', pathOf(drawing.pts));

  });

  const endDraw = () => {

    if (!drawing) return;

    const d = drawing; drawing = null;

    if (d.pts.length < 3) { d.el.remove(); return; }

    const e = entry(d.svg.dataset.id);

    const sg = draftFor(e).sigil || (draftFor(e).sigil = { marks: [] });

    sg.marks.push(newMark(pathOf(d.pts)));

    S.sel = { id: e.id, i: sg.marks.length - 1 };

    render(false);

  };

  document.addEventListener('pointerup', endDraw);

  document.addEventListener('pointercancel', endDraw);



  function slug(t) { return (t || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'; }

  function download(name, text, type) {

    const blob = new Blob(Array.isArray(text) ? text : [text], { type });

    // Inside the Grimoire phone app, in-page (blob:) downloads can't be handed to another app, so the

    // file goes to the app's "save as" dialog through its bridge instead.

    if (window.GrimoireApp && typeof window.GrimoireApp.saveFile === 'function') {

      const fr = new FileReader();

      fr.onload = () => { try { window.GrimoireApp.saveFile(name, type, String(fr.result).split(',')[1] || ''); } catch (e) { toast('The phone app could not save the file: ' + e.message); } };

      fr.readAsDataURL(blob);

      return;

    }

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url; a.download = name;

    document.body.appendChild(a); a.click(); a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

  }

  // src: an entry version or an unsaved draft. The Statement of intent travels in the SVG's desc and metadata.

  function exportSvg(src) {

    const svg = Model.buildSvg({ title: src.title, sigil: src.sigil || { marks: [] }, intent: Model.statementOf(src), date: today(), by: S.writer });

    download(slug(src.title) + '.svg', svg, 'image/svg+xml');

    toast('SVG exported as a download, with the statement of intent.');

  }



  function aiPrompt(e, ask) {

    const v = cur(e);

    const task = {

      missing: 'Draft text for the sections marked "(empty)". Keep each one short.',

      variations: 'Suggest two or three variations worth keeping alongside the current version.',

      safety: 'Review the practical, physical safety of this practice: fire and smoke, blades, plant or oil toxicity, skin contact, ingestion, allergies, permission to use the site, consent of anyone involved. Do not discuss spiritual danger.',

      meanings: 'Suggest a meaning for each sigil mark that has none, consistent with the statement of intent.',

      wording: 'Suggest clearer wording without changing the meaning.'

    }[ask];

    const sections = v.blocks.map((b) => `## ${b.heading || '(untitled section)'} [${KINDS[b.kind] || b.kind} · ${b.by}]\n${b.text.trim() || '(empty)'}`).join('\n\n');

    const marks = v.sigil ? '\n\nSigil marks:\n' + (v.sigil.marks.map((m, i) => `${i + 1}. ${m.meaning || '(no meaning)'}${m.root ? ' [' + m.root + ']' : ''}, ${MARK_STATUS[m.status]}`).join('\n') || '(none yet)') : '';

    return `I'm working on an entry in my grimoire and would like help.\n\nTask: ${task}\n\nGround rules: write your answer as a proposal for me to review. Don't present anything as my decision or as settled. Don't claim any supernatural mechanism is established. For Example symbols, use only the roots already listed and don't invent approved glyphs. Say where you're unsure.\n\nEntry: ${v.title} (${TYPES[e.type || 'article']}, ${v.editorial}${v.experimental ? ', experimental' : ''})\n${v.summary ? 'Summary: ' + v.summary + '\n' : ''}\n${sections}${marks}`;

  }

  function aiPanel(e) {

    const ask = S.aiAsk || 'missing';

    return `<details class="meta"><summary>AI help — not connected</summary><div>

      <p><strong>No AI service is connected to the app.</strong> Copy a request, paste it into Claude or another assistant yourself, then paste the reply below. It becomes a suggestion credited to that assistant and changes nothing until someone accepts it.</p>

      <p class="hint">Claude working on this laptop (in a Claude Code session) can also add suggestions directly with <code>tools/grimoire.mjs</code> — they appear here for review in the same way. See ASSISTANT-ACCESS.md.</p>

      <form class="stack" data-form="ai" data-id="${e.id}" novalidate>

        <div class="field"><label for="ai-ask">What kind of help?</label><select id="ai-ask" name="ask" data-change="ai-ask">${opts(AI_ASKS, ask)}</select></div>

        <div class="field"><label for="ai-prompt">Request to copy</label><textarea id="ai-prompt" readonly>${esc(aiPrompt(e, ask))}</textarea></div>

        <div><button type="button" data-action="ai-copy">Copy request</button></div>

        <div class="field"><label for="ai-reply">Paste the reply</label><textarea id="ai-reply" name="reply"></textarea></div>

        <div class="row">

          <div class="field"><label for="ai-src">Reply came from</label><select id="ai-src" name="src">${opts(['Claude', 'Zephyr', 'Kimi', 'DeepSeek', 'Other assistant'], 'Claude')}</select></div>

          <div class="field"><label for="ai-by">Pasted by</label><select id="ai-by" name="by">${peopleOpts(S.writer)}</select></div>

        </div>

        <p id="ai-err" class="notice" role="alert" hidden></p>

        <div><button type="submit">Record as suggestion</button></div>

        <p class="hint">An AI reply always arrives as a Proposal. It can't write decisions, approve glyphs, mark an entry Finished or record observations.</p>

      </form></div></details>`;

  }

  function copyText(t) {

    const manual = () => { t.focus(); t.select(); toast('The request is selected. Press Ctrl+C to copy it.'); };

    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t.value).then(() => toast('Request copied. Paste it into your assistant.'), manual);

    else manual();

  }



  // ---------- form handling ----------

  function readEdit(form) {

    const id = form.dataset.id;

    const d = S.drafts[id];

    d.title = form.elements.title.value;

    d.summary = form.summary.value;

    d.editorial = form.editorial.value;

    d.experimental = form.experimental.checked;

    d.note = form.note.value;

    const tg = parseTags(form.elements.namedItem('tags').value);

    if (tg.length) d.tags = tg; else delete d.tags;

    S.writer = form.writer.value;

    const prev = d.blocks;

    d.blocks = Array.from(form.querySelectorAll('[data-block]')).map((fs) => Object.assign({

      kind: fs.querySelector('[name=kind]').value,

      by: fs.querySelector('[name=by]').value.trim() || S.writer,

      heading: fs.querySelector('[name=heading]').value,

      text: fs.querySelector('[name=text]').value

    }, fs.querySelector('[name=collapsible]').checked ? { collapsible: true } : {}, (prev[+fs.dataset.block] || {}).hint ? { hint: prev[+fs.dataset.block].hint } : {}));

    return d;

  }

  function showErr(id, msg) { const el = $('#' + id); el.textContent = msg; el.hidden = false; el.setAttribute('tabindex', '-1'); el.focus(); }



  document.addEventListener('submit', (ev) => {

    const form = ev.target;

    const kind = form.dataset.form;

    if (!kind) return;

    ev.preventDefault();

    const mode = ev.submitter && ev.submitter.value;



    if (kind === 'search') { location.hash = '#/search?q=' + encodeURIComponent(form.q.value.trim()); return; }



    if (kind === 'edit' || kind === 'sigil') {

      const e = entry(form.dataset.id);

      const d = kind === 'edit' ? readEdit(form) : S.drafts[e.id];

      const errId = kind === 'edit' ? 'e-err' : 's-err';

      if (kind === 'sigil') { S.writer = form.writer.value; d.note = form.note.value; }

      if (!d.title.trim()) return showErr(errId, 'The entry needs a title.');

      const hasMarks = d.sigil && d.sigil.marks.length;

      if (!hasMarks && (!d.blocks.length || d.blocks.every((b) => !b.text.trim()))) return showErr(errId, 'Add at least one section with text' + (e.type === 'sigil' ? ', or draw a mark.' : '.'));

      const content = contentOf(d);

      content.title = content.title.trim();

      if (mode === 'propose') {

        const pid = uid('s');

        e.pending.push({ pid, by: S.writer, date: today(), baseV: d.base, note: d.note.trim(), content, status: 'open' });

        S.undo.push({ type: 'suggestion', entryId: e.id, pid, label: `suggestion on “${cur(e).title}”` });

        delete S.drafts[e.id];

        toast('Suggestion recorded. The entry is unchanged until someone accepts it.', true);

      } else {

        if (sameContent(content, cur(e))) return showErr(errId, 'Nothing has changed yet. Edit something, or press Cancel.');

        const beforeV = cur(e).v;

        e.touched = Date.now();

        e.versions.push(Object.assign(content, { v: beforeV + 1, editor: S.writer, date: today(), note: d.note.trim() }));

        S.undo.push({ type: 'revision', entryId: e.id, beforeV, label: `edit to “${content.title}”` });

        delete S.drafts[e.id];

        toast(`Saved as version ${beforeV + 1}.`, true);

      }

      location.hash = '#/entry/' + e.id;

      return;

    }



    if (kind === 'rel') {

      const e = entry(form.dataset.id);

      const r = { rel: form.elements.namedItem('rel').value, target: form.elements.namedItem('target').value, certainty: form.elements.namedItem('certainty').value, note: form.elements.namedItem('note').value.trim(), by: form.elements.namedItem('by').value, date: today() };

      if (!r.target) return showErr('rel-err', 'Choose the other entry.');

      if ((e.relations || []).some((x) => x.rel === r.rel && x.target === r.target)) return showErr('rel-err', 'That relation is already recorded.');

      if (r.rel === 'derived from' && r.certainty === 'known' && Model.derivationLoop(S.entries, e.id, r.target)) return showErr('rel-err', 'That would make a loop of known derivations (each entry derived from the other). Record it as likely or disputed instead, with a note.');

      S.writer = r.by;

      e.relations = (e.relations || []).concat([r]);

      S.undo.push({ type: 'rel', entryId: e.id, before: (e.relations.slice(0, -1)), label: `relation on “${cur(e).title}”` });

      S.relFor = null;

      toast('Relation added. It shows on both entries.', true);

      render(false);

      return;

    }



    if (kind === 'tpl') {

      const e = entry(form.dataset.id);

      const name = form.elements.namedItem('name').value.trim();

      if (!name) return showErr('tpl-err', 'Give the template a name.');

      const v = cur(e);

      const t = { id: uid('tpl'), name, type: e.type || 'article', category: e.category, title: `Untitled ${name.toLowerCase()}`, custom: true,

        about: `Your template, from the sections of “${v.title}” (saved by ${S.writer}, ${fmtDate(today())}).`, experimental: !!v.experimental,

        blocks: v.blocks.map((b) => [b.heading || '', b.kind, b.hint || '']) };

      S.templates.push(t);

      S.undo.push({ type: 'tpl', id: t.id, before: null, label: `template “${name}”` });

      toast('Template saved.', true);

      location.hash = '#/create';

      return;

    }



    if (kind === 'follow') {

      const text = form.elements.namedItem('text').value.trim();

      if (!text) return showErr('fu-err', 'Write the follow-up first.');

      S.writer = form.elements.namedItem('by').value;

      const o = S.journal.find((x) => x.id === form.dataset.id);

      o.followUps = (o.followUps || []).concat([{ date: today(), by: S.writer, text }]);

      S.undo.push({ type: 'follow', id: o.id, label: 'follow-up note' });

      S.followFor = null;

      toast('Follow-up added. The original observation is unchanged.', true);

      render(false);

      return;

    }



    if (kind === 'corrfilter') {

      const p = new URLSearchParams();

      ['q', 't', 'c'].forEach((k) => { if (form[k].value.trim()) p.set(k, form[k].value.trim()); });

      if (form.r.checked) p.set('r', '1');

      location.hash = '#/correspondences' + (p.toString() ? '?' + p : '');

      return;

    }



    if (kind === 'corr') {

      const val = (k) => form.elements.namedItem(k).value.trim();

      if (!val('item') || !val('association')) return showErr('cr-err', 'Give both the item and its association.');

      if (form.elements.certainty.value === 'sourced' && !val('source')) return showErr('cr-err', '"Documented in a named source" needs the source named.');

      S.writer = form.elements.writer.value;

      const fields = { item: val('item'), association: val('association'), tradition: val('tradition'), source: val('source'), certainty: form.elements.certainty.value, note: form.elements.note.value.trim() };

      const id = form.dataset.id;

      if (!id) {

        const c = Object.assign({ id: uid('c'), addedBy: S.writer, date: today(), history: [] }, fields);

        S.correspondences.push(c);

        S.undo.push({ type: 'corr', id: c.id, before: null, label: `correspondence “${c.item}”` });

        toast('Correspondence added.', true);

      } else {

        const c = S.correspondences.find((x) => x.id === id);

        const before = clone(c);

        const changed = Object.keys(fields).some((k) => (c[k] || '') !== fields[k]);

        if (changed) {

          const old = clone(c); delete old.history; delete old.id;

          c.history = (c.history || []).concat([Object.assign(old, { replacedBy: S.writer, replacedOn: today() })]);

          Object.assign(c, fields);

          S.undo.push({ type: 'corr', id, before, label: `edit to correspondence “${c.item}”` });

          toast('Saved. The earlier wording is kept with the row.', true);

        }

      }

      S.corrEdit = null;

      if (/[?&]add=1/.test(location.hash)) location.hash = '#/correspondences'; else render(false);

      return;

    }



    if (kind === 'ai') {

      const e = entry(form.dataset.id);

      const reply = form.reply.value.trim();

      if (!reply) return showErr('ai-err', 'Paste a reply first.');

      S.writer = form.by.value;

      const src = form.src.value;

      const askLabel = AI_ASKS.find((x) => x[0] === form.ask.value)[1].toLowerCase();

      const content = contentOf(cur(e));

      content.blocks.push({ kind: 'proposal', by: `${src} (AI, pasted by ${S.writer})`, heading: `AI suggestion: ${askLabel}`, text: reply });

      const pid = uid('s');

      e.pending.push({ pid, by: `${src} (AI)`, date: today(), baseV: cur(e).v, note: `Pasted AI reply (${askLabel}), not checked`, content, status: 'open' });

      S.undo.push({ type: 'suggestion', entryId: e.id, pid, label: `AI suggestion on “${cur(e).title}”` });

      toast(`Recorded as a suggestion from ${src}. The entry is unchanged until someone accepts it.`, true);

      render(false);

      return;

    }



    if (kind === 'review') {

      const e = entry(form.dataset.id);

      const p = e.pending.find((x) => x.pid === form.dataset.pid);

      S.writer = form.writer.value;

      if (mode === 'accept') {

        const beforeV = cur(e).v;

        e.touched = Date.now();

        e.versions.push(Object.assign(clone(p.content), { v: beforeV + 1, editor: p.by, acceptedBy: S.writer, date: today(), note: `Accepted suggestion${p.note ? ': ' + p.note : ''}` }));

        p.status = 'accepted'; p.decidedBy = S.writer;

        S.undo.push({ type: 'revision', entryId: e.id, beforeV, pid: p.pid, label: `accepting ${p.by}'s suggestion` });

        toast(`Accepted as version ${beforeV + 1}, credited to ${p.by}.`, true);

      } else {

        p.status = 'declined'; p.decidedBy = S.writer;

        S.undo.push({ type: 'decline', entryId: e.id, pid: p.pid, label: `declining ${p.by}'s suggestion` });

        toast('Declined. It stays under Details → Alternatives not adopted.', true);

      }

      location.hash = '#/entry/' + e.id;

      return;

    }



    if (kind === 'observe') {

      const happened = form.happened.value.trim();

      if (!happened) return showErr('o-err', 'Describe what happened before saving.');

      S.writer = form.by.value;

      const o = { id: uid('o'), entryId: form.entry.value, v: parseInt(form.v.value, 10), date: form.date.value || today(), by: S.writer, happened, meaning: form.meaning.value.trim(), next: form.next.value.trim() };

      const files = form.photos && form.photos.files ? Array.from(form.photos.files) : [];

      const finish = (photos) => {

        if (photos.length) o.photos = photos.map((id) => ({ id, caption: '' }));

        S.journal.push(o);

        S.undo.push({ type: 'observation', id: o.id, label: 'new observation' });

        toast(`Observation saved, linked to version ${o.v}${photos.length ? `, with ${photos.length} photo${photos.length > 1 ? 's' : ''}` : ''}.`, true);

        location.hash = '#/journal?entry=' + o.entryId;

      };

      if (!files.length) { finish([]); return; }

      if (S.store.mode !== 'saved') return showErr('o-err', 'Photos need the grimoire’s local server. Remove the photos, or start the grimoire with start-grimoire.cmd.');

      ev.submitter && (ev.submitter.disabled = true);

      Promise.all(files.map(uploadPhoto)).then(finish).catch((err) => { if (ev.submitter) ev.submitter.disabled = false; showErr('o-err', 'A photo could not be added: ' + err.message); });

      return;

    }



    if (kind === 'capture') {

      const text = form.text.value.trim();

      if (!text) return showErr('c-err', 'Write a note before saving.');

      S.writer = form.by.value;

      const title = form.elements.title.value.trim() || 'Note, ' + fmtDate(today());

      const id = uid('note');

      S.entries.push({ id, touched: Date.now(), category: form.cat.value, sources: [], sourceNote: '', related: [], pending: [],

        versions: [{ v: 1, editor: S.writer, date: today(), note: 'Captured', title, summary: '', editorial: 'Draft', experimental: false, blocks: [{ kind: 'note', by: S.writer, heading: '', text }] }] });

      S.undo.push({ type: 'capture', entryId: id, label: `capture “${title}”` });

      toast('Saved as a Draft entry.', true);

      location.hash = '#/entry/' + id;

    }

  });



  document.addEventListener('focusin', (ev) => { if (ev.target.matches && ev.target.matches('textarea[name="text"]')) S.lastText = ev.target.id; });

  document.addEventListener('input', (ev) => {

    const form = ev.target.closest('form[data-form="edit"]');

    if (form) readEdit(form);

    if (ev.target.id === 's-meaning') {

      const d = S.drafts[entry(parse().parts[1]).id];

      let st = d.blocks.find((b) => b.heading === 'Statement of intent');

      if (!st) { st = { kind: 'note', by: S.writer, heading: 'Statement of intent', text: '' }; d.blocks.unshift(st); }

      st.text = ev.target.value;

    }

    if (['meaning', 'natural', 'origin', 'why', 'source'].includes(ev.target.dataset.markField)) {

      const e = entry(parse().parts[1]);

      S.drafts[e.id].sigil.marks[+ev.target.dataset.i][ev.target.dataset.markField] = ev.target.value;

      refreshSigil();

    }

    if (ev.target.id === 'e-title') { const h = $('#e-title-dup'); if (h) h.textContent = dupTitle(ev.target.value, parse().parts[1]); }

    if (ev.target.tagName === 'TEXTAREA') autosize(ev.target);

    if (ev.target.name === 'text' && ev.target.id) { const wc = $('#' + ev.target.id.replace(/-t$/, '-wc')); if (wc) wc.textContent = wordCount(ev.target.value); }

    schedulePersist();

  });



  document.addEventListener('change', (ev) => {

    if (ev.target.id === 'import-file') { readImport(ev.target.files[0]); return; }

    if (ev.target.id === 'e-photo') {

      const file = ev.target.files[0];

      if (!file) return;

      if (S.store.mode !== 'saved') { toast('Photos need the grimoire’s local server (start-grimoire.cmd).'); ev.target.value = ''; return; }

      const ta = (S.lastText && $('#' + S.lastText)) || $('textarea[name="text"]');

      uploadPhoto(file).then((id) => {

        const cap = ($('#e-photo-cap').value || '').replace(/[\[\]\n]/g, ' ').trim();

        const at = ta.selectionStart != null ? ta.selectionStart : ta.value.length;

        const ins = `\n\n![${cap}](att:${id})\n\n`;

        ta.value = ta.value.slice(0, at) + ins + ta.value.slice(at);

        ta.dispatchEvent(new Event('input', { bubbles: true }));

        ev.target.value = ''; $('#e-photo-cap').value = '';

        toast('Photo added to the section. It shows once you save.');

      }).catch((err) => { toast('Photo not added: ' + err.message); ev.target.value = ''; });

      return;

    }

    const mf = ev.target.dataset.markField;

    if (mf === 'root' || mf === 'status') {

      const e = entry(parse().parts[1]);

      S.drafts[e.id].sigil.marks[+ev.target.dataset.i][mf] = ev.target.value;

      refreshSigil();

      schedulePersist();

      return;

    }

    if (ev.target.dataset.change === 'ai-ask') { S.aiAsk = ev.target.value; $('#ai-prompt').value = aiPrompt(entry(ev.target.form.dataset.id), S.aiAsk); return; }

    if (ev.target.closest('form[data-form="sigil"]') && ev.target.name === 'writer') { S.writer = ev.target.value; render(false); $('#s-by').focus(); return; }

    const form = ev.target.closest('form');

    if (!form) return;

    if (form.dataset.form === 'filters') {

      const p = new URLSearchParams();

      ['cat', 'ed', 'ex', 'ty', 'by', 'tag', 'ret'].forEach((k) => { if (form[k].value) p.set(k, form[k].value); });

      location.hash = '#/library' + (p.toString() ? '?' + p : '');

    } else if (form.dataset.form === 'jfilter') {

      location.hash = '#/journal' + (form.entry.value ? '?entry=' + form.entry.value : '');

    } else if (ev.target.dataset.change === 'obs-entry') {

      const e = entry(ev.target.value);

      form.v.innerHTML = opts(e.versions.slice().reverse().map((x) => [String(x.v), `Version ${x.v} — ${x.editor}, ${fmtDate(x.date)}${x === cur(e) ? ' (current)' : ''}`]), String(cur(e).v));

    }

  });



  // Keyboard users must not be dropped to the top of the page when a button re-renders its own area

  // (Undo, Retire, Remove, Restore…): focus moves to the same button in the new page, or to the heading.

  // Registered before the main handler so it can note the button, and checks after the handler has run.

  document.addEventListener('click', (ev) => {

    const b = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;

    if (!b || b.dataset.action === 'go') return;

    setTimeout(() => {

      if (b.isConnected !== false) return;                              // still on the page: nothing was lost

      const ae = document.activeElement;

      if (ae && ae !== document.body && ae.isConnected !== false) return; // the handler already placed focus

      const q = (v) => String(v).replace(/["\\]/g, '\\$&');

      const sel = Object.keys(b.dataset).map((k) => `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${q(b.dataset[k])}"]`).join('');

      const next = $(sel) || (b.dataset.action === 'undo' ? $('#undo-slot button') : null);

      if (next && next.focus) next.focus(); else focusMain();

    }, 0);

  });



  document.addEventListener('click', (ev) => {

    const b = ev.target.closest('[data-action]');

    if (!b) return;

    const a = b.dataset.action;

    if (a === 'go') { ev.preventDefault(); location.hash = b.dataset.href; }

    else if (a === 'undo') undo();

    else if (a === 'export') exportSession();

    else if (a === 'new-from') newFromTemplate(b.dataset.t);

    else if (a === 'export-svg') { const e = entry(b.dataset.id); exportSvg(b.dataset.draft ? S.drafts[e.id] : cur(e)); }

    else if (a === 'import-apply') applyImport();

    else if (a === 'import-merge') applyMergeImport();

    else if (a === 'export-md') { download(`grimoire-readable-${today()}.md`, Model.toMarkdown(snapshot(), today()), 'text/markdown'); toast('Readable copy downloaded.'); }

    else if (a === 'restore-version') {

      const e = entry(b.dataset.id), n = parseInt(b.dataset.v, 10), from = ver(e, n), beforeV = cur(e).v;

      e.touched = Date.now();

      e.versions.push(Object.assign(contentOf(from), { v: beforeV + 1, editor: S.writer, date: today(), note: `Restored version ${n}` }));

      S.undo.push({ type: 'revision', entryId: e.id, beforeV, label: `restoring version ${n} of “${from.title}”` });

      toast(`Version ${n} restored as version ${beforeV + 1}. Nothing was removed from the history.`, true);

      location.hash = '#/entry/' + e.id;

    }

    else if (a === 'tpl-remove') {

      const t = S.templates.find((x) => x.id === b.dataset.t);

      S.templates = S.templates.filter((x) => x.id !== t.id);

      S.undo.push({ type: 'tpl', id: t.id, before: t, label: `removing template “${t.name}”` });

      toast('Template removed. Entries made from it are unchanged.', true);

      render(false);

    }

    else if (a === 'follow-open') { S.followFor = b.dataset.id; render(false); const f = $('#fu-text'); if (f) f.focus(); }

    else if (a === 'follow-cancel') { S.followFor = null; render(false); }

    else if (a === 'retire-entry') {

      const e = entry(b.dataset.id);

      S.undo.push({ type: 'retire', entryId: e.id, before: !!e.retired, label: `${e.retired ? 'bringing back' : 'retiring'} “${cur(e).title}”` });

      e.retired = !e.retired; if (!e.retired) delete e.retired;

      toast(e.retired ? 'Retired: kept with all its history, hidden from the library. Find it under Library → Showing: Retired entries.' : 'Back in the library.', true);

      render(false);

    }

    else if (a === 'focus-mode') {

      const on = document.body.classList.toggle('focus');

      b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Leave focus mode' : 'Focus mode';

      toast(on ? 'Focus mode: navigation hidden. Press Escape or the button to leave. Saving continues.' : 'Focus mode off.');

    }

    else if (a === 'rel-open') { S.relFor = b.dataset.id; render(false); const f = $('#rel-kind'); if (f) f.focus(); }

    else if (a === 'rel-cancel') { S.relFor = null; render(false); }

    else if (a === 'rel-remove') {

      const e = entry(b.dataset.id);

      S.undo.push({ type: 'rel', entryId: e.id, before: (e.relations || []).slice(), label: `removing a relation on “${cur(e).title}”` });

      e.relations = e.relations.filter((_, i) => i !== parseInt(b.dataset.i, 10));

      toast('Relation removed.', true);

      render(false);

    }

    else if (a === 'insert-link') {

      const title = ($('#e-link').value || '').trim();

      const ta = (S.lastText && $('#' + S.lastText)) || $('textarea[name="text"]');

      if (!title || !ta) { toast('Type a title to link to first.'); return; }

      const at = ta.selectionStart != null ? ta.selectionStart : ta.value.length;

      const ins = `[[${title}]]`;

      ta.value = ta.value.slice(0, at) + ins + ta.value.slice(ta.selectionEnd != null ? ta.selectionEnd : at);

      ta.dispatchEvent(new Event('input', { bubbles: true }));

      ta.focus(); ta.selectionStart = ta.selectionEnd = at + ins.length;

      $('#e-link').value = '';

      toast(byTitle(title) ? `Linked to “${title}”.` : `Inserted [[${title}]] — no entry has that title yet.`);

    }

    else if (a === 'corr-new') { S.corrEdit = 'new'; render(false); const f = $('#cr-item'); if (f) f.focus(); }

    else if (a === 'corr-edit') { S.corrEdit = b.dataset.id; render(false); const f = $('#cr-item'); if (f) { f.focus(); f.scrollIntoView({ block: 'center' }); } }

    else if (a === 'corr-cancel') { S.corrEdit = null; if (/[?&]add=1/.test(location.hash)) location.hash = '#/correspondences'; else render(false); }

    else if (a === 'corr-retire') {

      const c = S.correspondences.find((x) => x.id === b.dataset.id);

      S.undo.push({ type: 'corr', id: c.id, before: clone(c), label: `${c.retired ? 'restoring' : 'retiring'} “${c.item}”` });

      c.retired = !c.retired;

      toast(c.retired ? 'Retired — still kept, and shown with "Show retired".' : 'Restored.', true);

      render(false);

    }

    else if (a === 'import-cancel') { S.importPreview = null; render(false); }

    else if (a === 'backups-load') loadBackups();

    else if (a === 'sync-status') loadSyncStatus();

    else if (a === 'sync-now') runSyncNow();

    else if (a === 'phone-status') loadPhone();

    else if (a === 'phone-pair' || a === 'phone-forget') phoneAct(a === 'phone-pair' ? 'pair' : 'forget');

    else if (a === 'restore-ask') { S.restoreAsk = b.dataset.name; render(false); const c = $('[data-action="restore-confirm"]'); if (c) c.focus(); }

    else if (a === 'restore-cancel') { S.restoreAsk = null; render(false); }

    else if (a === 'restore-confirm') doRestore(b.dataset.name);

    else if (a === 'conflict-mine') resolveConflict('mine');

    else if (a === 'conflict-theirs') resolveConflict('theirs');

    else if (a === 'ai-copy') copyText($('#ai-prompt'));

    else if (a.indexOf('mark-') === 0) markAction(a, b);

    else if (a === 'cancel-edit' || a === 'discard-draft') {

      delete S.drafts[b.dataset.id];

      toast('Draft discarded. The entry is unchanged.');

      if (a === 'cancel-edit') location.hash = '#/entry/' + b.dataset.id; else render(false);

    } else if (a.indexOf('block-') === 0) {

      const form = b.closest('form'); const d = readEdit(form); const i = parseInt(b.dataset.i, 10);

      if (a === 'block-add') d.blocks.push({ kind: 'note', by: S.writer, heading: '', text: '' });

      if (a === 'block-remove') d.blocks.splice(i, 1);

      if (a === 'block-up' && i > 0) d.blocks.splice(i - 1, 0, d.blocks.splice(i, 1)[0]);

      render(false);

      const target = a === 'block-add' ? $(`#b${d.blocks.length - 1}-t`) : a === 'block-up' ? $(`#b${i - 1}-k`) : $('[data-action="block-add"]');

      if (target) target.focus();

    }

  });



  const EXPORT_PHOTO_LIMIT = 350 * 1024 * 1024;   // base64 characters; beyond this browsers may fail to build the file

  async function exportSession() {

    const state = snapshot();

    const attachments = {};

    let missing = 0, total = 0;

    const withPhotos = !$('#export-photos') || $('#export-photos').checked;

    if (S.store.mode === 'saved' && withPhotos) {

      for (const id of Model.attachmentRefs(state)) {

        try {

          const r = await fetch('attachments/' + id);

          if (!r.ok) { missing++; continue; }

          const bytes = new Uint8Array(await r.arrayBuffer());

          let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));

          attachments[id] = btoa(bin);

          total += attachments[id].length;

          if (total > EXPORT_PHOTO_LIMIT) { toast('The photos are too large to fit in one export file. Export without photos, and copy the data\\attachments folder to keep them.'); return; }

        } catch (e) { missing++; }

      }

    }

    const parts = Model.exportParts(state, attachments, { exportedAt: new Date().toISOString(), note: `Full export of the Lattice Age Grimoire: every entry with all versions and suggestions (including declined ones), the journal, unsaved drafts, undo history${withPhotos ? ' and the photos they use' : ' (photos not included)'}. Import it from Data and backups.` });

    const stamp = new Date().toTimeString().slice(0, 5).replace(':', '');

    download(`grimoire-export-${today()}-${stamp}.json`, parts, 'application/json');

    toast(missing ? `Export downloaded, but ${missing} photo(s) could not be read and are not in it.` : withPhotos ? 'Full export downloaded.' : 'Export downloaded without photos.');

  }



  const REASONS = { auto: 'Routine backup', startup: 'When the app started', import: 'Before an import', 'before-restore': 'Before a restore', 'conflict-unsaved': 'A version kept during a conflict', 'conflict-overwrite': 'Before keeping another tab\'s version', migrate: 'Before a format upgrade', corrupt: 'Unreadable data file, kept as found' };

  const fmtSum = (x) => `${x.entries} entries, ${x.versions} versions, ${x.observations} observations, ${x.drafts} unsaved drafts, ${x.suggestions} suggestions`;

  const fmtWhen = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });



  // Phone access (prepared; off unless Author enables it — PHONE-APP.md). Laptop-only controls.

  async function loadPhone() {

    try { const r = await fetch('api/phone', { cache: 'no-store' }); S.phone = r.ok ? await r.json() : { error: 'Phone settings are available on the laptop only.' }; }

    catch (e) { S.phone = { error: 'Could not read phone settings.' }; }

    render(false);

  }

  async function phoneAct(what) {

    try {

      const r = await fetch('api/phone/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

      const j = await r.json();

      if (!r.ok) throw new Error(j.error || 'refused');

      if (what === 'pair') S.phonePair = j; else { S.phonePair = null; toast('Every phone has been unpaired.'); }

    } catch (e) { toast('Phone: ' + e.message); }

    await loadPhone();

  }

  async function runSyncNow() { try { await fetch('api/sync/now',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); await checkForOutsideChanges(); } finally { await loadSyncStatus(); } }

  async function loadSyncStatus() {

    try { const r=await fetch('api/sync/status',{cache:'no-store'}); if(!r.ok)throw Error('Sync is not configured on this installation.'); S.sync=await r.json(); }

    catch(e){S.sync={error:e.message};} render(false);

  }

  function syncSection() {

    const s=S.sync;

    if(!s)return '<p>Shared content sync keeps a queue and an audit record. Connection activation requires approved private access.</p><button data-action="sync-status">Show sync history</button>';

    return `<p><strong>${s.enabled?'Periodic sync enabled (every minute while open)':'Sync connection inactive'}</strong>. ${esc(s.reason||'')}</p>

      ${s.error?`<p role="status">${esc(s.error)}</p>`:''}

      <p>${Number(s.queued||0)} queued changes. Last successful exchange: ${esc(s.lastSuccess||'none')}.</p>

      <button data-action="sync-status">Refresh history</button>${s.enabled?'<button data-action="sync-now">Sync now</button>':''}

      <p>Conflicting versions are preserved below; no version is silently chosen. Export a backup before resolving by editing.</p>

      ${(s.conflicts||[]).map(c=>`<details><summary>Conflict ${esc(c.id)}</summary><pre>${esc(JSON.stringify(c.changes,null,2))}</pre></details>`).join('')}

      <details><summary>Audit history (${(s.audit||[]).length})</summary><ol>${(s.audit||[]).slice(-100).map(a=>`<li>${esc(a.at||'')} â€” ${esc(a.type||'')} ${esc(a.id||'')} ${esc(a.status||a.message||'')}</li>`).join('')}</ol></details>`;

  }

  function phoneSection() {

    if (OFFLINE_PHONE) return '<p>This grimoire works offline and saves on this phone. Export a full backup with photos to a safe location. Import/export transfers changes between devices; automatic syncing is not enabled. Uninstalling or clearing app data removes this phone copy and its local snapshots.</p>';

    if (S.store.mode !== 'saved') return '<p class="muted">Phone access needs the local server.</p>';

    const p = S.phone;

    if (!p) return '<p>Use the grimoire on your phone the same way as the Control Room: through your private Tailscale link, while the laptop is on.</p><button type="button" data-action="phone-status">Show phone settings</button>';

    if (p.error) return `<p class="muted">${esc(p.error)}</p>`;

    if (!p.enabled) return `<p><strong>Phone access is off</strong> (the default). Nothing outside this laptop can reach the grimoire.</p>

      <p class="hint">Turning it on needs a few steps only you can take — a Tailscale setting and, for the app, a signing key. They are written out in <code>PHONE-APP.md</code> in the grimoire folder.</p>`;

    const pair = S.phonePair && S.phonePair.expires > Date.now() ? `<div class="notice" role="status"><p>On the phone, open the Grimoire app (or <code>${esc(S.phonePair.url.replace(/\?.*$/, ''))}</code>) and enter this code within 10 minutes:</p>

      <p style="font:600 2rem/1.2 ui-monospace,monospace;letter-spacing:.15em;margin:.3rem 0">${esc(S.phonePair.code)}</p></div>` : '';

    return `<p><strong>Phone access is on</strong> for <code>${esc(p.host)}</code> (${esc(p.scheme)}), Tailscale login ${esc(p.login)}. ${p.devices} phone${p.devices === 1 ? '' : 's'} paired.</p>

      ${pair}

      <div class="actions"><button type="button" data-action="phone-pair">Pair a phone</button><button type="button" data-action="phone-forget">Forget all phones</button></div>

      <p class="hint">To turn phone access off completely: <code>node tools/phone.mjs disable</code>.</p>`;

  }



  function viewData() {

    const st = S.store;

    const here = Model.summarize(snapshot());

    const modeText = { saved: OFFLINE_PHONE ? 'Saving automatically on this phone' : 'Saving automatically to this laptop', memory: 'Not saving — opened without the local server', error: 'Not saving — see the message at the top', loading: 'Loading' }[st.mode];

    let conflict = '';

    if (st.conflict) {

      const other = st.conflict.state ? Model.summarize(st.conflict.state) : null;

      conflict = `<section class="notice" aria-labelledby="c-h"><h2 id="c-h" style="margin-top:.3rem">Changed elsewhere</h2>

        <p>While this tab was open, the saved grimoire was changed somewhere else — another tab, or someone editing the data file. Saving is paused so nothing is overwritten.</p>

        <p>This tab: ${fmtSum(here)}.<br>Saved version: ${other ? fmtSum(other) : 'unknown'}.</p>

        <div class="actions"><button type="button" data-action="conflict-theirs">Load the saved version</button><button type="button" data-action="conflict-mine">Keep this tab's version</button></div>

        <p class="hint">Whichever you choose, the other version is kept in backups.</p></section>`;

    }

    const ip = S.importPreview;

    let imp = '';

    if (ip) {

      const r = ip.result;

      imp = r.errors.length

        ? `<div class="notice" id="import-result" tabindex="-1" role="alert"><p><strong>${esc(ip.name)} can't be imported.</strong> Nothing has changed.</p><ul>${r.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><button type="button" data-action="import-cancel">OK</button></div>`

        : `<div class="notice" id="import-result" tabindex="-1"><p><strong>${esc(ip.name)}</strong> (${esc(r.from)}): ${fmtSum(Model.summarize(r.state))}.</p>

          ${r.warnings.length ? `<p>Warnings:</p><ul>${r.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}

          ${(() => { const pl = Model.mergePlan(snapshot(), r.state); return `<h3>Add what's new (keeps everything you have)</h3>

          <p>Adds ${pl.addEntries.length} new entries, ${pl.addObs.length} observations and ${pl.addCorr.length} correspondences.${pl.obsOnDiffering.length ? ` ${pl.obsOnDiffering.length} observation(s) belong to differing entries and come in only with copies.` : ''}${pl.skippedObs.length ? ` ${pl.skippedObs.length} observation(s) point at entries in neither grimoire and are skipped.` : ''}${pl.differingObs.length ? ` ${pl.differingObs.length} observation(s) exist here in a different form and are left unchanged.` : ''} ${pl.sameEntries.length} entries are already identical and are skipped.

          ${pl.differing.length ? `${pl.differing.length} entr${pl.differing.length === 1 ? 'y differs' : 'ies differ'} from yours and will not be changed${pl.differing.length <= 8 ? ' (' + pl.differing.map((e) => esc(e.versions[e.versions.length - 1].title)).join(', ') + ')' : ''}.` : ''}

          ${pl.differingCorr.length ? `${pl.differingCorr.length} correspondence(s) differ and will not be changed.` : ''}</p>

          ${pl.differing.length ? '<p><label><input type="checkbox" id="merge-copies"> Also add the differing entries as separate copies, marked "(imported copy)"</label></p>' : ''}

          <div class="actions"><button type="button" class="primary" data-action="import-merge"${pl.addEntries.length + pl.addObs.length + pl.addCorr.length + pl.differing.length ? '' : ' disabled'}>Add what's new</button></div>`; })()}

          <h3>Or replace everything</h3>

          <p>Replaces everything currently in the grimoire with this file. ${st.mode === 'saved' ? 'The current version is backed up first and can be restored below.' : 'This tab is not saving, so a copy of the current contents is downloaded first.'}</p>

          <div class="actions"><button type="button" data-action="import-apply">Replace with this file</button><button type="button" data-action="import-cancel">Cancel</button></div></div>`;

    }

    const bl = S.backups;

    let backups;

    if (st.mode === 'memory') backups = '<p class="muted">Backups need the local server.</p>';

    else if (!bl) backups = '<button type="button" data-action="backups-load">Show backups</button>';

    else if (bl.loading) backups = '<p class="muted">Loading…</p>';

    else if (bl.error) backups = `<p>${esc(bl.error)}</p>`;

    else if (!bl.list.length) backups = '<p class="muted">No backups yet. They are made automatically.</p>';

    else backups = `<p class="hint">Folder: <code>${esc(bl.dir)}</code></p><ul class="cards">${bl.list.map((b) => `<li class="card">

        <p style="margin:0"><strong>${fmtWhen(b.modified)}</strong> · ${esc(REASONS[b.reason] || b.reason)}</p>

        <p class="muted">${b.summary ? fmtSum(b.summary) : 'Could not be read'} · ${Math.max(1, Math.round(b.size / 1024))} KB · <code>${esc(b.name)}</code></p>

        ${S.restoreAsk === b.name

          ? `<p>Replace the current grimoire with this backup? The current version is backed up first.</p><div class="actions" style="margin:.3rem 0 0"><button type="button" class="primary" data-action="restore-confirm" data-name="${esc(b.name)}">Restore this backup</button><button type="button" data-action="restore-cancel">Cancel</button></div>`

          : b.summary ? `<div class="actions" style="margin:.3rem 0 0"><button type="button" data-action="restore-ask" data-name="${esc(b.name)}">Restore…</button></div>` : ''}</li>`).join('')}</ul>`;

    return `<div class="reading">

      <h1>Data and backups</h1>

      ${conflict}

      <h2>Where your grimoire is kept</h2>

      <p><strong>${esc(modeText)}.</strong>${st.savedAt && st.mode === 'saved' ? ` Last saved ${fmtWhen(st.savedAt)}.` : ''}</p>

      ${OFFLINE_PHONE ? `<p>Data is held privately on this phone. Export full backups regularly, including photos.</p>` : st.dataDir ? `<p>Data folder: <code>${esc(st.dataDir)}</code> — one file, <code>grimoire.json</code>, plus a <code>backups</code> folder.</p>` : ''}

      <p>Now: ${fmtSum(here)}, ${here.undoSteps} undo steps.</p>

      ${(S.loadWarnings || []).length ? `<details class="meta"><summary>${S.loadWarnings.length} warning(s) when loading</summary><div><ul>${S.loadWarnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></details>` : ''}

      <p class="hint">Changes save about half a second after you make them. ${OFFLINE_PHONE ? 'Everything stays on this phone unless you export it; nothing is sent automatically.' : 'Everything stays on this laptop; nothing is sent anywhere.'}</p>

      <h2>Export</h2>

      <p>Download everything: every entry with all its versions, suggestions (declined ones too), the journal, unsaved drafts and the undo history.</p>

      <p><label><input type="checkbox" id="export-photos" checked> Include photos</label> <span class="hint">(turn off for a small file; the photos stay in <code>data\attachments</code>)</span></p>

      <div class="actions"><button type="button" data-action="export">Download full export (JSON)</button><button type="button" data-action="export-md">Download a readable copy (Markdown)</button></div>

      <p class="hint">The readable copy has the current version of every entry, the correspondences and the journal — for reading or printing without the app. Only the JSON export can be imported back.</p>

      <h2>Import</h2>

      <p>Bring back a full export, or an export from the earlier preview. The file is checked before anything changes.</p>

      <div class="field"><label for="import-file">Choose a grimoire file</label><input id="import-file" type="file" accept=".json,application/json"></div>

      ${imp}

      <h2>Content sync</h2>

      ${syncSection()}

      <h2>Phone</h2>

      ${phoneSection()}

      <h2>Backups</h2>

      <p class="hint">${OFFLINE_PHONE ? "A local snapshot is preserved before each save and restore. These snapshots stay on this phone; export full backups separately." : "Made automatically: when the app starts, every 15 minutes of editing, and before any import, restore or conflict choice. The newest 60 routine backups are kept; the others are never deleted."}</p>

      ${OFFLINE_PHONE ? '<p class="hint">Snapshots retain text and history. Photos stay in private phone storage. Use Download full export with Include photos selected for a complete backup, and Import to restore that file. Keep it outside the app before uninstalling or clearing app data.</p>' : `<p class="hint"><strong>These are snapshots of the text</strong> — entries, history, journal, drafts, suggestions, correspondences. <strong>Photos are not inside them</strong>: photos stay in the <code>attachments</code> folder and are never deleted, so restoring a snapshot shows them again on this laptop. For a <strong>complete</strong> backup (text and photos, e.g. to another drive), close the grimoire and copy the whole data folder${S.store.dataDir ? ` (<code>${esc(S.store.dataDir)}</code>)` : ''}.</p>`}

      ${backups}

    </div>`;

  }



  // Library panel: open on wide screens, a disclosure on narrow ones.

  const wide = window.matchMedia('(min-width: 901px)');

  const syncPanel = () => { $('#libpanel').open = wide.matches; };

  wide.addEventListener('change', syncPanel);

  syncPanel();



  window.addEventListener('hashchange', () => { if (!wide.matches) $('#libpanel').open = false; if (!/\/edit$/.test(location.hash)) document.body.classList.remove('focus'); render(true); });

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && document.body.classList.contains('focus')) { document.body.classList.remove('focus'); const fb = $('[data-action="focus-mode"]'); if (fb) { fb.setAttribute('aria-pressed', 'false'); fb.textContent = 'Focus mode'; } } });

  // "/" jumps to search unless you are typing somewhere.

  document.addEventListener('keydown', (ev) => {

    if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;

    const t = ev.target;

    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

    ev.preventDefault(); $('#q').focus();

  });

  window.addEventListener('grimoire-sync-update', checkForOutsideChanges);

  window.addEventListener('focus', checkForOutsideChanges);

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForOutsideChanges(); else saveNow('edit'); });

  // Ask before closing whenever something in this tab isn't safely saved — including during a conflict,

  // when the server is unreachable, or when the page runs without the server at all.

  window.addEventListener('beforeunload', (ev) => {

    if (S.store.mode === 'loading') return;

    if (saving || isDirty() || S.store.conflict) { saveNow('edit'); ev.preventDefault(); ev.returnValue = ''; }

  });

  boot();

  // Exposed for manual inspection in dev tools only.

  window.__grimoire = S;

})();

