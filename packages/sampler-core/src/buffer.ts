import type { Signal, Levels } from './types.ts';

/** Number of frames (samples per channel). 0 for an empty signal. */
export function frames(sig: Signal): number {
  return sig.channels.length === 0 ? 0 : sig.channels[0].length;
}

export function numChannels(sig: Signal): number {
  return sig.channels.length;
}

export function durationSeconds(sig: Signal): number {
  return frames(sig) / sig.sampleRate;
}

/** Deep copy — callers never mutate a Signal in place; the engine is functional. */
export function cloneSignal(sig: Signal): Signal {
  return {
    sampleRate: sig.sampleRate,
    channels: sig.channels.map((c) => Float32Array.from(c)),
  };
}

/** Allocate a silent signal of `n` frames with `ch` channels. */
export function silence(sampleRate: number, ch: number, n: number): Signal {
  const channels: Float32Array[] = [];
  for (let c = 0; c < ch; c++) channels.push(new Float32Array(n));
  return { sampleRate, channels };
}

/** Concatenate signals end-to-end. All must share sampleRate and channel count. */
export function concat(parts: Signal[]): Signal {
  if (parts.length === 0) throw new Error('concat: no parts');
  const sampleRate = parts[0].sampleRate;
  const ch = parts[0].channels.length;
  let total = 0;
  for (const p of parts) {
    if (p.sampleRate !== sampleRate) throw new Error('concat: sampleRate mismatch');
    if (p.channels.length !== ch) throw new Error('concat: channel-count mismatch');
    total += frames(p);
  }
  const out = silence(sampleRate, ch, total);
  let off = 0;
  for (const p of parts) {
    const n = frames(p);
    for (let c = 0; c < ch; c++) out.channels[c].set(p.channels[c], off);
    off += n;
  }
  return out;
}

/** Downmix to mono by averaging channels (used for analysis, e.g. hashing). */
export function toMono(sig: Signal): Float32Array {
  const n = frames(sig);
  const ch = sig.channels.length;
  const out = new Float32Array(n);
  if (ch === 0) return out;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += sig.channels[c][i];
    out[i] = s / ch;
  }
  return out;
}

export function measure(sig: Signal): Levels {
  let peak = 0;
  let sumSq = 0;
  let count = 0;
  for (const c of sig.channels) {
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
      sumSq += c[i] * c[i];
      count++;
    }
  }
  const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  return { peak, peakDbfs: db(peak), rms, rmsDbfs: db(rms) };
}

/**
 * Downsample to per-column min/max pairs for waveform thumbnails. Deterministic
 * and pure — the UI renders `columns` vertical bars from min[c]..max[c]. Silent
 * or empty input yields all-zero columns. `min[c] <= max[c]` always holds.
 */
export function peaks(sig: Signal, columns: number): { min: Float32Array; max: Float32Array } {
  if (columns <= 0) throw new Error('peaks: columns must be >= 1');
  const mono = toMono(sig);
  const n = mono.length;
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  if (n === 0) return { min, max };
  for (let c = 0; c < columns; c++) {
    const start = Math.floor((c * n) / columns);
    const end = Math.max(start + 1, Math.floor(((c + 1) * n) / columns));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end && i < n; i++) {
      const v = mono[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[c] = Number.isFinite(lo) ? lo : 0;
    max[c] = Number.isFinite(hi) ? hi : 0;
  }
  return { min, max };
}

/** True if every sample is finite and within [-limit, limit]. */
export function isBounded(sig: Signal, limit = 1.0): boolean {
  for (const c of sig.channels) {
    for (let i = 0; i < c.length; i++) {
      const v = c[i];
      if (!Number.isFinite(v) || v > limit || v < -limit) return false;
    }
  }
  return true;
}
