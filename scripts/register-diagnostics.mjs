// Append an immutable successor only after final-source browser and unit checks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { diagnosticsPaths } from './diagnostics-release-inputs.mjs';
const folder = '.artifacts/14.1';
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
const priorPath = 'content/c/p0/blockly-release-1.0.20.json';
const prior = json(priorPath);
for (const entry of Object.values(prior.evidence)) assert.equal(sha(entry.path), entry.sha256);
assert.equal(sha('web/src/generated/c_viz_wasm_bg.wasm'), prior.engine.wasmSha256);
const changed = diagnosticsPaths.filter(
  (path) => prior.files.find((entry) => entry.path === path)?.sha256 !== sha(path),
);
const newest = Math.max(...changed.map((path) => statSync(path).mtimeMs));
const cases = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(suite.suites ?? []),
  ]);
const key = (spec) => `${basename(spec.file.replaceAll('\\', '/'))}: ${spec.title}`;
const expectedLegacy = cases(json('.artifacts/13.5/legacy-final.json').suites)
  .map(({ spec }) => key(spec))
  .sort();
const evidence = {};
for (const [label, count] of [
  ['legacy-final', expectedLegacy.length],
  ['candidate-final2', 7],
]) {
  const path = `${folder}/${label}.json`,
    report = json(path);
  assert.deepEqual(report.errors, []);
  for (const field of ['unexpected', 'flaky', 'skipped'])
    assert.equal(report.stats[field], 0, label);
  assert.equal(report.stats.expected, count);
  assert.ok(Date.parse(report.stats.startTime) >= newest, `${label} predates sources`);
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
const unitPath = `${folder}/frontend-final2.json`,
  unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.equal(unit.numPassedTests, unit.numTotalTests);
assert.ok(unit.numPassedTests >= 1453);
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
const actual = Object.fromEntries(
  ['lex', 'parse', 'semantic', 'runtime'].map((label) => [
    label,
    json(`${folder}/browser/candidate-final2/${label}.json`),
  ]),
);
for (const label of ['lex', 'parse', 'semantic']) {
  assert.equal(actual[label].result.status, 'invalid');
  assert.equal(actual[label].result.diagnostics[0].stage, label);
  assert.equal(actual[label].result.diagnostics[0].origin, 'rust');
}
assert.equal(actual.runtime.result.producer, 'rust');
assert.equal(actual.runtime.result.terminal.status, 'program-error');
assert.equal(actual.runtime.result.terminal.diagnostics[0].code, 'E_DIV_ZERO');
save(`${folder}/diagnostics-execution.json`, actual);
evidence.actual = proof(`${folder}/diagnostics-execution.json`);
for (const label of [
  'unit-first',
  'frontend-final',
  'candidate-first',
  'candidate-second',
  'candidate-third',
  'candidate-fourth',
  'candidate-final',
])
  evidence[label] = { ...proof(`${folder}/${label}.json`), accepted: false };
const target = 'content/c/p0/blockly-release-1.0.21.json';
assert.equal(existsSync(target), false);
save(target, {
  ...prior,
  releaseVersion: '1.0.21',
  registeredAt: '2026-10-30',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.20', ...proof(priorPath) },
  scope:
    '14.1 real diagnostic presentation, original-source and block navigation; precise no-trace unevaluated judgment validation. Rust, SAVE3 and budgets unchanged.',
  reason:
    'Final-source Chrome checks verify lexical, syntactic, semantic and runtime errors, source/block navigation, invalid draft retention and history restoration; prior editor regressions and complete frontend checks pass.',
  supplementalReason:
    'No new language, exercise, entitlement or wire format. The consumer accepts only empty unevaluated pre-execution judgment from Rust with exact request identity; forged judgment evidence remains rejected. Formal assembly persistence checks follow registration.',
  files: diagnosticsPaths.map(proof),
  evidenceFreshness: { lastSourceModifiedAtUtc: new Date(newest).toISOString() },
  evidence,
});
const archive = '项目文档/验收/发布凭据/14.1-1.0.21';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((entry) => {
  const file = basename(entry.path);
  writeFileSync(`${archive}/${file}`, read(entry.path), { flag: 'wx' });
  return { ...entry, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  `Registered 1.0.21: ${diagnosticsPaths.length} sources; ${unit.numPassedTests} unit checks; ${expectedLegacy.length} legacy and 7 diagnostic Chrome scenarios.`,
);
