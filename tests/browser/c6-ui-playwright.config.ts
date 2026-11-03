import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'c6-ui.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['json']],
  use: {
    baseURL: process.env.C6_UI_URL ?? 'http://127.0.0.1:4199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
});
