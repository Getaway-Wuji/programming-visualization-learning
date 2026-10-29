import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';

const [label = `course-${Date.now()}`, ...selection] = process.argv.slice(2);
assert.match(label, /^[A-Za-z0-9_.-]+$/);
const folder = resolve('.artifacts/P0.5-09');
const reportPath = resolve(folder, `${label}.json`);
assert.equal(
  existsSync(reportPath),
  false,
  'Use a fresh label; previous browser evidence is immutable.',
);
assert.equal(
  existsSync(resolve(folder, 'browser', label)),
  false,
  'This evidence label has already been used.',
);
mkdirSync(folder, { recursive: true });
const environment = {
  ...process.env,
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
  PLAYWRIGHT_BROWSERS_PATH: resolve('.tools/playwright'),
  PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
  TASK_EVIDENCE_TASK: 'P0.5-09',
  TASK_EVIDENCE_LABEL: label,
};
delete environment.P05_HIDE_COURSE_BUNDLE;
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'tests/playwright.config.ts',
    '--reporter=list,json',
    '--output',
    resolve(folder, `${label}-output`),
    'p05-course.spec.ts',
    ...selection,
  ],
  {
    cwd: resolve('.'),
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  },
);
writeFileSync(resolve(folder, `${label}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`, {
  flag: 'wx',
});
writeFileSync(
  resolve(folder, `${label}-exit.json`),
  JSON.stringify({
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
  }) + '\n',
  { flag: 'wx' },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
assert.equal(result.status, 0, `Browser suite failed; original report retained at ${reportPath}`);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.deepEqual(report.errors, []);
assert.equal(report.stats.unexpected, 0);
assert.equal(report.stats.flaky, 0);
assert.equal(report.stats.skipped, 0);
console.log(
  JSON.stringify({ task: 'P0.5-09', label, scenarios: report.stats.expected, reportPath }),
);
