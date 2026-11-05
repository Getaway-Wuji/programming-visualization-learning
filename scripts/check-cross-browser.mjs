import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { workspaceDir } from './process.mjs';
import { verifyBuildInputs } from './build-inputs.mjs';

// Every stage is unfiltered, single-worker, without retries. Labels preserve
// failures and prevent migration switch markers from leaking between browsers.
const stages = ['main', 'engines', 'migrations', 'stock', 'performance'];
const suite = process.argv.find((arg) => arg.startsWith('--suite='))?.slice(8) ?? 'all';
assert.ok(suite === 'all' || stages.includes(suite), 'Unknown cross-browser suite.');
const label = `cross-${new Date().toISOString().replace(/[^0-9]/g, '')}-${process.pid}`;
const directory = join(workspaceDir, '.artifacts', 'cross-browser', label);
mkdirSync(directory, { recursive: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function inputs() {
  const paths = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(
      (path) =>
        /^(?:web\/|tests\/|scripts\/|content\/|engine\/|server\/|shared\/|package|tsconfig|vite\.|README)/.test(
          path,
        ) && existsSync(join(workspaceDir, path)),
    );
  return [...new Set(paths)]
    .sort()
    .map((path) => ({ path, sha256: sha(readFileSync(join(workspaceDir, path))) }));
}
verifyBuildInputs();
const sources = inputs();
writeFileSync(join(directory, 'source-inputs.json'), JSON.stringify(sources, null, 2) + '\n', {
  flag: 'wx',
});
const results = [];
const browsers = ['chrome', 'edge', 'firefox-automation'];
const baseEnv = {
  ...process.env,
  PATH: dirname(process.execPath) + delimiter + process.env.PATH,
  PLAYWRIGHT_BROWSERS_PATH: join(workspaceDir, '.tools', 'playwright'),
  TASK_EVIDENCE_TASK: label,
};
delete baseEnv.PLAYWRIGHT_JSON_OUTPUT_FILE;
delete baseEnv.PLAYWRIGHT_JSON_OUTPUT_NAME;
delete baseEnv.PHASE2_PERF_PILOT;
function run(id, args, report, extraEnv = {}, custom = false) {
  console.log(`Browser regression ${id}; evidence ${directory}`);
  const child = spawnSync(process.execPath, args, {
    cwd: workspaceDir,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: { ...baseEnv, TASK_EVIDENCE_LABEL: `${label}-${id}`, ...extraEnv },
  });
  const value = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  const stats = value?.stats;
  const unchanged = JSON.stringify(inputs()) === JSON.stringify(sources);
  const passed =
    child.status === 0 &&
    (custom
      ? value?.passed === true
      : stats?.expected > 0 && stats.unexpected === 0 && stats.skipped === 0 && stats.flaky === 0);
  const entry = {
    id,
    exitCode: child.status,
    error: child.error?.message,
    report,
    stats,
    ...(custom ? { checks: value?.results?.length } : {}),
    unchanged,
    passed,
  };
  results.push(entry);
  writeFileSync(
    join(directory, 'summary.json'),
    JSON.stringify({ label, suite, results }, null, 2) + '\n',
  );
  assert.ok(unchanged, 'Source files changed during browser regression.');
  return entry;
}
function playwright(id, config, project, extraEnv = {}) {
  const report = join(directory, `${id}.json`);
  return run(
    id,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      `--config=${config}`,
      ...(project ? [`--project=${project}`] : []),
      '--reporter=list,json',
      `--output=${join(directory, `${id}-output`)}`,
    ],
    report,
    { ...extraEnv, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
  );
}
const selected = (stage) => suite === 'all' || suite === stage;
if (selected('main')) {
  const matrix = browsers.map((browser) =>
    playwright(`main-${browser}`, 'tests/playwright.config.ts', browser),
  );
  assert.equal(
    new Set(matrix.map((entry) => entry.stats?.expected + entry.stats?.unexpected)).size,
    1,
    'Main browser projects collected different test counts.',
  );
}
if (selected('engines')) {
  const independent = [
    [
      'c6-engine',
      'scripts/c6-course/browser-engine.mjs',
      (name) => `.artifacts/21.4/c6-engine-browser-${name}.json`,
    ],
    [
      'c6-content',
      'scripts/c6-course/browser.mjs',
      (name) => `.artifacts/21.4/c6-content-browser-${name}.json`,
    ],
    [
      'c6-teaching',
      'scripts/c6-course/browser-teaching.mjs',
      (name) => `.artifacts/21.4-full-teaching/browser-${name}/results.json`,
    ],
    [
      'c6-learning',
      'scripts/c6-course/browser-learning.mjs',
      (name) => `.artifacts/21.5/browser-${name}/results.json`,
    ],
    [
      'advanced',
      'scripts/advanced-browser.mjs',
      (name) => `.artifacts/17.2/advanced-browser-${name}.json`,
    ],
    [
      'memory',
      'scripts/memory-browser.mjs',
      (name) => `.artifacts/12.2/memory-browser-${name}.json`,
    ],
    [
      'algorithm',
      'scripts/algorithm-browser.mjs',
      (name) => `.artifacts/12.1/algorithm-browser-${name}.json`,
    ],
  ];
  for (const [id, script, path] of independent) {
    const name = `${label}-${id}`;
    run(id, [script, name], join(workspaceDir, path(name)), { CROSS_BROWSER_PROJECTS: 'all' });
  }
}
if (selected('migrations'))
  for (const kind of ['notebook', 'scheduler', 'achievement', 'challenge'])
    for (const browser of browsers)
      playwright(`migration-${kind}-${browser}`, `tests/${kind}-migration.config.ts`, browser, {
        CROSS_BROWSER_PROJECTS: 'all',
      });
if (selected('stock'))
  run(
    'stock',
    ['scripts/firefox-current.mjs'],
    join(
      workspaceDir,
      '.artifacts',
      'cross-browser',
      `${label}-stock`,
      'stock-firefox',
      'report.json',
    ),
    {},
    true,
  );
if (selected('performance')) playwright('performance', 'tests/phase3-performance.config.ts');
assert.ok(
  results.length > 0 && results.every((result) => result.passed),
  'Browser regression failed; all completed results and failures are retained.',
);
console.log(`Browser regression passed (${results.length} stages). Evidence: ${directory}`);
