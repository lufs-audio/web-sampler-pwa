import type { Signal } from './types.ts';
import { cloneSignal, measure, silence, frames } from './buffer.ts';

/** Multiply every sample by a linear gain. Pure. */
export function applyGain(sig: Signal, gainLinear: number): Signal {
  const out = cloneSignal(sig);
  for (const c of out.channels) {
    for (let i = 0; i < c.length; i++) c[i] *= gainLinear;
  }
  return out;
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Scale so the true peak lands at targetDbfs. Silent input is returned unchanged. */
export function normalizePeak(sig: Signal, targetDbfs: number): Signal {
  const { peak } = measure(sig);
  if (peak <= 0) return cloneSignal(sig);
  const target = dbToLinear(targetDbfs);
  return applyGain(sig, target / peak);
}

/** Equal-power crossfade region at head/tail — attack/release gate for one-shots. */
export function applyGate(sig: Signal, attackFrames: number, releaseFrames: number): Signal {
  const n = frames(sig);
  if (n === 0) return silence(sig.sampleRate, sig.channels.length, 0);
  const out = cloneSignal(sig);
  const a = Math.max(0, Math.min(attackFrames, n));
  const r = Math.max(0, Math.min(releaseFrames, n));
  for (const c of out.channels) {
    for (let i = 0; i < a; i++) c[i] *= i / a;
    for (let i = 0; i < r; i++) {
      const idx = n - 1 - i;
      if (idx >= 0) c[idx] *= i / r;
    }
  }
  return out;
}
