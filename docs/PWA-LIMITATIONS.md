# PWA Limitations (verified mid-2026)

The promise — *a real audio tool delivered from a URL, no App Store* — is real, but it has an Apple-shaped hole. These are the verified constraints that shaped the architecture. Checked against MDN, caniuse, and WebKit/Chromium status trackers, July 2026.

## The honest tradeoff table

| Capability | Chrome / Edge / Android | Safari & all iOS browsers |
|---|---|---|
| **Web MIDI** (hardware controllers) | ✅ Yes | ❌ **None** — WebKit-locked, no fallback |
| Web Bluetooth / USB / HID (MIDI fallback) | ✅ Chromium | ❌ None on iOS |
| Mic capture channels | ✅ Stereo+ | ⚠️ **Mono only** |
| Web Audio round-trip latency | ⚠️ ~50 ms | ⚠️ ~100 ms+, unstable (native ≈ 5–15 ms) |
| WASM SIMD + threads (future DSP) | ✅ Yes | ✅ Yes (needs COOP/COEP) |
| OPFS storage (sample library) | ✅ Yes | ✅ Yes, ~20% of disk (since iOS 16.4) |
| Install prompt | ✅ Native banner | ⚠️ Manual "Add to Home Screen" |
| Background / locked-screen audio | ✅ Stable | ❌ iOS 26 installed-PWA AudioContext-death bug |

## The one that shaped the code

iOS 26 ships a live, **still-unfixed-through-26.2** bug where an *installed* home-screen PWA's `AudioContext` can die permanently until a full device restart — and it targets sound-producing PWAs specifically. That is exactly this app's profile. So:

- The realtime worklet stays dumb and allocation-free (avoids the 128-quantum crackle path).
- iOS-PWA audio is treated as **best-effort**, never load-bearing.
- A **Capacitor / native shell** is the documented escape hatch if iOS must be first-class.

## What's genuinely good on iOS

OPFS (big sample libraries) and WASM SIMD+threads are solid — better than the folklore. The engine and the storage aren't the problem. The *I/O edges* (MIDI, mic channels, latency, backgrounding) are.

## Net

Lead with **Android + desktop Chrome** — that's where the full promise lands (real install, Web MIDI, stereo, stable audio). Be honest about **iOS** as the weak spot. This is the same lesson `lufs-recorder` taught us about browser audio, from the other direction.

Related: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`AMACHER-BRIEF.md`](./AMACHER-BRIEF.md)
