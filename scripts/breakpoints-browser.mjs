import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { checkEnvironment } from './environment.mjs';
const environment = checkEnvironment();
const label = process.argv[2];
assert.match(label ?? '', /^[a-zA-Z0-9_.-]+$/);
const report = `.artifacts/12.5/browser-${label}.json`;
assert.equal(existsSync(report), false, 'Retain earlier evidence; use another label.');
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sources = [
  'web/src/App.tsx',
  'web/src/components/Layout.tsx',
  'web/src/pages/CatalogPages.tsx',
  'web/src/pages/MemoryPage.tsx',
  ...['controller.ts', 'examples.ts', 'presentation.ts', 'MemoryPanel.tsx', 'memory.css'].map(
    (name) => `web/src/memory/${name}`,
  ),
  'tests/browser/breakpoints.spec.ts',
  'tests/browser/breakpoints-playwright.config.ts',
  'web/src/generated/memory/c_viz_memory_bg.wasm',
  'web/src/generated/memory/engine-build.ts',
];
sources.push(
  ...['examples.ts', 'presentation.ts', 'StackPanel.tsx', 'stack.css'].map(
    (name) => `web/src/stack/${name}`,
  ),
);
sources.push(
  'web/src/debug/breakpoints.ts',
  'web/src/debug/DebugSource.tsx',
  'web/src/debug/debug.css',
);
const files = sources.map((path) => ({ path, sha256: sha(path) }));
const startedAt = new Date().toISOString();
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'tests/browser/breakpoints-playwright.config.ts',
    '--output',
    resolve(`.artifacts/12.5/browser-output-${label}`),
  ],
  {
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
      PLAYWRIGHT_BROWSERS_PATH: resolve('.tools/playwright'),
      PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(report),
      BREAKPOINT_LABEL: label,
    },
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  },
);
writeFileSync(
  `.artifacts/12.5/browser-${label}.log`,
  (result.stdout ?? '') + (result.stderr ?? ''),
  { flag: 'wx' },
);
writeFileSync(
  `.artifacts/12.5/browser-${label}-run.json`,
  JSON.stringify(
    {
      environment,
      files,
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.status,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(result.stdout);
if (result.stderr) console.error(result.stderr);
assert.equal(result.status, 0, 'Original failure report retained.');
const parsed = JSON.parse(readFileSync(report, 'utf8'));
for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(parsed.stats[key], 0);
for (const file of files) assert.equal(sha(file.path), file.sha256);
