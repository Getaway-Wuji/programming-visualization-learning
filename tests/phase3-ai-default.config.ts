import ai from './ai-debug.config';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// All API POSTs in these engineering cases are intercepted with a design-only
// sentinel. The local proxy is exercised without official provider requests.
export default defineConfig(ai, {
  testDir: '.',
  testMatch: ['quality-19.5/current-scope.spec.ts', 'ai-browser/ai-debug.spec.ts'],
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: fileURLToPath(
          new URL(`../.artifacts/20.4/${process.env.TASK_EVIDENCE_LABEL}.json`, import.meta.url),
        ),
      },
    ],
  ],
  outputDir: fileURLToPath(
    new URL(`../.artifacts/20.4/${process.env.TASK_EVIDENCE_LABEL}-output`, import.meta.url),
  ),
});
