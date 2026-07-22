#!/usr/bin/env node
// Fail-closed build verify — the web equivalent of the Workchain verifier rule:
// "exit 0 is not enough." A build that ran but produced the wrong bytes must
// never ship. Also emits provenance (artifact.json + SHA256SUMS) into the dist,
// matching the LUFS catalog + Workchain content-hash convention.
import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = 'packages/app/dist';
const failures = [];
const require = (cond, msg) => { if (!cond) failures.push(msg); };

require(existsSync(DIST), `dist dir missing: ${DIST}`);

const indexPath = join(DIST, 'index.html');
require(existsSync(indexPath), 'index.html missing');
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8');
  require(html.length > 200, 'index.html suspiciously small');
  require(/<script[^>]+src=/.test(html), 'index.html references no bundled script');
}

// the realtime worklet + PWA files must survive into the build verbatim
for (const f of ['sampler-processor.js', 'manifest.webmanifest', 'sw.js', 'icon.svg']) {
  require(existsSync(join(DIST, f)), `missing public asset in dist: ${f}`);
}

// there must be at least one hashed JS bundle in assets/
const assetsDir = join(DIST, 'assets');
let jsBundles = [];
if (existsSync(assetsDir)) jsBundles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
require(jsBundles.length > 0, 'no JS bundle emitted in assets/');

if (failures.length) {
  console.error('✖ artifact verify FAILED:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

// provenance
const sums = [];
const walk = (dir, rel = '') => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(p).isDirectory()) walk(p, r);
    else if (name !== 'SHA256SUMS' && name !== 'artifact.json') {
      sums.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${r}`);
    }
  }
};
walk(DIST);
sums.sort();
writeFileSync(join(DIST, 'SHA256SUMS'), sums.join('\n') + '\n');
const digest = createHash('sha256').update(sums.join('\n')).digest('hex');
writeFileSync(
  join(DIST, 'artifact.json'),
  JSON.stringify({ name: 'lufs-web-sampler', builtAt: new Date().toISOString(), files: sums.length, contentId: 'lws-' + digest.slice(0, 8), sha256: digest }, null, 2) + '\n'
);
console.log(`✔ artifact verify passed — ${sums.length} files, contentId lws-${digest.slice(0, 8)}`);
