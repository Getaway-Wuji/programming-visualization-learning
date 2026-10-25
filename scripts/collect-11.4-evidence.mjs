// Read-only final evidence index. Run only after all browser measurements finish.
// No tests, builds, browsers, registrations, repairs or task-status updates run here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as same, parseArgs } from 'node:util';
import { workspaceDir } from './process.mjs';
import { qualifyPerformanceHost } from './performance-host.mjs';

const { values } = parseArgs({
  options: {
    'check-only': { type: 'boolean', default: false },
    label: { type: 'string', default: '23' },
  },
});
assert.match(values.label, /^[a-z0-9][a-z0-9-]*$/, 'Use a simple unique evidence suffix');
const checkOnly = values['check-only'];
const output = `.artifacts/11.4/final-evidence-${values.label}.json`;
const integrityOutput = `.artifacts/11.4/final-integrity-${values.label}.json`;
if (!checkOnly)
  assert.ok(
    !existsSync(resolve(workspaceDir, output)) &&
      !existsSync(resolve(workspaceDir, integrityOutput)),
    'Final evidence is immutable; use a later explicitly reviewed label instead of overwriting it',
  );
const startedAt = new Date().toISOString();
const files = new Map();
const failures = [];
const checks = [];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const check = (name, passed, details = null) => {
  checks.push({ name, passed: passed === true, details });
  if (passed !== true) failures.push({ name, details });
};
const absolute = (name) => {
  const target = resolve(workspaceDir, name);
  const child = relative(workspaceDir, target);
  assert.ok(
    child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child),
    'Evidence must stay inside this workspace',
  );
  return target;
};
const nameOf = (target) => relative(workspaceDir, absolute(target)).split(sep).join('/');
function read(name, index = true) {
  try {
    const target = absolute(name);
    const bytes = readFileSync(target);
    const record = { path: nameOf(target), sha256: sha(bytes), bytes: bytes.length };
    if (index) files.set(record.path, record);
    return { record, bytes };
  } catch (error) {
    check('Required evidence is readable', false, { path: name, error: error.message });
    return null;
  }
}
function json(name) {
  const input = read(name);
  if (!input) return null;
  try {
    return JSON.parse(input.bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    check('Required evidence is valid JSON', false, { path: name, error: error.message });
    return null;
  }
}
const text = (name) => read(name)?.bytes.toString('utf8') ?? '';
const allTrue = (object) => !!object && Object.values(object).every((value) => value === true);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const sum = (rows, value) => rows.reduce((total, row) => total + value(row), 0);
function log(name, success) {
  const content = text(name);
  check(
    'Required completed log marker',
    content.length > 0 && (!success || success.test(content)),
    name,
  );
  return content;
}
function linked(name, expected) {
  const input = read(name);
  check('Referenced original SHA still matches', !!input && input.record.sha256 === expected, name);
  return input?.record;
}
function host(directory, report) {
  const start = json(`${directory}/host-start.json`);
  const end = json(`${directory}/host-end.json`);
  const qualification = qualifyPerformanceHost(start, end);
  check(
    'Actual host endpoints remain linked and qualified',
    !!report &&
      same(start, report.hostConditions) &&
      same(end, report.hostConditionsEnd) &&
      qualification.satisfied &&
      (report.hostBaseline ?? report.referenceHost)?.satisfied === true,
    directory,
  );
  return qualification;
}

const executionPath = '.artifacts/11.4/execution-audit-formal-23/report.json';
const execution = json(executionPath);
const engines = execution?.browsers ?? [];
const categories = Object.fromEntries(
  ['within500', 'minor500To600', 'above600', 'invalid'].map((key) => [
    key,
    sum(engines, (row) => row.categories?.[key] ?? 0),
  ]),
);
const executionCount = sum(engines, (row) => row.samples?.length ?? 0);
const reviewCount = sum(engines, (row) => row.reviews?.length ?? 0);
check(
  'Full execution audit: 3660 valid executions and 90 actual reviews',
  execution?.matrixComplete === true &&
    execution.userTolerancePass === true &&
    execution.sameBuild === true &&
    execution.sameHarness === true &&
    engines.length === 3 &&
    executionCount === 3660 &&
    reviewCount === 90 &&
    categories.invalid === 0 &&
    execution.acceptedByToleranceCount === 3660 &&
    !execution.issues?.length &&
    engines.every(
      (row) =>
        row.matrixComplete &&
        row.userTolerancePass &&
        row.evidenceQualified &&
        row.samples.length === 1220 &&
        row.reviews.length === 30 &&
        row.reviewsPassed === 30 &&
        row.reviewsInvalid === 0 &&
        !row.issues?.length,
    ),
);
check(
  'Execution tolerance is still cold 800 / warm 600 with original 500 and safety 1000',
  execution?.policy?.originalExecutionMs === 500 &&
    execution.policy.unchangedSafetyMs === 1000 &&
    execution.policy.reviewMs === 2000 &&
    same(execution.policy.userToleranceByModuleStateMs, { cold: 800, warm: 600 }),
);
const sourceRuns = [];
for (const row of engines) {
  linked(row.source.path, row.source.sha256);
  const report = json(row.source.path);
  sourceRuns.push({
    browser: row.browser,
    startedAt: report?.startedAt,
    endedAt: report?.endedAt,
    source: row.source,
    categories: row.categories,
    originalTargetPass: row.originalTargetPass,
    userTolerancePass: row.userTolerancePass,
    cold600To800: row.cold600To800,
  });
  log(`.artifacts/11.4/execution-${row.browser}-formal-23.log`);
}
const policyPath = '项目文档/架构决策/11.4-轻微性能偏差裁决.md';
const policyText = text(policyPath);
const policyModified = existsSync(absolute(policyPath))
  ? statSync(absolute(policyPath)).mtimeMs
  : NaN;
const chromeStart = Date.parse(sourceRuns.find((row) => row.browser === 'chrome')?.startedAt);
check(
  'State-specific tolerance decision predates the first formal Chrome run',
  finite(policyModified) &&
    finite(chromeStart) &&
    policyModified < chromeStart &&
    policyText.includes('冷Module首次按需加载≤800ms、暖Module≤600ms') &&
    policyText.includes('不宣称原500ms目标已经达成'),
);
const navigation = json('.artifacts/11.4/navigation-aggregate-23.json');
check(
  'Navigation aggregate retains all 210 valid samples',
  navigation?.aggregateCoverageComplete === true &&
    navigation.allSelectedSamplesVerified === true &&
    navigation.counts?.selected === 210 &&
    navigation.counts.retainedLegacyObserverFailures === 30 &&
    navigation.checks.failed === 0 &&
    navigation.matrix?.length === 42 &&
    navigation.matrix.every(
      (row) => row.observed === 5 && row.independentlyVerified === 5 && row.complete,
    ) &&
    navigation.selectedSamples.every((row) => finite(row.completeMs) && row.completeMs <= 2000),
);
read('.artifacts/11.4/navigation-aggregate-23.md');
if (navigation?.observerChange?.after)
  linked(navigation.observerChange.after.path, navigation.observerChange.after.sha256);

function playwright(name, expected) {
  const report = json(name);
  const stats = report?.stats;
  check(
    `Playwright ${expected} exact passing scope with no retry`,
    stats?.expected === expected &&
      stats.unexpected === 0 &&
      stats.skipped === 0 &&
      stats.flaky === 0 &&
      report.config?.projects.length === 3 &&
      report.config.projects.every((project) => project.retries === 0),
  );
  return {
    stats,
    projects: report?.config?.projects.map(({ name: project, retries }) => ({
      name: project,
      retries,
    })),
  };
}
const browser = playwright('.artifacts/11.4/browser-final-23.json', 561);
log('.artifacts/11.4/browser-final-23.log', /561 passed/);
const unit = json('.artifacts/11.4/unit-shell-build-13.json');
check(
  'Complete frontend 846 / 846 with no pending tests',
  unit?.success === true &&
    unit.numPassedTests === 846 &&
    unit.numTotalTests === 846 &&
    unit.numFailedTests === 0 &&
    unit.numPendingTests === 0,
);
log('.artifacts/11.4/unit-shell-build-13.log', /846 passed/);
const rustLog = log('.artifacts/11.4/rust-shell-full-13.log');
const rustResults = [
  ...rustLog.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;/g),
].map((match) => match.slice(1).map(Number));
const rust = {
  passed: sum(rustResults, (row) => row[0]),
  failed: sum(rustResults, (row) => row[1]),
  ignored: sum(rustResults, (row) => row[2]),
  ignoredLines: rustLog.split(/\r?\n/).filter((line) => /^test .* \.\.\. ignored/.test(line)),
};
check(
  'Rust 407 pass, zero failed, only one explicitly optional native microbenchmark ignored',
  rust.passed === 407 &&
    rust.failed === 0 &&
    rust.ignored === 1 &&
    rust.ignoredLines.length === 1 &&
    rust.ignoredLines[0].includes('append_zero_native_microbenchmark') &&
    rust.ignoredLines[0].includes('optional native microbenchmark') &&
    !/test result: FAILED|error: could not compile/.test(rustLog),
);
const mechanism = playwright('.artifacts/11.4/mechanisms-browser-17.json', 9);
log('.artifacts/11.4/mechanisms-browser-17.log', /9 passed/);

const stock = [];
const stableDirectory = '.artifacts/11.4/stock-stable-23';
const stable = json(`${stableDirectory}/firefox-stable.json`);
log(
  '.artifacts/11.4/stock-stable-23.log',
  /Stock Firefox 158\.0: navigation, app, cold\/warm WASM, storage, failure\/recovery passed\./,
);
check(
  'Stock stable actual smoke data and success log, without inventing passed',
  stable?.evidenceLevel === 'engineering-browser-smoke' &&
    stable.capabilities?.browserVersion === '158.0' &&
    !Object.hasOwn(stable, 'passed') &&
    stable.checks?.cold?.moduleMode === 'cold' &&
    stable.checks.warm?.moduleMode === 'warm' &&
    ['cold', 'warm', 'recovered'].every(
      (key) =>
        stable.checks[key]?.terminated === true &&
        stable.checks[key]?.memory?.maximumPages === 2048,
    ) &&
    stable.checks.missingError?.includes('404') &&
    !existsSync(absolute(`${stableDirectory}/firefox-adapter-failure.json`)),
);
for (const file of [
  'firefox-adapters.json',
  '03.4-firefox-integration.json',
  '04.1-firefox-storage.json',
  '04.2-firefox-learning.json',
  '04.3-firefox-recovery.json',
  'firefox-player.json',
  'firefox-trace-view.json',
  'firefox-execution-regression.json',
  'firefox-input.json',
])
  json(`${stableDirectory}/${file}`);
stock.push({
  kind: 'stable',
  browserVersion: stable?.capabilities?.browserVersion,
  reportedPassedField: null,
  ownedServicesStoppedField: null,
  conclusion:
    'Actual success log and archived smoke/recovery artifacts checked. This older script has no passed or awaited-owned-cleanup flag; neither is manufactured.',
});
for (const kind of ['rewards', 'goals', 'profile']) {
  const report = json(`.artifacts/11.4/stock-${kind}-23/firefox-${kind}.json`);
  log(`.artifacts/11.4/stock-${kind}-23.log`, /six lessons, 24 real groups.*passed\./);
  read(`.artifacts/11.4/stock-${kind}-23/firefox-${kind}-services.log`);
  check(
    `Stock ${kind}: real six lessons / 24 groups and owned cleanup`,
    report?.passed === true &&
      report.ownedServicesStopped === true &&
      report.invocationEvidenceTask === '11.4' &&
      report.capabilities?.browserVersion === '158.0' &&
      report.frozenGroupTotal === 24 &&
      report.checks?.length === 6 &&
      sum(report.checks, (row) => row.frozenTests) === 24 &&
      report.refreshPreservesHistoryWithoutNewFacts === true &&
      report.refreshDoesNotRestoreEphemeralExecution === true &&
      !report.cleanupError &&
      !report.failure,
  );
  stock.push({
    kind,
    passed: report?.passed,
    ownedServicesStopped: report?.ownedServicesStopped,
    groups: report?.frozenGroupTotal,
    browserVersion: report?.capabilities?.browserVersion,
    counts: report?.counts,
  });
}
const playback = [];
for (const label of [
  'playback-chrome-shell-15',
  'playback-edge-shell-15',
  'playback-firefox-raw-third-15',
]) {
  const directory = `.artifacts/11.4/${label}`;
  const report = json(`${directory}/report.json`);
  log(`${directory}.log`);
  const qualification = host(directory, report);
  check(
    'Real playback measured metrics, drawings, native controls and host pass',
    report?.allMeasuredChecksPass === true &&
      report.nativeFunctionalPassed === true &&
      report.submetricConclusion?.allThreeMetricsPass === true &&
      report.submetricConclusion.actualDrawingEvidencePresent === true &&
      report.observation?.stableMs === 30000 &&
      !report.failure &&
      report.cleanupErrors?.length === 0,
    label,
  );
  if (report?.trace?.rawFile)
    linked(resolve(absolute(directory), report.trace.rawFile), report.trace.sha256);
  else check('Raw actual drawing trace is present', false, label);
  playback.push({
    label,
    browserVersion: report?.browserVersion,
    stable: report?.stable,
    conclusion: report?.submetricConclusion,
    host: qualification,
    physicalSixtyFpsClaimed: false,
  });
}
const lifecycle = [];
for (const engine of ['chrome', 'edge']) {
  const directory = `.artifacts/11.4/product-lifecycle-${engine}-shell-14`;
  const report = json(`${directory}/report.json`);
  log(`${directory}.log`);
  const qualification = host(directory, report);
  check(
    'Product lifecycle: exact 50 alternating rounds, native correctness and cancellation',
    report?.lifecyclePass === true &&
      report.complete === true &&
      report.roundsRequested === 50 &&
      report.rounds?.length === 50 &&
      report.rounds.every((row) => row.passed && !row.failure && allTrue(row.controls)) &&
      report.summary?.completed === 25 &&
      report.summary.cancelled === 25 &&
      report.summary.failures?.length === 0 &&
      report.summary.cancellationMs?.max <= 100 &&
      report.summary.wasmPages?.max <= 2048 &&
      report.summary.maximumActiveWorkers === 1 &&
      report.summary.uniqueRoundWorkers === 50 &&
      report.summary.uniqueRoundOperations === 50 &&
      report.extraChecksPassed === true,
    engine,
  );
  lifecycle.push({
    browser: engine,
    summary: report?.summary,
    host: qualification,
    stockFirefox: report?.stockFirefox,
    memoryTrends: report?.memoryTrends,
    memoryBoundary: report?.memoryInterpretation,
  });
}
for (const name of ['product-lifecycle-source-audit-11.md', 'product-lifecycle-memory-audit-14.md'])
  read(`.artifacts/11.4/${name}`);

// Logs alone do not prove an empty-output compiler/linter exited successfully.
// Root must preserve the already observed process results, without inventing or rerunning them:
// { task:'11.4', records:[{kind:'typecheck',path:'actual-new-log.log',exitCode:0,provenance:'...'}, ...] }
const qualityStatus = json('.artifacts/11.4/static-exit-codes-final-23.json');
const quality = [];
for (const [kind, marker] of [
  ['typecheck', /> tsc --build/],
  ['lint', /> eslint \. --max-warnings 0/],
  ['format', /All matched files use Prettier code style!/],
]) {
  const status = qualityStatus?.records?.filter((row) => row.kind === kind) ?? [];
  const name =
    typeof status[0]?.path === 'string'
      ? status[0].path
      : `.artifacts/11.4/missing-${kind}-exit-log`;
  const content = log(name, marker);
  check(
    'Actual quality process exit is recorded independently of log silence',
    qualityStatus?.task === '11.4' &&
      status.length === 1 &&
      status[0].exitCode === 0 &&
      typeof status[0].provenance === 'string' &&
      status[0].provenance.trim().length > 0 &&
      !/error TS\d+|Oops! Something went wrong|\n.+\d+:\d+\s+error\s|Code style issues found/.test(
        content,
      ),
    kind,
  );
  quality.push({ kind, processRecord: status[0] ?? null, log: files.get(name) });
}
const startup = json('.artifacts/11.4/startup-23.json');
log(
  '.artifacts/11.4/startup-23.log',
  /Owned dev and preview: real content \/ Rust-WASM checks passed; processes stopped\./,
);
check(
  'Owned dev and production preview really started and stopped',
  startup?.evidenceLevel === 'real-owned-dev-and-preview-startup' &&
    startup.ownedProcessesStopped === true &&
    startup.userPreviewPort4173Untouched === true &&
    same(startup.records?.map((row) => row.mode).sort(), ['dev', 'preview']) &&
    startup.records.every(
      (row) =>
        row.contentReady &&
        row.practiceReady &&
        row.audit?.workers?.length === 1 &&
        row.audit.workers.every((worker) => worker.terminated) &&
        ['passivePractice', 'passiveCase'].every(
          (key) =>
            row[key]?.workers?.length === 0 &&
            row[key]?.wasmFetches === 0 &&
            row[key]?.compiles === 0,
        ),
    ),
);

// Recompute at invocation time; the earlier review is only an anchor for frozen
// paths and the append-only registrations/resources, never a replacement scan.
const anchorPath = '.artifacts/11.4/integrity-audit-23.json';
const anchor = json(anchorPath);
function compareBaseline(name, count) {
  const baseline = json(name);
  const rows = (baseline?.files ?? []).map((row) => {
    const input = read(row.path, false);
    return {
      path: row.path,
      expectedSha256: row.sha256,
      currentSha256: input?.record.sha256 ?? null,
      status: !input ? 'missing' : input.record.sha256 === row.sha256 ? 'unchanged' : 'changed',
    };
  });
  check(
    'Baseline has the exact original unique scope',
    rows.length === count && new Set(rows.map((row) => row.path)).size === count,
    name,
  );
  return {
    baseline: files.get(name),
    counts: {
      total: rows.length,
      unchanged: rows.filter((row) => row.status === 'unchanged').length,
      changed: rows.filter((row) => row.status === 'changed').length,
      missing: rows.filter((row) => row.status === 'missing').length,
    },
    files: rows,
  };
}
const historical = compareBaseline('.artifacts/11.4/historical-evidence-baseline.json', 4512);
const opening = compareBaseline('.artifacts/11.4/baseline.json', 561);
check(
  'All 4512 protected historical evidence originals remain intact',
  historical.counts.unchanged === 4512,
);
check('No opening source path is missing', opening.counts.missing === 0);
const openingByPath = new Map(opening.files.map((row) => [row.path, row]));
const frozenPaths = anchor?.frozenPaths ?? [];
check(
  'Earlier independently reviewed frozen scope exists',
  anchor?.passed === true &&
    frozenPaths.length === 55 &&
    frozenPaths.filter((row) => row.path.startsWith('项目文档/契约/')).length === 26,
);
for (const row of [...frozenPaths, ...(anchor?.locks ?? [])])
  check(
    'Frozen public/learning/content/lock bytes unchanged since opening',
    openingByPath.get(row.path)?.status === 'unchanged' &&
      openingByPath.get(row.path)?.expectedSha256 === row.expectedSha256,
    row.path,
  );
const registrations = [];
for (const row of anchor?.registrations ?? []) {
  linked(row.path, row.sha256);
  const current = json(row.path);
  if (current?.priorRegistration)
    linked(current.priorRegistration.path, current.priorRegistration.sha256);
  if (current?.releaseVersion === '1.0.4') {
    check(
      'Current registration still lists exact reviewed 12 paths',
      same(
        current.files.map((entry) => entry.path),
        row.sourceFiles.map((entry) => entry.path),
      ) && current.files.length === 12,
    );
    for (const entry of current.files) linked(entry.path, entry.sha256);
  }
  registrations.push({
    path: row.path,
    sha256: row.sha256,
    releaseVersion: current?.releaseVersion,
  });
}
check('All five immutable Blockly registrations are preserved', registrations.length === 5);
for (const resource of anchor?.learning?.resources ?? []) {
  linked(resource.file.path, resource.file.sha256);
  linked(resource.production.path, resource.production.sha256);
  if (resource.preservedOriginal)
    linked(resource.preservedOriginal.path, resource.preservedOriginal.sha256);
}
check(
  'All old and current reviewed learning resources are anchored',
  anchor?.learning?.resources.length === 5,
);
const content = json('content/c/p0/course-1.0.1.json');
const learning = json('web/public/content/learning/course-learning-1.0.4.json');
check(
  'Public contract and entity learning revisions remain frozen',
  content?.contractVersion === '1.0.0' &&
    learning?.learningVersion === '1.0.0' &&
    content.lessons.concat(content.exercises, content.cases).length === 19 &&
    content.lessons
      .concat(content.exercises, content.cases)
      .every((row) => row.learningRevision === 1),
);
const wasm = read('web/src/generated/c_viz_wasm_bg.wasm')?.record;
check(
  'Actual WASM agrees with every formal audited build',
  !!wasm && engines.length === 3 && engines.every((row) => row.build?.wasmSha256 === wasm.sha256),
);
const boundaries = [
  'Evidence index only: taskAccepted is false pending coordinator review; no ledger or task document is changed.',
  'Original 500ms failures and all raw passed fields remain unchanged. Valid cold <=800ms / warm <=600ms acceptance follows the recorded pre-matrix decision and does not claim the original goal was met.',
  'Detailed execution/review sample paths and hashes remain in execution-audit-formal-23/report.json; this index links that audit and its original source reports instead of duplicating traces.',
  'Playback records real drawing plus the three measured metrics; default 500ms steps, rAF counts or screenshot cadence do not prove continuous physical 60fps.',
  'Chrome/Edge product 50-round lifecycle and natural memory trends are measured. Stock Firefox product 50-round lifecycle is unmeasured; its ordinary functional and real performance coverage is separately indexed.',
  'Stock stable has no top-level passed or awaited ownedServicesStopped flag. Its actual success log and completed artifacts are preserved without manufacturing those fields.',
  'The opening 561-file list may legitimately change during 11.4; current differences are recorded without labeling all changes unauthorized. Only the original 4512 protected files, frozen scopes and immutable resources must match.',
  'Fresh-machine installation/public hosting and the isolated Frame-reuse candidate are not validated by this index. Later new 11.4 documents can change without modifying old protected evidence.',
];
const references = [
  '项目文档/验收/11.4-异常性能兼容验收.md',
  '项目文档/验收/11.4-异常覆盖矩阵.md',
  '项目文档/交接/11.4-进行中交接.md',
  '项目文档/交接/11.4-交接.md',
  '项目文档/任务进度与交接.md',
  '.artifacts/11.4/browser-candidate-06-failure-classification.json',
  '.artifacts/11.4/playback-firefox-60-first-10/report.json',
  '.artifacts/11.4/playback-firefox-profiler-second-12/report.json',
];
const optionalMissingReferences = [];
for (const name of references) {
  if (checkOnly && name === '项目文档/交接/11.4-交接.md' && !existsSync(absolute(name)))
    optionalMissingReferences.push(name);
  else read(name);
}
const changedDuringCollection = [];
for (const file of files.values()) {
  const current = read(file.path, false)?.record.sha256;
  if (current !== file.sha256)
    changedDuringCollection.push({
      path: file.path,
      indexedSha256: file.sha256,
      finalSha256: current ?? null,
    });
}
check(
  'Indexed reports and decisions remained stable during collection',
  changedDuringCollection.length === 0,
  changedDuringCollection,
);
const endedAt = new Date().toISOString();
const integrity = {
  task: '11.4',
  kind: 'Actual final invocation integrity snapshot',
  startedAt,
  endedAt,
  passed: failures.length === 0,
  anchor: files.get(anchorPath),
  historical,
  openingSource: opening,
  frozenPaths: frozenPaths.map((row) => openingByPath.get(row.path)),
  locks: (anchor?.locks ?? []).map((row) => openingByPath.get(row.path)),
  registrations,
  changedDuringCollection,
  boundary: boundaries[6],
};
const result = {
  task: '11.4',
  kind: 'Read-only final machine evidence index for coordinator review',
  startedAt,
  endedAt,
  collectorSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  evidenceReady: failures.length === 0,
  taskAccepted: false,
  acceptanceBasis: {
    policy: files.get(policyPath),
    modifiedAtUtc: finite(policyModified) ? new Date(policyModified).toISOString() : null,
    firstFormalChromeStartedAt: sourceRuns.find((row) => row.browser === 'chrome')?.startedAt,
    originalTargetPass: execution?.originalTargetPass ?? null,
    userTolerancePass: execution?.userTolerancePass ?? null,
    categories,
    cold600To800: execution?.cold600To800,
    original500msTargetClaimedMet: execution?.originalTargetPass === true,
  },
  coverage: {
    executions: executionCount,
    actualReviews: reviewCount,
    invalidExecutions: categories.invalid,
    navigation: navigation?.counts.selected,
    browser,
    frontend: { passed: unit?.numPassedTests, total: unit?.numTotalTests },
    rust,
    mechanism,
  },
  sourceRuns,
  stock,
  playback,
  lifecycle,
  quality,
  startup: {
    evidenceLevel: startup?.evidenceLevel,
    ownedProcessesStopped: startup?.ownedProcessesStopped,
    freshMachineInstallTested: startup?.freshMachineInstallTested,
  },
  actualWasm: wasm,
  publicVersions: {
    contract: content?.contractVersion,
    learningVersion: learning?.learningVersion,
    subjectLearningRevision: 1,
    blocklyRegistration: registrations.at(-1)?.releaseVersion,
  },
  integrity: {
    path: integrityOutput,
    counts: { historical: historical.counts, openingSource: opening.counts },
  },
  references,
  optionalMissingReferences,
  boundaries,
  checks,
  failures,
  files: [...files.values()],
};
if (failures.length) {
  console.error(
    JSON.stringify({ checkOnly, evidenceReady: false, failures, filesWritten: [] }, null, 2),
  );
  process.exitCode = 1;
} else if (!checkOnly) {
  const integrityBytes = Buffer.from(JSON.stringify(integrity, null, 2) + '\n');
  result.integrity.sha256 = sha(integrityBytes);
  writeFileSync(absolute(integrityOutput), integrityBytes, { flag: 'wx' });
  writeFileSync(absolute(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
if (!failures.length)
  console.log(
    JSON.stringify(
      {
        checkOnly,
        evidenceReady: true,
        taskAccepted: false,
        optionalMissingReferences,
        coverage: {
          executions: executionCount,
          reviews: reviewCount,
          navigation: navigation.counts.selected,
        },
        output: checkOnly ? null : output,
        integrity: checkOnly ? null : integrityOutput,
      },
      null,
      2,
    ),
  );
