// Immutable build-only successor; all runtime inputs remain byte-identical to 33.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { achievementPaths } from './achievement-release-inputs.mjs';
const dir = '.artifacts/15.4';
const read = (p) => readFileSync(p);
const json = (p) =>
  JSON.parse(
    read(p)
      .toString()
      .replace(/^\uFEFF/, ''),
  );
const proof = (path) => ({ path, sha256: createHash('sha256').update(read(path)).digest('hex') });
const save = (p, x) => writeFileSync(p, JSON.stringify(x, null, 2) + '\n', { flag: 'wx' });
const priorPath = 'content/c/p0/blockly-release-1.0.33.json';
const prior = json(priorPath);
const target = 'content/c/p0/blockly-release-1.0.34.json';
assert.equal(existsSync(target), false);
const changed = ['scripts/build-p05-course.mjs', 'scripts/restore-release-evidence.mjs'];
assert.deepEqual(
  achievementPaths,
  prior.files.map((e) => e.path),
);
for (const e of prior.files)
  if (!changed.includes(e.path)) assert.equal(proof(e.path).sha256, e.sha256, e.path);
for (const e of Object.values(prior.evidence)) assert.equal(proof(e.path).sha256, e.sha256, e.path);
assert.equal(Number(read(`${dir}/build-candidate-restoration.exit`).toString().trim()), 0);
const candidate = json(`${dir}/candidate-restoration.json`);
assert.deepEqual(candidate.errors, []);
assert.equal(candidate.stats.expected, 2);
assert.equal(candidate.stats.unexpected + candidate.stats.flaky + candidate.stats.skipped, 0);
save(`${dir}/restoration-review.json`, {
  reason:
    '33 stores a JSON UI-lint receipt with its original .log suffix. Restore now permits exactly that path for 33/34, verifies its frozen SHA and parses JSON. No widening for other logs. 34 changes only restore and release selection; all runtime sources are byte-identical to33.',
  changed: changed.map(proof),
  candidate: proof(`${dir}/candidate-restoration.json`),
  build: proof(`${dir}/build-candidate-restoration.log`),
  originalFailure: proof(`${dir}/build-formal-vector.log`),
  hashGuardFailure: proof(`${dir}/build-formal-vector-accepted.log`),
});
const evidence = {
  ...prior.evidence,
  achievementRestoreCandidate: proof(`${dir}/candidate-restoration.json`),
  achievementRestoreReview: proof(`${dir}/restoration-review.json`),
};
save(target, {
  ...prior,
  releaseVersion: '1.0.34',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.33', ...proof(priorPath) },
  scope:
    '15.4 build-only successor: restore the exact immutable JSON lint receipt with .log suffix. Same191 sources, runtime, storage, badges and budgets as33.',
  reason:
    'Source review, candidate build and2 honest candidate checks passed. Original33 restore and follow-up hash-guard failures are retained; formal34 layout follows.',
  files: achievementPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/15.4-1.0.34';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(JSON.stringify({ registered: '1.0.34', sources: 191, runtimeUnchanged: true }));
