// Self-contained demo entry for the published single-file build. Loads the
// realtime worklet from an inlined Blob URL (no separate served file), and
// auto-loads the demo kit + a starter pattern so it makes sound immediately —
// mic capture is typically blocked in a sandboxed iframe, so we don't rely on it.
// __WORKLET_SRC__ is replaced at bundle time with the worklet source string.
declare const __WORKLET_SRC__: string;
import { SamplerEngine } from './engine/engine.ts';
import { mountUI } from './ui.ts';
import { loadDemoKit } from './demokit.ts';

const engine = new SamplerEngine();
mountUI(engine, {
  init: async () => {
    const url = URL.createObjectURL(new Blob([__WORKLET_SRC__], { type: 'application/javascript' }));
    await engine.init(url);
  },
  afterInit: () => loadDemoKit(engine),
});
