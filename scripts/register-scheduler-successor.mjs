import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { schedulerPaths } from './scheduler-release-inputs.mjs';
const dir = '.artifacts/15.3',
  read = (p) => readFileSync(p),
  json = (p) =>
    JSON.parse(
      read(p)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (path) => ({ path, sha256: sha(read(path)) }),
  save = (p, x) => writeFileSync(p, JSON.stringify(x, null, 2) + '\n', { flag: 'wx' });
const priorPath = 'content/c/p0/blockly-release-1.0.28.json',
  prior = json(priorPath),
  target = 'content/c/p0/blockly-release-1.0.29.json';
assert.equal(existsSync(target), false);
const changed = [
  'web/src/review-scheduler/reviews.css',
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
];
for (const e of prior.files)
  if (!changed.includes(e.path)) assert.equal(sha(read(e.path)), e.sha256, e.path);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256);
const candidate = json(`${dir}/candidate-successor.json`);
assert.equal(candidate.stats.expected, 2);
assert.equal(candidate.stats.unexpected + candidate.stats.flaky + candidate.stats.skipped, 0);
assert.deepEqual(candidate.errors, []);
const cases = (suites) =>
  suites.flatMap((s) => [
    ...(s.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(s.suites ?? []),
  ]);
const schedulerCases = new Map();
const reports = ['formal-second.json', 'c-real-final.json', 'corrupt-final.json'];
for (const path of reports)
  for (const item of cases(json(`${dir}/${path}`).suites))
    schedulerCases.set(item.spec.title, item);
assert.equal(schedulerCases.size, 12);
for (const { spec, test } of schedulerCases.values()) {
  assert.equal(spec.ok, true, spec.title);
  assert.equal(test.results.length, 1);
  assert.equal(test.results[0].status, 'passed');
}
save(`${dir}/successor-review.json`, {
  reason:
    'The existing .p05-app text-link selector overrides desktop hide. Scope the review-back selector to the actual detail so back appears only in the mobile detail pane; no scheduling/storage/execution semantic change.',
  changed: changed.map(proof),
  formal28: {
    uniquePassed: 12,
    acrossBatches: true,
    reports: reports.map((p) => proof(`${dir}/${p}`)),
  },
  migration: proof(`${dir}/migration-second-report.json`),
  related: proof(`${dir}/related-release.json`),
});
const evidence = {
  ...prior.evidence,
  candidateSuccessor: proof(`${dir}/candidate-successor.json`),
  successorReview: proof(`${dir}/successor-review.json`),
};
save(target, {
  ...prior,
  releaseVersion: '1.0.29',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.28', ...proof(priorPath) },
  scope:
    '15.3 reviewed successor: correct desktop/mobile back-control visibility. Exact same calendar-box-1,source synchronization and SAVE5 semantics.',
  reason:
    '28 formal12 unique,36 storage,23 related and1 actual27 migration checks are preserved;3 source-only presentation/build selector changes reviewed,2 new-source candidate checks pass. Final29 actual layout acceptance follows separately.',
  files: schedulerPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/15.3-1.0.29';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  `Registered29 with ${schedulerPaths.length} sources;28 and its original reports retained.`,
);
