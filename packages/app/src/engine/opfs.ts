import type { Signal } from '@lufs/sampler-core';
import { encodeWav, decodeWav } from '@lufs/sampler-core';

/**
 * Sample-library persistence via the Origin Private File System. Verified
 * supported on iOS Safari since 16.4 with a generous (~20% of disk) quota — the
 * one storage story that is genuinely solid on iOS in 2026. Pads are stored as
 * plain 24-bit WAV files so the on-disk format is inspectable and portable.
 */
export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage && !!navigator.storage.getDirectory;
}

async function dir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('pads', { create: true });
}

export async function savePad(pad: number, sig: Signal): Promise<void> {
  const d = await dir();
  const fh = await d.getFileHandle(`pad-${pad}.wav`, { create: true });
  const ws = await fh.createWritable();
  await ws.write(encodeWav(sig, 24));
  await ws.close();
}

export async function loadPad(pad: number): Promise<Signal | null> {
  try {
    const d = await dir();
    const fh = await d.getFileHandle(`pad-${pad}.wav`);
    const file = await fh.getFile();
    return decodeWav(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
}

export async function clearPadFile(pad: number): Promise<void> {
  try {
    const d = await dir();
    await d.removeEntry(`pad-${pad}.wav`);
  } catch {
    /* absent is fine */
  }
}

/** Best-effort request for durable (non-evicted) storage. */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist) return navigator.storage.persist();
  return false;
}
