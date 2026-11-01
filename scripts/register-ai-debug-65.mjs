import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { aiDebugPaths } from './ai-debug-release-inputs.mjs';

const dir = '.artifacts/19.4';
const priorPath = 'content/c/p0/blockly-release-1.0.64.json';
const target = 'content/c/p0/blockly-release-1.0.65.json';
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
assert.equal(existsSync(target), false);
const prior = json(priorPath);
const units = json(`${dir}/unit-full-r3.json`);
const browser = json(`${dir}/browser-candidate-r7.json`);
const quality = json(`${dir}/quality-r2.json`);
assert.equal(
  sha(read(priorPath)),
  json('项目文档/验收/发布凭据/19.2-1.0.64/index.json').registration.sha256,
);
for (const entry of Object.values(prior.evidence))
  assert.equal(sha(read(entry.path)), entry.sha256);
assert.equal(units.numPassedTests, 2138);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(units.numFailedTestSuites, 0);
assert.equal(units.success, true);
assert.equal(browser.stats.expected, 21);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.deepEqual(Object.values(quality).sort(), [0, 0, 0]);
assert.match(read(`${dir}/rust-test-final.log`).toString(), /12 passed; 0 failed/);
assert.doesNotMatch(read(`${dir}/rust-test-final.log`).toString(), /test result: FAILED/);
assert.doesNotMatch(read(`${dir}/rust-clippy-final.log`).toString(), /error:/);
for (const [key, path] of [
  ['engine', 'web/src/generated/c_viz_wasm_bg.wasm'],
  ['memoryEngine', 'web/src/generated/memory/c_viz_memory_bg.wasm'],
  ['algorithmEngine', 'web/src/generated/algorithm/c_viz_algorithm_bg.wasm'],
  ['advancedEngine', 'web/src/generated/advanced/c_viz_advanced_bg.wasm'],
  ['generatorEngine', 'web/src/generated/practice/c_viz_practice_bg.wasm'],
])
  assert.equal(sha(read(path)), prior[key].wasmSha256);
assert.equal(new Set(aiDebugPaths).size, 451);
const sources = aiDebugPaths.map(proof);
const frozen = json(`${dir}/source-freeze-r3.json`);
assert.deepEqual(
  sources,
  frozen.files.map(({ path, sha256 }) => ({ path, sha256 })),
);
const latest = Math.max(...aiDebugPaths.map((path) => statSync(path).mtimeMs));
assert.ok(units.startTime >= latest, 'Unit checks predate a source edit');
assert.ok(Date.parse(browser.stats.startTime) >= latest, 'Browser checks predate a source edit');
const review = {
  task: '19.4',
  sources,
  quality,
  frontendPassed: 2138,
  candidateChromePassed: 21,
  separateRustProxyPassed: 12,
  officialProviderRequests: 0,
  taskAccepted: false,
  scope:
    'Optional default-off own-Key API debugging; transient per-tab credentials, fixed same-origin Rust gateway, exact original C interpreter facts and consented minimal snippets, strict local response validation and fact navigation. SAVE9/DB9/17 stores unchanged.',
  limitations:
    'Engineering source review only. Browser provider answers are explicitly simulated; native Rust gateway uses test-only local upstreams. Real official API pointer/loop/no-trace successful explanations with a user-provided valid Key remain mandatory for 19.4 acceptance. No task-count increment or 19.5 authorization.',
};
save(`${dir}/release-review65.json`, review);
const archive = '项目文档/验收/发布凭据/19.4-1.0.65';
mkdirSync(archive, { recursive: true });
const evidence = {};
const files = [];
for (const name of ['unit-full-r3.json', 'browser-candidate-r7.json', 'release-review65.json']) {
  const file = `${name}.gz`;
  const path = `${dir}/${file}`;
  const bytes = gzipSync(read(`${dir}/${name}`));
  writeFileSync(path, bytes, { flag: 'wx' });
  writeFileSync(`${archive}/${file}`, bytes, { flag: 'wx' });
  const entry = proof(path);
  evidence[name.replace(/[^a-zA-Z]/g, '')] = entry;
  files.push({ ...entry, file });
}
save(target, {
  ...prior,
  releaseVersion: '1.0.65',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.64', ...proof(priorPath) },
  scope: review.scope,
  reason:
    '2138 frontend units, 21 candidate Chrome cases, 12 separate native Rust gateway tests, types/lint/format and full candidate build. Independent engineering source registration; real API acceptance remains explicitly pending.',
  aiGateway: {
    wireVersion: '2.0.0',
    defaultEnabled: false,
    ownKeyRequired: true,
    credentialPersistence: 'none; per-tab memory only',
    officialProviderRequestsObserved: 0,
    taskAccepted: false,
    executable: proof('server/ai-proxy/target/release/c-viz-ai-proxy.exe'),
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 2138,
    candidateUniquePassed: 21,
  },
  files: sources,
  evidence,
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
const sourceArchive = `${dir}/sources-65`;
mkdirSync(sourceArchive, { recursive: true });
const frozenFiles = sources.map((entry, index) => {
  const file = `${String(index).padStart(4, '0')}.gz`;
  writeFileSync(`${sourceArchive}/${file}`, gzipSync(read(entry.path)), { flag: 'wx' });
  return { ...entry, file };
});
save(`${sourceArchive}/index.json`, { registration: proof(target), files: frozenFiles });
console.log(JSON.stringify({ registered: '1.0.65', sources: 451, taskAccepted: false }));
