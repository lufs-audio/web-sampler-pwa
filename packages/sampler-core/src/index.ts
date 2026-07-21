// @lufs/sampler-core — public surface. Pure, deterministic, dependency-free DSP.
// Runs unchanged in a Node test process and inside a browser AudioWorklet.
export type { Signal, Region, Levels, CheckResult } from './types.ts';

export {
  frames,
  numChannels,
  durationSeconds,
  cloneSignal,
  silence,
  concat,
  toMono,
  measure,
  isBounded,
} from './buffer.ts';

export { applyGain, dbToLinear, normalizePeak, applyGate } from './gain.ts';
export { slice, chopEqual, chopAt, materialize } from './slice.ts';
export { resampleLinear, repitch, semitonesToRatio } from './resample.ts';
export { timeStretch } from './stretch.ts';
export { bitcrush, onePoleLowpass, delay } from './fx.ts';
export { encodeWav, decodeWav } from './wav.ts';
export type { WavBitDepth } from './wav.ts';
export { contentHash } from './hash.ts';

export {
  assertFiniteBounded,
  assertNonEmpty,
  assertSampleRate,
  assertChannels,
  assertDurationApprox,
  rmsError,
  chopReassembleIdentity,
  resampleRoundTrip,
  repitchDurationLaw,
  stretchDurationLaw,
  gainComposition,
  wavRoundTrip,
  hashDeterminism,
  runContract,
} from './contract.ts';
