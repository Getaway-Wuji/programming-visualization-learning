import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: fileURLToPath(new URL('./browser', import.meta.url)),
  publicDir: fileURLToPath(new URL('../web/public', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4196,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
});
