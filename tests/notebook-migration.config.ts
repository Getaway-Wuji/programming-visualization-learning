import { browserProjects } from '../scripts/browser-projects.mjs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser',
  testMatch: 'notebook-migration.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: 'list',
  projects: browserProjects,
  use: {
    baseURL: 'http://127.0.0.1:4188',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node scripts/serve-notebook-migration.mjs',
    cwd: '..',
    port: 4188,
    reuseExistingServer: false,
  },
});
