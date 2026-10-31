import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
const [label, ...selection] = process.argv.slice(2);
assert.match(label ?? '', /^[A-Za-z0-9_.-]+$/);
const folder = resolve('.artifacts/16.4');
mkdirSync(folder, { recursive: true });
const report = resolve(folder, `${label}.json`);
assert.equal(existsSync(report), false, 'Preserve earlier reports; use a new label.');
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'tests/playwright.config.ts',
    '--project',
    'chrome',
    '--reporter=list,json',
    '--trace',
    'retain-on-failure',
    '--output',
    resolve(folder, `${label}-output`),
    ...selection,
  ],
  {
    cwd: resolve('.'),
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
      PLAYWRIGHT_JSON_OUTPUT_NAME: report,
      TASK_EVIDENCE_TASK: '16.4',
      TASK_REPRESENTATIVE_THEME: 'minimal',
      TASK_EVIDENCE_LABEL: label,
    },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  },
);
writeFileSync(resolve(folder, `${label}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`, {
  flag: 'wx',
});
writeFileSync(resolve(folder, `${label}.exit`), String(result.status ?? 1) + '\n', { flag: 'wx' });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
