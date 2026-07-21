import type { Signal } from './types.ts';
import { frames, silence } from './buffer.ts';

/** Linear-interpolated read of channel data at a fractional frame index. */
function lerpRead(c: Float32Array, pos: number): number {
  if (pos <= 0) return c[0] ?? 0;
  const n = c.length;
  if (pos >= n - 1) return c[n - 1] ?? 0;
  const i = Math.floor(pos);
  const frac = pos - i;
  return c[i] * (1 - frac) + c[i + 1] * frac;
}

/**
 * Sample-rate conversion via linear interpolation. Preserves musical duration
 * (seconds) while changing the frame count. Cheap and deterministic — good
 * enough as a reference; a windowed-sinc kernel can replace it behind the same
 * contract later without changing any caller.
 */
export function resampleLinear(sig: Signal, targetRate: number): Signal {
  if (targetRate <= 0) throw new Error('resampleLinear: targetRate must be > 0');
  if (targetRate === sig.sampleRate) {
    return { sampleRate: sig.sampleRate, channels: sig.channels.map((c) => Float32Array.from(c)) };
  }
  const inN = frames(sig);
  const ratio = sig.sampleRate / targetRate; // input frames per output frame
  const outN = Math.max(0, Math.round(inN / ratio));
  const out = silence(targetRate, sig.channels.length, outN);
  for (let c = 0; c < sig.channels.length; c++) {
    const src = sig.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < outN; i++) dst[i] = lerpRead(src, i * ratio);
  }
  return out;
}

/**
 * Repitch (varispeed): read the sample faster/slower and keep the SAME sample
 * rate — this is the classic sampler "play the pad at a different key" move.
 * ratio > 1 => higher pitch AND shorter; ratio < 1 => lower AND longer.
 * Pitch and time are coupled here on purpose (that IS varispeed).
 */
export function repitch(sig: Signal, ratio: number): Signal {
  if (ratio <= 0) throw new Error('repitch: ratio must be > 0');
  const inN = frames(sig);
  const outN = Math.max(0, Math.round(inN / ratio));
  const out = silence(sig.sampleRate, sig.channels.length, outN);
  for (let c = 0; c < sig.channels.length; c++) {
    const src = sig.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < outN; i++) dst[i] = lerpRead(src, i * ratio);
  }
  return out;
}

/** Convert semitones to a varispeed ratio (equal temperament). */
export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}
