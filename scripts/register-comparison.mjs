// Local immutable registration, with formal current-course gates still mandatory afterward.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { comparisonPaths } from './comparison-release-inputs.mjs';
const dir = '.artifacts/16.2';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString()
      .replace(/^\uFEFF/, ''),
  );
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, sha256: sha(read(path)) });
const save = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const priorPath = 'content/c/p0/blockly-release-1.0.35.json',
  prior = json(priorPath);
const target = 'content/c/p0/blockly-release-1.0.36.json';
assert.equal(existsSync(target), false);
for (const item of Object.values(prior.evidence)) assert.equal(sha(read(item.path)), item.sha256);
const changed = comparisonPaths.filter(
  (path) => prior.files.find((entry) => entry.path === path)?.sha256 !== sha(read(path)),
);
const latest = Math.max(...changed.map((path) => statSync(path).mtimeMs));
const full = json(`${dir}/frontend-candidate.json`),
  focused = json(`${dir}/frontend-memory-bugs-threads.json`);
assert.ok(full.startTime >= latest, 'Full frontend must follow final reviewed source');
assert.equal(full.numTotalTests, 1609);
assert.equal(focused.numFailedTests, 0);
const units = new Map();
for (const report of [full, focused])
  for (const file of report.testResults)
    for (const [index, test] of file.assertionResults.entries())
      units.set(`${basename(file.name)}:${index}:${test.fullName}`, test.status);
assert.equal(units.size, 1609);
for (const status of units.values()) assert.equal(status, 'passed');
const candidate = json(`${dir}/candidate-review.json`);
assert.deepEqual(candidate.errors, []);
assert.equal(candidate.stats.expected, 14);
assert.equal(candidate.stats.unexpected + candidate.stats.flaky + candidate.stats.skipped, 0);
for (const name of ['typecheck-review', 'lint-review', 'format-review', 'build-candidate-review'])
  assert.equal(Number(read(`${dir}/${name}.exit`).toString().trim()), 0, name);
const engines = json('.artifacts/16.1/inherited-engines.json');
for (const item of [...engines.protectedFiles, ...engines.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
save(`${dir}/inherited-engines.json`, {
  ...engines,
  predecessor: proof(priorPath),
  fullRustSuiteRerun: false,
});
save(`${dir}/candidate-build-review.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review.json`, {
  scope:
    '16.2 only: original C bubble/selection, independent immutable equal inputs and two true runs, shared original deadline, unified reversible replay; no learning facts/storage changes.',
  changed: changed.map(proof),
  latestSourceAt: new Date(latest).toISOString(),
  frontend: {
    total: 1609,
    fullPassed: full.numPassedTests,
    fullFailed: full.numFailedTests,
    focusedPassed: focused.numPassedTests,
    uniqueUnionPassed: units.size,
    reports: ['frontend-candidate.json', 'frontend-memory-bugs-threads.json'].map((path) =>
      proof(`${dir}/${path}`),
    ),
  },
  candidate: { passed: 14, reviewedLegacyFallback: true, formalCurrentCoursePending: true },
  firstFailures: ['typecheck-rules', 'lint-first', 'candidate-first', 'frontend-candidate'],
  formalPending: [
    'comparison14',
    'nativeStorage36',
    'challenge10',
    'affectedRegressions',
    'threeWidthsInspector',
    'startup',
    'ownershipArchiveAudit',
  ],
});
const evidence = Object.fromEntries(
  [
    'frontend-candidate.json',
    'frontend-memory-bugs-threads.json',
    'candidate-review.json',
    'candidate-build-review.json',
    'inherited-engines.json',
    'release-review.json',
  ].map((name, index) => [`comparisonGate${index + 1}`, proof(`${dir}/${name}`)]),
);
save(target, {
  ...prior,
  releaseVersion: '1.0.36',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.35', ...proof(priorPath) },
  scope:
    '16.2 original C bubble/selection true paired runs and unified STEP replay; 0..30 integers -999..999; unchanged SAVE7/DB7/15store, curriculum, rewards, engines and budgets.',
  reason:
    '1609 unique frontend assertions across the preserved full and focused reports,14 true candidate Chrome scenarios with explicit reviewed legacy fallback; formal current-course acceptance remains mandatory and separately recorded.',
  files: comparisonPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.2-1.0.36';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.36',
    sources: comparisonPaths.length,
    frontendUnique: units.size,
    candidate: 14,
    formalPending: true,
  }),
);
