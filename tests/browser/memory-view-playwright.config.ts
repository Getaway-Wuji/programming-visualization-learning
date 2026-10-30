import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'memory-view.spec.ts',
  testIgnore: [],
  reporter: [['list'], ['json']],
  outputDir: '.artifacts/12.3/browser-output',
  projects: base.projects?.filter((project) => project.name === 'chrome'),
});
