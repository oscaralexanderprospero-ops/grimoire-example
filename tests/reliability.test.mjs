// Reliability audit (22 Oct): full export → import into a fresh grimoire with photos referenced only from
// places that are easy to miss (an old revision, an unsaved draft, a declined suggestion, the journal,
// a correspondence note); size limits answer clearly. Synthetic data, temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { Model, tempDir, richState } from './helpers.mjs';

const SERVER = fileURLToPath(new URL('../preview/serve.mjs', import.meta.url));
function start(dir, port) {
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [SERVER, '--port', String(port), '--data', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const timer = setTimeout(() => fail(new Error(out)), 8000);
    p.stdout.on('data', (d) => { out += d; if (out.includes('Data folder')) { clearTimeout(timer); ok(p); } });
    p.stderr.on('data', (d) => { out += d; });
  });
}
function req(port, method, path, { body, type, chunked } = {}) {
  return new Promise((ok, fail) => {
    const data = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const headers = { Host: `127.0.0.1:${port}` };
    if (data) headers['Content-Type'] = type || 'application/json';
    if (data && !chunked) headers['Content-Length'] = data.length;
    const r = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => { const buf = Buffer.concat(c); let json = null; try { json = JSON.parse(buf); } catch { /* binary */ } ok({ status: res.statusCode, buf, json }); });
    });
    r.on('error', fail);
    if (data) { if (chunked) { for (let i = 0; i < data.length; i += 1 << 20) r.write(data.subarray(i, i + (1 << 20))); } else r.write(data); }
    r.end();
  });
}
const port = () => 20000 + Math.floor(Math.random() * 20000);
// Distinct real PNGs: a 1×1 PNG with a varying tEXt chunk (still valid PNG bytes; the sniffer checks the signature).
const BASE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = (n) => Buffer.concat([BASE.subarray(0, BASE.length - 12), Buffer.from(`tag-${n}`), BASE.subarray(BASE.length - 12)]);

test('size limits answer with a clear 413 (photo with and without a declared length; oversized save)', async () => {
  const t = await tempDir(); const P = port(); const p = await start(t.dir, P);
  try {
    const big = Buffer.alloc(16 * 1024 * 1024); BASE.copy(big);
    let r = await req(P, 'POST', '/api/attachments', { body: big, type: 'image/png' });
    assert.equal(r.status, 413); assert.match(r.json.error, /larger than 15 MB/);
    r = await req(P, 'POST', '/api/attachments', { body: big, type: 'image/png', chunked: true });
    assert.equal(r.status, 413, 'no Content-Length: read to the end, then refused');
    const ok = await req(P, 'POST', '/api/attachments', { body: png(1), type: 'image/png' });
    assert.equal(ok.status, 200, 'the server still works after refusing');
    const huge = richState(); huge.entries[0].versions[0].blocks[0].text = 'x'.repeat(26 * 1024 * 1024);
    r = await req(P, 'PUT', '/api/state', { body: { baseEtag: null, reason: 'seed', state: huge } });
    assert.equal(r.status, 413); assert.match(r.json.error, /too large to save/);
  } finally { p.kill(); await t.cleanup(); }
});

test('photo references in correspondence notes (and their earlier wording) are exported too', () => {
  const s = richState();
  const a = 'a'.repeat(32) + '.png', b = 'b'.repeat(32) + '.png';
  s.correspondences = [{ id: 'c1', item: 'Oak', association: 'x', certainty: 'personal', note: `![bark](att:${a})`, history: [{ note: `![old](att:${b})` }] }];
  assert.deepEqual(Model.attachmentRefs(s), [a, b]);
});

test('export pieces join into valid JSON; bad photo entries are skipped without breaking the file', () => {
  const s = richState();
  const good = 'c'.repeat(32) + '.png';
  const parts = Model.exportParts(s, { 'zz-not-an-id': 'AAAA', [good]: png(9).toString('base64'), ['d'.repeat(32) + '.png']: 'not base64!' }, { exportedAt: 'now', note: 'n "quoted"' });
  const r = Model.parseImport(parts.join(''));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.state, s);
  assert.deepEqual(Object.keys(r.attachments), [good]);
  const none = Model.parseImport(Model.exportParts(s, {}, {}).join(''));
  assert.deepEqual(none.errors, []); assert.deepEqual(none.attachments, {});
});

test('full round trip into an empty grimoire: photos only in an old revision, a draft, a declined suggestion, the journal and a note all arrive intact; history, drafts, declined suggestions and undo survive', async () => {
  const A = await tempDir(), B = await tempDir(); const PA = port(), PB = PA + 1;
  const sa = await start(A.dir, PA), sb = await start(B.dir, PB);
  try {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await req(PA, 'POST', '/api/attachments', { body: png(i), type: 'image/png' })).json.id);
    const s = richState();
    const collar = s.entries.find((e) => e.id === 'example-1');
    collar.versions[0].blocks[0].text += `\n\n![only in version 1](att:${ids[0]})`;          // old revision only
    s.drafts['example-3'].blocks[0].text += `\n\n![draft photo](att:${ids[1]})`;      // unsaved draft
    collar.pending.find((p) => p.status === 'declined').content.blocks.push({ kind: 'proposal', by: 'Kimi', heading: 'h', text: `![declined](att:${ids[2]})` });
    s.journal[0].photos = [{ id: ids[3], caption: 'at the walk' }];
    s.correspondences = [{ id: 'c1', item: 'Oak', association: 'endurance', certainty: 'personal', note: `![bark](att:${ids[4]})` }];
    assert.equal((await req(PA, 'PUT', '/api/state', { body: { baseEtag: null, reason: 'seed', state: s } })).status, 200);
    // export from A, as the app does: state + every referenced photo
    const saved = (await req(PA, 'GET', '/api/state')).json.state;
    const refs = Model.attachmentRefs(saved);
    assert.deepEqual(refs.slice().sort(), ids.slice().sort(), 'every hidden reference is found');
    const photos = {};
    for (const id of refs) photos[id] = (await req(PA, 'GET', '/attachments/' + id)).buf.toString('base64');
    const file = Model.exportParts(saved, photos, { exportedAt: 'now' }).join('');
    // import into the empty grimoire B, as the app does: photos first (each checked against its id), then the state
    const imp = Model.parseImport(file);
    assert.deepEqual(imp.errors, []); assert.deepEqual(imp.warnings, []);
    for (const id of Object.keys(imp.attachments)) {
      const up = await req(PB, 'POST', `/api/attachments?expect=${id}`, { body: Buffer.from(imp.attachments[id], 'base64'), type: 'image/png' });
      assert.equal(up.status, 200, id);
    }
    assert.equal((await req(PB, 'PUT', '/api/state', { body: { baseEtag: null, reason: 'import', state: imp.state } })).status, 200);
    for (let i = 0; i < 5; i++) {
      const got = await req(PB, 'GET', '/attachments/' + ids[i]);
      assert.equal(got.status, 200);
      assert.equal(createHash('sha256').update(got.buf).digest('hex'), createHash('sha256').update(png(i)).digest('hex'));
    }
    const back = (await req(PB, 'GET', '/api/state')).json.state;
    assert.deepEqual(back, saved, 'versions, drafts, declined suggestions, journal, correspondences and undo identical');
    assert.equal(back.undo.length, saved.undo.length);
    // a tampered photo in an import file is refused, so the import stops before any entry changes
    const bad = Buffer.from(imp.attachments[ids[0]], 'base64'); bad[bad.length - 20] ^= 1;
    assert.equal((await req(PB, 'POST', `/api/attachments?expect=${ids[0]}`, { body: bad, type: 'image/png' })).status, 400);
  } finally { sa.kill(); sb.kill(); await A.cleanup(); await B.cleanup(); }
});
