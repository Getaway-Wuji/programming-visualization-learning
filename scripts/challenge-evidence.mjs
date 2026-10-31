// Final16.1 evidence and ownership audit. This never rewrites prior reports.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
const dir = '.artifacts/16.1',
  read = (p) => readFileSync(p),
  json = (p) =>
    JSON.parse(
      read(p)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (path) => ({ path, bytes: read(path).length, sha256: sha(read(path)) });
const walk = (p) =>
  existsSync(p)
    ? readdirSync(p, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${p}/${e.name}`) : [`${p}/${e.name}`],
      )
    : [];
const registrationPath = 'content/c/p0/blockly-release-1.0.35.json',
  registration = json(registrationPath);
assert.equal(registration.files.length, 204);
for (const e of [...registration.files, ...Object.values(registration.evidence)])
  assert.equal(sha(read(e.path)), e.sha256, e.path);
const inherited = json(`${dir}/inherited-engines.json`);
for (const e of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(e.path)), e.sha256, e.path);
assert.equal(inherited.rustPassed, 507);
const frontReports = ['frontend-final.json', 'frontend-memory-threads.json'],
  units = new Map();
for (const p of frontReports)
  for (const f of json(`${dir}/${p}`).testResults)
    for (const [i, t] of f.assertionResults.entries())
      units.set(`${basename(f.name)}:${i}:${t.fullName}`, t);
assert.equal(units.size, 1594);
for (const t of units.values()) assert.equal(t.status, 'passed', t.fullName);
const full = json(`${dir}/frontend-final.json`);
assert.equal(full.numPassedTests, 1593);
assert.equal(full.numFailedTests, 1);
assert.equal(json(`${dir}/frontend-memory-threads.json`).numPassedTests, 9);
assert.deepEqual(
  full.testResults.map((f) => resolve(f.name).toLowerCase()).sort(),
  walk('tests/unit')
    .filter((p) => p.endsWith('.test.ts'))
    .map((p) => resolve(p).toLowerCase())
    .sort(),
);
const failedUnits = [];
for (const p of readdirSync(dir).filter((p) => p.endsWith('.json'))) {
  let r;
  try {
    r = json(`${dir}/${p}`);
  } catch {
    continue;
  }
  if (!Array.isArray(r.testResults)) continue;
  for (const f of r.testResults)
    for (const [i, t] of (f.assertionResults ?? []).entries())
      if (t.status === 'failed') {
        const key = `${basename(f.name)}:${i}:${t.fullName}`;
        const versionedNegativeRule =
          basename(f.name) === 'profile.test.ts' &&
          t.fullName.includes('rejects noncanonical confirmed totals "-1"');
        if (!versionedNegativeRule) assert.equal(units.get(key)?.status, 'passed', `${p}:${key}`);
        failedUnits.push({
          report: p,
          key,
          rechecked: versionedNegativeRule
            ? 'SAVE7 legal negative balance + new -0 canonical vector'
            : 'final1594 union',
        });
      }
}
const cases = (ss) =>
  ss.flatMap((s) => [
    ...(s.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(s.suites ?? []),
  ]);
const reports = [
    'formal-final.json',
    'storage-accepted.json',
    'regression-first.json',
    'regression-fixes.json',
    'migration-first-report.json',
    'memory-limit-recheck.json',
  ],
  browser = new Map();
for (const p of reports) {
  const r = json(`${dir}/${p}`);
  assert.deepEqual(r.errors, []);
  for (const x of cases(r.suites))
    browser.set(`${basename(x.spec.file)}:${x.spec.title}`, { ...x, report: p });
}
assert.equal(browser.size, 97);
for (const { spec, test } of browser.values()) {
  assert.equal(spec.ok, true, spec.title);
  assert.equal(test.results.length, 1);
  assert.equal(test.results[0].status, 'passed', spec.title);
  assert.equal(test.results[0].retry, 0);
  if (!spec.file.includes('challenge-migration')) assert.equal(test.projectName, 'chrome');
}
// Every collected browser failure is followed by a passing assertion under the final source.
const failedBrowser = [];
for (const p of readdirSync(dir).filter((p) => p.endsWith('.json'))) {
  let r;
  try {
    r = json(`${dir}/${p}`);
  } catch {
    continue;
  }
  if (!Array.isArray(r.suites)) continue;
  for (const { spec, test } of cases(r.suites))
    if (test.results.some((t) => t.status === 'failed' || t.status === 'timedOut')) {
      const key = `${basename(spec.file)}:${spec.title}`;
      assert.equal(browser.get(key)?.test.results[0].status, 'passed', `${p}:${key}`);
      failedBrowser.push({ report: p, key, recheckedIn: browser.get(key).report });
    }
}
const migration = json(`${dir}/migration-migration-first.json`);
assert.equal(migration.actualPredecessor, true);
assert.equal(migration.predecessor, '1.0.34');
assert.equal(migration.physicalBefore.version, 6);
assert.equal(migration.physicalAfter.version, 7);
assert.equal(Object.keys(migration.physicalBefore.stores).length, 15);
assert.equal(Object.keys(migration.physicalAfter.stores).length, 15);
for (const name of Object.keys(migration.physicalBefore.stores))
  if (name !== 'meta')
    assert.deepEqual(migration.physicalBefore.stores[name], migration.physicalAfter.stores[name]);
assert.deepEqual(migration.after.meta, {
  ...migration.before.meta,
  schemaVersion: '7.0.0',
  dbVersion: 7,
  revision: migration.before.meta.revision + 1,
});
for (const p of [
  'build-formal-first',
  'typecheck-final',
  'lint-final',
  'format-final',
  'startup-accepted',
  'schema-final',
  'ui-lint-final',
  'visual-final',
  'frozen-final',
])
  assert.equal(Number(read(`${dir}/${p}.exit`).toString().trim()), 0, p);
const visual = json(`${dir}/design/inspect-final/report.json`);
assert.deepEqual(json(`${dir}/links-accepted.json`).errors, []);
assert.equal(visual.findings.filter((x) => x.level === 'FAIL').length, 0);
assert.deepEqual(
  visual.findings.map((x) => x.id),
  ['font-count'],
);
assert.ok(
  json(`${dir}/schema-final.json`).every(
    (x) => x.schemaValid && x.unknownPrivateFieldsRejected && x.invalidSignedPointsRejected,
  ),
);
const baseline = json(`${dir}/baseline.json`),
  allowed = new Set([
    'README.md',
    '项目守则.md',
    ...['需求覆盖与范围裁决', '任务进度与交接', '开发路线与依赖'].map((p) => `项目文档/${p}.md`),
    'scripts/build-p05-course.mjs',
    'scripts/restore-release-evidence.mjs',
    'scripts/startup-check.mjs',
    'tests/playwright.config.ts',
    ...[
      'appearance',
      'editor-history',
      'p05-course',
      'player-controls',
      'recovery',
      'rewards',
      'storage',
    ].map((p) => `tests/browser/${p}.spec.ts`),
    ...['achievements', 'notebook', 'profile', 'review-scheduler', 'storage-model'].map(
      (p) => `tests/unit/${p}.test.ts`,
    ),
    'web/src/components/CaseExecution.tsx',
    'web/src/content/p05-course-release.generated.ts',
    'web/src/engine/execution-client.ts',
    'web/src/learning/profile.ts',
    'web/src/learning/service.ts',
    'web/src/pages/HomePage.tsx',
    'web/src/player/controller.ts',
    ...['client', 'model', 'recovery', 'validation'].map((p) => `web/src/storage/${p}.ts`),
  ]);
const preserved = [],
  changed = [];
for (const e of baseline.files) {
  assert.ok(existsSync(e.path), `Deleted:${e.path}`);
  if (sha(read(e.path)) === e.sha256) preserved.push(e.path);
  else {
    assert.ok(allowed.has(e.path), `Unowned:${e.path}`);
    changed.push(e.path);
  }
}
assert.equal(
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  baseline.head,
);
assert.equal(
  execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim(),
  '',
);
const old = new Set(baseline.files.map((e) => e.path)),
  files = () => [
    ...new Set(
      execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean),
    ),
  ];
const newOwned = (p) =>
  p.startsWith('content/challenges/') ||
  p.startsWith('web/src/challenges/') ||
  [
    'content/c/p0/blockly-release-1.0.35.json',
    'content/rewards/challenge-1.0.0.json',
    'web/src/storage/v6-migration.ts',
    ...[
      'challenge-release-inputs',
      'challenges-browser',
      'register-challenges',
      'serve-challenge-migration',
      'challenge-evidence',
    ].map((x) => `scripts/${x}.mjs`),
    'tests/browser/challenge-migration.spec.ts',
    'tests/browser/challenges.spec.ts',
    'tests/challenge-migration.config.ts',
    'tests/unit/challenges.test.ts',
  ].includes(p) ||
  /^项目文档\/(?:契约|架构决策|交接|交付|验收)\/16\.1-/.test(p) ||
  p.startsWith('项目文档/验收/发布凭据/16.1-1.0.35/');
for (const p of files().filter((p) => !old.has(p))) assert.ok(newOwned(p), `Unowned new:${p}`);
const archive = '项目文档/验收/16.1-验证原件';
mkdirSync(archive, { recursive: true });
const selected = [
  ...readdirSync(dir)
    .filter(
      (p) =>
        /\.(json|log|exit|md)$/.test(p) &&
        !['evidence-', 'collect-'].some((prefix) => p.startsWith(prefix)),
    )
    .map((p) => `${dir}/${p}`),
  ...walk(`${dir}/browser`),
  ...walk(`${dir}/design/inspect-final`),
  `${dir}/design/direction.json`,
  `${dir}/inspect-current.mjs`,
  ...walk('.artifacts/14.4/browser/memory-limit-recheck'),
  ...[
    'formal-first-output',
    'formal-second-output',
    'storage-rules-output',
    'storage-legacy-candidate-output',
    'editor-candidate-output',
    'storage-formal-output',
    'storage-final-output',
    'regression-first-output',
  ].flatMap((p) => walk(`${dir}/${p}`).filter((p) => /\.(png|md)$/.test(p))),
];
const entries = [];
for (const p of [...new Set(selected)]) {
  const file =
      p.replace(/^\.artifacts\//, '').replaceAll('/', '__') + (p.endsWith('.log') ? '.txt' : ''),
    bytes = read(p),
    target = `${archive}/${file}`;
  if (existsSync(target)) assert.equal(sha(read(target)), sha(bytes), target);
  else writeFileSync(target, bytes, { flag: 'wx' });
  entries.push({ ...proof(p), file });
}
const failureReview = {
  browserFailures: failedBrowser,
  frontend: {
    full: proof(`${dir}/frontend-final.json`),
    recheck: proof(`${dir}/frontend-memory-threads.json`),
    failedAssertions: failedUnits,
    pool: 'final full uses4 workers; original9-test file rechecked with threads/1 worker, unchanged data and1000ms timer',
    earlierProfileChange:
      'The old -1 rejection is intentionally replaced by -0 canonical validation under SAVE7; actual-1 persistence and lowest-level projection are separately verified.',
  },
  collectionAndToolFailures: [
    'raw-asset Node import fixed with pure closed rules',
    'React render ref corrected before immutable35',
    'candidate current-package clear remains unauthorized until registration; formal36 all passed',
    'startup harness DB6 open synchronized to7',
    'visual QA waited for actual React choices',
  ],
  unchangedProductionBudgets: true,
};
writeFileSync(`${archive}/failure-review.json`, JSON.stringify(failureReview, null, 2) + '\n');
writeFileSync(
  `${archive}/index.json`,
  JSON.stringify(
    {
      task: '16.1',
      entries,
      failureReview: proof(`${archive}/failure-review.json`),
      localOnlyFailureTraces: walk(dir)
        .filter((p) => p.endsWith('/trace.zip'))
        .map(proof),
    },
    null,
    2,
  ) + '\n',
);
const newFiles = files().filter((p) => !old.has(p));
for (const p of newFiles) assert.ok(newOwned(p), `Unowned archived:${p}`);
const result = {
  task: '16.1',
  registration: proof(registrationPath),
  frontend: {
    uniquePassed: 1594,
    acrossBatches: true,
    reports: frontReports.map((p) => proof(`${dir}/${p}`)),
  },
  browser: {
    uniquePassed: 97,
    acrossBatches: true,
    reports: reports.map((p) => proof(`${dir}/${p}`)),
    cases: [...browser.values()].map(({ spec, test, report }) => ({
      file: spec.file,
      title: spec.title,
      project: test.projectName,
      status: test.results[0].status,
      report,
    })),
  },
  engines: {
    rustInherited: 507,
    originalIgnored: 1,
    fullRustSuiteRerun: false,
    proof: proof(`${dir}/inherited-engines.json`),
  },
  ownership: {
    baseline: baseline.files.length,
    preserved: preserved.length,
    changed: changed.length,
    changedFiles: changed,
    deleted: 0,
    newFiles: newFiles.length,
    newFilePaths: newFiles,
  },
  archive: proof(`${archive}/index.json`),
  git: { head: baseline.head, indexEmpty: true, committed: false, pushed: false },
};
writeFileSync(`${dir}/evidence-final.json`, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    sources: 204,
    frontendUnique: 1594,
    browserUnique: 97,
    baseline: baseline.files.length,
    preserved: preserved.length,
    changed: changed.length,
    newFiles: newFiles.length,
    deleted: 0,
    archived: entries.length,
    indexEmpty: true,
  }),
);
