// Current-release regression with independent, immutable run paths.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
const [label, project, ...selection] = process.argv.slice(2);
assert.match(label ?? '', /^r204-[a-z0-9-]+$/);
assert.ok(['chrome', 'edge', 'firefox-automation', 'performance', 'ai-default'].includes(project));
const folder = resolve('.artifacts/20.4');
mkdirSync(folder, { recursive: true });
const report = resolve(folder, `${label}.json`);
assert.equal(existsSync(report), false, 'Use a new evidence label');
const registration = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.68.json', 'utf8'));
for (const file of registration.files)
  assert.equal(
    createHash('sha256').update(readFileSync(file.path)).digest('hex'),
    file.sha256,
    file.path,
  );
const config =
  project === 'performance'
    ? 'tests/phase3-performance.config.ts'
    : project === 'ai-default'
      ? 'tests/phase3-ai-default.config.ts'
      : 'tests/playwright.config.ts';
const args = [
  'node_modules/@playwright/test/cli.js',
  'test',
  '--config',
  config,
  ...(project === 'performance' || project === 'ai-default' ? [] : ['--project', project]),
  '--reporter=list,json',
  '--trace',
  'retain-on-failure',
  '--output',
  resolve(folder, `${label}-output`),
  ...selection,
];
const result = spawnSync(process.execPath, args, {
  cwd: resolve('.'),
  windowsHide: true,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  env: {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
    PLAYWRIGHT_BROWSERS_PATH: resolve('.tools/playwright'),
    PLAYWRIGHT_JSON_OUTPUT_NAME: report,
    TASK_EVIDENCE_TASK: '20.4',
    TASK_EVIDENCE_LABEL: label,
    TASK_REPRESENTATIVE_THEME: 'minimal',
  },
});
for (const [suffix, value] of [
  ['log', `${result.stdout ?? ''}${result.stderr ?? ''}`],
  ['exit', `${result.status ?? 1}\n`],
  [
    'sources.json',
    JSON.stringify(
      {
        task: '20.4',
        label,
        project,
        args,
        registration: '1.0.68',
        registeredSources: registration.files.length,
        testSources: selection
          .filter((path) => path.endsWith('.spec.ts'))
          .map((path) => ({
            path: `tests/browser/${path}`,
            sha256: createHash('sha256')
              .update(readFileSync(`tests/browser/${path}`))
              .digest('hex'),
          })),
      },
      null,
      2,
    ) + '\n',
  ],
])
  writeFileSync(resolve(folder, `${label}.${suffix}`), value, { flag: 'wx' });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
