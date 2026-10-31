import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser',
  testMatch: 'challenge-migration.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 90000,
  reporter: 'list',
  use: {
    timezoneId: 'Asia/Shanghai',
    baseURL: 'http://127.0.0.1:4192',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node scripts/serve-challenge-migration.mjs',
    cwd: '..',
    port: 4192,
    reuseExistingServer: false,
  },
});
