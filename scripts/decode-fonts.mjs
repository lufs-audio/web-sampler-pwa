#!/usr/bin/env node
// Decode the committed base64 font snapshot into real .woff2 under
// packages/app/public/fonts/, verifying each digest.
//
// Self-hosting is what makes `offline: true` and `external_origins: []` TRUE.
// A Google Fonts <link> meant the app shell precached fine but the type did
// not, so an offline launch silently degraded to system fonts while site.yaml
// claimed the artifact was self-contained. The snapshot is committed (not
// fetched at build time) so production builds never depend on the network —
// website-portability 02: pin and snapshot your build inputs.
//
// Refresh the snapshot with: python3 scripts/fetch-fonts.py packages/app/fonts.b64.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const SRC = 'packages/app/fonts.b64.json';
const OUT = 'packages/app/public/fonts';

const { fonts } = JSON.parse(readFileSync(SRC, 'utf8'));
mkdirSync(OUT, { recursive: true });

let n = 0;
for (const [name, f] of Object.entries(fonts)) {
  const buf = Buffer.from(f.b64, 'base64');
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== f.sha256) {
    console.error(`✖ font digest mismatch: ${name}\n  want ${f.sha256}\n  got  ${got}`);
    process.exit(1);
  }
  if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') {
    console.error(`✖ not a woff2 file: ${name}`);
    process.exit(1);
  }
  writeFileSync(join(OUT, name), buf);
  n++;
}
console.log(`✔ decoded ${n} webfonts into ${OUT} (digests verified)`);
