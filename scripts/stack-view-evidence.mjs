// Bind 12.4 checks to current sources; never reads learner profiles or programs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const record = (path) => ({ path, sha256: sha(path) });
const verify = (file) => assert.equal(sha(file.path), file.sha256, file.path);
const destination = '.artifacts/12.4/evidence-final.json';
const baseline = json('.artifacts/12.4/baseline.json');
assert.equal(baseline.files.length, 1345);
const allowed = new Set([
  'web/src/pages/MemoryPage.tsx',
  'web/src/pages/CatalogPages.tsx',
  'README.md',
  '项目守则.md',
  '项目文档/任务进度与交接.md',
  '项目文档/开发路线与依赖.md',
  '项目文档/需求覆盖与范围裁决.md',
]);
const changed = [];
let preserved = 0;
for (const file of baseline.files) {
  assert.ok(existsSync(file.path), file.path);
  if (sha(file.path) === file.sha256) preserved++;
  else {
    assert.ok(allowed.has(file.path), file.path);
    changed.push(record(file.path));
  }
}
assert.equal(changed.length, 7);
const inherited = new Set(baseline.files.map((file) => file.path));
const added = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((path) => path && !inherited.has(path))
  .map(record);
assert.equal(added.length, 13);
const registered = json('content/c/p0/blockly-release-1.0.16.json');
assert.equal(registered.files.length, 75);
registered.files.forEach(verify);
const engines = json('.artifacts/12.4/old-engines.json');
assert.equal(engines.length, 3);
engines.forEach(verify);
const unitPath = '.artifacts/12.4/frontend-accepted.json';
const unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 1358);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);

const browserEvidence = (reportPath, runPath, expected) => {
  const report = json(reportPath);
  assert.equal(report.stats.expected, expected);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
  const run = json(runPath);
  assert.equal(run.environment.node, 'v24.21.0');
  assert.equal(run.exitCode, 0);
  run.files.forEach(verify);
  return { report: record(reportPath), run: record(runPath), passed: expected };
};
const browser = browserEvidence(
  '.artifacts/12.4/browser-return-recovery.json',
  '.artifacts/12.4/browser-return-recovery-run.json',
  6,
);
const memory = browserEvidence(
  '.artifacts/12.3/browser-stack-compat.json',
  '.artifacts/12.3/browser-stack-compat-run.json',
  8,
);
const legacyPath = '.artifacts/P0.5-10/browser-stack-view-legacy.json';
const legacy = json(legacyPath);
assert.equal(legacy.status, 'passed');
assert.equal(legacy.scenarios, 10);
legacy.registeredBuild.forEach(verify);
json('.artifacts/artifact-hashes.json').entries.forEach(verify);
for (const file of legacy.reports) {
  verify(file);
  const report = json(file.path);
  assert.equal(report.stats.expected, file.scenarios);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
  const run = json(file.metadata);
  assert.equal(run.exitCode, 0);
  verify(run.testSource);
}
const images = [
  ...['1440', '768', '390'].map((w) => `.artifacts/12.4/return-recovery-stack-${w}.png`),
  ...['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'].flatMap((theme) =>
    ['light', 'dark'].map((mode) => `.artifacts/12.4/return-recovery-theme-${theme}-${mode}.png`),
  ),
  ...['desktop', 'tablet', 'mobile'].flatMap((width) =>
    ['fold', 'page-01'].map((kind) => `.artifacts/12.4/inspect-final/${width}-${kind}.jpg`),
  ),
];
images.forEach((path) => assert.ok(existsSync(path), path));
const inspectorPath = '.artifacts/12.4/inspect-final/report.json';
const inspection = json(inspectorPath);
assert.equal(inspection.findings.filter((f) => f.level === 'FAIL').length, 0);
assert.equal(inspection.findings.filter((f) => f.level === 'WARN').length, 1);
const quality = [
  'build-first.log',
  'types-final.log',
  'lint-final.log',
  'lint-final-added.log',
  'format-release.log',
  'startup-final.log',
  'design-lint.log',
].map((name) => ({ ...record(`.artifacts/12.4/${name}`), exitCode: 0 }));
assert.match(
  readFileSync('.artifacts/12.4/build-first.log', 'utf8'),
  /Production and internal harness hashes recorded/,
);
assert.match(
  readFileSync('.artifacts/12.4/format-release.log', 'utf8'),
  /All matched files use Prettier/,
);
assert.match(
  readFileSync('.artifacts/12.4/startup-final.log', 'utf8'),
  /checks passed; processes stopped/,
);

const ledger = readFileSync('项目文档/任务进度与交接.md', 'utf8');
const tasks = [
  ...ledger.matchAll(
    /^\| (\d{2}\.\d+) \| (?:P[012]|后续多语言) \|[^\n]+?\| (已验收|进行中|未开始) \|/gm,
  ),
];
assert.equal(tasks.length, 98);
assert.equal(new Set(tasks.map((task) => task[1])).size, 98);
assert.equal(tasks.filter((task) => task[2] === '已验收').length, 47);
assert.equal(tasks.find((task) => task[1] === '12.4')[2], '已验收');
assert.equal(tasks.find((task) => task[1] === '12.5')[2], '未开始');
assert.equal(tasks.filter((task) => task[1].startsWith('21.') && task[2] === '未开始').length, 10);
const docs = [
  'README.md',
  '项目守则.md',
  '项目文档/开发路线与依赖.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/任务进度与交接.md',
  '项目文档/架构决策/12.4-同游标调用栈与递归观察.md',
  '项目文档/验收/12.4-调用栈视图验收.md',
  '项目文档/交接/12.4-交接.md',
  '项目文档/交付/12.4-调用栈与递归观察使用说明.md',
];
let links = 0;
for (const path of docs)
  for (const match of readFileSync(path, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const absolute = resolve(dirname(path), target);
    if (absolute !== resolve(destination)) assert.ok(existsSync(absolute), `${path}: ${target}`);
    links++;
  }
assert.equal(
  execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim(),
  '',
);
execFileSync('git', ['-c', 'core.whitespace=cr-at-eol', 'diff', '--check'], { encoding: 'utf8' });
const evidence = {
  task: '12.4',
  date: '2026-10-30',
  status: 'accepted',
  inheritedBaseline: { total: 1345, preserved, changed, deleted: 0 },
  addedFiles: added,
  registeredSources: registered.files.length,
  engines,
  frontend: { passed: 1358, failed: 0, skipped: 0, report: record(unitPath) },
  chrome: { total: 24, new: browser, memory, p0: record(legacyPath), failed: 0, skipped: 0 },
  rust: {
    reusedFrom: '12.2',
    passed: 501,
    originalIgnored: 1,
    sourceUnchanged: true,
    rerun: false,
  },
  quality,
  visual: {
    inspector: record(inspectorPath),
    review: record('.artifacts/12.4/visual-review.md'),
    images: images.map(record),
    futureScope:
      'Per user instruction: one representative theme by default; expand only for theme-related changes or demonstrated issues.',
  },
  links,
  counts: { original: '47/88', main: '47/98', p05: '9/9', step21: '0/10' },
  stagedFiles: 0,
};
writeFileSync(destination, JSON.stringify(evidence, null, 2) + '\n');
console.log(
  JSON.stringify({
    preserved,
    changed: changed.length,
    added: added.length,
    frontend: 1358,
    chrome: 24,
    enginesPreserved: true,
    links,
  }),
);
