import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'c6-teaching.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list'], ['json']],
  use: { baseURL: 'http://127.0.0.1:4197', trace: 'off', screenshot: 'off' },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
});
