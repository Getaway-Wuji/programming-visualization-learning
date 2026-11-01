import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import ai from './ai-debug.config';
const root = fileURLToPath(new URL('../.artifacts/19.5/', import.meta.url));
const run = process.env.QUALITY_19_5_RUN ?? 'r1';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid public QA label');
export default defineConfig(ai, {
  testDir: './quality-19.5',
  reporter: [['list'], ['json', { outputFile: `${root}/browser-${run}.json` }]],
  outputDir: `${root}/browser-${run}-output`,
});
