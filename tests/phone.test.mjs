// Phone access gate (prepared, off by default). Simulates requests as `tailscale serve` would forward

// them (from loopback, with the tailnet Host and Tailscale-User-Login header). No real network or Tailscale.

import test from 'node:test';

import assert from 'node:assert/strict';

import { spawn } from 'node:child_process';

import { fileURLToPath } from 'node:url';

import { writeFile, readFile } from 'node:fs/promises';

import { join } from 'node:path';

import http from 'node:http';

import { tempDir, richState } from './helpers.mjs';



const HOST = 'example.invalid';

const LOGIN = 'author@example.com';



function start(dir, port) {

  return new Promise((ok, fail) => {

    const p = spawn(process.execPath, [fileURLToPath(new URL('../preview/serve.mjs', import.meta.url)), '--port', String(port), '--data', dir], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = ''; const timer = setTimeout(() => fail(new Error(out)), 8000);

    p.stdout.on('data', (d) => { out += d; if (out.includes('Data folder')) { clearTimeout(timer); ok(p); } });

    p.stderr.on('data', (d) => { out += d; });

  });

}

function req(port, method, path, { body, headers = {} } = {}) {

  return new Promise((ok, fail) => {

    const data = body === undefined ? undefined : JSON.stringify(body);

    const r = http.request({ host: '127.0.0.1', port, method, path, headers: Object.assign(data ? { 'Content-Type': 'application/json' } : {}, headers) }, (res) => {

      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch { /* html */ } ok({ status: res.statusCode, text: t, json, headers: res.headers }); });

    });

    r.on('error', fail); if (data) r.write(data); r.end();

  });

}

const phoneHeaders = (extra = {}) => Object.assign({ Host: HOST, 'Tailscale-User-Login': LOGIN }, extra);



async function withServer(phoneJson, fn) {

  const t = await tempDir(); const P = 20000 + Math.floor(Math.random() * 20000);

  if (phoneJson) await writeFile(join(t.dir, 'phone.json'), JSON.stringify(phoneJson));

  const p = await start(t.dir, P);

  const laptop = { Host: `127.0.0.1:${P}` };

  try {

    await req(P, 'PUT', '/api/state', { body: { baseEtag: null, reason: 'seed', state: richState() }, headers: laptop });

    await fn(P, laptop, t.dir);

  } finally { p.kill(); await t.cleanup(); }

}



test('without phone.json (the default), a tailnet-style request is refused and the laptop works as before', () => withServer(null, async (P, laptop) => {

  assert.equal((await req(P, 'GET', '/api/state', { headers: phoneHeaders() })).status, 403);

  assert.equal((await req(P, 'GET', '/api/state', { headers: laptop })).status, 200);

  assert.equal((await req(P, 'GET', '/', { headers: phoneHeaders() })).status, 403, 'even the app files are refused');

  assert.equal((await req(P, 'GET', '/app.js', { headers: { Host: 'evil.example' } })).status, 403);

  assert.equal((await req(P, 'GET', '/', { headers: laptop })).status, 200);

  const st = await req(P, 'GET', '/api/phone', { headers: laptop });

  assert.equal(st.json.enabled, false);

  assert.equal((await req(P, 'POST', '/api/phone/pair', { body: {}, headers: laptop })).status, 409, 'cannot pair while disabled');

}));



test('enabled: unpaired phone gets the pairing page; one-time code pairs it; forgetting revokes it', () => withServer({ enabled: true, host: HOST, login: LOGIN }, async (P, laptop, dir) => {

  const unpaired = await req(P, 'GET', '/', { headers: phoneHeaders() });

  assert.equal(unpaired.status, 401);

  assert.match(unpaired.text, /Pair this phone/);

  assert.equal((await req(P, 'GET', '/api/state', { headers: phoneHeaders() })).status, 401);

  // wrong Tailscale login or missing header → refused outright

  assert.equal((await req(P, 'GET', '/', { headers: phoneHeaders({ 'Tailscale-User-Login': 'someone@else.com' }) })).status, 403);

  assert.equal((await req(P, 'GET', '/', { headers: { Host: HOST } })).status, 403);

  // pairing can only be started from the laptop

  assert.equal((await req(P, 'POST', '/api/phone/pair', { body: {}, headers: phoneHeaders() })).status, 401);

  const pair = await req(P, 'POST', '/api/phone/pair', { body: {}, headers: laptop });

  assert.equal(pair.status, 200);

  assert.match(pair.json.code, /^[A-Z2-9]{8}$/);

  assert.equal((await req(P, 'GET', '/pair?c=WRONGCOD', { headers: phoneHeaders() })).status, 400);

  const ok = await req(P, 'GET', `/pair?c=${pair.json.code}`, { headers: phoneHeaders({ 'User-Agent': 'TestPhone' }) });

  assert.equal(ok.status, 302);

  const cookie = ok.headers['set-cookie'][0];

  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);

  const jar = cookie.split(';')[0];

  assert.equal((await req(P, 'GET', `/pair?c=${pair.json.code}`, { headers: phoneHeaders() })).status, 400, 'code is one-time');

  const saved = JSON.parse(await readFile(join(dir, 'phone.json'), 'utf8'));

  assert.ok(!JSON.stringify(saved).includes(jar.split('=')[1]), 'only a hash of the device token is stored');

  // paired phone can use the app and API, but not phone settings

  const st = await req(P, 'GET', '/api/state', { headers: phoneHeaders({ Cookie: jar }) });

  assert.equal(st.status, 200); assert.ok(st.json.state);

  assert.equal((await req(P, 'GET', '/', { headers: phoneHeaders({ Cookie: jar }) })).status, 200);

  assert.equal((await req(P, 'POST', '/api/phone/forget', { body: {}, headers: phoneHeaders({ Cookie: jar }) })).status, 403);

  // writes need the matching Origin

  const put = { baseEtag: st.json.etag, reason: 'edit', state: st.json.state };

  assert.equal((await req(P, 'PUT', '/api/state', { body: put, headers: phoneHeaders({ Cookie: jar, Origin: 'http://evil.example' }) })).status, 403);

  assert.equal((await req(P, 'PUT', '/api/state', { body: put, headers: phoneHeaders({ Cookie: jar, Origin: `http://${HOST}` }) })).status, 200);

  // a request that did not come through loopback is impossible to fake here, but a wrong Host is just "not a phone"

  assert.equal((await req(P, 'GET', '/api/state', { headers: { Host: 'wrong.example.invalid', 'Tailscale-User-Login': LOGIN, Cookie: jar } })).status, 403);

  // forget all phones (laptop) → cookie no longer works

  assert.equal((await req(P, 'POST', '/api/phone/forget', { body: {}, headers: laptop })).status, 200);

  assert.equal((await req(P, 'GET', '/api/state', { headers: phoneHeaders({ Cookie: jar }) })).status, 401);

}));



test('an expired pairing code is refused', () => withServer({ enabled: true, host: HOST, login: LOGIN }, async (P, laptop, dir) => {

  const pair = await req(P, 'POST', '/api/phone/pair', { body: {}, headers: laptop });

  const cfg = JSON.parse(await readFile(join(dir, 'phone.json'), 'utf8'));

  cfg.pairing.expires = Date.now() - 1000;

  await writeFile(join(dir, 'phone.json'), JSON.stringify(cfg));

  const r = await req(P, 'GET', `/pair?c=${pair.json.code}`, { headers: phoneHeaders() });

  assert.equal(r.status, 400); assert.match(r.text, /expired/);

}));



test('tools/phone.mjs: off by default; enable validates its inputs; disable and forget work', async () => {

  const { run } = await import('../tools/phone.mjs');

  const t = await tempDir();

  const lines = []; const cli = (...a) => run(a.concat(['--data', t.dir]), (l) => lines.push(l));

  try {

    await cli('status'); assert.match(lines.pop(), /off \(the default\)/);

    await assert.rejects(cli('enable', '--host', 'not a host', '--login', 'x@y'), /Tailscale name/);

    await assert.rejects(cli('enable', '--host', HOST), /--login/);

    await cli('enable', '--host', HOST, '--login', LOGIN);

    let c = JSON.parse(await readFile(join(t.dir, 'phone.json'), 'utf8'));

    assert.deepEqual([c.enabled, c.host, c.scheme], [true, HOST, 'http']);

    c.devices = { abc: { added: 'x' } }; await writeFile(join(t.dir, 'phone.json'), JSON.stringify(c));

    await cli('disable'); c = JSON.parse(await readFile(join(t.dir, 'phone.json'), 'utf8'));

    assert.equal(c.enabled, false); assert.ok(c.devices.abc, 'disable keeps pairings until forget');

    await cli('forget'); c = JSON.parse(await readFile(join(t.dir, 'phone.json'), 'utf8'));

    assert.deepEqual(c.devices, {});

  } finally { await t.cleanup(); }

});

