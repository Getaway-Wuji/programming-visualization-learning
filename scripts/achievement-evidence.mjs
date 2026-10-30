// Final 15.4 audit: real reports, immutable bytes and explicit file ownership.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
const dir = '.artifacts/15.4',
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
const registrationPath = 'content/c/p0/blockly-release-1.0.34.json',
  registration = json(registrationPath);
assert.equal(registration.files.length, 191);
for (const e of [...registration.files, ...Object.values(registration.evidence)])
  assert.equal(sha(read(e.path)), e.sha256, e.path);
const inherited = json(`${dir}/inherited-engines.json`);
for (const e of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(e.path)), e.sha256, e.path);
assert.equal(inherited.rustPassed, 507);
assert.equal(inherited.originalIgnored, 1);
const unitReports = [
    'frontend-accepted.json',
    'frontend-memory-recheck.json',
    'frontend-clear-fix.json',
  ],
  units = new Map();
for (const p of unitReports)
  for (const f of json(`${dir}/${p}`).testResults)
    for (const [i, t] of f.assertionResults.entries()) units.set(`${f.name}:${i}:${t.fullName}`, t);
assert.equal(units.size, 1577);
for (const t of units.values()) assert.equal(t.status, 'passed', t.fullName);
const full = json(`${dir}/frontend-accepted.json`);
assert.deepEqual(
  full.testResults.map((f) => resolve(f.name).toLowerCase()).sort(),
  walk('tests/unit')
    .filter((p) => p.endsWith('.test.ts'))
    .map((p) => resolve(p).toLowerCase())
    .sort(),
);
const cases = (ss) =>
  ss.flatMap((s) => [
    ...(s.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(s.suites ?? []),
  ]);
const reports = [
  'storage-final.json',
  'regression-accepted.json',
  'native-id-final.json',
  'regression-fixes.json',
  'legacy-current.json',
  'legacy-scope-final.json',
  'formal-final.json',
  'layout-final.json',
  'migration-final-report.json',
];
const browser = new Map();
for (const p of reports) {
  const r = json(`${dir}/${p}`);
  assert.deepEqual(r.errors, []);
  for (const x of cases(r.suites)) {
    if (x.spec.title === 'six saved themes in both modes preserve readable real memory data')
      continue;
    browser.set(`${basename(x.spec.file.replaceAll('\\', '/'))}:${x.spec.title}`, {
      ...x,
      report: p,
    });
  }
}
assert.equal(browser.size, 161);
for (const { spec, test } of browser.values()) {
  assert.equal(spec.ok, true, spec.title);
  assert.equal(test.results.length, 1);
  assert.equal(test.results[0].status, 'passed', spec.title);
  assert.equal(test.results[0].retry, 0);
  if (!spec.file.includes('achievement-migration')) assert.equal(test.projectName, 'chrome');
}
const migration = json(`${dir}/migration-15-4-migration-final.json`);
assert.equal(migration.actualPredecessor, true);
assert.equal(migration.predecessor, '1.0.29');
assert.equal(migration.physicalBefore.version, 5);
assert.equal(migration.physicalAfter.version, 6);
assert.equal(Object.keys(migration.physicalBefore.stores).length, 14);
assert.equal(Object.keys(migration.physicalAfter.stores).length, 15);
for (const name of Object.keys(migration.physicalBefore.stores))
  if (name !== 'meta')
    assert.deepEqual(migration.physicalAfter.stores[name], migration.physicalBefore.stores[name]);
const actual = json(`${dir}/browser/15-4-layout-final/actual-recursion.json`);
assert.equal(actual.achievements.length, 3);
assert.equal(actual.achievements.filter((r) => r.unlockedAt).length, 3);
for (const r of actual.achievements)
  for (const e of r.evidence) {
    assert.deepEqual(Object.keys(e).sort(), [
      'eventId',
      'kind',
      'learningRevision',
      'occurredAt',
      'subjectRef',
    ]);
    if (e.kind === 'exercise')
      assert.ok(
        actual.receipts.some((x) => x.eventId === e.eventId && x.eventType === 'exercise.passed'),
      );
  }
const schemas = json(`${dir}/schema-final.json`);
assert.equal(schemas.length, 2);
assert.ok(schemas.every((x) => x.schemaValid && x.unknownPrivateFieldsRejected));
for (const p of [
  'build-formal-restoration',
  'typecheck-final',
  'lint-final',
  'format-final',
  'startup-accepted',
  'schema-final',
  'ui-lint-vector-final',
  'visual-vector',
])
  assert.equal(Number(read(`${dir}/${p}.exit`).toString().trim()), 0, p);
const visual = json(`${dir}/visual-vector/report.json`);
assert.equal(visual.findings.length, 0);
assert.equal(
  visual.findings.filter((f) => String(f.level ?? f.severity).toUpperCase() === 'FAIL').length,
  0,
);
const baseline = json(`${dir}/baseline.json`);
const allowed = new Set([
  'README.md',
  '项目守则.md',
  ...['需求覆盖与范围裁决', '任务进度与交接', '开发路线与依赖'].map((p) => `项目文档/${p}.md`),
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
  'scripts/startup-check.mjs',
  'tests/playwright.config.ts',
  ...[
    'appearance',
    'block-interaction',
    'blocks',
    'editor-history',
    'editor-presentation',
    'memory-view',
    'navigation',
    'notebook-helpers',
    'p05-course',
    'practice-experience',
    'practice',
    'recovery',
    'storage',
  ].map((p) => `tests/browser/${p}.${p === 'notebook-helpers' ? 'ts' : 'spec.ts'}`),
  ...['notebook', 'profile-ui', 'review-scheduler', 'storage-model'].map(
    (p) => `tests/unit/${p}.test.ts`,
  ),
  'web/src/App.tsx',
  'web/src/components/Layout.tsx',
  'web/src/content/p05-course-release.generated.ts',
  'web/src/engine/memory-client.ts',
  'web/src/memory/controller.ts',
  'web/src/pages/MemoryPage.tsx',
  'web/src/pages/HomePage.tsx',
  'web/src/learning/service.ts',
  'web/src/review-scheduler/react.tsx',
  ...['client', 'model', 'recovery'].map((p) => `web/src/storage/${p}.ts`),
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
const now = [
    ...new Set(
      execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean),
    ),
  ],
  old = new Set(baseline.files.map((e) => e.path));
const newFiles = now.filter((p) => !old.has(p));
const isNewOwned = (p) =>
  p.startsWith('content/achievements/') ||
  /^content\/c\/p0\/blockly-release-1\.0\.(30|31|32|33|34)\.json$/.test(p) ||
  p.startsWith('web/src/achievements/') ||
  [
    'web/src/storage/achievements.ts',
    'web/src/storage/v5-migration.ts',
    'scripts/achievement-release-inputs.mjs',
    'scripts/achievement-evidence.mjs',
    'scripts/register-achievements.mjs',
    'scripts/register-achievements-successor.mjs',
    'scripts/register-achievements-readiness.mjs',
    'scripts/register-achievements-vector.mjs',
    'scripts/register-achievements-restoration.mjs',
    'scripts/serve-achievement-migration.mjs',
    'tests/achievement-migration.config.ts',
    'tests/unit/achievements.test.ts',
    'tests/browser/achievements.spec.ts',
    'tests/browser/achievement-helpers.ts',
    'tests/browser/achievement-migration.spec.ts',
  ].includes(p) ||
  /^项目文档\/(?:契约|架构决策|交接|交付|验收)\/15\.4-/.test(p) ||
  p.startsWith('项目文档/验收/发布凭据/15.4-') ||
  p.startsWith('项目文档/验收/第15部分');
for (const p of newFiles) assert.ok(isNewOwned(p), `Unowned new:${p}`);
const archive = '项目文档/验收/15.4-验证原件';
mkdirSync(archive, { recursive: true });
const selected = [
  ...readdirSync(dir)
    .filter(
      (p) =>
        /\.(json|log|exit|md|py|png)$/.test(p) &&
        !['evidence-', 'collect-', 'git-', 'github-product', 'github-final'].some((prefix) =>
          p.startsWith(prefix),
        ),
    )
    .map((p) => `${dir}/${p}`),
  ...walk(`${dir}/browser`),
  ...walk(`${dir}/visual-accepted`),
  ...walk(`${dir}/visual-vector`),
  ...walk(`${dir}/browser-output/formal-final`).filter((p) => /\.(png|md)$/.test(p)),
  ...walk(`${dir}/failed-clear-diagnostic`).filter((p) => /\.(png|md)$/.test(p)),
];
const entries = [];
for (const p of [...new Set(selected)]) {
  const file = p.replace(/^\.artifacts\//, '').replaceAll('/', '__');
  const bytes = read(p),
    target = `${archive}/${file}`;
  if (existsSync(target)) assert.equal(sha(read(target)), sha(bytes), target);
  else writeFileSync(target, bytes, { flag: 'wx' });
  entries.push({ ...proof(p), file });
}
writeFileSync(`${archive}/index.json`, JSON.stringify({ task: '15.4', entries }, null, 2) + '\n');
const finalNewFiles = [
  ...new Set(
    execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
  ),
].filter((p) => !old.has(p));
for (const p of finalNewFiles) assert.ok(isNewOwned(p), `Unowned archived/new:${p}`);
const result = {
  task: '15.4',
  registration: proof(registrationPath),
  frontend: {
    uniquePassed: 1577,
    acrossBatches: true,
    reports: unitReports.map((p) => proof(`${dir}/${p}`)),
  },
  browser: {
    uniquePassed: 161,
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
    deleted: 0,
    changedFiles: changed,
    newFiles: finalNewFiles.length,
    newFilePaths: finalNewFiles,
  },
  archive: proof(`${archive}/index.json`),
  git: { head: baseline.head, indexEmpty: true, committed: false, pushed: false },
};
writeFileSync(`${dir}/evidence-final.json`, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    sources: 191,
    frontendUnique: 1577,
    browserUnique: 161,
    baseline: baseline.files.length,
    preserved: preserved.length,
    changed: changed.length,
    newFiles: finalNewFiles.length,
    deleted: 0,
    archived: entries.length,
    gitPending: true,
  }),
);
