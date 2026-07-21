#!/usr/bin/env node
// Build a single self-contained HTML demo (for quick sharing / PublishWebpage).
// Bundles src/demo.ts with esbuild, inlines the realtime worklet source as a
// Blob URL (__WORKLET_SRC__), and injects the bundle into the app's index.html.
// Output: demo-standalone.html at the repo root. The production build (vite) is
// unaffected — this is only for a shareable, zero-hosting playable link.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const coreIndex = root + 'packages/sampler-core/src/index.ts';
const workletSrc = readFileSync(root + 'packages/app/public/sampler-processor.js', 'utf8');

const result = await build({
  entryPoints: [root + 'packages/app/src/demo.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  alias: { '@lufs/sampler-core': coreIndex },
  define: { __WORKLET_SRC__: JSON.stringify(workletSrc) },
});
const bundle = result.outputFiles[0].text;

let html = readFileSync(root + 'packages/app/index.html', 'utf8');
html = html
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<script type="module"[^>]*><\/script>/, `\n    <script>${bundle}</script>`);

writeFileSync(root + 'demo-standalone.html', html);
console.log(`✔ demo-standalone.html written (${(html.length / 1024).toFixed(1)} kB, self-contained)`);
