// Local server for the Lattice Age Grimoire. Loopback only (127.0.0.1); no dependencies.

// Serves the app from this folder and a small JSON API that saves to a local data folder.

// Usage: node preview/serve.mjs [--port 4317] [--data <folder>] [--open]

//   --open opens the grimoire in Google Chrome (never another browser) once the server is listening; if the

//   port is taken, it opens it only after confirming the grimoire itself is what's running there.

//   Defaults: port 4317, data folder <repo>/data (override with --data or GRIMOIRE_DATA).

import { createServer } from 'node:http';

import { openInChrome, isGrimoireAt } from './launch.mjs';

import { readFile } from 'node:fs/promises';

import { extname, join, normalize, resolve, sep } from 'node:path';

import { fileURLToPath } from 'node:url';

import { createStore, ATT_EXT } from './storage.mjs';

import { createPhone } from './phone.mjs';

import { createSyncStore } from './sync-store.mjs';

import Model from './model.js';

import { randomUUID } from 'node:crypto';



const ROOT = fileURLToPath(new URL('.', import.meta.url));

const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };

const PORT = Number(arg('port') || process.env.PORT) || 4317;

const DATA = resolve(arg('data') || process.env.GRIMOIRE_DATA || join(ROOT, '..', 'data'));

const MAX_BODY = 25 * 1024 * 1024;

const MAX_PHOTO = 15 * 1024 * 1024;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const STATIC_BLOCK = new Set(['serve.mjs', 'storage.mjs', 'phone.mjs', 'launch.mjs', 'sync-store.mjs']);   // server code is not served



const store = createStore(DATA);

const syncStore = createSyncStore(DATA, randomUUID(), Model.normalize({entries:[],journal:[]}));

async function captureSync() { const current=await store.load(); if(current.corrupt) throw Error(current.error); if(current.state) await syncStore.queue(current.state); return syncStore.read(); }

const phone = createPhone(DATA);   // inert unless data/phone.json enables it (see PHONE-APP.md)



const PAIR_PAGE = (msg) => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">

<title>Pair this phone</title><body style="margin:0;padding:24px;background:#2a2620;color:#f7f3ea;font:18px/1.5 Georgia,serif">

<h1 style="font-size:26px">Pair this phone with the grimoire</h1>

<p>On the laptop, open <b>Data and backups → Phone</b> and choose <b>Pair a phone</b>. Type the code it shows.</p>

${msg ? `<p style="background:#5c3d1f;padding:10px;border-radius:8px">${msg}</p>` : ''}

<form action="/pair" method="get"><label for="c">Code</label><br>

<input id="c" name="c" autocomplete="one-time-code" autocapitalize="characters" style="font:24px monospace;padding:10px;width:12ch;margin:8px 0">

<br><button style="font:600 18px system-ui;padding:12px 20px;border-radius:10px;border:0;background:#d29a5e;color:#2a2620">Pair</button></form></body>`;



function send(res, status, body, type = 'application/json') {

  const h = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

  // Pages may run only the app's own scripts (no inline script, no injected handlers) and can't be framed.

  if (type.startsWith('text/html')) h['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

  res.writeHead(status, h);

  res.end(type === 'application/json' ? JSON.stringify(body) : body);

}



// Reads a request body up to `limit` bytes. Too-large bodies get a clear 413 instead of a dropped

// connection: refused up front when the declared length is too big, otherwise read to the end (up to

// a hard cap) and discarded, so the browser receives the answer.

function readLimited(req, limit, what) {

  return new Promise((ok, fail) => {

    const tooBig = () => Object.assign(new Error(what), { status: 413 });

    const declared = Number(req.headers['content-length']);

    if (Number.isFinite(declared) && declared > limit * 4) { req.resume(); return fail(tooBig()); }

    let size = 0, over = false; const chunks = [];

    req.on('data', (c) => {

      size += c.length;

      if (size > limit) { over = true; chunks.length = 0; if (size > limit * 4) req.destroy(); }

      else if (!over) chunks.push(c);

    });

    req.on('end', () => (over ? fail(tooBig()) : ok(Buffer.concat(chunks))));

    req.on('error', fail);

  });

}

const readRaw = (req, limit) => readLimited(req, limit, `The photo is larger than ${limit / 1048576} MB.`);



async function readBody(req) {

  const buf = await readLimited(req, MAX_BODY, `The grimoire is too large to save in one piece (over ${MAX_BODY / 1048576} MB of text).`);

  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Body is not valid JSON'), { status: 400 }); }

}



// Only this machine's own pages may use the API: the Host must be loopback (blocks DNS rebinding),

// a cross-site Origin is refused, and writes must be JSON (which other sites cannot send without a preflight we never answer).

function allowed(req) {

  const host = (req.headers.host || '').toLowerCase();

  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return false;

  const origin = req.headers.origin;

  if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) return false;

  return true;

}



async function api(req, res, path) {

  if (!req.isPhone && !allowed(req)) return send(res, 403, { error: 'Forbidden' });

  // Phone management is laptop-only.

  if (path === '/api/sync/status' && req.method === 'GET') {

    const r = await captureSync();

    return send(res, 200, { enabled:false, reason:'Private sync activation awaits scoped authorization; no network transport configured.', queued:r.outbox.length, conflicts:r.conflicts, audit:r.audit });

  }

  if (path.startsWith('/api/phone')) {

    if (req.isPhone) return send(res, 403, { error: 'Phone settings can only be changed on the laptop' });

    if (path === '/api/phone' && req.method === 'GET') return send(res, 200, await phone.status());

    if (req.method !== 'POST' || !(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Expected JSON' });

    if (path === '/api/phone/pair') { const r = await phone.startPairing(); return send(res, r.error ? 409 : 200, r); }

    if (path === '/api/phone/forget') return send(res, 200, await phone.forgetAll());

    return send(res, 404, { error: 'Not found' });

  }

  if (path === '/api/attachments' && req.method === 'POST') {

    const type = (req.headers['content-type'] || '').split(';')[0].trim();

    if (!ATT_EXT[type]) return send(res, 415, { error: 'Only JPEG, PNG, WebP or GIF images' });

    const buf = await readRaw(req, MAX_PHOTO);

    const r = await store.addAttachment(buf, type);

    if (r.invalid) return send(res, 400, { error: r.invalid });

    const expect = new URL(req.url, 'http://127.0.0.1').searchParams.get('expect');

    if (expect && expect !== r.id) return send(res, 400, { error: 'The photo does not match its recorded id', id: r.id });

    return send(res, 200, { id: r.id });

  }

  if (req.method !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Expected JSON' });



  if (path === '/api/hello' && req.method === 'GET') return send(res, 200, { app: 'lattice-age-grimoire' });   // identity check for --open

  if (path === '/api/state' && req.method === 'GET') {

    const r = await store.load();

    if (r.corrupt) return send(res, 500, { error: r.error, corrupt: true, dataDir: DATA });

    return send(res, 200, { state: r.state, etag: r.etag, savedAt: r.savedAt || null, dataDir: DATA, warnings: r.warnings || [] });

  }

  if (path === '/api/state' && req.method === 'PUT') {

    const body = await readBody(req);

    const reason = ['edit', 'seed', 'import', 'conflict-overwrite'].includes(body.reason) ? body.reason : 'edit';

    const r = await store.save(body.state, body.baseEtag || null, reason);

    if (r.invalid) return send(res, 400, { error: 'Not saved: the data did not pass validation', details: r.invalid });

    if (r.blocked) return send(res, 500, { error: r.blocked, corrupt: true });

    if (r.conflict) return send(res, 409, { error: 'Changed elsewhere since you loaded it', etag: r.etag, state: r.state, keptAs: r.backup });

    let syncWarning=null; try { await captureSync(); } catch(e) { syncWarning='Saved locally; sync queue needs recovery: '+e.message; }

    return send(res, 200, { etag: r.etag, savedAt: new Date().toISOString(), syncWarning });

  }

  if (path === '/api/backups' && req.method === 'GET') return send(res, 200, { backups: await store.listBackups(), dir: store.backupDir });

  if (path.startsWith('/api/backups/') && req.method === 'GET') {

    const r = await store.readBackup(decodeURIComponent(path.slice('/api/backups/'.length)));

    if (r.error || !r.state) return send(res, 404, { error: r.error || 'Unreadable backup', details: r.errors });

    return send(res, 200, { state: r.state, warnings: r.warnings });

  }

  if (path === '/api/restore' && req.method === 'POST') {

    const body = await readBody(req);

    const r = await store.restore(String(body.name || ''));

    if (r.invalid) return send(res, 400, { error: 'Backup could not be restored', details: r.invalid });

    let syncWarning=null; try { await captureSync(); } catch(e) { syncWarning='Restored locally; sync queue needs recovery: '+e.message; }

    return send(res, 200, { etag: r.etag, state: r.state, syncWarning });

  }

  return send(res, 404, { error: 'Not found' });

}



const server = createServer(async (req, res) => {

  try {

    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);

    const ph = await phone.check(req);

    if (ph === 'deny') return send(res, 403, 'Forbidden', 'text/plain');

    if (ph === 'unpaired' || (ph === 'ok' && path === '/pair')) {

      if (path === '/pair' && req.method === 'GET') {

        const r = await phone.completePairing(new URL(req.url, 'http://x').searchParams.get('c'), req.headers['user-agent']);

        if (r.error) return send(res, 400, PAIR_PAGE(r.error), 'text/html; charset=utf-8');

        res.writeHead(302, { 'Set-Cookie': r.cookie, Location: '/', 'Cache-Control': 'no-store' });

        return res.end();

      }

      if (ph === 'unpaired') return send(res, 401, path.startsWith('/api/') ? { error: 'This phone is not paired' } : PAIR_PAGE(''), path.startsWith('/api/') ? 'application/json' : 'text/html; charset=utf-8');

    }

    req.isPhone = ph === 'ok';

    if (path.startsWith('/api/')) return await api(req, res, path);

    if (path.startsWith('/attachments/') && (req.method === 'GET' || req.method === 'HEAD')) {

      if (!req.isPhone && !allowed(req)) return send(res, 403, 'Forbidden', 'text/plain');

      const a = await store.readAttachment(path.slice('/attachments/'.length));

      if (!a) return send(res, 404, 'Not found', 'text/plain');

      res.writeHead(200, { 'Content-Type': a.type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });

      return res.end(a.buf);

    }

    if (!req.isPhone && !allowed(req)) return send(res, 403, 'Forbidden', 'text/plain');   // app files too: laptop or paired phone only

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');

    const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));

    const base = file.slice(ROOT.length).replace(/\\/g, '/');

    if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) || !TYPES[extname(file)] || STATIC_BLOCK.has(base.toLowerCase())) return send(res, 404, 'Not found', 'text/plain');

    send(res, 200, await readFile(file), TYPES[extname(file)]);

  } catch (e) {

    if (!res.headersSent) {

      if (e.status === 413) res.setHeader('Connection', 'close');

      send(res, e.status || (e.code === 'ENOENT' ? 404 : 500), { error: e.status || e.code === 'ENOENT' ? e.message : 'Server error' });

    }

    if (!e.status && e.code !== 'ENOENT') console.error(e);

  }

});



server.on('error', (e) => {

  if (e.code === 'EADDRINUSE') {

    // Never assume: only treat the port as the grimoire if it says so.

    isGrimoireAt(PORT).then((ours) => {

      if (ours) {

        console.log(`The grimoire is already running at http://127.0.0.1:${PORT}/`);

        if (process.argv.includes('--open')) openInChrome(`http://127.0.0.1:${PORT}/`);

      } else {

        console.error(`Port ${PORT} is in use by something that is not the grimoire, so nothing was opened. Start the grimoire on another port, e.g. node preview/serve.mjs --port 4318`);

      }

      setTimeout(() => process.exit(1), 300);

    });

    return;

  }

  console.error(e);

  process.exit(1);

});



await store.startupBackup().catch((e) => console.error('Startup backup failed:', e.message));

server.listen(PORT, '127.0.0.1', () => {

  console.log(`Grimoire: http://127.0.0.1:${PORT}/`);

  console.log(`Data folder: ${DATA}`);

  console.log('Leave this window open while using the grimoire. To stop it, close this window or press Ctrl+C.');

  if (process.argv.includes('--open')) openInChrome(`http://127.0.0.1:${PORT}/`);

});

