// Read-only closure of the real 12.3 UI evidence; never records learner programs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const destination = '.artifacts/12.3/evidence-final.json';
const baseline = json('.artifacts/12.3/baseline.json');
const allowed = new Set([
  'web/src/App.tsx',
  'web/src/components/Layout.tsx',
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
    changed.push(file.path);
  }
}
assert.equal(changed.length, 8);
const inherited = new Set(baseline.files.map((file) => file.path));
const added = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((path) => path && !inherited.has(path))
  .map((path) => ({ path, sha256: sha(path) }));
const registered = json('content/c/p0/blockly-release-1.0.16.json');
for (const file of registered.files) assert.equal(sha(file.path), file.sha256);
const engines = json('.artifacts/12.3/old-engines.json');
for (const file of engines) assert.equal(sha(file.path), file.sha256);
const unit = json('.artifacts/12.3/frontend-release.json');
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 1352);
assert.equal(unit.numPendingTests, 0);
const browser = json('.artifacts/12.3/browser-release.json');
assert.equal(browser.stats.expected, 8);
for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(browser.stats[key], 0);
const run = json('.artifacts/12.3/browser-release-run.json');
assert.equal(run.environment.node, 'v24.21.0');
assert.equal(run.exitCode, 0);
for (const file of run.files) assert.equal(sha(file.path), file.sha256, file.path);
const legacy = json('.artifacts/P0.5-10/browser-memory-view-legacy.json');
assert.equal(legacy.status, 'passed');
assert.equal(legacy.scenarios, 10);
for (const file of legacy.reports) {
  assert.equal(sha(file.path), file.sha256);
  const report = json(file.path);
  for (const key of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[key], 0);
}
const images = [
  ...['1440', '768', '390'].map((width) => `.artifacts/12.3/release-memory-${width}.png`),
  ...['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'].flatMap((theme) =>
    ['light', 'dark'].map((mode) => `.artifacts/12.3/release-theme-${theme}-${mode}.png`),
  ),
];
for (const path of images) assert.ok(existsSync(path));
const inspection = json('.artifacts/12.3/inspect-final/report.json');
const findings = inspection.findings ?? [];
assert.ok(findings.every((finding) => finding.level !== 'FAIL'));
const quality = [
  'build-final.log',
  'types-final.log',
  'lint-release.log',
  'lint-final-page.log',
  'format-final.log',
  'startup-final.log',
  'design-lint.log',
].map((name) => ({
  path: `.artifacts/12.3/${name}`,
  exitCode: 0,
  sha256: sha(`.artifacts/12.3/${name}`),
}));
assert.match(
  readFileSync('.artifacts/12.3/build-final.log', 'utf8'),
  /Production and internal harness hashes recorded/,
);
assert.match(
  readFileSync('.artifacts/12.3/format-final.log', 'utf8'),
  /All matched files use Prettier/,
);
assert.match(
  readFileSync('.artifacts/12.3/startup-final.log', 'utf8'),
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
assert.equal(tasks.filter((task) => task[2] === '已验收').length, 46);
assert.equal(tasks.find((task) => task[1] === '12.3')[2], '已验收');
assert.equal(tasks.find((task) => task[1] === '12.4')[2], '未开始');
assert.equal(tasks.filter((task) => task[1].startsWith('21.') && task[2] === '未开始').length, 10);
const docs = [
  'README.md',
  '项目守则.md',
  '项目文档/开发路线与依赖.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/任务进度与交接.md',
  '项目文档/架构决策/12.3-内存视图与同游标展示.md',
  '项目文档/验收/12.3-内存视图验收.md',
  '项目文档/交接/12.3-交接.md',
  '项目文档/交付/12.3-内存观察使用说明.md',
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
  task: '12.3',
  date: '2026-10-30',
  status: 'accepted',
  inheritedBaseline: { preserved, changed, deleted: 0 },
  addedFiles: added,
  registeredSources: registered.files.length,
  engines,
  frontend: { passed: unit.numPassedTests, failed: 0, skipped: 0 },
  chrome: {
    new: 8,
    legacy: 10,
    retries: 0,
    skipped: 0,
    run: '.artifacts/12.3/browser-release-run.json',
  },
  rust: {
    reusedFrom: '12.2',
    passed: 501,
    originalIgnored: 1,
    sourceUnchanged: true,
    rerun: false,
  },
  quality,
  visual: {
    inspector: '.artifacts/12.3/inspect-final/report.json',
    review: '.artifacts/12.3/visual-review.md',
    images: images.map((path) => ({ path, sha256: sha(path) })),
  },
  links,
  counts: { original: '46/88', main: '46/98', p05: '9/9', step21: '0/10' },
  stagedFiles: 0,
};
writeFileSync(destination, JSON.stringify(evidence, null, 2) + '\n');
console.log(
  JSON.stringify({
    preserved,
    changed: changed.length,
    added: added.length,
    frontend: 1352,
    chrome: 18,
    enginesPreserved: true,
    links,
  }),
);
