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
const priorPath = 'content/c/p0/blockly-release-1.0.30.json',
  prior = json(priorPath),
  target = 'content/c/p0/blockly-release-1.0.31.json';
assert.equal(existsSync(target), false);
const changed = [
  'web/src/learning/service.ts',
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
];
for (const e of prior.files)
  if (!changed.includes(e.path)) assert.equal(sha(read(e.path)), e.sha256, e.path);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256, e.path);
const unit = json(`${dir}/frontend-clear-fix.json`);
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 90);
assert.equal(unit.numFailedTests, 0);
const candidate = json(`${dir}/candidate-successor.json`);
assert.deepEqual(candidate.errors, []);
assert.equal(candidate.stats.expected, 2);
assert.equal(candidate.stats.unexpected + candidate.stats.flaky + candidate.stats.skipped, 0);
for (const p of ['typecheck-successor', 'lint-successor', 'build-candidate-successor'])
  assert.equal(Number(read(`${dir}/${p}.exit`).toString().trim()), 0, p);
const diagnostic = json(`${dir}/browser/15-4-clear-diagnostic/clear-current-course.json`);
assert.equal(diagnostic.before.meta.activePackageRef.id, 'content.c.p05');
assert.equal(diagnostic.after.meta.activePackageRef.id, 'content.c.p0');
assert.notEqual(diagnostic.before.meta.generation, diagnostic.after.meta.generation);
assert.deepEqual(diagnostic.after.achievements, []);
const formal = json(`${dir}/formal-second.json`);
assert.equal(formal.stats.expected, 11);
assert.equal(formal.stats.unexpected, 2);
save(`${dir}/successor-review.json`, {
  reason:
    'Actual30 clear correctly erased all15 stores and rotated generation, but rebuilt initial content.c.p0@1.0.2 without the existing reviewed package transition; achievements and reviews then remained unconfirmed. Add the same ensureReviewedCaseRelease(true) transition as bootstrap after clear. Native clear/schema/rewards/engines/budgets unchanged.',
  changed: changed.map(proof),
  formal30: proof(`${dir}/formal-second.json`),
  diagnostic: proof(`${dir}/browser/15-4-clear-diagnostic/clear-current-course.json`),
  focusedUnit: proof(`${dir}/frontend-clear-fix.json`),
  formal31Pending: true,
});
const evidence = {
  ...prior.evidence,
  achievementSuccessorCandidate: proof(`${dir}/candidate-successor.json`),
  achievementSuccessorReview: proof(`${dir}/successor-review.json`),
  achievementClearFixUnit: proof(`${dir}/frontend-clear-fix.json`),
};
save(target, {
  ...prior,
  releaseVersion: '1.0.31',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.30', ...proof(priorPath) },
  scope:
    '15.4 reviewed successor: restore the verified current course after full clear, using the existing bootstrap transition; identical fixed three badges,closed facts,SAVE6 and budgets.',
  reason:
    '30 genuine bubble/pointer/recursion,original retry andtwo-page merge are preserved. Three source changes reviewed,90 affected frontend assertions and2 successor candidate checks pass. Formal31 clear/lateACK,actual29 migration and final regressions follow separately.',
  files: achievementPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/15.4-1.0.31';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  JSON.stringify({
    registered: '1.0.31',
    sources: achievementPaths.length,
    affectedUnit: 90,
    candidate: 2,
    formalPending: true,
  }),
);
