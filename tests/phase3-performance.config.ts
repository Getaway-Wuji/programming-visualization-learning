import base from './phase2-performance.config';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Reuse the qualified HTTPS/shared-network/physical-display method at the
// current immutable release; reports and traces belong to 20.4.
export default defineConfig({
  ...base,
  testMatch: ['phase2-performance.spec.ts', 'phase3-performance.spec.ts'],
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
