import type { Signal } from '../src/index.ts';

/** Deterministic mulberry32 PRNG so "noise" fixtures are reproducible across runs. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sine(freq: number, durS: number, sr = 44100, ch = 1, amp = 0.8): Signal {
  const n = Math.round(durS * sr);
  const channels: Float32Array[] = [];
  for (let c = 0; c < ch; c++) {
    const d = new Float32Array(n);
    const detune = c * 1.5; // slight per-channel offset so stereo isn't trivially identical
    for (let i = 0; i < n; i++) d[i] = amp * Math.sin((2 * Math.PI * (freq + detune) * i) / sr);
    channels.push(d);
  }
  return { sampleRate: sr, channels };
}

export function noise(durS: number, sr = 44100, ch = 1, seed = 1234, amp = 0.6): Signal {
  const n = Math.round(durS * sr);
  const channels: Float32Array[] = [];
  for (let c = 0; c < ch; c++) {
    const rnd = prng(seed + c * 7919);
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = amp * (rnd() * 2 - 1);
    channels.push(d);
  }
  return { sampleRate: sr, channels };
}

/** A short percussive-ish one-shot: decaying sine burst (a plausible "pad" sample). */
export function oneShot(durS = 0.4, sr = 44100): Signal {
  const n = Math.round(durS * sr);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.exp((-5 * i) / n);
    d[i] = 0.9 * env * Math.sin((2 * Math.PI * 220 * i) / sr);
  }
  return { sampleRate: sr, channels: [d] };
}
