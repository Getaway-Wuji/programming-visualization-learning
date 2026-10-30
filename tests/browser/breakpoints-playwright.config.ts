import { defineConfig } from '@playwright/test';
import base from '../playwright.config';
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'breakpoints.spec.ts',
  testIgnore: [],
  reporter: [['list'], ['json']],
  projects: base.projects?.filter((project) => project.name === 'chrome'),
});
