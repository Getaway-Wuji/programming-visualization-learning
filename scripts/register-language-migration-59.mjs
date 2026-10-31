import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { languageMigrationPaths } from './language-migration-release-inputs.mjs';
import { validateLanguageMigration } from './language-migration-content.mjs';
const dir = '.artifacts/18.6',
  previous = 'content/c/p0/blockly-release-1.0.58.json',
  target = 'content/c/p0/blockly-release-1.0.59.json';
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
  json('项目文档/验收/发布凭据/18.5-1.0.58/index.json').registration.sha256,
);
const units = json(dir + '/unit59-final.json'),
  browser = json(dir + '/browser-candidate59-final.json'),
  quality = json(dir + '/quality59.json');
assert.equal(units.numPassedTests, 2057);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(units.numFailedTestSuites, 0);
assert.equal(units.success, true);
assert.equal(browser.stats.expected, 42);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.ok(Object.values(quality).every((exit) => exit === 0));
assert.equal(new Set(languageMigrationPaths).size, languageMigrationPaths.length);
assert.equal(languageMigrationPaths.length, 394);
for (const slug of ['migration'])
  assert.match(read(dir + '/inspector-' + slug + '-r2.log').toString(), /RESULT: 0 FAIL, 0 WARN/);
for (const evidence of Object.values(prior.evidence))
  assert.equal(hash(read(evidence.path)), evidence.sha256);
for (const [engine, path] of [
  ['engine', 'web/src/generated/c_viz_wasm_bg.wasm'],
  ['memoryEngine', 'web/src/generated/memory/c_viz_memory_bg.wasm'],
  ['algorithmEngine', 'web/src/generated/algorithm/c_viz_algorithm_bg.wasm'],
  ['advancedEngine', 'web/src/generated/advanced/c_viz_advanced_bg.wasm'],
])
  assert.equal(hash(read(path)), prior[engine].wasmSha256);
const sources = languageMigrationPaths.map(proof),
  latest = Math.max(
    ...languageMigrationPaths
      .filter((path) => !path.startsWith('web/src/generated/'))
      .map((path) => statSync(path).mtimeMs),
  );
assert.ok(units.startTime >= latest);
assert.ok(Date.parse(browser.stats.startTime) >= latest);
save(dir + '/release-review59.json', {
  task: '18.6',
  sourceProof: sources,
  content: validateLanguageMigration(),
  unitPassed: 2057,
  candidateChromePassed: 42,
  quality,
  scope:
    'Static migration:6 topics/24 original snippets/72 authored annotations/12 ordered language pairs; fixed C-to-C++-to-Python-to-Java guidance, exact old preparation links, no execution or learning authority.',
  limitations:
    'C11/C++17 draft reference, Python3.13, JavaSE21 static teaching only; no snippet compilation/execution, no new language engine/editor. Original fourWASM/protocols/budgets preserved; Chrome/minimal only.',
});
const archive = '项目文档/验收/发布凭据/18.6-1.0.59';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of [
  'unit59-final.json',
  'browser-candidate59-final.json',
  'release-review59.json',
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
  releaseVersion: '1.0.59',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.58', ...proof(previous) },
  scope:
    '18.6: static four-language reading pairs, true selection-dependent guidance, finite authored annotation playback, offline bundled content and exact original preparation/review links.',
  reason:
    '2057 full serial unit checks,42 candidate Chrome scenarios,24 static snippets/schema/references and reviewed build/types/lint/format pass; all four WASM hashes retained. No new execution authority.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 2057,
    candidateUniquePassed: 42,
  },
  files: sources,
  evidence,
});
save(archive + '/index.json', { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.59',
    sources: sources.length,
    unit: 2057,
    browser: 42,
    staticSnippets: 24,
  }),
);
