// The verifiable-correctness layer. "Works" means PROVEN correct, not merely
// returned without throwing. Two kinds of check live here:
//
//   1. Assertion primitives  — cheap structural guarantees on a single Signal
//      (finite, bounded, non-empty, expected rate/channels/duration). Run these
//      on EVERY engine output, in Node tests and in the browser worklet alike.
//
//   2. Metamorphic relations — invariants between inputs and outputs for
//      operations that have no single "right" answer (chop, resample, repitch,
//      stretch, gain, wav, hash). We assert relations (identity, duration laws,
//      composition, round-trip, determinism) instead of exact bytes.
//
// Same philosophy as the LUFS Workchain engine verifier: this module is the
// single source of truth for "is this output trustworthy?", reachable from
// tests, the app, and any future native/WASM implementation that must conform.

import type { Signal, CheckResult } from './types.ts';
import { frames, isBounded, measure, concat, toMono } from './buffer.ts';
import { slice, chopEqual } from './slice.ts';
import { resampleLinear, repitch } from './resample.ts';
import { timeStretch } from './stretch.ts';
import { applyGain } from './gain.ts';
import { encodeWav, decodeWav } from './wav.ts';
import { contentHash } from './hash.ts';

const ok = (name: string, detail = 'ok'): CheckResult => ({ name, ok: true, detail });
const fail = (name: string, detail: string): CheckResult => ({ name, ok: false, detail });

// ---------------------------------------------------------------------------
// 1. Assertion primitives
// ---------------------------------------------------------------------------

export function assertFiniteBounded(sig: Signal, limit = 1.0): CheckResult {
  return isBounded(sig, limit)
    ? ok('finite_bounded')
    : fail('finite_bounded', `samples exceed +/-${limit} or are non-finite`);
}

export function assertNonEmpty(sig: Signal): CheckResult {
  return frames(sig) > 0 ? ok('non_empty') : fail('non_empty', 'signal has 0 frames');
}

export function assertSampleRate(sig: Signal, expected: number): CheckResult {
  return sig.sampleRate === expected
    ? ok('sample_rate')
    : fail('sample_rate', `expected ${expected}, got ${sig.sampleRate}`);
}

export function assertChannels(sig: Signal, expected: number): CheckResult {
  return sig.channels.length === expected
    ? ok('channels')
    : fail('channels', `expected ${expected}, got ${sig.channels.length}`);
}

export function assertDurationApprox(sig: Signal, expectedFrames: number, tolFrames: number): CheckResult {
  const got = frames(sig);
  const diff = Math.abs(got - expectedFrames);
  return diff <= tolFrames
    ? ok('duration_approx', `${got} within ${tolFrames} of ${expectedFrames}`)
    : fail('duration_approx', `${got} frames, expected ${expectedFrames} +/-${tolFrames} (off by ${diff})`);
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/** RMS of the difference of two mono signals, after truncating to common length. */
export function rmsError(a: Signal, b: Signal): number {
  const am = toMono(a);
  const bm = toMono(b);
  const n = Math.min(am.length, bm.length);
  if (n === 0) return Infinity;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = am[i] - bm[i];
    s += d * d;
  }
  return Math.sqrt(s / n);
}

// ---------------------------------------------------------------------------
// 2. Metamorphic relations
// ---------------------------------------------------------------------------

/** Chopping into n gapless tiles and concatenating reproduces the input EXACTLY. */
export function chopReassembleIdentity(sig: Signal, n: number): CheckResult {
  const regions = chopEqual(sig, n);
  const covered = regions.reduce((sum, r) => sum + (r.end - r.start), 0);
  if (covered !== frames(sig)) return fail('chop_reassemble_identity', `tiles cover ${covered} of ${frames(sig)} frames`);
  const reassembled = concat(regions.map((r) => slice(sig, r.start, r.end)));
  const err = rmsError(sig, reassembled);
  return err === 0
    ? ok('chop_reassemble_identity', `${n} tiles, exact`)
    : fail('chop_reassemble_identity', `rms error ${err} (expected exact 0)`);
}

/**
 * Resample round-trip identity. Going UP by an exact integer factor and back
 * is a mathematical identity for linear interpolation (the returned samples are
 * exactly the originals), so this holds for ANY content — including broadband
 * noise — not just band-limited signals. Round-tripping through a *lower* rate
 * would discard content above the intermediate Nyquist and is deliberately NOT
 * claimed as an identity (that would be a dishonest invariant).
 */
export function resampleRoundTrip(sig: Signal, factor = 2, tol = 1e-6): CheckResult {
  const up = resampleLinear(sig, sig.sampleRate * factor);
  const back = resampleLinear(up, sig.sampleRate);
  const err = rmsError(sig, back);
  return err <= tol
    ? ok('resample_round_trip', `x${factor} up/down rms error ${err.toExponential(2)} <= ${tol}`)
    : fail('resample_round_trip', `x${factor} up/down rms error ${err.toExponential(2)} > ${tol}`);
}

/** Varispeed duration law: len(repitch(x, r)) ≈ round(len(x) / r). */
export function repitchDurationLaw(sig: Signal, ratio: number): CheckResult {
  const out = repitch(sig, ratio);
  const expected = Math.round(frames(sig) / ratio);
  return assertDurationApprox(out, expected, 1).ok
    ? ok('repitch_duration_law', `ratio ${ratio} -> ${frames(out)} frames`)
    : fail('repitch_duration_law', `ratio ${ratio}: got ${frames(out)}, expected ${expected}`);
}

/** Time-stretch duration law: len(stretch(x, f)) ≈ round(len(x) * f) within a small tol. */
export function stretchDurationLaw(sig: Signal, factor: number, tolFrames = 2048): CheckResult {
  const out = timeStretch(sig, factor);
  const expected = Math.round(frames(sig) * factor);
  const r = assertDurationApprox(out, expected, tolFrames);
  return r.ok
    ? ok('stretch_duration_law', `factor ${factor} -> ${frames(out)} frames`)
    : fail('stretch_duration_law', r.detail);
}

/** Gain composition: gain(gain(x,a),b) == gain(x, a*b) to float precision. */
export function gainComposition(sig: Signal, a: number, b: number, eps = 1e-6): CheckResult {
  const seq = applyGain(applyGain(sig, a), b);
  const once = applyGain(sig, a * b);
  const err = rmsError(seq, once);
  return err <= eps
    ? ok('gain_composition', `rms error ${err.toExponential(2)} <= ${eps}`)
    : fail('gain_composition', `rms error ${err} > ${eps}`);
}

/** WAV float round-trip is exact; 16-bit round-trip is within one quantum. */
export function wavRoundTrip(sig: Signal): CheckResult {
  const f = decodeWav(encodeWav(sig, 32));
  const ferr = rmsError(sig, f);
  if (ferr !== 0) return fail('wav_round_trip', `float32 round-trip not exact: rms ${ferr}`);
  const i16 = decodeWav(encodeWav(sig, 16));
  const ierr = rmsError(sig, i16);
  const q = 1 / 32768;
  return ierr <= q
    ? ok('wav_round_trip', `float exact; 16-bit rms ${ierr.toExponential(2)} <= 1 quantum`)
    : fail('wav_round_trip', `16-bit rms ${ierr} > 1 quantum (${q})`);
}

/** Deterministic ids: same audio => same id; a single changed sample => different id. */
export function hashDeterminism(sig: Signal): CheckResult {
  const h1 = contentHash(sig);
  const h2 = contentHash(sig);
  if (h1 !== h2) return fail('hash_determinism', `not stable across calls: ${h1} vs ${h2}`);
  if (frames(sig) === 0) return ok('hash_determinism', `stable ${h1} (empty; sensitivity n/a)`);
  const mutated: Signal = { sampleRate: sig.sampleRate, channels: sig.channels.map((c) => Float32Array.from(c)) };
  const mid = Math.floor(frames(sig) / 2);
  mutated.channels[0][mid] = Math.max(-1, Math.min(1, mutated.channels[0][mid] + 0.5));
  const h3 = contentHash(mutated);
  return h3 !== h1
    ? ok('hash_determinism', `stable ${h1}; sensitive to 1-sample change`)
    : fail('hash_determinism', `insensitive: mutated signal kept id ${h1}`);
}

/** Run the full metamorphic battery for a signal; returns every result. */
export function runContract(sig: Signal): CheckResult[] {
  return [
    assertFiniteBounded(sig),
    assertNonEmpty(sig),
    chopReassembleIdentity(sig, 7),
    resampleRoundTrip(sig, 2),
    repitchDurationLaw(sig, 1.5),
    repitchDurationLaw(sig, 0.75),
    stretchDurationLaw(sig, 2.0),
    stretchDurationLaw(sig, 0.5),
    gainComposition(sig, 0.5, 0.25),
    wavRoundTrip(sig),
    hashDeterminism(sig),
  ];
}
