import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { achievementPaths } from './achievement-release-inputs.mjs';
const dir = '.artifacts/15.4',
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
const priorPath = 'content/c/p0/blockly-release-1.0.31.json',
  prior = json(priorPath),
  target = 'content/c/p0/blockly-release-1.0.32.json';
assert.equal(existsSync(target), false);
const changed = [
  'web/src/achievements/react.tsx',
  'web/src/review-scheduler/react.tsx',
  'scripts/achievement-release-inputs.mjs',
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
];
for (const e of prior.files)
  if (!changed.includes(e.path)) assert.equal(sha(read(e.path)), e.sha256, e.path);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256, e.path);
assert.equal(achievementPaths.length, 190);
const additions = achievementPaths.filter((p) => !prior.files.some((e) => e.path === p)),
  baseline = json(`${dir}/baseline.json`);
assert.equal(additions.length, 8);
for (const p of additions)
  assert.equal(sha(read(p)), baseline.files.find((e) => e.path === p)?.sha256, p);
const candidate = json(`${dir}/candidate-readiness.json`);
assert.deepEqual(candidate.errors, []);
assert.equal(candidate.stats.expected, 2);
assert.equal(candidate.stats.unexpected + candidate.stats.flaky + candidate.stats.skipped, 0);
for (const p of ['typecheck-readiness', 'lint-readiness', 'build-candidate-readiness-second'])
  assert.equal(Number(read(`${dir}/${p}.exit`).toString().trim()), 0, p);
save(`${dir}/readiness-review.json`, {
  reason:
    'A valid current-package archive can load before practiceCatalog; learning capability becomes ready in a later state publication without generation/revision/catalog identity changing. Both providers now re-read on that capability transition. No new learning event,storage schema,schedule,engine or budget change.',
  changed: changed.map(proof),
  additionalUnchangedObservationSources: additions.map(proof),
  priorUnitUniquePassed: 1577,
  affectedUnit90: proof(`${dir}/frontend-clear-fix.json`),
  priorClearNative3: proof(`${dir}/clear-accepted.json`),
  originalReadinessFailure: proof(`${dir}/regression-accepted.json`),
  formal32Pending: true,
});
const evidence = {
  ...prior.evidence,
  achievementReadinessCandidate: proof(`${dir}/candidate-readiness.json`),
  achievementReadinessReview: proof(`${dir}/readiness-review.json`),
};
save(target, {
  ...prior,
  releaseVersion: '1.0.32',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.31', ...proof(priorPath) },
  scope:
    '15.4 final readiness successor: re-read achievements/reviews when reviewed learning capability becomes ready; explicitly review8 unchanged observation dependencies. Same fixed three badges,original facts,SAVE6 and budgets.',
  reason:
    '31 clear and late-ACK checks pass;1577 unique frontend assertions and90 affected assertions are preserved. Five changed inputs and8 unchanged existing observation sources reviewed;2 honest candidate checks pass. Final32 native functionality,old-archive migration,regressions and layout follow separately.',
  files: achievementPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/15.4-1.0.32';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  JSON.stringify({
    registered: '1.0.32',
    sources: achievementPaths.length,
    additionalUnchangedSources: 8,
    candidate: 2,
    formalPending: true,
  }),
);
