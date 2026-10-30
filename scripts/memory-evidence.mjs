// Closure audit for 12.2; never hashes or stores learner programs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';

const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const allowed = new Set([
  'Cargo.toml',
  'Cargo.lock',
  'scripts/build.mjs',
  'tests/playwright.config.ts',
  'README.md',
  '项目守则.md',
  '项目文档/任务进度与交接.md',
  '项目文档/开发路线与依赖.md',
  '项目文档/需求覆盖与范围裁决.md',
]);
const baseline = json('.artifacts/12.2/baseline.json');
const inheritedPaths = new Set(baseline.files.map((file) => file.path));
const currentFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const added = currentFiles.filter((path) => !inheritedPaths.has(path));
let preserved = 0;
const changed = [];
for (const file of baseline.files) {
  assert.ok(existsSync(file.path), `Missing inherited file: ${file.path}`);
  if (sha(file.path) === file.sha256) preserved++;
  else {
    assert.ok(allowed.has(file.path), `Unauthorized inherited change: ${file.path}`);
    changed.push(file.path);
  }
}
for (const file of json('.artifacts/12.2/old-engine-baseline.json'))
  assert.equal(sha(file.path), file.sha256, file.path);
const registration = json('content/c/p0/blockly-release-1.0.16.json');
for (const file of registration.files) assert.equal(sha(file.path), file.sha256, file.path);
const wasm = json('.artifacts/12.2/wasm-build.json');
assert.equal(sha('web/src/generated/memory/c_viz_memory_bg.wasm'), wasm.wasmSha256);
assert.equal(wasm.memories.length, 1);
assert.equal(wasm.memories[0].maximum, 2048);
const sample = json('.artifacts/12.2/public-samples-release.json');
assert.equal(sample.accepted, true);
assert.equal(sample.reports.length, 14);
assert.equal(sample.buildId, wasm.wasmSha256);
for (const row of sample.reports) assert.equal(row.canonicalBytes, true);
const schema = json('.artifacts/12.2/schema-release.json');
assert.equal(schema.length, 28);
for (const row of schema) assert.equal(row.valid, true);
const unit = json('.artifacts/12.2/frontend-release.json');
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 1344);
assert.equal(unit.numPendingTests, 0);
const rustLog = readFileSync('.artifacts/12.2/rust-final.log', 'utf8');
const rust = [
  ...rustLog.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored/g),
].reduce((sum, row) => sum.map((n, i) => n + Number(row[i + 1])), [0, 0, 0]);
assert.deepEqual(rust, [501, 0, 1]);
const quality = json('.artifacts/12.2/quality-release.json');
assert.equal(quality.node, 'v24.21.0');
assert.deepEqual(
  quality.checks.map((check) => check.name).sort(),
  ['build', 'format', 'lint', 'types', 'unit'].sort(),
);
for (const check of quality.checks) {
  assert.equal(check.exitCode, 0, check.name);
  assert.equal(sha(check.path), check.sha256, check.name);
}
const browserPath = '.artifacts/12.2/memory-browser-performance-release.json';
const browser = json(browserPath);
assert.equal(browser.stats.expected, 9);
for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(browser.stats[key], 0);
const browserRun = json('.artifacts/12.2/memory-browser-performance-release-run.json');
assert.equal(browserRun.node, 'v24.21.0');
for (const file of browserRun.files) assert.equal(sha(file.path), file.sha256, file.path);
const algorithmPath = '.artifacts/12.1/algorithm-browser-memory-legacy.json';
const algorithm = json(algorithmPath);
assert.equal(algorithm.stats.expected, 8);
for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(algorithm.stats[key], 0);
const legacyPath = '.artifacts/P0.5-10/browser-memory-legacy.json';
const legacy = json(legacyPath);
assert.equal(legacy.status, 'passed');
assert.equal(legacy.scenarios, 10);
for (const file of legacy.reports) {
  assert.equal(sha(file.path), file.sha256, file.path);
  const report = json(file.path);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
}
const fixturePath = '项目文档/契约/12.2-共享样例索引.json';
const fixtures = json(fixturePath);
assert.equal(fixtures.entries.length, 6);
for (const entry of fixtures.entries)
  assert.equal(sha(resolve(dirname(fixturePath), entry.path)), entry.sha256, entry.id);
const change = json('项目文档/契约/12.2-兼容变更登记.json');
assert.equal(change.status, 'accepted');
assert.deepEqual(change.approvals.map((a) => a.role).sort(), [...change.requiredOwnerRoles].sort());
for (const approval of change.approvals) assert.equal(approval.decision, 'accepted');
const docs = [
  'README.md',
  '项目守则.md',
  '项目文档/任务进度与交接.md',
  '项目文档/开发路线与依赖.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/架构决策/12.2-虚拟内存与受限指针.md',
  '项目文档/契约/12.2-内存执行与可逆对象.md',
  '项目文档/验收/12.2-虚拟内存与受限指针验收.md',
  '项目文档/交接/12.2-交接.md',
];
const ledger = readFileSync('项目文档/任务进度与交接.md', 'utf8');
const tasks = [
  ...ledger.matchAll(
    /^\| (\d{2}\.\d+) \| (?:P[012]|后续多语言) \|[^\n]+?\| (已验收|进行中|未开始) \|/gm,
  ),
];
assert.equal(tasks.length, 98);
assert.equal(new Set(tasks.map((task) => task[1])).size, 98);
assert.equal(tasks.filter((task) => task[2] === '已验收').length, 45);
assert.equal(tasks.filter((task) => task[1].startsWith('21.') && task[2] === '未开始').length, 10);
assert.equal(tasks.find((task) => task[1] === '12.2')[2], '已验收');
assert.equal(tasks.find((task) => task[1] === '12.3')[2], '未开始');
let links = 0;
for (const file of docs)
  for (const match of readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const resolved = resolve(dirname(file), target);
    // The index is this script's output; every other target must already exist.
    if (resolved !== resolve('.artifacts/12.2/evidence-final.json'))
      assert.ok(existsSync(resolved), `${file}: ${target}`);
    links++;
  }
assert.equal(
  execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim(),
  '',
);
execFileSync('git', ['-c', 'core.whitespace=cr-at-eol', 'diff', '--check'], { encoding: 'utf8' });
const compressedEngineBytes = [
  'web/src/generated/memory/c_viz_memory_bg.wasm',
  'web/src/generated/memory/c_viz_memory.js',
].reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0);
assert.ok(compressedEngineBytes <= 524288);
const sources = [
  'Cargo.toml',
  'Cargo.lock',
  'engine/memory/Cargo.toml',
  'engine/memory/src/lib.rs',
  'engine/memory/src/runtime.rs',
  'engine/memory/src/syntax.rs',
  'engine/memory/tests/memory_runtime_acceptance.rs',
  'engine/memory-wasm/Cargo.toml',
  'engine/memory-wasm/src/lib.rs',
  'scripts/build-memory-wasm.mjs',
  'scripts/build.mjs',
  ...['protocol', 'client', 'module', 'worker', 'player'].map(
    (part) => `web/src/engine/memory-${part}.ts`,
  ),
  'tests/browser/memory-engine.spec.ts',
  'tests/playwright.config.ts',
];
const evidence = {
  task: '12.2',
  date: '2026-10-30',
  status: 'accepted',
  inheritedBaseline: { preserved, changed, deleted: 0 },
  addedFiles: added.map((path) => ({ path, sha256: sha(path) })),
  oldEngines: json('.artifacts/12.2/old-engine-baseline.json'),
  oldRegisteredSources: registration.files.length,
  wasmSha256: wasm.wasmSha256,
  wasmBytes: wasm.wasmBytes,
  compressedEngineBytes,
  rust: { passed: rust[0], failed: rust[1], originalIgnored: rust[2] },
  frontend: unit.numPassedTests,
  quality,
  chrome: [
    { path: browserPath, passed: 9 },
    { path: algorithmPath, passed: 8 },
    { path: legacyPath, passed: 10 },
  ],
  publicRuns: sample.reports.map((r) => ({
    name: r.name,
    status: r.result.terminal.status,
    code: r.result.terminal.code,
    bytes: r.bytes,
    rustCallMs: r.rustCallMs,
  })),
  schemaPackets: schema.length,
  checkedLinks: links,
  acceptedTasks: { original: '45/88', main: '45/98', p05: '9/9', step21: '0/10' },
  sources: sources.map((path) => ({ path, sha256: sha(path) })),
  stagedFiles: 0,
};
writeFileSync('.artifacts/12.2/evidence-final.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(
  JSON.stringify({
    preserved,
    modified: changed.length,
    rust: rust[0],
    frontend: unit.numPassedTests,
    chrome: 27,
    publicRuns: 14,
    oldEnginesPreserved: true,
  }),
);
