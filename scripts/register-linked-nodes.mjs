import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { linkedNodesPaths } from './linked-nodes-release-inputs.mjs';
import { validateLinkedNodes } from './linked-nodes-content.mjs';
const dir = '.artifacts/16.8',
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
const target = 'content/c/p0/blockly-release-1.0.43.json',
  priorPath = 'content/c/p0/blockly-release-1.0.42.json',
  prior = json(priorPath),
  baseline = json(`${dir}/baseline.json`);
assert.equal(existsSync(target), false);
assert.equal(linkedNodesPaths.length, 283);
for (const item of [...baseline.prior, baseline.external, ...Object.values(prior.evidence)])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const inherited = json('.artifacts/16.7/inherited-engines.json');
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
const latest = Math.max(...linkedNodesPaths.map((p) => statSync(p).mtimeMs)),
  units = json(`${dir}/r168-units-final.json`);
assert.equal(units.numTotalTests, 86);
assert.equal(units.numPassedTests, 86);
assert.equal(units.numPendingTests, 0);
assert.ok(units.startTime >= latest);
const candidate = json(`${dir}/r168-candidate-final.json`);
assert.equal(candidate.stats.expected, 45);
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
const reports = ['list-final', 'bst-final'].map((n) => json(`${dir}/taste/${n}/report.json`));
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
  'r168-typecheck-reviewed',
  'r168-lint-reviewed',
  'r168-format-final',
  'r168-ui-lint-final',
  'r168-build-candidate-second',
  'r168-visual-list-final',
  'r168-visual-bst-final',
  'r168-lint-register',
])
  assert.equal(Number(read(`${dir}/${label}.exit`).toString().trim()), 0, label);
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  task: '16.8',
  inheritedFrom: proof('.artifacts/16.7/inherited-engines.json'),
  fullRustSuiteRerun: false,
});
save(`${dir}/content-review.json`, validateLinkedNodes());
save(`${dir}/visual.json`, {
  task: '16.8',
  reports,
  fail: 0,
  warn: reports.reduce((n, r) => n + r.findings.length, 0),
  defendedWarning: reports.some((r) => r.findings.length)
    ? {
        id: 'below-fold',
        reason:
          'Full real C++ source/trace workbench and current node graph/field records remain available by normal scrolling; no clipped data, new rule exemption or artificial compression.',
      }
    : null,
  sourceUiLint: {
    fail: 0,
    warn: 1,
    reason:
      'Existing C course order padStart in shared CatalogPages; not new decorative numbering. Preserve original chapter labels.',
  },
  mobileRoot:
    'The graph scroller centers its viewport when real nodes first appear or the viewport resizes. Later seeks do not reset a user pan. This changes only presentation, never player/program state.',
});
save(`${dir}/candidate-build.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review.json`, {
  task: '16.8',
  latestSourceAt: new Date(latest).toISOString(),
  contract: 'NODE-CASE-01 1.0.0',
  scope:
    'Two capacity7 original C++ cases on genuine memory engine: singly linked positional insert/delete/traverse and duplicate-rejecting BST insert/search/pre/in/post traversal. Actual heap Node pointers and reversible tombstones, raw fields and same-cursor MemoryPanel/StackPanel. Strict grammar-only30-integer encoding; no frontend list/BST algorithm, protocol/engine/budget/SAVE/learning change, tree deletion/balancing or challenge/comparison/snapshot.',
  frontend: 86,
  candidateUniquePassed: 45,
  visual: proof(`${dir}/visual.json`),
  failureReportsPreserved: [
    'r168-unit-engine-first:4 tests omitted main from the total frame count; actual8 helper frames+main=9, original32 cap unchanged; full second25 and final86 reverse pass',
    'r168-candidate-first:43/45;two inherited stack display order expectations assumed root-first but actual accepted StackPanel is active-first; fixed test only, all45 rechecked',
    'r168-typecheck-first/second/third and r168-lint-first:route setup, unused test values and test-only command-map typing corrected',
  ],
  scopeClarification:
    'Own initial DEC/contract clarify helper chain8 plus main total9, no capacity/strategy/budget change.',
  formalCurrentCoursePending: true,
});
const evidence = Object.fromEntries(
  [
    'r168-units-final.json',
    'r168-candidate-final.json',
    'candidate-build.json',
    'content-review.json',
    'visual.json',
    'inherited-engines.json',
    'release-review.json',
  ].map((n, i) => [`linkedNodesGate${i + 1}`, proof(`${dir}/${n}`)]),
);
const memory = read('web/src/generated/memory/c_viz_memory_bg.wasm');
assert.equal(sha(memory), '4f3cb075dc0b7da3a0afc9dd96f178b6a1b71184f125c726ddf0b81384f6b3a7');
assert.equal(memory.length, 466663);
save(target, {
  ...prior,
  releaseVersion: '1.0.43',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.42', ...proof(priorPath) },
  scope:
    '16.8 real C++ singly linked list and BST, actual node lifetimes and same-cursor graph/memory/stack; no learning authority or migration.',
  memoryEngine: { ...prior.memoryEngine, wasmSha256: sha(memory), wasmBytes: memory.length },
  nodeEngine: {
    id: 'engine.rust.memory',
    execVersion: '1.3.0',
    dslVersion: '1.2.0',
    diagnosticVersion: '1.2.0',
    wasmSha256: sha(memory),
  },
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 86,
    candidateUniquePassed: 45,
  },
  reason:
    '86 affected units and45 real Chrome candidate scenes, two pages/three widths Inspector0FAIL; exact-source C++ pointer execution and old route/store boundaries pass. Formal43 current-course gates remain required.',
  supplementalReason:
    'Existing typed-memory branch suffices. Seven-node bound and original resource limits retained, no synthetic edges or frontend operation simulation.',
  files: linkedNodesPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.8-1.0.43';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.43',
    sources: 283,
    frontend: 86,
    candidateUnique: 45,
    formalPending: true,
  }),
);
