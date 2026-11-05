import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './browser',
  testMatch: 'oj-feedback.spec.ts',
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
            `../.artifacts/oj-feedback/browser-${process.env.OJ_RUN ?? 'round1'}.json`,
            import.meta.url,
          ),
        ),
      },
    ],
  ],
  outputDir: fileURLToPath(
    new URL(
      `../.artifacts/oj-feedback/browser-output-${process.env.OJ_RUN ?? 'round1'}`,
      import.meta.url,
    ),
  ),
  use: {
    baseURL: 'http://127.0.0.1:4198',
    viewport: { width: 1440, height: 900 },
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-checks.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    port: 4198,
    reuseExistingServer: false,
    env: { CHECK_PORT: '4198' },
    timeout: 30_000,
  },
});
