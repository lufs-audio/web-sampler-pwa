import type { Signal, Region } from './types.ts';
import { frames, silence } from './buffer.ts';

/** Extract [start, end) as a new Signal. Clamps to bounds; never throws on range. */
export function slice(sig: Signal, start: number, end: number): Signal {
  const n = frames(sig);
  const s = Math.max(0, Math.min(Math.floor(start), n));
  const e = Math.max(s, Math.min(Math.floor(end), n));
  const out = silence(sig.sampleRate, sig.channels.length, e - s);
  for (let c = 0; c < sig.channels.length; c++) {
    out.channels[c].set(sig.channels[c].subarray(s, e));
  }
  return out;
}

/**
 * Chop into exactly `n` contiguous, gapless, non-overlapping regions covering
 * the whole signal. Frame counts are distributed so the regions tile [0, len)
 * with no lost or duplicated frames (last region absorbs the remainder).
 * This exact tiling is what makes chop→reassemble a sample-accurate identity.
 */
export function chopEqual(sig: Signal, n: number): Region[] {
  if (n <= 0) throw new Error('chopEqual: n must be >= 1');
  const len = frames(sig);
  const base = Math.floor(len / n);
  const regions: Region[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const start = cursor;
    const end = i === n - 1 ? len : start + base;
    regions.push({ start, end });
    cursor = end;
  }
  return regions;
}

/** Chop at explicit transient/marker frame positions (sorted, deduped, clamped). */
export function chopAt(sig: Signal, markers: number[]): Region[] {
  const len = frames(sig);
  const pts = Array.from(new Set(markers.map((m) => Math.max(0, Math.min(Math.floor(m), len)))))
    .filter((m) => m > 0 && m < len)
    .sort((a, b) => a - b);
  const regions: Region[] = [];
  let start = 0;
  for (const p of pts) {
    regions.push({ start, end: p });
    start = p;
  }
  regions.push({ start, end: len });
  return regions;
}

export function materialize(sig: Signal, region: Region): Signal {
  return slice(sig, region.start, region.end);
}
