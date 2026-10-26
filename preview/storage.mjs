// Durable local storage for the grimoire: one JSON file plus timestamped backups.

// - Atomic saves: write a temp file, flush it to disk, then rename over the old file.

// - Conflict detection: every save names the version (etag = hash of the state) it was based on.

//   If the file changed since (another tab, or Claude editing the file), the save is refused and

//   the refused copy is kept in backups, so nothing is lost either way.

// - Backups before imports, restores, migrations and conflict overwrites, plus a periodic one.

// - A corrupt data file is never overwritten by a normal save.

import { promises as fs } from 'node:fs';

import { createHash, randomBytes } from 'node:crypto';

import { join } from 'node:path';

import { createRequire } from 'node:module';



const require = createRequire(import.meta.url);

const Model = require('./model.js');



const FILE = 'grimoire.json';

const AUTO_BACKUP_MS = 15 * 60 * 1000;

const KEEP_AUTO = 60;          // routine backups kept

const PROTECTED = /-(import|restore|conflict-unsaved|conflict-overwrite|migrate|corrupt|before-restore)\.json$/;



// Photos: content-addressed (sha256), never overwritten or deleted. Only real JPEG/PNG/WebP/GIF bytes.

export const ATT_ID = /^[0-9a-f]{32}\.(jpg|png|webp|gif)$/;

export const ATT_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export const ATT_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

export function sniffImage(buf) {

  if (!buf || buf.length < 12) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';

  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';

  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';

  return null;

}



export const etagOf = (state) => createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 32);

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));



export function createStore(dir) {

  const file = join(dir, FILE);

  const backupDir = join(dir, 'backups');

  const attDir = join(dir, 'attachments');

  let chain = Promise.resolve();

  let lastAutoBackup = 0;

  // Serialize all writes through one queue within this process, and hold a lock file while writing so

  // another process (the CLI, a second server) can't slip a save in between our check and our rename.

  const lockFile = join(dir, 'grimoire.lock');

  async function withLock(fn) {

    await fs.mkdir(dir, { recursive: true });

    for (let i = 0; ; i++) {

      try { const h = await fs.open(lockFile, 'wx'); await h.writeFile(String(process.pid)); await h.close(); break; } catch (e) {

        if (e.code !== 'EEXIST') throw e;

        try { const st = await fs.stat(lockFile); if (Date.now() - st.mtimeMs > 30000) { await fs.rm(lockFile, { force: true }); continue; } } catch { continue; }

        if (i > 200) throw new Error('The grimoire is busy saving elsewhere; try again in a moment.');

        await sleep(25);

      }

    }

    try { return await fn(); } finally { await fs.rm(lockFile, { force: true }); }

  }

  const queue = (fn) => { const run = chain.then(() => withLock(fn), () => withLock(fn)); chain = run.catch(() => {}); return run; };



  async function ensureDirs() { await fs.mkdir(backupDir, { recursive: true }); }



  async function readRaw() {

    try { return await fs.readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }

  }



  // Returns { state, etag, schemaVersion, savedAt } | { state: null } | { error, raw }

  async function load() {

    const raw = await readRaw();

    if (raw === null) return { state: null, etag: null };

    let obj;

    try { obj = JSON.parse(raw); } catch (e) { return { error: `The data file ${file} is not valid JSON (${e.message}). It has not been changed. Restore a backup to continue.`, corrupt: true }; }

    const m = Model.migrate(obj);

    if (m.errors.length) return { error: `The data file could not be read: ${m.errors.join('; ')}. It has not been changed.`, corrupt: true };

    return { state: m.state, etag: etagOf(obj.state !== undefined ? obj.state : obj), schemaVersion: obj.schemaVersion || 0, savedAt: obj.savedAt || null, warnings: m.warnings };

  }



  async function writeAtomic(path, data) {

    const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;

    const fh = await fs.open(tmp, 'w');

    try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }

    for (let i = 0; ; i++) {

      try { await fs.rename(tmp, path); return; } catch (e) {

        if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { await fs.rm(tmp, { force: true }); throw e; }

        await sleep(40 * (i + 1));   // Windows: antivirus or an editor may briefly hold the file

      }

    }

  }



  async function backup(reason, text) {

    await ensureDirs();

    const content = text !== undefined ? text : await readRaw();

    if (content === null) return null;

    const name = `${stamp()}-${randomBytes(2).toString('hex')}-${reason}.json`;

    await writeAtomic(join(backupDir, name), content);

    await prune();

    return name;

  }



  async function prune() {

    const names = (await fs.readdir(backupDir)).filter((n) => n.endsWith('.json')).sort();

    const routine = names.filter((n) => !PROTECTED.test(n));

    for (const n of routine.slice(0, Math.max(0, routine.length - KEEP_AUTO))) await fs.rm(join(backupDir, n), { force: true });

  }



  function serialize(state, reason) {

    return JSON.stringify(Model.envelope(state, { savedAt: new Date().toISOString(), lastSaveReason: reason }), null, 1) + '\n';

  }



  // save(state, baseEtag, reason) -> { ok, etag } | { conflict, etag, state, backup } | { invalid: errors }

  // reason: 'edit' | 'seed' | 'import' | 'restore' | 'conflict-overwrite'

  function save(state, baseEtag, reason = 'edit') {

    return queue(async () => {

      const { errors } = Model.validate(state);

      if (errors.length) return { invalid: errors };

      await ensureDirs();

      const current = await load();

      if (current.corrupt) return { blocked: current.error };

      const curEtag = current.etag;

      if (curEtag !== (baseEtag || null) && reason !== 'conflict-overwrite') {

        const kept = await backup('conflict-unsaved', serialize(state, 'conflict-unsaved'));

        return { conflict: true, etag: curEtag, state: current.state, backup: kept };

      }

      if (current.state) {

        if (['import', 'restore', 'conflict-overwrite'].includes(reason)) await backup(reason === 'restore' ? 'before-restore' : reason);

        else if (current.schemaVersion < Model.SCHEMA_VERSION) await backup('migrate');

        else if (Date.now() - lastAutoBackup > AUTO_BACKUP_MS) { await backup('auto'); lastAutoBackup = Date.now(); }

      }

      await writeAtomic(file, serialize(state, reason));

      return { ok: true, etag: etagOf(state) };

    });

  }



  async function listBackups() {

    await ensureDirs();

    const names = (await fs.readdir(backupDir)).filter((n) => n.endsWith('.json')).sort().reverse();

    const out = [];

    for (const name of names) {

      const st = await fs.stat(join(backupDir, name));

      let summary = null;

      try { const m = Model.migrate(JSON.parse(await fs.readFile(join(backupDir, name), 'utf8'))); if (m.state) summary = Model.summarize(m.state); } catch { /* unreadable backup: listed without summary */ }

      out.push({ name, reason: name.replace(/^.*?-[0-9a-f]{4}-/, '').replace(/\.json$/, ''), size: st.size, modified: st.mtime.toISOString(), summary });

    }

    return out;

  }



  const safeName = (name) => /^[0-9TZ]+-[0-9a-f]{4}-[a-z-]+\.json$/.test(name);



  async function readBackup(name) {

    if (!safeName(name)) return { error: 'Unknown backup' };

    try { return Model.parseImport(await fs.readFile(join(backupDir, name), 'utf8')); } catch { return { error: 'Unknown backup' }; }

  }



  // Restore replaces the data file with a backup. The current file (even if corrupt) is backed up first.

  function restore(name) {

    return queue(async () => {

      const r = await readBackup(name);

      if (r.error || !r.state) return { invalid: r.errors || [r.error] };

      const current = await readRaw();

      if (current !== null) await backup('before-restore', current);

      await writeAtomic(file, serialize(r.state, 'restore'));

      return { ok: true, etag: etagOf(r.state), state: r.state };

    });

  }



  async function startupBackup() {

    const raw = await readRaw();

    if (raw === null) return null;

    const loaded = await load();

    return backup(loaded.corrupt ? 'corrupt' : 'startup', raw);

  }



  async function addAttachment(buf, declaredType) {

    const type = sniffImage(buf);

    if (!type) return { invalid: 'Only JPEG, PNG, WebP or GIF images can be added.' };

    if (declaredType && declaredType !== type) return { invalid: `The file says it is ${declaredType} but its contents are ${type}.` };

    const id = createHash('sha256').update(buf).digest('hex').slice(0, 32) + '.' + ATT_EXT[type];

    const path = join(attDir, id);

    try { await fs.access(path); } catch { await fs.mkdir(attDir, { recursive: true }); await writeAtomic(path, buf); }

    return { id, type };

  }

  async function readAttachment(id) {

    if (!ATT_ID.test(id)) return null;

    try { return { buf: await fs.readFile(join(attDir, id)), type: ATT_MIME[id.split('.')[1]] }; } catch { return null; }

  }



  return { dir, file, backupDir, attDir, load, save, listBackups, readBackup, restore, startupBackup, addAttachment, readAttachment };

}

