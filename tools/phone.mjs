// Turns the grimoire's optional phone access on or off (writes data/phone.json). Nothing here opens

// a network port: the server stays on 127.0.0.1. Phone access also needs Author to run `tailscale serve`

// for port 4317 himself — see PHONE-APP.md. Restart is not needed; the server reads phone.json per request.

//

//   node tools/phone.mjs status

//   node tools/phone.mjs enable --host <laptop>.<tailnet>.ts.net --login <tailscale login> [--scheme https]

//   node tools/phone.mjs disable          (keeps paired devices listed but refuses all phone requests)

//   node tools/phone.mjs forget           (unpairs every phone)

import { promises as fs } from 'node:fs';

import { join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { parseArgs } from './grimoire.mjs';



const REPO = fileURLToPath(new URL('..', import.meta.url));



export async function run(argv, out = console.log) {

  const { pos, opt } = parseArgs(argv);

  const dir = resolve(opt.data || process.env.GRIMOIRE_DATA || join(REPO, 'data'));

  const file = join(dir, 'phone.json');

  let c = {};

  try { c = JSON.parse(await fs.readFile(file, 'utf8')); } catch { c = {}; }

  const save = async () => { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file, JSON.stringify(c, null, 1)); };

  const cmd = pos[0];

  if (cmd === 'enable') {

    const host = String(opt.host || ''), login = String(opt.login || '');

    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{2,5})?$/i.test(host)) throw new Error('Give --host as the laptop\'s Tailscale name, e.g. example.invalid (add :4317 if served on that port)');

    if (!login || login === 'true') throw new Error('Give --login as the Tailscale login shown in the Tailscale app');

    Object.assign(c, { enabled: true, host: host.toLowerCase(), login, scheme: opt.scheme === 'https' ? 'https' : 'http' });

    c.devices = c.devices || {};

    await save();

    out(`Phone access enabled for ${c.host}. It works only once "tailscale serve" forwards to 127.0.0.1:4317 (see PHONE-APP.md).`);

  } else if (cmd === 'disable') {

    c.enabled = false; await save(); out('Phone access disabled. Phones are refused; pairings are kept until "forget".');

  } else if (cmd === 'forget') {

    c.devices = {}; delete c.pairing; await save(); out('All phones unpaired.');

  } else {

    out(c.enabled ? `Enabled for ${c.host} (${c.scheme || 'http'}), ${Object.keys(c.devices || {}).length} paired phone(s).` : 'Phone access is off (the default).');

  }

}



if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });

