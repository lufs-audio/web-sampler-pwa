# LUFS Web Sampler

**A browser-native sampler — Koala's soul, honestly scoped to the web — built on a verifiable, portable DSP core.**

Record anything, chop it, sequence it, mangle it, resample it back onto a pad. No App Store, no install gate — a real audio tool delivered from a URL. It is the play-side counterpart to [`lufs-recorder`](https://github.com/danialrami/lufs-recorder) (recorder = capture; sampler = play).

> Status: **v0.1**. The DSP core — the crown jewel — is complete and **proven** (18/18 metamorphic tests green; the contract caught two real bugs during the build). The app engine + a throwaway UI are wired end-to-end. The real UI is a separate session (see [`docs/AMACHER-BRIEF.md`](docs/AMACHER-BRIEF.md)).

## Why this exists

We studied cloning two iOS music apps as PWAs: **AUM** (Kymatica) and **Koala** (Elf Audio).

- **AUM can't be a PWA.** Its reason to exist is hosting AUv3 *native* plugins and low-latency inter-app routing. A browser sandbox can't load native plugin code — a web "AUM" would be a mixer with nothing to mix.
- **Koala can.** It's a self-contained sampler (custom portable C++ core, per its creator — not JUCE; already on five platforms). It needs no plugin hosting, and every core move maps onto Web Audio. So we clone Koala's **soul** — the "no brake-pedal" record→chop→sequence→mangle→resample flow — not its full feature list.

Full study: [`docs/PWA-LIMITATIONS.md`](docs/PWA-LIMITATIONS.md) and the KB suite `docs/product/lufs-web-sampler/`.

## The crown jewel: a verifiable, portable DSP core

[`packages/sampler-core`](packages/sampler-core) is **pure TypeScript, zero dependencies, no DOM / no Web Audio / no Node APIs**. That means it runs *identically* in a Node test process (Node 24 type-stripping) and inside a browser AudioWorklet (Vite). It ships with a **metamorphic verification contract** — the same "proven, not exited-0" doctrine as [LUFS Workchain](https://github.com/danialrami/lufs-workchain).

It is the **conformance oracle**: a future Rust→WASM hot-path implementation must pass the *same* contract. The reusable asset is the verified core, not the app.

```
packages/
  sampler-core/   # pure DSP + metamorphic contract + tests   ← the crown jewel
  app/            # realtime worklet + headless engine + throwaway UI
docs/             # architecture, dsp-core, verification, pwa-limits, AMACHER brief
scripts/          # precheck (contract gate) + fail-closed artifact verify
ci/deploy.yml     # website-portability output-branch adapter (staged)
site.yaml         # neutral build manifest
```

## Quickstart

```bash
nvm use                # Node 24 (see .nvmrc)
npm install
npm run precheck       # prove the DSP contract before anything else
npm test               # full metamorphic battery (18 tests)
npm run dev            # throwaway UI at http://localhost:5173
npm run build && npm run verify   # build once, then fail-closed verify
```

No runtime dependencies. Vite + TypeScript are the only devDeps.

## Definition of done

A change ships only when it is **verified**: it declares a contract and passes it. Green exit codes are not enough. See [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

## License

GPL-3.0-or-later (matches `lufs-recorder`). See [`LICENSE`](LICENSE).
