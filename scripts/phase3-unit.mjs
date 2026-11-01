import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
const label = process.argv[2];
assert.match(label ?? '', /^r204-[a-z0-9-]+$/);
const folder = resolve('.artifacts/20.4');
mkdirSync(folder, { recursive: true });
const report = resolve(folder, `${label}.json`);
assert.equal(existsSync(report), false, 'Use a new test label');
const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--config',
    'tests/vitest.config.ts',
    '--maxWorkers=1',
    '--reporter=json',
    `--outputFile=${report}`,
  ],
  {
    cwd: resolve('.'),
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
      TASK_EVIDENCE_TASK: '20.4',
      TASK_EVIDENCE_LABEL: label,
      TASK_EXECUTION_PERF_PHASE: label,
      COURSE_EXECUTION_REPORT: `.artifacts/20.4/course-execution-${label}.json`,
    },
  },
);
writeFileSync(`${folder}/${label}.log`, `${result.stdout ?? ''}${result.stderr ?? ''}`, {
  flag: 'wx',
});
writeFileSync(`${folder}/${label}.exit`, `${result.status ?? 1}\n`, { flag: 'wx' });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
