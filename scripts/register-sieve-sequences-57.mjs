import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { sieveSequencePaths } from './sieve-sequences-release-inputs.mjs';
import { validateSieveSequences, executeSieveSequences } from './sieve-sequences-content.mjs';
const dir = '.artifacts/18.4',
  previous = 'content/c/p0/blockly-release-1.0.56.json',
  target = 'content/c/p0/blockly-release-1.0.57.json';
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
  json('项目文档/验收/发布凭据/18.3-1.0.56/index.json').registration.sha256,
);
const units = json(dir + '/unit57-final.json'),
  browser = json(dir + '/browser-candidate57-final.json'),
  quality = json(dir + '/quality57.json');
assert.equal(units.numPassedTests, 1988);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(browser.stats.expected, 63);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.ok(Object.values(quality).every((exit) => exit === 0));
assert.equal(new Set(sieveSequencePaths).size, sieveSequencePaths.length);
assert.equal(sieveSequencePaths.length, 374);
for (const slug of ['eratosthenes-sieve', 'euler-sieve', 'maximum-subarray', 'strict-lis'])
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
const sources = sieveSequencePaths.map(proof),
  latest = Math.max(
    ...sieveSequencePaths
      .filter((path) => !path.startsWith('web/src/generated/'))
      .map((path) => statSync(path).mtimeMs),
  );
assert.ok(units.startTime >= latest);
assert.ok(Date.parse(browser.stats.startTime) >= latest);
save(dir + '/release-review57.json', {
  task: '18.4',
  sourceProof: sources,
  content: validateSieveSequences(),
  publicRustSamples: executeSieveSequences(),
  unitPassed: 1988,
  candidateChromePassed: 63,
  quality,
  scope:
    'Four bounded C++ sieve and sequence cases;44 public Rust executions, real Step DSL arrays and counters, full backward recovery, old prerequisite/review references and no new learning authority.',
  limitations:
    'Sieve inclusive upper0..30; sequences0..30 and values-999..999; fixed physical31/30 cells. Original1000ms and all resource limits retained. Chrome/minimal only, no full performance or general C++ editor claim.',
});
const archive = '项目文档/验收/发布凭据/18.4-1.0.57';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of [
  'unit57-final.json',
  'browser-candidate57-final.json',
  'release-review57.json',
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
  releaseVersion: '1.0.57',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.56', ...proof(previous) },
  scope:
    '18.4: four actual C++ sieve and sequence algorithms, boundaries, real array projections and existing learning links.',
  reason:
    '1988 full serial unit checks,63 candidate Chrome scenarios,44 actual Rust sample executions and reviewed build/types/lint/format pass; all four WASM hashes retained.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 1988,
    candidateUniquePassed: 63,
  },
  files: sources,
  evidence,
});
save(archive + '/index.json', { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.57',
    sources: sources.length,
    unit: 1988,
    browser: 63,
    publicRustSamples: 44,
  }),
);
