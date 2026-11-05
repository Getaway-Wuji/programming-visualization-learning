import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './browser',
  testMatch: [
    'ui-feedback-20261104.spec.ts',
    'ui-feedback.spec.ts',
    'bugs.spec.ts',
    'memory-bugs.spec.ts',
  ],
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: fileURLToPath(
          new URL(
            `../.artifacts/ui-feedback/browser-results-${process.env.UI_FEEDBACK_RUN ?? 'round2'}.json`,
            import.meta.url,
          ),
        ),
      },
    ],
  ],
  outputDir: fileURLToPath(
    new URL(
      `../.artifacts/ui-feedback/browser-output-${process.env.UI_FEEDBACK_RUN ?? 'round2'}`,
      import.meta.url,
    ),
  ),
  use: {
    baseURL: 'http://127.0.0.1:4197',
    viewport: { width: 1440, height: 900 },
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-checks.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    port: 4197,
    reuseExistingServer: false,
    env: { CHECK_PORT: '4197' },
    timeout: 30_000,
  },
});
