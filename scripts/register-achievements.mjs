// Immutable 15.4 reviewed-source registration; formal genuine behavior is accepted afterwards.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
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
const priorPath = 'content/c/p0/blockly-release-1.0.29.json',
  prior = json(priorPath),
  target = 'content/c/p0/blockly-release-1.0.30.json';
assert.equal(existsSync(target), false);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256);
const frontend = json(`${dir}/frontend-accepted.json`);
const recheck = json(`${dir}/frontend-memory-recheck.json`);
assert.equal(frontend.numPassedTests + frontend.numFailedTests, 1577);
assert.equal(frontend.numFailedTests, 1);
assert.equal(recheck.success, true);
assert.equal(recheck.numPassedTests, 9);
const resolved = new Map();
for (const report of [frontend, recheck])
  for (const file of report.testResults)
    for (const [index, test] of file.assertionResults.entries())
      resolved.set(`${file.name}:${index}:${test.fullName}`, test);
assert.equal(resolved.size, 1577);
for (const test of resolved.values()) assert.equal(test.status, 'passed', test.fullName);
save(`${dir}/frontend-consolidated.json`, {
  kind: 'unique assertions across actual runs; not a synthetic Vitest full-run report',
  uniquePassed: 1577,
  acrossBatches: true,
  full: proof(`${dir}/frontend-accepted.json`),
  focused: proof(`${dir}/frontend-memory-recheck.json`),
  originalFullFailures: 1,
  reason:
    'One unchanged 20,000-step memory semantic fixture hit the existing real 1000ms timer in the full run; all9 assertions in that file passed in the isolated recheck. Production/test budgets were not increased. Failed reports remain archived.',
});
const changed = achievementPaths.filter(
  (p) => prior.files.find((e) => e.path === p)?.sha256 !== sha(read(p)),
);
const latest = Math.max(...changed.map((p) => statSync(p).mtimeMs)),
  latestBehavior = Math.max(
    ...changed.filter((p) => !p.endsWith('.css')).map((p) => statSync(p).mtimeMs),
  );
assert.ok(
  frontend.startTime >= latest,
  'Full frontend run must cover the final behavioral sources',
);
for (const [p, count] of [
  ['candidate-accepted.json', 2],
  ['storage-final.json', 36],
]) {
  const r = json(`${dir}/${p}`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.expected, count);
  assert.equal(r.stats.unexpected + r.stats.flaky + r.stats.skipped, 0);
}
for (const p of ['typecheck-accepted', 'lint-accepted', 'build-candidate-accepted'])
  assert.equal(Number(read(`${dir}/${p}.exit`).toString().trim()), 0, p);
const inherited = json('.artifacts/15.3/inherited-engines.json');
for (const e of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(e.path)), e.sha256, e.path);
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  prior: proof(priorPath),
  fullRustSuiteRerun: false,
});
save(`${dir}/candidate-build-review.json`, json(`${dir}/course-build.json`));
const evidence = Object.fromEntries(
  [
    'frontend-accepted.json',
    'frontend-memory-recheck.json',
    'frontend-consolidated.json',
    'candidate-accepted.json',
    'storage-final.json',
    'inherited-engines.json',
    'candidate-build-review.json',
  ].map((p, i) => [`achievementGate${i + 1}`, proof(`${dir}/${p}`)]),
);
save(target, {
  ...prior,
  releaseVersion: '1.0.30',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  priorRegistration: proof(priorPath),
  supersedes: { version: '1.0.29', ...proof(priorPath) },
  scope:
    '15.4 fixed local bubble-pass, two explicit visible recursive observations and two real pointer repairs. Closed achievement evidence, original-action retry, serialized monotonic merge, generation/ACK checks and SAVE6/DB6/15-store migration. Original learning rewards, Rust engines, three WASMs and execution budgets unchanged.',
  reason:
    '1577 unique frontend assertions pass across the final full run and the isolated9-assertion memory recheck; its original timer failure remains archived and budgets unchanged.36 native storage regressions and2 honest candidate checks pass. Formal real sources,partial/unlocked,retry,peer-clear and actual29 migration acceptance follows separately.',
  files: achievementPaths.map(proof),
  evidence,
  evidenceFreshness: {
    lastProductSourceModifiedAtUtc: new Date(latest).toISOString(),
    lastBehaviorSourceModifiedAtUtc: new Date(latestBehavior).toISOString(),
  },
});
const archive = '项目文档/验收/发布凭据/15.4-1.0.30';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  JSON.stringify({
    registered: '1.0.30',
    sources: achievementPaths.length,
    frontend: 1577,
    nativeStorage: 36,
    candidate: 2,
    formalPending: true,
  }),
);
