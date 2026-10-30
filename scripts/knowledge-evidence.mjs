// Read-only checks and exact evidence archiving for the single 15.1 delivery.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
const dir = '.artifacts/15.1';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString()
      .replace(/^\uFEFF/, ''),
  );
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, sha256: sha(read(path)), bytes: read(path).length });
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`],
  );
const registration = json('content/c/p0/blockly-release-1.0.25.json');
assert.equal(registration.files.length, 151);
for (const entry of registration.files)
  assert.equal(sha(read(entry.path)), entry.sha256, entry.path);
for (const entry of Object.values(registration.evidence))
  assert.equal(sha(read(entry.path)), entry.sha256, entry.path);
const unit = json(`${dir}/frontend-release-serial.json`);
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 1491);
const cases = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(suite.suites ?? []),
  ]);
const formalPath = process.env.KNOWLEDGE_FORMAL_REPORT ?? `${dir}/formal-first.json`;
const formal = json(formalPath);
for (const [path, count] of [
  [formalPath, 7],
  [`${dir}/candidate-release.json`, 4],
  [`${dir}/legacy-release.json`, 60],
]) {
  const report = json(path);
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.expected, count);
  assert.equal(report.stats.unexpected + report.stats.flaky + report.stats.skipped, 0);
  for (const { spec, test } of cases(report.suites)) {
    assert.equal(spec.ok, true);
    assert.equal(test.projectName, 'chrome');
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].status, 'passed');
  }
}
for (const label of [
  'build-formal',
  'typecheck-final',
  'lint-final',
  'format-final',
  'startup-release',
])
  assert.equal(Number(read(`${dir}/${label}.exit`).toString().trim()), 0, label);
const visual = json(`${dir}/visual-final/report.json`);
assert.equal(Number(read(`${dir}/visual-final.exit`).toString().trim()), 0);
assert.equal(
  visual.findings.filter(
    (finding) =>
      finding.level === 'FAIL' || finding.severity === 'fail' || finding.severity === 'FAIL',
  ).length,
  0,
);
const baseline = json(`${dir}/baseline.json`);
const allowed = new Set([
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
  'web/src/content/p05-course-release.generated.ts',
  'web/src/pages/HomePage.tsx',
  'README.md',
  '项目守则.md',
  '项目文档/需求覆盖与范围裁决.md',
  '项目文档/开发路线与依赖.md',
  '项目文档/任务进度与交接.md',
]);
const changed = [],
  preserved = [];
for (const entry of baseline.files) {
  assert.ok(existsSync(entry.path), `Deleted baseline: ${entry.path}`);
  if (sha(read(entry.path)) === entry.sha256) preserved.push(entry.path);
  else {
    assert.ok(allowed.has(entry.path), `Unowned change: ${entry.path}`);
    changed.push(entry.path);
  }
}
assert.equal(
  execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim(),
  '',
);
assert.equal(
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  baseline.head,
);
const docs = [
  '项目文档/契约/15.1-知识图谱只读配置与状态.md',
  '项目文档/架构决策/15.1-课程知识图谱与持久完成投影.md',
  '项目文档/验收/15.1-首页知识图谱验收.md',
  '项目文档/交接/15.1-交接.md',
  '项目文档/交付/15.1-首页知识图谱使用说明.md',
];
const rawFolder = `${dir}/browser/15-1-formal-first`;
const raw = walk(rawFolder).map(proof);
const originals = [
  `${dir}/typecheck-second.log`,
  `${dir}/typecheck-final.log`,
  `${dir}/lint-final.log`,
  `${dir}/format-final.log`,
  `${dir}/build-formal.log`,
  `${dir}/startup-release.log`,
  `${dir}/candidate-first.log`,
  `${dir}/frontend-release.log`,
  formalPath,
  `${dir}/startup-release.json`,
  `${dir}/visual-final/report.json`,
];
const archive = '项目文档/验收/15.1-验证原件';
mkdirSync(archive, { recursive: true });
const archiveEntries = originals.map((path) => {
  const file = path.includes('visual-final')
    ? 'visual-final-report.json'
    : basename(path).replace(/\.log$/, '.txt');
  const target = `${archive}/${file}`;
  if (existsSync(target)) assert.deepEqual(read(target), read(path));
  else writeFileSync(target, read(path), { flag: 'wx' });
  return { ...proof(path), file };
});
writeFileSync(
  `${archive}/index.json`,
  JSON.stringify({ task: '15.1', entries: archiveEntries }, null, 2) + '\n',
);
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
const newFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'])
  .toString()
  .split('\0')
  .filter(Boolean);
for (const entry of archiveEntries)
  assert.ok(
    newFiles.includes(`${archive}/${entry.file}`),
    `Archived evidence must be included by Git: ${entry.file}`,
  );
for (const path of newFiles)
  assert.ok(
    /^(?:content\/c\/knowledge\/|content\/c\/p0\/blockly-release-1\.0\.25\.json$|web\/src\/knowledge\/|scripts\/(?:knowledge-release-inputs|register-knowledge|knowledge-evidence)\.mjs$|tests\/(?:browser|unit)\/knowledge-map\.(?:spec|test)\.ts$|项目文档\/(?:架构决策|契约|验收|交接|交付)\/(?:发布凭据\/)?15\.1-)/.test(
      path,
    ),
    `Unowned new file: ${path}`,
  );
const result = {
  task: '15.1',
  status: 'accepted',
  date: '2026-10-31',
  headUnchanged: baseline.head,
  baselineFiles: baseline.files.length,
  preserved: preserved.length,
  authorizedChanged: changed,
  deleted: 0,
  newFiles: newFiles.map(proof),
  frontend: 1491,
  newUnitCases: 18,
  chrome: {
    legacy: 60,
    candidate: 4,
    formal: 7,
    unique: 67,
    formalReport: proof(formalPath),
    cases: cases(formal.suites).map(({ spec }) => spec.title),
  },
  registration: proof('content/c/p0/blockly-release-1.0.25.json'),
  reviewedSources: 151,
  knowledgeNodes: 10,
  prerequisites: 11,
  save: '3.0.0',
  database: 3,
  stores: 12,
  engines: json(`${dir}/inherited-engines.json`),
  rustFullSuiteRerun: false,
  staticChecks: ['typecheck', 'lint', 'format', 'build', 'owned-dev-preview'],
  visual: proof(`${dir}/visual-final/report.json`),
  visualCritique: proof('项目文档/验收/15.1-界面复核.md'),
  docs: docs.map(proof),
  raw,
  archive: proof(`${archive}/index.json`),
  linksChecked: links,
  stagedFiles: 0,
  gitCommitPushPerformed: false,
  preview: proof(`${dir}/dev-preview.json`),
  next: '15.2 not claimed',
  remaining: '15.2—15.4 /16/21 not started by this chat',
};
writeFileSync(`${dir}/evidence-final.json`, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    baseline: baseline.files.length,
    preserved: preserved.length,
    changed,
    frontend: 1491,
    chromeUnique: 67,
    reviewedSources: 151,
    docs: docs.length,
    rawFiles: raw.length,
  }),
);
