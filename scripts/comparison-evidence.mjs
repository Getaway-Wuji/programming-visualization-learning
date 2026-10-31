// Final 16.2 evidence union and inherited-file audit. Earlier reports remain intact.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
const dir = '.artifacts/16.2';
const collectionLabel = process.argv[2] ?? 'collect-finalized';
assert.match(collectionLabel, /^collect-[A-Za-z0-9-]+$/);
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
const registrationPath = 'content/c/p0/blockly-release-1.0.37.json',
  registration = json(registrationPath);
assert.equal(registration.files.length, 210);
for (const item of [...registration.files, ...Object.values(registration.evidence)])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const units = new Map();
for (const report of ['frontend-wrap.json', 'frontend-wrap-wrong-only.json'])
  for (const file of json(`${dir}/${report}`).testResults)
    for (const [index, test] of file.assertionResults.entries())
      if (test.status === 'passed' || test.status === 'failed')
        units.set(`${basename(file.name)}:${index}:${test.fullName}`, {
          status: test.status,
          report,
        });
assert.equal(units.size, 1609);
for (const test of units.values()) assert.equal(test.status, 'passed');
const cases = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).map((spec) => ({ spec, test: spec.tests[0] })),
    ...cases(suite.suites ?? []),
  ]);
const browser = new Map();
for (const report of [
  'formal-comparison-37.json',
  'storage-final37.json',
  'regression-formal.json',
  'regression-case-set.json',
  'regression-bubble.json',
  'regression-37.json',
]) {
  const data = json(`${dir}/${report}`);
  assert.deepEqual(data.errors, []);
  for (const item of cases(data.suites))
    browser.set(`${basename(item.spec.file)}:${item.spec.title}`, { ...item, report });
}
for (const { spec, test } of browser.values()) {
  assert.equal(spec.ok, true, spec.title);
  assert.equal(test.projectName, 'chrome');
  assert.equal(test.results.length, 1);
  assert.equal(test.results[0].status, 'passed');
  assert.equal(test.results[0].retry, 0);
}
assert.equal(browser.size, 119);
for (const [report, expected] of [
  ['formal-comparison-37.json', 14],
  ['storage-final37.json', 36],
  ['regression-37.json', 22],
]) {
  const data = json(`${dir}/${report}`);
  assert.equal(data.stats.expected, expected);
  assert.equal(data.stats.unexpected + data.stats.skipped + data.stats.flaky, 0);
}
const failureReview = [];
for (const path of readdirSync(dir).filter((path) => path.endsWith('.json'))) {
  let data;
  try {
    data = json(`${dir}/${path}`);
  } catch {
    continue;
  }
  if (Array.isArray(data.suites))
    for (const { spec, test } of cases(data.suites))
      if (test.results.some((result) => ['failed', 'timedOut'].includes(result.status))) {
        const key = `${basename(spec.file)}:${spec.title}`;
        assert.equal(browser.get(key)?.spec.ok, true, `${path}:${key}`);
        failureReview.push({ report: path, key, recheckedIn: browser.get(key).report });
      }
  if (Array.isArray(data.testResults))
    for (const file of data.testResults)
      for (const [index, test] of (file.assertionResults ?? []).entries())
        if (test.status === 'failed') {
          const key = `${basename(file.name)}:${index}:${test.fullName}`;
          assert.equal(units.get(key)?.status, 'passed', `${path}:${key}`);
          failureReview.push({ report: path, key, recheckedIn: units.get(key).report });
        }
}
for (const label of [
  'typecheck-final37',
  'lint-final37',
  'format-final37',
  'build-formal37',
  'startup-final',
  'visual-final37',
  'ui-lint-final37',
  'links-final',
])
  assert.equal(Number(read(`${dir}/${label}.exit`).toString().trim()), 0, label);
const staticFailureReview = [
  ['typecheck-rules', 'typecheck-final37'],
  ['lint-first', 'lint-final37'],
  ['visual-final', 'visual-final37'],
  ['visual-accepted', 'visual-final37'],
  ['visual-polish', 'visual-final37'],
].map(([failed, rechecked]) => {
  assert.notEqual(Number(read(`${dir}/${failed}.exit`).toString().trim()), 0);
  assert.equal(Number(read(`${dir}/${rechecked}.exit`).toString().trim()), 0);
  return {
    failed,
    rechecked,
    failure: proof(`${dir}/${failed}.log`),
    accepted: proof(`${dir}/${rechecked}.log`),
  };
});
assert.equal(json(`${dir}/real-pair-summary37.json`).pairs.length, 8);
const visual = json(`${dir}/taste/inspect-final37/report.json`);
assert.equal(visual.findings.filter((finding) => finding.level === 'FAIL').length, 0);
const inherited = json(`${dir}/inherited-engines.json`);
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const oldArchive = '项目文档/验收/16.1-验证原件',
  oldIndex = json(`${oldArchive}/index.json`);
assert.equal(oldIndex.entries.length, 310);
for (const item of oldIndex.entries)
  assert.equal(sha(read(`${oldArchive}/${item.file}`)), item.sha256, item.file);
const baseline = json(`${dir}/baseline.json`);
const allowed = new Set([
  'README.md',
  '项目守则.md',
  ...['需求覆盖与范围裁决', '任务进度与交接', '开发路线与依赖'].map(
    (path) => `项目文档/${path}.md`,
  ),
  'web/src/App.tsx',
  'web/src/components/Layout.tsx',
  'web/src/pages/CatalogPages.tsx',
  'web/src/content/p05-course-release.generated.ts',
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
  'tests/browser/recovery.spec.ts',
  'tests/browser/case-set.spec.ts',
  'tests/browser/workbench-layout.spec.ts',
]);
const changed = [],
  unchanged = [];
for (const item of baseline.files) {
  assert.ok(existsSync(item.path), `Deleted inherited file: ${item.path}`);
  if (sha(read(item.path)) === item.sha256) unchanged.push(item.path);
  else {
    assert.ok(allowed.has(item.path), `Unowned inherited change: ${item.path}`);
    changed.push(proof(item.path));
  }
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
assert.equal(git('rev-parse', 'HEAD'), baseline.head);
assert.equal(git('diff', '--cached', '--name-only'), '');
const current = [
  ...new Set(
    execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      encoding: 'utf8',
      windowsHide: true,
    })
      .split('\0')
      .filter(Boolean),
  ),
];
const original = new Set(baseline.files.map((item) => item.path));
const allAdded = current.filter((path) => !original.has(path));
const allowedNew =
  /^(?:web\/src\/comparison\/|scripts\/(?:comparison-(?:browser|release-inputs|evidence)|register-comparison(?:-polish)?)\.mjs$|tests\/(?:unit\/comparison\.test\.ts|browser\/comparison\.spec\.ts)$|content\/c\/p0\/blockly-release-1\.0\.(?:36|37)\.json$|项目文档\/(?:架构决策\/16\.2-|契约\/16\.2-|交接\/16\.2-|交付\/16\.2-|验收\/(?:16\.2-|发布凭据\/16\.2-1\.0\.(?:36|37)\/)))/;
const externalObservation = json(`${dir}/external-file-observation.json`);
const externalAdded = [],
  added = [];
for (const path of allAdded) {
  if (allowedNew.test(path)) added.push(path);
  else {
    const observed = externalObservation.files.find((item) => item.path === path);
    assert.ok(observed, `Unowned new file: ${path}`);
    assert.equal(
      sha(read(path)),
      observed.sha256,
      `External file changed since observation: ${path}`,
    );
    externalAdded.push(proof(path));
  }
}
save(`${dir}/ownership-final.json`, {
  baselineFiles: baseline.files.length,
  unchanged: unchanged.length,
  changed,
  added: added.map(proof),
  externalAdded,
  deleted: 0,
  prior16_1Archive: { entries: 310, index: proof(`${oldArchive}/index.json`) },
  git: {
    head: baseline.head,
    staged: [],
    status: git('status', '--short'),
    outgoingCommits: git('rev-list', '--count', 'origin/main..HEAD'),
    operations: 'No staging, commits or push',
  },
});
const archive = '项目文档/验收/16.2-验证原件';
const beforeManifest = walk(dir).filter(
  (path) => !new RegExp(`/${collectionLabel}\\.(?:log|exit|json)$`).test(path),
);
const archiveCount = beforeManifest.filter((path) => !path.endsWith('/trace.zip')).length + 1;
const localOnlyFailureTraces = beforeManifest
  .filter((path) => path.endsWith('/trace.zip'))
  .map(proof);
save(`${dir}/evidence-final.json`, {
  task: '16.2',
  accepted: true,
  release: proof(registrationPath),
  sources: 210,
  frontend: {
    uniquePassed: units.size,
    fullPassed: json(`${dir}/frontend-wrap.json`).numPassedTests,
    earlierFullPassed: 1608,
    earlierFocusedPassed: 9,
    finalFocusedPassed: 1,
    singleBatchAllGreen: false,
  },
  browser: {
    uniquePassed: browser.size,
    reports: [...new Set([...browser.values()].map((item) => item.report))].map((path) =>
      proof(`${dir}/${path}`),
    ),
    cases: [...browser].map(([key, value]) => ({ key, report: value.report })),
  },
  visual: proof(`${dir}/taste/inspect-final37/report.json`),
  failureReview,
  staticFailureReview,
  realExecution: proof(`${dir}/real-pair-summary37.json`),
  preserved: {
    rustPassedInherited: inherited.rustPassed,
    rustFullRerun: false,
    save: '7.0.0',
    database: 7,
    stores: 15,
    lessons: 32,
    exercises: 40,
    groups: 172,
    blocks: 20,
    originalCCases: 7,
  },
  ownership: proof(`${dir}/ownership-final.json`),
  archive: { path: `${archive}/index.json` },
  archiveEntries: archiveCount,
  localOnlyFailureTraces: localOnlyFailureTraces.length,
  next: '16.3 unclaimed; no Git until full16 block acceptance',
});
mkdirSync(archive, { recursive: true });
const entries = [];
for (const path of [...beforeManifest, `${dir}/evidence-final.json`]) {
  if (path.endsWith('/trace.zip')) continue;
  const file =
    '16.2__' +
    path.slice(dir.length + 1).replaceAll('/', '__') +
    (path.endsWith('.log') ? '.txt' : '');
  const destination = `${archive}/${file}`;
  if (!existsSync(destination)) writeFileSync(destination, read(path), { flag: 'wx' });
  assert.equal(sha(read(destination)), sha(read(path)));
  entries.push({ ...proof(path), file });
}
assert.equal(entries.length, archiveCount);
writeFileSync(
  `${archive}/index.json`,
  JSON.stringify(
    { task: '16.2', entries, localOnlyFailureTraces, failureReview, staticFailureReview },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    frontend: units.size,
    browser: browser.size,
    changed: changed.length,
    addedBeforeArchive: added.length,
    archiveEntries: entries.length,
    failuresReviewed: failureReview.length,
  }),
);
