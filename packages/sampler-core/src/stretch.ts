import type { Signal } from './types.ts';
import { frames, silence } from './buffer.ts';

function hann(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return w;
}

/**
 * Time-stretch that PRESERVES PITCH via windowed overlap-add (OLA).
 *   factor > 1  => longer / slower
 *   factor < 1  => shorter / faster
 * Fixed synthesis hop at 75% overlap (Hann, COLA-satisfying); analysis hop
 * scales with `factor`. Grains keep their original pitch, so pitch is preserved
 * while duration changes — the opposite coupling to repitch(). This is a plain
 * OLA reference (no phase-vocoder locking): transients smear a little, but the
 * duration law and energy preservation it guarantees are exactly what the
 * metamorphic contract checks. A phase-locked kernel can replace it later.
 */
export function timeStretch(sig: Signal, factor: number, windowSize = 1024): Signal {
  if (factor <= 0) throw new Error('timeStretch: factor must be > 0');
  const inN = frames(sig);
  if (inN === 0 || factor === 1) {
    return { sampleRate: sig.sampleRate, channels: sig.channels.map((c) => Float32Array.from(c)) };
  }
  const W = Math.min(windowSize, Math.max(8, 1 << Math.floor(Math.log2(Math.max(8, inN)))));
  const Hs = Math.max(1, Math.floor(W / 4)); // synthesis hop (fixed, 75% overlap)
  const Ha = Math.max(1e-6, Hs / factor); // analysis hop (fractional)
  const win = hann(W);
  const outN = Math.max(0, Math.round(inN * factor));
  const ch = sig.channels.length;
  const out = silence(sig.sampleRate, ch, outN);
  const norm = new Float32Array(outN); // accumulated window^2 for amplitude stabilisation

  const numGrains = Math.floor((inN - 1) / Ha) + 1;
  for (let c = 0; c < ch; c++) {
    const src = sig.channels[c];
    const dst = out.channels[c];
    for (let g = 0; g < numGrains; g++) {
      const inStart = g * Ha;
      const outStart = Math.round(g * Hs);
      if (outStart >= outN) break;
      for (let k = 0; k < W; k++) {
        const op = outStart + k;
        if (op < 0 || op >= outN) continue;
        // linear read from the analysis grain
        const ip = inStart + k;
        const i0 = Math.floor(ip);
        if (i0 < 0 || i0 >= inN) continue;
        const frac = ip - i0;
        const s = i0 + 1 < inN ? src[i0] * (1 - frac) + src[i0 + 1] * frac : src[i0];
        const wv = win[k];
        dst[op] += s * wv;
        // window is applied ONCE (analysis read), so the reconstruction
        // normalizer is the sum of overlapping windows, not their squares.
        if (c === 0) norm[op] += wv;
      }
    }
  }
  // Normalise by the (channel-independent) window-energy envelope.
  for (let i = 0; i < outN; i++) {
    const g = norm[i];
    if (g > 1e-6) for (let c = 0; c < ch; c++) out.channels[c][i] /= g;
  }
  return out;
}
