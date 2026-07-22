# LUFS Web Sampler — UI Study (Amacher)

The chosen surface direction for the web sampler, captured as a **self-contained, playable prototype** plus this spec. It is the visual + interaction source of truth for the production UI that replaces the throwaway UI in `packages/app`.

> **Status:** design reference, approved direction (Daniel, round 2). Not yet wired to the real engine — the prototype runs a **mock `SamplerEngine`** that mirrors Ciani's exact contract so the wiring transfers 1:1. See _Handoff_ below.

**Playable prototype:** [`lufs-web-sampler-looks.html`](./lufs-web-sampler-looks.html) — open it in a browser (or the published demo). Tap to start; a synthesized kit + starter groove play with no mic.

---

## What this is

- **Two looks, one live engine**, toggled at the top; the engine persists across the switch (the beat keeps playing).
  - **Waveform** — viz-forward. Live master scope, per-pad waveform thumbnails, MPC-style per-pad corner pattern dots, a focused step lane at the bottom.
  - **Grid** — Swiss/technical. A monospace matrix (`content id · dur · pit · gain · 16 steps`) with a gold playhead column, the resample call shown literally (`resampleSequenceToPad( n, 1 )`), and the same focused step lane at the bottom.
- **Resample-as-instrument is the center of gravity** in both — bounce the pattern onto a pad, and it becomes a playable one-shot.
- **Identity:** LUFS Audio — charcoal `#111214`, teal `#78BEBA` single lead accent, four-color seasoning (`#D35233` `#9FC1D0` `#C8654A` `#D9A23D`), Host Grotesk + Public Sans + Space Mono, `lufs.` wordmark. Dark-editorial / Swiss.
- **Honest failure:** a pad whose bake failed its contract is shown `UNVERIFIED` (red) and is not playable. The prototype seeds pad 16 as UNVERIFIED to demonstrate.

## Settings (slide-in drawer)

Gear top-right on desktop; in the bottom bar on mobile. Sections:

- **Audio engine** — context state, sample rate, resume, master volume
- **Permissions** — Microphone + MIDI request buttons with live status (MIDI noted unsupported on iOS)
- **Pattern** — steps (8/16), tempo
- **Export** — selected pad WAV, pattern mix WAV (24-bit, rendered offline from the verified core)
- **Project** — save / load / reload kit / clear all
- **Install** — add to home screen (PWA)
- **System** — verified-pad count, reduce-motion, repo link

## Sample upload / drop-in

Load your own audio onto pads two ways, both routed through the engine's documented `loadFileToPad(pad, ArrayBuffer)` — **no new engine surface required**:

- **Drag-and-drop** a file (or several) onto a pad/tile/row. Multiple files distribute across consecutive pads from the drop target. A file dropped anywhere else lands on the selected pad.
- **File picker** ("load file"), also multi-select.

Accepted: `wav / mp3 / aiff / flac / ogg / m4a / aac`. A file that fails to decode leaves its pad untouched and reports it (production: the pad bakes and is marked `UNVERIFIED` on contract failure).

## Responsive

Verified on desktop (1920) and mobile (390×844):

- **Mobile** gets a sticky bottom control bar (play/stop · BPM · ↺ bounce · ⚙), tiles drop to 2-up, the step lane wraps to two rows of 8 fat pads, the Grid matrix scrolls horizontally with the lane as the primary editor, and Settings becomes a full-width sheet.
- Tap targets ≥ ~40px; safe-area padding on the bottom bar; `prefers-reduced-motion` honored; focus-visible + semantic markup.

---

## Engine bindings (what the production UI calls)

The UI is a pure view over the headless engine — subscribe to state, render, call methods on interaction. Exact surface used (from `docs/AMACHER-BRIEF.md §2`):

- **Lifecycle:** `new SamplerEngine()`, `await engine.init(workletUrl?)` (inside a gesture), `engine.getSampleRate()`
- **Events (`on(ev,cb) → unsubscribe`):** `'state'` (full `EngineState`), `'levels'` (`{peak,voices}`), `'step'` (index)
- **Assignment:** `loadFileToPad`, `loadSignalToPad`, `recordToPad`/`stopRecording`, `chopToPads`, `clearPad`
- **Transforms:** `setPadPitch`, `setPadGain`, `setPadChoke`; `applyStretch`, `applyBitcrush`, `normalizePad`
- **Transport:** `trigger`, `release`, `setMaster`, `setBpm`, `setSteps`, `toggleStep`, `play`, `stop`
- **Soul + out:** `resampleSequenceToPad`, `exportPadWav`, `exportMixWav`, `saveProject`, `loadProject`

## Mock vs. real (what changes when wiring to the engine)

| Prototype (mock) | Production (real engine) |
|---|---|
| Synthesized demo kit + starter groove | `loadFileToPad` / `recordToPad` / `loadSignalToPad`; kit optional |
| `peaks(pad,n)` implemented in the mock for thumbnails | **needs Ciani** to expose `peaks(pad,n)` (offered in the brief) |
| Waveform master scope reads the `AnalyserNode` directly (demo-only) | **needs Ciani** — a worklet→main scope/levels stream if we want per-pad meters/FFT; today `'levels'` is master **peak** only |
| Sequencer playhead from a `setTimeout` clock | fine to build against; tighten if we need sample-accurate animation |
| `saveProject`/`loadProject` to `localStorage` | OPFS persistence in the real engine |

Everything else (both looks, settings, drop-in upload, transport, transforms, resample, export, responsive) binds to the engine as-is.

## Handoff

1. **Merge PR #1** (Ciani's `v0.1` engine/app) so the real engine lands on `main`.
2. Amacher confirms the surface with Ciani (the two items above: `peaks()` + the scope/levels stream decision).
3. Amacher branches the **production UI** off the merged `main`, replaces the throwaway `packages/app/src/ui.ts` + `main.ts` + `index.html` with this direction, keeps the manifest/sw/verify gate intact, and PRs back.

_Engine: Ciani · verifiable DSP core. Surface: Amacher._
