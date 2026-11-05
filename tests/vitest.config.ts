import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Full course parsing should not compete with one process per test file.
    maxWorkers: 4,
    reporters: ['default', 'json'],
    outputFile: { json: '.artifacts/unit-results.json' },
  },
});
