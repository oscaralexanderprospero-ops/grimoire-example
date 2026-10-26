// Off-device checks for the (prepared, unbuilt) phone app. Uses the Java 17 + Android SDK that are already

// on this laptop for OMS (%LOCALAPPDATA%\OMSBuild); skipped if they aren't there. Builds nothing installable:

// classes go to a temporary folder. Device-only behaviour (pickers, Save as) is listed in PHONE-APP.md.

import test from 'node:test';

import assert from 'node:assert/strict';

import { spawnSync } from 'node:child_process';

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import { join } from 'node:path';

import { fileURLToPath } from 'node:url';

import { tempDir } from './helpers.mjs';



const B = process.env.GRIMOIRE_BUILD_HOME || join(process.env.LOCALAPPDATA || '', 'GrimoireBuild');

const jdk = existsSync(B) ? readdirSync(B).find((n) => n.startsWith('jdk-17')) : null;

const JAVA = jdk && join(B, jdk, 'bin');

const JAR = join(B, 'sdk', 'platforms', 'android-35', 'android.jar');

const SRC = fileURLToPath(new URL('../android/src/com/oscarsmagickalauthor/grimoire/', import.meta.url));

const skip = !JAVA ? 'Java 17 from GrimoireBuild not found' : false;



test('phone app navigation and save-name rules (desktop JDK)', { skip }, async () => {

  const t = await tempDir();

  try {

    const r1 = spawnSync(join(JAVA, 'javac'), ['-encoding', 'utf-8', '-d', t.dir, join(SRC, 'Origins.java'), fileURLToPath(new URL('./android/OriginsCheck.java', import.meta.url))], { encoding: 'utf8' });

    assert.equal(r1.status, 0, r1.stderr);

    const r2 = spawnSync(join(JAVA, 'java'), ['-cp', t.dir, 'com.oscarsmagickalauthor.grimoire.OriginsCheck'], { encoding: 'utf8' });

    assert.equal(r2.status, 0, r2.stdout + r2.stderr);

    assert.match(r2.stdout, /ORIGINS OK/);

  } finally { await t.cleanup(); }

});



test('phone app source compiles against the Android SDK (compile only, nothing packaged or signed)', { skip: skip || (!existsSync(JAR) && 'android.jar not found') }, async () => {

  const t = await tempDir();

  try {

    const src = join(t.dir, 'src'); mkdirSync(src);

    for (const f of readdirSync(SRC)) writeFileSync(join(src, f), readFileSync(join(SRC, f), 'utf8').replace('@@HOST@@', 'example.invalid:4317').replace('@@SCHEME@@', 'http'));

    const r = spawnSync(join(JAVA, 'javac'), ['-Xlint:-options', '-source', '17', '-target', '17', '-encoding', 'utf-8', '-classpath', JAR, '-d', join(t.dir, 'classes'), ...readdirSync(src).map((f) => join(src, f))], { encoding: 'utf8' });

    assert.equal(r.status, 0, r.stderr);

    // the bridge exists and saving is gated on the page's origin and one save at a time

    const main = readFileSync(join(SRC, 'MainActivity.java'), 'utf8');

    assert.match(main, /Origins\.sameOrigin\(shown, ORIGIN\)/);

    assert.match(main, /if \(pendingSave != null\)/);

    assert.match(main, /Origins\.MAX_SAVE_BASE64/);

    assert.doesNotMatch(readFileSync(fileURLToPath(new URL('../android/AndroidManifest.xml', import.meta.url)), 'utf8').replace(/<!--[\s\S]*?-->/g, ''), /uses-permission/, 'offline app requests no permissions');

  } finally { await t.cleanup(); }

});



