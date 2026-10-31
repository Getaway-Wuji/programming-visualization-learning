import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
const [label, ...selection] = process.argv.slice(2);
assert.match(label ?? '', /^r1610-[A-Za-z0-9_.-]+$/);
const output = resolve('.artifacts/16.10'),
  workspace = resolve('.artifacts/16.10/clean-workspace');
assert.ok(existsSync(resolve(workspace, 'web/dist/index.html')), 'Build the clean source first.');
const report = resolve(output, label + '.json');
assert.equal(existsSync(report), false);
mkdirSync(output, { recursive: true });
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
    '--output',
    resolve(output, label + '-output'),
    ...selection,
  ],
  {
    cwd: workspace,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? ''),
      PLAYWRIGHT_BROWSERS_PATH: resolve('.tools/playwright'),
      PLAYWRIGHT_JSON_OUTPUT_NAME: report,
      TASK_EVIDENCE_TASK: '16.10',
      TASK_EVIDENCE_LABEL: label,
      TASK_REPRESENTATIVE_THEME: 'minimal',
    },
  },
);
writeFileSync(resolve(output, label + '.log'), (result.stdout ?? '') + (result.stderr ?? ''), {
  flag: 'wx',
});
writeFileSync(resolve(output, label + '.exit'), String(result.status ?? 1) + '\n', { flag: 'wx' });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
