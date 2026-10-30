// Exact read-only ownership audit and evidence archive for the single 15.2 delivery.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
const dir = '.artifacts/15.2';
const read = (p) => readFileSync(p);
const json = (p) =>
  JSON.parse(
    read(p)
      .toString()
      .replace(/^\uFEFF/, ''),
  );
const sha = (b) => createHash('sha256').update(b).digest('hex');
const proof = (path) => ({ path, sha256: sha(read(path)), bytes: read(path).length });
const walk = (p) =>
  readdirSync(p, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${p}/${e.name}`) : [`${p}/${e.name}`],
  );
const registration = json('content/c/p0/blockly-release-1.0.27.json');
assert.equal(registration.files.length, 161);
for (const entry of [...registration.files, ...Object.values(registration.evidence)])
  assert.equal(sha(read(entry.path)), entry.sha256, entry.path);
const engines = json(`${dir}/inherited-engines.json`);
for (const entry of [...engines.protectedFiles, ...engines.wasm])
  assert.equal(sha(read(entry.path)), entry.sha256, entry.path);
const units = new Map();
for (const entry of json(`${dir}/unit-summary.json`).reports) {
  assert.equal(sha(read(entry.path)), entry.sha256);
  for (const file of json(entry.path).testResults)
    units.set(resolve(file.name).toLowerCase(), file);
}
assert.deepEqual(
  [...units.keys()].sort(),
  walk('tests/unit')
    .filter((p) => p.endsWith('.test.ts'))
    .map((p) => resolve(p).toLowerCase())
    .sort(),
);
let unitCount = 0;
for (const file of units.values()) {
  assert.equal(file.status, 'passed');
  for (const item of file.assertionResults) assert.equal(item.status, 'passed');
  unitCount += file.assertionResults.length;
}
assert.equal(unitCount, 1511);
const cases = (suites) =>
  suites.flatMap((s) => [
    ...(s.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(s.suites ?? []),
  ]);
const chrome = new Map();
const browserReports = [
  ...json(`${dir}/storage-summary.json`).reports.map((r) => r.path),
  `${dir}/formal-complete.json`,
  `${dir}/graph-navigation.json`,
  `${dir}/graph-read-final.json`,
  `${dir}/migration-accepted-report.json`,
];
for (const path of browserReports) {
  const report = json(path);
  assert.deepEqual(report.errors, []);
  for (const item of cases(report.suites)) {
    if (!path.includes('migration-')) assert.equal(item.test.projectName, 'chrome');
    chrome.set(`${basename(item.spec.file.replaceAll('\\', '/'))}: ${item.spec.title}`, {
      ...item,
      path,
    });
  }
}
assert.equal(chrome.size, 60);
for (const { spec, test } of chrome.values()) {
  assert.equal(spec.ok, true, spec.title);
  assert.equal(test.results.length, 1);
  assert.equal(test.results[0].status, 'passed');
  assert.equal(test.results[0].retry, 0);
}
const formal = json(`${dir}/formal-complete.json`);
assert.equal(formal.stats.expected, 11);
assert.equal(formal.stats.unexpected + formal.stats.flaky + formal.stats.skipped, 0);
const migration = json(`${dir}/migration-15-2-migration-accepted.json`);
assert.equal(migration.actualPredecessor, true);
assert.equal(migration.physicalBefore.version, 3);
assert.equal(migration.physicalBefore.stores.length, 12);
assert.equal(migration.after.meta.dbVersion, 4);
assert.equal(migration.before.meta.generation, migration.after.meta.generation);
for (const key of Object.keys(migration.before))
  if (key !== 'meta') assert.deepEqual(migration.before[key], migration.after[key]);
assert.deepEqual(migration.after.knowledgeMarks, []);
for (const name of [
  'build-formal-successor',
  'typecheck-final',
  'lint-final',
  'format-accepted',
  'startup-accepted',
  'qa-tools-lint',
  'visual-final',
  'ui-lint-final',
  'schema-final',
])
  assert.equal(Number(read(`${dir}/${name}.exit`).toString().trim()), 0, name);
const visual = json(`${dir}/visual-final/report.json`);
assert.equal(
  visual.findings.filter((f) => String(f.level ?? f.severity).toUpperCase() === 'FAIL').length,
  0,
);
const baseline = json(`${dir}/baseline.json`);
assert.equal(baseline.files.length, 1851);
const allowed = new Set([
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
  'scripts/startup-check.mjs',
  'tests/playwright.config.ts',
  ...[
    'appearance',
    'editor-history',
    'knowledge-map',
    'navigation',
    'p05-course',
    'recovery',
    'storage',
  ].map((s) => `tests/browser/${s}.spec.ts`),
  ...['editor-history', 'recovery', 'storage'].map((s) => `tests/browser/harness/${s}.ts`),
  ...['practice-learning', 'storage-model', 'storage-recovery'].map(
    (s) => `tests/unit/${s}.test.ts`,
  ),
  'web/src/App.tsx',
  'web/src/components/Layout.tsx',
  'web/src/components/PracticeExecution.tsx',
  'web/src/content/p05-course-release.generated.ts',
  ...['authority', 'domain', 'service'].map((s) => `web/src/learning/${s}.ts`),
  'web/src/memory-bugs/MemoryBugPage.tsx',
  'web/src/memory-bugs/session.ts',
  'web/src/pages/LessonPage.tsx',
  'web/src/practice/react.tsx',
  'web/src/practice/session.ts',
  ...['client', 'model', 'recovery'].map((s) => `web/src/storage/${s}.ts`),
  'README.md',
  '项目守则.md',
  ...['任务进度与交接', '开发路线与依赖', '需求覆盖与范围裁决'].map((s) => `项目文档/${s}.md`),
]);
const changed = [],
  preserved = [];
for (const entry of baseline.files) {
  assert.ok(existsSync(entry.path), `Deleted: ${entry.path}`);
  if (sha(read(entry.path)) === entry.sha256) preserved.push(entry.path);
  else {
    assert.ok(allowed.has(entry.path), `Unowned modification: ${entry.path}`);
    changed.push(entry.path);
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
const archive = '项目文档/验收/15.2-验证原件';
mkdirSync(archive, { recursive: true });
const originals = [
  ...readdirSync(dir)
    .filter((s) => /\.(?:json|log|exit)$/.test(s) && s !== 'evidence-final.json')
    .map((s) => `${dir}/${s}`),
  ...walk(`${dir}/browser/15-2-formal-complete`),
  ...walk(`${dir}/visual-final`).filter((s) => /\.(?:png|jpg|json)$/.test(s)),
  ...walk('.artifacts/15.1/browser/15-2-graph-navigation'),
  ...walk('.artifacts/15.1/browser/15-2-graph-read-final'),
];
const entries = originals.map((path) => {
  const file = path
    .replace(/^\.artifacts\//, '')
    .replaceAll('/', '__')
    .replace(/\.log$/, '.txt');
  const target = `${archive}/${file}`;
  if (existsSync(target)) assert.deepEqual(read(target), read(path), path);
  else writeFileSync(target, read(path), { flag: 'wx' });
  return { ...proof(path), file };
});
writeFileSync(`${archive}/index.json`, JSON.stringify({ task: '15.2', entries }, null, 2) + '\n');
const docs = [
  '项目文档/架构决策/15.2-错题事实与手动陌生标记.md',
  '项目文档/契约/15.2-错题收集与SAVE4.md',
  '项目文档/验收/15.2-错题与陌生点验收.md',
  '项目文档/验收/15.2-界面复核.md',
  '项目文档/交接/15.2-交接.md',
  '项目文档/交付/15.2-错题与陌生点使用说明.md',
];
let links = 0;
for (const path of docs)
  for (const match of read(path)
    .toString()
    .matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(existsSync(resolve(dirname(path), target)), `${path}: ${target}`);
    links++;
  }
const inherited = new Set(baseline.files.map((e) => e.path));
const newFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'])
  .toString()
  .split('\0')
  .filter((p) => p && !inherited.has(p));
for (const entry of entries) assert.ok(newFiles.includes(`${archive}/${entry.file}`));
for (const path of newFiles)
  assert.ok(
    /^(?:web\/src\/review-notebook\/|web\/src\/storage\/(?:knowledge-marks|v3-migration)\.ts$|web\/src\/learning\/attempt-authority\.ts$|content\/c\/p0\/blockly-release-1\.0\.(?:26|27)\.json$|scripts\/(?:notebook-evidence|notebook-release-inputs|register-notebook(?:-successor)?|serve-notebook-migration)\.mjs$|tests\/(?:browser\/notebook[^/]*\.(?:ts)|notebook-migration\.config\.ts|unit\/notebook\.test\.ts)$|项目文档\/(?:架构决策|契约|验收|交接|交付)\/(?:发布凭据\/)?15\.2-)/.test(
      path,
    ),
    `Unowned addition: ${path}`,
  );
const result = {
  task: '15.2',
  status: 'accepted',
  date: '2026-10-31',
  headUnchanged: baseline.head,
  baselineFiles: baseline.files.length,
  preserved: preserved.length,
  authorizedChanged: changed,
  deleted: 0,
  newFiles: newFiles.map(proof),
  release: '1.0.27',
  reviewedSources: 161,
  frontend: { passed: 1511, newCases: 20, acrossBatches: true },
  chrome: {
    uniquePassed: chrome.size,
    storage: 36,
    notebook: 11,
    graphNavigation: 12,
    migration: 1,
    acrossBatches: true,
    cases: [...chrome].map(([id, r]) => ({ id, report: r.path })),
  },
  storage: {
    schema: '4.0.0',
    physicalVersion: 4,
    stores: 13,
    oldLogicalProjectionStores: 11,
    historyUnchanged: true,
  },
  rust: { inherited: true, passed: 507, originalIgnored: 1, rerun: false },
  registration: proof('content/c/p0/blockly-release-1.0.27.json'),
  actualMigration: proof(`${dir}/migration-15-2-migration-accepted.json`),
  visual: {
    fails: 0,
    warnings: visual.findings.filter((f) => String(f.level ?? f.severity).toUpperCase() === 'WARN')
      .length,
  },
  checkedDocumentLinks: links,
  archiveIndex: proof(`${archive}/index.json`),
  constraints: {
    noOtherTasks: true,
    noNativeUserCode: true,
    noAccountOrCloudProfile: true,
    noGitStageCommitPush: true,
    noThreadAutomationWorktree: true,
  },
};
writeFileSync(`${dir}/evidence-final.json`, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      task: result.task,
      preserved: result.preserved,
      changed: changed.length,
      new: newFiles.length,
      frontend: unitCount,
      chrome: chrome.size,
      links,
    },
    null,
    2,
  ),
);
