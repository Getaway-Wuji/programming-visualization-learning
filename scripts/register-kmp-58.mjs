import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { kmpPaths } from './kmp-release-inputs.mjs';
import { validateKmp, executeKmpSamples } from './kmp-content.mjs';
const dir = '.artifacts/18.5',
  previous = 'content/c/p0/blockly-release-1.0.57.json',
  target = 'content/c/p0/blockly-release-1.0.58.json';
const read = (path) => readFileSync(path),
  json = (path) =>
    JSON.parse(
      read(path)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  proof = (path) => ({ path, sha256: hash(read(path)) });
const save = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
assert.equal(existsSync(target), false);
const prior = json(previous);
assert.equal(
  hash(read(previous)),
  json('项目文档/验收/发布凭据/18.4-1.0.57/index.json').registration.sha256,
);
const units = json(dir + '/unit58-final-r4.json'),
  browser = json(dir + '/browser-candidate58-final-r2.json'),
  quality = json(dir + '/quality58-r3.json');
assert.equal(units.numPassedTests, 2033);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(units.numFailedTestSuites, 0);
assert.equal(units.success, true);
assert.equal(browser.stats.expected, 97);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.ok(Object.values(quality).every((exit) => exit === 0));
assert.equal(new Set(kmpPaths).size, kmpPaths.length);
assert.equal(kmpPaths.length, 386);
for (const slug of ['kmp'])
  assert.match(
    read(dir + '/inspector-' + slug + '-final.log').toString(),
    /RESULT: 0 FAIL, 0 WARN/,
  );
for (const evidence of Object.values(prior.evidence))
  assert.equal(hash(read(evidence.path)), evidence.sha256);
for (const [engine, path] of [
  ['engine', 'web/src/generated/c_viz_wasm_bg.wasm'],
  ['memoryEngine', 'web/src/generated/memory/c_viz_memory_bg.wasm'],
  ['algorithmEngine', 'web/src/generated/algorithm/c_viz_algorithm_bg.wasm'],
  ['advancedEngine', 'web/src/generated/advanced/c_viz_advanced_bg.wasm'],
])
  assert.equal(hash(read(path)), prior[engine].wasmSha256);
const sources = kmpPaths.map(proof),
  latest = Math.max(
    ...kmpPaths
      .filter((path) => !path.startsWith('web/src/generated/'))
      .map((path) => statSync(path).mtimeMs),
  );
assert.ok(units.startTime >= latest);
assert.ok(Date.parse(browser.stats.startTime) >= latest);
save(dir + '/release-review58.json', {
  task: '18.5',
  sourceProof: sources,
  content: validateKmp(),
  publicRustSamples: executeKmpSamples(),
  unitPassed: 2033,
  candidateChromePassed: 97,
  quality,
  scope:
    'One bounded C++ KMP case;24 public Rust executions, actual string objects, prefix table and fallback pointers; full backward recovery, original prerequisite/review refs and no learning authority.',
  limitations:
    'Two independent printable ASCII lines0..30; empty pattern0, first match only, no match-1; actual prefix[30]. Original1000ms and all budgets retained. Chrome/minimal only, no full performance or Unicode/general C++ editor claim.',
});
const archive = '项目文档/验收/发布凭据/18.5-1.0.58';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of [
  'unit58-final-r4.json',
  'browser-candidate58-final-r2.json',
  'release-review58.json',
]) {
  const file = name + '.gz',
    path = dir + '/' + file;
  writeFileSync(path, gzipSync(read(dir + '/' + name)), { flag: 'wx' });
  writeFileSync(archive + '/' + file, read(path), { flag: 'wx' });
  const entry = proof(path);
  evidence[name.replace(/[^a-zA-Z]/g, '')] = entry;
  files.push({ ...entry, file });
}
save(target, {
  ...prior,
  releaseVersion: '1.0.58',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.57', ...proof(previous) },
  scope:
    '18.5: actual C++ KMP prefix construction and first-match fallback, exact ASCII input, same-cursor string/array/scalar/source/three views, shared playback/input compatibility and original learning links.',
  reason:
    '2033 full serial unit checks,97 candidate Chrome scenarios,24 actual Rust sample executions and reviewed build/types/lint/format pass; all four WASM hashes retained.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 2033,
    candidateUniquePassed: 97,
  },
  files: sources,
  evidence,
});
save(archive + '/index.json', { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.58',
    sources: sources.length,
    unit: 2033,
    browser: 97,
    publicRustSamples: 24,
  }),
);
