// Read-only closure checks for 12.1 and the inherited uncommitted planning work.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const baseline = json('.artifacts/12.1/baseline.json');
const allowed = new Set([
  'Cargo.toml',
  'Cargo.lock',
  'scripts/build.mjs',
  'web/src/engine/module.ts',
  'tests/browser/practice-experience.spec.ts',
  'tests/playwright.config.ts',
  'README.md',
  '项目守则.md',
  '项目文档/任务进度与交接.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/开发路线与依赖.md',
]);
const changed = [],
  preserved = [];
for (const file of baseline.files) {
  assert.ok(existsSync(file.path), `Baseline file disappeared: ${file.path}`);
  if (sha(file.path) === file.sha256) preserved.push(file.path);
  else {
    assert.ok(allowed.has(file.path), `Unauthorized baseline change: ${file.path}`);
    changed.push(file.path);
  }
}
const registration = json('content/c/p0/blockly-release-1.0.16.json');
for (const file of registration.files) assert.equal(sha(file.path), file.sha256, file.path);
assert.equal(sha('web/src/generated/c_viz_wasm_bg.wasm'), registration.engine.wasmSha256);
const wasm = json('.artifacts/12.1/wasm-build.json');
assert.equal(sha('web/src/generated/algorithm/c_viz_algorithm_bg.wasm'), wasm.wasmSha256);
assert.equal(wasm.memories.length, 1);
assert.equal(wasm.memories[0].maximum, 2048);
const sample = json('.artifacts/12.1/public-samples-address.json');
assert.equal(sample.accepted, true);
assert.equal(sample.reports.length, 9);
assert.equal(sample.buildId, wasm.wasmSha256);
const unit = json('.artifacts/12.1/frontend-current.json');
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
const browser = json('.artifacts/12.1/algorithm-browser-address.json');
assert.equal(browser.stats.expected, 8);
for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(browser.stats[key], 0);
const browserRun = json('.artifacts/12.1/algorithm-browser-address-run.json');
for (const file of browserRun.files) assert.equal(sha(file.path), file.sha256, file.path);
const legacy = json('.artifacts/P0.5-10/browser-p1-legacy-release.json');
assert.equal(legacy.status, 'passed');
assert.equal(legacy.scenarios, 10);
for (const file of legacy.reports) {
  assert.equal(sha(file.path), file.sha256, file.path);
  const report = json(file.path);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
}
const schema = json('.artifacts/12.1/schema-address.json');
assert.equal(schema.length, 18);
for (const packet of schema) assert.equal(packet.valid, true);
const change = json('项目文档/契约/12.1-兼容变更登记.json');
assert.equal(change.status, 'accepted');
assert.deepEqual(
  change.approvals.map((approval) => approval.role).sort(),
  [...change.requiredOwnerRoles].sort(),
);
for (const approval of change.approvals) assert.equal(approval.decision, 'accepted');
const fixturePath = '项目文档/契约/12.1-共享样例索引.json';
const fixtures = json(fixturePath);
assert.equal(fixtures.entries.length, 5);
for (const fixture of fixtures.entries)
  assert.equal(sha(resolve(dirname(fixturePath), fixture.path)), fixture.sha256, fixture.id);
const rustLog = readFileSync('.artifacts/12.1/rust-release.log', 'utf8');
const rustTotals = [
  ...rustLog.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored/g),
].reduce((sum, row) => sum.map((value, index) => value + Number(row[index + 1])), [0, 0, 0]);
assert.deepEqual(rustTotals, [475, 0, 1]);
const sourceFiles = [
  'Cargo.toml',
  'Cargo.lock',
  'engine/algorithm/src/lib.rs',
  'engine/algorithm/src/p1.rs',
  'engine/algorithm/src/p1_syntax.rs',
  'engine/algorithm/tests/p1_runtime_acceptance.rs',
  'engine/algorithm-wasm/src/lib.rs',
  'engine/algorithm-wasm/Cargo.toml',
  'engine/algorithm/Cargo.toml',
  'scripts/build-algorithm-wasm.mjs',
  'scripts/build.mjs',
  'web/src/engine/module.ts',
  'web/src/engine/algorithm-protocol.ts',
  'web/src/engine/algorithm-client.ts',
  'web/src/engine/algorithm-player.ts',
  'web/src/engine/algorithm-worker.ts',
  'web/src/engine/algorithm-module.ts',
  'tests/browser/algorithm-engine.spec.ts',
  'tests/browser/practice-experience.spec.ts',
  'tests/playwright.config.ts',
];
const docs = [
  '项目文档/架构决策/12.1-函数递归与算法C++子集.md',
  '项目文档/契约/12.1-算法执行与递归轨迹.md',
  '项目文档/验收/12.1-函数递归与C++算法底座验收.md',
  '项目文档/交接/12.1-交接.md',
];
let links = 0;
for (const path of docs) {
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(existsSync(resolve(dirname(path), target)), `${path}: ${target}`);
    links++;
  }
}
assert.equal(
  execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim(),
  '',
);
execFileSync('git', ['-c', 'core.whitespace=cr-at-eol', 'diff', '--check'], { encoding: 'utf8' });
const engineGzip = [
  'web/src/generated/algorithm/c_viz_algorithm_bg.wasm',
  'web/src/generated/algorithm/c_viz_algorithm.js',
].reduce((sum, path) => sum + gzipSync(readFileSync(path)).length, 0);
assert.ok(engineGzip <= 524288);
const evidence = {
  task: '12.1',
  status: 'accepted',
  date: '2026-10-30',
  inheritedBaseline: { preserved: preserved.length, authorizedChanged: changed, deleted: 0 },
  oldRegistrationSourcesPreserved: registration.files.length,
  oldWasmSha256: registration.engine.wasmSha256,
  algorithmWasmSha256: wasm.wasmSha256,
  algorithmWasmBytes: wasm.wasmBytes,
  engineAndGlueGzipBytes: engineGzip,
  unitTests: unit.numPassedTests,
  rustTests: { passed: rustTotals[0], failed: rustTotals[1], originalIgnored: rustTotals[2] },
  chromeAlgorithmTests: browser.stats.expected,
  chromeLegacyTests: legacy.scenarios,
  chromeLegacyEvidence: '.artifacts/P0.5-10/browser-p1-legacy-release.json',
  legacyConflictDiagnosis: '.artifacts/12.1/legacy-regression-diagnosis.json',
  schemaPackets: schema.length,
  fixtureEntries: fixtures.entries.length,
  ownerRoleApprovals: change.approvals.length,
  sampleRuns: sample.reports.map((row) => ({
    name: row.name,
    bytes: row.bytes,
    rustCallMs: row.rustCallMs,
    status: row.result.terminal.status,
  })),
  documentLinksChecked: links,
  stagedFiles: 0,
  sources: sourceFiles.map((path) => ({ path, sha256: sha(path) })),
};
writeFileSync('.artifacts/12.1/evidence-final.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(
  JSON.stringify({
    preserved: preserved.length,
    modified: changed.length,
    unit: unit.numPassedTests,
    chrome: browser.stats.expected,
    samples: sample.reports.length,
    oldWasmPreserved: true,
  }),
);
