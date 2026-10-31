import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.spec.ts',
  // Independent interpreter/migration harnesses use their own runners on 4181 / 4182 / 4188.
  testIgnore: [
    '**/phase2-performance.spec.ts',
    '**/advanced-engine.spec.ts',
    '**/algorithm-engine.spec.ts',
    '**/memory-engine.spec.ts',
    '**/notebook-migration.spec.ts',
    '**/scheduler-migration.spec.ts',
    '**/achievement-migration.spec.ts',
    '**/challenge-migration.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: fileURLToPath(new URL('../.artifacts/browser-results.json', import.meta.url)) },
    ],
  ],
  outputDir: fileURLToPath(new URL('../.artifacts/browser-test-output', import.meta.url)),
  use: {
    baseURL: 'http://127.0.0.1:4178',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'edge',
      use: {
        channel: 'msedge',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'firefox-automation',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'node scripts/serve-checks.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    port: 4178,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
