// @lufs/sampler-core — core types.
// A Signal is the single currency of the engine: deinterleaved float PCM,
// samples in [-1, 1], plus a sample rate. No DOM, no Web Audio, no Node APIs.
// This file is deliberately dependency-free so it runs identically in a Node
// test process (via type-stripping) and inside a browser AudioWorklet (via Vite).

export interface Signal {
  /** Samples per second, e.g. 44100 or 48000. Must be a positive integer. */
  sampleRate: number;
  /** Deinterleaved channels. channels[c][i] is sample i of channel c, in [-1, 1]. */
  channels: Float32Array[];
}

/** A half-open frame range [start, end) into a Signal. */
export interface Region {
  start: number; // inclusive frame
  end: number; // exclusive frame
}

/** Loudness / level measurement of a Signal. */
export interface Levels {
  peak: number; // linear peak magnitude, >= 0
  peakDbfs: number; // 20*log10(peak), -Infinity for silence
  rms: number; // linear RMS across all channels
  rmsDbfs: number;
}

/** Result of a single contract assertion or metamorphic relation. */
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}
