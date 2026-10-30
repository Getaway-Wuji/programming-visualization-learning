// Authorize only this exact reviewed, read-only knowledge-map assembly.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { knowledgePaths } from './knowledge-release-inputs.mjs';
const dir = '.artifacts/15.1';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString()
      .replace(/^\uFEFF/, ''),
  );
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, sha256: sha(read(path)) });
const save = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const previousPath = 'content/c/p0/blockly-release-1.0.24.json';
const previous = json(previousPath);
const target = 'content/c/p0/blockly-release-1.0.25.json';
assert.equal(existsSync(target), false);
for (const entry of Object.values(previous.evidence))
  assert.equal(sha(read(entry.path)), entry.sha256);
const changed = knowledgePaths.filter(
  (path) => previous.files.find((entry) => entry.path === path)?.sha256 !== sha(read(path)),
);
const newest = Math.max(...changed.map((path) => statSync(path).mtimeMs));
const cases = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(suite.suites ?? []),
  ]);
const identity = ({ spec }) => `${basename(spec.file.replaceAll('\\', '/'))}: ${spec.title}`;
const evidence = {};
for (const [label, count] of [
  ['candidate-release', 4],
  ['legacy-release', 60],
]) {
  const path = `${dir}/${label}.json`,
    report = json(path);
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.expected, count);
  assert.equal(report.stats.unexpected + report.stats.flaky + report.stats.skipped, 0);
  assert.ok(Date.parse(report.stats.startTime) >= newest);
  const tests = cases(report.suites);
  assert.equal(tests.length, count);
  for (const { spec, test } of tests) {
    assert.equal(spec.ok, true);
    assert.equal(test.projectName, 'chrome');
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].status, 'passed');
    assert.equal(test.results[0].retry, 0);
    assert.ok(
      Date.parse(report.stats.startTime) >=
        statSync(`tests/browser/${basename(spec.file.replaceAll('\\', '/'))}`).mtimeMs,
    );
  }
  if (label === 'legacy-release')
    assert.deepEqual(
      tests.map(identity).sort(),
      cases(json('.artifacts/14.4/14-4-legacy-release.json').suites).map(identity).sort(),
    );
  evidence[label] = { ...proof(path), passed: count };
}
const unitPath = `${dir}/frontend-release-serial.json`,
  unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 1491);
assert.equal(unit.numFailedTests + unit.numPendingTests, 0);
assert.ok(unit.startTime >= newest);
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`],
  );
assert.deepEqual(
  unit.testResults.map((result) => resolve(result.name).toLowerCase()).sort(),
  walk('tests/unit')
    .filter((path) => path.endsWith('.test.ts'))
    .map((path) => resolve(path).toLowerCase())
    .sort(),
);
for (const result of unit.testResults) {
  assert.equal(result.status, 'passed');
  assert.ok(unit.startTime >= statSync(result.name).mtimeMs);
}
evidence.frontend = { ...proof(unitPath), passed: unit.numPassedTests };
// Engines and their actual execution evidence are inherited byte-for-byte.
const wasmPaths = [
  'web/src/generated/c_viz_wasm_bg.wasm',
  'web/src/generated/algorithm/c_viz_algorithm_bg.wasm',
  'web/src/generated/memory/c_viz_memory_bg.wasm',
];
const baseline = json(`${dir}/baseline.json`);
const protectedPaths = baseline.files.filter(
  (entry) => entry.path.startsWith('engine/') || wasmPaths.includes(entry.path),
);
for (const entry of protectedPaths) assert.equal(sha(read(entry.path)), entry.sha256);
assert.equal(sha(read(wasmPaths[0])), previous.engine.wasmSha256);
assert.equal(sha(read(wasmPaths[2])), previous.memoryEngine.wasmSha256);
const inherited = `${dir}/inherited-engines.json`;
save(inherited, {
  task: '15.1',
  inheritedOnly: true,
  previous: proof(previousPath),
  rust: previous.evidence.rust,
  rustPassed: 507,
  originalIgnored: 1,
  protectedFiles: protectedPaths,
  wasm: wasmPaths.map(proof),
  note: 'No Rust or WASM change and no new Rust full-suite claim.',
});
evidence.inherited = proof(inherited);
for (const label of ['candidate-first', 'frontend-release'])
  evidence[label] = { ...proof(`${dir}/${label}.json`), accepted: false };
save(target, {
  ...previous,
  releaseVersion: '1.0.25',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.24', ...proof(previousPath) },
  scope:
    '15.1 home knowledge map, ten exact course nodes / eleven prerequisite edges, read-only durable completion projection and precise lesson links; no new event, reward, schema or engine.',
  reason:
    '1491 frontend tests serially passed with unchanged budgets; identical60 original Chrome and4 candidate graph scenarios passed. Actual new saves, quota retry, reviewed old completion, refresh and clear require the formal successor UI acceptance.',
  files: knowledgePaths.map(proof),
  evidenceFreshness: { lastSourceModifiedAtUtc: new Date(newest).toISOString() },
  evidence,
});
const archive = '项目文档/验收/发布凭据/15.1-1.0.25';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((entry) => {
  const file = basename(entry.path);
  writeFileSync(`${archive}/${file}`, read(entry.path), { flag: 'wx' });
  return { ...entry, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  `Registered1.0.25: ${knowledgePaths.length} exact sources;1491 frontend,60 legacy+4 candidate Chrome. Formal graph acceptance remains separate.`,
);
