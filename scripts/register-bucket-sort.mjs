// Immutable successor for the real bounded C++ bucket case; predecessor proofs are preserved.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { bucketSortPaths } from './bucket-sort-release-inputs.mjs';
import { validateBucketSort } from './bucket-sort-content.mjs';
const dir = '.artifacts/16.6',
  read = (p) => readFileSync(p),
  json = (p) =>
    JSON.parse(
      read(p)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (p) => ({ path: p, sha256: sha(read(p)) }),
  save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const target = 'content/c/p0/blockly-release-1.0.41.json',
  priorPath = 'content/c/p0/blockly-release-1.0.40.json',
  prior = json(priorPath);
assert.equal(existsSync(target), false);
assert.equal(bucketSortPaths.length, 257);
const baseline = json(`${dir}/baseline.json`);
for (const item of [...baseline.prior, baseline.external, ...Object.values(prior.evidence)])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const inherited = json('.artifacts/16.5/inherited-engines.json');
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
// The build rewrites this inherited C source projection even when its bytes are unchanged.
// Keep its full source SHA in the registration and prove equality to the frozen predecessor;
// a timestamp-only rewrite is not a new implementation after the tests.
const regeneratedPath = 'web/src/generated/prepared-sources.ts';
const regeneratedBaseline = prior.files.find((item) => item.path === regeneratedPath);
const unchangedRegeneration =
  regeneratedBaseline && sha(read(regeneratedPath)) === regeneratedBaseline.sha256;
const latest = Math.max(
    ...bucketSortPaths
      .filter((p) => p !== regeneratedPath || !unchangedRegeneration)
      .map((p) => statSync(p).mtimeMs),
  ),
  units = json(`${dir}/r166-units-final.json`);
assert.equal(units.numTotalTests, 94);
assert.equal(units.numPassedTests, 94);
assert.equal(units.numPendingTests, 0);
assert.ok(units.startTime >= latest);
const candidate = json(`${dir}/r166-candidate-final.json`);
assert.equal(candidate.stats.expected, 28);
assert.equal(candidate.stats.unexpected + candidate.stats.skipped + candidate.stats.flaky, 0);
assert.deepEqual(candidate.errors, []);
assert.ok(Date.parse(candidate.stats.startTime) >= latest);
const cases = (suites) => suites.flatMap((s) => [...(s.specs ?? []), ...cases(s.suites ?? [])]);
for (const spec of cases(candidate.suites)) {
  assert.equal(spec.ok, true, spec.title);
  assert.equal(spec.tests.length, 1);
  assert.equal(spec.tests[0].projectName, 'chrome');
  assert.equal(spec.tests[0].results.length, 1);
  assert.equal(spec.tests[0].results[0].status, 'passed');
  assert.equal(spec.tests[0].results[0].retry, 0);
}
const visual = json(`${dir}/taste/first/report.json`);
assert.equal(visual.findings.filter((f) => f.level === 'FAIL').length, 0);
assert.deepEqual(
  visual.findings.map((f) => [f.level, f.id]),
  [['WARN', 'below-fold']],
);
assert.ok(Date.parse(visual.at) >= latest);
assert.deepEqual(
  visual.viewports.map((v) => v.width),
  [1440, 768, 390],
);
for (const label of [
  'r166-typecheck-timing',
  'r166-lint-final',
  'r166-format-final',
  'r166-lint-final-test',
  'r166-lint-register-final',
  'r166-ui-lint-final',
  'r166-build-candidate-final',
  'r166-visual-first',
])
  assert.equal(Number(read(`${dir}/${label}.exit`).toString().trim()), 0, label);
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  task: '16.6',
  inheritedFrom: proof('.artifacts/16.5/inherited-engines.json'),
  fullRustSuiteRerun: false,
});
save(`${dir}/content-review.json`, validateBucketSort());
save(`${dir}/visual.json`, {
  task: '16.6',
  report: visual,
  fail: 0,
  warn: 1,
  defendedWarning: {
    id: 'below-fold',
    reason:
      'Existing paired code/trace teaching workbench intentionally keeps full source, original array, five real bucket groups and physical layout available by scrolling. Controls/explanation/counters start in the desktop fold; this is not an urgent dashboard. No hidden content, clipping or page overflow; all three widths use real values and keyboard controls. Keep accepted workbench structure instead of compressing or duplicating data to satisfy the generic block-count heuristic.',
  },
});
save(`${dir}/candidate-build.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review.json`, {
  task: '16.6',
  latestSourceAt: new Date(latest).toISOString(),
  contract: 'ALG-CASE-01 1.2.0',
  scope:
    'One real C++ integer bucket sort,5 fixed bins over-20..29,0..30 input values,5 independent30-slot segments in uninitialized bucketData[150], zeroed bucketSizes[5], stable per-bucket insertion and ordered copyback. Existing Algorithm P1 exact-source execution and same-cursor state, actual pending append before size increment, physical620byte auxiliary arrays and virtual layout. No frontend classification/sorting, pointers, heap, protocol/engine/budget/SAVE/learning changes.',
  frontend: 94,
  candidateUniquePassed: 28,
  visual: proof(`${dir}/visual.json`),
  failureReportsPreserved: ['unit-engine-first'],
  registrationSetupFailure: {
    reports: ['r166-register-41', 'r166-register-41-second'],
    reason:
      'Build rewrote the byte-identical inherited prepared-sources projection4 seconds after the unit run started. The Git opening baseline excludes this generated file; the frozen1.0.40 source SHA proves no content change. Both rejected attempts are preserved, and the source remains fully pinned in the257-file registration.',
  },
  byteIdenticalRegeneration: unchangedRegeneration
    ? {
        ...proof(regeneratedPath),
        predecessor40Sha256: regeneratedBaseline.sha256,
        regeneratedAt: new Date(statSync(regeneratedPath).mtimeMs).toISOString(),
      }
    : null,
  initializationClarification:
    'Initial zero-initialized data was valid but same-value writes do not always generate cell deltas. Unused data slots now remain uninitialized, ensuring every first append including zero has its actual null-to-value change; every read stays within the initialized logical prefix. Source/budget/domain/capacity otherwise unchanged.',
  formalCurrentCoursePending: true,
});
const evidence = Object.fromEntries(
  [
    'r166-units-final.json',
    'r166-candidate-final.json',
    'candidate-build.json',
    'content-review.json',
    'visual.json',
    'inherited-engines.json',
    'release-review.json',
  ].map((n, i) => [`bucketSortGate${i + 1}`, proof(`${dir}/${n}`)]),
);
const algorithmBytes = read('web/src/generated/algorithm/c_viz_algorithm_bg.wasm');
save(target, {
  ...prior,
  releaseVersion: '1.0.41',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.40', ...proof(priorPath) },
  scope:
    '16.6 one bounded C++ bucket sorting case and actual slot/layout teaching; no learning authority or migration.',
  algorithmEngine: {
    wasmSha256: sha(algorithmBytes),
    wasmBytes: algorithmBytes.length,
    execVersion: '1.2.0',
    dslVersion: '1.1.0',
    diagnosticVersion: '1.1.0',
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 94,
    candidateUniquePassed: 28,
  },
  reason:
    '94 affected unit tests,28 actual Chrome candidate scenarios, original five C++ cases and both comparison boundaries pass. Three-width Inspector0FAIL/1 justified below-fold WARN, source UI lint clean; formal41 current-course gates remain separately required.',
  supplementalReason:
    'The existing bounded int-array P1 path is sufficient; no MemoryState casts, new language capability, engine changes or budget increases.',
  files: bucketSortPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.6-1.0.41';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.41',
    sources: 257,
    frontend: 94,
    candidateUnique: 28,
    formalPending: true,
  }),
);
