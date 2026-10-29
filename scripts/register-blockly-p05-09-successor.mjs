// Append a release only after the final current source/engine passed every prerequisite.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { reviewedP05Paths } from './p05-09-release-inputs.mjs';

const folder = '.artifacts/P0.5-09';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (path) => createHash('sha256').update(read(path)).digest('hex');
const proof = (path) => ({ path, sha256: sha(path) });
const priorPath = 'content/c/p0/blockly-release-1.0.14.json';
const prior = json(priorPath);
assert.equal(sha(priorPath), '17f3bfa75bdda202db2f62dd8a3c109d9ac4894fb71a8a681aab0b4630ee9ec9');
assert.equal(prior.releaseVersion, '1.0.14');
assert.equal(prior.files.length, 72);
// The original registration and evidence stay immutable. Its old runtime source
// hashes describe that release; only the new registration must match current sources.
for (const item of Object.values(prior.evidence))
  if (item.path && item.sha256) assert.equal(sha(item.path), item.sha256);
const rustPath = `${folder}/rust-evidence-performance.json`,
  rust = json(rustPath);
assert.equal(rust.task, 'P0.5-09');
assert.equal(rust.status, 'passed');
assert.equal(rust.passed, 453);
assert.equal(rust.failed, 0);
assert.equal(rust.ignored, 1);
assert.ok(rust.sourceFiles.length > 20);
assert.ok(rust.checks.length > 0);
for (const file of rust.sourceFiles) assert.equal(sha(file.path), file.sha256);
for (const item of rust.checks) {
  assert.equal(item.exitCode, 0);
  assert.equal(sha(item.path), item.sha256);
}
const wasmPath = `${folder}/wasm-registration-performance.json`,
  wasm = json(wasmPath);
assert.deepEqual(
  wasm.memories.map(({ maximum, shared }) => ({ maximum, shared })),
  [{ maximum: 2048, shared: false }],
);
for (const [path, hash] of Object.entries(wasm.hashes)) assert.equal(sha(path), hash);
const binaryPath = 'web/src/generated/c_viz_wasm_bg.wasm';
const engine = { wasmSha256: sha(binaryPath), wasmBytes: read(binaryPath).length };
const module = new WebAssembly.Module(read(binaryPath));
const exports = WebAssembly.Module.exports(module).map((entry) => entry.name);
for (const name of ['prepare_input', 'analyze_code_draft', 'execute_request'])
  assert.ok(exports.includes(name));
assert.deepEqual(engine, prior.engine, 'This successor inherits the unchanged Rust/WASM engine.');
assert.equal(sha(rustPath), prior.evidence.rust.sha256);
assert.equal(sha(wasmPath), prior.evidence.wasm.sha256);
assert.equal(engine.wasmSha256, prior.evidence.wasm.buildId);
const sources = [
  ...reviewedP05Paths,
  ...rust.sourceFiles.map((file) => file.path),
  ...Object.keys(wasm.hashes),
];
const lastChange = Math.max(...sources.map((path) => statSync(path).mtimeMs));
const evidence = {
  rust: proof(rustPath),
  wasm: { ...proof(wasmPath), buildId: engine.wasmSha256 },
};
const projects = ['chrome', 'edge', 'firefox-automation'];
function cases(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(suite.suites ?? []),
  ]);
}
const temporaryPath = `${folder}/successor-temp.json`;
const temporary = json(temporaryPath);
assert.deepEqual(temporary.errors, []);
assert.equal(temporary.stats.expected, 3);
for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(temporary.stats[key], 0);
assert.equal(temporary.config.workers, 1);
assert.deepEqual(temporary.config.projects.map((entry) => entry.name).sort(), [...projects].sort());
assert.ok(
  Date.parse(temporary.stats.startTime) >= lastChange,
  'Temporary execution predates current sources.',
);
assert.ok(
  Date.parse(temporary.stats.startTime) >=
    statSync('tests/browser/p05-course-temporary.spec.ts').mtimeMs,
);
const temporaryCases = cases(temporary.suites);
assert.equal(temporaryCases.length, 3);
assert.deepEqual(temporaryCases.map(({ test }) => test.projectName).sort(), [...projects].sort());
for (const { spec, test } of temporaryCases) {
  assert.equal(spec.ok, true);
  assert.equal(test.results.length, 1);
  assert.equal(test.results[0].status, 'passed');
  assert.equal(test.results[0].retry, 0);
}
evidence.temporaryBrowsers = { ...proof(temporaryPath), passed: 3, groupsPerBrowser: 140 };
for (const project of projects) {
  const path = `${folder}/browser/successor-temp/${project}/temporary-32/temporary-course-evidence.json`;
  const actual = json(path);
  assert.equal(actual.evidenceKind, 'preregistration-real-browser-execution-no-learning-authority');
  assert.equal(actual.subjects.length, 32);
  assert.equal(new Set(actual.subjects.map((entry) => entry.exerciseId)).size, 32);
  assert.equal(actual.groups.length, 140);
  assert.ok(
    actual.groups.every(
      (entry) =>
        entry.terminal === 'completed' &&
        entry.judge === 'met' &&
        entry.fuel <= 1_000_000 &&
        entry.remainingMs > 0 &&
        entry.remainingMs <= 1000 &&
        entry.blockMapCount === entry.mappedRangesInRealAst &&
        entry.blockMapCount > 0,
    ),
  );
  assert.equal(actual.maximumBubble.caseKey, 'maximum');
  assert.ok(actual.maximumBubble.blockMapCount > 2);
  for (const snapshot of [actual.initial, actual.final]) {
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.names.length, 11);
    for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'])
      assert.deepEqual(snapshot.data[store], []);
  }
  assert.equal(actual.initial.data.meta.generation, actual.final.data.meta.generation);
  evidence[`temporary-${project}`] = { ...proof(path), groups: 140, maxFuel: actual.maxFuel };
}
for (const [name, count, files] of [
  ['successor-gate-blocks', 45, ['blocks.spec.ts', 'practice.spec.ts']],
  ['successor-gate-navigation', 3, ['navigation.spec.ts']],
  ['successor-gate-interaction', 15, ['block-interaction.spec.ts']],
  ['successor-gate-experience', 15, ['practice-experience.spec.ts']],
  ['successor-bidirectional-final', 39, ['bidirectional.spec.ts']],
  ['successor-presentation-final', 51, ['editor-presentation.spec.ts']],
]) {
  const path = `${folder}/${name}.json`,
    report = json(path);
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.expected, count);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
  assert.deepEqual(report.config.projects.map((entry) => entry.name).sort(), [...projects].sort());
  assert.ok(report.config.projects.every((entry) => entry.retries === 0));
  assert.ok(
    Date.parse(report.stats.startTime) >= lastChange,
    `${name} predates current sources/engine.`,
  );
  for (const file of files)
    assert.ok(Date.parse(report.stats.startTime) >= statSync(`tests/browser/${file}`).mtimeMs);
  const rows = cases(report.suites);
  assert.equal(rows.length, count);
  const identities = new Map(projects.map((project) => [project, new Set()]));
  for (const { spec, test } of rows) {
    assert.ok(files.includes(basename(spec.file.replaceAll('\\', '/'))));
    assert.equal(spec.ok, true);
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].status, 'passed');
    assert.equal(test.results[0].retry, 0);
    assert.deepEqual(test.results[0].errors ?? [], []);
    const key = `${basename(spec.file.replaceAll('\\', '/'))}: ${spec.title}`;
    const seen = identities.get(test.projectName);
    assert.ok(seen);
    assert.ok(!seen.has(key));
    seen.add(key);
  }
  for (const seen of identities.values())
    assert.deepEqual([...seen].sort(), [...identities.get('chrome')].sort());
  evidence[name] = { ...proof(path), passed: count, retries: 0 };
}
const frontendPath = `${folder}/unit-successor-complete.json`,
  unit = json(frontendPath);
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.equal(unit.numPassedTests, unit.numTotalTests);
assert.ok(unit.startTime >= lastChange, 'Frontend report predates final sources/engine.');
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`],
  );
const expected = walk('tests/unit')
  .filter((path) => path.endsWith('.test.ts'))
  .map((path) => resolve(path).toLowerCase())
  .sort();
assert.deepEqual(
  unit.testResults.map((entry) => resolve(entry.name).toLowerCase()).sort(),
  expected,
);
for (const result of unit.testResults) {
  assert.equal(result.status, 'passed');
  assert.ok(unit.startTime >= statSync(result.name).mtimeMs);
  assert.ok(result.assertionResults.every((entry) => entry.status === 'passed'));
}
evidence.frontend = { ...proof(frontendPath), passed: unit.numPassedTests, files: expected.length };
const actualPath = `${folder}/course-wasm-execution.json`,
  actual = json(actualPath);
assert.equal(actual.producer, 'actual-rust-wasm');
assert.equal(actual.userData, false);
assert.equal(actual.records.filter((record) => !record.correction).length, 140);
assert.ok(actual.records.filter((record) => !record.correction).every((record) => record.met));
assert.equal(
  new Set(actual.records.filter((record) => record.correction).map((record) => record.exerciseId))
    .size,
  32,
);
const registeredActualPath = `${folder}/course-wasm-successor-registration.json`;
if (existsSync(registeredActualPath))
  assert.deepEqual(read(registeredActualPath), read(actualPath));
else writeFileSync(registeredActualPath, read(actualPath), { flag: 'wx' });
evidence.course = { ...proof(registeredActualPath), groups: 140, exercises: 32 };
const result = {
  ...prior,
  releaseVersion: '1.0.15',
  registeredAt: '2026-10-28',
  supersedes: { version: '1.0.14', path: priorPath, sha256: sha(priorPath) },
  scope:
    'P0.5-09 successor: bounded recovery validation for sequential 32-course saves; exact legacy fallback, SAVE2 semantics, unchanged Rust/WASM, P0-C and budgets',
  files: reviewedP05Paths.map((path) => ({ path, sha256: sha(path) })),
  evidenceFreshness: {
    lastSourceModifiedAtUtc: new Date(lastChange).toISOString(),
    sources: [...new Set(sources)].map((path) => ({
      path,
      sha256: sha(path),
      modifiedAtUtc: statSync(path).mtime.toISOString(),
    })),
  },
  engine,
  evidence,
  executionVersions: ['1.0.0/1.0.0/1.0.0/1.0.0/1.0.0', '1.1.0/1.0.0/1.0.0/1.1.0/1.0.0'],
  legacyGateMode:
    'P05_HIDE_COURSE_BUNDLE=1: actual old six-course fallback using the current frontend and Rust engine',
};
writeFileSync('content/c/p0/blockly-release-1.0.15.json', JSON.stringify(result, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  `Registered 1.0.15: ${result.files.length} sources, 168 browser gates, ${unit.numPassedTests} frontend checks, 32/140 actual WASM answers.`,
);
