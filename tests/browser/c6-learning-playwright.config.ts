import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'c6-reset.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['json']],
  use: { baseURL: 'http://127.0.0.1:4198', trace: 'off', screenshot: 'off' },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
});
