import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'memory-engine.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list'], ['json']],
  use: { baseURL: 'http://127.0.0.1:4182', trace: 'off', screenshot: 'off' },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
});
