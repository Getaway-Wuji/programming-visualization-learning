import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { structuresPaths } from './structures-release-inputs.mjs';
import { validateStructures } from './structures-content.mjs';
const dir = '.artifacts/16.7',
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
const target = 'content/c/p0/blockly-release-1.0.42.json',
  priorPath = 'content/c/p0/blockly-release-1.0.41.json',
  prior = json(priorPath),
  baseline = json(`${dir}/baseline.json`);
assert.equal(existsSync(target), false);
assert.equal(structuresPaths.length, 270);
for (const item of [...baseline.prior, baseline.external, ...Object.values(prior.evidence)])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const inherited = json('.artifacts/16.6/inherited-engines.json');
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const latest = Math.max(...structuresPaths.map((p) => statSync(p).mtimeMs)),
  units = json(`${dir}/r167-units-reviewed.json`);
assert.equal(units.numTotalTests, 99);
assert.equal(units.numPassedTests, 99);
assert.equal(units.numPendingTests, 0);
assert.ok(units.startTime >= latest);
const candidate = json(`${dir}/r167-candidate-reviewed.json`);
assert.equal(candidate.stats.expected, 35);
assert.equal(candidate.stats.unexpected + candidate.stats.skipped + candidate.stats.flaky, 0);
assert.deepEqual(candidate.errors, []);
assert.ok(Date.parse(candidate.stats.startTime) >= latest);
const cases = (suites) => suites.flatMap((s) => [...(s.specs ?? []), ...cases(s.suites ?? [])]);
for (const spec of cases(candidate.suites)) {
  assert.equal(spec.ok, true);
  assert.equal(spec.tests.length, 1);
  assert.equal(spec.tests[0].projectName, 'chrome');
  assert.equal(spec.tests[0].results.length, 1);
  assert.equal(spec.tests[0].results[0].status, 'passed');
  assert.equal(spec.tests[0].results[0].retry, 0);
}
const reports = ['stack-final', 'queue-final'].map((n) => json(`${dir}/taste/${n}/report.json`));
for (const r of reports) {
  assert.equal(r.findings.filter((f) => f.level === 'FAIL').length, 0);
  assert.ok(r.findings.every((f) => f.level === 'WARN' && f.id === 'below-fold'));
  assert.ok(Date.parse(r.at) >= latest);
  assert.deepEqual(
    r.viewports.map((v) => v.width),
    [1440, 768, 390],
  );
}
for (const label of [
  'r167-typecheck-final',
  'r167-lint-second',
  'r167-format-reviewed',
  'r167-ui-lint-final',
  'r167-build-candidate-fourth',
  'r167-visual-stack-final',
  'r167-visual-queue-final',
  'r167-lint-register',
])
  assert.equal(Number(read(`${dir}/${label}.exit`).toString().trim()), 0, label);
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  task: '16.7',
  inheritedFrom: proof('.artifacts/16.6/inherited-engines.json'),
  fullRustSuiteRerun: false,
});
save(`${dir}/content-review.json`, validateStructures());
save(`${dir}/visual.json`, {
  task: '16.7',
  reports,
  fail: 0,
  warn: reports.reduce((n, r) => n + r.findings.length, 0),
  defendedWarning: reports.some((r) => r.findings.length)
    ? {
        id: 'below-fold',
        reason:
          'Accepted code/trace teaching workbench deliberately keeps complete source, five physical slots, raw variables, counters and output available by ordinary scrolling. Not an urgent dashboard. All widths retain accessible controls and no clipping/overflow. No new rule exemption.',
      }
    : null,
  sourceUiLint: {
    fail: 0,
    warn: 1,
    reason:
      'Inherited chapter number padStart in shared CatalogPages: fixed course order, not new decorative numbering. This task only adds the structure catalog import/component; keep original C course labels.',
  },
});
save(`${dir}/candidate-build.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review.json`, {
  task: '16.7',
  latestSourceAt: new Date(latest).toISOString(),
  contract: 'STRUCT-CASE-01 1.0.0',
  scope:
    'Two original capacity5 C++ stack/circular queue cases. Chinese per-line commands encode only to1,value/2, total30 integer slots. Rust alone decides outcomes, monotonic queue tickets and physical writes. Read-only actual state layout, residual/uninitialized/pending/removed distinction, one real player and complete reverse. No frontend operation simulation, new engine/protocol/budget/learning/SAVE/heap/challenge/comparison/snapshot.',
  frontend: 99,
  candidateUniquePassed: 35,
  visual: proof(`${dir}/visual.json`),
  setupFailuresPreserved: [
    'r167-build-candidate-first: candidate flag omitted; prior41 correctly rejected changed source',
    'r167-typecheck-browser: test driver used nonexistent step method; corrected to actual seek API',
  ],
  formalCurrentCoursePending: true,
});
const evidence = Object.fromEntries(
  [
    'r167-units-reviewed.json',
    'r167-candidate-reviewed.json',
    'candidate-build.json',
    'content-review.json',
    'visual.json',
    'inherited-engines.json',
    'release-review.json',
  ].map((n, i) => [`structuresGate${i + 1}`, proof(`${dir}/${n}`)]),
);
const wasm = read('web/src/generated/algorithm/c_viz_algorithm_bg.wasm');
save(target, {
  ...prior,
  releaseVersion: '1.0.42',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.41', ...proof(priorPath) },
  scope:
    '16.7 real C++ stack/circular queue operation workspaces; no learning authority or migration.',
  algorithmEngine: {
    wasmSha256: sha(wasm),
    wasmBytes: wasm.length,
    execVersion: '1.2.0',
    dslVersion: '1.1.0',
    diagnosticVersion: '1.1.0',
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 99,
    candidateUniquePassed: 35,
  },
  reason:
    '99 affected units and35 real Chrome candidate scenes; two pages at three widths, Inspector0FAIL with separately defended ordinary-scroll WARN. Formal42 current-course gates remain required.',
  supplementalReason:
    'Unchanged bounded integer-array P1 execution suffices; no engine/MemoryState casts or budget increases.',
  files: structuresPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.7-1.0.42';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.42',
    sources: 270,
    frontend: 99,
    candidateUnique: 35,
    formalPending: true,
  }),
);
