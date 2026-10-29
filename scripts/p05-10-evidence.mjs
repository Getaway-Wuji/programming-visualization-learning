// Derive phase acceptance from existing real evidence. Never runs tests or Git mutations.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const folder = '.artifacts/P0.5-10';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (path) => createHash('sha256').update(read(path)).digest('hex');
const proof = (path) => ({ path, sha256: sha(path), bytes: statSync(path).size });
const verified = (entry) => {
  assert.equal(sha(entry.path), entry.sha256, `Evidence changed: ${entry.path}`);
  return proof(entry.path);
};
const output = `${folder}/evidence-${process.argv[2] === 'acceptance' ? 'acceptance' : 'final'}.json`;
assert.ok(!existsSync(output), 'Keep the existing final index immutable.');
const priorPath = '.artifacts/P0.5-09/evidence-final.json';
const prior = json(priorPath);
assert.equal(prior.status, 'accepted');
const registration = json(prior.registration.path);
assert.equal(registration.releaseVersion, '1.0.16');
assert.equal(registration.files.length, 75);
registration.files.forEach(verified);
const rust = json(registration.evidence.rust.path);
assert.equal(rust.passed, 453);
assert.equal(rust.failed, 0);
assert.equal(rust.ignored, 1);
rust.sourceFiles.forEach(verified);
Object.values(registration.evidence).forEach(verified);
const courseManifest = json('web/public/content/course/manifest.json');
assert.equal(courseManifest.registered, true);
assert.equal(sha(`web/public/${courseManifest.file}`), courseManifest.sha256);
const runtime = json('.artifacts/P0.5-09/chrome-runtime-final.json');
assert.ok(Object.values(runtime.checks).every((value) => value === true));
verified(runtime.registration);
verified(runtime.buildIndex);
const rows = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...rows(suite.suites ?? []),
  ]);
const browserPath = `${folder}/browser-final2.json`;
const browser = json(browserPath);
assert.equal(browser.status, 'passed');
assert.deepEqual(browser.browserScope, ['chrome']);
browser.registeredBuild.forEach(verified);
const scenarios = [];
const attachments = new Map();
for (const item of browser.reports) {
  verified(item);
  const report = json(item.path);
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.expected, item.scenarios);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
  assert.equal(report.config.workers, 1);
  assert.deepEqual(
    report.config.filteredProjects.map((project) => project.name),
    ['chrome'],
  );
  const metadata = json(item.metadata);
  assert.equal(metadata.exitCode, 0);
  assert.equal(metadata.traceMode, 'off');
  verified(metadata.testSource);
  for (const { spec, test } of rows(report.suites)) {
    assert.equal(test.projectName, 'chrome');
    assert.equal(spec.ok, true);
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].status, 'passed');
    assert.equal(test.results[0].retry, 0);
    scenarios.push({ file: spec.file, title: spec.title, project: test.projectName });
    for (const attachment of test.results[0].attachments ?? []) {
      if (attachment.path) attachments.set(attachment.path, proof(attachment.path));
    }
  }
}
assert.equal(scenarios.length, browser.scenarios);
const cleanPath = `${folder}/clean-source-build.json`;
const clean = json(cleanPath);
assert.equal(clean.exitCode, 0);
assert.equal(clean.restoredEvidence, true);
assert.equal(clean.wasm, registration.engine.wasmSha256);
const guardsPath = `${folder}/restore-guards.json`;
const guards = json(guardsPath);
assert.equal(guards.status, 'passed');
assert.equal(guards.scriptSha256, sha('scripts/restore-release-evidence.mjs'));
assert.equal(guards.results.length, 2);
assert.ok(
  guards.results.every(
    (result) => result.rejected && result.invalidBytesPreserved && result.noOtherProofsWritten,
  ),
);
const staticPath = `${folder}/static-final.json`;
const checks = json(staticPath).checks;
assert.deepEqual(checks.map((check) => check.name).sort(), ['format:check', 'lint', 'typecheck']);
checks.forEach((check) => {
  assert.equal(check.exitCode, 0);
  verified(check);
});
const archive = '项目文档/验收/发布凭据/P0.5-1.0.16';
const archiveIndex = json(`${archive}/index.json`);
verified(archiveIndex.registration);
assert.equal(archiveIndex.files.length, 12);
const archivedProofs = archiveIndex.files.map((entry) => {
  const path = `${archive}/${entry.file}`;
  assert.equal(sha(path), entry.sha256);
  return proof(path);
});
const documents = [
  '项目文档/验收/P0.5-10-需求与证据矩阵.md',
  '项目文档/验收/P0.5-10-整体验收与交付.md',
  '项目文档/交接/P0.5-10-整体交付交接.md',
  '项目文档/交付/P0.5-10-阶段交付说明.md',
  '项目文档/架构决策/P0.5-10-总验收与交付范围.md',
];
const matrix = read(documents[0]).toString('utf8');
const ids = [...matrix.matchAll(/^\| REQ-P05-(\d{2})(?: [^|]*)? \|/gm)].map((match) => match[1]);
assert.equal(ids.length, 17);
assert.equal(new Set(ids).size, 17);
assert.ok(/16[条项]有效/.test(matrix) && /P0\.5-10[^。\n]{0,50}已验收/.test(matrix));
const baselinePath = `${folder}/baseline.json`;
const baseline = json(baselinePath);
const changed = [];
for (const entry of baseline.files) {
  assert.ok(existsSync(entry.path), `Baseline deletion: ${entry.path}`);
  if (sha(entry.path) !== entry.sha256) changed.push(proof(entry.path));
}
const allowedChanges = new Set([
  '.gitignore',
  'scripts/build.mjs',
  'README.md',
  '项目守则.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/任务进度与交接.md',
  '项目文档/任务包/P0.5-体验改进与基础教学补强.md',
  '项目文档/P0.5-体验改进需求与实施方案.md',
  '项目文档/开发路线与依赖.md',
  '项目文档/任务包/README.md',
]);
for (const entry of changed)
  assert.ok(allowedChanges.has(entry.path), `Unowned change: ${entry.path}`);
for (const path of ['README.md', '项目守则.md', '项目文档/任务进度与交接.md'])
  assert.ok(read(path).toString('utf8').includes('9/9'));
const record = {
  task: 'P0.5-10',
  status: 'accepted',
  createdAt: new Date().toISOString(),
  scope: {
    activeRequirements: 16,
    cancelledRequirements: ['REQ-P05-04'],
    phaseTasks: '9/9',
    originalTasks: '43/88',
    browser: 'chrome',
    registration: '1.0.16',
  },
  baseline: { ...proof(baselinePath), total: baseline.files.length, deletions: [], changed },
  prerequisites: {
    ...proof(priorPath),
    reusedCurrentSources: registration.files.map(verified),
    rustSources: rust.sourceFiles.map(verified),
  },
  registration: proof(prior.registration.path),
  browser: {
    ...proof(browserPath),
    scenarios,
    reports: browser.reports,
    attachments: [...attachments.values()],
    reusedPointerEvidence: proof('.artifacts/P0.5-09/receiver-gate-interaction.json'),
  },
  course: {
    ...proof('web/public/content/course/manifest.json'),
    registered: true,
    chapters: 8,
    lessons: 32,
    exercises: 32,
    testGroups: 140,
    cases: 7,
  },
  cleanBuild: {
    ...proof(cleanPath),
    log: proof(`${folder}/clean-source-build.log`),
    limitation:
      'Clean source and missing-evidence build; installed dependencies, fixed tools and build cache are shared. Not a blank-machine installation test.',
  },
  releaseArchive: {
    ...proof(`${archive}/index.json`),
    files: archivedProofs,
    guards: proof(guardsPath),
  },
  static: { ...proof(staticPath), checks },
  documents: documents.map(proof),
  delivery: existsSync(`${folder}/git-delivery.json`)
    ? { stage: 'pushed-and-verified', proof: proof(`${folder}/git-delivery.json`) }
    : {
        stage: 'acceptance-complete-awaiting-reviewed-git-delivery',
        postPushProof: `${folder}/git-delivery.json`,
      },
  boundaries: {
    browser: 'Chrome only by user instruction; no current Edge/Firefox acceptance.',
    performance:
      'Normal production budgets retained; no repeat of historical full performance matrix.',
    history:
      'Failed final-pointer old-ID precondition remains retained; same-source genuine pointer evidence reused, with current-course blocks checked separately.',
    next: 'P1 task prerequisites open; no P1 task claimed.',
  },
  tool: proof('scripts/p05-10-evidence.mjs'),
};
assert.ok(resolve(output).startsWith(resolve(folder)));
writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(
  `P0.5-10 accepted: 16 effective requirements, ${browser.scenarios} current Chrome scenarios, 75 unchanged runtime sources, clean build passed.`,
);
