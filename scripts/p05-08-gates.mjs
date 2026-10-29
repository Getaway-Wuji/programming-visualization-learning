import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';

const root = resolve('.');
const folder = resolve('.artifacts/P0.5-08');
mkdirSync(folder, { recursive: true });
const gates =
  process.argv[2] === 'post-repair'
    ? [
        [
          'post-repair',
          ['practice-learning.spec.ts', 'workbench-layout.spec.ts', 'p0-delivery.spec.ts'],
        ],
        [
          'learner-regression',
          [
            'daily-goals.spec.ts',
            'profile.spec.ts',
            'rewards.spec.ts',
            '--grep',
            'recommended preview is durable|a real complete three-group Rust pass|a real exercise first pass awards ten',
          ],
        ],
      ]
    : process.argv[2] === 'post-publish'
      ? [
          [
            'post-publish',
            [
              'editor-presentation.spec.ts',
              'bidirectional.spec.ts',
              'workbench-layout.spec.ts',
              'silent-workspace.spec.ts',
              'practice-learning.spec.ts',
              'p0-delivery.spec.ts',
            ],
          ],
          [
            'learner-regression',
            [
              'daily-goals.spec.ts',
              'profile.spec.ts',
              'rewards.spec.ts',
              '--grep',
              'recommended preview is durable|a real complete three-group Rust pass|a real exercise first pass awards ten',
            ],
          ],
        ]
      : [
          ['gate-blocks', ['blocks.spec.ts', 'practice.spec.ts']],
          ['gate-navigation', ['navigation.spec.ts', '--grep', 'workspaces keep real blocks']],
          ['gate-interaction', ['block-interaction.spec.ts']],
          ['gate-experience', ['practice-experience.spec.ts']],
          ['bidirectional-final', ['bidirectional.spec.ts']],
        ];
for (const [name, selection] of gates) {
  const reportPath = resolve(folder, `${name}.json`);
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'tests/playwright.config.ts',
      '--reporter=list,json',
      '--output',
      resolve(folder, `${name}-output`),
      ...selection,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
        PLAYWRIGHT_BROWSERS_PATH: resolve('.tools/playwright'),
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        TASK_EVIDENCE_LABEL: name,
        TASK_EVIDENCE_TASK: 'P0.5-08',
      },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  writeFileSync(resolve(folder, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  writeFileSync(
    resolve(folder, `${name}-exit.json`),
    JSON.stringify({
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message,
    }),
  );
  assert.equal(result.status, 0, `${name} failed; inspect its retained log and JSON.`);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.deepEqual(report.errors, []);
  for (const counter of ['unexpected', 'skipped', 'flaky']) assert.equal(report.stats[counter], 0);
  console.log(`${name}: ${report.stats.expected} passed, no skips or retries.`);
}
