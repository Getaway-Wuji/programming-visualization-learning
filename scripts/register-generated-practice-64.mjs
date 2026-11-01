import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { generatedPracticePaths } from './generated-practice-release-inputs.mjs';
const dir = '.artifacts/19.2',
  priorPath = 'content/c/p0/blockly-release-1.0.63.json',
  target = 'content/c/p0/blockly-release-1.0.64.json';
const read = (p) => readFileSync(p),
  json = (p) =>
    JSON.parse(
      read(p)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (path) => ({ path, sha256: sha(read(path)) });
const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
assert.equal(existsSync(target), false);
const prior = json(priorPath),
  units = json(dir + '/unit-full-r2.json'),
  browser = json(dir + '/browser-candidate-r4.json'),
  quality = json(dir + '/quality-r5.json');
assert.equal(
  sha(read(priorPath)),
  json('项目文档/验收/发布凭据/19.1-1.0.63/index.json').registration.sha256,
);
assert.equal(units.numPassedTests, 2116);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(units.numFailedTestSuites, 0);
assert.equal(units.success, true);
assert.equal(browser.stats.expected, 9);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.deepEqual(Object.values(quality).sort(), [0, 0, 0]);
assert.match(read(dir + '/rust-full-r2.log').toString(), /Doc-tests c_viz_practice_generator_wasm/);
assert.doesNotMatch(read(dir + '/rust-full-r2.log').toString(), /error:|test result: FAILED/);
assert.equal(json(dir + '/schema-packets-r1.json').actualWorkerPacketsValidated, 40);
assert.match(read(dir + '/inspector-r1.log').toString(), /RESULT: 0 FAIL, 1 WARN/);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256);
for (const [key, path] of [
  ['engine', 'web/src/generated/c_viz_wasm_bg.wasm'],
  ['memoryEngine', 'web/src/generated/memory/c_viz_memory_bg.wasm'],
  ['algorithmEngine', 'web/src/generated/algorithm/c_viz_algorithm_bg.wasm'],
  ['advancedEngine', 'web/src/generated/advanced/c_viz_advanced_bg.wasm'],
])
  assert.equal(sha(read(path)), prior[key].wasmSha256);
assert.equal(new Set(generatedPracticePaths).size, generatedPracticePaths.length);
const sources = generatedPracticePaths.map(proof),
  latest = Math.max(
    ...generatedPracticePaths
      .filter((p) => !p.startsWith('web/src/generated/'))
      .map((p) => statSync(p).mtimeMs),
  );
assert.ok(units.startTime >= latest, 'Unit checks predate a source edit');
assert.ok(Date.parse(browser.stats.startTime) >= latest, 'Browser checks predate a source edit');
save(dir + '/release-review64.json', {
  task: '19.2',
  sources,
  quality,
  unitPassed: 2116,
  candidateChromePassed: 9,
  scope:
    'Deterministic Rust C generation, actual reference/full-domain candidate verification, original reversible trace, independent temporary non-scoring identities; SAVE9 unchanged.',
  limitations:
    'Formal true learning recommendation/store side effects require post-registration verification. Empty idle form intentionally leaves room for generated question; inspector hero-void warning reviewed, no invented content.',
});
const archive = '项目文档/验收/发布凭据/19.2-1.0.64';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of ['unit-full-r2.json', 'browser-candidate-r4.json', 'release-review64.json']) {
  const file = name + '.gz',
    path = dir + '/' + file;
  writeFileSync(path, gzipSync(read(dir + '/' + name)), { flag: 'wx' });
  writeFileSync(archive + '/' + file, read(path), { flag: 'wx' });
  const e = proof(path);
  evidence[name.replace(/[^a-zA-Z]/g, '')] = e;
  files.push({ ...e, file });
}
const wasm = read('web/src/generated/practice/c_viz_practice_bg.wasm');
save(target, {
  ...prior,
  releaseVersion: '1.0.64',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.63', ...proof(priorPath) },
  scope:
    '19.2 independent temporary Rust-generated foundational C practice; three templates/two tiers, complete finite input domains, genuine same-source execution and inverse replay. No learning/reward authority or model.',
  reason:
    '2116 fixed-Node serial frontend units, 9 genuine Chrome candidate paths, full native/wasm clippy and workspace Rust tests, schema/40 real Worker packets, types/lint/format/full candidate build. Formal checks still required for task acceptance.',
  generatorEngine: {
    engineId: 'engine.rust.practice-generator',
    engineVersion: '1.0.0',
    wasmBytes: wasm.length,
    wasmSha256: sha(wasm),
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 2116,
    candidateUniquePassed: 9,
  },
  files: sources,
  evidence,
});
save(archive + '/index.json', { version: '1.0.0', registration: proof(target), files });
const frozen = dir + '/sources-64';
mkdirSync(frozen, { recursive: true });
const frozenFiles = sources.map((p, i) => {
  const file = String(i).padStart(4, '0') + '.gz';
  writeFileSync(frozen + '/' + file, gzipSync(read(p.path)), { flag: 'wx' });
  return { ...p, file };
});
save(frozen + '/index.json', { registration: proof(target), files: frozenFiles });
console.log(
  JSON.stringify({
    registered: '1.0.64',
    sources: sources.length,
    unit: 2116,
    candidate: 9,
    notYetTaskAcceptance: true,
  }),
);
