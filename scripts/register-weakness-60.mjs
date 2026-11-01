import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { weaknessPaths } from './weakness-release-inputs.mjs';
const dir = '.artifacts/19.1',
  previous = 'content/c/p0/blockly-release-1.0.59.json',
  target = 'content/c/p0/blockly-release-1.0.60.json';
const read = (p) => readFileSync(p),
  json = (p) =>
    JSON.parse(
      read(p)
        .toString()
        .replace(/^\uFEFF/, ''),
    );
const sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (path) => ({ path, sha256: sha(read(path)) });
const save = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
assert.equal(existsSync(target), false);
const prior = json(previous);
assert.equal(
  sha(read(previous)),
  json('项目文档/验收/发布凭据/18.6-1.0.59/index.json').registration.sha256,
);
const units = json(dir + '/unit-full-r3.json'),
  browser = json(dir + '/browser-candidate-r2.json'),
  quality = json(dir + '/quality-r3.json');
assert.equal(units.numPassedTests, 2069);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(units.numFailedTestSuites, 0);
assert.equal(units.success, true);
assert.equal(browser.stats.expected, 1);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.deepEqual(Object.values(quality).sort(), [0, 0, 0]);
assert.match(read(dir + '/inspector-r2.log').toString(), /RESULT: 0 FAIL, 0 WARN/);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256);
for (const [engine, path] of [
  ['engine', 'web/src/generated/c_viz_wasm_bg.wasm'],
  ['memoryEngine', 'web/src/generated/memory/c_viz_memory_bg.wasm'],
  ['algorithmEngine', 'web/src/generated/algorithm/c_viz_algorithm_bg.wasm'],
  ['advancedEngine', 'web/src/generated/advanced/c_viz_advanced_bg.wasm'],
])
  assert.equal(sha(read(path)), prior[engine].wasmSha256);
assert.equal(new Set(weaknessPaths).size, weaknessPaths.length);
const sources = weaknessPaths.map(proof),
  latest = Math.max(
    ...weaknessPaths
      .filter((p) => !p.startsWith('web/src/generated/'))
      .map((p) => statSync(p).mtimeMs),
  );
assert.ok(units.startTime >= latest);
assert.ok(Date.parse(browser.stats.startTime) >= latest);
save(dir + '/release-review60.json', {
  task: '19.1',
  sources,
  quality,
  unitPassed: 2069,
  candidateChromePassed: 1,
  scope:
    'Local evidence only: genuine final exercise/challenge receipts and explicit manual marks, exact reviewed knowledge mappings,30-day active failures,distinct-question stall,repair/reopen,closed bounded explanations. SAVE9/DB9/17store. No new learning/reward authority or AI.',
  limits:
    'Candidate screen verifies honest unavailable-source fallback only. Full real learning/browser verification is mandatory after immutable registration; this is not task acceptance.',
});
const archive = '项目文档/验收/发布凭据/19.1-1.0.60';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of ['unit-full-r3.json', 'browser-candidate-r2.json', 'release-review60.json']) {
  const file = name + '.gz',
    path = dir + '/' + file;
  writeFileSync(path, gzipSync(read(dir + '/' + name)), { flag: 'wx' });
  writeFileSync(archive + '/' + file, read(path), { flag: 'wx' });
  const e = proof(path);
  evidence[name.replace(/[^a-zA-Z]/g, '')] = e;
  files.push({ ...e, file });
}
save(target, {
  ...prior,
  releaseVersion: '1.0.60',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.59', ...proof(previous) },
  scope:
    '19.1: bounded local weakness summaries, inspectable evidence and old course/review entry points; no model,execution engine,algorithm or reward changes.',
  reason:
    '2069 full fixed-Node serial units, candidate UI/source-failure recovery,types/lint/format and candidate full build pass. DB9 native migration and true learning/browser behavior remain mandatory for task acceptance.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 2069,
    candidateUniquePassed: 1,
  },
  files: sources,
  evidence,
});
save(archive + '/index.json', { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.60',
    sources: sources.length,
    unit: 2069,
    candidate: 1,
    notYetTaskAcceptance: true,
  }),
);
