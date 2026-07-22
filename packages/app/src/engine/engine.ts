import {
  type Signal,
  frames,
  durationSeconds,
  silence,
  slice,
  chopEqual,
  resampleLinear,
  repitch,
  semitonesToRatio,
  timeStretch,
  bitcrush,
  applyGain,
  dbToLinear,
  normalizePeak,
  encodeWav,
  contentHash,
  peaks,
  assertFiniteBounded,
  assertNonEmpty,
  type CheckResult,
} from '@lufs/sampler-core';
import { Recorder } from './recorder.ts';
import { savePad, loadPad, clearPadFile, opfsSupported, requestPersistence } from './opfs.ts';

export const PAD_COUNT = 16;
const DEFAULT_STEPS = 16;
const DEFAULT_BPM = 90;

export interface PadState {
  index: number;
  id: string | null; // contentHash of the baked buffer, or null if empty
  name: string;
  hasAudio: boolean;
  frames: number;
  durationS: number;
  pitchSemitones: number;
  gainDb: number;
  choke: number | null;
  sequence: boolean[]; // one flag per step
  verified: boolean; // did the baked buffer pass its output contract?
  checks: CheckResult[];
}

export interface EngineState {
  ready: boolean;
  playing: boolean;
  recording: boolean;
  armedPad: number | null;
  bpm: number;
  steps: number;
  currentStep: number;
  masterGain: number;
  pads: PadState[];
}

type EngineEvent = 'state' | 'levels' | 'step';
type Listener = (payload: unknown) => void;

function emptyPad(i: number, steps: number): PadState {
  return {
    index: i,
    id: null,
    name: `pad ${i + 1}`,
    hasAudio: false,
    frames: 0,
    durationS: 0,
    pitchSemitones: 0,
    gainDb: 0,
    choke: null,
    sequence: new Array(steps).fill(false),
    verified: false,
    checks: [],
  };
}

/**
 * SamplerEngine — the headless, UI-agnostic core of the app and the single
 * surface a frontend wires into (see docs/AMACHER-BRIEF.md). It owns the
 * AudioContext, the realtime worklet, the pad set, the step sequencer, the
 * recorder and OPFS persistence. Every creative transform is applied on this
 * (non-realtime) thread through @lufs/sampler-core, verified against the output
 * contract, and only then shipped to the worklet as a finished buffer.
 */
export class SamplerEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: Recorder | null = null;
  private listeners: Record<EngineEvent, Set<Listener>> = { state: new Set(), levels: new Set(), step: new Set() };

  /** Baked, verified, ready-to-play buffers keyed by pad index. */
  private baked = new Map<number, Signal>();
  /** Raw source (pre-pitch/gain) buffers so transforms re-bake from source, not from an already-processed buffer. */
  private source = new Map<number, Signal>();

  private scheduler: number | null = null;
  private nextStepTime = 0;
  private sampleRate = 44100;

  state: EngineState = {
    ready: false,
    playing: false,
    recording: false,
    armedPad: null,
    bpm: DEFAULT_BPM,
    steps: DEFAULT_STEPS,
    currentStep: 0,
    masterGain: 0.9,
    pads: Array.from({ length: PAD_COUNT }, (_, i) => emptyPad(i, DEFAULT_STEPS)),
  };

  // ---- lifecycle -------------------------------------------------------
  /**
   * MUST be called from inside a user-gesture handler (iOS unlock rule).
   * `workletUrl` defaults to the served file; the single-file demo passes a
   * Blob URL instead so it can run fully self-contained.
   */
  async init(workletUrl = 'sampler-processor.js'): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext();
    // iOS requires resume() synchronously inside the gesture, before any await.
    await ctx.resume();
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'sampler-processor', { outputChannelCount: [2] });
    node.port.onmessage = (e) => {
      if (e.data?.type === 'levels') this.emit('levels', { peak: e.data.peak, voices: e.data.voices });
    };
    // node -> analyser -> destination. The analyser gives the UI a real master
    // scope + FFT (getFloatTimeDomainData / getFloatFrequencyData) with the exact
    // same API the design prototype read, so the scope wiring transfers 1:1.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    node.connect(analyser);
    analyser.connect(ctx.destination);
    this.ctx = ctx;
    this.node = node;
    this.analyser = analyser;
    this.recorder = new Recorder(ctx);
    this.sampleRate = ctx.sampleRate;
    this.setMaster(this.state.masterGain);
    this.state.ready = true;
    if (opfsSupported()) requestPersistence().catch(() => {});
    this.emitState();
  }

  // ---- events ----------------------------------------------------------
  on(ev: EngineEvent, cb: Listener): () => void {
    this.listeners[ev].add(cb);
    return () => this.listeners[ev].delete(cb);
  }
  private emit(ev: EngineEvent, payload: unknown) {
    for (const cb of this.listeners[ev]) cb(payload);
  }
  private emitState() {
    this.emit('state', this.state);
  }

  /** The AudioContext sample rate; pads are conformed to this on bake. */
  getSampleRate(): number {
    return this.sampleRate;
  }

  /** Assign an in-memory Signal directly to a pad (synth kits, tests, Amacher). */
  loadSignalToPad(pad: number, sig: Signal): void {
    this.setSource(pad, sig);
  }

  /**
   * Live master scope/FFT source. node -> analyser -> destination is wired in
   * init(), so `getFloatTimeDomainData` / `getFloatFrequencyData` on this node
   * drive the Waveform look's hero scope. (Per-pad live meters are out of scope
   * for v0.1 — use peaks() for static per-pad thumbnails.)
   */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Per-column min/max of a pad's baked buffer for waveform thumbnails.
   * Returns null for an empty/absent pad. Delegates to the verified core.
   */
  peaks(pad: number, columns: number): { min: Float32Array; max: Float32Array } | null {
    const buf = this.baked.get(pad);
    return buf ? peaks(buf, columns) : null;
  }

  // ---- pad assignment --------------------------------------------------
  async loadFileToPad(pad: number, data: ArrayBuffer): Promise<void> {
    const audio = await this.ctx!.decodeAudioData(data.slice(0));
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c).slice());
    this.setSource(pad, { sampleRate: audio.sampleRate, channels });
  }

  async recordToPad(pad: number): Promise<void> {
    if (!this.recorder) throw new Error('engine not initialised');
    await this.recorder.arm();
    this.state.recording = true;
    this.state.armedPad = pad;
    this.emitState();
    this.recorder.start();
  }

  async stopRecording(): Promise<void> {
    if (!this.recorder || this.state.armedPad == null) return;
    const sig = await this.recorder.stop();
    const pad = this.state.armedPad;
    this.state.recording = false;
    this.state.armedPad = null;
    this.setSource(pad, sig);
  }

  /** Slice a source pad into `n` gapless tiles spread across consecutive pads. */
  chopToPads(sourcePad: number, n: number, startPad = 0): void {
    const src = this.source.get(sourcePad);
    if (!src) return;
    const regions = chopEqual(src, n);
    regions.forEach((r, i) => {
      const target = (startPad + i) % PAD_COUNT;
      this.setSource(target, slice(src, r.start, r.end));
    });
    this.emitState();
  }

  clearPad(pad: number): void {
    this.source.delete(pad);
    this.baked.delete(pad);
    this.node?.port.postMessage({ type: 'clear', pad });
    this.state.pads[pad] = emptyPad(pad, this.state.steps);
    clearPadFile(pad).catch(() => {});
    this.emitState();
  }

  // ---- pad transforms (all re-bake from source, then verify) -----------
  setPadPitch(pad: number, semitones: number): void {
    this.state.pads[pad].pitchSemitones = semitones;
    this.rebake(pad);
  }
  setPadGain(pad: number, gainDb: number): void {
    this.state.pads[pad].gainDb = gainDb;
    this.rebake(pad);
  }
  setPadChoke(pad: number, choke: number | null): void {
    this.state.pads[pad].choke = choke;
    this.rebake(pad);
  }
  /** Destructive, "permanent-marker" transforms: fold the effect into the SOURCE. */
  applyStretch(pad: number, factor: number): void {
    const src = this.source.get(pad);
    if (src) this.setSource(pad, timeStretch(src, factor));
  }
  applyBitcrush(pad: number, bits: number, downsample = 1): void {
    const src = this.source.get(pad);
    if (src) this.setSource(pad, bitcrush(src, bits, downsample));
  }
  normalizePad(pad: number, targetDbfs = -1): void {
    const src = this.source.get(pad);
    if (src) this.setSource(pad, normalizePeak(src, targetDbfs));
  }

  // ---- playback --------------------------------------------------------
  trigger(pad: number, velocity = 1): void {
    const p = this.state.pads[pad];
    if (!p.hasAudio) return;
    this.node?.port.postMessage({ type: 'trigger', pad, gain: velocity, choke: p.choke });
  }
  release(pad: number): void {
    this.node?.port.postMessage({ type: 'release', pad });
  }
  setMaster(gain: number): void {
    this.state.masterGain = gain;
    this.node?.port.postMessage({ type: 'master', gain });
    this.emitState();
  }

  // ---- transport / sequencer ------------------------------------------
  setBpm(bpm: number): void {
    this.state.bpm = Math.max(20, Math.min(300, bpm));
    this.emitState();
  }
  setSteps(n: number): void {
    this.state.steps = n;
    for (const p of this.state.pads) {
      const seq = new Array(n).fill(false);
      for (let i = 0; i < Math.min(n, p.sequence.length); i++) seq[i] = p.sequence[i];
      p.sequence = seq;
    }
    this.emitState();
  }
  toggleStep(pad: number, step: number): void {
    const seq = this.state.pads[pad].sequence;
    seq[step] = !seq[step];
    this.emitState();
  }

  play(): void {
    if (!this.ctx || this.state.playing) return;
    this.state.playing = true;
    this.state.currentStep = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    const stepDur = () => 60 / this.state.bpm / 4; // 16th notes
    const tick = () => {
      if (!this.ctx || !this.state.playing) return;
      const now = this.ctx.currentTime;
      while (this.nextStepTime < now + 0.1) {
        const step = this.state.currentStep;
        for (let pad = 0; pad < PAD_COUNT; pad++) {
          if (this.state.pads[pad].sequence[step]) this.trigger(pad, 1);
        }
        this.emit('step', step);
        this.state.currentStep = (step + 1) % this.state.steps;
        this.nextStepTime += stepDur();
      }
      this.scheduler = self.setTimeout(tick, 25);
    };
    tick();
    this.emitState();
  }

  stop(): void {
    this.state.playing = false;
    if (this.scheduler != null) self.clearTimeout(this.scheduler);
    this.scheduler = null;
    this.node?.port.postMessage({ type: 'stopAll' });
    this.emitState();
  }

  // ---- offline render: export + resample-as-instrument -----------------
  /**
   * Deterministically render `bars` of the current sequence to a single Signal
   * on this thread (no realtime capture — reproducible and contract-checkable).
   * This is the engine of both WAV export AND resample-as-instrument.
   */
  renderSequence(bars = 1): Signal {
    const stepDur = 60 / this.state.bpm / 4;
    const stepFrames = Math.round(stepDur * this.sampleRate);
    const totalSteps = this.state.steps * bars;
    const master = silence(this.sampleRate, 2, totalSteps * stepFrames + this.longestPadFrames());
    for (let s = 0; s < totalSteps; s++) {
      const step = s % this.state.steps;
      const at = s * stepFrames;
      for (let pad = 0; pad < PAD_COUNT; pad++) {
        if (!this.state.pads[pad].sequence[step]) continue;
        const buf = this.baked.get(pad);
        if (buf) mixInto(master, buf, at);
      }
    }
    return applyGain(master, this.state.masterGain);
  }

  /** Koala's soul: bounce the current pattern back onto a pad to rework it. */
  resampleSequenceToPad(destPad: number, bars = 1): void {
    this.setSource(destPad, this.renderSequence(bars));
  }

  exportPadWav(pad: number): Uint8Array | null {
    const buf = this.baked.get(pad);
    return buf ? encodeWav(buf, 24) : null;
  }
  exportMixWav(bars = 1): Uint8Array {
    return encodeWav(this.renderSequence(bars), 24);
  }

  // ---- persistence -----------------------------------------------------
  async saveProject(): Promise<void> {
    if (!opfsSupported()) return;
    await Promise.all([...this.source.entries()].map(([pad, sig]) => savePad(pad, sig)));
  }
  async loadProject(): Promise<void> {
    if (!opfsSupported()) return;
    for (let pad = 0; pad < PAD_COUNT; pad++) {
      const sig = await loadPad(pad);
      if (sig) this.setSource(pad, sig);
    }
  }

  // ---- internals -------------------------------------------------------
  private longestPadFrames(): number {
    let max = 0;
    for (const b of this.baked.values()) max = Math.max(max, frames(b));
    return max;
  }

  /** Store a new source buffer for a pad and re-bake it. */
  private setSource(pad: number, sig: Signal): void {
    this.source.set(pad, sig);
    this.rebake(pad);
  }

  /**
   * Apply the pad's pitch + gain to its source, VERIFY the result against the
   * output contract, ship it to the worklet, and record the outcome in state.
   * A pad that fails its contract is marked unverified and NOT loaded — honest
   * failure rather than a silent bad buffer.
   */
  private rebake(pad: number): void {
    const src = this.source.get(pad);
    const ps = this.state.pads[pad];
    if (!src) return;
    let buf = src;
    // Conform any off-rate source (a 48k file in a 44.1k context, a synth kit)
    // to the context rate so the dumb worklet plays it at the right speed.
    if (buf.sampleRate !== this.sampleRate) buf = resampleLinear(buf, this.sampleRate);
    if (ps.pitchSemitones !== 0) buf = repitch(buf, semitonesToRatio(ps.pitchSemitones));
    if (ps.gainDb !== 0) buf = applyGain(buf, dbToLinear(ps.gainDb));

    const checks = [assertNonEmpty(buf), assertFiniteBounded(buf, 1.5)];
    const verified = checks.every((c) => c.ok);

    ps.checks = checks;
    ps.verified = verified;
    if (verified) {
      this.baked.set(pad, buf);
      ps.id = contentHash(buf);
      ps.hasAudio = true;
      ps.frames = frames(buf);
      ps.durationS = durationSeconds(buf);
      this.node?.port.postMessage({
        type: 'load',
        pad,
        choke: ps.choke,
        channels: buf.channels.map((c) => c.slice()),
      });
    } else {
      this.baked.delete(pad);
      ps.hasAudio = false;
      this.node?.port.postMessage({ type: 'clear', pad });
    }
    this.emitState();
  }
}

/** Add `src` into `dst` at frame offset `at`, mono-expanding as needed. In place. */
function mixInto(dst: Signal, src: Signal, at: number): void {
  const n = frames(src);
  for (let c = 0; c < dst.channels.length; c++) {
    const sc = src.channels[c] ?? src.channels[0];
    const d = dst.channels[c];
    for (let i = 0; i < n; i++) {
      const j = at + i;
      if (j < d.length) d[j] += sc[i];
    }
  }
}
