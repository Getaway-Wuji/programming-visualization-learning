import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './browser',
  testMatch: [
    'learning-workflow.spec.ts',
    'language-workflow.spec.ts',
    'six-language-editor.spec.ts',
    'course-navigation.spec.ts',
    'local-backup.spec.ts',
    'local-backup-ui.spec.ts',
  ],
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list'], ['json', { outputFile: '.artifacts/workflow/browser-results.json' }]],
  outputDir: '.artifacts/workflow/browser-output',
  use: {
    baseURL: 'http://127.0.0.1:4198',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'Asia/Shanghai',
    browserName: 'chromium',
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-checks.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    port: 4198,
    reuseExistingServer: false,
    env: {
      CHECK_PORT: '4198',
      ...(process.env.WORKFLOW_DIST ? { CHECK_DIST: process.env.WORKFLOW_DIST } : {}),
    },
    timeout: 30_000,
  },
});
