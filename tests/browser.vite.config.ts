import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('./browser/harness', import.meta.url)),
  base: '/checks/',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('../.artifacts/browser-dist', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./browser/harness/index.html', import.meta.url)),
        adapters: fileURLToPath(new URL('./browser/harness/adapters.html', import.meta.url)),
        reviews: fileURLToPath(new URL('./browser/harness/reviews.html', import.meta.url)),
        java: fileURLToPath(new URL('./browser/harness/java.html', import.meta.url)),
        cppCourse: fileURLToPath(new URL('./browser/harness/cpp-course.html', import.meta.url)),
        rust2018: fileURLToPath(new URL('./browser/harness/rust2018.html', import.meta.url)),
        python3: fileURLToPath(new URL('./browser/harness/python3.html', import.meta.url)),
      },
    },
  },
});
