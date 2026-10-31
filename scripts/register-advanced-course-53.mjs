import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { advancedCoursePaths } from './advanced-course-release-inputs.mjs';
import { validateAdvancedCourse } from './advanced-course-content.mjs';
const dir = '.artifacts/18.1';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString()
      .replace(/^\uFEFF/, ''),
  );
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, sha256: hash(read(path)) });
const save = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const previous = 'content/c/p0/blockly-release-1.0.52.json';
const target = 'content/c/p0/blockly-release-1.0.53.json';
assert.equal(existsSync(target), false);
const prior = json(previous);
assert.equal(
  hash(read(previous)),
  json('项目文档/验收/发布凭据/17.4-1.0.52/index.json').registration.sha256,
);
const units = json(`${dir}/unit53-final2.json`);
const browser = json(`${dir}/browser-candidate53-r2.json`);
const quality = json(`${dir}/quality53.json`);
assert.equal(units.numPassedTests, 1874);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(browser.stats.expected, 9);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.ok(Object.values(quality).every((exit) => exit === 0));
assert.equal(new Set(advancedCoursePaths).size, advancedCoursePaths.length);
for (const evidence of Object.values(prior.evidence))
  assert.equal(hash(read(evidence.path)), evidence.sha256);
for (const [engine, path] of [
  ['engine', 'web/src/generated/c_viz_wasm_bg.wasm'],
  ['memoryEngine', 'web/src/generated/memory/c_viz_memory_bg.wasm'],
  ['algorithmEngine', 'web/src/generated/algorithm/c_viz_algorithm_bg.wasm'],
  ['advancedEngine', 'web/src/generated/advanced/c_viz_advanced_bg.wasm'],
])
  assert.equal(hash(read(path)), prior[engine].wasmSha256);
const sources = advancedCoursePaths.map(proof);
const latest = Math.max(
  ...advancedCoursePaths
    .filter((path) => !path.startsWith('web/src/generated/'))
    .map((path) => statSync(path).mtimeMs),
);
assert.ok(units.startTime >= latest);
assert.ok(Date.parse(browser.stats.startTime) >= latest);
save(`${dir}/release-review53.json`, {
  task: '18.1',
  sourceProof: sources,
  content: validateAdvancedCourse(),
  unitPassed: 1874,
  candidateChromePassed: 9,
  quality,
  scope:
    'Two reading chapters reuse four exact existing C lesson/exercise/knowledge identities, durable progress and rewards. Four real C++ case source/trace links; no new algorithm, event, store or language capability.',
  limits:
    'Chrome/minimal only. Original completion denotes foundational preparation, not advanced algorithm mastery. New lessons/problems/solutions and five missing algorithms remain 18.2-18.6; old engine/limits/SAVE8 retained. Formal persistence acceptance follows registration.',
});
const archive = '项目文档/验收/发布凭据/18.1-1.0.53';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of ['unit53-final2.json', 'browser-candidate53-r2.json', 'release-review53.json']) {
  const file = `${name}.gz`,
    path = `${dir}/${file}`;
  writeFileSync(path, gzipSync(read(`${dir}/${name}`)), { flag: 'wx' });
  writeFileSync(`${archive}/${file}`, read(path), { flag: 'wx' });
  const entry = proof(path);
  evidence[name.replace(/[^a-zA-Z]/g, '')] = entry;
  files.push({ ...entry, file });
}
save(target, {
  ...prior,
  releaseVersion: '1.0.53',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.52', ...proof(previous) },
  scope:
    '18.1 advanced course reading arrangement with unified durable foundation progress and real existing C++ case links.',
  reason:
    '1874 full unit checks,9 real Chrome candidate scenarios,closed content/reference validation and fixed build/types/lint/format passed; four engine bytes unchanged.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 1874,
    candidateUniquePassed: 9,
  },
  files: sources,
  evidence,
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({ registered: '1.0.53', sources: sources.length, unit: 1874, browser: 9 }),
);
