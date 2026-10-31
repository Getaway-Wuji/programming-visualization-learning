import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { customCodePaths } from './custom-code-release-inputs.mjs';
const dir = '.artifacts/17.3';
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
const target = 'content/c/p0/blockly-release-1.0.51.json';
assert.equal(existsSync(target), false);
const previous = 'content/c/p0/blockly-release-1.0.50.json',
  prior = json(previous);
assert.equal(
  hash(read(previous)),
  json('项目文档/验收/发布凭据/17.3-1.0.50/index.json').registration.sha256,
);
assert.equal(new Set(customCodePaths).size, customCodePaths.length);
const units = json(`${dir}/unit-51.json`),
  browser = json(`${dir}/browser-51-candidate.json`),
  quality = json(`${dir}/quality-51.json`);
assert.equal(units.numPassedTests, 1865);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(browser.stats.expected, 12);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.ok(quality.every((c) => c.exit === 0));
const sources = customCodePaths.map(proof);
const latest = Math.max(
  ...customCodePaths
    .filter((p) => !p.startsWith('web/src/generated/'))
    .map((p) => statSync(p).mtimeMs),
);
assert.ok(units.startTime >= latest, 'Unit proof must cover final registered sources');
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
save(`${dir}/release-review-51.json`, {
  task: '17.3',
  sourceCount: sources.length,
  sourceProof: sources,
  unitPassed: 1865,
  candidateChromePassed: 12,
  quality,
  scope:
    'C-only custom workbench; aggregate C struct labels and exact-source advanced Rust execution; line breakpoints and one reversible cursor; SAVE8 DB8 16 stores and explicit bounded source draft.',
  limitations:
    'Chrome/minimal only; full adversarial workbench matrix remains17.4; no C++ general editor, new lessons or rewards.',
});
const archive = '项目文档/验收/发布凭据/17.3-1.0.51';
mkdirSync(archive, { recursive: true });
const evidence = {},
  files = [];
for (const name of ['unit-51.json', 'browser-51-candidate.json', 'release-review-51.json']) {
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
  releaseVersion: '1.0.51',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.50', ...proof(previous) },
  scope:
    '17.3 C custom code workbench and SAVE8 source draft; prior UI, courses and learning identities retained.',
  reason:
    '1865 full unit checks,12 real Chrome candidate scenarios and fixed toolchain build/types/lint/format pass.',
  advancedEngine: {
    id: 'engine.rust.advanced',
    version: '0.1.0',
    wasmSha256: hash(read('web/src/generated/advanced/c_viz_advanced_bg.wasm')),
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 1865,
    candidateUniquePassed: 12,
  },
  files: sources,
  evidence,
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({ registered: '1.0.51', sources: sources.length, unit: 1865, browser: 12 }),
);
