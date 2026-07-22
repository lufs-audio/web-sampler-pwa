import type { Signal } from './types.ts';
import { cloneSignal, frames, silence } from './buffer.ts';

/**
 * Bitcrush: quantise amplitude to `bits` and optionally hold samples for
 * `downsample` frames (sample-rate reduction). bits in [1, 24], downsample >= 1.
 * The Koala/SP-303 grit primitive.
 */
export function bitcrush(sig: Signal, bits: number, downsample = 1): Signal {
  const b = Math.max(1, Math.min(24, Math.floor(bits)));
  const ds = Math.max(1, Math.floor(downsample));
  const levels = Math.pow(2, b);
  const out = cloneSignal(sig);
  for (const c of out.channels) {
    let held = 0;
    for (let i = 0; i < c.length; i++) {
      if (i % ds === 0) {
        const q = Math.round(((c[i] + 1) / 2) * (levels - 1)) / (levels - 1);
        held = q * 2 - 1;
      }
      c[i] = held;
    }
  }
  return out;
}

/** One-pole low-pass filter. cutoffHz in (0, sampleRate/2). */
export function onePoleLowpass(sig: Signal, cutoffHz: number): Signal {
  const fc = Math.max(1, Math.min(cutoffHz, sig.sampleRate / 2 - 1));
  const x = Math.exp((-2 * Math.PI * fc) / sig.sampleRate);
  const a0 = 1 - x;
  const out = cloneSignal(sig);
  for (const c of out.channels) {
    let z = 0;
    for (let i = 0; i < c.length; i++) {
      z = a0 * c[i] + x * z;
      c[i] = z;
    }
  }
  return out;
}

/**
 * Feedback delay. time in seconds, feedback in [0, 0.99], mix in [0, 1].
 * Output length is extended by the delay tail so the last echoes are not
 * clipped (duration is intentionally NOT preserved — it's an echo).
 */
export function delay(sig: Signal, timeSeconds: number, feedback = 0.4, mix = 0.35): Signal {
  const d = Math.max(1, Math.round(timeSeconds * sig.sampleRate));
  const fb = Math.max(0, Math.min(0.99, feedback));
  const m = Math.max(0, Math.min(1, mix));
  const tail = Math.round((d * Math.log(0.001)) / Math.log(Math.max(fb, 1e-6) || 1e-6));
  const inN = frames(sig);
  const outN = inN + Math.max(0, tail);
  const ch = sig.channels.length;
  const out = silence(sig.sampleRate, ch, outN);
  // dst doubles as the delay line: each tap reads the already-written output d
  // frames back, so feedback accumulates naturally and decays by `fb`.
  for (let c = 0; c < ch; c++) {
    const src = sig.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < outN; i++) {
      const dry = i < inN ? src[i] : 0;
      const echo = i - d >= 0 ? dst[i - d] * fb : 0;
      dst[i] = dry + m * echo;
    }
  }
  return out;
}
