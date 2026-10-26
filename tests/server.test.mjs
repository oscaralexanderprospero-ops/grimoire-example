// Starts the real server on a random port with a temporary data folder, then stops it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { tempDir, sampleState, richState } from './helpers.mjs';

const SERVER = fileURLToPath(new URL('../preview/serve.mjs', import.meta.url));

function start(dir, port) {
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [SERVER, '--port', String(port), '--data', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => fail(new Error('server did not start: ' + out)), 8000);
    p.stdout.on('data', (d) => { out += d; if (out.includes('Data folder')) { clearTimeout(timer); ok(p); } });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => { clearTimeout(timer); fail(new Error(`server exited ${code}: ${out}`)); });
  });
}
const stop = (p) => new Promise((r) => { p.removeAllListeners('exit'); p.on('exit', r); p.kill(); });

function req(port, method, path, body, headers = {}) {
  return new Promise((ok, fail) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: Object.assign({ Host: `127.0.0.1:${port}` }, data !== undefined ? { 'Content-Type': 'application/json' } : {}, headers) }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch { /* not json */ } ok({ status: res.statusCode, json, text: t, headers: res.headers }); });
    });
    r.on('error', fail);
    if (data !== undefined) r.write(data);
    r.end();
  });
}
const port = () => 20000 + Math.floor(Math.random() * 20000);

test('server: save, restart, and the data is still there', async () => {
  const t = await tempDir(); const P = port();
  let p = await start(t.dir, P);
  try {
    let r = await req(P, 'GET', '/api/state');
    assert.equal(r.status, 200); assert.equal(r.json.state, null);
    const s = richState();
    r = await req(P, 'PUT', '/api/state', { baseEtag: null, reason: 'seed', state: s });
    assert.equal(r.status, 200); const etag = r.json.etag;
    await stop(p); p = await start(t.dir, P);
    r = await req(P, 'GET', '/api/state');
    assert.deepEqual(r.json.state, s);
    assert.equal(r.json.etag, etag);
    // stale save → 409 with the current state
    r = await req(P, 'PUT', '/api/state', { baseEtag: 'old', reason: 'edit', state: sampleState() });
    assert.equal(r.status, 409); assert.deepEqual(r.json.state, s); assert.ok(r.json.keptAs);
    // invalid → 400, nothing changes
    r = await req(P, 'PUT', '/api/state', { baseEtag: etag, reason: 'edit', state: { entries: 'nope', journal: [] } });
    assert.equal(r.status, 400);
    r = await req(P, 'GET', '/api/state'); assert.equal(r.json.etag, etag);
    // backups list and restore (startup backups exist after the restart)
    r = await req(P, 'GET', '/api/backups');
    assert.ok(r.json.backups.some((b) => b.reason === 'startup'));
  } finally { await stop(p); await t.cleanup(); }
});

test('server: refuses other sites and non-JSON writes; serves the app but not server code', async () => {
  const t = await tempDir(); const P = port();
  const p = await start(t.dir, P);
  try {
    assert.equal((await req(P, 'GET', '/api/state', undefined, { Host: 'evil.example' })).status, 403, 'foreign Host (DNS rebinding)');
    assert.equal((await req(P, 'PUT', '/api/state', { state: sampleState() }, { Origin: 'http://evil.example' })).status, 403, 'cross-site Origin');
    assert.equal((await req(P, 'PUT', '/api/state', 'x', { 'Content-Type': 'text/plain' })).status, 415, 'non-JSON write');
    const idx = await req(P, 'GET', '/');
    assert.equal(idx.status, 200); assert.match(idx.text, /Lattice Age Grimoire/);
    assert.equal((await req(P, 'GET', '/model.js')).status, 200);
    assert.equal((await req(P, 'GET', '/serve.mjs')).status, 404);
    assert.equal((await req(P, 'GET', '/storage.mjs')).status, 404);
    assert.equal((await req(P, 'GET', '/../README.md')).status, 404);
    assert.equal((await req(P, 'GET', '/%2e%2e/README.md')).status, 404);
  } finally { await stop(p); await t.cleanup(); }
});
