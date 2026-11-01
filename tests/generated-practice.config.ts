import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from './playwright.config';
export default defineConfig({
  ...base,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: resolve(
          `.artifacts/19.2/browser-${process.env.TASK_EVIDENCE_LABEL ?? 'local'}.json`,
        ),
      },
    ],
  ],
  outputDir: resolve(`.artifacts/19.2/playwright-${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`),
  projects: base.projects?.filter((p) => p.name === 'chrome'),
});
