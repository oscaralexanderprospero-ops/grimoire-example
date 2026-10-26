// Photos: only real images, content-addressed, never overwritten; carried through full exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createStore, sniffImage } from '../preview/storage.mjs';
import { Model, tempDir, richState } from './helpers.mjs';

// A real 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG_HEAD = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

test('only real JPEG/PNG/WebP/GIF bytes are accepted; same photo stored once', async () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPEG_HEAD), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  const t = await tempDir();
  try {
    const s = createStore(t.dir);
    const a = await s.addAttachment(PNG, 'image/png');
    assert.match(a.id, /^[0-9a-f]{32}\.png$/);
    const b = await s.addAttachment(PNG, 'image/png');
    assert.equal(b.id, a.id, 'content-addressed');
    assert.ok((await s.addAttachment(PNG, 'image/jpeg')).invalid, 'declared type must match the bytes');
    assert.ok((await s.addAttachment(Buffer.from('not an image at all'), 'image/png')).invalid);
    assert.deepEqual((await s.readAttachment(a.id)).buf, PNG);
    assert.equal(await s.readAttachment('../grimoire.json'), null);
  } finally { await t.cleanup(); }
});

test('photo references are found everywhere and travel in full exports', () => {
  const s = richState();
  const id = 'a'.repeat(32) + '.png';
  s.entries[0].versions[0].blocks[0].text += `\n\n![Staff top](att:${id})`;
  s.journal[0].photos = [{ id: 'b'.repeat(32) + '.jpg', caption: '' }];
  assert.deepEqual(Model.attachmentRefs(s), [id, 'b'.repeat(32) + '.jpg']);
  const file = JSON.stringify(Model.envelope(s, { attachments: { [id]: PNG.toString('base64') } }));
  const r = Model.parseImport(file);
  assert.deepEqual(r.errors, []);
  assert.equal(r.attachments[id], PNG.toString('base64'));
  assert.equal(r.warnings.filter((w) => /not included/.test(w)).length, 1, 'the missing journal photo is reported');
  const bad = JSON.parse(file); bad.attachments = { '../x.png': 'AAAA' };
  assert.equal(Model.parseImport(JSON.stringify(bad)).state, null);
  const t2 = richState(); t2.journal[0].photos = [{ id: '../../evil.png' }];
  assert.equal(Model.migrate(t2).state, null, 'photo ids must be content ids');
});

function start(dir, port) {
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [fileURLToPath(new URL('../preview/serve.mjs', import.meta.url)), '--port', String(port), '--data', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const timer = setTimeout(() => fail(new Error(out)), 8000);
    p.stdout.on('data', (d) => { out += d; if (out.includes('Data folder')) { clearTimeout(timer); ok(p); } });
    p.stderr.on('data', (d) => { out += d; });
  });
}
function req(port, method, path, body, headers = {}) {
  return new Promise((ok, fail) => {
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: Object.assign({ Host: `127.0.0.1:${port}` }, headers) }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => { const buf = Buffer.concat(c); let json = null; try { json = JSON.parse(buf); } catch { /* binary */ } ok({ status: res.statusCode, buf, json, headers: res.headers }); });
    });
    r.on('error', fail); if (body) r.write(body); r.end();
  });
}

test('server: upload, serve with safe headers, refuse non-images, other sites and mismatched ids', async () => {
  const t = await tempDir(); const P = 20000 + Math.floor(Math.random() * 20000);
  const p = await start(t.dir, P);
  try {
    const up = await req(P, 'POST', '/api/attachments', PNG, { 'Content-Type': 'image/png' });
    assert.equal(up.status, 200); const id = up.json.id;
    const get = await req(P, 'GET', '/attachments/' + id);
    assert.equal(get.status, 200); assert.deepEqual(get.buf, PNG);
    assert.equal(get.headers['content-type'], 'image/png');
    assert.equal(get.headers['x-content-type-options'], 'nosniff');
    assert.equal(get.headers['content-security-policy'], "default-src 'none'");
    assert.equal((await req(P, 'POST', '/api/attachments', Buffer.from('<svg/>'), { 'Content-Type': 'image/svg+xml' })).status, 415);
    assert.equal((await req(P, 'POST', '/api/attachments', Buffer.from('hello world, not png'), { 'Content-Type': 'image/png' })).status, 400);
    assert.equal((await req(P, 'POST', '/api/attachments', PNG, { 'Content-Type': 'image/png', Origin: 'http://evil.example' })).status, 403);
    assert.equal((await req(P, 'POST', '/api/attachments?expect=' + 'c'.repeat(32) + '.png', PNG, { 'Content-Type': 'image/png' })).status, 400);
    assert.equal((await req(P, 'GET', '/attachments/..%2Fgrimoire.json')).status, 404);
  } finally { p.kill(); await t.cleanup(); }
});
