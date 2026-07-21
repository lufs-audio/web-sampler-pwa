import type { Signal } from './types.ts';
import { frames, silence } from './buffer.ts';

export type WavBitDepth = 16 | 24 | 32; // 32 => IEEE float

function clamp(x: number): number {
  return x > 1 ? 1 : x < -1 ? -1 : x;
}

/** Encode a Signal to a canonical RIFF/WAVE byte buffer. */
export function encodeWav(sig: Signal, bitDepth: WavBitDepth = 16): Uint8Array {
  const ch = sig.channels.length;
  const n = frames(sig);
  const sr = sig.sampleRate;
  const isFloat = bitDepth === 32;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = ch * bytesPerSample;
  const dataLen = n * blockAlign;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, isFloat ? 3 : 1, true); // 1 = PCM, 3 = IEEE float
  dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitDepth, true);
  ws(36, 'data');
  dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = clamp(sig.channels[c][i]);
      if (isFloat) {
        dv.setFloat32(o, v, true);
        o += 4;
      } else if (bitDepth === 16) {
        dv.setInt16(o, Math.round(v * 32767), true);
        o += 2;
      } else {
        // 24-bit little-endian signed
        const s = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607)));
        dv.setUint8(o, s & 0xff);
        dv.setUint8(o + 1, (s >> 8) & 0xff);
        dv.setUint8(o + 2, (s >> 16) & 0xff);
        o += 3;
      }
    }
  }
  return new Uint8Array(buf);
}

/** Decode a canonical PCM/float WAVE buffer back to a Signal. */
export function decodeWav(bytes: Uint8Array): Signal {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rd = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (rd(0) !== 'RIFF' || rd(8) !== 'WAVE') throw new Error('decodeWav: not a RIFF/WAVE file');
  let o = 12;
  let fmt: { audioFormat: number; ch: number; sr: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  while (o + 8 <= dv.byteLength) {
    const id = rd(o);
    const size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: dv.getUint16(body, true),
        ch: dv.getUint16(body + 2, true),
        sr: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = size;
    }
    o = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || dataOff < 0) throw new Error('decodeWav: missing fmt or data chunk');
  const bytesPerSample = fmt.bits / 8;
  const blockAlign = fmt.ch * bytesPerSample;
  const n = Math.floor(dataLen / blockAlign);
  const out = silence(fmt.sr, fmt.ch, n);
  let p = dataOff;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < fmt.ch; c++) {
      if (fmt.audioFormat === 3) {
        out.channels[c][i] = dv.getFloat32(p, true);
        p += 4;
      } else if (fmt.bits === 16) {
        out.channels[c][i] = dv.getInt16(p, true) / 32768;
        p += 2;
      } else if (fmt.bits === 24) {
        const b0 = dv.getUint8(p), b1 = dv.getUint8(p + 1), b2 = dv.getUint8(p + 2);
        let s = b0 | (b1 << 8) | (b2 << 16);
        if (s & 0x800000) s |= ~0xffffff; // sign-extend
        out.channels[c][i] = s / 8388608;
        p += 3;
      } else {
        throw new Error('decodeWav: unsupported bit depth ' + fmt.bits);
      }
    }
  }
  return out;
}
