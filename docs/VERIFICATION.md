# Verification

> "Works" means **proven correct, not merely exited 0.** A component that runs but produces the wrong output is worse than one that fails, because it lies to whoever operates it.

This is inherited directly from [LUFS Workchain](https://github.com/danialrami/lufs-workchain). The web sampler practices what the wider stack preaches.

## Two kinds of check (`packages/sampler-core/src/contract.ts`)

### 1. Assertion primitives — run on every output
Cheap structural guarantees on a single `Signal`:
- `assertFiniteBounded` — every sample finite and within ±limit
- `assertNonEmpty` — non-zero frame count
- `assertSampleRate` / `assertChannels` — shape matches expectation
- `assertDurationApprox` — frame count within tolerance

The engine runs the first two on **every pad bake**; a failing pad is marked `verified: false` and is not loaded.

### 2. Metamorphic relations — for creative ops with no single right answer
You can't assert exact output bytes for a chop or a stretch. You *can* assert invariants:

| Relation | Invariant |
|---|---|
| `chopReassembleIdentity` | chop into N gapless tiles + concat → **sample-exact** original |
| `resampleRoundTrip` | 2× up then down → **exact** identity (any content) |
| `repitchDurationLaw` | `len(repitch(x, r)) ≈ round(len(x) / r)` |
| `stretchDurationLaw` | `len(stretch(x, f)) ≈ round(len(x) · f)` within tol |
| `gainComposition` | `gain(gain(x,a),b) == gain(x, a·b)` |
| `wavRoundTrip` | float32 exact; 16-bit within one quantum |
| `hashDeterminism` | stable across calls; sensitive to a 1-sample change |

`runContract(sig)` runs the whole battery and returns every result.

## Gates

```
npm run precheck   # runContract on a synthetic signal — the DSP must be right first
npm test           # full battery over mono/stereo/noise/sine/one-shot/48k fixtures
npm run build      # build once
npm run verify     # fail-closed: right files must exist, or the deploy dies
npm run ci         # all four, in order
```

Current state: **18/18 tests green**; precheck **11/11** contract checks green. `verify-artifact.mjs` emits `artifact.json` + `SHA256SUMS` (content id `lws-<8hex>`).

## The rule for contributors

Every change ships with a contract and a passing check. If you add an operation, add its metamorphic relation. If you can't state an invariant it must satisfy, you don't yet understand it well enough to ship it.

Related: [`DSP-CORE.md`](./DSP-CORE.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md)
