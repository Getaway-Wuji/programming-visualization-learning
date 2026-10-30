// Append a permission release only after current source passes actual Rust/UI gates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { blockPermissionPaths } from './block-permission-release-inputs.mjs';
const folder = '.artifacts/13.3';
const candidateLabel = process.argv[2] ?? 'candidate-final-4';
const version = process.argv[3] ?? '1.0.17';
assert.ok(['1.0.17', '1.0.18'].includes(version));
const isSuccessor = version === '1.0.18';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (path) => createHash('sha256').update(read(path)).digest('hex');
const proof = (path) => ({ path, sha256: sha(path) });
const save = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const priorVersion = isSuccessor ? '1.0.17' : '1.0.16';
const priorPath = `content/c/p0/blockly-release-${priorVersion}.json`;
const prior = json(priorPath);
assert.equal(prior.releaseVersion, priorVersion);
assert.equal(prior.files.length, isSuccessor ? 82 : 75);
for (const value of Object.values(prior.evidence)) assert.equal(sha(value.path), value.sha256);
assert.equal(sha('web/src/generated/c_viz_wasm_bg.wasm'), prior.engine.wasmSha256);
const newest = Math.max(...blockPermissionPaths.map((path) => statSync(path).mtimeMs));
const evidence = {};
const cases = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(suite.suites ?? []),
  ]);
const covered = new Set();
const recovered = new Set();
for (const [label, count, files] of [
  [candidateLabel, 2, ['p05-course-temporary.spec.ts', 'block-permissions.spec.ts']],
  [
    isSuccessor ? 'legacy18-final' : 'legacy-gates-final',
    55,
    [
      'blocks.spec.ts',
      'practice.spec.ts',
      'block-interaction.spec.ts',
      'practice-experience.spec.ts',
      'bidirectional.spec.ts',
      'editor-presentation.spec.ts',
    ],
  ],
  ...(isSuccessor
    ? [['legacy18-recovery', 2, ['editor-presentation.spec.ts', 'navigation.spec.ts']]]
    : [['legacy-recovery-final', 2, ['editor-presentation.spec.ts', 'navigation.spec.ts']]]),
]) {
  const path = `${folder}/${label}.json`,
    report = json(path);
  assert.deepEqual(report.errors, []);
  const priorFailure = ['legacy-gates-final', 'legacy18-final'].includes(label) ? 1 : 0;
  assert.equal(report.stats.expected, count - priorFailure);
  assert.equal(report.stats.unexpected, priorFailure);
  for (const key of ['flaky', 'skipped']) assert.equal(report.stats[key], 0);
  assert.ok(Date.parse(report.stats.startTime) >= newest, `${label} predates current sources`);
  assert.deepEqual(
    report.config.filteredProjects.map((p) => p.name),
    ['chrome'],
  );
  assert.equal(cases(report.suites).length, count);
  for (const { spec, test } of cases(report.suites)) {
    assert.ok(files.includes(basename(spec.file.replaceAll('\\', '/'))));
    assert.ok(
      Date.parse(report.stats.startTime) >=
        statSync(`tests/browser/${basename(spec.file.replaceAll('\\', '/'))}`).mtimeMs,
    );
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].retry, 0);
    const key = `${basename(spec.file.replaceAll('\\', '/'))}: ${spec.title}`;
    if (test.results[0].status !== 'passed') {
      assert.ok(['legacy-gates-final', 'legacy18-final'].includes(label));
      assert.match(
        spec.title,
        isSuccessor
          ? /hidden-block code answer.*exercise.c.increment-at-index/
          : /native appearance quota and transaction abort/,
      );
      recovered.add(key);
    } else {
      assert.equal(spec.ok, true);
      if (label !== candidateLabel) covered.add(key);
    }
  }
  evidence[label] = { ...proof(path), passed: count - priorFailure, failed: priorFailure };
}
assert.equal(
  covered.size,
  56,
  'Every legacy case requires a current successful execution; failed rounds remain in evidence.',
);
assert.equal(recovered.size, 1);
for (const key of recovered)
  assert.ok(
    covered.has(key),
    'The initial appearance-save assertion must have a successful independent rerun.',
  );
const unitPath = `${folder}/${isSuccessor ? 'frontend18-final' : 'frontend-final'}.json`,
  unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.ok(unit.numPassedTests >= 1403);
assert.equal(unit.numPassedTests, unit.numTotalTests);
assert.ok(unit.startTime >= newest);
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${path}/${e.name}`) : [`${path}/${e.name}`],
  );
assert.deepEqual(
  unit.testResults.map((r) => resolve(r.name).toLowerCase()).sort(),
  walk('tests/unit')
    .filter((p) => p.endsWith('.test.ts'))
    .map((p) => resolve(p).toLowerCase())
    .sort(),
);
for (const result of unit.testResults) {
  assert.equal(result.status, 'passed');
  assert.ok(unit.startTime >= statSync(result.name).mtimeMs);
}
evidence.frontend = { ...proof(unitPath), passed: unit.numPassedTests };
const actualSource = `.artifacts/P0.5-09/browser/${candidateLabel}/chrome/temporary-32/temporary-course-evidence.json`;
const actual = json(actualSource);
assert.equal(actual.subjects.length, 32);
assert.equal(actual.groups.length, 140);
assert.ok(
  actual.groups.every(
    (r) =>
      r.terminal === 'completed' &&
      r.judge === 'met' &&
      r.fuel <= 1000000 &&
      r.remainingMs > 0 &&
      r.remainingMs <= 1000 &&
      r.blockMapCount === r.mappedRangesInRealAst &&
      r.blockMapCount > 0,
  ),
);
const actualPath = `${folder}/${isSuccessor ? candidateLabel : 'candidate-final'}-execution.json`;
writeFileSync(actualPath, read(actualSource), { flag: 'wx' });
evidence.actualExecution = { ...proof(actualPath), groups: 140, exercises: 32 };
const target = `content/c/p0/blockly-release-${version}.json`;
assert.equal(existsSync(target), false);
const registration = {
  ...prior,
  releaseVersion: version,
  registeredAt: '2026-10-30',
  supersedes: { version: priorVersion, ...proof(priorPath) },
  scope:
    '13.3 course block permissions; temporary current-lesson whitelist and permanent durable completion grants; exact historical-version grants; guarded native/keyboard/code execution; unchanged SAVE2, Rust and budgets',
  reason:
    'The 38 frozen lesson rules preserve six original and 32 current lesson identities. Durable lesson.completed rows serve as local unlock receipts without a duplicated store. Current-lesson blocks are temporarily usable; unsupported versions fail closed. Native toolbox and keyboard creation are disabled for locked kinds, while code drafts remain intact and the session blocks running/submitting locked IR or detached blocks. Advanced historical probes complete real prerequisite lessons in a peer page. Final-source 56 Chrome regression gates, fresh-lock controls, 32/140 real Rust executions and the complete frontend suite passed. Saved completion, quota and cross-tab checks follow on the registered assembly. No edit history or 13.5 work is included.',
  ...(isSuccessor
    ? {
        supplementalReason:
          'Final review fixes locked-block learning links to the exact active course package, including the original six-lesson fallback; the 1.0.17 registration and archive remain immutable.',
      }
    : {}),
  files: blockPermissionPaths.map((path) => proof(path)),
  evidenceFreshness: { lastSourceModifiedAtUtc: new Date(newest).toISOString() },
  evidence,
};
save(target, registration);
const archive = `项目文档/验收/发布凭据/13.3-${version}`;
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((value) => {
  const file = basename(value.path);
  writeFileSync(`${archive}/${file}`, read(value.path), { flag: 'wx' });
  return { ...value, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  `Registered ${version}: ${registration.files.length} sources, ${unit.numPassedTests} frontend checks, 56 Chrome regressions and 32/140 actual Rust answers.`,
);
