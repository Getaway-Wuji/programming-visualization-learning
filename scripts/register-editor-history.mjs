// Bind the successor to successful final-source behavior. Preserve all earlier registrations.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { editorHistoryPaths } from './editor-history-release-inputs.mjs';
const folder = '.artifacts/13.4';
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
assert.equal(new Set(editorHistoryPaths).size, editorHistoryPaths.length);
const priorPath = 'content/c/p0/blockly-release-1.0.18.json';
const prior = json(priorPath);
// Build regenerates byte-identical prepared sources. Their new timestamp is
// not a source change; all bytes remain bound below and to the predecessor.
const changedPaths = editorHistoryPaths.filter(
  (path) => prior.files.find((entry) => entry.path === path)?.sha256 !== sha(path),
);
const newest = Math.max(...changedPaths.map((path) => statSync(path).mtimeMs));
for (const value of Object.values(prior.evidence)) assert.equal(sha(value.path), value.sha256);
assert.equal(sha('web/src/generated/c_viz_wasm_bg.wasm'), prior.engine.wasmSha256);
const cases = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(suite.suites ?? []),
  ]);
const evidence = {};
for (const [label, count] of [
  ['legacy-guard-final', 91],
  ['history-guard-final', 5],
  ['candidate-code-final', 1],
]) {
  const path = folder + '/' + label + '.json',
    report = json(path);
  assert.deepEqual(report.errors, []);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
  assert.ok(Date.parse(report.stats.startTime) >= newest, label + ' predates source');
  assert.deepEqual(
    report.config.filteredProjects.map((p) => p.name),
    ['chrome'],
  );
  const actual = cases(report.suites);
  assert.equal(actual.length, count);
  assert.equal(report.stats.expected, count);
  for (const { spec, test } of actual) {
    assert.equal(spec.ok, true, spec.title);
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].retry, 0);
    assert.equal(test.results[0].status, 'passed');
    assert.ok(
      Date.parse(report.stats.startTime) >=
        statSync(`tests/browser/${basename(spec.file)}`).mtimeMs,
      spec.file + ' changed',
    );
  }
  evidence[label] = { ...proof(path), passed: count };
}
for (const label of [
  'candidate-course-final',
  'candidate-course-final2',
  'candidate-course-guard',
  'candidate-observation-final',
  'candidate-isolated-final',
  'legacy-final2',
]) {
  const path = folder + '/' + label + '.json';
  const report = json(path);
  evidence[label] = {
    ...proof(path),
    passed: report.stats.expected,
    failed: report.stats.unexpected,
  };
}
const unitPath = `${folder}/frontend-guard-final.json`,
  unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.ok(unit.numPassedTests >= 1422);
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
const actualSource =
  '.artifacts/P0.5-09/browser/candidate-code-final/chrome/temporary-32/temporary-course-evidence.json';
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
const actualPath = `${folder}/candidate-execution.json`;
writeFileSync(actualPath, read(actualSource), { flag: 'wx' });
evidence.actualExecution = { ...proof(actualPath), groups: 140, exercises: 32 };
const target = 'content/c/p0/blockly-release-1.0.19.json';
assert.equal(existsSync(target), false);
save(target, {
  ...prior,
  releaseVersion: '1.0.19',
  reviewedAtUtc: new Date().toISOString(),
  registeredAt: '2026-10-30',
  supersedes: { version: '1.0.18', ...proof(priorPath) },
  scope:
    '13.4 bounded persistent logical edit history and explicit restoration; SAVE3/physical3 with twelve stores and the eleven-store learning/appearance projection; unchanged Rust and execution budgets',
  reason:
    'Every logical source/block edit and completed layout drag captures exact source, full native Blockly draft and advisory validity. Count/byte eviction is atomic. Analysis updates one stable history identity. Explicit restore invalidates execution and obtains fresh Rust authority and current permissions. Native DB2 migration, corruption isolation, two writers, quota/abort, retry and clear barriers pass along with actual 32/140 course execution and original editing/storage regressions.',
  supplementalReason:
    'The predecessor registrations, schemas and evidence remain immutable. No 13.5 exercise content is included.',
  files: editorHistoryPaths.map(proof),
  evidenceFreshness: { lastSourceModifiedAtUtc: new Date(newest).toISOString() },
  evidence,
});
const archive = '项目文档/验收/发布凭据/13.4-1.0.19';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((entry) => {
  const file = basename(entry.path);
  writeFileSync(`${archive}/${file}`, read(entry.path), { flag: 'wx' });
  return { ...entry, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  `Registered 1.0.19: ${editorHistoryPaths.length} sources, ${unit.numPassedTests} frontend checks and 32/140 real Rust executions.`,
);
