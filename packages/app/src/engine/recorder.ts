import type { Signal } from '@lufs/sampler-core';

/**
 * Mic capture. Uses MediaRecorder (broadly supported, including iOS Safari) and
 * decodes the captured blob to a Signal via the shared AudioContext. Note the
 * verified platform limits: iOS Safari captures MONO only, requires HTTPS + a
 * user gesture, and may reroute output to the built-in speaker while recording.
 */
export class Recorder {
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  async arm(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  }

  start(): void {
    if (!this.stream) throw new Error('recorder: call arm() first');
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.rec.start();
  }

  async stop(): Promise<Signal> {
    const rec = this.rec;
    if (!rec) throw new Error('recorder: not recording');
    const done = new Promise<void>((res) => (rec.onstop = () => res()));
    rec.stop();
    await done;
    const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
    const buf = await blob.arrayBuffer();
    const audio = await this.ctx.decodeAudioData(buf);
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c).slice());
    return { sampleRate: audio.sampleRate, channels };
  }

  dispose(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}
