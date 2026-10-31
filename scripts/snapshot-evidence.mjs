// Preserve actual download files, failures and final gates; audit only this task's ownership.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
const dir = '.artifacts/16.3';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString()
      .replace(/^\uFEFF/, ''),
  );
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, bytes: read(path).length, sha256: sha(read(path)) });
const save = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const walk = (path) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`],
      )
    : [];
const registrationPath = 'content/c/p0/blockly-release-1.0.38.json',
  registration = json(registrationPath);
assert.equal(registration.files.length, 220);
for (const item of [...registration.files, ...Object.values(registration.evidence)])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const units = json(`${dir}/units-close.json`);
assert.equal(units.numTotalTests, 200);
assert.equal(units.numPassedTests, 200);
const cases = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).map((spec) => ({ spec, test: spec.tests[0] })),
    ...cases(suite.suites ?? []),
  ]);
const browser = new Map();
for (const [name, expected] of [
  ['formal-download-38-final', 37],
  ['regression-38', 36],
]) {
  const data = json(`${dir}/${name}.json`);
  assert.deepEqual(data.errors, []);
  assert.equal(data.stats.expected, expected);
  assert.equal(data.stats.unexpected + data.stats.skipped + data.stats.flaky, 0);
  for (const { spec, test } of cases(data.suites)) {
    assert.equal(spec.ok, true, spec.title);
    assert.equal(test.projectName, 'chrome');
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].status, 'passed');
    assert.equal(test.results[0].retry, 0);
    browser.set(`${basename(spec.file)}:${spec.title}`, { report: name, title: spec.title });
  }
}
assert.equal(browser.size, 73);
const downloads = json(`${dir}/download-summary-formal-download-38-final.json`);
assert.equal(downloads.files, 99);
assert.equal(downloads.json, 70);
assert.equal(downloads.png, 29);
for (const row of downloads.rows) assert.equal(sha(read(row.path)), row.sha256);
const originalFail =
  'the real 32-frame prefix exports intact JSON and refuses an oversized complete picture';
const failureReview = [];
for (const name of ['candidate-download-first', 'candidate-download-second', 'formal-download-38'])
  for (const { spec, test } of cases(json(`${dir}/${name}.json`).suites))
    if (test.results.some((result) => ['failed', 'timedOut'].includes(result.status))) {
      const key = `${basename(spec.file)}:${spec.title}`;
      if (spec.title === originalFail) {
        assert.ok([...browser.keys()].some((key) => key.includes('32-frame error prefix')));
        assert.ok([...browser.keys()].some((key) => key.includes('600-slot')));
        failureReview.push({
          report: name,
          title: spec.title,
          reason:
            'The real32-frame image is within budget. Corrected the incorrect test premise; full32-frame JSON/PNG and a separate actual600-slot oversize rejection both pass.',
        });
      } else {
        assert.ok(browser.has(key), key);
        failureReview.push({
          report: name,
          title: spec.title,
          recheckedIn: browser.get(key).report,
        });
      }
    }
for (const name of [
  'typecheck-close',
  'lint-close',
  'format-close',
  'ui-lint-close',
  'build-formal38',
  'startup-final',
  'visual-accepted',
  'links-final',
  'lint-delivery',
  'typecheck-delivery',
  'format-delivery',
])
  assert.equal(Number(read(`${dir}/${name}.exit`).toString().trim()), 0, name);
const visual = json(`${dir}/visual.json`);
assert.equal(visual.findings.filter((item) => item.level === 'FAIL').length, 0);
const inherited = json(`${dir}/inherited-engines.json`);
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
for (const [task, count] of [
  ['16.1', 310],
  ['16.2', 713],
]) {
  const old = `项目文档/验收/${task}-验证原件`,
    index = json(`${old}/index.json`);
  assert.equal(index.entries.length, count);
  for (const item of index.entries)
    assert.equal(sha(read(`${old}/${item.file}`)), item.sha256, item.file);
}
const baseline = json(`${dir}/baseline.json`);
for (const item of [...baseline.prior, ...baseline.external])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const allowed = new Set([
  'README.md',
  '项目守则.md',
  ...['需求覆盖与范围裁决', '任务进度与交接', '开发路线与依赖'].map(
    (name) => `项目文档/${name}.md`,
  ),
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
  'web/src/components/CaseExecution.tsx',
  'web/src/pages/MemoryPage.tsx',
  'web/src/content/p05-course-release.generated.ts',
]);
const modified = [],
  unchanged = [];
for (const item of baseline.files) {
  assert.equal(existsSync(item.path), true, item.path);
  if (sha(read(item.path)) === item.sha256) unchanged.push(item.path);
  else {
    assert.equal(allowed.has(item.path), true, `Outside16.3 ownership: ${item.path}`);
    modified.push({ ...proof(item.path), beforeSha256: item.sha256 });
  }
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), baseline.head);
assert.equal(git('diff', '--cached', '--name-only'), '');
const current = git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
  .split('\0')
  .filter(Boolean);
const oldPaths = new Set(baseline.files.map((item) => item.path));
const added = current.filter((path) => !oldPaths.has(path));
for (const path of added)
  assert.ok(
    path.startsWith('web/src/snapshot-export/') ||
      [
        'scripts/snapshot-release-inputs.mjs',
        'scripts/snapshot-browser.mjs',
        'scripts/register-snapshot.mjs',
        'scripts/snapshot-evidence.mjs',
        'tests/unit/snapshot-export.test.ts',
        'tests/browser/snapshot-export.spec.ts',
        'content/c/p0/blockly-release-1.0.38.json',
      ].includes(path) ||
      /^项目文档\/(?:交付|交接|契约|架构决策|验收)\/16\.3-/.test(path) ||
      path.startsWith('项目文档/验收/发布凭据/16.3-1.0.38/'),
    path,
  );
save(`${dir}/ownership-final.json`, {
  baseline: proof(`${dir}/baseline.json`),
  baselineFiles: baseline.files.length,
  unchanged: unchanged.length,
  modified,
  added,
  deleted: [],
  external: baseline.external,
  head: git('rev-parse', 'HEAD'),
  branch: git('branch', '--show-current'),
  staged: [],
  outgoing: Number(git('rev-list', '--count', 'origin/main..HEAD')),
});
save(`${dir}/evidence-final.json`, {
  task: '16.3',
  accepted: true,
  release: proof(registrationPath),
  sources: 220,
  frontend: {
    passed: 200,
    scope: '12 affected suites including29 snapshot tests; no full frontend rerun',
  },
  browser: {
    uniquePassed: 73,
    reports: ['formal-download-38-final', 'regression-38'].map((name) =>
      proof(`${dir}/${name}.json`),
    ),
    cases: [...browser.values()],
  },
  downloads: {
    files: 99,
    json: 70,
    png: 29,
    summary: proof(`${dir}/download-summary-formal-download-38-final.json`),
  },
  failureReview,
  staticFailures: [
    { failed: 'typecheck-first', reason: 'unused import', rechecked: 'typecheck-close' },
    {
      failed: 'unit-first',
      reason: 'test setup: canonical input order, buildId argument and matcher',
      rechecked: 'units-close',
    },
    {
      failed: 'lint-final',
      reason: 'explicit subscribe dependency in React effect',
      rechecked: 'lint-close',
    },
    {
      failed: 'register-38',
      reason: 'baseline external is an array; registrar stopped before writes',
      rechecked: 'register-38-second',
    },
  ],
  visual: {
    fail: 0,
    warn: visual.findings.filter((item) => item.level === 'WARN').length,
    report: proof(`${dir}/visual.json`),
    firstInspection: 'Retained only; overlapped final rebuild and is not the acceptance gate.',
    uiLintWarning: 'SHA-256 byte padding, not numbered labels.',
  },
  inheritedEngines: proof(`${dir}/inherited-engines.json`),
  ownership: proof(`${dir}/ownership-final.json`),
  noGitMutation: true,
  next: '16.4 unclaimed; only16.3 completed; CI and21 untouched',
});
const archive = '项目文档/验收/16.3-验证原件';
assert.equal(existsSync(`${archive}/index.json`), false);
mkdirSync(archive, { recursive: true });
const localOnly = walk(dir)
  .filter((path) => path.endsWith('.zip'))
  .map(proof);
const entries = walk(dir)
  .filter((path) => !path.endsWith('.zip') && !/\/collect-[^/]+\.(?:log|exit)$/.test(path))
  .map((path) => {
    const file =
      path.slice('.artifacts/'.length).replaceAll('/', '__') +
      (path.endsWith('.log') ? '.txt' : '');
    writeFileSync(`${archive}/${file}`, read(path), { flag: 'wx' });
    return { ...proof(path), file };
  });
save(`${archive}/index.json`, {
  task: '16.3',
  version: '1.0.0',
  entries,
  localOnly,
  reason:
    'Actual downloads, Worker captures, screenshots, reports, failures and scripts preserved byte-for-byte. Failure traces remain local; .log bytes use .log.txt to avoid ignore rules.',
});
console.log(
  JSON.stringify({
    accepted: true,
    sources: 220,
    frontend: 200,
    browser: 73,
    downloads: 99,
    archive: entries.length,
    localFailureTraces: localOnly.length,
    unchanged: unchanged.length,
    modified: modified.length,
    baseline: baseline.files.length,
  }),
);
