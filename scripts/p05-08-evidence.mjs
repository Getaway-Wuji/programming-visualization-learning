import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const folder = '.artifacts/P0.5-08';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (path) => createHash('sha256').update(read(path)).digest('hex');
const entry = (path) => ({ path, sha256: sha(path), bytes: read(path).length });
const allowed = new Set([
  'README.md',
  'scripts/build.mjs',
  'scripts/build-course-learning.mjs',
  'scripts/startup-check.mjs',
  'tsconfig.tools.json',
  'web/src/blocks/BlockWorkspace.tsx',
  'web/src/components/PracticeExecution.tsx',
  'web/src/pages/SettingsPage.tsx',
  'web/src/pages/Workspaces.tsx',
  'web/src/practice/session.ts',
  'web/src/practice/edit-document.ts',
  'web/src/workbench/Workbench.tsx',
  'web/src/workbench/workbench.css',
  'web/src/content/course-learning-release.generated.ts',
  'tests/unit/edit-session.test.ts',
  'tests/browser/bidirectional.spec.ts',
  'tests/browser/block-ui.ts',
  ...[
    'blocks',
    'practice',
    'navigation',
    'practice-experience',
    'workbench-layout',
    'silent-workspace',
    'daily-goals',
    'rewards',
    'profile',
    'practice-learning',
    'p0-delivery',
    'block-interaction',
  ].map((name) => `tests/browser/${name}.spec.ts`),
  '项目守则.md',
  '项目文档/任务进度与交接.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/任务包/P0.5-体验改进与基础教学补强.md',
]);
const baseline = json(`${folder}/baseline.json`);
const changed = [],
  unchanged = [];
for (const file of baseline.files) {
  assert.ok(existsSync(file.path), `Baseline file removed: ${file.path}`);
  if (sha(file.path) === file.sha256) unchanged.push(file);
  else {
    assert.ok(allowed.has(file.path), `Unexpected baseline change: ${file.path}`);
    changed.push({ ...entry(file.path), priorSha256: file.sha256 });
  }
}
const unitPath = `${folder}/unit-post-publish.json`;
const unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.equal(unit.numPassedTests, unit.numTotalTests);
assert.equal(unit.numPassedTests, 1038);
assert.equal(unit.testResults.length, 52);
const registrationPath = 'content/c/p0/blockly-release-1.0.13.json';
const registration = json(registrationPath);
assert.equal(registration.releaseVersion, '1.0.13');
assert.equal(registration.files.length, 36);
for (const file of registration.files) assert.equal(sha(file.path), file.sha256);
for (const proof of Object.values(registration.evidence))
  if (proof.path && proof.sha256) assert.equal(sha(proof.path), proof.sha256);
const identities = new Set();
const reports = [];
const postScope = new Set();
const postPassed = new Set();
function records(suites, parents = []) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({
        title: [basename(spec.file.replaceAll('\\', '/')), ...parents, spec.title].join(' / '),
        spec,
        test,
      })),
    ),
    ...records(
      suite.suites ?? [],
      suite.title.endsWith('.spec.ts') ? parents : [...parents, suite.title],
    ),
  ]);
}
for (const [name, count, expectedFailures = 0] of [
  ['gate-blocks', 45],
  ['gate-navigation', 3],
  ['gate-interaction', 15],
  ['gate-experience', 15],
  ['bidirectional-final', 39],
  ['presentation-final', 51],
  ['post-publish', 138, 9],
  ['post-repair', 45],
  ['learner-regression', 9],
]) {
  const path = `${folder}/${name}.json`;
  const report = json(path);
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.expected, count - expectedFailures);
  assert.equal(report.stats.unexpected, expectedFailures);
  for (const key of ['flaky', 'skipped']) assert.equal(report.stats[key], 0);
  const cases = records(report.suites);
  assert.equal(cases.length, count);
  for (const { title, spec, test } of cases) {
    assert.equal(test.results.length, 1);
    const key = `${test.projectName}: ${title}`;
    if (name === 'post-publish') postScope.add(key);
    if (test.results[0].status === 'passed') {
      assert.equal(spec.ok, true);
      identities.add(key);
      if (['post-publish', 'post-repair'].includes(name)) postPassed.add(key);
    } else {
      assert.equal(name, 'post-publish');
      assert.equal(spec.ok, false);
      assert.ok(['failed', 'timedOut'].includes(test.results[0].status));
    }
  }
  reports.push({
    ...entry(path),
    passed: count - expectedFailures,
    failed: expectedFailures,
    startTime: report.stats.startTime,
  });
}
assert.equal(postScope.size, 138);
assert.deepEqual([...postPassed].sort(), [...postScope].sort());
const presentationPath = 'web/public/content/presentation/manifest.json';
const presentation = json(presentationPath);
assert.equal(presentation.purpose, 'teaching-presentation');
assert.equal(presentation.sha256, sha(presentation.source));
assert.equal(presentation.sha256, sha(`web/public/${presentation.file}`));
assert.equal('capabilities' in presentation, false);
const learning = json('web/public/content/learning/manifest.json');
assert.equal(learning.file, 'content/learning/course-learning-1.0.13.json');
assert.equal(sha(`web/public/${learning.file}`), learning.sha256);
const visualPath = `${folder}/visual-published/report.json`;
const visual = json(visualPath);
assert.equal(visual.scenarios.length, 48);
assert.ok(visual.scenarios.every((scene) => scene.geometry.pageOverflow === 0));
const visualScreenshots = visual.scenarios.flatMap((scene) =>
  ['', '-full'].map((suffix) => entry(`${folder}/visual-published/${scene.file}${suffix}.png`)),
);
assert.equal(new Set(visualScreenshots.map((file) => file.path)).size, 96);
assert.equal(
  readdirSync(`${folder}/visual-published`).filter((file) => file.endsWith('.png')).length,
  96,
);
const visualIndexPath = `${folder}/visual-published/source-index.json`;
const visualIndex = json(visualIndexPath);
assert.equal(visualIndex.visual.sha256, sha(visualPath));
assert.equal(sha(visualIndex.sourceSnapshot.path), visualIndex.sourceSnapshot.sha256);
const visualSources = json(visualIndex.sourceSnapshot.path);
assert.equal(visualSources.sourceFiles.length, 39);
assert.equal(visualSources.assets.length, 23);
for (const file of [...visualSources.sourceFiles, ...visualSources.assets])
  assert.equal(sha(file.path), file.sha256);
assert.equal(sha('web/dist/index.html'), visualSources.staticIndexSha256);
assert.equal(sha(registrationPath), visualIndex.registration.sha256);
const inspector = json(`${folder}/inspector/report.json`);
assert.deepEqual(inspector.findings, []);
const startup = json(`${folder}/startup-final.json`);
assert.equal(startup.ownedProcessesStopped, true);
assert.deepEqual(
  startup.records.map((record) => record.mode),
  ['dev', 'preview'],
);
const changeCardPath = '项目文档/契约/P0.5-08-课程展示与偏好变更登记.json';
const changeCard = json(changeCardPath);
assert.equal(changeCard.status, 'accepted');
assert.equal(changeCard.runtimeApproved, true);
assert.equal(changeCard.approvals.length, 11);
assert.ok(changeCard.approvals.every((approval) => approval.decision === 'accepted'));
const result = {
  task: 'P0.5-08',
  createdAtUtc: new Date().toISOString(),
  status: 'accepted',
  scope: { lessons: 6, exercises: 6, groups: 24, blockKinds: 20, registrationSources: 36 },
  baseline: {
    ...entry(`${folder}/baseline.json`),
    total: baseline.files.length,
    unchanged,
    changed,
  },
  frontend: { ...entry(unitPath), passed: unit.numPassedTests, files: unit.testResults.length },
  registrationFrontend: entry(`${folder}/unit-final.json`),
  browsers: {
    reports,
    uniqueScenarios: identities.size,
    postPublishUniquePassed: postPassed.size,
    successfulExecutions: reports.reduce((sum, report) => sum + report.passed, 0),
  },
  registration: entry(registrationPath),
  presentation: entry(presentationPath),
  learning: entry(`web/public/${learning.file}`),
  visual: {
    ...entry(visualPath),
    scenes: 48,
    screenshots: 96,
    browserVersion: visual.browserVersion,
    files: visualScreenshots,
  },
  inspector: entry(`${folder}/inspector/report.json`),
  visualSourceIndex: entry(visualIndexPath),
  startup: entry(`${folder}/startup-final.json`),
  build: entry(`${folder}/build-final.log`),
  staticChecks: ['typecheck', 'lint', 'format-check'].map((name) =>
    entry(`${folder}/${name}-final.log`),
  ),
  documents: [
    changeCardPath,
    '项目文档/架构决策/P0.5-08-课程作答与积木显隐落地.md',
    '项目文档/验收/P0.5-08-课程作答与积木显示验收.md',
    '项目文档/交接/P0.5-08-课程作答与积木显示交接.md',
    '项目文档/交付/P0.5-08-代码作答与积木显示使用说明.md',
  ].map(entry),
  evidenceTools: [
    'scripts/p05-08-evidence.mjs',
    'scripts/p05-08-gates.mjs',
    'scripts/p05-08-visual.mjs',
    'scripts/register-blockly-p05-08.mjs',
    'scripts/build-teaching-presentation.mjs',
  ].map(entry),
  notes: [
    'Rust/WASM is unchanged from 13.2; registration validates the same four Rust inputs and actual binary hashes. No new Rust full-suite or performance-matrix claim.',
    'Initial browser run was interrupted before a complete JSON report; its raw per-scenario evidence remains in browser-presentation/initial.',
    'The earlier 48/51 passing presentation candidates, the initial 25/45 legacy gate, concurrent frontend setup deadline, and intermediate unit regression are retained separately; final evidence is after the relevant repairs.',
    'Post-publish broad run passed 129/138. Three legacy UI/evidence prerequisites failed in all three browsers; complete repaired specs passed 45/45, with their union proving all 138 published scenarios. This is not a single green 138-case run.',
    'The first legacy candidate used default task output paths for some old temporary browser captures. Later runs are isolated by TASK_EVIDENCE_TASK=P0.5-08; no all-history-byte-preservation claim is made for ignored temporary probes.',
    'No Git commit/push, public deployment or clearing of the user archive was performed.',
  ],
};
writeFileSync(`${folder}/evidence-final.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    baseline: baseline.files.length,
    protected: unchanged.length,
    changed: changed.length,
    unit: unit.numPassedTests,
    browserUnique: identities.size,
    browserExecutions: result.browsers.successfulExecutions,
    visualScenes: 48,
  }),
);
