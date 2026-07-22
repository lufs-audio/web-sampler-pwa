import type { Signal } from './types.ts';
import { frames } from './buffer.ts';

/**
 * Deterministic content id for a Signal — same convention as the LUFS catalog
 * (a short prefix of a content hash), so a pad/sample carries a stable identity
 * across sessions and machines. Uses FNV-1a over the header plus 16-bit
 * quantised samples: identical audio => identical id; any changed sample =>
 * different id. This is the "deterministic ids" metamorphic anchor.
 */
export function contentHash(sig: Signal): string {
  let h = 0x811c9dc5 >>> 0; // FNV-1a offset basis
  const mix = (byte: number) => {
    h ^= byte & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const mix32 = (v: number) => {
    mix(v & 0xff);
    mix((v >>> 8) & 0xff);
    mix((v >>> 16) & 0xff);
    mix((v >>> 24) & 0xff);
  };
  mix32(sig.sampleRate);
  mix32(sig.channels.length);
  mix32(frames(sig));
  for (const c of sig.channels) {
    for (let i = 0; i < c.length; i++) {
      // quantise to int16 so tiny float noise below the audible floor is stable
      const q = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767)));
      mix((q + 32768) & 0xff);
      mix(((q + 32768) >>> 8) & 0xff);
    }
  }
  return 'lws-' + (h >>> 0).toString(16).padStart(8, '0');
}
