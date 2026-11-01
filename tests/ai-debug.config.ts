import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const run = process.env.AI_QA_RUN ?? 'candidate-r1';
const artifact = fileURLToPath(new URL('../.artifacts/19.4/', import.meta.url));
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid nonsecret QA run label');
export default defineConfig({
  testDir: './ai-browser',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list'], ['json', { outputFile: `${artifact}/browser-${run}.json` }]],
  outputDir: `${artifact}/browser-${run}-output`,
  use: {
    baseURL: 'http://127.0.0.1:4194',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node scripts/serve-ai.mjs --port 4194',
    url: 'http://127.0.0.1:4194',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
