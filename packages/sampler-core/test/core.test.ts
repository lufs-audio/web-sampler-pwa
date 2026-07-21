import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frames,
  measure,
  slice,
  chopEqual,
  chopAt,
  concat,
  resampleLinear,
  repitch,
  timeStretch,
  bitcrush,
  onePoleLowpass,
  delay,
  applyGain,
  normalizePeak,
  encodeWav,
  decodeWav,
  contentHash,
  runContract,
  rmsError,
  type Signal,
} from '../src/index.ts';
import { sine, noise, oneShot } from './fixtures.ts';

const fixtures: Array<[string, Signal]> = [
  ['sine-mono', sine(440, 0.5)],
  ['sine-stereo', sine(330, 0.5, 44100, 2)],
  ['noise-mono', noise(0.5)],
  ['noise-stereo', noise(0.5, 44100, 2)],
  ['one-shot', oneShot()],
  ['sine-48k', sine(1000, 0.3, 48000)],
];

// The headline: the full metamorphic contract must pass on every fixture.
for (const [name, sig] of fixtures) {
  test(`contract battery: ${name}`, () => {
    const results = runContract(sig);
    const failures = results.filter((r) => !r.ok);
    assert.equal(failures.length, 0, 'failing checks:\n' + failures.map((f) => `  - ${f.name}: ${f.detail}`).join('\n'));
  });
}

test('chopEqual tiles are gapless and cover the whole signal', () => {
  const sig = sine(440, 0.5);
  const regions = chopEqual(sig, 16);
  assert.equal(regions[0].start, 0);
  assert.equal(regions[regions.length - 1].end, frames(sig));
  for (let i = 1; i < regions.length; i++) assert.equal(regions[i].start, regions[i - 1].end);
});

test('chopAt reassembles exactly', () => {
  const sig = noise(0.25);
  const regions = chopAt(sig, [1000, 5000, 9000]);
  const back = concat(regions.map((r) => slice(sig, r.start, r.end)));
  assert.equal(rmsError(sig, back), 0);
});

test('repitch up shortens, down lengthens', () => {
  const sig = sine(440, 0.5);
  assert.ok(frames(repitch(sig, 2.0)) < frames(sig));
  assert.ok(frames(repitch(sig, 0.5)) > frames(sig));
});

test('timeStretch preserves duration law and stays bounded', () => {
  const sig = oneShot();
  const s = timeStretch(sig, 1.5);
  assert.ok(Math.abs(frames(s) - Math.round(frames(sig) * 1.5)) < 2048);
  assert.ok(measure(s).peak <= 1.001);
});

test('resampleLinear changes frame count but preserves duration in seconds', () => {
  const sig = sine(1000, 0.5, 44100);
  const r = resampleLinear(sig, 22050);
  assert.equal(r.sampleRate, 22050);
  assert.ok(Math.abs(frames(r) - frames(sig) / 2) <= 1);
});

test('bitcrush output stays in range and is quantised', () => {
  const sig = noise(0.1);
  const c = bitcrush(sig, 4, 2);
  assert.ok(measure(c).peak <= 1.0001);
  const distinct = new Set(Array.from(c.channels[0]).map((v) => Math.round(((v + 1) / 2) * 15)));
  assert.ok(distinct.size <= 16, `expected <=16 levels, got ${distinct.size}`);
});

test('onePoleLowpass attenuates high-frequency energy more than low', () => {
  const hi = onePoleLowpass(sine(15000, 0.3), 1000);
  const lo = onePoleLowpass(sine(200, 0.3), 1000);
  assert.ok(measure(hi).rms < measure(lo).rms, 'HF should be attenuated more than LF');
});

test('delay extends length and adds an audible echo tail', () => {
  const sig = oneShot(0.1);
  const d = delay(sig, 0.05, 0.5, 0.5);
  assert.ok(frames(d) > frames(sig));
  assert.ok(measure(d).peak <= 1.5);
});

test('normalizePeak hits the target within rounding', () => {
  const sig = applyGain(sine(440, 0.2), 0.1);
  const n = normalizePeak(sig, -1.0);
  const db = measure(n).peakDbfs;
  assert.ok(Math.abs(db - -1.0) < 0.1, `peak ${db}dBFS, expected ~-1`);
});

test('WAV 24-bit round-trip is within one quantum', () => {
  const sig = sine(440, 0.2);
  const back = decodeWav(encodeWav(sig, 24));
  assert.ok(rmsError(sig, back) <= 1 / 8388608 + 1e-9);
});

test('contentHash is stable and sample-sensitive', () => {
  const sig = oneShot();
  assert.equal(contentHash(sig), contentHash(sig));
  const m: Signal = { sampleRate: sig.sampleRate, channels: sig.channels.map((c) => Float32Array.from(c)) };
  m.channels[0][100] += 0.3;
  assert.notEqual(contentHash(sig), contentHash(m));
  assert.match(contentHash(sig), /^lws-[0-9a-f]{8}$/);
});

test('empty signal is handled without throwing', () => {
  const empty: Signal = { sampleRate: 44100, channels: [new Float32Array(0)] };
  assert.equal(frames(empty), 0);
  assert.equal(frames(repitch(empty, 1.5)), 0);
  assert.doesNotThrow(() => encodeWav(empty, 16));
});
