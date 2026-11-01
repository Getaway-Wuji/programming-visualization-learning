import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import ai from './ai-debug.config';
export default defineConfig(ai, {
  testDir: '.',
  testMatch: [
    'browser/custom-code.spec.ts',
    'browser/workbench-layout.spec.ts',
    'ai-regression/*.spec.ts',
  ],
  grepInvert: /selected themes use the available workbench width/,
  use: { baseURL: 'http://127.0.0.1:4178' },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node scripts/serve-checks.mjs',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
