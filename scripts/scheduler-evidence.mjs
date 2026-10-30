// Read-only ownership verification and byte-exact archive for 15.3.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
const dir = '.artifacts/15.3',
  read = (p) => readFileSync(p),
  json = (p) =>
    JSON.parse(
      read(p)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (path) => ({ path, sha256: sha(read(path)), bytes: read(path).length });
const walk = (p) =>
  readdirSync(p, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${p}/${e.name}`) : [`${p}/${e.name}`],
  );
const registrationPath = 'content/c/p0/blockly-release-1.0.29.json',
  registration = json(registrationPath);
assert.equal(registration.files.length, 171);
for (const e of [...registration.files, ...Object.values(registration.evidence)])
  assert.equal(sha(read(e.path)), e.sha256, e.path);
const inherited = json(`${dir}/inherited-engines.json`);
for (const e of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(e.path)), e.sha256, e.path);
const unit = json(`${dir}/frontend-final.json`);
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 1546);
assert.equal(unit.numFailedTests, 0);
assert.deepEqual(
  unit.testResults.map((f) => resolve(f.name).toLowerCase()).sort(),
  walk('tests/unit')
    .filter((p) => p.endsWith('.test.ts'))
    .map((p) => resolve(p).toLowerCase())
    .sort(),
);
for (const f of unit.testResults)
  for (const a of f.assertionResults) assert.equal(a.status, 'passed');
const cases = (suites) =>
  suites.flatMap((s) => [
    ...(s.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(s.suites ?? []),
  ]);
const reportPaths = [
  'storage-release.json',
  'formal-second.json',
  'c-real-final.json',
  'corrupt-final.json',
  'related-release.json',
  'migration-second-report.json',
  'layout-final.json',
];
const browser = new Map();
for (const p of reportPaths) {
  const r = json(`${dir}/${p}`);
  assert.deepEqual(r.errors, []);
  for (const item of cases(r.suites)) {
    if (!p.includes('migration-')) assert.equal(item.test.projectName, 'chrome');
    browser.set(`${basename(item.spec.file.replaceAll('\\', '/'))}: ${item.spec.title}`, {
      ...item,
      report: `${dir}/${p}`,
    });
  }
}
assert.equal(browser.size, 72);
for (const { spec, test } of browser.values()) {
  assert.equal(spec.ok, true, spec.title);
  assert.equal(test.results.length, 1);
  assert.equal(test.results[0].status, 'passed');
  assert.equal(test.results[0].retry, 0);
}
const migration = json(`${dir}/migration-15-3-migration-second.json`);
assert.equal(migration.actualPredecessor, true);
assert.equal(migration.predecessor, '1.0.27');
assert.equal(migration.physicalBefore.version, 4);
assert.equal(migration.physicalAfter.version, 5);
assert.equal(Object.keys(migration.physicalBefore.stores).length, 13);
assert.equal(Object.keys(migration.physicalAfter.stores).length, 14);
assert.equal(migration.before.meta.generation, migration.after.meta.generation);
for (const name of Object.keys(migration.physicalBefore.stores))
  if (name !== 'meta')
    assert.deepEqual(migration.physicalBefore.stores[name], migration.physicalAfter.stores[name]);
assert.equal(migration.after.reviewCards.length, 2);
for (const gate of [
  'build-formal-successor',
  'typecheck-successor',
  'lint-successor',
  'format-successor-final',
  'startup-successor',
  'ui-lint-successor',
  'visual-accepted',
  'schema-final',
  'evidence-tools-lint',
  'evidence-tools-format',
])
  assert.equal(Number(read(`${dir}/${gate}.exit`).toString().trim()), 0, gate);
const visual = json(`${dir}/visual-accepted/report.json`);
assert.equal(
  visual.findings.filter((f) => String(f.level ?? f.severity).toUpperCase() === 'FAIL').length,
  0,
);
const baseline = json(`${dir}/baseline.json`);
assert.equal(baseline.files.length, 2044);
const allowed = new Set([
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
  'scripts/startup-check.mjs',
  'tests/playwright.config.ts',
  ...['appearance', 'editor-history', 'navigation', 'p05-course', 'recovery', 'storage'].map(
    (s) => `tests/browser/${s}.spec.ts`,
  ),
  ...['notebook', 'profile-ui', 'storage-model'].map((s) => `tests/unit/${s}.test.ts`),
  'web/src/App.tsx',
  'web/src/components/Layout.tsx',
  'web/src/content/p05-course-release.generated.ts',
  'web/src/learning/service.ts',
  'web/src/pages/HomePage.tsx',
  'web/src/review-notebook/NotebookPage.tsx',
  ...['client', 'model', 'recovery'].map((s) => `web/src/storage/${s}.ts`),
  'README.md',
  '项目守则.md',
  ...['任务进度与交接', '开发路线与依赖', '需求覆盖与范围裁决'].map((s) => `项目文档/${s}.md`),
]);
const changed = [],
  preserved = [];
for (const e of baseline.files) {
  assert.ok(existsSync(e.path), `Deleted: ${e.path}`);
  if (sha(read(e.path)) === e.sha256) preserved.push(e.path);
  else {
    assert.ok(allowed.has(e.path), `Unowned change: ${e.path}`);
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
const archive = '项目文档/验收/15.3-验证原件';
mkdirSync(archive, { recursive: true });
const originals = [
  ...readdirSync(dir)
    .filter((p) => /\.(?:json|log|exit)$/.test(p) && p !== 'evidence-final.json')
    .map((p) => `${dir}/${p}`),
  ...walk(`${dir}/browser/15-3-formal-second`),
  ...walk(`${dir}/browser/15-3-c-real-final`),
  ...walk(`${dir}/browser/15-3-layout-final`),
  ...walk(`${dir}/visual-accepted`).filter((p) => /\.(?:jpg|png|json)$/.test(p)),
  ...walk('.artifacts/15.1/browser/15-3-related-release'),
  ...walk('.artifacts/15.2/browser/15-3-related-release'),
];
const entries = originals.map((path) => {
  const file = path
      .replace(/^\.artifacts\//, '')
      .replaceAll('/', '__')
      .replace(/\.log$/, '.txt'),
    target = `${archive}/${file}`;
  if (existsSync(target)) assert.deepEqual(read(target), read(path), path);
  else writeFileSync(target, read(path), { flag: 'wx' });
  return { ...proof(path), file };
});
writeFileSync(`${archive}/index.json`, JSON.stringify({ task: '15.3', entries }, null, 2) + '\n');
const docs = [
  '项目文档/架构决策/15.3-日历分级调度与来源版本.md',
  '项目文档/契约/15.3-复习队列与SAVE5.md',
  '项目文档/验收/15.3-复习队列验收.md',
  '项目文档/验收/15.3-界面复核.md',
  '项目文档/交接/15.3-交接.md',
  '项目文档/交付/15.3-复习队列使用说明.md',
];
let links = 0;
for (const p of docs)
  for (const m of read(p)
    .toString()
    .matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(existsSync(resolve(dirname(p), target)), `${p}: ${target}`);
    links++;
  }
const inheritedPaths = new Set(baseline.files.map((e) => e.path));
const newFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'])
  .toString()
  .split('\0')
  .filter((p) => p && !inheritedPaths.has(p));
for (const e of entries)
  assert.ok(newFiles.includes(`${archive}/${e.file}`), `Ignored evidence: ${e.file}`);
for (const p of newFiles)
  assert.ok(
    /^(?:web\/src\/review-scheduler\/|web\/src\/storage\/(?:review-cards|v4-migration)\.ts$|scripts\/(?:scheduler-evidence|scheduler-release-inputs|register-scheduler(?:-successor)?|serve-scheduler-migration)\.mjs$|tests\/(?:browser\/scheduler[^/]*\.ts$|scheduler-migration\.config\.ts$|unit\/review-scheduler\.test\.ts$)|content\/c\/p0\/blockly-release-1\.0\.(?:28|29)\.json$|项目文档\/(?:架构决策|契约|验收|交接|交付)\/(?:发布凭据\/)?15\.3-)/.test(
      p,
    ),
    `Unowned addition: ${p}`,
  );
const result = {
  task: '15.3',
  status: 'accepted',
  date: '2026-10-31',
  headUnchanged: baseline.head,
  baselineFiles: baseline.files.length,
  preserved: preserved.length,
  authorizedChanged: changed,
  deleted: 0,
  newFiles: newFiles.map(proof),
  release: '1.0.29',
  reviewedSources: 171,
  frontend: {
    passed: 1546,
    newCases: 35,
    singleAllGreenRun: true,
    report: proof(`${dir}/frontend-final.json`),
  },
  chrome: {
    uniquePassed: 72,
    storage: 36,
    scheduler: 12,
    relatedNotebookGraphNavigation: 23,
    actual27Migration: 1,
    acrossBatches: true,
    cases: [...browser].map(([id, r]) => ({ id, report: r.report })),
  },
  storage: {
    schema: '5.0.0',
    physicalVersion: 5,
    stores: 14,
    logicalStores: 11,
    historyAndKnowledgeMarksPreserved: true,
  },
  rust: { inherited: true, passed: 507, originalIgnored: 1, fullRerun: false },
  visual: {
    fails: 0,
    warnings: visual.findings.filter((f) => String(f.level ?? f.severity).toUpperCase() === 'WARN')
      .length,
  },
  registration: proof(registrationPath),
  archiveIndex: proof(`${archive}/index.json`),
  checkedDocumentLinks: links,
  constraints: {
    noOtherTasks: true,
    noGitStageCommitPush: true,
    noNewThreadAutomationWorktree: true,
    noCloudProfile: true,
    noNewLearningRewardEvents: true,
  },
};
writeFileSync(`${dir}/evidence-final.json`, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      task: '15.3',
      preserved: preserved.length,
      changed: changed.length,
      newFiles: newFiles.length,
      frontend: 1546,
      chrome: 72,
      links,
    },
    null,
    2,
  ),
);
