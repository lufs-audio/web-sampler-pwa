import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Relative base so the built app runs at any domain or subpath a static host
// serves it from (website-portability rule: the host is a swappable adapter).
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // Import the DSP core from source so Vite/esbuild transpiles it as part of
      // the app bundle (it lives outside node_modules). One source of truth,
      // shared with the Node test process.
      '@lufs/sampler-core': fileURLToPath(new URL('../sampler-core/src/index.ts', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
