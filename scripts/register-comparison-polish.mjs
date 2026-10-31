// Immutable successor for the inspected mobile source wrapping; preserve36 in full.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
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
const priorPath = 'content/c/p0/blockly-release-1.0.36.json',
  prior = json(priorPath);
const target = 'content/c/p0/blockly-release-1.0.37.json';
assert.equal(existsSync(target), false);
for (const item of Object.values(prior.evidence)) assert.equal(sha(read(item.path)), item.sha256);
const changed = comparisonPaths.filter(
  (path) => prior.files.find((item) => item.path === path)?.sha256 !== sha(read(path)),
);
assert.deepEqual(
  changed.toSorted(),
  [
    'scripts/build-p05-course.mjs',
    'scripts/restore-release-evidence.mjs',
    'web/src/comparison/comparison.css',
  ].toSorted(),
);
const latest = Math.max(...changed.map((path) => statSync(path).mtimeMs));
const front = json(`${dir}/frontend-wrap.json`);
assert.equal(front.numTotalTests, 1609);
const latestCode = Math.max(
  ...changed.filter((path) => !path.endsWith('.css')).map((path) => statSync(path).mtimeMs),
);
assert.ok(front.startTime >= latestCode);
const focused = json(`${dir}/frontend-wrap-wrong-only.json`),
  units = new Map();
assert.equal(focused.numFailedTests, 0);
for (const report of [front, focused])
  for (const file of report.testResults)
    for (const [index, test] of file.assertionResults.entries())
      if (test.status === 'passed' || test.status === 'failed')
        units.set(`${basename(file.name)}:${index}:${test.fullName}`, test.status);
assert.equal(units.size, 1609);
for (const status of units.values()) assert.equal(status, 'passed');
const candidate = json(`${dir}/candidate-final.json`);
assert.ok(Date.parse(candidate.stats.startTime) >= latest, 'Browser gate must cover final styles');
assert.equal(candidate.stats.expected, 14);
assert.equal(candidate.stats.unexpected + candidate.stats.skipped + candidate.stats.flaky, 0);
assert.deepEqual(candidate.errors, []);
const visual = json(`${dir}/taste/inspect-theme/report.json`);
assert.equal(visual.findings.filter((finding) => finding.level === 'FAIL').length, 0);
for (const name of [
  'typecheck-final37',
  'lint-final37',
  'format-final37',
  'build-candidate-theme',
  'visual-theme',
  'ui-lint-final37',
])
  assert.equal(Number(read(`${dir}/${name}.exit`).toString().trim()), 0, name);
const inherited = json(`${dir}/inherited-engines.json`);
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256);
save(`${dir}/candidate-build-wrap.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review-polish.json`, {
  scope:
    '16.2 source wrapping and existing appearance tokens: paired highlight/copy layers wrap long lines at retained13px on<=600px; light/dark minimal surfaces use the established tokens. Source offsets, replay, budgets, input scope, algorithms and SAVE7/DB7 unchanged.',
  prior: proof(priorPath),
  changed: changed.map(proof),
  latestSourceAt: new Date(latest).toISOString(),
  frontend: proof(`${dir}/frontend-wrap.json`),
  candidate: proof(`${dir}/candidate-final.json`),
  visual: proof(`${dir}/taste/inspect-theme/report.json`),
  earlierEvidencePreserved: [
    'visual-final',
    'visual-accepted',
    'frontend-candidate',
    'candidate-first',
    'storage-formal',
    'regression-formal',
    'regression-case-set',
  ],
  formalCurrentCoursePending: true,
});
const evidence = Object.fromEntries(
  [
    'frontend-wrap.json',
    'frontend-wrap-wrong-only.json',
    'candidate-final.json',
    'candidate-build-wrap.json',
    'inherited-engines.json',
    'release-review-polish.json',
  ].map((name, index) => [`comparisonPolishGate${index + 1}`, proof(`${dir}/${name}`)]),
);
save(target, {
  ...prior,
  releaseVersion: '1.0.37',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.36', ...proof(priorPath) },
  reason:
    'Final1609 unique frontend assertions passed across preserved full and focused reports; candidate14 and actual three-width source-open Inspector0FAIL. Immutable36 and its earlier failed inspection remain preserved. Formal37 current-course gates remain separately required.',
  files: comparisonPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.2-1.0.37';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.37',
    sources: comparisonPaths.length,
    frontend: 1609,
    candidate: 14,
    formalPending: true,
  }),
);
