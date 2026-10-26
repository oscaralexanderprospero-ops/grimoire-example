// Chrome-only launcher and the occupied-port check. No browser window is ever opened by these tests:
// the launcher is stubbed, and the server is run with GRIMOIRE_LAUNCH_DRYRUN.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromeCandidates, findChrome, openInChrome } from '../preview/launch.mjs';
import { tempDir } from './helpers.mjs';

const URL1 = 'http://127.0.0.1:4317/';

test('Chrome is found only at its installed paths; never Edge or the default browser', () => {
  const env = { PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\LA' };
  const c = chromeCandidates(env);
  assert.ok(c.every((p) => /Google[\\/]Chrome[\\/]Application[\\/]chrome\.exe$/.test(p)));
  assert.ok(!c.some((p) => /edge|msedge/i.test(p)));
  assert.equal(findChrome({ env, exists: (p) => p.startsWith('C:\\LA') }), c[2]);
  assert.equal(findChrome({ env, exists: () => false }), null);
});

test('opening launches Chrome directly with the address as the only argument (no shell)', () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { on() {}, unref() {} }; };
  const r = openInChrome(URL1, { find: () => 'C:\\PF\\Google\\Chrome\\Application\\chrome.exe', spawn: fakeSpawn, log: () => {}, dryRun: false });
  assert.equal(r, 'opened');
  assert.equal(calls.length, 1);
  assert.match(calls[0].cmd, /chrome\.exe$/);
  assert.deepEqual(calls[0].args, [URL1], 'no flags, profiles or debugging ports');
  assert.equal(calls[0].opts.shell, false);
});

test('without Chrome nothing is opened; the address and a manual Chrome instruction are printed', () => {
  const logs = []; let spawned = false;
  const r = openInChrome(URL1, { find: () => null, spawn: () => { spawned = true; }, log: (m) => logs.push(m) });
  assert.equal(r, 'no-chrome');
  assert.equal(spawned, false);
  assert.match(logs[0], /Chrome was not found/);
  assert.match(logs[0], /http:\/\/127\.0\.0\.1:4317\//);
});

test('only the grimoire\'s own local address can be opened', () => {
  for (const bad of ['https://example.com/', 'http://127.0.0.1:4317/x', 'file:///C:/x', 'http://localhost:4317/']) {
    assert.throws(() => openInChrome(bad, { find: () => 'chrome.exe', spawn: () => ({}), log: () => {} }));
  }
});

function runServer(args, env) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [fileURLToPath(new URL('../preview/serve.mjs', import.meta.url)), ...args], { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { p.kill(); ok(out); }, 6000);
    p.on('exit', () => { clearTimeout(timer); ok(out); });
  });
}

test('occupied port: an unrelated service is NOT opened or called the grimoire; a real grimoire is', async () => {
  const t = await tempDir();
  const other = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end('{"app":"something-else"}'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const P = other.address().port;
  try {
    const out = await runServer(['--port', String(P), '--data', t.dir, '--open'], { GRIMOIRE_LAUNCH_DRYRUN: '1' });
    assert.match(out, /in use by something that is not the grimoire/);
    assert.doesNotMatch(out, /Would open in Chrome|already running/);
  } finally { other.close(); }
  // now a real grimoire on a port, and a second start with --open
  const P2 = 20000 + Math.floor(Math.random() * 20000);
  const g = spawn(process.execPath, [fileURLToPath(new URL('../preview/serve.mjs', import.meta.url)), '--port', String(P2), '--data', t.dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((r) => g.stdout.on('data', (d) => { if (String(d).includes('Data folder')) r(); }));
  try {
    const out = await runServer(['--port', String(P2), '--data', t.dir, '--open'], { GRIMOIRE_LAUNCH_DRYRUN: '1' });
    assert.match(out, /The grimoire is already running/);
    assert.match(out, /Would open in Chrome: .*chrome\.exe http:\/\/127\.0\.0\.1:\d+\/|Chrome was not found/);
  } finally { g.kill(); await t.cleanup(); }
});

test('the server no longer uses the shell "start" command (which picks the default browser)', () => {
  const src = readFileSync(new URL('../preview/serve.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bexec\(|start ""/);
});
