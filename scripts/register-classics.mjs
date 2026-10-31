import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { classicsPaths } from './classics-release-inputs.mjs';
import { validateClassics } from './classics-content.mjs';
const dir = '.artifacts/16.9',
  read = (p) => readFileSync(p),
  json = (p) =>
    JSON.parse(
      read(p)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (p) => ({ path: p, sha256: sha(read(p)) }),
  save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' }),
  target = 'content/c/p0/blockly-release-1.0.44.json',
  priorPath = 'content/c/p0/blockly-release-1.0.43.json',
  prior = json(priorPath),
  baseline = json(`${dir}/baseline.json`);
assert.equal(existsSync(target), false);
assert.equal(classicsPaths.length, 298);
for (const item of [...baseline.prior, baseline.external, ...Object.values(prior.evidence)])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const inherited = json('.artifacts/16.8/inherited-engines.json');
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const latest = Math.max(...classicsPaths.map((p) => statSync(p).mtimeMs)),
  units = json(`${dir}/r169-units-first.json`);
assert.equal(units.numTotalTests, 105);
assert.equal(units.numPassedTests, 105);
assert.equal(units.numPendingTests, 0);
assert.ok(units.startTime >= latest);
const candidate = json(`${dir}/r169-candidate-first.json`);
assert.equal(candidate.stats.expected, 60);
assert.equal(candidate.stats.unexpected + candidate.stats.skipped + candidate.stats.flaky, 0);
assert.deepEqual(candidate.errors, []);
assert.ok(Date.parse(candidate.stats.startTime) >= latest);
const cases = (suites) => suites.flatMap((s) => [...(s.specs ?? []), ...cases(s.suites ?? [])]);
for (const s of cases(candidate.suites)) {
  assert.equal(s.ok, true);
  assert.equal(s.tests.length, 1);
  assert.equal(s.tests[0].projectName, 'chrome');
  assert.equal(s.tests[0].results.length, 1);
  assert.equal(s.tests[0].results[0].status, 'passed');
  assert.equal(s.tests[0].results[0].retry, 0);
}
const reports = ['hanoi', 'gcd', 'prime', 'palindrome'].map((n) =>
  json(`${dir}/taste/${n}/report.json`),
);
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
  'r169-typecheck-second',
  'r169-lint-second',
  'r169-format-final',
  'r169-ui-lint-final',
  'r169-build-candidate-second',
  'r169-visual-hanoi',
  'r169-visual-gcd',
  'r169-visual-prime',
  'r169-visual-palindrome',
  'r169-lint-register',
])
  assert.equal(Number(read(`${dir}/${label}.exit`).toString().trim()), 0, label);
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  task: '16.9',
  inheritedFrom: proof('.artifacts/16.8/inherited-engines.json'),
  fullRustSuiteRerun: false,
});
save(`${dir}/content-review.json`, validateClassics());
save(`${dir}/visual.json`, {
  task: '16.9',
  reports,
  fail: 0,
  warn: reports.reduce((n, r) => n + r.findings.length, 0),
  defendedWarning: reports.some((r) => r.findings.length)
    ? {
        id: 'below-fold',
        reason:
          'Actual code/trace workbench keeps all source, current state, counters and output available by ordinary scrolling; no clipped data or added rule exemption.',
      }
    : null,
  sourceUiLint: {
    fail: 0,
    warn: 1,
    reason:
      'Existing C chapter ordering padStart in shared CatalogPages; keep actual course numbers, no new decorative numbering.',
  },
});
save(`${dir}/candidate-build.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review.json`, {
  task: '16.9',
  latestSourceAt: new Date(latest).toISOString(),
  contract: 'CLASSIC-CASE-01 1.0.0',
  scope:
    'Four exact-source C++ cases on unchanged memory engine: Hanoi0..5 with actual positions/moveState arrays and aliases, sign-normalized Euclidean GCD including agreed(0,0)=0, bounded trial-division prime and full-digit palindrome. Fixed arity/strict input bounds, same-cursor state/memory/stack, all atomic reverse. No frontend solution, source substitution, protocol/engine/budget/SAVE/learning changes or challenge/comparison/snapshot.',
  frontend: 105,
  candidateUniquePassed: 60,
  visual: proof(`${dir}/visual.json`),
  failureReportsPreserved: [
    'r169-unit-engine-first:5 Hanoi cases exposed object.declare before value.initialize. Null slots are legitimate uninitialized values; projection now separates layoutReady from invalid non-null peg, with no fabricated initial0. Second44 and final105 pass.',
  ],
  formalCurrentCoursePending: true,
});
const evidence = Object.fromEntries(
    [
      'r169-units-first.json',
      'r169-candidate-first.json',
      'candidate-build.json',
      'content-review.json',
      'visual.json',
      'inherited-engines.json',
      'release-review.json',
    ].map((n, i) => [`classicsGate${i + 1}`, proof(`${dir}/${n}`)]),
  ),
  memory = read('web/src/generated/memory/c_viz_memory_bg.wasm');
assert.equal(sha(memory), '4f3cb075dc0b7da3a0afc9dd96f178b6a1b71184f125c726ddf0b81384f6b3a7');
save(target, {
  ...prior,
  releaseVersion: '1.0.44',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.43', ...proof(priorPath) },
  scope:
    '16.9 four original C++ classics and real array/stack state; no learning authority or migration.',
  classicEngine: {
    id: 'engine.rust.memory',
    execVersion: '1.3.0',
    dslVersion: '1.2.0',
    diagnosticVersion: '1.2.0',
    wasmSha256: sha(memory),
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 105,
    candidateUniquePassed: 60,
  },
  reason:
    '105 affected units and60 unique real Chrome candidate scenes. Four pages at three widths, Inspector0FAIL. Exact C++ results, Hanoi legal minimal moves/actual arrays, view/identity/storage and old route boundaries pass; formal44 current-course gates remain required.',
  supplementalReason:
    'Original memory functions/arrays suffice; no new language capability or budget increase. Algorithm coverage is separately audited at final delivery.',
  files: classicsPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.9-1.0.44';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.44',
    sources: 298,
    frontend: 105,
    candidateUnique: 60,
    formalPending: true,
  }),
);
