import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const workspaceDir = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, workspaceDir, 'VITE_');
  const base = env.VITE_BASE_PATH ?? '/';
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) {
    throw new Error('VITE_BASE_PATH must be / or a path such as /c-viz/.');
  }
  return {
    root: fileURLToPath(new URL('./web', import.meta.url)),
    envDir: workspaceDir,
    base,
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  };
});
