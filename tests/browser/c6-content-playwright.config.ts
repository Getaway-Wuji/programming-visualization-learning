import { browserProjects } from '../../scripts/browser-projects.mjs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'c6-content.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list'], ['json']],
  use: { baseURL: 'http://127.0.0.1:4194', trace: 'off', screenshot: 'off' },
  projects: browserProjects,
});
