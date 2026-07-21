#!/usr/bin/env node
// Lightweight pre-build gate: prove the DSP core's contract holds on a synthetic
// signal before we bother building the app. If the crown jewel isn't correct,
// nothing downstream is worth shipping. (The full battery is `npm test`.)
import { runContract } from '../packages/sampler-core/src/index.ts';

const sr = 44100;
const n = sr * 0.4;
const ch = new Float32Array(n);
for (let i = 0; i < n; i++) ch[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / sr) * Math.exp((-3 * i) / n);
const sig = { sampleRate: sr, channels: [ch] };

const results = runContract(sig);
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}: ${r.detail}`);
if (failed.length) {
  console.error(`\n✖ precheck FAILED: ${failed.length} contract violation(s)`);
  process.exit(1);
}
console.log(`\n✔ precheck passed — ${results.length} contract checks green`);
