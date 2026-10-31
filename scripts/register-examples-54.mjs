import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { examplesPaths } from './examples-release-inputs.mjs';
import { validateExamples, executePublicExamples } from './examples-content.mjs';
const dir = '.artifacts/18.2',
  previous = 'content/c/p0/blockly-release-1.0.53.json',
  target = 'content/c/p0/blockly-release-1.0.54.json';
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
  json('项目文档/验收/发布凭据/18.1-1.0.53/index.json').registration.sha256,
);
const units = json(dir + '/unit54-approved.json'),
  browser = json(dir + '/browser-candidate54-approved.json'),
  quality = json(dir + '/quality54.json');
assert.equal(units.numPassedTests, 1898);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(browser.stats.expected, 37);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.ok(Object.values(quality).every((exit) => exit === 0));
assert.equal(new Set(examplesPaths).size, examplesPaths.length);
for (const evidence of Object.values(prior.evidence))
  assert.equal(hash(read(evidence.path)), evidence.sha256);
for (const [engine, path] of [
  ['engine', 'web/src/generated/c_viz_wasm_bg.wasm'],
  ['memoryEngine', 'web/src/generated/memory/c_viz_memory_bg.wasm'],
  ['algorithmEngine', 'web/src/generated/algorithm/c_viz_algorithm_bg.wasm'],
  ['advancedEngine', 'web/src/generated/advanced/c_viz_advanced_bg.wasm'],
])
  assert.equal(hash(read(path)), prior[engine].wasmSha256);
const sources = examplesPaths.map(proof),
  latest = Math.max(
    ...examplesPaths
      .filter((path) => !path.startsWith('web/src/generated/'))
      .map((path) => statSync(path).mtimeMs),
  );
assert.ok(units.startTime >= latest);
assert.ok(Date.parse(browser.stats.startTime) >= latest);
save(dir + '/release-review54.json', {
  task: '18.2',
  sourceProof: sources,
  content: validateExamples(),
  publicRustSamples: executePublicExamples(),
  unitPassed: 1898,
  candidateChromePassed: 37,
  quality,
  scope:
    'Three independently authored, source-attributed C++ classical examples, one real solution each,19 public samples. Reuse the existing advanced Rust/WASM, trace/controller/views, foundation progress and review links; no new learning authority, events, scores or stores.',
  limitations:
    'Teaching arrays at most12, bounded integers and explicit original-versus-platform constraints; no confirmed external republication permission or copied statements/editorials. Chrome/minimal only; multisolutions remain18.3, no general C++ editor or language course.',
});
const archive = '项目文档/验收/发布凭据/18.2-1.0.54';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of [
  'unit54-approved.json',
  'browser-candidate54-approved.json',
  'release-review54.json',
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
  releaseVersion: '1.0.54',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.53', ...proof(previous) },
  scope:
    '18.2 source-attributed classical examples: actual cpp advanced-engine source/trace, bounded public samples and unified foundation learning references.',
  reason:
    '1898 full unit checks,37 candidate Chrome scenarios,19 build-time public Rust examples and fixed build/types/lint/format pass; all four WASM hashes retained.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 1898,
    candidateUniquePassed: 37,
  },
  files: sources,
  evidence,
});
save(archive + '/index.json', { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.54',
    sources: sources.length,
    unit: 1898,
    browser: 37,
    publicRustSamples: 19,
  }),
);
