// Freeze a new reviewed successor; keep all predecessor registrations and proofs intact.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { iterativeSortPaths } from './iterative-sort-release-inputs.mjs';
import { validateIterativeSorts } from './iterative-sort-content.mjs';
const dir = '.artifacts/16.4',
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
const target = 'content/c/p0/blockly-release-1.0.39.json',
  priorPath = 'content/c/p0/blockly-release-1.0.38.json',
  prior = json(priorPath);
assert.equal(existsSync(target), false);
assert.equal(iterativeSortPaths.length, 239);
const baseline = json(`${dir}/baseline.json`);
for (const item of [...baseline.prior, baseline.external])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
for (const item of Object.values(prior.evidence))
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const inherited = json('.artifacts/16.3/inherited-engines.json');
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const latest = Math.max(...iterativeSortPaths.map((path) => statSync(path).mtimeMs));
const units = json(`${dir}/units-final.json`);
assert.equal(units.numTotalTests, 183);
assert.equal(units.numPassedTests, 183);
assert.equal(units.numPendingTests, 0);
assert.ok(units.startTime >= latest);
const cases = (suites) =>
    suites.flatMap((suite) => [
      ...(suite.specs ?? []).map((spec) => ({ spec, test: spec.tests[0] })),
      ...cases(suite.suites ?? []),
    ]),
  browser = new Map();
for (const name of ['candidate-final', 'candidate-clear']) {
  const report = json(`${dir}/${name}.json`);
  assert.deepEqual(report.errors, []);
  assert.ok(Date.parse(report.stats.startTime) >= latest);
  for (const { spec, test } of cases(report.suites))
    browser.set(spec.title, {
      ok: spec.ok,
      status: test.results[0].status,
      retries: test.results[0].retry,
      report: name,
    });
}
assert.equal(browser.size, 32);
for (const [name, value] of browser) {
  assert.equal(value.ok, true, name);
  assert.equal(value.status, 'passed', name);
  assert.equal(value.retries, 0, name);
}
const visual = json(`${dir}/taste/inspect-first/report.json`);
assert.equal(visual.findings.filter((item) => item.level === 'FAIL').length, 0);
assert.ok(Date.parse(visual.at) >= latest);
for (const name of [
  'typecheck-final',
  'lint-final',
  'format-final',
  'build-candidate-polish',
  'ui-lint-final',
  'visual-first',
])
  assert.equal(Number(read(`${dir}/${name}.exit`).toString().trim()), 0, name);
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  inheritedFrom: proof('.artifacts/16.3/inherited-engines.json'),
  task: '16.4',
  fullRustSuiteRerun: false,
});
save(`${dir}/content-review.json`, validateIterativeSorts());
save(`${dir}/visual.json`, visual);
save(`${dir}/candidate-build.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review.json`, {
  task: '16.4',
  contract: 'ALG-CASE-01 1.0.0',
  scope:
    'Three new C++ cases: direct insertion, halving-gap Shell,41-bucket frequency reconstruction. Actual AlgorithmExecutionClient/AlgorithmPlayer, unchanged Rust/threeWASM and budgets. Independent case/program versions; no learning or persistence changes. Old sevenC,32lessons/40exercises172groups and SAVE7/DB7/15stores retained. No new comparison/challenge/snapshot integration.',
  latestSourceAt: new Date(latest).toISOString(),
  units: 183,
  candidate: {
    uniquePassed: 32,
    fullReport: '31/32 passed; peer clear was closed before its async operation completed',
    focusedReport:
      'candidate-clear1/1 passes after waiting for actual clear epoch before closing peer',
    cases: [...browser],
  },
  visual: proof(`${dir}/visual.json`),
  formalCurrentCoursePending: true,
  failureReportsPreserved: [
    'typecheck-browser',
    'candidate-first',
    'candidate-second-aborted',
    'candidate-fourth',
    'candidate-final',
  ],
});
const evidence = Object.fromEntries(
  [
    'units-final.json',
    'candidate-final.json',
    'candidate-clear.json',
    'candidate-build.json',
    'content-review.json',
    'visual.json',
    'inherited-engines.json',
    'release-review.json',
  ].map((name, index) => [`iterativeSortGate${index + 1}`, proof(`${dir}/${name}`)]),
);
const algorithmBytes = read('web/src/generated/algorithm/c_viz_algorithm_bg.wasm');
save(target, {
  ...prior,
  releaseVersion: '1.0.39',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.38', ...proof(priorPath) },
  scope: '16.4 three C++ iterative sorting cases; no new learning authority or migration.',
  algorithmEngine: {
    wasmSha256: sha(algorithmBytes),
    wasmBytes: algorithmBytes.length,
    execVersion: '1.2.0',
    dslVersion: '1.1.0',
    diagnosticVersion: '1.1.0',
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 183,
    candidateUniquePassed: 32,
  },
  reason:
    'Three real C++ sorting programs and accepted source-bound teaching metadata passed183 affected unit assertions and32 unique candidate browser scenes across preserved full/focused batches. Formal39 current-course gates remain separately required.',
  supplementalReason:
    'Unchanged Algorithm engine SHA binds the actual C++ production path; no frontend sort/reexecution or learning facts.',
  files: iterativeSortPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.4-1.0.39';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.39',
    sources: 239,
    frontend: 183,
    candidateUnique: 32,
    formalPending: true,
  }),
);
