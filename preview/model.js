/* Shared data model for the Lattice Age Grimoire.

   Loaded by the browser (window.GrimoireModel), the local server and the tests (require).

   Pure functions only: no storage, no network, no DOM. */

(function (root) {

  'use strict';



  const FORMAT = 'lattice-age-grimoire';

  const SCHEMA_VERSION = 1;

  const EDITORIAL = ['Draft', 'Finished'];

  const MARK_STATUSES = ['exploratory', 'proposed', 'approved'];

  const PENDING_STATUSES = ['open', 'accepted', 'declined'];

  // How firmly a correspondence is held. 'unknown' keeps an unknown origin explicit rather than guessed.

  const CERTAINTY = { sourced: 'Documented in a named source', tradition: 'Traditional (widely attributed)', personal: 'Personal association', proposed: 'Proposal (not yet adopted)', unknown: 'Origin unknown' };

  const MARK_TEXT_FIELDS = ['root', 'natural', 'origin', 'why', 'source'];

  // Photos are referenced by content id: in text as ![caption](att:<id>), on observations as photos: [{ id, caption }].

  const ATT_ID = /^[0-9a-f]{32}\.(jpg|png|webp|gif)$/;

  const ATT_REF = /att:([0-9a-f]{32}\.(?:jpg|png|webp|gif))/g;

  function attachmentRefs(state) {

    const ids = new Set();

    const scan = (t) => { if (typeof t === 'string') for (const m of t.matchAll(ATT_REF)) ids.add(m[1]); };

    const scanBlocks = (c) => { if (c && Array.isArray(c.blocks)) c.blocks.forEach((b) => scan(b && b.text)); };

    (state.entries || []).forEach((e) => { (e.versions || []).forEach(scanBlocks); (e.pending || []).forEach((p) => scanBlocks(p && p.content)); });

    Object.values(state.drafts || {}).forEach(scanBlocks);

    (state.journal || []).forEach((o) => (o.photos || []).forEach((p) => { if (p && ATT_ID.test(p.id)) ids.add(p.id); }));

    // correspondence notes are rendered as prose too, so a photo line there is a real reference

    (state.correspondences || []).forEach((c) => { scan(c && c.note); ((c && c.history) || []).forEach((h) => scan(h && h.note)); });

    return [...ids].sort();

  }



  // A full export as a list of string pieces (one per photo), so a large export never has to exist

  // as a single giant string (browsers cap strings at roughly 512 MB). Joined, it is ordinary JSON

  // that parseImport reads. photos: { id: base64 }.

  function exportParts(state, photos, extra) {

    const head = Object.assign({ format: FORMAT, schemaVersion: SCHEMA_VERSION }, extra || {});

    const parts = [JSON.stringify(head).slice(0, -1) + ',"state":', JSON.stringify(state), ',"attachments":{'];

    let n = 0;

    Object.keys(photos || {}).sort().forEach((id) => {

      if (!ATT_ID.test(id) || typeof photos[id] !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(photos[id])) return;

      parts.push((n++ ? ',' : '') + JSON.stringify(id) + ':"', photos[id], '"');

    });

    parts.push('}}');

    return parts;

  }

  // Typed relations (idea from the OMS wiki): stored on one entry, shown with the inverse on the other.

  const RELATIONS = { 'related to': 'related to', 'derived from': 'source of', 'part of': 'includes', 'variant of': 'has variant', 'used in': 'uses', 'conflicts with': 'conflicts with',

    'located in': 'location of', 'member of': 'has member', 'rival of': 'rival of', 'comes before': 'comes after' };

  const REL_CERTAINTY = ['known', 'likely', 'speculative', 'disputed'];

  // Would adding "a derived from b (known)" create a loop of known derivations?

  function derivationLoop(entries, from, to) {

    const next = (id) => { const e = entries.find((x) => x.id === id); return e && Array.isArray(e.relations) ? e.relations.filter((r) => r.rel === 'derived from' && r.certainty === 'known').map((r) => r.target) : []; };

    const seen = new Set(); const stack = [to];

    while (stack.length) { const id = stack.pop(); if (id === from) return true; if (seen.has(id)) continue; seen.add(id); stack.push(...next(id)); }

    return false;

  }



  // Ids end up in links and attributes, so they are restricted to a plain, safe alphabet.

  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

  const isId = (x) => typeof x === 'string' && SAFE_ID.test(x);

  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  const isStr = (x) => typeof x === 'string';

  const clone = (x) => JSON.parse(JSON.stringify(x));



  // Fill in fields that are ABSENT (older files lack drafts, undo, pending...). A field that is present

  // but malformed is left as it is, so validate() refuses it rather than it being silently replaced.

  function normalize(state) {

    const s = clone(state);

    const dflt = (o, k, v) => { if (o[k] === undefined) o[k] = v; };

    dflt(s, 'entries', []); dflt(s, 'journal', []); dflt(s, 'drafts', {}); dflt(s, 'undo', []);

    dflt(s, 'writer', 'Author'); dflt(s, 'seq', 1); dflt(s, 'correspondences', []); dflt(s, 'templates', []);

    if (Array.isArray(s.entries)) s.entries.forEach((e) => {

      if (!isObj(e)) return;

      dflt(e, 'pending', []); dflt(e, 'related', []); dflt(e, 'sources', []); dflt(e, 'sourceNote', ''); dflt(e, 'type', 'article');

      if (Array.isArray(e.versions)) e.versions.forEach((v) => { if (isObj(v)) { dflt(v, 'summary', ''); dflt(v, 'date', ''); dflt(v, 'editor', ''); dflt(v, 'editorial', 'Draft'); dflt(v, 'experimental', false); } });

    });

    return s;

  }



  function validateContent(c, where, errors) {

    if (!isObj(c)) { errors.push(`${where}: not an object`); return; }

    if (!isStr(c.title)) errors.push(`${where}: title must be text`);

    if (c.summary !== undefined && !isStr(c.summary)) errors.push(`${where}: summary must be text`);

    if (c.editorial !== undefined && !EDITORIAL.includes(c.editorial)) errors.push(`${where}: editorial state must be Draft or Finished`);

    if (!Array.isArray(c.blocks)) errors.push(`${where}: blocks must be a list`);

    else c.blocks.forEach((b, i) => {

      if (!isObj(b) || !isStr(b.kind) || !isStr(b.by) || !isStr(b.heading) || !isStr(b.text) || (b.hint !== undefined && !isStr(b.hint))) errors.push(`${where} section ${i + 1}: needs kind, by, heading and text`);

      if (isObj(b) && b.collapsible !== undefined && typeof b.collapsible !== 'boolean') errors.push(`${where} section ${i + 1}: collapsible must be true or false`);

    });

    if (c.tags !== undefined && (!Array.isArray(c.tags) || !c.tags.every((t) => isStr(t) && t.trim() && t.length <= 40))) errors.push(`${where}: tags must be short words or phrases`);

    if (c.sigil !== undefined) {

      if (!isObj(c.sigil) || !Array.isArray(c.sigil.marks)) errors.push(`${where}: sigil must have a marks list`);

      else c.sigil.marks.forEach((m, i) => {

        if (!isObj(m) || !isStr(m.d) || !MARK_STATUSES.includes(m.status) || !isStr(m.meaning)) { errors.push(`${where} mark ${i + 1}: needs path, status and meaning`); return; }

        MARK_TEXT_FIELDS.forEach((k) => { if (m[k] !== undefined && !isStr(m[k])) errors.push(`${where} mark ${i + 1}: ${k} must be text`); });

        ['tx', 'ty', 's'].forEach((k) => { if (m[k] !== undefined && !(typeof m[k] === 'number' && Number.isFinite(m[k]) && Math.abs(m[k]) <= 1000)) errors.push(`${where} mark ${i + 1}: ${k} must be a number`); });

        if (!/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\- \n\t]*$/.test(m.d)) errors.push(`${where} mark ${i + 1}: path data contains unexpected characters`);

      });

    }

  }



  // Undo steps carry what they restore; a malformed one would put garbage back into the grimoire when used.

  const ids = (a) => Array.isArray(a) && a.every(isId);

  function undoStepOk(u) {

    if (!isObj(u) || !isStr(u.type) || (u.label !== undefined && !isStr(u.label)) || (u.entryId !== undefined && !isId(u.entryId))) return false;

    switch (u.type) {

      case 'revision': return isId(u.entryId) && Number.isInteger(u.beforeV) && (u.pid === undefined || isId(u.pid));

      case 'suggestion': case 'decline': return isId(u.entryId) && isId(u.pid);

      case 'observation': case 'follow': return isId(u.id);

      case 'capture': return isId(u.entryId);

      case 'retire': return isId(u.entryId) && typeof u.before === 'boolean';

      case 'rel': return isId(u.entryId) && Array.isArray(u.before) && u.before.every((r) => isObj(r) && Object.prototype.hasOwnProperty.call(RELATIONS, r.rel) && isId(r.target) && REL_CERTAINTY.includes(r.certainty));

      case 'corr': return isId(u.id) && (u.before === null || (isObj(u.before) && isId(u.before.id) && isStr(u.before.item) && isStr(u.before.association) && Object.prototype.hasOwnProperty.call(CERTAINTY, u.before.certainty)));

      case 'tpl': return isId(u.id) && (u.before === null || (isObj(u.before) && isId(u.before.id) && isStr(u.before.name) && ['article', 'spell', 'sigil'].includes(u.before.type) && isId(u.before.category) && Array.isArray(u.before.blocks) && u.before.blocks.every((b) => Array.isArray(b) && b.length === 3 && b.every(isStr))));

      case 'merge': return ids(u.entryIds) && ids(u.obsIds) && ids(u.corrIds);

      default: return false;

    }

  }



  // Returns { errors: [...], warnings: [...] }. Errors block saving/importing; warnings are reported.

  function validate(state) {

    const errors = [], warnings = [];

    if (!isObj(state)) return { errors: ['Not a grimoire: expected an object'], warnings };

    if (!Array.isArray(state.entries)) errors.push('entries must be a list');

    if (!Array.isArray(state.journal)) errors.push('journal must be a list');

    if (state.drafts !== undefined && !isObj(state.drafts)) errors.push('drafts must be an object');

    if (state.undo !== undefined && !Array.isArray(state.undo)) errors.push('undo history must be a list');

    if (state.writer !== undefined && !isStr(state.writer)) errors.push('writer must be text');

    if (state.seq !== undefined && !(Number.isInteger(state.seq) && state.seq > 0)) errors.push('seq must be a positive whole number');

    if (state.correspondences !== undefined && !Array.isArray(state.correspondences)) errors.push('correspondences must be a list');

    if (state.templates !== undefined) {

      if (!Array.isArray(state.templates)) errors.push('templates must be a list');

      else state.templates.forEach((t, i) => {

        if (!isObj(t) || !isId(t.id) || !isStr(t.name) || !['article', 'spell', 'sigil'].includes(t.type) || !isId(t.category) || !Array.isArray(t.blocks)

          || !t.blocks.every((b) => Array.isArray(b) && b.length === 3 && b.every(isStr))) errors.push(`Template ${i + 1}: needs id, name, type, category and sections`);

      });

    }

    if (errors.length) return { errors, warnings };

    const ids = new Set();

    state.entries.forEach((e, i) => {

      const where = `Entry ${isObj(e) && isStr(e.id) ? '"' + e.id + '"' : i + 1}`;

      if (!isObj(e) || !isStr(e.id) || !e.id) { errors.push(`${where}: missing id`); return; }

      if (!isId(e.id)) { errors.push(`${where}: id may only use letters, digits and . _ : -`); return; }

      if (e.retired !== undefined && typeof e.retired !== 'boolean') errors.push(`${where}: retired must be true or false`);

      if (e.category !== undefined && !isId(e.category)) errors.push(`${where}: category may only use letters, digits and . _ : -`);

      if (e.type !== undefined && !['article', 'spell', 'sigil'].includes(e.type)) errors.push(`${where}: unknown kind "${e.type}"`);

      if (ids.has(e.id)) errors.push(`${where}: duplicate id`);

      ids.add(e.id);

      if (!Array.isArray(e.versions) || !e.versions.length) { errors.push(`${where}: has no versions`); return; }

      ['related', 'sources'].forEach((k) => { if (e[k] !== undefined && !Array.isArray(e[k])) errors.push(`${where}: ${k} must be a list`); });

      if (Array.isArray(e.sources)) e.sources.forEach((src, k) => {

        if (!isObj(src) || !isStr(src.label) || ['ref', 'date', 'certainty'].some((f) => src[f] !== undefined && !isStr(src[f]))) errors.push(`${where} source ${k + 1}: needs a label (and text for ref, date, certainty)`);

      });

      if (Array.isArray(e.related) && !e.related.every(isId)) errors.push(`${where}: related entries must be plain ids`);

      if (e.relations !== undefined) {

        if (!Array.isArray(e.relations)) errors.push(`${where}: relations must be a list`);

        else e.relations.forEach((r, k) => {

          if (!isObj(r) || !Object.prototype.hasOwnProperty.call(RELATIONS, r.rel) || !isId(r.target) || !REL_CERTAINTY.includes(r.certainty) || (r.note !== undefined && !isStr(r.note))) errors.push(`${where} relation ${k + 1}: needs a known kind, a target and a certainty`);

          else if (r.target === e.id) errors.push(`${where} relation ${k + 1}: an entry can't relate to itself`);

        });

      }

      ['sourceNote', 'type', 'category'].forEach((k) => { if (e[k] !== undefined && !isStr(e[k])) errors.push(`${where}: ${k} must be text`); });

      let last = 0;

      e.versions.forEach((v) => {

        if (!isObj(v) || !Number.isInteger(v.v) || v.v <= last) errors.push(`${where}: version numbers must be whole numbers in increasing order`);

        else {

          last = v.v;

          ['date', 'editor', 'note', 'acceptedBy'].forEach((k) => { if (v[k] !== undefined && !isStr(v[k])) errors.push(`${where} version ${v.v}: ${k} must be text`); });

        }

        validateContent(v, `${where} version ${isObj(v) ? v.v : '?'}`, errors);

      });

      if (e.pending !== undefined) {

        if (!Array.isArray(e.pending)) errors.push(`${where}: suggestions must be a list`);

        else e.pending.forEach((p, k) => {

          if (!isObj(p) || !isId(p.pid) || !PENDING_STATUSES.includes(p.status)) errors.push(`${where} suggestion ${k + 1}: needs a plain id and a status`);

          else validateContent(p.content, `${where} suggestion ${k + 1}`, errors);

        });

      }

    });

    const obsIds = new Set();

    state.journal.forEach((o, i) => {

      if (!isObj(o) || !isId(o.id) || !isId(o.entryId) || !Number.isInteger(o.v) || !isStr(o.happened)) { errors.push(`Observation ${i + 1}: needs a plain id, entry, version and what happened`); return; }

      ['date', 'by', 'meaning', 'next'].forEach((k) => { if (o[k] !== undefined && !isStr(o[k])) errors.push(`Observation ${o.id}: ${k} must be text`); });

      if (obsIds.has(o.id)) errors.push(`Observation ${o.id}: duplicate id`);

      if (o.photos !== undefined && (!Array.isArray(o.photos) || !o.photos.every((p) => isObj(p) && isStr(p.id) && ATT_ID.test(p.id) && (p.caption === undefined || isStr(p.caption))))) errors.push(`Observation ${o.id}: photos must be a list of photo ids`);

      if (o.followUps !== undefined && (!Array.isArray(o.followUps) || !o.followUps.every((f) => isObj(f) && isStr(f.text) && isStr(f.by) && isStr(f.date)))) errors.push(`Observation ${o.id}: follow-ups need date, by and text`);

      obsIds.add(o.id);

      const e = state.entries.find((x) => x && x.id === o.entryId);

      if (!e) warnings.push(`Observation ${o.id} links to entry "${o.entryId}", which is not present`);

      else if (Array.isArray(e.versions) && !e.versions.some((v) => v && v.v === o.v)) warnings.push(`Observation ${o.id} links to version ${o.v} of "${o.entryId}", which is not present`);

    });

    state.entries.forEach((e) => { if (isObj(e) && Array.isArray(e.relations)) e.relations.forEach((r) => { if (isObj(r) && isStr(r.target) && !ids.has(r.target)) warnings.push(`Entry "${e.id}" has a relation to "${r.target}", which is not present`); }); });

    if (state.drafts !== undefined) {

      Object.keys(state.drafts).forEach((id) => {

        if (!isId(id)) { errors.push('An unsaved draft has an unusable id'); return; }

        const d = state.drafts[id];

        validateContent(d, `Unsaved draft for "${id}"`, errors);

        if (!ids.has(id)) warnings.push(`Unsaved draft for "${id}" has no matching entry`);

      });

    }

    if (state.undo !== undefined) state.undo.forEach((u, i) => { if (!undoStepOk(u)) errors.push(`Undo step ${i + 1}: its record is incomplete or malformed`); });

    if (state.correspondences !== undefined) {

      const cids = new Set();

      state.correspondences.forEach((c, i) => {

        const where = `Correspondence ${isObj(c) && isStr(c.id) ? c.id : i + 1}`;

        if (!isObj(c) || !isId(c.id)) { errors.push(`${where}: needs a plain id (letters, digits and . _ : -)`); return; }

        if (cids.has(c.id)) errors.push(`${where}: duplicate id`);

        cids.add(c.id);

        ['item', 'association', 'tradition', 'source', 'addedBy', 'note'].forEach((k) => { if (c[k] !== undefined && !isStr(c[k])) errors.push(`${where}: ${k} must be text`); });

        if (!isStr(c.item) || !c.item.trim() || !isStr(c.association) || !c.association.trim()) errors.push(`${where}: needs an item and an association`);

        if (!Object.prototype.hasOwnProperty.call(CERTAINTY, c.certainty)) errors.push(`${where}: unknown certainty "${c.certainty}"`);

        if (c.retired !== undefined && typeof c.retired !== 'boolean') errors.push(`${where}: retired must be true or false`);

        if (c.history !== undefined && !Array.isArray(c.history)) errors.push(`${where}: history must be a list`);

        else if (Array.isArray(c.history) && !c.history.every((h) => isObj(h) && ['item', 'association', 'tradition', 'source', 'certainty', 'note', 'replacedBy', 'replacedOn', 'addedBy', 'date'].every((f) => h[f] === undefined || isStr(h[f])))) errors.push(`${where}: each earlier wording must be a record of text fields`);

      });

    }

    return { errors: errors.slice(0, 50), warnings: warnings.slice(0, 50) };

  }



  // Wrap state for disk or export.

  function envelope(state, extra) {

    return Object.assign({ format: FORMAT, schemaVersion: SCHEMA_VERSION }, extra || {}, { state });

  }



  // Accepts: a current envelope, a legacy preview session export ({exportedAt, note, entries, journal}),

  // or a bare state. Returns { state, from, errors, warnings } and never throws.

  function migrate(input) {

    if (!isObj(input)) return { state: null, from: 'unknown', errors: ['Not a grimoire file: expected a JSON object'], warnings: [] };

    let raw, from;

    if (input.format === FORMAT) {

      if (!Number.isInteger(input.schemaVersion)) return { state: null, from: 'unknown', errors: ['Missing schema version'], warnings: [] };

      if (input.schemaVersion > SCHEMA_VERSION) return { state: null, from: 'v' + input.schemaVersion, errors: [`This file was made by a newer version of the grimoire (schema ${input.schemaVersion}); this app understands up to ${SCHEMA_VERSION}`], warnings: [] };

      raw = input.state; from = 'v' + input.schemaVersion;

      if (!isObj(raw)) return { state: null, from, errors: ['The file has no grimoire contents (state is missing or not an object)'], warnings: [] };

    } else if (input.format !== undefined) {

      return { state: null, from: 'unknown', errors: [`Not a grimoire file (format "${String(input.format)}")`], warnings: [] };

    } else if (Array.isArray(input.entries)) {

      raw = input; from = input.exportedAt ? 'legacy preview export' : 'bare state';

    } else {

      return { state: null, from: 'unknown', errors: ['Not a grimoire file: no entries found'], warnings: [] };

    }

    // The core lists must really be there: an empty or partial file never replaces a grimoire by default.

    if (!Array.isArray(raw.entries) || !Array.isArray(raw.journal)) return { state: null, from, errors: ['The file must contain an entries list and a journal list'], warnings: [] };

    const state = normalize(raw);

    delete state.exportedAt; delete state.note; delete state.format; delete state.schemaVersion;

    const { errors, warnings } = validate(state);

    // Full exports carry the photos they reference, base64-encoded, beside the state.

    let attachments = {};

    if (input.attachments !== undefined) {

      if (!isObj(input.attachments) || !Object.keys(input.attachments).every((k) => ATT_ID.test(k) && isStr(input.attachments[k]) && /^[A-Za-z0-9+/=]*$/.test(input.attachments[k]))) errors.push('The embedded photos are malformed');

      else attachments = input.attachments;

    }

    const missing = errors.length ? [] : attachmentRefs(state).filter((id) => !attachments[id]);

    if (missing.length && input.attachments !== undefined) warnings.push(`${missing.length} photo(s) referenced but not included in this file; they show only if already on this laptop`);

    return { state: errors.length ? null : state, from, errors, warnings, attachments: errors.length ? {} : attachments };

  }



  function parseImport(text) {

    let obj;

    try { obj = JSON.parse(text); } catch (e) { return { state: null, from: 'unknown', errors: ['The file is not valid JSON: ' + e.message], warnings: [] }; }

    return migrate(obj);

  }



  function summarize(state) {

    const entries = state.entries || [];

    return {

      entries: entries.length,

      versions: entries.reduce((n, e) => n + e.versions.length, 0),

      observations: (state.journal || []).length,

      drafts: Object.keys(state.drafts || {}).length,

      suggestions: entries.reduce((n, e) => n + (e.pending || []).length, 0),

      correspondences: (state.correspondences || []).length,

      undoSteps: (state.undo || []).length

    };

  }



  // ---- merge import: add what's new, never overwrite ----

  // Entries/observations/correspondences are matched by id. Identical ones are skipped; ones that differ are

  // reported and left untouched (optionally added as separate copies). Nothing existing is changed.

  // Everything except the local "last touched" marker counts; key order doesn't.

  const canon = (x) => Array.isArray(x) ? x.map(canon) : isObj(x) ? Object.keys(x).filter((k) => k !== 'touched').sort().reduce((o, k) => { o[k] = canon(x[k]); return o; }, {}) : x;

  const sameEntry = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

  function mergePlan(current, incoming) {

    const curE = new Map(current.entries.map((e) => [e.id, e]));

    const plan = { addEntries: [], sameEntries: [], differing: [], addObs: [], obsOnDiffering: [], skippedObs: [], differingObs: [], addCorr: [], sameCorr: 0, differingCorr: [] };

    incoming.entries.forEach((e) => {

      const c = curE.get(e.id);

      if (!c) plan.addEntries.push(e);

      else if (sameEntry(c, e)) plan.sameEntries.push(e.id);

      else plan.differing.push(e);

    });

    // Observations attach only where their entry is new or identical here and their version exists.

    // Those on a differing entry are listed separately: they come in only with a copy of that entry.

    const curObs = new Set(current.journal.map((o) => o.id));

    const inc = new Map(incoming.entries.map((e) => [e.id, e]));

    const diffIds = new Set(plan.differing.map((e) => e.id));

    const curObsMap = new Map(current.journal.map((o) => [o.id, o]));

    incoming.journal.forEach((o) => {

      if (curObs.has(o.id)) { if (JSON.stringify(curObsMap.get(o.id)) !== JSON.stringify(o)) plan.differingObs.push(o); return; }

      const src = inc.get(o.entryId) || curE.get(o.entryId);

      const hasV = !!src && Array.isArray(src.versions) && src.versions.some((v) => v.v === o.v);

      if (diffIds.has(o.entryId)) plan.obsOnDiffering.push(o);

      else if (hasV) plan.addObs.push(o);

      else plan.skippedObs.push({ id: o.id, reason: 'its entry or version is in neither grimoire' });

    });

    const curC = new Map((current.correspondences || []).map((c) => [c.id, c]));

    (incoming.correspondences || []).forEach((c) => {

      const x = curC.get(c.id);

      if (!x) plan.addCorr.push(c); else if (JSON.stringify(x) === JSON.stringify(c)) plan.sameCorr++; else plan.differingCorr.push(c);

    });

    return plan;

  }



  // Returns { state, added: { entryIds, obsIds, corrIds }, skippedObs: [...] }

  function applyMerge(current, plan, opts) {

    const s = clone(current);

    const ids = new Set(s.entries.map((e) => e.id));

    const remap = {};

    const added = { entryIds: [], obsIds: [], corrIds: [] };

    plan.addEntries.forEach((e) => { s.entries.push(clone(e)); ids.add(e.id); added.entryIds.push(e.id); });

    if (opts && opts.copies) plan.differing.forEach((e) => {

      let n = 1, id = `${e.id}-imported`;

      while (ids.has(id)) id = `${e.id}-imported-${++n}`;

      const copy = clone(e); copy.id = id;

      copy.versions.forEach((v) => { v.title = `${v.title} (imported copy)`; });

      s.entries.push(copy); ids.add(id); remap[e.id] = id; added.entryIds.push(id);

    });

    const skippedObs = plan.skippedObs.slice();

    plan.addObs.forEach((o) => { s.journal.push(clone(o)); added.obsIds.push(o.id); });

    plan.obsOnDiffering.forEach((o) => {

      if (remap[o.entryId]) { s.journal.push(Object.assign(clone(o), { entryId: remap[o.entryId] })); added.obsIds.push(o.id); }

      else skippedObs.push({ id: o.id, reason: 'its entry differs here; add copies to keep it' });

    });

    s.correspondences = s.correspondences || [];

    plan.addCorr.forEach((c) => { s.correspondences.push(clone(c)); added.corrIds.push(c.id); });

    return { state: s, added, skippedObs };

  }



  // ---- readable Markdown copy (for reading without the app; not an import format) ----

  const KIND_LABEL = { source: 'Source summary', decision: 'Decision', proposal: 'Proposal', adaptation: 'Adaptation', interpretation: 'Interpretation', rationale: 'Rationale', fiction: 'In-world fiction', gap: 'Source gap or conflict', note: 'Note' };

  function toMarkdown(state, when) {

    const L = [`# Lattice Age Grimoire — readable copy`, '', `Made ${when || ''}. Current version of every entry; history, drafts and suggestions are in the full JSON export. This file is for reading, not for importing.`];

    const byCat = {};

    state.entries.forEach((e) => { (byCat[e.category] = byCat[e.category] || []).push(e); });

    Object.keys(byCat).sort().forEach((c) => {

      L.push('', `## ${c}`);

      byCat[c].forEach((e) => {

        const v = e.versions[e.versions.length - 1];

        L.push('', `### ${v.title}`, '', `*${v.editorial}${v.experimental ? ' · Experimental' : ''} · ${e.type || 'article'} · version ${v.v} · last edited by ${v.editor || 'unknown'}${v.date ? ', ' + v.date : ''} · id ${e.id}*`);

        if (v.summary) L.push('', v.summary);

        if (v.tags && v.tags.length) L.push('', `Tags: ${v.tags.join(', ')}`);

        if (e.retired) L.push('', '_Retired (kept, hidden from the library)._');

        v.blocks.forEach((b) => { L.push('', `**${b.heading || 'Section'}** — _${KIND_LABEL[b.kind] || b.kind} · ${b.by}_`, '', b.text.trim() || '_(not written yet)_'); });

        if (v.sigil && v.sigil.marks.length) {

          L.push('', '**Sigil marks**', '');

          v.sigil.marks.forEach((m, i) => L.push(`${i + 1}. ${m.meaning || '(no meaning stated)'}${m.root ? ' [' + m.root + ']' : ''} — ${STATUS_LABEL[m.status]}; natural association: ${m.natural || '—'}; earlier form: ${m.origin || 'unknown (not recorded)'}; reason: ${m.why || '—'}; source: ${m.source || '—'}`));

        }

        if (e.sources && e.sources.length) { L.push('', '**Sources**', ''); e.sources.forEach((s) => L.push(`- ${s.label}${s.date ? ' · ' + s.date : ''} — ${s.certainty}`)); }

        if (e.relations && e.relations.length) { L.push('', '**Relations**', ''); e.relations.forEach((r) => { const t = state.entries.find((x) => x.id === r.target); L.push(`- ${r.rel} ${t ? t.versions[t.versions.length - 1].title : r.target} (${r.certainty})${r.note ? ' — ' + r.note : ''}`); }); }

        if (e.sourceNote) L.push('', `_Source note: ${e.sourceNote}_`);

      });

    });

    if ((state.correspondences || []).length) {

      L.push('', '## Correspondences', '');

      state.correspondences.slice().sort((a, b) => a.item.localeCompare(b.item)).forEach((c) => L.push(`- **${c.item}** — ${c.association} · ${c.tradition || 'no tradition named'} · ${CERTAINTY[c.certainty]} · ${c.source ? 'source: ' + c.source : 'no source recorded'}${c.retired ? ' · retired' : ''}${c.note ? ' — ' + c.note.replace(/\n+/g, ' ') : ''}`));

    }

    if (state.journal.length) {

      L.push('', '## Journal', '');

      state.journal.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).forEach((o) => {

        const e = state.entries.find((x) => x.id === o.entryId);

        L.push(`- **${o.date || 'undated'}** · ${o.by || 'unknown'} · ${e ? e.versions[e.versions.length - 1].title : o.entryId} (version ${o.v} used)`, `  - What happened: ${o.happened.replace(/\n+/g, ' ')}`);

        if (o.meaning) L.push(`  - What it might mean: ${o.meaning.replace(/\n+/g, ' ')}`);

        if (o.next) L.push(`  - Next time: ${o.next.replace(/\n+/g, ' ')}`);

        (o.followUps || []).forEach((f) => L.push(`  - Follow-up ${f.date} (${f.by}): ${f.text.replace(/\n+/g, ' ')}`));

      });

    }

    return L.join('\n') + '\n';

  }



  // ---- sigil SVG ----

  const STATUS_LABEL = { exploratory: 'Exploratory mark', proposed: 'Proposed glyph', approved: 'Approved glyph (Author)' };

  const xmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  // Numbers only: anything else (e.g. text smuggled in through an import) becomes the neutral value.

  const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

  const markTransform = (m) => `translate(${num(m.tx, 0)} ${num(m.ty, 0)}) translate(100 100) scale(${num(m.s, 1)}) translate(-100 -100)`;

  const statementOf = (content) => {

    const b = content && Array.isArray(content.blocks) ? content.blocks.find((x) => x.heading === 'Statement of intent') : null;

    return b ? b.text.trim() : '';

  };



  function buildSvg(o) {

    const sg = o.sigil || { marks: [] };

    const intent = (o.intent || '').trim();

    const reading = sg.marks.map((m, i) => `${i + 1}. ${m.meaning || '(no meaning stated)'}${m.root ? ' [' + m.root + ']' : ''}, ${STATUS_LABEL[m.status] || m.status}`).join('; ');

    const meta = {

      source: 'Lattice Age Grimoire (local)', title: o.title || '', statementOfIntent: intent,

      marks: sg.marks.map((m) => ({ d: m.d, tx: num(m.tx, 0), ty: num(m.ty, 0), s: num(m.s, 1), status: m.status, meaning: m.meaning, root: m.root || '',

        rationale: { natural: m.natural || '', origin: m.origin || 'unknown (not recorded)', why: m.why || '', source: m.source || '' } })),

      exportedAt: o.date || '', exportedBy: o.by || ''

    };

    const cdata = JSON.stringify(meta, null, 1).replace(/]]>/g, ']]]]><![CDATA[>');

    return `<?xml version="1.0" encoding="UTF-8"?>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="600" height="600">

<title>${xmlEsc(o.title)}</title>

<desc>Statement of intent: ${xmlEsc(intent || '(not stated)')}. Reading: ${xmlEsc(reading || 'no marks')}. ${sg.marks.some((m) => m.status === 'approved') ? '' : 'No mark is an approved glyph; exploratory marks are dashed. '}Exported ${xmlEsc(o.date)} by ${xmlEsc(o.by)} from the Lattice Age Grimoire.</desc>

<metadata id="grimoire-sigil"><![CDATA[${cdata}]]></metadata>

<g fill="none" stroke="#2a2620" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">

${sg.marks.map((m) => `<path d="${xmlEsc(m.d)}" transform="${xmlEsc(markTransform(m))}" vector-effect="non-scaling-stroke" data-status="${xmlEsc(m.status)}" data-meaning="${xmlEsc(m.meaning)}" data-root="${xmlEsc(m.root)}"${m.status === 'exploratory' ? ' stroke-dasharray="6 5"' : ''}/>`).join('\n')}

</g>

</svg>

`;

  }



  const M = { FORMAT, SCHEMA_VERSION, ATT_ID, attachmentRefs, exportParts, CERTAINTY, RELATIONS, REL_CERTAINTY, derivationLoop, mergePlan, applyMerge, toMarkdown, normalize, validate, envelope, migrate, parseImport, summarize, statementOf, buildSvg, markTransform, STATUS_LABEL };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;

  else root.GrimoireModel = M;

})(typeof globalThis !== 'undefined' ? globalThis : this);

