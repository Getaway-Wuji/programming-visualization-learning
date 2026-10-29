import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, delimiter, resolve } from 'node:path';
const folder = '.artifacts/P0.5-09';
mkdirSync(folder, { recursive: true });
for (const [name, selection] of [
  ['receiver-gate-blocks', ['blocks.spec.ts', 'practice.spec.ts']],
  ['receiver-gate-navigation', ['navigation.spec.ts', '--grep', 'workspaces keep real blocks']],
  ['receiver-gate-interaction', ['block-interaction.spec.ts']],
  ['receiver-gate-experience', ['practice-experience.spec.ts']],
  ['receiver-bidirectional-final', ['bidirectional.spec.ts']],
  ['receiver-presentation-final', ['editor-presentation.spec.ts']],
]) {
  const report = resolve(folder, `${name}.json`);
  assert.equal(
    existsSync(report),
    false,
    'Preserve prior attempts under separate labels before rerunning.',
  );
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'tests/playwright.config.ts',
      '--project',
      'chrome',
      '--trace',
      'off',
      '--reporter=list,json',
      '--output',
      resolve(folder, `${name}-output`),
      ...selection,
    ],
    {
      cwd: resolve('.'),
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
        PLAYWRIGHT_BROWSERS_PATH: resolve('.tools/playwright'),
        PLAYWRIGHT_JSON_OUTPUT_NAME: report,
        TASK_EVIDENCE_TASK: 'P0.5-09',
        TASK_EVIDENCE_LABEL: name,
        P05_HIDE_COURSE_BUNDLE: '1',
      },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  writeFileSync(resolve(folder, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`, {
    flag: 'wx',
  });
  writeFileSync(
    resolve(folder, `${name}-exit.json`),
    JSON.stringify({ exitCode: result.status, signal: result.signal }) + '\n',
    { flag: 'wx' },
  );
  console.log(`${name}: ${result.status}`);
  assert.equal(result.status, 0);
}
