import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { exampleSolutionsPaths } from './example-solutions-release-inputs.mjs';
import { validateSolutions, executeSolutionSamples } from './example-solutions-content.mjs';
const dir = '.artifacts/18.3',
  previous = 'content/c/p0/blockly-release-1.0.54.json',
  target = 'content/c/p0/blockly-release-1.0.55.json';
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
  json('项目文档/验收/发布凭据/18.2-1.0.54/index.json').registration.sha256,
);
const units = json(dir + '/unit55-serial.json'),
  browser = json(dir + '/browser-candidate55-approved.json'),
  quality = json(dir + '/quality55.json');
assert.equal(units.numPassedTests, 1938);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(browser.stats.expected, 38);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.ok(Object.values(quality).every((exit) => exit === 0));
assert.equal(new Set(exampleSolutionsPaths).size, exampleSolutionsPaths.length);
assert.equal(exampleSolutionsPaths.length, 359);
for (const slug of ['two-sum', 'move-zeroes', 'search-insert'])
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
const sources = exampleSolutionsPaths.map(proof),
  latest = Math.max(
    ...exampleSolutionsPaths
      .filter((path) => !path.startsWith('web/src/generated/'))
      .map((path) => statSync(path).mtimeMs),
  );
assert.ok(units.startTime >= latest);
assert.ok(Date.parse(browser.stats.startTime) >= latest);
save(dir + '/release-review55.json', {
  task: '18.3',
  sourceProof: sources,
  content: validateSolutions(),
  publicRustSamples: executeSolutionSamples(),
  unitPassed: 1938,
  candidateChromePassed: 38,
  quality,
  scope:
    'Three same-problem C++ comparisons, six actual solutions and28 sample pairs/56 public Rust executions; independent input copies, common1000ms deadline, reversible dual playback and no new learning authority.',
  limitations:
    'Teaching arrays at most12 and original constraints retained; no confirmed external republication permission. Chrome/minimal only, no full performance or general C++ language/editor claim.',
});
const archive = '项目文档/验收/发布凭据/18.3-1.0.55';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of [
  'unit55-serial.json',
  'browser-candidate55-approved.json',
  'release-review55.json',
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
  releaseVersion: '1.0.55',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.54', ...proof(previous) },
  scope:
    '18.3 six actual C++ solutions and same-problem shared-deadline dual trace comparison, with complexity and boundary analysis.',
  reason:
    '1938 full serial unit checks,38 candidate Chrome scenarios,56 actual Rust sample executions and reviewed build/types/lint/format pass; all four WASM hashes retained.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 1938,
    candidateUniquePassed: 38,
  },
  files: sources,
  evidence,
});
save(archive + '/index.json', { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.55',
    sources: sources.length,
    unit: 1938,
    browser: 38,
    publicRustSamples: 56,
  }),
);
