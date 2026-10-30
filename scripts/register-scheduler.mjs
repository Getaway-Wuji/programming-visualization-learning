// Immutable 15.3 review registration. Formal native behavior is accepted afterwards.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
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
  proof = (path) => ({ path, sha256: sha(read(path)) });
const priorPath = 'content/c/p0/blockly-release-1.0.27.json',
  prior = json(priorPath),
  target = 'content/c/p0/blockly-release-1.0.28.json';
assert.equal(existsSync(target), false);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256);
const frontend = json(`${dir}/frontend-final.json`);
assert.equal(frontend.success, true);
assert.equal(frontend.numPassedTests, 1546);
assert.equal(frontend.numFailedTests, 0);
const latest = Math.max(
  ...schedulerPaths
    .filter((p) => prior.files.find((e) => e.path === p)?.sha256 !== sha(read(p)))
    .map((p) => statSync(p).mtimeMs),
);
assert.ok(frontend.startTime >= latest);
for (const [p, count] of [
  ['candidate-release.json', 2],
  ['storage-release.json', 36],
]) {
  const r = json(`${dir}/${p}`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.expected, count);
  assert.equal(r.stats.unexpected + r.stats.flaky + r.stats.skipped, 0);
}
for (const p of ['typecheck-final', 'lint-final', 'build-candidate-release'])
  assert.equal(Number(read(`${dir}/${p}.exit`).toString().trim()), 0, p);
const inherited = json('.artifacts/15.2/inherited-engines.json');
for (const e of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(e.path)), e.sha256, e.path);
const save = (p, x) => writeFileSync(p, JSON.stringify(x, null, 2) + '\n', { flag: 'wx' });
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  prior: proof(priorPath),
  fullRustSuiteRerun: false,
});
save(`${dir}/candidate-build-review.json`, json(`${dir}/course-build.json`));
const evidence = Object.fromEntries(
  [
    'frontend-final.json',
    'candidate-release.json',
    'storage-release.json',
    'inherited-engines.json',
    'candidate-build-review.json',
  ].map((p, i) => [`schedulerGate${i + 1}`, proof(`${dir}/${p}`)]),
);
save(target, {
  ...prior,
  releaseVersion: '1.0.28',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  priorRegistration: proof(priorPath),
  supersedes: { version: '1.0.27', ...proof(priorPath) },
  scope:
    '15.3 calendar-box-1 local review schedules from genuine mistake/knowledge sources; explicit ratings, original-base correction,CAS,retry and SAVE5/DB5/14-store migration. No new learning events,reward,engine,badge or language.',
  reason:
    '1546 frontend tests pass in one final sequential run,36 native storage regressions and2 honest candidate checks pass. Formal real-source/rating/midnight/peer/migration acceptance follows separately.',
  files: schedulerPaths.map(proof),
  evidence,
  evidenceFreshness: { lastProductSourceModifiedAtUtc: new Date(latest).toISOString() },
});
const archive = '项目文档/验收/发布凭据/15.3-1.0.28';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  JSON.stringify({
    registered: '1.0.28',
    sources: schedulerPaths.length,
    frontend: 1546,
    nativeStorage: 36,
    candidate: 2,
    formalPending: true,
  }),
);
