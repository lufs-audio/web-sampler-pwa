import type { Signal } from '@lufs/sampler-core';
import { normalizePeak } from '@lufs/sampler-core';
import type { SamplerEngine } from './engine/engine.ts';

// Synthesize a tiny drum kit from scratch so the app makes sound immediately —
// no mic needed (important in a sandboxed demo where getUserMedia is blocked).
// Built at the engine's real sample rate; each voice is normalized to -1 dBFS.

function make(sr: number, durS: number, fn: (i: number, n: number) => number): Signal {
  const n = Math.round(durS * sr);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = fn(i, n);
  return normalizePeak({ sampleRate: sr, channels: [d] }, -1);
}

function kick(sr: number): Signal {
  return make(sr, 0.32, (i, n) => {
    const t = i / sr;
    const env = Math.exp(-18 * t);
    const f = 120 * Math.exp(-24 * t) + 45; // pitch drop
    return env * Math.sin(2 * Math.PI * f * t);
  });
}
function snare(sr: number): Signal {
  let seed = 22;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  return make(sr, 0.2, (i, n) => {
    const t = i / sr;
    const env = Math.exp(-28 * t);
    const body = Math.sin(2 * Math.PI * 180 * t) * 0.5;
    return env * (rnd() * 0.7 + body);
  });
}
function hat(sr: number): Signal {
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  let hp = 0;
  return make(sr, 0.06, (i) => {
    const t = i / sr;
    const white = rnd();
    hp = white - hp * 0.2; // crude high-pass so it sizzles
    return Math.exp(-90 * t) * hp;
  });
}
function blip(sr: number): Signal {
  return make(sr, 0.25, (i, n) => {
    const t = i / sr;
    const env = Math.min(1, i / (0.005 * sr)) * Math.exp(-6 * t);
    return env * Math.sin(2 * Math.PI * 440 * t);
  });
}

/** Load kick/snare/hat/blip onto pads 1-4 and lay down a starter pattern. */
export function loadDemoKit(engine: SamplerEngine): void {
  const sr = engine.getSampleRate();
  engine.loadSignalToPad(0, kick(sr));
  engine.loadSignalToPad(1, snare(sr));
  engine.loadSignalToPad(2, hat(sr));
  engine.loadSignalToPad(3, blip(sr));
  const on = (pad: number, steps: number[]) => steps.forEach((s) => engine.toggleStep(pad, s));
  on(0, [0, 4, 8, 12]); // kick on the four
  on(1, [4, 12]); // snare on 2 & 4
  on(2, [0, 2, 4, 6, 8, 10, 12, 14]); // hats on 8ths
  on(3, [10]); // a blip for flavour
  engine.setBpm(90);
}
