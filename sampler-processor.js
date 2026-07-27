// sampler-processor.js — the REALTIME half of the sampler.
//
// Deliberately dumb and allocation-free in process(): it only plays pre-baked
// pad buffers, mixes voices, applies master gain, and posts back a peak meter.
// Every expensive, "creative" operation (chop / stretch / repitch / fx / wav)
// happens on the MAIN thread through @lufs/sampler-core, is verified there, and
// the finished Float32 buffer is shipped here via port.postMessage. Keeping the
// worklet this thin is a direct response to the documented iOS AudioWorklet
// instability at the 128-sample quantum — we never do heavy work on this thread.
//
// This file is plain JS on purpose: it is copied verbatim into the build and
// loaded with audioWorklet.addModule('sampler-processor.js'), so there is no
// bundler in the realtime path.

class SamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** pad index -> { channels: Float32Array[], length } */
    this.pads = new Map();
    /** active voices */
    this.voices = [];
    this.master = 0.9;
    this._meterCounter = 0;
    this._peak = 0;

    this.port.onmessage = (e) => {
      const m = e.data;
      switch (m.type) {
        case 'load':
          this.pads.set(m.pad, { channels: m.channels, length: m.channels[0] ? m.channels[0].length : 0, choke: m.choke ?? null });
          break;
        case 'clear':
          this.pads.delete(m.pad);
          this.voices = this.voices.filter((v) => v.pad !== m.pad);
          break;
        case 'trigger':
          this._trigger(m.pad, m.gain ?? 1, m.choke ?? null);
          break;
        case 'release':
          for (const v of this.voices) if (v.pad === m.pad) v.releasing = true;
          break;
        case 'master':
          this.master = m.gain;
          break;
        case 'stopAll':
          this.voices.length = 0;
          break;
      }
    };
  }

  _trigger(pad, gain, choke) {
    const p = this.pads.get(pad);
    if (!p || p.length === 0) return;
    // choke group: stop other voices in the same group (classic hi-hat behaviour)
    if (choke != null) this.voices = this.voices.filter((v) => v.choke !== choke);
    this.voices.push({ pad, channels: p.channels, length: p.length, pos: 0, gain, choke, releasing: false, env: 1 });
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const chOut = out.length;
    const frames = out[0].length;

    for (let i = 0; i < frames; i++) {
      let mixL = 0;
      let mixR = 0;
      for (let vi = 0; vi < this.voices.length; vi++) {
        const v = this.voices[vi];
        if (v.pos >= v.length) continue;
        const l = v.channels[0][v.pos];
        const r = v.channels[1] ? v.channels[1][v.pos] : l;
        if (v.releasing) {
          v.env *= 0.9995; // ~fast release ramp
          if (v.env < 0.0005) v.pos = v.length;
        }
        mixL += l * v.gain * v.env;
        mixR += r * v.gain * v.env;
        v.pos++;
      }
      mixL *= this.master;
      mixR *= this.master;
      out[0][i] = mixL;
      if (chOut > 1) out[1][i] = mixR;
      const a = Math.abs(mixL);
      if (a > this._peak) this._peak = a;
    }

    // prune finished voices
    if (this.voices.length) this.voices = this.voices.filter((v) => v.pos < v.length);

    // meter roughly every ~10ms
    this._meterCounter += frames;
    if (this._meterCounter >= 512) {
      this.port.postMessage({ type: 'levels', peak: this._peak, voices: this.voices.length });
      this._peak = 0;
      this._meterCounter = 0;
    }
    return true;
  }
}

registerProcessor('sampler-processor', SamplerProcessor);
