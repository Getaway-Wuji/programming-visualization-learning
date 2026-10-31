// Final16.4 audit and byte-preserving archive. Do not rerun against frozen earlier tasks.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
const dir = '.artifacts/16.4',
  read = (path) => readFileSync(path),
  json = (path) =>
    JSON.parse(
      read(path)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, bytes: read(path).length, sha256: sha(read(path)) }),
  save = (path, value) =>
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const walk = (path) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`],
      )
    : [];
const registrationPath = 'content/c/p0/blockly-release-1.0.39.json',
  registration = json(registrationPath);
assert.equal(registration.files.length, 239);
for (const item of [...registration.files, ...Object.values(registration.evidence)])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
assert.equal(
  sha(read('web/src/generated/algorithm/c_viz_algorithm_bg.wasm')),
  registration.algorithmEngine.wasmSha256,
);
const units = json(`${dir}/units-final.json`);
assert.equal(units.numTotalTests, 183);
assert.equal(units.numPassedTests, 183);
assert.equal(units.numPendingTests, 0);
const cases = (suites) =>
    suites.flatMap((suite) => [
      ...(suite.specs ?? []).map((spec) => ({ spec, test: spec.tests[0] })),
      ...cases(suite.suites ?? []),
    ]),
  browser = new Map();
const reports = [
  ['formal-sorts-39', 32],
  ['regression-player39', 12],
  ['regression-consumers39', 3],
];
for (const [name, expected] of reports) {
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
assert.equal(browser.size, 47);
const failureReview = [];
for (const name of ['candidate-fourth', 'candidate-final'])
  for (const { spec, test } of cases(json(`${dir}/${name}.json`).suites))
    if (test.results.some((result) => ['failed', 'timedOut'].includes(result.status))) {
      const key = `${basename(spec.file)}:${spec.title}`;
      assert.ok(browser.has(key));
      failureReview.push({ report: name, title: spec.title, recheckedIn: browser.get(key).report });
    }
for (const label of [
  'typecheck-final',
  'lint-final',
  'format-final',
  'ui-lint-final',
  'visual-first',
  'build-formal39',
  'startup-final',
  'typecheck-delivery',
  'lint-delivery',
  'format-delivery',
  'links-final',
])
  assert.equal(Number(read(`${dir}/${label}.exit`).toString().trim()), 0, label);
const real = json(`${dir}/real-sort-summary.json`);
assert.equal(real.runs, 18);
for (const row of real.rows) {
  assert.equal(sha(read(row.worker.path)), row.worker.sha256);
  assert.equal(row.engine.buildId, registration.algorithmEngine.wasmSha256);
}
const visual = json(`${dir}/visual.json`);
assert.equal(visual.findings.filter((item) => item.level === 'FAIL').length, 0);
const inherited = json(`${dir}/inherited-engines.json`);
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
for (const [task, count] of [
  ['16.1', 310],
  ['16.2', 713],
  ['16.3', 799],
]) {
  const old = `项目文档/验收/${task}-验证原件`,
    index = json(`${old}/index.json`);
  assert.equal(index.entries.length, count);
  for (const item of index.entries)
    assert.equal(sha(read(`${old}/${item.file}`)), item.sha256, item.file);
}
const baseline = json(`${dir}/baseline.json`);
for (const item of [...baseline.prior, baseline.external])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const allowed = new Set([
    'README.md',
    '项目守则.md',
    ...['需求覆盖与范围裁决', '任务进度与交接', '开发路线与依赖'].map(
      (name) => `项目文档/${name}.md`,
    ),
    'web/src/App.tsx',
    'web/src/components/Layout.tsx',
    'web/src/pages/CatalogPages.tsx',
    'scripts/build-p05-course.mjs',
    'scripts/restore-release-evidence.mjs',
    'web/src/content/p05-course-release.generated.ts',
  ]),
  modified = [],
  unchanged = [];
for (const item of baseline.files) {
  assert.ok(existsSync(item.path), item.path);
  if (sha(read(item.path)) === item.sha256) unchanged.push(item.path);
  else {
    assert.ok(allowed.has(item.path), `Outside16.4 ownership: ${item.path}`);
    modified.push({ ...proof(item.path), beforeSha256: item.sha256 });
  }
}
assert.equal(modified.length, 11);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), baseline.head);
assert.equal(git('diff', '--cached', '--name-only'), '');
assert.equal(git('diff', '--check'), '');
const priorPaths = new Set(baseline.files.map((item) => item.path)),
  added = git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter((path) => path && !priorPaths.has(path));
for (const path of added)
  assert.ok(
    path.startsWith('content/algorithms/') ||
      path.startsWith('web/src/algorithms/') ||
      /^scripts\/(?:iterative-sort.*|register-iterative-sorts)\.mjs$/.test(path) ||
      [
        'tests/unit/iterative-sorts.test.ts',
        'tests/browser/iterative-sorts.spec.ts',
        'content/c/p0/blockly-release-1.0.39.json',
      ].includes(path) ||
      /^项目文档\/(?:交付|交接|契约|架构决策|验收)\/16\.4-/.test(path) ||
      path.startsWith('项目文档/验收/发布凭据/16.4-1.0.39/'),
    path,
  );
const relocation = json(`${dir}/compatibility-relocation.json`);
assert.equal(relocation.entries.length, 15);
for (const item of relocation.entries) assert.equal(sha(read(item.to)), item.sha256);
save(`${dir}/ownership-final.json`, {
  baseline: proof(`${dir}/baseline.json`),
  baselineFiles: baseline.files.length,
  unchanged: unchanged.length,
  modified,
  added,
  deleted: [],
  external: baseline.external,
  compatibilityRelocation: proof(`${dir}/compatibility-relocation.json`),
  head: git('rev-parse', 'HEAD'),
  branch: git('branch', '--show-current'),
  staged: [],
  outgoing: Number(git('rev-list', '--count', 'origin/main..HEAD')),
});
save(`${dir}/evidence-final.json`, {
  task: '16.4',
  accepted: true,
  release: proof(registrationPath),
  sources: 239,
  catalog: {
    newCppCases: 3,
    originalCCases: 7,
    lessons: 32,
    exercises: 40,
    groups: 172,
    blocks: 20,
  },
  frontend: {
    passed: 183,
    newSortingTests: 38,
    scope: '9 affected suites; not a full frontend rerun',
  },
  browser: {
    uniquePassed: 47,
    reports: reports.map(([name]) => proof(`${dir}/${name}.json`)),
    cases: [...browser.values()],
  },
  realCppRuns: { boundaryRuns: 18, summary: proof(`${dir}/real-sort-summary.json`) },
  failureReview,
  setupFailures: [
    {
      failed: 'typecheck-browser',
      reason: 'unused test type import',
      rechecked: 'typecheck-final',
    },
    {
      failed: 'candidate-first',
      reason:
        'Node/Playwright cannot import Vite raw source modules; test now reads the source files independently',
      rechecked: 'formal-sorts-39',
    },
    {
      failed: 'candidate-second-aborted',
      reason:
        'two repeated hidden-copy-box lookup timeouts; stopped owned batch; no completed report claimed',
      rechecked: 'candidate-third/formal-sorts-39',
    },
    {
      failed: 'candidate-fourth',
      reason: 'exact link name omitted arrow; headless visibility kept both tabs visible',
      rechecked: 'candidate-controls/formal-sorts-39',
    },
    {
      failed: 'candidate-final',
      reason: 'peer closed before actual async clear finished',
      rechecked: 'candidate-clear/formal-sorts-39',
    },
  ],
  visual: {
    fail: 0,
    warn: visual.findings.filter((item) => item.level === 'WARN').length,
    report: proof(`${dir}/visual.json`),
    uiLintFail: 0,
    uiLintWarn: 0,
  },
  inheritedEngines: proof(`${dir}/inherited-engines.json`),
  ownership: proof(`${dir}/ownership-final.json`),
  noGitMutation: true,
  next: '16.5 unclaimed;16 not complete;21 remains0/10',
});
const archive = '项目文档/验收/16.4-验证原件';
assert.equal(existsSync(`${archive}/index.json`), false);
mkdirSync(archive, { recursive: true });
const localOnly = walk(dir)
    .filter((path) => path.endsWith('.zip'))
    .map(proof),
  entries = walk(dir)
    .filter((path) => !path.endsWith('.zip') && !/\/collect-[^/]+\.(?:log|exit)$/.test(path))
    .map((path) => {
      const file =
        path.slice('.artifacts/'.length).replaceAll('/', '__') +
        (path.endsWith('.log') ? '.txt' : '');
      writeFileSync(`${archive}/${file}`, read(path), { flag: 'wx' });
      return { ...proof(path), file };
    });
save(`${archive}/index.json`, {
  task: '16.4',
  version: '1.0.0',
  entries,
  localOnly,
  reason:
    'Real Worker captures, scalar/array/source/metric boundary summaries, UI pictures, failures and reports kept byte-for-byte; log files use.log.txt. Failure traces remain local with hashes. Old test prefix artifacts were moved only for this fresh16.4 invocation, with verified relocation manifest.',
});
console.log(
  JSON.stringify({
    accepted: true,
    sources: 239,
    frontend: 183,
    browser: 47,
    realBoundaryRuns: 18,
    baseline: baseline.files.length,
    unchanged: unchanged.length,
    modified: modified.length,
    deleted: 0,
    archive: entries.length,
    localFailureTraces: localOnly.length,
  }),
);
