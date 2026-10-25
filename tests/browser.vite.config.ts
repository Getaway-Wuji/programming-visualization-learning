import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./browser/harness', import.meta.url)),
  base: '/checks/',
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('../.artifacts/browser-dist', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
  },
});
