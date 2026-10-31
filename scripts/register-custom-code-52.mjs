import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { customCodePaths } from './custom-code-release-inputs.mjs';
const dir = '.artifacts/17.4';
const read = (p) => readFileSync(p);
const json = (p) =>
  JSON.parse(
    read(p)
      .toString()
      .replace(/^\uFEFF/, ''),
  );
const hash = (b) => createHash('sha256').update(b).digest('hex');
const proof = (p) => ({ path: p, sha256: hash(read(p)) });
const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const target = 'content/c/p0/blockly-release-1.0.52.json';
assert.equal(existsSync(target), false);
const previous = 'content/c/p0/blockly-release-1.0.51.json',
  prior = json(previous);
assert.equal(
  hash(read(previous)),
  json('项目文档/验收/发布凭据/17.3-1.0.51/index.json').registration.sha256,
);
assert.equal(new Set(customCodePaths).size, customCodePaths.length);
const units = json(`${dir}/unit52.json`),
  browser = json(`${dir}/browser-candidate52.json`),
  quality = json(`${dir}/quality52.json`),
  rust = json(`${dir}/rust-results52.json`);
assert.equal(units.numPassedTests, 1868);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(browser.stats.expected, 35);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.ok(Object.values(quality).every((exit) => exit === 0));
assert.ok(Object.values(rust).every((exit) => exit === 0));
assert.equal(
  [
    ...read(`${dir}/rust-workspace52.log`)
      .toString()
      .matchAll(/test result: ok\. (\d+) passed;/g),
  ].reduce((sum, match) => sum + Number(match[1]), 0),
  543,
);
const sources = customCodePaths.map(proof);
const latest = Math.max(
  ...customCodePaths
    .filter((p) => !p.startsWith('web/src/generated/'))
    .map((p) => statSync(p).mtimeMs),
);
assert.ok(units.startTime >= latest);
assert.ok(Date.parse(browser.stats.startTime) >= latest);
for (const e of Object.values(prior.evidence)) assert.equal(hash(read(e.path)), e.sha256);
assert.equal(hash(read('web/src/generated/c_viz_wasm_bg.wasm')), prior.engine.wasmSha256);
assert.equal(
  hash(read('web/src/generated/memory/c_viz_memory_bg.wasm')),
  prior.memoryEngine.wasmSha256,
);
assert.equal(
  hash(read('web/src/generated/algorithm/c_viz_algorithm_bg.wasm')),
  prior.algorithmEngine.wasmSha256,
);
save(`${dir}/release-review52.json`, {
  task: '17.4',
  sourceCount: sources.length,
  sourceProof: sources,
  unitPassed: 1868,
  candidateChromePassed: 35,
  quality,
  rust,
  scope:
    'Real C workbench adversarial/recovery acceptance; two equivalent let-chain predicates satisfy strict Rust Clippy. Existing C/C++ semantics, fixed budgets, SAVE8 and prior learning identities retained.',
  limitations:
    'Chrome representative theme only; injected Worker/download/packet faults are explicit QA instrumentation; no general C++ editor, new lessons, native user programs or AI.',
});
const archive = '项目文档/验收/发布凭据/17.4-1.0.52';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of ['unit52.json', 'browser-candidate52.json', 'release-review52.json']) {
  const file = name + '.gz',
    path = `${dir}/${file}`;
  writeFileSync(path, gzipSync(read(`${dir}/${name}`)), { flag: 'wx' });
  writeFileSync(`${archive}/${file}`, read(path), { flag: 'wx' });
  const entry = proof(path);
  evidence[name.replace(/[^a-zA-Z]/g, '')] = entry;
  files.push({ ...entry, file });
}
save(target, {
  ...prior,
  releaseVersion: '1.0.52',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.51', ...proof(previous) },
  scope:
    '17.4 bounded C workbench adversarial/recovery acceptance and strict Rust quality closure; prior UI, courses and learning identities retained.',
  reason:
    '1868 full unit checks,35 real Chrome candidate scenarios,543 Rust checks and strict native/WASM Clippy, fixed toolchain build/types/lint/format pass.',
  advancedEngine: {
    id: 'engine.rust.advanced',
    version: '0.1.0',
    wasmSha256: hash(read('web/src/generated/advanced/c_viz_advanced_bg.wasm')),
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 1868,
    candidateUniquePassed: 35,
  },
  files: sources,
  evidence,
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({ registered: '1.0.52', sources: sources.length, unit: 1868, browser: 35 }),
);
