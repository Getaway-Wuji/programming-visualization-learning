// Immutable successor: authenticate final sources and the actual acceptance reports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { reconstructionPaths } from './reconstruction-release-inputs.mjs';
const folder = '.artifacts/13.5';
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
const priorPath = 'content/c/p0/blockly-release-1.0.19.json';
const prior = json(priorPath);
assert.equal(new Set(reconstructionPaths).size, reconstructionPaths.length);
for (const entry of Object.values(prior.evidence)) assert.equal(sha(entry.path), entry.sha256);
assert.equal(sha('web/src/generated/c_viz_wasm_bg.wasm'), prior.engine.wasmSha256);
const changed = reconstructionPaths.filter(
  (path) => prior.files.find((entry) => entry.path === path)?.sha256 !== sha(path),
);
const newest = Math.max(...changed.map((path) => statSync(path).mtimeMs));
const cases = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(suite.suites ?? []),
  ]);
const evidence = {};
const oldFiles = [
  'blocks.spec.ts',
  'practice.spec.ts',
  'block-interaction.spec.ts',
  'practice-experience.spec.ts',
  'bidirectional.spec.ts',
  'editor-presentation.spec.ts',
  'navigation.spec.ts',
];
const key = (spec) => `${basename(spec.file.replaceAll('\\', '/'))}: ${spec.title}`;
const expectedLegacy = cases(json('.artifacts/13.4/legacy-guard-final.json').suites)
  .filter(({ spec }) => oldFiles.includes(basename(spec.file.replaceAll('\\', '/'))))
  .map(({ spec }) => key(spec))
  .sort();
for (const [label, count] of [
  ['legacy-final', expectedLegacy.length],
  ['candidate-final', 8],
  ['13-5-course-confirm', 1],
]) {
  const path = `${folder}/${label}.json`,
    report = json(path);
  assert.deepEqual(report.errors, []);
  for (const field of ['unexpected', 'flaky', 'skipped'])
    assert.equal(report.stats[field], 0, label);
  assert.equal(report.stats.expected, count);
  assert.ok(Date.parse(report.stats.startTime) >= newest, label + ' predates sources');
  assert.deepEqual(
    report.config.filteredProjects.map((project) => project.name),
    ['chrome'],
  );
  const actual = cases(report.suites);
  assert.equal(actual.length, count);
  for (const { spec, test } of actual) {
    assert.equal(spec.ok, true, spec.title);
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].status, 'passed');
    assert.equal(test.results[0].retry, 0);
    assert.ok(
      Date.parse(report.stats.startTime) >=
        statSync(`tests/browser/${basename(spec.file.replaceAll('\\', '/'))}`).mtimeMs,
    );
  }
  if (label === 'legacy-final')
    assert.deepEqual(actual.map(({ spec }) => key(spec)).sort(), expectedLegacy);
  evidence[label] = { ...proof(path), passed: count };
}
const unitPath = `${folder}/frontend-final.json`,
  unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.equal(unit.numPassedTests, unit.numTotalTests);
assert.ok(unit.numPassedTests >= 1430);
assert.ok(unit.startTime >= newest);
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`],
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
const actualPath =
  '.artifacts/P0.5-09/browser/13-5-course-confirm/chrome/temporary-32/temporary-course-evidence.json';
const actual = json(actualPath);
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
const copied = `${folder}/candidate-execution.json`;
writeFileSync(copied, read(actualPath), { flag: 'wx' });
evidence.actualExecution = { ...proof(copied), groups: 140, exercises: 32 };
// Failed attempts are retained and never counted as accepted scenarios.
for (const label of [
  'candidate-first',
  'candidate-second',
  'unit-first',
  'unit-second',
  '13-5-course-final',
]) {
  const path = `${folder}/${label}.json`;
  evidence[label] = { ...proof(path), accepted: false };
}
const target = 'content/c/p0/blockly-release-1.0.20.json';
assert.equal(existsSync(target), false);
save(target, {
  ...prior,
  releaseVersion: '1.0.20',
  registeredAt: '2026-10-30',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.19', ...proof(priorPath) },
  scope:
    '13.5 six configured C-to-block reconstruction exercises using existing exercise rights, 24 original test groups, current permissions and isolated EDIT-HISTORY 1.1 records; unchanged Rust, SAVE3 and execution budgets',
  reason:
    'Read-only reference C is separate from an initially empty native answer. Actual Rust validates the reference and two correct structures for each of six exercises. Native browser construction, wrong answers, mode-local draft/history restoration and read-only source controls pass; old editor behavior and 32/140 original course execution remain covered. Final registered learning/retry/dedup checks follow on the authorized assembly.',
  supplementalReason:
    'All predecessor content, registrations and evidence remain immutable. No new exercise entitlement or duplicated first-pass reward is created by switching answer mode. The original 32-lesson course remains unchanged.',
  files: reconstructionPaths.map(proof),
  evidenceFreshness: { lastSourceModifiedAtUtc: new Date(newest).toISOString() },
  evidence,
});
const archive = '项目文档/验收/发布凭据/13.5-1.0.20';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((entry) => {
  const file = basename(entry.path);
  writeFileSync(`${archive}/${file}`, read(entry.path), { flag: 'wx' });
  return { ...entry, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  `Registered 1.0.20: ${reconstructionPaths.length} sources, ${unit.numPassedTests} frontend checks, ${expectedLegacy.length} legacy scenarios and 32/140 real executions.`,
);
