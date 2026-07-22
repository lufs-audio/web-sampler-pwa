# The DSP Core — the crown jewel

`@lufs/sampler-core` is the reusable asset this whole project exists to get right. The app is disposable; the core is not.

## What makes it the crown jewel

1. **Pure and portable.** Zero dependencies. No DOM, no Web Audio, no Node APIs. It is just functions over `Float32Array`. Therefore it runs *unchanged* in:
   - a **Node test process** (Node 24 strips the TypeScript types and runs it directly — no build step), and
   - a **browser AudioWorklet** (Vite bundles it into the app).
   One source of truth, two runtimes, no divergence.
2. **Verifiable.** It ships its own correctness contract (`contract.ts`) — the same "proven, not merely exited 0" doctrine as LUFS Workchain. See [`VERIFICATION.md`](./VERIFICATION.md).
3. **A conformance oracle.** The TypeScript implementation *is* the reference. When we later reimplement a hot path in **Rust→WASM** (for native reuse and a Workchain component), it must pass the identical metamorphic contract. This is Workchain's "one contract, many implementations" applied client-side.

## The operations

| Module | Functions | Notes |
|---|---|---|
| `buffer` | `frames`, `durationSeconds`, `concat`, `toMono`, `measure`, `isBounded`, `silence`, `cloneSignal` | measurement in real terms (peak, RMS, dBFS) |
| `gain` | `applyGain`, `dbToLinear`, `normalizePeak`, `applyGate` | attack/release gate for one-shots |
| `slice` | `slice`, `chopEqual`, `chopAt`, `materialize` | `chopEqual` tiles gaplessly — the identity anchor |
| `resample` | `resampleLinear`, `repitch`, `semitonesToRatio` | repitch = varispeed (pitch+time coupled, on purpose) |
| `stretch` | `timeStretch` | pitch-preserving OLA (Hann, 75% overlap) |
| `fx` | `bitcrush`, `onePoleLowpass`, `delay` | SP-303-style grit primitives |
| `wav` | `encodeWav`, `decodeWav` | 16 / 24 / 32-bit-float RIFF/WAVE |
| `hash` | `contentHash` | FNV-1a → `lws-<8hex>`, deterministic id (catalog convention) |

Two distinct pitch operations, on purpose:
- **`repitch(sig, ratio)`** — varispeed: read faster/slower, keep the sample rate. Pitch *and* duration change together (playing a pad at a different key).
- **`timeStretch(sig, factor)`** — change duration, *preserve* pitch (OLA). The opposite coupling.

## The contract caught two real bugs

This is the point of the doctrine, demonstrated on its own author during the v0.1 build:

1. **Dishonest resample round-trip.** The first `resampleRoundTrip` invariant resampled through a *lower* rate (44.1k→32k→44.1k) and asserted near-identity. On broadband noise it failed — correctly — because content above the intermediate Nyquist is *gone*; the invariant was a lie. Fix: round-trip through an exact 2× *up*-sample, which is a mathematical identity for linear interpolation regardless of content. The relation is now honest and holds for noise too.
2. **OLA peak overshoot.** `timeStretch` applied the Hann window once but normalized by Σ(window²) — the WOLA (window-twice) normalizer — so output peaks blew past the input. Fix: normalize by Σ(window). Peak now stays bounded by the input.

Both were caught by the metamorphic battery before the code ever ran in a browser. That is the whole argument for the verifier, and it earned its keep on day one.

## Why pure-TS now, Rust→WASM later

- The sandbox that built this had **no Rust/WASM toolchain**, so a Rust core could not have been *proven* here — and unproven DSP violates the doctrine.
- TypeScript is the actual AudioWorklet target and is honestly testable *now* in Node.
- The TS core becomes the oracle. A future `sampler-core-wasm` (Rust, wasm-pack) implements the same signatures and must pass `runContract` byte-for-byte on the relations. Only then does it earn the hot path.

This keeps the light path (pure JS/TS, no threads, no COOP/COEP) always working, and treats WASM as an optimization behind an unchanged contract — never a prerequisite.

Related: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`VERIFICATION.md`](./VERIFICATION.md)
