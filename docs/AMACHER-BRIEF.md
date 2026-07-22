# Amacher Brief — LUFS Web Sampler UI

**This is your brief and your init prompt for the full UI session.** Everything you need to build the real interface without reading the DSP code lives here: the stack, the exact engine surface you wire into, the creative direction, the constraints, and the gaps I own.

The deal is the same as always: **Ciani owns the engine, Amacher owns the surface.** The engine ([`packages/app/src/engine/engine.ts`](../packages/app/src/engine/engine.ts)) is headless and UI-agnostic. You never touch sample data or DSP — you subscribe to engine state, render it, and call engine methods on interaction. Don't fork engine logic into the view.

---

## 1. Stack context (what you're building on)

- **Monorepo, npm workspaces.** `packages/sampler-core` = the verified pure-DSP crown jewel (don't touch). `packages/app` = where the UI lives.
- **The UI you replace is throwaway** — the wiring lives in [`packages/app/src/ui.ts`](../packages/app/src/ui.ts) (shared), with thin entries [`main.ts`](../packages/app/src/main.ts) (served app) and [`demo.ts`](../packages/app/src/demo.ts) (self-contained published demo), over [`index.html`](../packages/app/index.html). It exists only to prove every engine method works end-to-end. Read `ui.ts` as the reference wiring, then replace it.
- **There is a live playable demo** — `npm run dev` locally, or `npm run build:demo` → a single self-contained `demo-standalone.html`. It auto-loads a synthesized drum kit (`demokit.ts`) + a starter pattern so it makes sound with no mic.
- **Realtime split:** heavy DSP runs on the main thread (verified) and finished buffers are shipped to a dumb AudioWorklet that only plays/mixes/meters. You don't deal with any of that — you talk to `SamplerEngine`.
- **Stack:** Vite 5 + TypeScript 5, **no runtime dependencies**. Bring whatever view layer you want (vanilla, Lit, Svelte, Solid — your call), but keep the bundle light and the light path (no WASM/threads) working. Dev server: `npm run dev`.
- **Build/deploy** already wired per website-portability (`site.yaml`, `.nvmrc`, fail-closed `verify-artifact.mjs`, staged `ci/deploy.yml`). Don't break the verify gate — the build must still emit `index.html` + a hashed bundle + the worklet + manifest + sw.

## 2. The engine surface — everything you call and subscribe to

Import and construct once:

```ts
import { SamplerEngine, PAD_COUNT } from './engine/engine.ts'; // PAD_COUNT = 16
const engine = new SamplerEngine();
```

### Lifecycle
| Call | When |
|---|---|
| `await engine.init(workletUrl?)` | **MUST be inside a user-gesture handler** (tap/click). iOS unlock rule — no `await` before it in your handler. Creates the AudioContext, loads the worklet, connects output. `workletUrl` defaults to the served `sampler-processor.js`; the demo passes a Blob URL. |
| `engine.getSampleRate()` | AudioContext rate — pads are conformed to it on bake, so you can hand it to a synth/analysis path. |

### Events — `engine.on(ev, cb)` returns an unsubscribe fn
| Event | Payload | Use |
|---|---|---|
| `'state'` | `EngineState` (full snapshot) | re-render everything; fires after every mutation |
| `'levels'` | `{ peak: number; voices: number }` | master meter (~every 10 ms) |
| `'step'` | `number` (current step index) | pulse the sequencer playhead |

Render from the snapshot; treat state as the source of truth (don't keep your own copy of pad data).

### State shapes (read-only)
```ts
interface EngineState {
  ready: boolean; playing: boolean; recording: boolean; armedPad: number | null;
  bpm: number; steps: number; currentStep: number; masterGain: number;
  pads: PadState[];              // length 16
}
interface PadState {
  index: number; id: string | null;   // 'lws-<8hex>' content id, or null if empty
  name: string; hasAudio: boolean; frames: number; durationS: number;
  pitchSemitones: number; gainDb: number; choke: number | null;
  sequence: boolean[];               // one flag per step
  verified: boolean;                 // false => the bake failed its contract; NOT playable
  checks: CheckResult[];             // per-check detail if you want to surface why
}
```
> Surface `verified: false` visibly (the throwaway UI shows "UNVERIFIED" in red). A pad that failed its contract is not loaded — that's honest failure, and the UI should show it, not hide it.

### Pad assignment
| Call | Effect |
|---|---|
| `await engine.loadFileToPad(pad, arrayBuffer)` | decode an audio file onto a pad |
| `engine.loadSignalToPad(pad, signal)` | assign an in-memory `Signal` directly (synth kits, tests) |
| `await engine.recordToPad(pad)` / `await engine.stopRecording()` | mic capture → pad (mono on iOS; wrap in try/catch — blocked in sandboxed iframes) |
| `engine.chopToPads(sourcePad, n, startPad?)` | slice a pad into `n` gapless tiles across consecutive pads |
| `engine.clearPad(pad)` | empty a pad (also clears its OPFS file) |

### Pad transforms
Non-destructive (re-bake from source, safe to sweep): `setPadPitch(pad, semitones)`, `setPadGain(pad, gainDb)`, `setPadChoke(pad, group|null)`.
Destructive "permanent-marker" (fold into source — Koala ethos): `applyStretch(pad, factor)`, `applyBitcrush(pad, bits, downsample?)`, `normalizePad(pad, targetDbfs?)`.

### Playback / transport
`trigger(pad, velocity?)`, `release(pad)`, `setMaster(gain)`, `setBpm(bpm)`, `setSteps(n)`, `toggleStep(pad, step)`, `play()`, `stop()`.

### The soul + output
| Call | Effect |
|---|---|
| `engine.resampleSequenceToPad(destPad, bars?)` | **bounce the current pattern back onto a pad** — the resample-as-instrument loop; make this feel central |
| `engine.exportPadWav(pad)` → `Uint8Array \| null` | 24-bit WAV of one pad |
| `engine.exportMixWav(bars?)` → `Uint8Array` | 24-bit WAV of the rendered pattern |
| `await engine.saveProject()` / `await engine.loadProject()` | OPFS persistence of all pads |

Download helper (WAV → file):
```ts
const blob = new Blob([bytes], { type: 'audio/wav' });
const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
a.download = 'mix.wav'; a.click(); URL.revokeObjectURL(a.href);
```

### Visualization
| Call | Use |
|---|---|
| `engine.getAnalyser()` → `AnalyserNode \| null` | live master scope + FFT (Waveform hero); same API your prototype's analyser used |
| `engine.peaks(pad, columns)` → `{ min, max } \| null` | static per-pad waveform thumbnails (per-column min/max) |

### Minimal wiring skeleton
```ts
startButton.onclick = async () => {
  await engine.init();                       // gesture unlock
  engine.on('state', renderFromState);
  engine.on('levels', ({ peak }) => setMeter(peak));
  engine.on('step', highlightPlayhead);
  renderFromState(engine.state);
};
// pads: pointerdown -> engine.trigger(i)
// seq cell: pointerdown -> engine.toggleStep(selectedPad, step)
// transport: engine.play()/stop()/setBpm(v)
```

## 3. Creative direction

Identity is **LUFS Audio**: charcoal `#111214` ground, teal `#78BEBA` as the single lead accent, the four-color spectrum (red `#D35233`, dusty `#9FC1D0`, terra `#C8654A`, gold `#D9A23D`) as seasoning; `lufs.` wordmark with the trailing teal dot; **Host Grotesk + Public Sans + Space Mono**; dark-editorial / Swiss. Touch-first, mobile-first — this lives on a phone as often as a desktop.

You own the look. Three directions to react to (pick/merge/ignore — same as your recorder + schedule briefs):

1. **MPC** — tactile hardware homage: fat velocity-lit rubber pads, chunky transport, the sequencer as a step lane under the grid. Warm, physical, "instrument you hit."
2. **Waveform** — viz-forward: each pad shows its waveform thumbnail; a scrolling pattern timeline; resample framed as a visible "bounce" animation. *(See the gap in §5 — rich per-pad/live viz needs a backend addition first; today only a master peak is available.)*
3. **Grid** — minimalist Swiss: monospace readouts (`lws-` ids, durations, BPM), hairline borders, the pad grid and step grid as one coherent matrix. Restraint; the XO/Teenage-Engineering register but honest.

Make **resample-as-instrument** feel like the center of gravity, not a buried button — it's the whole point.

## 4. Constraints (respect these)

- **Init only inside a user gesture**; no `await` before `engine.init()` in that handler (iOS).
- **Drive from `state`** — don't duplicate pad/sequencer state in the view; re-render on the `'state'` event.
- **iOS audio is best-effort** (see [`PWA-LIMITATIONS.md`](./PWA-LIMITATIONS.md)): no Web MIDI, mono mic, the iOS-26 installed-PWA AudioContext bug. Show a gentle "best on Android/desktop; add to home screen on iOS" note; don't promise hardware-MIDI on iOS.
- **Surface `verified: false`** rather than hiding it.
- Keep the **install/offline** story intact (manifest + `sw.js` are wired; don't strip them).
- Don't add COOP/COEP headers yet — no SharedArrayBuffer today; adding them breaks third-party embeds for no gain.

## 5. Visualization surface — DELIVERED (was the two open items)

Both things the UI study asked me to confirm are now in the engine (v0.1), verified:

- **`engine.getAnalyser(): AnalyserNode`** — the live master scope + FFT. `node → analyser → destination` is wired in `init()`, so `getFloatTimeDomainData()` / `getFloatFrequencyData()` on it drive the Waveform hero scope. This is the **same AnalyserNode API your prototype already reads**, so that code transfers 1:1 — swap the demo-only analyser for `engine.getAnalyser()`.
- **`engine.peaks(pad, columns): { min, max } | null`** — per-column min/max of a pad's baked buffer for waveform **thumbnails**. Pure, delegates to the verified core (`peaks()` has its own test). Returns `null` for an empty pad.

Still deferred (say the word if a direction needs them):
- **Per-pad *live* meters** — the analyser is master-bus only; per-voice live metering is a heavier worklet change. Per-pad *static* thumbnails are covered by `peaks()`.
- **Sequencer timing** — a lookahead `setTimeout` scheduler; fine to build against. If you need sample-accurate playhead animation, I'll tighten it.

## 6. Init prompt (paste this to kick off the session)

> **@Amacher** — build the production UI for **LUFS Web Sampler** (`danialrami/lufs-web-sampler`), branching off `main`, PR back (never push main). The engine is done and headless: construct `SamplerEngine`, `await engine.init()` inside a tap handler, subscribe to `'state' | 'levels' | 'step'`, render from the `EngineState` snapshot, and call the documented methods on interaction — full surface in `docs/AMACHER-BRIEF.md §2`. Replace the throwaway UI in `packages/app/src/main.ts` + `index.html`; keep the manifest/sw/verify gate intact. Identity is LUFS (charcoal/teal, Host Grotesk + Public Sans + Space Mono, dark-editorial/Swiss, `lufs.` wordmark). Ship the usual **three toggleable design directions on one published page** for Daniel to pick (MPC / Waveform / Grid — see §3), driven by synthesized state so it's alive without a mic. Make **resample-as-instrument** the center of gravity. Respect the iOS constraints in §4, surface `verified:false` honestly, and if your direction needs live/per-pad visualization, tell me (Ciani) the exact signal — the worklet only emits a master peak today and I'll wire the stream you need.

Related: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`DSP-CORE.md`](./DSP-CORE.md) · [`PWA-LIMITATIONS.md`](./PWA-LIMITATIONS.md)
