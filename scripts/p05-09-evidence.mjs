// Read existing evidence only. This tool neither executes tests nor starts services.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { reviewedP05Paths } from './p05-09-release-inputs.mjs';

const folder = '.artifacts/P0.5-09';
const output = `${folder}/evidence-final.json`;
assert.equal(existsSync(output), false, 'Preserve an existing final evidence index.');
const registrationPath = 'content/c/p0/blockly-release-1.0.16.json';
const priorRegistrationPath = 'content/c/p0/blockly-release-1.0.15.json';
const initialRegistrationPath = 'content/c/p0/blockly-release-1.0.14.json';
// The user narrowed this task's remaining acceptance to Chrome on 2026-10-29.
// Earlier Edge/Firefox rounds remain historical evidence, never new green gates.
const projects = ['chrome'];
const versionVectors = ['1.0.0/1.0.0/1.0.0/1.0.0/1.0.0', '1.1.0/1.0.0/1.0.0/1.1.0/1.0.0'];
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (path) => createHash('sha256').update(read(path)).digest('hex');
const entry = (path) => ({ path, sha256: sha(path), bytes: statSync(path).size });
const excludedReproducibleDirectories = new Set();
const cacheDirectoryNames = new Set([
  'target',
  'node_modules',
  '.cache',
  'Cache',
  'Code Cache',
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
]);
const walk = (path) =>
  readdirSync(path, { withFileTypes: true })
    .flatMap((item) => {
      const child = `${path}/${item.name}`;
      if (item.isDirectory() && cacheDirectoryNames.has(item.name)) {
        excludedReproducibleDirectories.add(child);
        return [];
      }
      return item.isDirectory() ? walk(child) : [child];
    })
    .sort();
const sorted = (values) => [...values].sort();
const unique = (values, message) => assert.equal(new Set(values).size, values.length, message);
function proof(value) {
  assert.equal(typeof value.path, 'string');
  assert.ok(!isAbsolute(value.path) && !value.path.split(/[\\/]/).includes('..'));
  assert.match(value.sha256, /^[0-9a-f]{64}$/);
  assert.equal(sha(value.path), value.sha256, `Evidence changed: ${value.path}`);
  if (value.bytes !== undefined) assert.equal(statSync(value.path).size, value.bytes);
  return entry(value.path);
}

// This is a task-local allowlist, not the union of earlier tasks' permissions.
const centralDocuments = [
  'README.md',
  '项目守则.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/任务进度与交接.md',
  '项目文档/任务包/P0.5-体验改进与基础教学补强.md',
];
// A separate user-authorized documentation window changed the Git policy while
// P0.5-09 was in progress. Preserve and classify its work independently of this
// task's implementation; the shared rules file may also receive a current-state
// header update from the P0.5 coordinator.
const externalPolicy = {
  authority:
    '2026-10-28 user instructions: document the complete-block Git workflow only; no staging, commit or push in this round',
  agents: {
    path: 'AGENTS.md',
    sha256: '14c0cc3532a5daa690fb23a15adea1a184c87898222ce85e189f5cf1257a9919',
  },
  handoff: {
    path: '项目文档/交接/2026-10-28-GitHub大块提交规范交接.md',
    sha256: 'f750be38080d89b6a629f30c5f9c2853690e31ef194f22fc78787d8a02a2b45f',
  },
  sharedRules: {
    path: '项目守则.md',
    sectionSha256: '38c0d9a08b5073d6137d788a0b01baecbf7124efc644f7bae208307339d47033',
    coordinationRuleSha256: '822a92a2a0a6d5e695f17c12190328d2adb5e9c4418f610f4a0d49a173fb93d5',
  },
};
const externalBaselinePaths = new Set([externalPolicy.agents.path]);
const externalNewPaths = new Set([externalPolicy.handoff.path]);
proof(externalPolicy.agents);
proof(externalPolicy.handoff);
const rulesText = read(externalPolicy.sharedRules.path).toString('utf8').replaceAll('\r\n', '\n');
const policyStart = rulesText.indexOf('### 8.1 GitHub');
const policyEnd = rulesText.indexOf('新窗口可复制：', policyStart);
assert.ok(
  policyStart >= 0 && policyEnd > policyStart,
  'Preserve the independent Git policy section.',
);
const digestText = (text) => createHash('sha256').update(text).digest('hex');
assert.equal(
  digestText(rulesText.slice(policyStart, policyEnd)),
  externalPolicy.sharedRules.sectionSha256,
);
const coordinationRule = rulesText
  .split('\n')
  .find((line) => line.startsWith('4. 项目已初始化 Git'));
assert.equal(typeof coordinationRule, 'string');
assert.equal(digestText(coordinationRule), externalPolicy.sharedRules.coordinationRuleSha256);
const allowedChanges = new Set([
  ...centralDocuments,
  'engine/core/src/exec.rs',
  'engine/core/src/input.rs',
  'engine/core/src/judge.rs',
  'engine/core/src/codec.rs',
  'engine/wasm/src/lib.rs',
  'engine/core/src/run.rs',
  'scripts/build-content.mjs',
  'scripts/build-prepared-sources.mjs',
  'scripts/build-wasm.mjs',
  'scripts/build.mjs',
  'scripts/generate-execution-schema.mjs',
  'scripts/serve-checks.mjs',
  'scripts/startup-check.mjs',
  'scripts/performance-observer.mjs',
  'scripts/verify-case-set.mts',
  'scripts/verify-vertical-evidence.mts',
  'tests/browser/case-set-observation.ts',
  'tests/browser/editor-presentation.spec.ts',
  'tests/unit/prepared-source-11.4.test.ts',
  'web/src/blocks/starters.ts',
  'web/src/components/CaseExecution.tsx',
  'web/src/components/CourseReading.tsx',
  'web/src/components/PracticeExecution.tsx',
  'web/src/components/PracticeGuidance.tsx',
  'web/src/content/case-learning.ts',
  'web/src/content/course-learning.ts',
  'web/src/content/practice.ts',
  'web/src/content/reading.ts',
  'web/src/content/teaching-presentation.ts',
  'web/src/content/types.ts',
  'web/src/content/validator.mjs',
  'web/src/engine/execution-client.ts',
  'web/src/engine/protocol.ts',
  'web/src/engine/execution-json.ts',
  'web/src/engine/prepared-source.ts',
  'web/src/engine/analysis-protocol.ts',
  'web/src/engine/execution.worker.ts',
  'web/src/engine/trace-validation.ts',
  'web/src/learning/completion.ts',
  'web/src/learning/domain.ts',
  'web/src/learning/goals.ts',
  'web/src/learning/profile-components.tsx',
  'web/src/learning/react.tsx',
  'web/src/learning/reviewed-release.ts',
  'web/src/learning/service.ts',
  'web/src/navigation.ts',
  'web/src/pages/LessonPage.tsx',
  'web/src/practice/submission.ts',
  'web/src/practice/session.ts',
  'web/src/storage/client.ts',
  'web/src/storage/recovery.ts',
]);
const documents = [
  '项目文档/契约/P0.5-09-扩课与兼容变更登记.json',
  '项目文档/契约/P0.5-09-新增课程与判据契约.md',
  '项目文档/架构决策/P0.5-09-扩课与兼容实施.md',
  '项目文档/验收/P0.5-09-夹具索引.json',
  '项目文档/验收/P0.5-09-正文审校.md',
  '项目文档/验收/P0.5-09-扩课与兼容验收.md',
  '项目文档/交接/P0.5-09-扩课与兼容交接.md',
  '项目文档/交付/P0.5-09-扩课使用说明.md',
];
const newFiles = new Set([
  ...documents,
  registrationPath,
  priorRegistrationPath,
  initialRegistrationPath,
  'content/c/p05/course-1.0.0.json',
  'content/c/p05/practice-guidance-1.0.0.json',
  'content/goals/p0-1.1.0.json',
  'content/learning/p05-predecessors-1.0.0.json',
  'engine/core/src/judge_p05.rs',
  'engine/core/tests/p05_course_acceptance.rs',
  'scripts/author-p05-course.mjs',
  'scripts/build-p05-course.mjs',
  'scripts/build-p05-predecessor.mjs',
  'scripts/p05-09-browser.mjs',
  'scripts/p05-09-contracts.mjs',
  'scripts/p05-09-evidence.mjs',
  'scripts/p05-09-gates.mjs',
  'scripts/p05-09-release-inputs.mjs',
  'scripts/p05-09-rust-evidence.mjs',
  'scripts/p05-09-visual.mjs',
  'scripts/register-blockly-p05-09.mjs',
  'scripts/register-blockly-p05-09-successor.mjs',
  'scripts/register-blockly-p05-09-receiver.mjs',
  'tests/browser/p05-course-temporary.spec.ts',
  'tests/browser/p05-course.spec.ts',
  'tests/browser/p05-chrome-runtime.spec.ts',
  'tests/fixtures/p05-authoring-examples.json',
  'tests/fixtures/p05-learning.ts',
  'tests/fixtures/p05-reference-solutions.json',
  'tests/unit/p05-course-wasm.test.ts',
  'tests/unit/p05-course.test.ts',
  'tests/unit/p05-coverage.test.ts',
  'tests/unit/p05-encoding.test.ts',
  'tests/unit/p05-recovery-fast-path.test.ts',
  'tests/unit/p05-durable-display.test.ts',
  'tests/unit/p05-goals.test.ts',
  'tests/unit/p05-learning-compatibility.test.ts',
  'web/src/content/course-bundle.ts',
  'web/src/content/p05-course-release.generated.ts',
  'web/src/content/schema-p05.mjs',
  'web/src/content/validator-p05.mjs',
  'web/src/engine/execution-p05-schema.generated.ts',
  '项目文档/契约/P0.5-09-内容结构-1.1.0.schema.json',
  '项目文档/契约/P0.5-09-执行与判题-1.1.0.schema.json',
  '项目文档/验收/P0.5-09-Schema核验.ps1',
]);
const baselinePath = `${folder}/baseline.json`;
assert.equal(
  sha(baselinePath),
  'b7a717d604e08cdb4ef5578779ab3bea8cfe8ca9e16eaf614d4115d8ccbdd231',
  'The original 1181-file baseline must stay byte-identical.',
);
const baseline = json(baselinePath);
assert.equal(baseline.files.length, 1181);
unique(
  baseline.files.map((file) => file.path),
  'Duplicate baseline path.',
);
const baselinePaths = new Set(baseline.files.map((file) => file.path));
const changed = [],
  externalChanges = [],
  unchanged = [];
for (const file of baseline.files) {
  assert.ok(existsSync(file.path), `Baseline file removed: ${file.path}`);
  if (sha(file.path) === file.sha256) unchanged.push(file);
  else {
    if (externalBaselinePaths.has(file.path)) {
      externalChanges.push({ ...entry(file.path), priorSha256: file.sha256 });
      continue;
    }
    assert.ok(allowedChanges.has(file.path), `Unauthorized baseline change: ${file.path}`);
    changed.push({ ...entry(file.path), priorSha256: file.sha256 });
  }
}
const managedPaths = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean)
  .map((path) => path.replaceAll('\\', '/'));
unique(managedPaths, 'Duplicate managed path.');
const allAdded = managedPaths.filter((path) => !baselinePaths.has(path));
for (const path of allAdded)
  assert.ok(newFiles.has(path) || externalNewPaths.has(path), `Unreviewed new file: ${path}`);
const added = allAdded.filter((path) => newFiles.has(path));
const externalAdded = allAdded.filter((path) => externalNewPaths.has(path));
for (const path of newFiles) assert.ok(added.includes(path), `Missing new deliverable: ${path}`);
for (const path of externalNewPaths)
  assert.ok(externalAdded.includes(path), `Missing independent policy deliverable: ${path}`);
assert.equal(unchanged.length + changed.length + externalChanges.length, baseline.files.length);

// Freeze the five predecessor bytes independently of the newly authored mapping.
const predecessors = [
  {
    path: 'content/c/p0/course-1.0.1.json',
    sha256: '713133313e65ba9ea000daa18d5feaea84beeb65f296b8102edc5de114fa2611',
  },
  {
    path: 'web/public/content/reading/course-reading-1.0.0.json',
    sha256: '0a223bd495298518bb4f81e833743d802b601262f720f2c084e4853a1d2ad5ab',
  },
  {
    path: 'web/public/content/practice/course-practice-1.0.0.json',
    sha256: '9f2e834d76f1bbf5b3f8aaaa0de1326dba8cedd23a735d9502a306a32a819ed2',
  },
  {
    path: 'web/public/content/learning/course-learning-1.0.13.json',
    sha256: '7e5dfe8afe9a4ab7f4c40a4be2bfb3c3a230aaddf84e82678f980d90476ecab0',
  },
  {
    path: 'content/c/p0/case-view-1.0.1.json',
    sha256: '7459c60ab281ec19f93529adf01f2ec018bf0a61f3c1cc04af41979c8973828c',
  },
];
const predecessorPath = 'content/learning/p05-predecessors-1.0.0.json';
assert.deepEqual(json(predecessorPath).sources, predecessors);
predecessors.forEach(proof);
const registration = json(registrationPath);
assert.equal(registration.releaseVersion, '1.0.16');
assert.deepEqual(registration.supersedes, {
  version: '1.0.15',
  path: priorRegistrationPath,
  sha256: sha(priorRegistrationPath),
});
const supersededRegistration = json(priorRegistrationPath);
assert.equal(
  sha(priorRegistrationPath),
  '102612eb8c7d142b7783c9c6ff08ff6968525e018a6bff6596c46c1aeb3d7035',
);
assert.equal(supersededRegistration.releaseVersion, '1.0.15');
assert.equal(supersededRegistration.files.length, 73);
const supersededProofs = Object.fromEntries(
  Object.entries(supersededRegistration.evidence).map(([name, value]) => [name, proof(value)]),
);
const initialRegistration = json(initialRegistrationPath);
assert.equal(
  sha(initialRegistrationPath),
  '17f3bfa75bdda202db2f62dd8a3c109d9ac4894fb71a8a681aab0b4630ee9ec9',
);
assert.equal(initialRegistration.releaseVersion, '1.0.14');
assert.equal(initialRegistration.files.length, 72);
const initialProofs = Object.fromEntries(
  Object.entries(initialRegistration.evidence).map(([name, value]) => [name, proof(value)]),
);
proof({
  path: 'scripts/register-blockly-p05-09-successor.mjs',
  sha256: '45a63719ccf3307f451b140458ed1a8c5219def1067c56a576514c73a0990a3c',
});
proof({
  path: 'scripts/register-blockly-p05-09.mjs',
  sha256: '75054c4fad47a17750bc39c13dbe126131bd480d55ae9292e2112cc09fc5ee2e',
});
assert.deepEqual(registration.executionVersions, versionVectors);
assert.match(registration.legacyGateMode, /^P05_HIDE_COURSE_BUNDLE=1:/);
assert.deepEqual(
  registration.files.map((file) => file.path),
  reviewedP05Paths,
);
unique(reviewedP05Paths);
registration.files.forEach(proof);
const registeredProofs = Object.fromEntries(
  Object.entries(registration.evidence).map(([name, value]) => [name, proof(value)]),
);
for (const name of [
  'rust',
  'wasm',
  'frontend',
  'course',
  'temporaryBrowsers',
  ...projects.map((project) => `temporary-${project}`),
])
  assert.ok(name in registeredProofs, `Missing registration evidence: ${name}`);
assert.equal(registration.evidence.course.path, `${folder}/course-wasm-receiver-registration.json`);

const rust = json(registration.evidence.rust.path);
assert.equal(rust.task, 'P0.5-09');
assert.equal(rust.status, 'passed');
assert.ok(Number.isInteger(rust.passed) && rust.passed >= 452);
assert.equal(rust.failed, 0);
assert.equal(rust.ignored, 1);
assert.ok(rust.sourceFiles.length > 20 && rust.checks.length > 0);
rust.sourceFiles.forEach(proof);
for (const check of rust.checks) {
  assert.equal(check.exitCode, 0);
  proof(check);
  for (const phase of check.phases ?? []) assert.equal(phase.exitCode, 0);
}
proof(rust.summary);
rust.authoredEvidence.forEach(proof);
const wasm = json(registration.evidence.wasm.path);
assert.deepEqual(wasm.supportedVersionVectors, versionVectors);
assert.deepEqual(
  wasm.memories.map(({ maximum, shared }) => ({ maximum, shared })),
  [{ maximum: 2048, shared: false }],
);
for (const [path, sha256] of Object.entries(wasm.hashes)) proof({ path, sha256 });
const binaryPath = 'web/src/generated/c_viz_wasm_bg.wasm';
assert.equal(sha(binaryPath), registration.engine.wasmSha256);
assert.equal(read(binaryPath).length, registration.engine.wasmBytes);
assert.equal(registration.evidence.wasm.buildId, registration.engine.wasmSha256);
assert.deepEqual(registration.engine, supersededRegistration.engine);
assert.equal(registration.engine.wasmSha256, supersededRegistration.evidence.wasm.buildId);
assert.equal(registration.evidence.rust.sha256, supersededRegistration.evidence.rust.sha256);
assert.equal(registration.evidence.wasm.sha256, supersededRegistration.evidence.wasm.sha256);
const actualExports = WebAssembly.Module.exports(new WebAssembly.Module(read(binaryPath))).map(
  (item) => item.name,
);
for (const name of ['prepare_input', 'analyze_code_draft', 'execute_request'])
  assert.ok(actualExports.includes(name));
const runtimeSourcePaths = [
  ...new Set([
    ...reviewedP05Paths,
    ...rust.sourceFiles.map((file) => file.path),
    ...Object.keys(wasm.hashes),
  ]),
];
const lastSourceChange = Math.max(...runtimeSourcePaths.map((path) => statSync(path).mtimeMs));
// A formal build may rewrite identical generated/WASM bytes after registration.
// Preregistration evidence is checked against its frozen source snapshot, while
// the current bytes still have to match that snapshot exactly.
const frozenFreshness = registration.evidenceFreshness;
assert.ok(frozenFreshness && Array.isArray(frozenFreshness.sources));
unique(frozenFreshness.sources.map((file) => file.path));
assert.deepEqual(
  sorted(frozenFreshness.sources.map((file) => file.path)),
  sorted(runtimeSourcePaths),
);
frozenFreshness.sources.forEach(proof);
const frozenSourceChange = Date.parse(frozenFreshness.lastSourceModifiedAtUtc);
assert.ok(Number.isFinite(frozenSourceChange));
assert.equal(
  frozenSourceChange,
  Math.max(...frozenFreshness.sources.map((file) => Date.parse(file.modifiedAtUtc))),
);
assert.ok(statSync(registrationPath).mtimeMs >= frozenSourceChange);
const authoredCourse = json('content/c/p05/course-1.0.0.json');
const expectedExerciseIds = sorted(authoredCourse.exercises.map((exercise) => exercise.id));
const expectedGroupKeys = sorted(
  authoredCourse.exercises.flatMap((exercise) =>
    exercise.tests.map((test) => `${exercise.id}:${test.caseKey}`),
  ),
);
assert.equal(expectedExerciseIds.length, 32);
assert.equal(expectedGroupKeys.length, 140);

function checkCourseExecution(path) {
  const actual = json(path);
  assert.equal(actual.producer, 'actual-rust-wasm');
  assert.equal(actual.userData, false);
  const accepted = actual.records.filter((record) => !record.correction);
  assert.equal(accepted.length, 140);
  assert.equal(new Set(accepted.map((record) => record.exerciseId)).size, 32);
  unique(accepted.map((record) => `${record.exerciseId}:${record.caseKey}`));
  assert.deepEqual(
    sorted(accepted.map((record) => `${record.exerciseId}:${record.caseKey}`)),
    expectedGroupKeys,
  );
  assert.ok(accepted.every((record) => record.met && record.terminal === 'completed'));
  const corrections = actual.records.filter((record) => record.correction);
  assert.equal(new Set(corrections.map((record) => record.exerciseId)).size, 32);
  assert.deepEqual(
    sorted(new Set(corrections.map((record) => record.exerciseId))),
    expectedExerciseIds,
  );
  for (const id of new Set(corrections.map((record) => record.exerciseId)))
    assert.ok(corrections.some((record) => record.exerciseId === id && !record.met));
  return { ...entry(path), groups: accepted.length, correctionExercises: 32 };
}
const courseExecution = checkCourseExecution(registration.evidence.course.path);
const currentCourseExecution = checkCourseExecution(`${folder}/course-wasm-execution.json`);
function checkUnit(path, freshness = lastSourceChange) {
  const unit = json(path);
  assert.equal(unit.success, true);
  for (const key of [
    'numFailedTests',
    'numPendingTests',
    'numFailedTestSuites',
    'numPendingTestSuites',
    'numTodoTests',
  ])
    assert.equal(unit[key], 0);
  assert.equal(unit.numPassedTests, unit.numTotalTests);
  assert.ok(unit.numPassedTests > 0 && unit.startTime >= freshness);
  const expected = walk('tests/unit').filter((path) => path.endsWith('.test.ts'));
  const normalized = (path) => resolve(path).toLowerCase();
  assert.deepEqual(
    sorted(unit.testResults.map((result) => normalized(result.name))),
    sorted(expected.map(normalized)),
  );
  for (const result of unit.testResults) {
    assert.equal(result.status, 'passed');
    assert.ok(unit.startTime >= statSync(result.name).mtimeMs, `Stale unit result: ${result.name}`);
    assert.ok(
      result.assertionResults.length > 0 &&
        result.assertionResults.every((item) => item.status === 'passed'),
    );
  }
  assert.equal(
    unit.testResults.reduce((sum, result) => sum + result.assertionResults.length, 0),
    unit.numPassedTests,
  );
  return {
    ...entry(path),
    passed: unit.numPassedTests,
    files: expected.length,
    startTime: unit.startTime,
  };
}
const unit = checkUnit(`${folder}/unit-receiver-chrome-final.json`, frozenSourceChange);
const registrationUnit = checkUnit(registration.evidence.frontend.path, frozenSourceChange);
assert.equal(registration.evidence.frontend.path, unit.path);

function browserRecords(suites, parents = []) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({
        spec,
        test,
        title: [basename(spec.file.replaceAll('\\', '/')), ...parents, spec.title].join(' / '),
      })),
    ),
    ...browserRecords(
      suite.suites ?? [],
      suite.title.endsWith('.spec.ts') ? parents : [...parents, suite.title],
    ),
  ]);
}
function checkBrowser(name, expectedCount, expectedFiles) {
  const path = `${folder}/${name}.json`,
    report = json(path);
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.expected, expectedCount);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
  assert.ok(report.config.projects.some((item) => item.name === 'chrome'));
  if (report.config.filteredProjects)
    assert.deepEqual(sorted(report.config.filteredProjects.map((item) => item.name)), projects);
  assert.ok(report.config.projects.every((item) => item.retries === 0));
  if (['receiver-temp', 'published-receiver'].includes(name))
    assert.equal(report.config.workers, 1);
  const started = Date.parse(report.stats.startTime);
  const sourceChange = name === 'published-receiver' ? lastSourceChange : frozenSourceChange;
  assert.ok(started >= sourceChange, `Browser report predates runtime sources: ${path}`);
  for (const file of expectedFiles) assert.ok(started >= statSync(`tests/browser/${file}`).mtimeMs);
  for (const path of [
    'tests/browser/case-set-observation.ts',
    'tests/browser/vertical-observation.ts',
  ])
    assert.ok(
      started >= statSync(path).mtimeMs,
      `Browser report predates its observation helper: ${path}`,
    );
  const rows = browserRecords(report.suites);
  assert.equal(rows.length, expectedCount);
  const identities = new Map(projects.map((project) => [project, []]));
  for (const { spec, test, title } of rows) {
    assert.ok(expectedFiles.includes(basename(spec.file.replaceAll('\\', '/'))));
    assert.equal(spec.ok, true);
    assert.equal(test.status, 'expected');
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].status, 'passed');
    assert.equal(test.results[0].retry, 0);
    assert.deepEqual(test.results[0].errors ?? [], []);
    assert.ok(identities.has(test.projectName));
    identities.get(test.projectName).push(title);
  }
  for (const titles of identities.values()) {
    unique(titles, `Duplicate browser scenario: ${name}`);
    assert.deepEqual(sorted(titles), sorted(identities.get('chrome')));
  }
  return {
    ...entry(path),
    passed: expectedCount,
    projects,
    retries: 0,
    startTime: report.stats.startTime,
  };
}
const legacyGates = [
  ['receiver-gate-blocks', 15, ['blocks.spec.ts', 'practice.spec.ts']],
  ['receiver-gate-navigation', 1, ['navigation.spec.ts']],
  ['receiver-gate-interaction', 5, ['block-interaction.spec.ts']],
  ['receiver-gate-experience', 5, ['practice-experience.spec.ts']],
  ['receiver-bidirectional-final', 13, ['bidirectional.spec.ts']],
  ['receiver-presentation-final', 17, ['editor-presentation.spec.ts']],
].map(([name, count, files]) => {
  assert.equal(registration.evidence[name]?.path, `${folder}/${name}.json`);
  return checkBrowser(name, count, files);
});
assert.equal(
  legacyGates.reduce((sum, report) => sum + report.passed, 0),
  56,
);
const temporary = checkBrowser('receiver-temp', 1, ['p05-course-temporary.spec.ts']);
const published = checkBrowser('published-receiver', 6, ['p05-course.spec.ts']);
const publishedModePath = `${folder}/published-receiver-controlled-run.json`;
const publishedMode = json(publishedModePath);
assert.equal(publishedMode.traceMode, 'off');
const publishedConfiguration = json(published.path).config;
assert.ok(publishedConfiguration.filteredProjects.every((project) => project.use.trace === 'off'));
const traceArgument = publishedConfiguration.argv.indexOf('--trace');
assert.ok(traceArgument >= 0);
assert.equal(publishedConfiguration.argv[traceArgument + 1], 'off');
assert.deepEqual(publishedMode.argv.slice(0, 2), ['node_modules/@playwright/test/cli.js', 'test']);
const selectedProject = publishedConfiguration.argv.indexOf('--project');
assert.ok(selectedProject >= 0);
assert.equal(publishedConfiguration.argv[selectedProject + 1], 'chrome');
assert.deepEqual(publishedMode.browserScope, ['chrome']);
assert.equal(publishedMode.exitCode, 0);
assert.equal(publishedMode.testSha256, sha('tests/browser/p05-course.spec.ts'));
assert.equal(registration.evidence.temporaryBrowsers.path, temporary.path);
assert.ok(Date.parse(json(published.path).stats.startTime) >= statSync(registrationPath).mtimeMs);
const temporaryRawFiles = [];
for (const project of projects) {
  const summaryPath = registration.evidence[`temporary-${project}`].path;
  const actual = json(summaryPath);
  assert.equal(actual.evidenceKind, 'preregistration-real-browser-execution-no-learning-authority');
  assert.equal(actual.subjects.length, 32);
  unique(actual.subjects.map((subject) => subject.exerciseId));
  assert.deepEqual(
    sorted(actual.subjects.map((subject) => subject.exerciseId)),
    expectedExerciseIds,
  );
  assert.equal(actual.groups.length, 140);
  assert.deepEqual(
    sorted(actual.groups.map((group) => `${group.exerciseId}:${group.caseKey}`)),
    expectedGroupKeys,
  );
  assert.ok(
    actual.groups.every(
      (group) =>
        group.terminal === 'completed' &&
        group.judge === 'met' &&
        group.fuel <= 1_000_000 &&
        group.remainingMs > 0 &&
        group.remainingMs <= 1000 &&
        group.blockMapCount > 0 &&
        group.blockMapCount === group.mappedRangesInRealAst,
    ),
  );
  assert.equal(actual.maximumBubble.caseKey, 'maximum');
  assert.ok(actual.maximumBubble.blockMapCount > 2);
  for (const archive of [actual.initial, actual.final]) {
    assert.equal(archive.version, 2);
    assert.equal(archive.names.length, 11);
    for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'])
      assert.deepEqual(archive.data[store], []);
  }
  assert.equal(actual.initial.data.meta.generation, actual.final.data.meta.generation);
  const files = walk(dirname(summaryPath).replaceAll('\\', '/')).map(entry);
  const byKind = Object.fromEntries(
    ['request', 'result', 'catalog'].map((kind) => [
      kind,
      new Set(
        files.filter((file) => file.path.endsWith(`.${kind}.json`)).map((file) => file.sha256),
      ),
    ]),
  );
  for (const group of actual.groups)
    for (const kind of ['request', 'result', 'catalog'])
      assert.ok(
        byKind[kind].has(group[`${kind}Sha256`]),
        `Missing original temporary ${project} ${kind} bytes.`,
      );
  temporaryRawFiles.push(...files);
}

const publishedArtifacts = [],
  publishedRawFiles = [];
const durableCollections = ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals', 'aliases'];
function checkPublishedArchive(archive) {
  assert.equal(archive.databaseVersion, 2);
  assert.deepEqual(sorted(archive.stores), [
    'aliases',
    'appearance',
    'appearanceAssets',
    'avatar',
    'dailyFacts',
    'goals',
    'ledger',
    'meta',
    'progress',
    'receipts',
    'settings',
  ]);
  assert.deepEqual(archive.data.meta.activePackageRef, { id: 'content.c.p05', version: '1.0.0' });
}
function sameSavedLearning(before, after) {
  for (const name of durableCollections) assert.deepEqual(after.data[name], before.data[name]);
  assert.equal(after.data.meta.generation, before.data.meta.generation);
  assert.equal(after.data.meta.timeZone, before.data.meta.timeZone);
}
function postedTotal(data, sourceId) {
  return data.ledger
    .filter((row) => !sourceId || row.sourceId === sourceId)
    .reduce((sum, row) => {
      assert.equal(row.status, 'posted');
      assert.ok(Number.isSafeInteger(row.points));
      return sum + BigInt(row.points);
    }, 0n);
}
function checkPublishedCases(evidence, rawDirectory) {
  assert.deepEqual(
    sorted(evidence.caseDirectoryIds),
    sorted(authoredCourse.cases.map((entry) => entry.id)),
  );
  assert.equal(evidence.caseRuns.length, 2);
  assert.deepEqual(
    evidence.caseRuns.map((run) => run.label),
    ['case-first', 'case-repeat'],
  );
  const first = evidence.caseOnce,
    refreshed = evidence.caseRefreshed,
    repeated = evidence.caseRepeated;
  for (const archive of [evidence.completed, first, refreshed, repeated])
    checkPublishedArchive(archive);
  assert.equal(postedTotal(evidence.completed.data), 965n);
  assert.equal(evidence.completed.data.ledger.length, 65);
  assert.equal(postedTotal(first.data), 970n);
  assert.equal(postedTotal(first.data, 'reward.case.first-view'), 5n);
  assert.equal(first.data.ledger.length, 66);
  sameSavedLearning(first, refreshed);
  assert.deepEqual(repeated.data.ledger, first.data.ledger);
  assert.deepEqual(repeated.data.dailyFacts, first.data.dailyFacts);
  assert.equal(postedTotal(repeated.data), 970n);
  const subject = authoredCourse.cases.find((entry) => entry.id === 'case.c.assignment');
  const subjectRef = { id: subject.id, version: subject.version };
  assert.deepEqual(subjectRef, { id: 'case.c.assignment', version: '1.1.0' });
  for (const archive of [first, repeated]) {
    const facts = archive.data.progress.filter((row) => row.eventType === 'case.view-confirmed');
    assert.equal(facts.length, 1);
    assert.deepEqual(facts[0].subjectRef, subjectRef);
    assert.deepEqual(facts[0].packageRef, { id: 'content.c.p05', version: '1.0.0' });
  }
  assert.equal(
    repeated.data.receipts.filter((row) => row.eventType === 'case.view-confirmed').length,
    2,
  );
  sameSavedLearning(evidence.repeated, evidence.caseRuns[0].before);
  sameSavedLearning(refreshed, evidence.caseRuns[1].before);
  for (const run of evidence.caseRuns) {
    checkPublishedArchive(run.before);
    checkPublishedArchive(run.beforeConfirm);
    sameSavedLearning(run.before, run.beforeConfirm);
    const paths = Object.fromEntries(
      ['request', 'result', 'catalog'].map((kind) => [
        kind,
        `${rawDirectory}/${run.label}.${kind}.json`,
      ]),
    );
    for (const kind of ['request', 'result', 'catalog'])
      proof({ path: paths[kind], sha256: run[`${kind}Sha256`] });
    const request = json(paths.request),
      result = json(paths.result),
      catalog = json(paths.catalog);
    assert.deepEqual(request.packageRef, { id: 'content.c.p05', version: '1.0.0' });
    assert.deepEqual(request.subjectRef, subjectRef);
    assert.deepEqual(request.programRef, subject.programRef);
    assert.equal(request.mode, 'case');
    assert.equal(request.judge, null);
    assert.deepEqual(request.input.values, { x: -7 });
    assert.equal(request.input.random, null);
    assert.deepEqual(request.budgetRef, { id: 'budget.p0', version: '1.0.0' });
    assert.ok(request.remainingMs > 0 && request.remainingMs <= 1000);
    for (const key of [
      'protocolVersion',
      'traceVersion',
      'diagnosticVersion',
      'judgeVersion',
      'encodingVersion',
    ]) {
      assert.equal(request[key], '1.0.0');
      assert.equal(result[key], '1.0.0');
    }
    assert.deepEqual(run.packageRef, request.packageRef);
    assert.deepEqual(run.subjectRef, request.subjectRef);
    assert.equal(run.mode, request.mode);
    assert.deepEqual(run.identity, request.identity);
    assert.deepEqual(catalog.packageRef, request.packageRef);
    assert.deepEqual(
      { id: catalog.subject.id, version: catalog.subject.version },
      request.subjectRef,
    );
    assert.deepEqual(result.identity, request.identity);
    assert.deepEqual(result.engineRef, request.engineRef);
    assert.equal(result.engineRef.buildId, registration.engine.wasmSha256);
    assert.equal(result.producer, 'rust');
    assert.equal(result.terminal.status, 'completed');
    assert.equal(result.terminal.exitCode, 0);
    assert.deepEqual(result.terminal.diagnostics, []);
    assert.equal(result.trace.completeness, 'complete');
    assert.ok(Number.isInteger(run.steps) && run.steps > 0);
    assert.equal(result.trace.steps.length, run.steps);
    assert.deepEqual(
      run.viewedCursors,
      Array.from({ length: run.steps + 1 }, (_, cursor) => cursor),
    );
    assert.deepEqual(run.coverageBeforeConfirm, { covered: run.steps, total: run.steps });
    const stdout = result.trace.steps
      .flatMap((step) =>
        step.changes.filter((change) => change.op === 'output').map((change) => change.append),
      )
      .join('');
    assert.equal(stdout, '-5\n');
    assert.equal(run.stdout, stdout);
  }
  assert.notEqual(evidence.caseRuns[0].identity.runId, evidence.caseRuns[1].identity.runId);
}
const publishedKinds = [
  ['fresh-32', 'complete-evidence', 'real-native-ui-learning'],
  ['real-six-upgrade', 'upgrade-evidence', 'real-old-application-then-new-release'],
  ['quota-goal-bounds', 'quota-and-goal-evidence', 'real-execution-with-native-IDB-fault'],
  ['tabs-package-and-clear', 'multi-tab-evidence', 'real-old-run-new-package-CAS-and-native-clear'],
  [
    'partial-old-and-pending',
    'partial-upgrade-evidence',
    'real-old-actions-and-native-uncommitted-pass-fault',
  ],
  [
    'native-damaged-and-foreign',
    'native-corruption-evidence',
    'native-fault-injection-after-real-earned-legacy-pass-no-synthetic-success',
  ],
];
for (const project of projects)
  for (const [directory, name, kind] of publishedKinds) {
    const rawDirectory = `${folder}/browser/published-receiver/${project}/${directory}`;
    const path = `${rawDirectory}/${name}.json`,
      record = json(path);
    assert.deepEqual(record.clock, {
      date: '2026-10-27T04:00:00.000Z',
      dateControlled: true,
      monotonicDeadline: 'real',
    });
    assert.equal(record.evidence.kind, kind);
    if (name === 'complete-evidence') {
      assert.equal(record.evidence.groups, 140);
      assert.equal(record.evidence.runs.length, 140);
      assert.equal(record.evidence.repeatSubmissions, 1);
      checkPublishedCases(record.evidence, rawDirectory);
    }
    if (name === 'upgrade-evidence') {
      assert.equal(record.evidence.oldGroups, 24);
      assert.equal(record.evidence.runs.length, 24);
      assert.equal(record.evidence.compatibleCompletedLessons, 6);
      assert.equal(record.evidence.currentLessonCount, 32);
    }
    const files = walk(rawDirectory).map(entry);
    const byKind = Object.fromEntries(
      ['request', 'result', 'catalog'].map((kind) => [
        kind,
        new Set(
          files.filter((file) => file.path.endsWith(`.${kind}.json`)).map((file) => file.sha256),
        ),
      ]),
    );
    function checkRunHashes(value) {
      if (!value || typeof value !== 'object') return;
      if ('requestSha256' in value && 'resultSha256' in value && 'catalogSha256' in value) {
        for (const kind of ['request', 'result', 'catalog'])
          assert.ok(
            byKind[kind].has(value[`${kind}Sha256`]),
            `Missing original ${kind} bytes in ${rawDirectory}`,
          );
        if ('remainingMs' in value) assert.ok(value.remainingMs > 0 && value.remainingMs <= 1000);
      }
      for (const child of Object.values(value)) checkRunHashes(child);
    }
    checkRunHashes(record.evidence);
    publishedRawFiles.push(...files);
    publishedArtifacts.push(entry(path));
  }
const publishedSpec = read('tests/browser/p05-course.spec.ts').toString('utf8');
assert.match(publishedSpec, /page\.clock\.setFixedTime\(fixedDate\)/);
assert.ok(!/\.clock\.(?:install|pauseAt|fastForward|runFor)\s*\(/.test(publishedSpec));
assert.ok(!/\.clock\./.test(read('scripts/p05-09-visual.mjs').toString('utf8')));

const manifestPath = 'web/public/content/course/manifest.json',
  manifest = json(manifestPath);
assert.equal(manifest.enabled, true);
assert.equal(manifest.registered, true);
assert.equal(manifest.file, 'content/course/course-bundle-1.0.0.json');
assert.equal(manifest.sourceSha256, sha('content/c/p05/course-1.0.0.json'));
const bundlePath = `web/public/${manifest.file}`,
  bundle = json(bundlePath);
proof({ path: bundlePath, sha256: manifest.sha256, bytes: manifest.bytes });
proof({ path: `web/dist/${manifest.file}`, sha256: manifest.sha256, bytes: manifest.bytes });
assert.equal(bundle.registered, true);
assert.equal(bundle.bundleVersion, '1.0.0');
assert.equal(bundle.sourceSha256, manifest.sourceSha256);
assert.deepEqual(bundle.reading.packageRef, { id: 'content.c.p05', version: '1.0.0' });
assert.equal(bundle.reading.chapters.length, 8);
assert.equal(bundle.reading.lessons.length, 32);
assert.equal(bundle.practice.exercises.length, 32);
assert.equal(
  bundle.practice.exercises.reduce((sum, exercise) => sum + exercise.tests.length, 0),
  140,
);
assert.equal(bundle.cases.length, 7);
assert.equal(bundle.guidance.length, 32);
assert.equal(bundle.learning.purpose, 'course-practice');
assert.deepEqual(bundle.learning, { ...bundle.reading.catalog, purpose: 'course-practice' });
const projections = Object.fromEntries(
  Object.entries(manifest.projections).map(([name, value]) => [
    name,
    proof({ path: `web/public/${value.file}`, ...value }),
  ]),
);
assert.deepEqual(sorted(Object.keys(projections)), ['cases', 'learning', 'practice', 'reading']);
assert.equal(projections.reading.path, 'web/public/content/reading/course-reading-1.1.0.json');
assert.equal(projections.practice.path, 'web/public/content/practice/course-practice-1.1.0.json');
assert.equal(projections.cases.path, 'web/public/content/case-view/case-view-1.1.0.json');
assert.equal(projections.learning.path, 'web/public/content/learning/course-learning-1.0.16.json');
assert.deepEqual(json(projections.reading.path), bundle.reading);
assert.deepEqual(json(projections.practice.path), bundle.practice);
assert.deepEqual(json(projections.cases.path).catalogs, bundle.cases);
const learning = json(projections.learning.path);
assert.deepEqual(learning.catalog, bundle.learning);
assert.equal(learning.readingSha256, projections.reading.sha256);
assert.equal(learning.practiceSha256, projections.practice.sha256);
assert.equal(
  learning.blocksBuildSha256,
  createHash('sha256').update(JSON.stringify(registration.files)).digest('hex'),
);

// A focused Chrome runtime report replaces the former optional visual matrix.
const runtimePath = `${folder}/chrome-runtime-final.json`,
  runtime = json(runtimePath);
assert.equal(runtime.task, 'P0.5-09');
assert.equal(runtime.status, 'passed');
assert.equal(runtime.browser, 'chrome');
assert.deepEqual(runtime.pageErrors, []);
assert.equal(runtime.registration.path, registrationPath);
proof(runtime.registration);
assert.equal(runtime.buildIndex.path, '.artifacts/artifact-hashes.json');
proof(runtime.buildIndex);
for (const name of [
  'registeredCourse',
  'storageReady',
  'saveSurvivesReload',
  'bubbleVisualization',
  'selectionVisualization',
])
  assert.equal(runtime.checks[name], true, `Chrome runtime check missing: ${name}`);
for (const screenshot of runtime.screenshots ?? []) proof(screenshot);
// Older broad visual/Inspector reports, if present, are retained without being
// promoted to current acceptance or imposing a fresh matrix on this task.
const optionalVisualReports = [
  `${folder}/visual-published/report.json`,
  `${folder}/visual-published/source-index.json`,
  `${folder}/inspector/report.json`,
]
  .filter(existsSync)
  .map(entry);
const startupPath = `${folder}/startup-final.json`,
  startup = json(startupPath);
assert.equal(startup.ownedProcessesStopped, true);
assert.deepEqual(
  startup.records.map((record) => record.mode),
  ['dev', 'preview'],
);
for (const record of startup.records) {
  assert.equal(record.contentReady, true);
  assert.equal(record.practiceReady, true);
  assert.deepEqual(record.pageErrors, []);
}
const staticPath = `${folder}/static-receiver-final.json`,
  checks = json(staticPath).checks;
assert.deepEqual(sorted(checks.map((check) => check.name)), [
  'build',
  'format:check',
  'lint',
  'typecheck',
]);
for (const check of checks) {
  assert.equal(check.exitCode, 0);
  assert.ok(check.path.startsWith(`${folder}/`));
  proof(check);
}
assert.equal(
  checks.find((check) => check.name === 'build').path,
  `${folder}/build-receiver-final.log`,
);
const changeCard = json(documents[0]);
assert.equal(changeCard.status, 'accepted');
assert.equal(changeCard.runtimeApproved, true);
assert.equal(changeCard.approvals.length, 11);
unique(changeCard.approvals.map((approval) => approval.role));
assert.ok(
  changeCard.approvals.every(
    (approval) => approval.decision === 'accepted' && existsSync(approval.evidence),
  ),
);
const fixtureIndex = json('项目文档/验收/P0.5-09-夹具索引.json');
assert.equal(fixtureIndex.task, 'P0.5-09');
assert.equal(fixtureIndex.status, 'accepted');
assert.ok(fixtureIndex.entries.length >= 4);
unique(fixtureIndex.entries.map((fixture) => fixture.id));
for (const fixture of fixtureIndex.entries)
  for (const path of fixture.sources) assert.ok(existsSync(path));
const documentProofs = [...centralDocuments, ...documents].map(entry);

// Keep failed attempts and their raw directories addressable; they are not green evidence.
const finalReports = new Set([
  output,
  baselinePath,
  `${folder}/unit-receiver-chrome-final.json`,
  runtimePath,
  ...legacyGates.map((report) => report.path),
  temporary.path,
  published.path,
  staticPath,
  startupPath,
  ...Object.values(registeredProofs).map((item) => item.path),
]);
const earlierReports = [],
  failedRounds = [],
  historicalLogs = [];
const directoriesFor = (label) =>
  [`${folder}/${label}-output`, `${folder}/browser/${label}`].filter(existsSync);
for (const name of readdirSync(folder).sort()) {
  const path = `${folder}/${name}`;
  if (!statSync(path).isFile()) continue;
  if (name.endsWith('.log')) historicalLogs.push(entry(path));
  if (!name.endsWith('.json') || finalReports.has(path)) continue;
  let report;
  try {
    report = json(path);
  } catch {
    earlierReports.push({ ...entry(path), parseable: false });
    continue;
  }
  earlierReports.push(entry(path));
  const failed =
    report.success === false ||
    report.status === 'failed' ||
    report.numFailedTests > 0 ||
    report.numFailedTestSuites > 0 ||
    report.stats?.unexpected > 0 ||
    report.errors?.length > 0 ||
    report.exitCode > 0;
  if (failed) {
    const label = name.slice(0, -5);
    const paths = new Set([
      path,
      ...[`${folder}/${label}.log`, `${folder}/${label}-exit.json`].filter(existsSync),
      ...directoriesFor(label).flatMap(walk),
    ]);
    failedRounds.push({
      label,
      verdict: 'failed-or-incomplete-original-round',
      files: sorted(paths).map(entry),
    });
  }
}
const priorDirectories = readdirSync(folder, { withFileTypes: true })
  .filter(
    (item) =>
      item.isDirectory() && !['browser', 'visual-published', 'inspector'].includes(item.name),
  )
  .map((item) => `${folder}/${item.name}`);
if (existsSync(`${folder}/browser`))
  for (const item of readdirSync(`${folder}/browser`, { withFileTypes: true }))
    if (item.isDirectory() && !['receiver-temp', 'published-receiver'].includes(item.name))
      priorDirectories.push(`${folder}/browser/${item.name}`);
const retainedDirectories = sorted(priorDirectories).map((path) => ({
  path,
  files: walk(path).map(entry),
}));

// Check the registered source bytes once more immediately before writing the derived index.
registration.files.forEach(proof);
const result = {
  task: 'P0.5-09',
  status: 'accepted',
  createdAtUtc: new Date().toISOString(),
  scope: {
    chapters: 8,
    lessons: 32,
    exercises: 32,
    groups: 140,
    cases: 7,
    originalExercises: 6,
    originalGroups: 24,
    registrationSources: reviewedP05Paths.length,
  },
  baseline: {
    ...entry(baselinePath),
    total: 1181,
    unchanged,
    changed,
    externalChanges,
    added: sorted(added).map(entry),
    externalAdded: sorted(externalAdded).map(entry),
    authorizedChanges: sorted(allowedChanges),
    authorizedNewFiles: sorted(newFiles),
  },
  immutablePredecessors: predecessors.map(proof),
  predecessorMap: entry(predecessorPath),
  registration: {
    ...entry(registrationPath),
    proofs: registeredProofs,
    engine: registration.engine,
    sourceFreshness: frozenFreshness,
  },
  supersededRegistration: {
    ...entry(priorRegistrationPath),
    version: supersededRegistration.releaseVersion,
    sourceSnapshot: supersededRegistration.files,
    proofs: supersededProofs,
    status:
      'immutable-historical-release; source hashes are not asserted against successor runtime',
    originalRegistrar: entry('scripts/register-blockly-p05-09-successor.mjs'),
  },
  initialCourseRegistration: {
    ...entry(initialRegistrationPath),
    version: initialRegistration.releaseVersion,
    sourceSnapshot: initialRegistration.files,
    proofs: initialProofs,
    status: 'immutable-historical-release; source hashes are not asserted against receiver runtime',
    originalRegistrar: entry('scripts/register-blockly-p05-09.mjs'),
  },
  rust: { ...entry(registration.evidence.rust.path), passed: rust.passed, failed: 0, ignored: 1 },
  courseExecution,
  currentCourseExecution,
  frontend: unit,
  registrationFrontend: registrationUnit,
  browsers: {
    legacyGates,
    temporary,
    temporaryRawFiles,
    published,
    publishedRecordingMode: entry(publishedModePath),
    gateExecutions: 56,
    temporaryExecutions: 1,
    publishedExecutions: 6,
    scopeAuthority: '2026-10-29 user instruction: Chrome only; necessary checks prioritized',
    publishedArtifacts,
    publishedRawFiles,
  },
  course: { manifest: entry(manifestPath), bundle: entry(bundlePath), projections },
  chromeRuntime: {
    ...entry(runtimePath),
    checks: runtime.checks,
    screenshots: runtime.screenshots ?? [],
  },
  optionalVisualReports: {
    status: 'optional-retained-not-required-for-current-acceptance',
    reports: optionalVisualReports,
  },
  startup: entry(startupPath),
  staticChecks: {
    ...entry(staticPath),
    checks: checks.map((check) => ({
      name: check.name,
      exitCode: check.exitCode,
      ...proof(check),
    })),
  },
  documents: documentProofs,
  independentPolicyUpdate: {
    authority: externalPolicy.authority,
    originalHandoff: proof(externalPolicy.handoff),
    preservedAgents: proof(externalPolicy.agents),
    sharedRules: {
      ...entry(externalPolicy.sharedRules.path),
      ownership: 'P0.5 current-state header plus independently authored Git policy',
      normalizedNewlines: 'LF for section fingerprints; the complete current file is hashed above',
      policySectionSha256: externalPolicy.sharedRules.sectionSha256,
      coordinationRuleSha256: externalPolicy.sharedRules.coordinationRuleSha256,
    },
    excludedFromP05ImplementationCounts: true,
    evidenceToolGitOperations:
      'Read-only git ls-files inventory; no staging, commit, push or remote access',
  },
  evidenceTool: entry('scripts/p05-09-evidence.mjs'),
  retainedAttempts: {
    failedRounds,
    earlierReports,
    historicalLogs,
    directories: retainedDirectories,
    excludedReproducibleDirectories: {
      paths: sorted(excludedReproducibleDirectories),
      reason:
        'Regenerable compiler/browser caches are retained on disk but are not recursively hashed; original reports, logs, request/result packets and failure evidence remain indexed.',
      deleted: false,
    },
  },
  boundaries: {
    clock: {
      scope: 'published P0.5-09 learning scenarios only',
      date: '2026-10-27T04:00:00.000Z',
      dateControlled: true,
      performanceClock: 'real',
      monotonicExecutionDeadline: 'real',
      source: entry('tests/browser/p05-course.spec.ts'),
    },
    performance:
      'Current P0.5-09 fixed groups, real AST maps, normal budgets and browser submissions only; no complete historical performance-matrix rerun is claimed.',
    history:
      'Earlier failed and incomplete reports remain separate, with their original bytes hashed. Development request replays and overridden-budget probes are not acceptance evidence.',
    browser:
      'Current acceptance is Chrome only by explicit user instruction on 2026-10-29. Earlier Edge/Firefox failures remain historical; no fresh Edge, Firefox, physical DPI, touch or screen-reader acceptance is claimed.',
    authority:
      'Temporary execution and visual preview do not create learning facts. Published ordinary native UI submissions supply learning acceptance.',
  },
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(
  `P0.5-09 accepted evidence: 1181 baseline files retained; ${changed.length} task changes and ${externalChanges.length} independent policy changes; ${added.length} task files and ${externalAdded.length} independent policy files added; ${unit.passed} frontend checks; 56 + 1 + 6 Chrome browser checks; focused sorting/save/reload runtime acceptance.`,
);
