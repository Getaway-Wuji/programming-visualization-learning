import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { phase2Paths } from './phase2-release-inputs.mjs';

const dir = '.artifacts/16.10',
  workspace = `${dir}/clean-workspace`;
const read = (p) => readFileSync(p),
  sha = (b) => createHash('sha256').update(b).digest('hex');
const json = (p) =>
  JSON.parse(
    read(p)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const proof = (p) => ({ path: p, sha256: sha(read(p)) });
const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const target = 'content/c/p0/blockly-release-1.0.46.json',
  previous = 'content/c/p0/blockly-release-1.0.45.json';
assert.equal(existsSync(target), false);
assert.equal(phase2Paths.length, 299);
assert.equal(new Set(phase2Paths).size, 299);
const baseline = json(`${dir}/baseline.json`),
  prior = json(previous),
  inherited = json('.artifacts/16.9/inherited-engines.json');
assert.equal(
  sha(read(previous)),
  json('项目文档/验收/发布凭据/16.10-1.0.45/index.json').registration.sha256,
);
for (const item of prior.files) {
  const backup = dir + '/product45-before/' + item.path;
  assert.equal(sha(read(existsSync(backup) ? backup : item.path)), item.sha256, item.path);
}
assert.equal(sha(read(baseline.external.path)), baseline.external.sha256);
for (const item of [
  ...inherited.protectedFiles,
  ...inherited.wasm,
  ...Object.values(prior.evidence),
])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const sources = phase2Paths.map(proof),
  latest = Math.max(...phase2Paths.map((p) => statSync(p).mtimeMs));
for (const item of sources)
  assert.equal(sha(read(`${workspace}/${item.path}`)), item.sha256, item.path);
for (const item of inherited.wasm)
  assert.equal(sha(read(`${workspace}/${item.path}`)), item.sha256, item.path);
const units = json(`${dir}/r1610-units-ninth.json`);
assert.equal(units.numTotalTests, 1841);
assert.equal(units.numPassedTests, 1841);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.ok(units.startTime >= latest);
const browser = json(`${dir}/r1610-cpp-candidate46-third.json`);
assert.equal(browser.stats.expected, 14);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
assert.ok(Date.parse(browser.stats.startTime) >= latest);
const specs = (suites) => suites.flatMap((s) => [...(s.specs ?? []), ...specs(s.suites ?? [])]);
for (const spec of specs(browser.suites)) {
  assert.equal(spec.ok, true);
  assert.equal(spec.tests.length, 1);
  assert.equal(spec.tests[0].projectName, 'chrome');
  assert.equal(spec.tests[0].results.length, 1);
  assert.equal(spec.tests[0].results[0].status, 'passed');
  assert.equal(spec.tests[0].results[0].retry, 0);
}
for (const label of [
  'r1610-build-candidate46-third',
  'r1610-type-tenth',
  'r1610-lint-eighth',
  'r1610-format-eighth',
])
  assert.equal(Number(read(`${dir}/${label}.exit`).toString().trim()), 0, label);
const perf = json(`${workspace}/.artifacts/11.4/r1610-perf-pilot-eleventh/measurements.json`);
assert.equal(perf.qualification.satisfied, true);
assert.deepEqual(perf.failures, []);
assert.equal(perf.execution.length, 12);
assert.ok(perf.navigation.every((r) => r.passed));
assert.ok(
  perf.execution.every(
    (r) =>
      r.valid &&
      r.groupWithinUnchangedDeadline &&
      r.executionPartitions.every(
        (p) => p.elapsedMs !== null && p.elapsedMs <= p.acceptedThresholdMs,
      ),
  ),
);
save(`${dir}/candidate46-build.json`, json(`${workspace}/.artifacts/16.10/course-build.json`));
save(`${dir}/candidate46-source-proof.json`, {
  task: '16.10',
  sources,
  wasm: inherited.wasm,
  latestSourceAt: new Date(latest).toISOString(),
  isolatedSourceBuild: true,
  sharedInstallCaches: ['node_modules', '.tools'],
  notFreshMachineInstall: true,
});
save(`${dir}/inherited-engines46.json`, {
  ...inherited,
  task: '16.10',
  inheritedFrom: proof('.artifacts/16.9/inherited-engines.json'),
  fullRustSuiteRerun: false,
});
save(`${dir}/candidate46-performance.json`, perf);
save(`${dir}/release46-review.json`, {
  task: '16.10',
  frontendPassed: 1841,
  candidateCppPassed: 14,
  latestSourceAt: new Date(latest).toISOString(),
  scope:
    'Equivalent boundary optimizations plus warm P05 publication-state recovery: verified public-byte HTTP cache with bounded stale reload, intent-triggered parallel Worker/WASM preparation, strict lexical canonical proof without duplicate whole-tree encoding, bounded scalar-record lexical specialization and folded separator/key/value dispatch. A verified current P05 archive with no pending writes withdraws only a resolved transient publication error. Same three Rust/WASM, exact source, closed schemas, all identities, full forward/inverse checks, global slot and original deadlines/budgets/SAVE7.',
  controlledSemanticAdapter:
    'memory-bugs unit now controls both now and its timers as originally declared; native browser remains the real deadline proof.',
  pilotOnly: true,
  formalCurrentCoursePending: true,
  formalWarmArchiveFixPending: true,
  formalPerformancePending: true,
  compoundBoundary:
    'Raw group click→two-rAF values and original500/800/600 predicates retained, including deviations. Continuous partitions omit no wait. Pilot is not an overall P1 performance acceptance.',
  previousFailuresPreserved: [
    'formal45 warm publication mismatch and6/10 cold C-pair invalids, plus3 diagnostic batches; all original120 transactions retained',
    'core-first four QA preconditions',
    'core-fixes real maximum deadline',
    'performance pilots1–7 and CPU diagnosis',
    '1836 units second/third two controlled-clock timer mismatches',
    'type/format/setup and earlier unit failures',
  ],
});
const names = [
  'r1610-units-ninth.json',
  'r1610-cpp-candidate46-third.json',
  'candidate46-build.json',
  'candidate46-source-proof.json',
  'inherited-engines46.json',
  'candidate46-performance.json',
  'release46-review.json',
];
const evidence = Object.fromEntries(
  names.map((n, i) => [`phase2Gate${i + 1}`, proof(`${dir}/${n}`)]),
);
save(target, {
  ...prior,
  releaseVersion: '1.0.46',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.45', ...proof(previous) },
  scope:
    '16.10 P1 integration candidate with equivalent browser boundary performance repairs; no new language, algorithm, learning identity or migration.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 1841,
    candidateUniquePassed: 14,
  },
  reason:
    'Current frontend unit/static/source and14 exact-source real C++ candidate checks pass. Qualified finite pilot retains all slow/failure history. Formal registered46 P1 integrated gates and full performance remain mandatory.',
  supplementalReason:
    'Rust507 passed/1 original ignored inherited by protected source and all3 WASM SHA, not rerun. Immutable35–45 and prior receipts retained.',
  files: sources,
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.10-1.0.46';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.46',
    sources: 299,
    frontend: 1841,
    candidateCpp: 14,
    formalPending: true,
  }),
);
