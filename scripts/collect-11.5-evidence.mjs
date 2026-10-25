// Collect actual P0 delivery evidence. No browser, test, build or task status is changed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual as same, parseArgs } from 'node:util';
import { workspaceDir } from './process.mjs';

const { values } = parseArgs({
  options: {
    'check-only': { type: 'boolean', default: false },
    label: { type: 'string', default: 'final' },
  },
});
assert.match(values.label, /^[a-z0-9-]+$/);
const output = `.artifacts/11.5/evidence-${values.label}.json`;
const startedAt = new Date().toISOString();
const files = new Map();
const checks = [];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const name = (path) => {
  const target = resolve(workspaceDir, path),
    child = relative(workspaceDir, target);
  assert.ok(child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
  return child.split(sep).join('/');
};
const read = (path, index = true) => {
  const local = name(path),
    bytes = readFileSync(resolve(workspaceDir, local));
  const record = { path: local, sha256: sha(bytes), bytes: bytes.length };
  if (index) files.set(local, record);
  return { bytes, record };
};
const json = (path) =>
  JSON.parse(
    read(path)
      .bytes.toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const check = (title, passed, details = null) =>
  checks.push({ title, passed: passed === true, details });
const linked = (path, expected, index = true) => {
  const item = read(path, index);
  check('Original file SHA matches', item.record.sha256 === expected, name(path));
  return item.record;
};
const leaves = (suite) => [
  ...(suite.specs ?? []).flatMap((spec) =>
    spec.tests.map((test) => ({ title: spec.title, ...test })),
  ),
  ...(suite.suites ?? []).flatMap(leaves),
];
const total = (archive) =>
  archive.ledger
    .filter((row) => row.status === 'posted')
    .reduce((sum, row) => sum + BigInt(row.points), 0n)
    .toString();
const firstReports = [
  ['.artifacts/11.5/browser-chrome-first.json', ['chrome'], 'delivery-chrome-first'],
  [
    '.artifacts/11.5/browser-other-first.json',
    ['edge', 'firefox-automation'],
    'delivery-other-first',
  ],
];
const browserEvidence = [];
const course = json('content/c/p0/course-1.0.1.json');
const expectedGroupGrid = course.exercises
  .flatMap((exercise) => exercise.tests.map((group) => `${exercise.id}:${group.caseKey}`))
  .sort();
for (const [path, projects, label] of firstReports) {
  const report = json(path),
    tests = leaves(report);
  check(
    'Exact fresh delivery project count and zero retry/failure/skip',
    tests.length === projects.length &&
      report.stats.expected === projects.length &&
      report.stats.unexpected === 0 &&
      report.stats.skipped === 0 &&
      report.stats.flaky === 0 &&
      !report.errors.length &&
      same(tests.map((test) => test.projectName).sort(), [...projects].sort()) &&
      tests.every(
        (test) =>
          test.results.length === 1 &&
          test.results[0].status === 'passed' &&
          test.results[0].retry === 0,
      ),
    path,
  );
  for (const test of tests) {
    const directory = `.artifacts/11.5/${label}/${test.projectName}`;
    const data = json(`${directory}/native-ui.json`);
    const attachment = test.results[0].attachments.find(
      (entry) => entry.name === 'p0-delivery-native-ui',
    );
    check(
      'Runner attachment equals original native UI evidence',
      !!attachment && same(json(attachment.path), data),
      test.projectName,
    );
    check(
      'Fresh archive, actual 24 groups plus case/repeats, 29 real runs',
      data.task === '11.5' &&
        data.browser === test.projectName &&
        data.retry === 0 &&
        data.freshBrowserContext === true &&
        same(data.isolatedOriginStateBeforeNavigation, { cookies: [], origins: [] }) &&
        same(data.metrics, {
          lessons: 6,
          exercises: 6,
          firstSubmissionGroups: 24,
          firstCases: 1,
          repeatGroups: 3,
          repeatCases: 1,
          totalRealExecutions: 29,
          points: 190,
        }) &&
        data.initial.ledger.length === 0 &&
        data.initial.progress.length === 0 &&
        data.initial.receipts.length === 0 &&
        data.steps.length === 6 &&
        data.blockEdits.length === 6 &&
        data.errors.length === 0 &&
        data.resources.every((row) => row.status >= 200 && row.status < 400),
      test.projectName,
    );
    check(
      'Saved goals/avatar and repeat award idempotency',
      total(data.completedCourse) === '180' &&
        total(data.finished) === '190' &&
        total(data.saved) === '190' &&
        ['ledger', 'dailyFacts', 'goals'].every(
          (store) =>
            same(data.saved[store], data.repeated[store]) &&
            same(data.saved[store], data.deduplicated[store]),
        ) &&
        same(data.configured.settings.goalTemplate.targets, { exercise: 6, lesson: 6, case: 1 }) &&
        data.saved.avatar.presetId === 'avatar.basic.04' &&
        data.saved.avatar.accentColor === '#4466CC',
      test.projectName,
    );
    const runs = [
      ...data.curriculumRuns,
      ...data.caseRuns,
      ...data.repeatRuns,
      ...data.repeatCaseRuns,
    ];
    check(
      'Exact real execution group grid',
      data.curriculumRuns.length === 24 &&
        data.caseRuns.length === 1 &&
        data.repeatRuns.length === 3 &&
        data.repeatCaseRuns.length === 1 &&
        runs.length === 29 &&
        new Set(runs.map((run) => run.request.identity.runId)).size === 29 &&
        same(
          data.curriculumRuns
            .map((run) => `${run.request.subjectRef.id}:${run.request.identity.testCaseKey}`)
            .sort(),
          expectedGroupGrid,
        ),
      test.projectName,
    );
    for (const run of runs) {
      const prefix = `${directory}/${run.label}`;
      linked(`${prefix}.request.json`, run.requestSha256);
      linked(`${prefix}.result.json`, run.resultSha256);
      linked(`${prefix}.catalog.json`, run.catalogSha256);
      const result = json(`${prefix}.result.json`);
      check(
        'Original Rust result identity and complete successful trace',
        result.producer === 'rust' &&
          same(result.identity, run.request.identity) &&
          result.terminal.status === 'completed' &&
          result.terminal.exitCode === 0 &&
          result.terminal.diagnostics.length === 0 &&
          result.trace.completeness === 'complete' &&
          result.trace.steps.length === run.steps &&
          run.request.remainingMs > 0 &&
          run.request.remainingMs <= 1000,
        run.label,
      );
    }
    const practiceFrames = json(`${directory}/practice-complete-round-trip.json`);
    const caseFrames = json(`${directory}/case-complete-round-trip.json`);
    check(
      'Full rendered forward/backward state originals are linked',
      practiceFrames.length > 1 &&
        caseFrames.length === data.caseRuns[0].steps + 1 &&
        [practiceFrames, caseFrames].every((frames) =>
          frames.every((frame, index) => frame.cursor === String(index)),
        ),
      test.projectName,
    );
    for (const screenshot of [
      '01-fresh-home.png',
      ...Array.from({ length: 6 }, (_, index) => `02-practice-${index + 1}.png`),
      '03-completed-course.png',
      '04-saved-avatar.png',
      '05-restored-home.png',
    ])
      read(`${directory}/${screenshot}`);
    browserEvidence.push({
      browser: data.browser,
      browserVersion: data.browserVersion,
      metrics: data.metrics,
      source: files.get(`${directory}/native-ui.json`),
      targetScope:
        'Custom 6 exercises / 6 lessons / 1 case before the first learning event; course180 then case+daily190. Actual time, no content/fact/time mock.',
    });
  }
}
const stockPath = '.artifacts/11.5/stock-delivery-first/firefox-profile.json';
const stock = json(stockPath);
check(
  'Installed Firefox fresh native six lessons /24 groups/case/avatar/refresh',
  stock.passed === true &&
    stock.invocationEvidenceTask === '11.5' &&
    stock.ownedServicesStopped === true &&
    stock.frozenGroupTotal === 24 &&
    stock.checks.length === 6 &&
    stock.profile.finalPoints === 190 &&
    stock.profile.finalLevel === 3 &&
    stock.refreshPreservesHistoryWithoutNewFacts === true &&
    stock.refreshDoesNotRestoreEphemeralExecution === true,
  stockPath,
);
const startup = json('.artifacts/11.5/startup-first.json');
check(
  'Actual owned dev and production preview start and stop',
  startup.ownedProcessesStopped === true &&
    startup.userPreviewPort4173Untouched === true &&
    startup.freshMachineInstallTested === false &&
    same(startup.records.map((row) => row.mode).sort(), ['dev', 'preview']) &&
    startup.records.every((row) => row.contentReady && row.practiceReady),
  'startup-first',
);
const statusPaths = [
  'startup-first-exit.json',
  'stock-delivery-first-exit.json',
  'browser-chrome-first-exit.json',
  'browser-other-first-exit.json',
  'static-exit-codes.json',
  'audit-tools-exit.json',
];
const subprocesses = statusPaths.map((path) => json(`.artifacts/11.5/${path}`));
check(
  'All actual final subprocess exit records are zero',
  subprocesses.every((row) =>
    row.records
      ? row.records.length === 3 && row.records.every((record) => record.exitCode === 0)
      : row.task === '11.5' && row.exitCode === 0,
  ),
);
for (const row of subprocesses)
  for (const record of row.records ?? [row]) {
    read(record.path ?? record.log);
    if (record.logSha256) linked(record.path, record.logSha256);
  }
read('.artifacts/11.5/build-first.log');
const prerequisite = json('.artifacts/11.5/prerequisite-audit.json');
check(
  'All forty P0 prerequisites have real acceptance/handoff records',
  prerequisite.prerequisiteAuditPassed === true &&
    prerequisite.prerequisites.expected === 40 &&
    prerequisite.prerequisites.accepted === 40 &&
    prerequisite.prerequisites.rows.length === 40 &&
    prerequisite.blockers.length === 0,
);
for (const row of prerequisite.prerequisites.rows) {
  linked(row.acceptance.path, row.acceptance.sha256);
  linked(row.handoff.path, row.handoff.sha256);
}
check(
  'All thirty-nine unchanged production assets remain exact',
  prerequisite.currentBuild.productAssets.length === 39 &&
    prerequisite.currentBuild.extraProductPaths.length === 0,
);
for (const row of prerequisite.currentBuild.productAssets) {
  const actual = linked(row.path, row.expectedSha256);
  check('Actual production asset length matches', actual.bytes === row.expectedBytes, row.path);
}
const previous = json('.artifacts/11.4/final-evidence-23.json');
const execution = json('.artifacts/11.4/execution-audit-formal-23/report.json');
check(
  'Prior 11.4 actual accepted tolerance and complete sample matrix are preserved',
  previous.evidenceReady === true &&
    execution.matrixComplete === true &&
    execution.userTolerancePass === true &&
    execution.acceptedByToleranceCount === 3660 &&
    execution.browsers.every((row) => row.reviews.length === 30),
);
const priorOriginals = previous.files.filter(
  (row) => row.path.startsWith('.artifacts/') && row.path !== '.artifacts/artifact-hashes.json',
);
for (const row of priorOriginals) linked(row.path, row.sha256, false);
const oldHistory = json('.artifacts/11.4/historical-evidence-baseline.json');
for (const row of oldHistory.files) linked(row.path, row.sha256, false);
check('Exact protected historical scope retained', oldHistory.files.length === 4512);
const oldExecutionFiles = execution.browsers.flatMap((row) => [
  ...row.samples.map((sample) => sample.file),
  ...row.reviews.map((review) => review.file),
  ...row.cohortFiles.map((cohort) => cohort.file),
]);
for (const row of oldExecutionFiles) linked(row.path, row.sha256, false);
check(
  'All 5580 formal execution/review/cohort originals retained',
  oldExecutionFiles.length === 5580,
);
const opening = json('.artifacts/11.5/baseline.json');
const changes = opening.files
  .map((row) => ({
    path: row.path,
    before: row.sha256,
    current: read(row.path, false).record.sha256,
  }))
  .filter((row) => row.before !== row.current);
check(
  'No product, contract, dependency or old test source changed',
  changes.every((row) => ['README.md', '项目文档/任务进度与交接.md'].includes(row.path)),
  changes.map((row) => row.path),
);
const wasm = read('web/src/generated/c_viz_wasm_bg.wasm').record;
check(
  'Delivery uses the actual accepted Rust/WASM artifact',
  wasm.sha256 === previous.actualWasm.sha256,
);
const documents = [
  'README.md',
  '项目文档/交付/一期使用说明.md',
  '项目文档/交付/一期演示路径.md',
  '项目文档/验收/11.5-一期前置覆盖审阅.md',
  '项目文档/任务进度与交接.md',
  '项目文档/验收/11.5-一期交付验收.md',
  '项目文档/交接/11.5-交接.md',
];
const optionalMissing = [];
for (const path of documents) {
  if (
    values['check-only'] &&
    !existsSync(resolve(workspaceDir, path)) &&
    /11\.5-(?:一期交付验收|交接)\.md$/.test(path)
  )
    optionalMissing.push(path);
  else read(path);
}
read('tests/browser/p0-delivery.spec.ts');
read('scripts/collect-11.5-evidence.mjs');
const changedDuring = [...files.values()].filter(
  (row) => read(row.path, false).record.sha256 !== row.sha256,
);
check(
  'Evidence and coordination documents stayed stable during final scan',
  changedDuring.length === 0,
);
const failures = checks.filter((row) => !row.passed);
const result = {
  task: '11.5',
  kind: 'Actual fresh-profile P0 delivery evidence, coordinator decision separate',
  startedAt,
  endedAt: new Date().toISOString(),
  evidenceReady: failures.length === 0,
  browserEvidence,
  stock: {
    path: stockPath,
    scriptOriginalTask: stock.task,
    invocationEvidenceTask: stock.invocationEvidenceTask,
    browserVersion: stock.capabilities.browserVersion,
    passed: stock.passed,
    frozenGroupTotal: stock.frozenGroupTotal,
    profile: stock.profile,
    ownedServicesStopped: stock.ownedServicesStopped,
    defaultGoalScope: 'Default1/1/0, course185 then case190',
  },
  scope: {
    firstSubmissionGroupsPerBrowser: 24,
    totalRealExecutionsPerBrowser: 29,
    newBrowserContexts: 3,
    installedFirefoxSeparateFreshProfile: true,
    originalPerformanceTargetClaimedMet: false,
    coldToleranceMs: 800,
    warmToleranceMs: 600,
    deadlineSafetyMs: 1000,
    productChanged: false,
    fullQualityRerunClaimed: false,
  },
  integrity: {
    openingFiles: opening.files.length,
    changes,
    historicalFiles: oldHistory.files.length,
    previousIndexLinkedOriginals: priorOriginals.length,
    formalExecutionOriginals: oldExecutionFiles.length,
    actualWasm: wasm,
  },
  prerequisite,
  documents,
  optionalMissing,
  subprocesses,
  checks,
  failures,
  files: [...files.values()],
  boundaries: [
    'New machines/public hosting, physical continuous60fps, zero leaks and stock Firefox product50 rounds remain unmeasured.',
    '11.4 index source/ledger hashes describe its historical snapshot. New 11.5 coordinator documents and generated build manifest may legitimately change.',
    'Existing407Rust/846frontend/561browser results remain prior valid evidence for unchanged product; this task does not claim those were rerun.',
    'Native Worker messages are observed for authentic bytes; application execution remains Rust. IDB verification is readonly and all learning facts arise through production UI.',
  ],
};
if (failures.length) {
  console.error(JSON.stringify({ evidenceReady: false, failures }, null, 2));
  process.exitCode = 1;
} else if (!values['check-only'])
  writeFileSync(resolve(workspaceDir, output), JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
  });
console.log(
  JSON.stringify(
    {
      checkOnly: values['check-only'],
      evidenceReady: result.evidenceReady,
      checks: checks.length,
      failed: failures.length,
      optionalMissing,
      output: values['check-only'] ? null : output,
    },
    null,
    2,
  ),
);
