# Architecture

## The one decision that shapes everything

**Heavy, creative DSP runs on the main thread through the verified core; the realtime AudioWorklet stays dumb.**

The worklet ([`packages/app/public/sampler-processor.js`](../packages/app/public/sampler-processor.js)) only plays pre-baked pad buffers, mixes voices, applies master gain, and posts back a peak meter — allocation-free in `process()`. It is plain JS (no bundler in the realtime path). Every expensive operation — chop, repitch, time-stretch, bitcrush, WAV encode, offline render — happens on the main thread in [`@lufs/sampler-core`](../packages/sampler-core), is **verified against the contract**, and only then is the finished `Float32Array` shipped to the worklet via `port.postMessage`.

Why: the verified 2026 browser reality (see [`PWA-LIMITATIONS.md`](./PWA-LIMITATIONS.md)) shows iOS Safari's AudioWorklet is unstable at the mandated 128-sample render quantum. Doing real work on that thread invites crackle and the iOS-26 AudioContext-death failure mode. So we don't.

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  UI  (throwaway now → Amacher's real UI later)                │
│  subscribes to engine state/levels/step, calls engine methods │
└───────────────┬─────────────────────────────────────────────┘
                │  (no DSP here — UI never touches sample data)
┌───────────────▼─────────────────────────────────────────────┐
│  SamplerEngine   (packages/app/src/engine/engine.ts)          │
│  pads · sequencer · recorder · OPFS · offline render          │
│  every transform: re-bake from source → VERIFY → ship buffer  │
└───────┬───────────────────────────────────┬─────────────────┘
        │ finished buffers (postMessage)     │ pure calls
┌───────▼───────────────────┐   ┌────────────▼─────────────────┐
│  AudioWorklet (realtime)   │   │  @lufs/sampler-core (pure DSP)│
│  voice playback + mix +    │   │  slice/chop/resample/repitch/ │
│  meter — allocation-free   │   │  stretch/fx/wav/hash + CONTRACT│
└────────────────────────────┘   └───────────────────────────────┘
```

## Data model

- **Signal** — the single currency: `{ sampleRate, channels: Float32Array[] }`, samples in [-1, 1]. Deinterleaved. No wrapper class.
- **source vs baked** — each pad keeps a *source* buffer (post-destructive-edits like stretch/crush) and a *baked* buffer (source + pitch + gain applied). Non-destructive controls (pitch, gain) re-bake from source so they never compound. Destructive "permanent-marker" ops (`applyStretch`, `applyBitcrush`, `normalizePad`) fold into the source — Koala's un-precious ethos.
- **Verification on every bake** — `rebake()` runs `assertNonEmpty` + `assertFiniteBounded`; a pad that fails is marked `verified: false` and is **not** loaded into the worklet. Honest failure over a silent bad buffer.

## Resample-as-instrument (Koala's soul)

`renderSequence(bars)` deterministically renders the current pattern to one Signal on the main thread (not a realtime capture — reproducible and contract-checkable). It powers both **WAV export** and `resampleSequenceToPad()` — bounce the pattern back onto a pad and keep mangling. That feedback loop is the mechanical heart of the whole app.

## Build & deploy

Per the LUFS **website-portability** contract:
- `site.yaml` — neutral, target-independent build manifest.
- `.nvmrc` — toolchain pin (Node 24).
- committed lockfile → `npm ci` frozen installs.
- `scripts/verify-artifact.mjs` — **fail-closed**: the build must produce the right files (index + hashed bundle + worklet + manifest + sw), or the deploy fails. Emits `artifact.json` + `SHA256SUMS` provenance (content id `lws-<8hex>`, same convention as the LUFS catalog).
- `ci/deploy.yml` — output-branch adapter, **staged** (the GitHub token can't write `.github/workflows/`; a human runs `git mv ci/deploy.yml .github/workflows/deploy.yml`). Primary managed edge is Cloudflare Pages; the output branch is the fallback / DR path.

## Known gaps (honest status)

- **No live input/visualization stream.** The worklet posts only a master peak meter. Per-pad meters, input monitoring, or an FFT/waveform stream for a viz-forward UI need a new worklet→main message channel (mirrors the `lufs-recorder` levels-stream gap). Flagged for Amacher in [`AMACHER-BRIEF.md`](./AMACHER-BRIEF.md).
- **Sequencer timing** is a lookahead `setTimeout` scheduler — fine for a demo; a sample-accurate scheduler is a later upgrade.
- **iOS audio is best-effort** — see PWA limitations.

Related: [`DSP-CORE.md`](./DSP-CORE.md) · [`VERIFICATION.md`](./VERIFICATION.md) · [`AMACHER-BRIEF.md`](./AMACHER-BRIEF.md)
