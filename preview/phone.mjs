// Optional phone access, modelled on the OMS Control Room's phone door. OFF unless data/phone.json says

// { "enabled": true, "host": "<laptop's Tailscale name>", "login": "<Tailscale login>" } — which only

// Author creates (tools/phone.mjs). The server still listens on 127.0.0.1 only; the phone's requests

// arrive through `tailscale serve` on the laptop, which proxies them to loopback and adds the

// Tailscale-User-Login header. A phone request is let in only when ALL hold:

//   - it came from loopback (i.e. via tailscale serve), and its Host is exactly the configured name;

//   - Tailscale-User-Login matches the configured login;

//   - it carries a device cookie whose SHA-256 is in the paired-devices list (except /pair itself);

//   - writes also need a matching Origin.

// Pairing: on the laptop, "Pair a phone" makes a one-time 8-character code (10 minutes). The phone

// opens /pair?c=CODE and receives a 180-day httponly device cookie. "Forget all phones" revokes them.

import { promises as fs } from 'node:fs';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { join } from 'node:path';



const COOKIE = 'grimoire_phone';

const CODE_MS = 10 * 60 * 1000;

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I



export function createPhone(dataDir) {

  const file = join(dataDir, 'phone.json');

  async function read() {

    try { const c = JSON.parse(await fs.readFile(file, 'utf8')); return c && typeof c === 'object' ? c : null; } catch { return null; }

  }

  async function write(c) {

    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;

    await fs.writeFile(tmp, JSON.stringify(c, null, 1)); await fs.rename(tmp, file);

  }

  // Pairing, forgetting and code creation read-modify-write phone.json: run them one at a time.

  let chain = Promise.resolve();

  const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

  const ready = (c) => !!(c && c.enabled === true && typeof c.host === 'string' && c.host && typeof c.login === 'string' && c.login);

  const cookieOf = (req) => { const m = /(?:^|;\s*)grimoire_phone=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || ''); return m ? m[1] : null; };

  const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

  const scheme = (c) => (c.scheme === 'https' ? 'https' : 'http');



  // Returns 'no' (not a phone request), 'deny', 'unpaired' (right phone route but no valid cookie), or 'ok'.

  async function check(req) {

    const c = await read();

    if (!ready(c)) return 'no';

    const host = (req.headers.host || '').toLowerCase();

    if (host !== c.host.toLowerCase()) return 'no';

    if (!isLoopback(req)) return 'deny';

    const login = req.headers['tailscale-user-login'] || '';

    if (login.toLowerCase() !== c.login.toLowerCase()) return 'deny';

    const origin = req.headers.origin;

    if (origin && origin !== `${scheme(c)}://${c.host}`) return 'deny';

    const tok = cookieOf(req);

    if (!tok || !c.devices || !c.devices[sha(tok)]) return 'unpaired';

    return 'ok';

  }



  async function status() {

    const c = await read();

    return { configured: !!c, enabled: ready(c), host: c && c.host || '', login: c && c.login ? c.login.replace(/^(.).*(@.*)$/, '$1…$2') : '', scheme: c ? scheme(c) : 'http', devices: c && c.devices ? Object.keys(c.devices).length : 0 };

  }



  const startPairing = () => serial(startPairingNow);

  const completePairing = (code, device) => serial(() => completePairingNow(code, device));

  const forgetAll = () => serial(forgetAllNow);

  async function startPairingNow() {

    const c = await read();

    if (!ready(c)) return { error: 'Phone access is not enabled.' };

    const code = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

    c.pairing = { hash: sha(code), expires: Date.now() + CODE_MS };

    await write(c);

    return { code, url: `${scheme(c)}://${c.host}/pair?c=${code}`, expires: c.pairing.expires };

  }



  // Called for GET /pair?c=CODE on a phone request (check() returned 'unpaired' or 'ok').

  async function completePairingNow(code, device) {

    const c = await read();

    if (!ready(c) || !c.pairing || Date.now() > c.pairing.expires) return { error: 'That code has expired. Make a new one on the laptop.' };

    const a = Buffer.from(sha(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))), b = Buffer.from(c.pairing.hash);

    if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: 'That code is not right. Check it, or make a new one on the laptop.' };

    const tok = randomBytes(32).toString('base64url');

    c.devices = c.devices || {};

    c.devices[sha(tok)] = { added: new Date().toISOString(), device: String(device || '').slice(0, 120) };

    delete c.pairing;                                      // one-time

    await write(c);

    return { cookie: `${COOKIE}=${tok}; Path=/; Max-Age=${180 * 24 * 3600}; HttpOnly; SameSite=Lax${c.scheme === 'https' ? '; Secure' : ''}` };

  }



  async function forgetAllNow() {

    const c = await read();

    if (!c) return { ok: true };

    c.devices = {}; delete c.pairing;

    await write(c);

    return { ok: true };

  }



  return { file, check, status, startPairing, completePairing, forgetAll };

}

