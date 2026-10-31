// Immutable reviewed successor. Formal real-score/migration acceptance is a separate gate.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { challengePaths } from './challenge-release-inputs.mjs';
const dir = '.artifacts/16.1',
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
const priorPath = 'content/c/p0/blockly-release-1.0.34.json',
  prior = json(priorPath),
  target = 'content/c/p0/blockly-release-1.0.35.json';
assert.equal(existsSync(target), false);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256, e.path);
const frontend = json(`${dir}/frontend-rules.json`);
assert.equal(frontend.success, true);
assert.equal(frontend.numPassedTests, 1594);
assert.equal(frontend.numFailedTests, 0);
const changedPaths = challengePaths.filter(
  (p) => prior.files.find((e) => e.path === p)?.sha256 !== sha(read(p)),
);
const latest = Math.max(...changedPaths.map((p) => statSync(p).mtimeMs));
assert.ok(frontend.startTime >= latest, 'Frontend must cover final reviewed inputs');
const candidate = json(dir + '/candidate-rules.json');
assert.deepEqual(candidate.errors, []);
assert.equal(candidate.stats.expected, 2);
assert.equal(candidate.stats.unexpected + candidate.stats.flaky + candidate.stats.skipped, 0);
const nativeReports = [
  'storage-rules.json',
  'storage-legacy-candidate.json',
  'editor-candidate.json',
];
const walk = (ss) => ss.flatMap((s) => [...(s.specs ?? []), ...walk(s.suites ?? [])]);
const passed = new Map();
for (const p of nativeReports) {
  const r = json(dir + '/' + p);
  assert.deepEqual(r.errors, []);
  for (const spec of walk(r.suites)) if (spec.ok) passed.set(spec.file + ':' + spec.title, spec);
}
assert.equal(passed.size, 35);
save(dir + '/native-pre-registration.json', {
  uniquePassed: 35,
  full36Pending: true,
  reason:
    'Candidate deliberately cannot reauthorize the unpublished current course after clear. All original failures retained; complete36 is mandatory after registration before acceptance.',
  reports: nativeReports.map((p) => proof(dir + '/' + p)),
});
for (const p of ['typecheck-rules', 'lint-rules', 'build-candidate-rules'])
  assert.equal(Number(read(`${dir}/${p}.exit`).toString().trim()), 0, p);
const inherited = json('.artifacts/15.4/inherited-engines.json');
for (const e of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(e.path)), e.sha256, e.path);
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  prior: proof(priorPath),
  fullRustSuiteRerun: false,
});
save(`${dir}/candidate-build-review.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review.json`, {
  scope:
    '16.1 only;7 existing C cases/21 prediction questions, true finalized Rust receipts, same player, signed first-answer ledger, SAVE7/DB7/same15store. No new language, algorithms, execution budgets or learning completion. Native storage candidate gate uses the existing reviewed legacy course via explicit P05_HIDE_COURSE_BUNDLE=1; the full current-course36 and formal challenge acceptance still follow.',
  changed: changedPaths.map(proof),
  fullFrontend: proof(`${dir}/frontend-rules.json`),
  candidate: proof(`${dir}/candidate-rules.json`),
  storage: proof(`${dir}/storage-legacy-candidate.json`),
  firstFailures: ['unit-first', 'frontend-first', 'lint-first', 'storage-first', 'storage-rules'],
  latestSourceAt: new Date(latest).toISOString(),
});
const evidence = Object.fromEntries(
  [
    'frontend-rules.json',
    'candidate-rules.json',
    'native-pre-registration.json',
    'storage-rules.json',
    'storage-legacy-candidate.json',
    'editor-candidate.json',
    'candidate-build-review.json',
    'inherited-engines.json',
    'release-review.json',
  ].map((p, i) => [`challengeGate${i + 1}`, proof(`${dir}/${p}`)]),
);
save(target, {
  ...prior,
  releaseVersion: '1.0.35',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.34', ...proof(priorPath) },
  scope:
    '16.1 seven true C cases,21 checkpoint predictions, same reversible player, first answer+2/−1 once per stable question; SAVE7/DB7/15store. Original curriculum, old receipts/rewards, three engines/WASMs and budgets preserved.',
  reason:
    '1594 frontend assertions in one final run,35 unique native/storage editor checks across explicit candidate/current/legacy paths and2 true-trace candidate checks. Formal complete36, signed answers,concurrency,quota,clear/lateACK and actual34 migration must all pass before acceptance.',
  files: challengePaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.1-1.0.35';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  JSON.stringify({
    registered: '1.0.35',
    sources: challengePaths.length,
    frontend: 1594,
    nativeStorageUnique: 35,
    full36Pending: true,
    candidate: 2,
    formalPending: true,
  }),
);
