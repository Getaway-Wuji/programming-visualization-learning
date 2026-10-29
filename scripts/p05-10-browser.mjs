// Final Chrome-only integration checks against the existing registered build.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';

const label = process.argv[2] ?? 'final';
assert.match(label, /^[A-Za-z0-9_.-]+$/);
const startAt = process.argv[3] ?? 'appearance';
const reuseLabel = process.argv[4];
if (reuseLabel !== undefined) assert.match(reuseLabel, /^[A-Za-z0-9_.-]+$/);
const folder = '.artifacts/P0.5-10';
mkdirSync(folder, { recursive: true });
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const registrationPath = 'content/c/p0/blockly-release-1.0.16.json';
const registration = JSON.parse(readFileSync(registrationPath, 'utf8'));
assert.equal(registration.releaseVersion, '1.0.16');
for (const file of registration.files) assert.equal(sha(file.path), file.sha256);
const frozen = [registrationPath, '.artifacts/artifact-hashes.json'].map((path) => ({
  path,
  sha256: sha(path),
}));
const jobs = [
  ['appearance', 'appearance.spec.ts', 'six complete themes save and refresh', 1],
  ['arrays', 'array-layout.spec.ts', null, 4],
  [
    'invalid-draft',
    'editor-presentation.spec.ts',
    'invalid and unmapped code survives hide-show',
    1,
  ],
  ['cancel', 'practice-experience.spec.ts', 'cancelling one held genuine run', 1],
  ['workbench', 'workbench-layout.spec.ts', 'all six themes use the available workbench width', 1],
  ['closure', 'p05-closure.spec.ts', null, 2],
];
const startIndex = jobs.findIndex(([name]) => name === startAt);
assert.ok(startIndex >= 0, 'Unknown startAt job.');
assert.ok(
  startIndex === 0 || reuseLabel,
  'Resuming requires the label of earlier passing reports.',
);
const cases = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(suite.suites ?? []),
  ]);
function checkReport(path, expected) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.expected, expected);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
  assert.deepEqual(
    report.config.filteredProjects.map((project) => project.name),
    ['chrome'],
  );
  assert.equal(report.config.workers, 1);
  const rows = cases(report.suites);
  assert.equal(rows.length, expected);
  for (const { spec, test } of rows) {
    assert.equal(spec.ok, true);
    assert.equal(test.projectName, 'chrome');
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].status, 'passed');
    assert.equal(test.results[0].retry, 0);
  }
  return report;
}
const reports = [];
for (const [index, [name, spec, grep, expected]] of jobs.entries()) {
  if (index < startIndex) {
    const run = `${reuseLabel}-${name}`;
    const path = `${folder}/${run}.json`;
    checkReport(path, expected);
    const metadataPath = `${folder}/${run}-run.json`;
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    assert.equal(metadata.exitCode, 0);
    assert.deepEqual(metadata.browserScope, ['chrome']);
    assert.equal(metadata.testSource.path, `tests/browser/${spec}`);
    assert.equal(metadata.testSource.sha256, sha(metadata.testSource.path));
    reports.push({
      name,
      path,
      sha256: sha(path),
      scenarios: expected,
      metadata: metadataPath,
      reusedFromEarlierPassingRun: true,
    });
    console.log(`${run}: reused verified passing report`);
    continue;
  }
  const run = `${label}-${name}`;
  const path = `${folder}/${run}.json`;
  assert.equal(existsSync(path), false, 'Use a fresh label; earlier attempts are retained.');
  const argv = [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'tests/playwright.config.ts',
    '--project',
    'chrome',
    '--workers',
    '1',
    '--trace',
    'off',
    '--reporter=list,json',
    '--output',
    resolve(folder, `${run}-output`),
    spec,
    ...(grep ? ['--grep', grep] : []),
  ];
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
    PLAYWRIGHT_BROWSERS_PATH: resolve('.tools/playwright'),
    PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(path),
    TASK_EVIDENCE_TASK: 'P0.5-10',
    TASK_EVIDENCE_LABEL: run,
    P07_CAPTURE_RUN: run,
  };
  delete env.P05_HIDE_COURSE_BUNDLE;
  delete env.P05_REVIEW_CANDIDATE;
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, argv, {
    cwd: resolve('.'),
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(`${folder}/${run}.log`, `${result.stdout ?? ''}${result.stderr ?? ''}`, {
    flag: 'wx',
  });
  const metadata = {
    task: 'P0.5-10',
    label: run,
    browserScope: ['chrome'],
    isolatedContext: true,
    baseURL: 'http://127.0.0.1:4178',
    traceMode: 'off',
    argv,
    testSource: { path: `tests/browser/${spec}`, sha256: sha(`tests/browser/${spec}`) },
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
  };
  writeFileSync(`${folder}/${run}-run.json`, JSON.stringify(metadata, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(`${run}: ${result.status}`);
  assert.equal(result.status, 0, `Original failed evidence retained at ${path}.`);
  checkReport(path, expected);
  reports.push({
    name,
    path,
    sha256: sha(path),
    scenarios: expected,
    metadata: `${folder}/${run}-run.json`,
  });
  for (const file of frozen) assert.equal(sha(file.path), file.sha256);
  for (const file of registration.files) assert.equal(sha(file.path), file.sha256);
}
const output = `${folder}/browser-${label}.json`;
const pointerPath = '.artifacts/P0.5-09/receiver-gate-interaction.json';
assert.equal(registration.evidence['receiver-gate-interaction'].path, pointerPath);
assert.equal(registration.evidence['receiver-gate-interaction'].sha256, sha(pointerPath));
checkReport(pointerPath, 5);
writeFileSync(
  output,
  JSON.stringify(
    {
      task: 'P0.5-10',
      status: 'passed',
      browserScope: ['chrome'],
      label,
      registeredBuild: frozen,
      scenarios: reports.reduce((sum, report) => sum + report.scenarios, 0),
      reports,
      reusedPointerEvidence: {
        path: pointerPath,
        sha256: sha(pointerPath),
        scope:
          'Five genuine Chrome pointer/keyboard scenarios on the same registered source and Rust engine using the explicitly unavailable new-course bundle fallback. Current course empty-block submission is separately checked in closure.',
      },
      retainedFailedPrecondition: '.artifacts/P0.5-10/final-pointer.json',
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  `P0.5-10: 10 current registered-build Chrome scenarios passed across explicitly recorded runs; ${output}`,
);
