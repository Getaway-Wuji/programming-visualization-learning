// Read actual reports and bind the completed task to exact current sources.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (path) => createHash('sha256').update(read(path)).digest('hex');
const record = (path) => ({ path, sha256: sha(path), bytes: read(path).length });
const folder = '.artifacts/13.3';
const destination = `${folder}/evidence-final.json`;
assert.equal(existsSync(destination), false, 'Preserve the existing final evidence index.');
const baseline = json(`${folder}/baseline.json`);
const allowed = new Set([
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
  ...['blocks', 'bidirectional', 'block-interaction', 'p05-course-temporary'].map(
    (name) => `tests/browser/${name}.spec.ts`,
  ),
  'web/src/blocks/BlockWorkspace.tsx',
  'web/src/blocks/definitions.ts',
  'web/src/components/PracticeExecution.tsx',
  'web/src/content/p05-course-release.generated.ts',
  'web/src/practice/react.tsx',
  'web/src/practice/session.ts',
  'README.md',
  '项目守则.md',
  '项目文档/任务进度与交接.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/开发路线与依赖.md',
  '项目文档/任务包/第13步-完善积木双向联动与学习约束.md',
]);
const changed = [];
let protectedCount = 0;
for (const file of baseline.files) {
  assert.ok(existsSync(file.path), `Deleted baseline file: ${file.path}`);
  if (sha(file.path) === file.sha256) protectedCount++;
  else {
    assert.ok(allowed.has(file.path), `Unexpected change: ${file.path}`);
    changed.push(record(file.path));
  }
}
assert.equal(changed.length, 18);
const inherited = new Set(baseline.files.map((file) => file.path));
const added = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((path) => path && !inherited.has(path))
  .map(record);
const registrationPath = 'content/c/p0/blockly-release-1.0.18.json';
const registration = json(registrationPath);
assert.equal(registration.releaseVersion, '1.0.18');
assert.equal(registration.files.length, 82);
for (const item of [...registration.files, ...Object.values(registration.evidence)])
  assert.equal(sha(item.path), item.sha256, item.path);
const archive = json('项目文档/验收/发布凭据/13.3-1.0.18/index.json');
assert.equal(sha(archive.registration.path), archive.registration.sha256);
for (const item of archive.files)
  assert.equal(sha(`项目文档/验收/发布凭据/13.3-1.0.18/${item.file}`), item.sha256);
const engines = json('.artifacts/12.5/old-engines.json');
assert.equal(engines.length, 3);
for (const item of engines) assert.equal(sha(item.path), item.sha256);
const unitPath = `${folder}/frontend18-registered.json`,
  unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 1404);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.equal(unit.testResults.length, 69);
const rows = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...rows(suite.suites ?? []),
  ]);
const reports = [];
const official = new Map();
for (const [label, passed, failed] of [
  ['candidate-final-4', 2, 0],
  ['legacy-gates-final', 54, 1],
  ['legacy-recovery-final', 2, 0],
  ['registered-final', 7, 2],
  ['registered-recovery', 2, 0],
  ['registered-32-isolated', 1, 0],
  ['legacy18-final', 54, 1],
  ['legacy18-recovery', 2, 0],
  ['candidate18-final', 2, 0],
  ['candidate18-ready', 2, 0],
  ['registered18-final', 5, 0],
]) {
  const path = `${folder}/${label}.json`,
    report = json(path);
  assert.equal(report.stats.expected, passed);
  assert.equal(report.stats.unexpected, failed);
  assert.equal(report.stats.skipped, 0);
  assert.equal(report.stats.flaky, 0);
  assert.deepEqual(report.errors, []);
  for (const { spec, test } of rows(report.suites)) {
    assert.equal(test.projectName, 'chrome');
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].retry, 0);
    if (label.startsWith('registered') && test.results[0].status === 'passed')
      official.set(spec.title, true);
  }
  reports.push({ ...record(path), passed, failed });
}
assert.equal(official.size, 10);
const actualPath =
  '.artifacts/P0.5-09/browser/registered18-final/chrome/fresh-32/complete-evidence.json';
const actual = json(actualPath).evidence;
assert.equal(actual.kind, 'real-native-ui-learning');
assert.equal(actual.groups, 140);
assert.equal(
  actual.completed.data.progress.filter((row) => row.eventType === 'lesson.completed').length,
  32,
);
assert.deepEqual(actual.repeated.data.ledger, actual.refreshed.data.ledger);
const checks = [];
for (const label of [
  'typecheck18-delivery',
  'lint18-delivery',
  'format18-delivery',
  'startup18-final',
  'frontend18-registered',
  'inspector18',
]) {
  const path = `${folder}/${label}-exit.json`;
  assert.equal(json(path).exitCode, 0);
  checks.push(record(path));
}
const visualPath = `${folder}/inspector18/report.json`,
  visual = json(visualPath);
assert.deepEqual(visual.findings, []);
assert.deepEqual(
  visual.viewports.map((view) => view.width),
  [1440, 768, 390],
);
const visualFiles = [
  'desktop-fold.jpg',
  'desktop-page-01.jpg',
  'tablet-fold.jpg',
  'tablet-page-01.jpg',
  'mobile-fold.jpg',
  'mobile-page-01.jpg',
].map((name) => record(`${folder}/inspector18/${name}`));
for (const width of [1440, 768, 390])
  visualFiles.push(record(`${folder}/visual/registered18-final/chrome-${width}-permissions.png`));
const docs = [
  'README.md',
  '项目守则.md',
  '项目文档/任务进度与交接.md',
  '项目文档/开发路线与依赖.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/任务包/第13步-完善积木双向联动与学习约束.md',
  '项目文档/架构决策/13.3-课程积木权限与持久完成凭据.md',
  '项目文档/验收/13.3-积木学习权限验收.md',
  '项目文档/交接/13.3-交接.md',
  '项目文档/交付/13.3-积木权限使用说明.md',
];
let linkCount = 0;
for (const path of docs) {
  const text = read(path).toString('utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const resolved = resolve(dirname(path), decodeURIComponent(target));
    if (resolved === resolve(destination)) continue;
    assert.ok(existsSync(resolved), `${path}: missing ${target}`);
    linkCount++;
  }
}
assert.equal(
  execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim(),
  '',
);
writeFileSync(
  destination,
  JSON.stringify(
    {
      task: '13.3',
      status: 'accepted',
      createdAt: new Date().toISOString(),
      scope: {
        blockKinds: 20,
        currentLessons: 32,
        originalLessons: 6,
        exactRules: 38,
        storage: 'SAVE2 / DB2 / 11 stores unchanged',
        release: '1.0.18',
      },
      baseline: {
        head: baseline.head,
        files: baseline.files.length,
        protected: protectedCount,
        changed,
        added,
        deleted: 0,
      },
      registration: record(registrationPath),
      reviewedFiles: registration.files,
      engines,
      frontend: { ...record(unitPath), files: 69, passed: 1404 },
      reports,
      formalActual: { ...record(actualPath), lessons: 32, groups: 140 },
      checks,
      visual: {
        ...record(visualPath),
        fail: 0,
        warn: 0,
        representativeTheme: 'minimal light',
        files: visualFiles,
        review: record(`${folder}/visual-review.md`),
      },
      documentation: { files: docs.map(record), localLinks: linkCount },
      git: {
        staged: false,
        committed: false,
        pushed: false,
        reason: '13.4 and 13.5 remain; only 13.3 was authorized',
      },
      limitations: [
        'All earlier failed reports are retained. Passed legacy and formal case coverage is explicitly across separate runs, not a green full broad run.',
        'Largest bubble traces reached the existing E_DEADLINE receive guard in earlier runs; Rust completed/met alone did not grant completion. The isolated official 32-lesson run passed within unchanged limits. This is not a complete performance-matrix claim.',
        'Chrome only; one representative theme. No new Rust run, Edge/Firefox, full six-theme matrix, physical DPI/touch/screen-reader or natural full-disk/power-loss test.',
      ],
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  `13.3 accepted: ${protectedCount} baseline originals protected, ${changed.length} authorized updates, ${added.length} new files, 1404 frontend checks, 56 legacy and 10 formal unique Chrome cases across runs, 32/140 real saved submissions.`,
);
