import { browserProjects } from '../scripts/browser-projects.mjs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser',
  testMatch: 'scheduler-migration.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: 'list',
  projects: browserProjects,
  use: {
    timezoneId: 'Asia/Shanghai',
    baseURL: 'http://127.0.0.1:4189',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node scripts/serve-scheduler-migration.mjs',
    cwd: '..',
    port: 4189,
    reuseExistingServer: false,
  },
});
