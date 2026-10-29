// Snapshot existing successful Rust/WASM evidence; never build, test or replace a report.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWasm } from './wasm-inspect.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = '.artifacts/P0.5-09';
assert.ok(
  process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--performance'),
);
const performanceRepair = process.argv[2] === '--performance';
const suffix = performanceRepair ? '-performance' : '';
const expectedPassed = performanceRepair ? 453 : 452;
const expectedNewTests = performanceRepair ? 22 : 21;
const rustDestination = `${folder}/rust-evidence${suffix}.json`;
const wasmDestination = `${folder}/wasm-registration${suffix}.json`;
const destinations = [rustDestination, wasmDestination];
const inputs = new Map();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const portable = (path) => relative(root, resolve(root, path)).replaceAll('\\', '/');
const checkDestinations = () => {
  for (const path of destinations)
    assert.ok(!existsSync(resolve(root, path)), `Refusing to overwrite existing evidence: ${path}`);
};
checkDestinations();

function read(path) {
  const normalized = portable(path);
  assert.ok(!normalized.startsWith('../'), `Evidence input escapes the workspace: ${path}`);
  const bytes = readFileSync(resolve(root, normalized));
  const stat = statSync(resolve(root, normalized));
  const entry = {
    path: normalized,
    sha256: sha(bytes),
    bytes: bytes.length,
    modifiedAtUtc: stat.mtime.toISOString(),
  };
  if (inputs.has(normalized)) assert.deepEqual(entry, inputs.get(normalized));
  inputs.set(normalized, entry);
  return bytes;
}
const text = (path) =>
  read(path)
    .toString('utf8')
    .replace(/^\uFEFF/, '');
const json = (path) => JSON.parse(text(path));
const proof = (path) => {
  read(path);
  return { ...inputs.get(portable(path)) };
};
function walk(path) {
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), `Unexpected linked engine input: ${path}/${entry.name}`);
    if (entry.name === 'target') return [];
    const next = `${path}/${entry.name}`;
    return entry.isDirectory() ? walk(next) : entry.isFile() ? [next] : [];
  });
}

const summaryPath = `${folder}/${performanceRepair ? 'rust-performance-summary' : 'rust-finish-summary'}.json`;
const summary = json(summaryPath);
assert.equal(summary.task, 'P0.5-09');
assert.equal(summary.status, 'implemented-and-native-verified');
assert.equal(summary.writeOwnershipReturned, true);
assert.equal(
  summary.checks.fullRust.path,
  `${folder}/${performanceRepair ? 'rust-performance-full-first' : 'rust-finish-full-first'}.log`,
);
assert.equal(summary.checks.fullRust.exitCode, 0);
assert.equal(summary.checks.fullRust.passed, expectedPassed);
assert.equal(summary.checks.fullRust.ignored, 1);
assert.deepEqual(summary.checks.fullRust.includes, [
  'fmt --all --check',
  'native clippy workspace all-targets -D warnings',
  'wasm32 clippy workspace -D warnings',
  'test workspace locked',
]);
assert.deepEqual(
  summary.files.map((entry) => entry.path).sort(),
  [
    'engine/core/src/judge.rs',
    'engine/core/src/judge_p05.rs',
    'engine/core/src/exec.rs',
    'engine/core/src/input.rs',
    'engine/core/src/run.rs',
    'engine/core/tests/p05_course_acceptance.rs',
  ].sort(),
);
for (const entry of summary.files) {
  const actual = proof(entry.path);
  assert.equal(actual.sha256, entry.sha256, `Frozen Rust source drift: ${entry.path}`);
  assert.equal(actual.bytes, entry.bytes);
}
assert.deepEqual(summary.checks.newSuite, {
  correctionDrafts: 32,
  adversarialPrograms: 13,
  correctionGroups: 140,
  equivalentGroups: 40,
  adversarialGroups: 64,
  referenceExercises: 32,
  versionAndZeroInputNegativeCases: 8,
  lectureExpectedDiagnostics: 6,
  referenceGroups: 140,
  lectureFences: 46,
  tests: expectedNewTests,
  equivalentPrograms: 10,
});

const logPath = summary.checks.fullRust.path;
const log = text(logPath);
const logProof = proof(logPath);
const finishedAt = Date.parse(logProof.modifiedAtUtc);
assert.match(log, /> c-viz-learning@0\.1\.0 check:rust\r?\n> node scripts\/rust-check\.mjs/);
assert.doesNotMatch(log, /^error:|^error\[|^test result: FAILED|^error: test failed/m);
const lines = log.split(/\r?\n/);
const stages = [];
const targets = [];
let target = null;
for (let index = 0; index < lines.length; index++) {
  const line = lines[index];
  if (/Finished `dev` profile/.test(line)) stages.push({ kind: 'clippy', line: index + 1 });
  if (/Finished `test` profile/.test(line)) stages.push({ kind: 'test-build', line: index + 1 });
  if (/Running unittests/.test(line)) {
    const name = /deps[\\/](c_viz_(?:core|wasm))-/.exec(line);
    assert.ok(name, `Unexpected Rust unit target: ${line}`);
    target = name[1];
  }
  const integration = /Running tests[\\/]([^\s]+)\.rs /.exec(line);
  if (integration) target = integration[1];
  const docs = /Doc-tests (c_viz_(?:core|wasm))/.exec(line);
  if (docs) target = `doc:${docs[1]}`;
  const result =
    /^test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;/.exec(
      line,
    );
  if (result) {
    assert.ok(target, `Missing Rust target identity at line ${index + 1}`);
    targets.push({
      target,
      passed: Number(result[1]),
      failed: Number(result[2]),
      ignored: Number(result[3]),
      measured: Number(result[4]),
      filtered: Number(result[5]),
      line: index + 1,
    });
    target = null;
  }
}
assert.deepEqual(
  stages.map((entry) => entry.kind),
  ['clippy', 'clippy', 'test-build'],
);
const enginePaths = walk('engine')
  .filter((path) => path.endsWith('.rs') || /^Cargo\.(?:toml|lock)$/.test(basename(path)))
  .sort();
const expectedTargets = [
  'c_viz_core',
  'c_viz_wasm',
  'doc:c_viz_core',
  'doc:c_viz_wasm',
  ...enginePaths
    .filter((path) => /\/tests\/[^/]+\.rs$/.test(path))
    .map((path) => basename(path, '.rs')),
].sort();
assert.deepEqual(targets.map((entry) => entry.target).sort(), expectedTargets);
const totals = targets.reduce(
  (all, entry) => ({
    passed: all.passed + entry.passed,
    failed: all.failed + entry.failed,
    ignored: all.ignored + entry.ignored,
  }),
  { passed: 0, failed: 0, ignored: 0 },
);
assert.deepEqual(totals, { passed: expectedPassed, failed: 0, ignored: 1 });
assert.ok(targets.every((entry) => entry.measured === 0 && entry.filtered === 0));
assert.equal(
  targets.find((entry) => entry.target === 'p05_course_acceptance').passed,
  expectedNewTests,
);
assert.deepEqual(
  [...log.matchAll(/^test (\S+) \.\.\. ignored,/gm)].map((match) => match[1]),
  ['codec::append_tests::append_zero_native_microbenchmark'],
);
assert.ok(stages[2].line < targets[0].line);
assert.equal(targets.at(-1).target, 'doc:c_viz_wasm');

const checkScript = text('scripts/rust-check.mjs');
const calls = [...checkScript.matchAll(/run\('cargo',\s*(\[[\s\S]*?\])\);/g)].map((match) =>
  [...match[1].matchAll(/'([^']*)'/g)].map((token) => token[1]),
);
const commands = [
  ['+1.99.0', 'fmt', '--all', '--', '--check'],
  ['+1.99.0', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'],
  [
    '+1.99.0',
    'clippy',
    '--workspace',
    '--target',
    'wasm32-unknown-unknown',
    '--locked',
    '--',
    '-D',
    'warnings',
  ],
  ['+1.99.0', 'test', '--workspace', '--locked'],
];
assert.deepEqual(calls, commands);
assert.match(text('scripts/process.mjs'), /if \(result\.status !== 0\) throw new Error/);
assert.match(text('scripts/task.ps1'), /exit \$taskExitCode/);
assert.equal(json('package.json').scripts['check:rust'], 'node scripts/rust-check.mjs');
const checkInputs = [
  'scripts/rust-check.mjs',
  'scripts/process.mjs',
  'scripts/environment.mjs',
  'scripts/task.ps1',
  'package.json',
].map(proof);
const sourceFiles = [
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain.toml',
  '.cargo/config.toml',
  ...enginePaths,
]
  .sort()
  .map(proof);
const testInputPaths = new Set();
for (const path of enginePaths.filter((entry) => entry.endsWith('.rs'))) {
  const source = text(path);
  for (const match of source.matchAll(/include_(?:str|bytes)!\(\s*"([^"]+)"/g))
    testInputPaths.add(portable(resolve(root, dirname(path), match[1])));
  for (const match of source.matchAll(/read_to_string\(root\.join\("([^"]+)"\)/g))
    testInputPaths.add(match[1]);
}
const testInputs = [...testInputPaths].sort().map(proof);
for (const entry of [...sourceFiles, ...checkInputs, ...testInputs])
  assert.ok(
    Date.parse(entry.modifiedAtUtc) <= finishedAt,
    `Rust check predates its current input: ${entry.path}`,
  );

const course = json('content/c/p05/course-1.0.0.json');
const caseIdentity = (id, version, key) => `${id}@${version}/${key}`;
const expectedCases = course.exercises
  .flatMap((exercise) =>
    exercise.tests.map((test) => caseIdentity(exercise.id, exercise.version, test.caseKey)),
  )
  .sort();
assert.equal(course.exercises.length, 32);
assert.equal(expectedCases.length, 140);
const reference = json(summary.checks.referenceEvidence);
assert.equal(reference.task, 'P0.5-09');
assert.deepEqual(
  reference.records
    .map((entry) => caseIdentity(entry.exerciseRef.id, entry.exerciseRef.version, entry.caseKey))
    .sort(),
  expectedCases,
);
assert.ok(
  reference.records.every((entry) => entry.status === 'completed' && entry.judgeStatus === 'met'),
);
const correction = json(summary.checks.correctionEvidence);
assert.deepEqual(
  correction.map((entry) => `${entry.exerciseRef.id}@${entry.exerciseRef.version}`).sort(),
  course.exercises.map((entry) => `${entry.id}@${entry.version}`).sort(),
);
assert.equal(
  correction.reduce((count, entry) => count + entry.totalGroups, 0),
  140,
);
assert.ok(correction.every((entry) => entry.passedGroups < entry.totalGroups));
const lecture = json(summary.checks.lectureEvidence);
assert.equal(lecture.length, 46);
assert.equal(lecture.filter((entry) => entry.expectedDiagnostic !== null).length, 6);
assert.ok(
  lecture.every((entry) =>
    entry.expectedDiagnostic === null
      ? entry.status === 'completed' &&
        entry.actualStdout === entry.expectedStdout &&
        entry.diagnostics.length === 0
      : entry.status === 'program-error' &&
        entry.diagnostics.some((diagnostic) => diagnostic.code === entry.expectedDiagnostic),
  ),
);
const authoredEvidence = [
  summary.checks.referenceEvidence,
  summary.checks.correctionEvidence,
  summary.checks.lectureEvidence,
].map(proof);
if (performanceRepair) {
  const mapsPath = `${folder}/rust-full-map-budget-performance.json`;
  const maps = json(mapsPath);
  assert.equal(maps.producer, 'actual-rust-native');
  assert.equal(maps.records.length, 2);
  for (const record of maps.records) {
    assert.ok(record.blockMapCount > 60);
    assert.equal(record.caseKey, 'maximum');
    assert.equal(record.analysisStatus, 'valid');
    assert.equal(record.terminal, 'completed');
    assert.equal(record.judgeStatus, 'met');
    assert.ok(record.stats.fuelUsed <= 1_000_000);
  }
  authoredEvidence.push(proof(mapsPath));
}

const phaseNames = ['format', 'nativeClippy', 'wasmClippy', 'workspaceTests'];
const phaseCompletionLines = [stages[0].line, stages[0].line, stages[1].line, targets.at(-1).line];
const rust = {
  task: 'P0.5-09',
  status: 'passed',
  recordedAtUtc: new Date().toISOString(),
  ...totals,
  ignoredTest: 'codec::append_tests::append_zero_native_microbenchmark',
  summary: proof(summaryPath),
  sourceFiles,
  testInputs,
  checkInputs,
  checks: [
    {
      ...logProof,
      command: 'pwsh -NoProfile -File scripts/task.ps1 check:rust',
      exitCode: summary.checks.fullRust.exitCode,
      exitCodeSource: `${summaryPath}#/checks/fullRust/exitCode`,
      phases: phaseNames.map((name, index) => ({
        name,
        command: ['cargo', ...commands[index]],
        exitCode: 0,
        completionLine: phaseCompletionLines[index],
        evidenceBasis:
          'Inferred from the recorded overall exit 0 and the hashed sequential fail-fast runner; the original combined log has no per-phase exit-code markers. Format is silent on success; the following native-clippy completion also proves it returned.',
      })),
      testTargets: targets,
    },
  ],
  newSuite: summary.checks.newSuite,
  authoredEvidence,
  latestRustInputAtUtc: new Date(
    Math.max(
      ...[...sourceFiles, ...checkInputs, ...testInputs].map((entry) =>
        Date.parse(entry.modifiedAtUtc),
      ),
    ),
  ).toISOString(),
  limitations: [
    'Snapshots existing verification only; no Rust command was rerun to create this report.',
    'Native deterministic clocks do not prove browser deadlines or full AST-map execution budgets.',
    'All correction drafts and adversarial programs fail the complete submission; some individual boundary groups may pass.',
  ],
};

const buildPath = '.artifacts/wasm-build.json';
const build = json(buildPath);
assert.equal(build.evidenceLevel, 'engineering-build');
assert.equal(build.interpreterReady, true);
assert.equal(build.executionProtocol, 'EXEC-01 1.0.0');
assert.deepEqual(build.supportedExecutionProtocols, ['EXEC-01 1.0.0', 'EXEC-01 1.1.0']);
assert.deepEqual(build.supportedVersionVectors, [
  '1.0.0/1.0.0/1.0.0/1.0.0/1.0.0',
  '1.1.0/1.0.0/1.0.0/1.1.0/1.0.0',
]);
assert.deepEqual(
  Object.keys(build.hashes).sort(),
  [
    'package-lock.json',
    'Cargo.lock',
    'web/src/generated/c_viz_wasm.js',
    'web/src/generated/c_viz_wasm_bg.wasm',
  ].sort(),
);
for (const [path, hash] of Object.entries(build.hashes))
  assert.equal(proof(path).sha256, hash, `WASM build input/output drift: ${path}`);
const binaryPath = 'web/src/generated/c_viz_wasm_bg.wasm';
const binary = read(binaryPath);
assert.equal(binary.length, build.bytes);
const inspection = inspectWasm(binary);
for (const key of ['memories', 'features', 'imports', 'exports'])
  assert.deepEqual(inspection[key], build[key], `WASM report/actual ${key} mismatch`);
assert.deepEqual(
  inspection.memories.map(({ maximum, shared }) => ({ maximum, shared })),
  [{ maximum: 2048, shared: false }],
);
assert.ok(
  inspection.imports.every((entry) => !/wasi|thread|socket|proc_/i.test(entry.module + entry.name)),
);
for (const name of ['prepare_input', 'analyze_code_draft', 'execute_request'])
  assert.ok(inspection.exports.some((entry) => entry.name === name && entry.kind === 'function'));
const enginePath = 'web/src/generated/engine-build.ts';
const engineMatch = /export const engineBuild = (\{[^\n]+\}) as const;/.exec(text(enginePath));
assert.ok(engineMatch, 'Expected the generated engineBuild shape.');
const engine = JSON.parse(engineMatch[1]);
assert.equal(engine.engineVersion, '0.1.0');
assert.equal(engine.wasmSha256, sha(binary));
assert.equal(engine.wasmBytes, binary.length);
const buildProof = proof(buildPath);
for (const entry of [...sourceFiles, proof(enginePath), ...Object.keys(build.hashes).map(proof)])
  assert.ok(
    Date.parse(entry.modifiedAtUtc) <= Date.parse(buildProof.modifiedAtUtc),
    `WASM build predates input/output: ${entry.path}`,
  );
const buildLogPath = `${folder}/${performanceRepair ? 'wasm-performance-final' : 'build-candidate-fourth'}.log`;
const buildLog = text(buildLogPath);
assert.match(buildLog, /Finished `release` profile/);
assert.ok(
  buildLog.includes(
    `WASM ${binary.length} bytes; maximum 2048 pages; build report .artifacts/wasm-build.json`,
  ),
);
if (!performanceRepair)
  assert.ok(buildLog.includes('Production and internal harness hashes recorded.'));
assert.ok(Date.parse(proof(buildLogPath).modifiedAtUtc) >= Date.parse(buildProof.modifiedAtUtc));
const rustBytes = Buffer.from(`${JSON.stringify(rust, null, 2)}\n`);
const wasm = {
  ...build,
  hashes: { ...build.hashes, [enginePath]: proof(enginePath).sha256 },
  registrationSnapshot: {
    task: 'P0.5-09',
    recordedAtUtc: new Date().toISOString(),
    sourceBuildReport: buildProof,
    buildLog: proof(buildLogPath),
    engineMetadata: { ...proof(enginePath), value: engine },
    rustEvidence: { path: rustDestination, sha256: sha(rustBytes) },
    sourceFiles,
    note: 'Preserves the existing engineering-build report and verifies its actual binary, imports, exports, memory, vectors and generated engine metadata. Browser acceptance remains a separate gate.',
  },
};

// Recheck every read input before either exclusive write; never relabel drift as old proof.
for (const entry of inputs.values()) {
  const stat = statSync(resolve(root, entry.path));
  assert.equal(
    stat.mtime.toISOString(),
    entry.modifiedAtUtc,
    `Input changed while preparing evidence: ${entry.path}`,
  );
  assert.equal(
    sha(readFileSync(resolve(root, entry.path))),
    entry.sha256,
    `Input changed while preparing evidence: ${entry.path}`,
  );
}
checkDestinations();
writeFileSync(resolve(root, rustDestination), rustBytes, { flag: 'wx' });
writeFileSync(resolve(root, wasmDestination), `${JSON.stringify(wasm, null, 2)}\n`, { flag: 'wx' });
console.log(
  `P0.5-09 engineering evidence: ${sourceFiles.length} Rust/config files, ${expectedPassed} passed, 0 failed, 1 existing ignore; WASM ${engine.wasmBytes} bytes ${engine.wasmSha256}.`,
);
