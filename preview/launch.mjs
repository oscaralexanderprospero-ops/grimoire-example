// Opening the grimoire in a browser (start-grimoire.cmd → serve.mjs --open). Owner rule: Chrome only, never
// Edge or "the default browser". Chrome is launched directly from its installed path with the address as a
// single argument (no shell, no flags, no profile or debugging options). If Chrome isn't found, the address
// is printed with a manual instruction instead — there is no fallback to another browser.
import { existsSync } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import { join } from 'node:path';

export function chromeCandidates(env = process.env) {
  return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'], env.LOCALAPPDATA]
    .filter(Boolean)
    .map((base) => join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
}

export function findChrome({ env = process.env, exists = existsSync } = {}) {
  return chromeCandidates(env).find((p) => exists(p)) || null;
}

// Returns 'opened' | 'dry-run' | 'no-chrome'. spawn and log are injectable for tests.
export function openInChrome(url, { find = findChrome, spawn = nodeSpawn, log = console.log, dryRun = !!process.env.GRIMOIRE_LAUNCH_DRYRUN } = {}) {
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}\/$/.test(url)) throw new Error('Only the grimoire\'s own local address is opened');
  const chrome = find();
  if (!chrome) {
    log(`Google Chrome was not found, so nothing was opened. Open Chrome yourself and go to ${url}`);
    return 'no-chrome';
  }
  if (dryRun) { log(`Would open in Chrome: ${chrome} ${url}`); return 'dry-run'; }
  const child = spawn(chrome, [url], { detached: true, stdio: 'ignore', shell: false });
  if (child && child.on) child.on('error', () => log(`Chrome could not be started. Open Chrome yourself and go to ${url}`));
  if (child && child.unref) child.unref();
  return 'opened';
}

// Is the thing listening on this port really the grimoire? Asks its identity endpoint over loopback.
export async function isGrimoireAt(port, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`http://127.0.0.1:${port}/api/hello`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
    const j = await r.json();
    return j && j.app === 'lattice-age-grimoire';
  } catch {
    return false;
  }
}
