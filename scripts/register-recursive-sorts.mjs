// New immutable successor for the reviewed recursive C++ cases and real paired adapter.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { recursiveSortPaths } from './recursive-sort-release-inputs.mjs';
import { validateRecursiveSorts } from './recursive-sort-content.mjs';
const dir = '.artifacts/16.5',
  read = (path) => readFileSync(path),
  json = (path) =>
    JSON.parse(
      read(path)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, sha256: sha(read(path)) }),
  save = (path, value) =>
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const target = 'content/c/p0/blockly-release-1.0.40.json',
  priorPath = 'content/c/p0/blockly-release-1.0.39.json',
  prior = json(priorPath);
assert.equal(existsSync(target), false);
assert.equal(recursiveSortPaths.length, 250);
const baseline = json(`${dir}/baseline.json`);
for (const item of [...baseline.prior, baseline.external, ...Object.values(prior.evidence)])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const inherited = json('.artifacts/16.4/inherited-engines.json');
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const latest = Math.max(...recursiveSortPaths.map((path) => statSync(path).mtimeMs));
const units = json(`${dir}/units-final.json`);
assert.equal(units.numTotalTests, 132);
assert.equal(units.numPassedTests, 132);
assert.equal(units.numPendingTests, 0);
assert.ok(units.startTime >= latest);
const candidate = json(`${dir}/r165-candidate-current.json`);
assert.equal(candidate.stats.expected, 82);
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
const visuals = ['merge-final', 'pair-final'].map((name) =>
  json(`${dir}/taste/${name}/report.json`),
);
for (const visual of visuals) {
  assert.deepEqual(visual.findings, []);
  assert.ok(Date.parse(visual.at) >= latest);
  assert.deepEqual(
    visual.viewports.map((v) => v.width),
    [1440, 768, 390],
  );
}
for (const name of [
  'typecheck-final',
  'lint-delivery',
  'format-delivery',
  'build-candidate-polish',
  'ui-lint-final',
  'visual-merge-final',
  'visual-pair-final',
])
  assert.equal(Number(read(`${dir}/${name}.exit`).toString().trim()), 0, name);
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  task: '16.5',
  inheritedFrom: proof('.artifacts/16.4/inherited-engines.json'),
  fullRustSuiteRerun: false,
});
save(`${dir}/content-review.json`, validateRecursiveSorts());
save(`${dir}/visual.json`, { task: '16.5', reports: visuals, fail: 0, warn: 0 });
save(`${dir}/candidate-build.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review.json`, {
  task: '16.5',
  latestSourceAt: new Date(latest).toISOString(),
  contract: 'ALG-CASE-01 1.1.0 / COMP-ALG-01 1.0.0',
  scope:
    'Actual C++ stable closed-interval merge with one shared scratch, last-element Lomuto quicksort with smaller-side recursion/larger-side loop,0..30 integer values. Independent exact-source pair, same input copies, one execution slot, shared1000ms including decode. Current P1 stack/alias/object projection and complete reverse; unchanged Rust/threeWASM/SAVE7/DB7/15stores/learning authority/budgets.',
  frontend: 132,
  candidate: {
    uniquePassed: 82,
    newRecursiveAndPair: 50,
    oldIterative: 32,
    report: proof(`${dir}/r165-candidate-current.json`),
  },
  failureReportsPreserved: [
    'unit-first',
    'candidate-final-aborted',
    'visual-merge-first',
    'visual-pair-first',
  ],
  formalCurrentCoursePending: true,
});
const evidence = Object.fromEntries(
  [
    'units-final.json',
    'r165-candidate-current.json',
    'candidate-build.json',
    'content-review.json',
    'visual.json',
    'inherited-engines.json',
    'release-review.json',
  ].map((name, i) => [`recursiveSortGate${i + 1}`, proof(`${dir}/${name}`)]),
);
const algorithmBytes = read('web/src/generated/algorithm/c_viz_algorithm_bg.wasm');
save(target, {
  ...prior,
  releaseVersion: '1.0.40',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.39', ...proof(priorPath) },
  scope:
    '16.5 two recursive C++ sorting cases and their actual same-data paired runs; no learning facts or migration.',
  algorithmEngine: {
    wasmSha256: sha(algorithmBytes),
    wasmBytes: algorithmBytes.length,
    execVersion: '1.2.0',
    dslVersion: '1.1.0',
    diagnosticVersion: '1.1.0',
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 132,
    candidateUniquePassed: 82,
  },
  reason:
    '132 affected unit tests and82 unique actual Chrome candidate cases pass, including50 recursive/paired and32 legacy iterative. Both actual three-width Inspectors and source UI lint are clean; formal40 current-course gates remain separately required.',
  supplementalReason:
    'Only optional host deadline start is added to AlgorithmExecutionClient; no wire/version, Rust, learning, persistence or budget change.',
  files: recursiveSortPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.5-1.0.40';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.40',
    sources: 250,
    frontend: 132,
    candidateUnique: 82,
    formalPending: true,
  }),
);
