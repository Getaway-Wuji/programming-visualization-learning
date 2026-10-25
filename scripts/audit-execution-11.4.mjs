// Read-only audit of real 11.4 execution evidence. Never retries or repairs samples.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { performanceCases, performanceExercises } from './performance-workloads.mjs';
import { qualifyPerformanceHost } from './performance-host.mjs';
import { workspaceDir } from './process.mjs';

// node scripts/audit-execution-11.4.mjs --label execution-audit-formal-23
// Optional: --chrome PATH --edge PATH --firefox PATH --build-manifest PATH
// --check-only prints the result and creates no evidence files (exit 1 if incomplete/failed).
const { values } = parseArgs({
  options: {
    chrome: { type: 'string' },
    edge: { type: 'string' },
    firefox: { type: 'string' },
    label: { type: 'string' },
    'build-manifest': { type: 'string', default: '.artifacts/artifact-hashes.json' },
    'check-only': { type: 'boolean', default: false },
  },
});
if (!values['check-only'])
  assert.match(values.label ?? '', /^[a-z0-9-]+$/, 'A new --label is required');
assert.equal(performanceCases.length, 55);
assert.equal(performanceExercises.length, 6);
const definitions = [
  ...performanceCases.map((entry) => ({ key: entry.key, kind: 'case' })),
  ...performanceExercises.map((key) => ({ key, kind: 'exercise' })),
];
assert.equal(new Set(definitions.map((entry) => entry.key)).size, 61);
const practice = JSON.parse(
  readFileSync(join(workspaceDir, 'web/public/content/practice/course-practice-1.0.0.json')),
);
const groupCounts = new Map(practice.exercises.map((entry) => [entry.id, entry.tests.length]));
assert.deepEqual(
  performanceExercises.map((key) => groupCounts.get(key)),
  [3, 3, 3, 4, 5, 6],
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};
const digest = (value) => sha256(JSON.stringify(canonical(value)));
function load(path, issues) {
  const absolute = resolve(workspaceDir, path);
  try {
    const bytes = readFileSync(absolute);
    return {
      path: absolute,
      sha256: sha256(bytes),
      data: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')),
    };
  } catch (error) {
    issues.push(`${absolute}: ${error.message}`);
    return { path: absolute, sha256: null, data: null };
  }
}
const expectedExecutions = definitions.flatMap((entry) =>
  ['cold', 'warm'].flatMap((mode) =>
    Array.from({ length: 10 }, (_, index) => ({
      ...entry,
      mode,
      repeat: index + 1,
      id: `${entry.key}-${mode}-${index + 1}`,
    })),
  ),
);
const expectedReviews = performanceExercises.flatMap((key) =>
  Array.from({ length: 5 }, (_, index) => ({
    key,
    repeat: index + 1,
    id: `${key}-review-${index + 1}`,
  })),
);
const expectedCohorts = definitions.flatMap((entry) =>
  Array.from({ length: 10 }, (_, index) => ({
    ...entry,
    repeat: index + 1,
    id: `${entry.key}-cohort-${index + 1}`,
  })),
);
function grid(rows, expected) {
  const wanted = new Map(expected.map((entry) => [entry.id, entry]));
  const seen = new Set(),
    duplicates = [],
    unexpected = [],
    mismatches = [];
  for (const row of rows) {
    if (seen.has(row.id)) duplicates.push(row.id);
    seen.add(row.id);
    const target = wanted.get(row.id);
    if (!target) unexpected.push(row.id ?? null);
    else if (Object.entries(target).some(([key, value]) => row[key] !== value))
      mismatches.push(row.id);
  }
  const missing = expected.filter((entry) => !seen.has(entry.id)).map((entry) => entry.id);
  return {
    expected: expected.length,
    actual: rows.length,
    missing,
    duplicates,
    unexpected,
    mismatches,
    complete:
      rows.length === expected.length &&
      !missing.length &&
      !duplicates.length &&
      !unexpected.length &&
      !mismatches.length,
  };
}
function linkedFile(directory, row, issues) {
  if (!/^[a-z0-9.-]+-(?:cold|warm|review|cohort)-\d+$/.test(row.id ?? '')) {
    issues.push(`Unsafe or missing evidence ID: ${String(row.id)}`);
    return { path: null, sha256: null, matchesReport: false };
  }
  const file = load(join(directory, `${row.id}.json`), issues);
  const matchesReport = file.data !== null && isDeepStrictEqual(file.data, row);
  if (file.data !== null && !matchesReport)
    issues.push(`${file.path}: content differs from report`);
  return { path: file.path, sha256: file.sha256, matchesReport };
}
const essentialExecutionControls = [
  'trustedClick',
  'newIntent',
  'moduleStateConfirmed',
  'freshWorkers',
  'maximumOneWorker',
  'noOlderLiveWorker',
  'sharedReadonlyModule',
  'workersTerminated',
  'foreground',
  'correctViewport',
  'completeRustTrace',
  'playableInitialProjection',
  'resultCorrect',
  'sourceCorrect',
  'privateTimings',
  'boundedWasm',
];
const allControls = (controls, required) =>
  !!controls &&
  required.every((key) => controls[key] === true) &&
  Object.values(controls).every((value) => value === true);
const environmentValid = (environment) =>
  environment?.focus === true &&
  environment.visibility === 'visible' &&
  isDeepStrictEqual(environment.viewport, [1440, 900]) &&
  environment.devicePixelRatio === 1 &&
  (environment.zoom === undefined || environment.zoom === 1);
const endpointValid = (row) =>
  Number.isFinite(row.wholeMs) &&
  row.wholeMs >= 0 &&
  row.intent?.trusted === true &&
  Number.isFinite(row.intent.at) &&
  Number.isFinite(row.intent.end) &&
  Math.abs(row.wholeMs - (row.intent.end - row.intent.at)) <= 1e-6 &&
  row.intent.playable === true &&
  row.intent.paintVisible === true;
function classifyExecution(row, file, contextReasons) {
  const reasons = [...contextReasons];
  const required = [
    ...essentialExecutionControls,
    ...(row.mode === 'warm' ? ['warmPreparation'] : []),
  ];
  if (!file.matchesReport) reasons.push('raw-file-link');
  if (row.failure) reasons.push('recorded-failure');
  if (!allControls(row.controls, required)) reasons.push('controls');
  if (
    !endpointValid(row) ||
    String(row.intent?.cursor) !== '0' ||
    !(Number(row.intent?.length) > 0)
  )
    reasons.push('endpoint');
  if (!environmentValid(row.environment) || !environmentValid(row.afterEnvironment))
    reasons.push('foreground-or-viewport');
  const definition = definitions.find((entry) => entry.key === row.key);
  if (
    !definition ||
    row.kind !== definition.kind ||
    !['cold', 'warm'].includes(row.mode) ||
    !Number.isInteger(row.repeat) ||
    row.repeat < 1 ||
    row.repeat > 10 ||
    row.id !== `${row.key}-${row.mode}-${row.repeat}` ||
    row.state !== (row.kind === 'case' ? 'completed' : 'passed')
  )
    reasons.push('workload-or-result');
  const workers = Array.isArray(row.workers) ? row.workers : [];
  const expectedGroups = row.kind === 'exercise' ? groupCounts.get(row.key) : 1;
  if (
    workers.length !== expectedGroups ||
    row.expectedGroups !== expectedGroups ||
    !workers.length ||
    workers.some(
      (worker) =>
        worker.kind !== 'execute' ||
        !Number.isFinite(worker.terminatedAt) ||
        worker.technical?.wasmPages <= 0 ||
        !(worker.technical?.wasmPages <= 2048) ||
        !Array.isArray(worker.technical?.rust) ||
        worker.technical.rust.length !== 27 ||
        worker.technical.rust[0] !== 1 ||
        worker.technical.rust[13] !== 1 ||
        worker.technical.rust[26] !== 0 ||
        !worker.technical.rust.every(Number.isFinite),
    ) ||
    workers.at(-1)?.terminal !== 'completed' ||
    workers.at(-1)?.completeness !== 'complete' ||
    !(workers.at(-1)?.steps > 0)
  )
    reasons.push('real-rust-result');
  const expectedOriginalPass = row.wholeMs <= 500;
  if (!reasons.length && row.passed !== expectedOriginalPass)
    reasons.push('original-passed-inconsistent');
  const category = reasons.length
    ? 'invalid'
    : row.wholeMs <= 500
      ? 'within500'
      : row.wholeMs <= 600
        ? 'minor500To600'
        : 'above600';
  const limitMs = row.mode === 'cold' ? 800 : row.mode === 'warm' ? 600 : null;
  return {
    id: row.id,
    key: row.key,
    mode: row.mode,
    repeat: row.repeat,
    wholeMs: row.wholeMs ?? null,
    originalPassed: row.passed,
    category,
    limitMs,
    acceptedByTolerance: category !== 'invalid' && limitMs !== null && row.wholeMs <= limitMs,
    reasons,
    file,
  };
}
function classifyReview(row, file, samples, contextReasons) {
  const reasons = [...contextReasons];
  const required = [
    'trustedClick',
    'newIntent',
    'realSession',
    'noRerun',
    'retainedCursor',
    'playable',
    'foreground',
  ];
  if (!file.matchesReport) reasons.push('raw-file-link');
  if (row.failure) reasons.push('recorded-failure');
  if (
    !allControls(row.controls, required) ||
    !(row.controls?.route || row.controls?.reviewRoute) ||
    !(row.controls?.retainedSource || row.controls?.exactRetainedSource) ||
    !(row.controls?.retainedOutput || row.controls?.exactRetainedOutput)
  )
    reasons.push('controls');
  if (!endpointValid(row)) reasons.push('endpoint');
  if (
    !performanceExercises.includes(row.key) ||
    !Number.isInteger(row.repeat) ||
    row.repeat < 1 ||
    row.repeat > 5 ||
    row.id !== `${row.key}-review-${row.repeat}`
  )
    reasons.push('review-identity');
  const warm = samples.find((entry) => entry.id === `${row.key}-warm-${row.repeat}`);
  if (!warm || warm.category === 'invalid') reasons.push('real-warm-session');
  if (!environmentValid(row.environment) || !environmentValid(row.afterEnvironment))
    reasons.push('foreground-or-viewport');
  const expectedOriginalPass = row.wholeMs <= 2000;
  if (!reasons.length && row.passed !== expectedOriginalPass)
    reasons.push('original-passed-inconsistent');
  return {
    id: row.id,
    key: row.key,
    repeat: row.repeat,
    wholeMs: row.wholeMs ?? null,
    originalPassed: row.passed,
    valid: reasons.length === 0,
    passed: reasons.length === 0 && row.wholeMs <= 2000,
    reasons,
    file,
  };
}
const normalizeManifest = (entries) =>
  Array.isArray(entries)
    ? entries
        .map((entry) => ({ path: entry.path, bytes: entry.rawBytes, sha256: entry.identitySha256 }))
        .sort((a, b) => a.path.localeCompare(b.path))
    : [];
const globalIssues = [];
const sharedHashKeys = [
  'package-lock.json',
  'Cargo.lock',
  'scripts/performance-observer.mjs',
  'scripts/performance-workloads.mjs',
];
const workloadsSha256 = sha256(
  readFileSync(join(workspaceDir, 'scripts/performance-workloads.mjs')),
);
const build = load(values['build-manifest'], globalIssues);
const productionManifest = (build.data?.entries ?? [])
  .filter((entry) => entry.path.startsWith('web/dist/'))
  .map((entry) => ({
    path: entry.path.slice('web/dist'.length),
    bytes: entry.bytes,
    sha256: entry.sha256,
  }))
  .sort((a, b) => a.path.localeCompare(b.path));
const browsers = ['chrome', 'edge', 'firefox'].map((name) => {
  const issues = [];
  const source = load(
    values[name] ?? `.artifacts/11.4/execution-${name}-formal-23/report.json`,
    issues,
  );
  const report = source.data ?? {},
    directory = dirname(source.path);
  const rows = Array.isArray(report.samples) ? report.samples : [],
    reviewRows = Array.isArray(report.reviews) ? report.reviews : [],
    cohorts = Array.isArray(report.cohorts) ? report.cohorts : [];
  const cohortFiles = cohorts.map((row) => ({
    id: row.id,
    file: linkedFile(directory, row, issues),
  }));
  const knownFiles = new Set([...rows, ...reviewRows].map((row) => `${row.id}.json`));
  const orphanFiles = existsSync(directory)
    ? readdirSync(directory).filter(
        (file) => /-(?:cold|warm|review)-\d+\.json$/.test(file) && !knownFiles.has(file),
      )
    : [];
  if (orphanFiles.length)
    issues.push(`Raw sample files absent from report: ${orphanFiles.join(', ')}`);
  const start = load(join(directory, 'host-start.json'), issues),
    end = load(join(directory, 'host-end.json'), issues);
  const host = qualifyPerformanceHost(start.data, end.data);
  const hostLinked =
    isDeepStrictEqual(start.data, report.hostConditions) &&
    isDeepStrictEqual(end.data, report.hostConditionsEnd);
  const network = load(join(directory, 'network-server.json'), issues);
  const manifest = normalizeManifest(report.server?.resourceManifest);
  const manifestValid =
    productionManifest.length > 0 &&
    isDeepStrictEqual(manifest, productionManifest) &&
    isDeepStrictEqual(network.data, report.server);
  const wasmSha256 = report.hashes?.['web/src/generated/c_viz_wasm_bg.wasm'];
  const wasmEntries = manifest.filter((entry) => entry.path.endsWith('.wasm'));
  const wasmValid =
    typeof wasmSha256 === 'string' &&
    wasmEntries.length === 1 &&
    wasmEntries[0].sha256 === wasmSha256;
  const contextReasons = [];
  if (!(report.browser === name || (name === 'firefox' && report.browser === 'stock-Firefox')))
    contextReasons.push('browser-identity');
  if (!host.satisfied || !hostLinked) contextReasons.push('host-conditions');
  if (!manifestValid || !wasmValid) contextReasons.push('product-build');
  if (report.hashes?.['scripts/performance-workloads.mjs'] !== workloadsSha256)
    contextReasons.push('workload-definition');
  const samples = rows.map((row) =>
    classifyExecution(row, linkedFile(directory, row, issues), contextReasons),
  );
  const reviews = reviewRows.map((row) =>
    classifyReview(row, linkedFile(directory, row, issues), samples, contextReasons),
  );
  const grids = {
    executions: grid(rows, expectedExecutions),
    reviews: grid(reviewRows, expectedReviews),
    cohorts: grid(cohorts, expectedCohorts),
  };
  const originalFilesLinked =
    [...samples, ...reviews, ...cohortFiles].every((entry) => entry.file.matchesReport) &&
    orphanFiles.length === 0;
  const matrixComplete =
    !!build.data &&
    !!start.data &&
    !!end.data &&
    !!network.data &&
    hostLinked &&
    isDeepStrictEqual(network.data, report.server) &&
    Object.values(grids).every((entry) => entry.complete) &&
    originalFilesLinked &&
    report.repeatsPerModuleState === 10 &&
    report.debugRun !== true &&
    isDeepStrictEqual(
      [...(report.selectedKeys ?? [])].sort(),
      definitions.map((entry) => entry.key).sort(),
    );
  const cohortFailures = cohorts
    .filter(
      (entry) =>
        entry.failure ||
        entry.cleanupFailure ||
        !(entry.contextClosed === true || entry.sessionClosed === true),
    )
    .map((entry) => entry.id);
  const evidenceQualified =
    source.data !== null &&
    report.task === '11.4' &&
    (report.browser === name || (name === 'firefox' && report.browser === 'stock-Firefox')) &&
    report.complete === true &&
    !report.failure &&
    !report.harnessFailures?.length &&
    !report.cleanupErrors?.length &&
    !cohortFailures.length &&
    host.satisfied &&
    hostLinked &&
    manifestValid &&
    wasmValid &&
    report.hashes?.['scripts/performance-workloads.mjs'] === workloadsSha256 &&
    isDeepStrictEqual(report.thresholds, {
      executionMs: 500,
      reviewMs: 2000,
      originalSafetyMs: 1000,
    });
  const categories = Object.fromEntries(
    ['within500', 'minor500To600', 'above600', 'invalid'].map((category) => [
      category,
      samples.filter((entry) => entry.category === category).length,
    ]),
  );
  return {
    browser: name,
    sharedHarnessHashes: Object.fromEntries(
      sharedHashKeys.map((key) => [key, report.hashes?.[key] ?? null]),
    ),
    source: { path: source.path, sha256: source.sha256 },
    sourceRunComplete: report.complete === true,
    matrixComplete,
    evidenceQualified,
    grids,
    originalFilesLinked,
    orphanFiles,
    cohortFailures,
    categories,
    cold600To800: samples.filter(
      (entry) => entry.mode === 'cold' && entry.category === 'above600' && entry.wholeMs <= 800,
    ).length,
    acceptedByToleranceCount: samples.filter((entry) => entry.acceptedByTolerance).length,
    reviewsPassed: reviews.filter((entry) => entry.passed).length,
    reviewsInvalid: reviews.filter((entry) => !entry.valid).length,
    observedWholeOver1000: samples.filter((entry) => entry.wholeMs > 1000).length,
    host: {
      qualified: host.satisfied,
      linked: hostLinked,
      start: { path: start.path, sha256: start.sha256 },
      end: { path: end.path, sha256: end.sha256 },
      qualification: host,
    },
    build: {
      manifestValid,
      manifestSha256: digest(manifest),
      wasmValid,
      wasmSha256,
      networkFile: { path: network.path, sha256: network.sha256 },
    },
    originalTargetPass:
      matrixComplete &&
      evidenceQualified &&
      categories.within500 === 1220 &&
      reviews.every((entry) => entry.passed),
    reference600Pass:
      matrixComplete &&
      evidenceQualified &&
      categories.above600 === 0 &&
      categories.invalid === 0 &&
      reviews.every((entry) => entry.passed),
    userTolerancePass:
      matrixComplete &&
      evidenceQualified &&
      samples.every((entry) => entry.acceptedByTolerance) &&
      reviews.every((entry) => entry.passed),
    issues,
    samples,
    reviews,
    cohortFiles,
  };
});
const sameBuild = browsers.every(
  (entry) =>
    entry.build.manifestSha256 === browsers[0].build.manifestSha256 &&
    entry.build.wasmSha256 === browsers[0].build.wasmSha256,
);
const sameHarness = browsers.every((entry) =>
  sharedHashKeys.every(
    (key) =>
      /^[0-9a-f]{64}$/.test(entry.sharedHarnessHashes[key] ?? '') &&
      entry.sharedHarnessHashes[key] === browsers[0].sharedHarnessHashes[key],
  ),
);
const result = {
  task: '11.4',
  auditorSha256: sha256(readFileSync(new URL(import.meta.url))),
  auditedAt: new Date().toISOString(),
  policy: {
    originalExecutionMs: 500,
    reference600Ms: 600,
    userToleranceByModuleStateMs: { cold: 800, warm: 600 },
    reviewMs: 2000,
    unchangedSafetyMs: 1000,
    meaning:
      'The original 500ms target and four 500/600ms categories remain unchanged. The single 600ms reference is reported separately. User tolerance accepts only valid complete cold-Module executions <=800ms or warm-Module executions <=600ms. Valid cold executions in (600,800]ms remain in above600 and are counted separately; tolerance acceptance does not claim the original 500ms target was met. Raw passed fields and all failed or missing evidence remain unchanged. Whole UI time above 1000ms does not redefine the engine safety clock.',
    matrixComplete:
      'Exact execution/review/cohort coverage and linked original files, independently of timing success or host qualification. A source run may still have a cleanup or other harness failure; that prevents every acceptance result.',
    boundary:
      'Reuses the original trusted-click/two-rAF endpoint and recorded production Rust controls. It does not rerun code, manufacture reviews, prove continuous physical presentation or exclude transient host changes between the two snapshots.',
  },
  expected: {
    browsers: 3,
    caseWorkloads: 55,
    exerciseWorkloads: 6,
    workloads: 61,
    executions: 3660,
    reviews: 90,
  },
  buildManifest: { path: build.path, sha256: build.sha256 },
  sameBuild,
  sameHarness,
  matrixComplete: browsers.every((entry) => entry.matrixComplete),
  originalTargetPass:
    !globalIssues.length &&
    sameBuild &&
    sameHarness &&
    browsers.every((entry) => entry.originalTargetPass),
  reference600Pass:
    !globalIssues.length &&
    sameBuild &&
    sameHarness &&
    browsers.every((entry) => entry.reference600Pass),
  userTolerancePass:
    !globalIssues.length &&
    sameBuild &&
    sameHarness &&
    browsers.every((entry) => entry.userTolerancePass),
  cold600To800: browsers.reduce((sum, entry) => sum + entry.cold600To800, 0),
  acceptedByToleranceCount: browsers.reduce(
    (sum, entry) => sum + entry.acceptedByToleranceCount,
    0,
  ),
  issues: globalIssues,
  browsers,
};
const totals = (category) => browsers.reduce((sum, entry) => sum + entry.categories[category], 0);
const summary = {
  matrixComplete: result.matrixComplete,
  originalTargetPass: result.originalTargetPass,
  reference600Pass: result.reference600Pass,
  userTolerancePass: result.userTolerancePass,
  cold600To800: result.cold600To800,
  acceptedByToleranceCount: result.acceptedByToleranceCount,
  executionsObserved: browsers.reduce((sum, entry) => sum + entry.samples.length, 0),
  reviewsObserved: browsers.reduce((sum, entry) => sum + entry.reviews.length, 0),
  categories: Object.fromEntries(
    ['within500', 'minor500To600', 'above600', 'invalid'].map((category) => [
      category,
      totals(category),
    ]),
  ),
};
if (!values['check-only']) {
  const output = join(workspaceDir, '.artifacts/11.4', values.label);
  mkdirSync(output); // EEXIST deliberately refuses to overwrite earlier evidence.
  writeFileSync(join(output, 'report.json'), JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
  });
  const lines = [
    '# 11.4 执行与真实复盘独立核验',
    '',
    `矩阵完整：${result.matrixComplete}；原500ms目标：${result.originalTargetPass}；单600ms参考：${result.reference600Pass}；冷800ms/暖600ms容差：${result.userTolerancePass}。`,
    '',
    '| 浏览器 | 执行数/1220 | ≤500ms | 500–600ms | >600ms | 无效 | 冷(600,800]ms | 容差内执行 | 复盘数/30 | 复盘通过 | 矩阵完整 | 条件合格 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ...browsers.map(
      (entry) =>
        `| ${entry.browser} | ${entry.samples.length} | ${entry.categories.within500} | ${entry.categories.minor500To600} | ${entry.categories.above600} | ${entry.categories.invalid} | ${entry.cold600To800} | ${entry.acceptedByToleranceCount} | ${entry.reviews.length} | ${entry.reviewsPassed} | ${entry.matrixComplete} | ${entry.evidenceQualified} |`,
    ),
    '',
    '仅真实完整且所有行为控制通过的执行可按冷Module≤800ms、暖Module≤600ms带备注接受。原500/600ms四类保持，冷(600,800]ms是>600ms中的有效冷态子集，单列数量不重复计入总样本。容差通过不代表达到原500ms目标。原始passed和失败证据保持原样；缺复盘、缺文件、错误结果、预算超限和无效测量不免责。复盘仍按2000ms核验，1000ms安全预算保持。',
    '',
    '完整缺项、重复、原文件路径与SHA256、主机双端条件、产品资产清单及逐样本分类见report.json。已有文件不被修改。',
    '',
    ...globalIssues.map((issue) => `- ${issue}`),
    ...browsers.flatMap((entry) => [
      `- ${entry.browser}原报告：${entry.source.path}（SHA256 ${entry.source.sha256 ?? '缺失'}）`,
      ...entry.issues.map((issue) => `- ${entry.browser}：${issue}`),
    ]),
    '',
  ];
  writeFileSync(join(output, 'report.md'), lines.join('\n'), { flag: 'wx' });
  summary.output = output;
}
console.log(JSON.stringify(summary, null, 2));
if (!result.userTolerancePass) process.exitCode = 1;
