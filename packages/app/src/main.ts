// Production entry: the served app. Loads the worklet from its served file and
// registers the offline service worker. UI logic lives in ui.ts (shared).
import { SamplerEngine } from './engine/engine.ts';
import { mountUI } from './ui.ts';
import { registerServiceWorker } from './pwa.ts';

const engine = new SamplerEngine();
mountUI(engine, { init: () => engine.init() });
registerServiceWorker();
