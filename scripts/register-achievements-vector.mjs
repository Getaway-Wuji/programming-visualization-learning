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
const priorPath = 'content/c/p0/blockly-release-1.0.32.json',
  prior = json(priorPath),
  target = 'content/c/p0/blockly-release-1.0.33.json';
assert.equal(existsSync(target), false);
const changed = [
  'web/src/achievements/AchievementsPage.tsx',
  'scripts/achievement-release-inputs.mjs',
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
];
for (const e of prior.files)
  if (!changed.includes(e.path)) assert.equal(sha(read(e.path)), e.sha256, e.path);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256, e.path);
assert.equal(achievementPaths.length, 191);
const extra = achievementPaths.filter((p) => !prior.files.some((e) => e.path === p));
assert.deepEqual(extra, ['web/src/components/Icon.tsx']);
assert.equal(
  sha(read(extra[0])),
  json(`${dir}/baseline.json`).files.find((e) => e.path === extra[0]).sha256,
);
const candidate = json(`${dir}/candidate-vector.json`);
assert.deepEqual(candidate.errors, []);
assert.equal(candidate.stats.expected, 2);
assert.equal(candidate.stats.unexpected + candidate.stats.flaky + candidate.stats.skipped, 0);
for (const p of [
  'typecheck-vector-final',
  'lint-vector-final',
  'build-candidate-vector-final',
  'ui-lint-vector-final',
])
  assert.equal(Number(read(`${dir}/${p}.exit`).toString().trim()), 0, p);
const lint = json(`${dir}/ui-lint-vector-final.log`);
assert.equal(lint.findings.length, 0);
const formal = json(`${dir}/formal-final.json`);
assert.equal(formal.stats.expected, 14);
assert.equal(formal.stats.unexpected + formal.stats.flaky + formal.stats.skipped, 0);
save(`${dir}/vector-review.json`, {
  reason:
    'Replace the unlocked text check symbol with the existing reviewed SVG icon system and use plain1/2/3 catalog ordinals. Data predicates,source evidence,storage,rewards,execution and budgets are byte-identical to32. Include unchanged Icon.tsx explicitly.',
  changed: changed.map(proof),
  additionalUnchangedIcon: proof(extra[0]),
  formal32: proof(`${dir}/formal-final.json`),
  uiLint: proof(`${dir}/ui-lint-vector-final.log`),
  final33LayoutPending: true,
});
const evidence = {
  ...prior.evidence,
  achievementVectorCandidate: proof(`${dir}/candidate-vector.json`),
  achievementVectorReview: proof(`${dir}/vector-review.json`),
  achievementVectorLint: proof(`${dir}/ui-lint-vector-final.log`),
};
save(target, {
  ...prior,
  releaseVersion: '1.0.33',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.32', ...proof(priorPath) },
  scope:
    '15.4 presentation-only final successor: existing SVG check and unpadded catalog ordinals,plus1 unchanged icon source. Same badge predicates,SAVE6,real sources and budgets.',
  reason:
    'All14 formal32 checks and161 unique Chrome checks are preserved. UIlint0/0,2 honest candidates and source review pass. Final33 empty/all-unlocked real data and three-width inspection follow separately.',
  files: achievementPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/15.4-1.0.33';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  JSON.stringify({
    registered: '1.0.33',
    sources: 191,
    presentationOnly: true,
    candidate: 2,
    formalLayoutPending: true,
  }),
);
