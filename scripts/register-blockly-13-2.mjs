// Append 13.2 only after the final Rust, browser and complete frontend evidence.
// This script never rewrites an earlier registration or runs a test/build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(resolve(root, path));
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const priorVersion = process.env.BLOCKLY_PRIOR_VERSION ?? '1.0.10';
const nextVersion = process.env.BLOCKLY_NEXT_VERSION ?? '1.0.11';
assert.ok(
  (priorVersion === '1.0.10' && nextVersion === '1.0.11') ||
    (priorVersion === '1.0.11' && nextVersion === '1.0.12'),
  '13.2 registers its original candidate or its audited locator successor.',
);
const priorPath = `content/c/p0/blockly-release-${priorVersion}.json`;
const priorBytes = read(priorPath);
const prior = JSON.parse(priorBytes);
assert.equal(prior.releaseVersion, priorVersion);
assert.equal(prior.library, 'blockly');
assert.equal(prior.libraryVersion, '13.4.0');
assert.equal(prior.acceptanceGate, '10.3-real-blockly-rust-playback');
assert.equal(prior.files.length, priorVersion === '1.0.10' ? 20 : 29);
assert.equal(new Set(prior.files.map((entry) => entry.path)).size, prior.files.length);
assert.equal(prior.blockTypes.length, 20);
assert.equal(new Set(prior.blockTypes).size, 20);

const reviewedPaths = [
  ...new Set([
    ...prior.files.map((entry) => entry.path),
    'web/src/blocks/analysis-types.ts',
    'web/src/blocks/reverse.ts',
    'web/src/blocks/source-patch.ts',
    'web/src/engine/analysis-client.ts',
    'web/src/engine/analysis-protocol.ts',
    'web/src/engine/analysis.worker.ts',
    'web/src/practice/edit-document.ts',
    'web/src/components/DraftCodeEditor.tsx',
    'web/src/components/draft-code-editor.css',
  ]),
];
assert.equal(reviewedPaths.length, 29);
assert.equal(new Set(reviewedPaths).size, 29);

const rustPath = process.env.BLOCKLY_RUST_REPORT ?? '.artifacts/13.2/rust-evidence.json';
const rustBytes = read(rustPath);
const rust = JSON.parse(rustBytes.toString('utf8').replace(/^\uFEFF/, ''));
assert.equal(rust.task, '13.2');
assert.deepEqual(
  rust.sourceFiles.map((entry) => entry.path).sort(),
  [
    'engine/core/src/edit_analysis.rs',
    'engine/core/tests/edit_analysis_acceptance.rs',
    'engine/core/src/lib.rs',
    'engine/wasm/src/lib.rs',
  ].sort(),
);
for (const entry of rust.sourceFiles)
  assert.equal(sha(read(entry.path)), entry.sha256, `Rust source drift: ${entry.path}`);
for (const key of ['targetedExpanded', 'format', 'hostClippy', 'wasmClippy', 'workspace']) {
  assert.equal(rust.verification[key].exitCode, 0, `Rust check did not pass: ${key}`);
  const logBytes = read(rust.verification[key].log);
  if (key !== 'format') assert.ok(logBytes.length > 0, `Missing Rust log: ${key}`);
}
assert.ok(rust.verification.targetedExpanded.passed >= 17);
assert.equal(rust.verification.workspace.failed, 0);
assert.ok(rust.verification.workspace.passed >= 431);
assert.equal(
  rust.verification.workspace.ignored,
  1,
  'Only the existing ignored Rust test remains.',
);

const wasmPath = process.env.BLOCKLY_WASM_REPORT ?? '.artifacts/wasm-build.json';
const wasmBytes = read(wasmPath);
const wasm = JSON.parse(wasmBytes);
assert.equal(wasm.evidenceLevel, 'engineering-build');
assert.equal(wasm.interpreterReady, true);
assert.equal(wasm.executionProtocol, 'EXEC-01 1.0.0');
assert.equal(wasm.memories.length, 1);
assert.equal(wasm.memories[0].maximum, 2048);
assert.equal(wasm.memories[0].shared, false);
assert.ok(
  wasm.exports.some((entry) => entry.name === 'analyze_code_draft' && entry.kind === 'function'),
);
for (const [path, expected] of Object.entries(wasm.hashes))
  assert.equal(sha(read(path)), expected, `WASM build input/output drift: ${path}`);
const binaryPath = 'web/src/generated/c_viz_wasm_bg.wasm';
const binary = read(binaryPath);
assert.equal(binary.length, wasm.bytes);
assert.ok(
  WebAssembly.Module.exports(new WebAssembly.Module(binary)).some(
    (entry) => entry.name === 'analyze_code_draft' && entry.kind === 'function',
  ),
  'The actual WASM binary must expose the analysis producer.',
);
const engineSource = read('web/src/generated/engine-build.ts').toString('utf8');
const engineMatch = /export const engineBuild = (\{[^\n]+\}) as const;/.exec(engineSource);
assert.ok(engineMatch, 'Expected the existing generated engineBuild shape.');
const engine = JSON.parse(engineMatch[1]);
assert.equal(engine.wasmSha256, sha(binary));
assert.equal(engine.wasmBytes, binary.length);

const reviewedInputs = [
  ...reviewedPaths,
  ...rust.sourceFiles.map((entry) => entry.path),
  binaryPath,
  'web/src/generated/c_viz_wasm.js',
  'web/src/generated/engine-build.ts',
];
const latestSourceChange = Math.max(
  ...reviewedInputs.map((path) => statSync(resolve(root, path)).mtimeMs),
);
const projects = ['chrome', 'edge', 'firefox-automation'];
const evidence = {};

function reportCases(suites, ancestry = []) {
  return suites.flatMap((suite) => {
    const titles = suite.title.endsWith('.spec.ts') ? ancestry : [...ancestry, suite.title];
    return [
      ...(suite.specs ?? []).flatMap((spec) =>
        spec.tests.map((test) => ({
          spec,
          test,
          title: [basename(spec.file.replaceAll('\\', '/')), ...titles, spec.title].join(' › '),
        })),
      ),
      ...reportCases(suite.suites ?? [], titles),
    ];
  });
}
function browserGate(key, path, expected, allowedFiles, filter) {
  const bytes = read(path);
  const report = JSON.parse(bytes);
  assert.deepEqual(report.errors ?? [], [], `Unexpected global browser error in ${key}`);
  for (const counter of ['unexpected', 'skipped', 'flaky'])
    assert.equal(report.stats[counter], 0, `${key}: ${counter} must be zero.`);
  assert.deepEqual(report.config.projects.map((entry) => entry.name).sort(), projects);
  assert.ok(report.config.projects.every((entry) => entry.retries === 0));
  assert.ok(
    Date.parse(report.stats.startTime) >= latestSourceChange,
    `${key}: repeat this gate after the latest reviewed frontend/Rust/WASM source change.`,
  );
  const records = reportCases(report.suites);
  assert.ok(records.length > 0, `${key}: empty browser report.`);
  assert.equal(records.length, report.stats.expected);
  if (expected !== null) assert.equal(records.length, expected);
  const titleSets = new Map(projects.map((name) => [name, new Set()]));
  for (const { spec, test, title } of records) {
    assert.ok(allowedFiles.includes(basename(spec.file.replaceAll('\\', '/'))));
    if (filter) assert.ok(filter(spec), `${key}: unexpected selected scenario.`);
    assert.equal(spec.ok, true);
    assert.equal(test.expectedStatus, 'passed');
    assert.equal(test.status, 'expected');
    assert.equal(test.results.length, 1, `${key}: no retries or repeated runs may hide a failure.`);
    assert.equal(test.results[0].status, 'passed');
    assert.equal(test.results[0].retry, 0);
    assert.deepEqual(test.results[0].errors ?? [], []);
    const project = test.projectName ?? test.projectId;
    assert.ok(titleSets.has(project), `${key}: unknown project ${project}`);
    assert.ok(!titleSets.get(project).has(title), `${key}: duplicate project/title ${title}`);
    titleSets.get(project).add(title);
  }
  const firstTitles = [...titleSets.get(projects[0])].sort();
  for (const project of projects)
    assert.deepEqual(
      [...titleSets.get(project)].sort(),
      firstTitles,
      `${key}: browser scenario sets differ.`,
    );
  evidence[key] = {
    path,
    sha256: sha(bytes),
    passed: records.length,
    retries: 0,
    titlesPerProject: firstTitles,
  };
  return { report, titles: firstTitles };
}

browserGate('browser', process.env.BLOCKLY_GATE_REPORT ?? '.artifacts/13.2/gate-blocks.json', 45, [
  'blocks.spec.ts',
  'practice.spec.ts',
]);
browserGate(
  'navigation',
  process.env.BLOCKLY_NAV_REPORT ?? '.artifacts/13.2/gate-navigation.json',
  3,
  ['navigation.spec.ts'],
  (spec) => spec.title.includes('workspaces keep real blocks'),
);
browserGate(
  'interaction',
  process.env.BLOCKLY_INTERACTION_REPORT ?? '.artifacts/13.2/gate-interaction.json',
  15,
  ['block-interaction.spec.ts'],
);
browserGate(
  'practiceExperience',
  process.env.BLOCKLY_PRACTICE_REPORT ?? '.artifacts/13.2/gate-experience.json',
  15,
  ['practice-experience.spec.ts'],
);
const bidirectional = browserGate(
  'bidirectional',
  process.env.BLOCKLY_BIDIRECTIONAL_REPORT ?? '.artifacts/13.2/bidirectional-final.json',
  null,
  ['bidirectional.spec.ts'],
);

// Use the installed TypeScript parser to enumerate the real source declarations.
// The one data-driven registration loop expands the six published exercise IDs.
// Unknown dynamic titles fail closed instead of accepting a smaller fixed count.
function declaredBidirectionalTitles() {
  const path = 'tests/browser/bidirectional.spec.ts';
  const source = ts.createSourceFile(
    path,
    read(path).toString('utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.deepEqual(
    source.parseDiagnostics,
    [],
    'The bidirectional test source must parse cleanly.',
  );
  const content = json('web/public/content/practice/course-practice-1.0.0.json');
  const titles = [];
  function text(node, values) {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isTemplateExpression(node))
      return (
        node.head.text +
        node.templateSpans
          .map((span) => {
            assert.ok(
              ts.isPropertyAccessExpression(span.expression) &&
                ts.isIdentifier(span.expression.expression),
              'Unsupported dynamic test title.',
            );
            const object = values[span.expression.expression.text];
            const value = object?.[span.expression.name.text];
            assert.equal(
              typeof value,
              'string',
              'Dynamic scenario title must resolve to a published exercise field.',
            );
            return value + span.literal.text;
          })
          .join('')
      );
    assert.fail('Scenario names must be explicit strings or the published exercise template.');
  }
  function visit(node, values = {}, parents = []) {
    if (ts.isForOfStatement(node) && node.expression.getText(source) === 'content.exercises') {
      assert.ok(ts.isVariableDeclarationList(node.initializer));
      const name = node.initializer.declarations[0].name;
      assert.ok(ts.isIdentifier(name));
      for (const exercise of content.exercises)
        visit(node.statement, { ...values, [name.text]: exercise }, parents);
      return;
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === 'test') {
        titles.push(
          ['bidirectional.spec.ts', ...parents, text(node.arguments[0], values)].join(' › '),
        );
        return;
      }
      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'test'
      ) {
        assert.ok(
          !['only', 'skip', 'fixme'].includes(expression.name.text),
          'The release suite may not exclude scenarios.',
        );
        if (expression.name.text === 'describe') {
          const callback = node.arguments[1];
          assert.ok(
            callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)),
          );
          visit(callback.body, values, [...parents, text(node.arguments[0], values)]);
          return;
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, values, parents));
  }
  visit(source);
  assert.ok(titles.length > 0);
  assert.equal(new Set(titles).size, titles.length);
  return titles.sort();
}
assert.deepEqual(
  bidirectional.titles,
  declaredBidirectionalTitles(),
  'The final three-browser suite must include every declared bidirectional scenario.',
);
assert.ok(
  Date.parse(bidirectional.report.stats.startTime) >=
    statSync(resolve(root, 'tests/browser/bidirectional.spec.ts')).mtimeMs,
  'Repeat the bidirectional gate after its final test-source edit.',
);

const unitPath = process.env.BLOCKLY_UNIT_REPORT ?? '.artifacts/13.2/unit-final.json';
const unitBytes = read(unitPath);
const unit = JSON.parse(unitBytes);
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.equal(unit.numTodoTests ?? 0, 0);
assert.equal(unit.numPassedTests, unit.numTotalTests);
assert.ok(
  unit.startTime >= latestSourceChange,
  'Repeat the complete frontend suite after the final reviewed source edit.',
);
function unitFiles(path) {
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap((entry) => {
    const next = `${path}/${entry.name}`;
    return entry.isDirectory()
      ? unitFiles(next)
      : entry.isFile() && entry.name.endsWith('.test.ts')
        ? [next]
        : [];
  });
}
assert.deepEqual(
  unit.testResults.map((entry) => resolve(entry.name)).sort(),
  unitFiles('tests/unit')
    .map((path) => resolve(root, path))
    .sort(),
  'A selected subset cannot substitute for the complete frontend suite.',
);
for (const suite of unit.testResults) {
  assert.equal(suite.status, 'passed');
  assert.ok(suite.assertionResults.every((result) => result.status === 'passed'));
}
for (const name of [
  'block-generator.test.ts',
  'block-workspace.test.ts',
  'reverse-mapping.test.ts',
  'edit-analysis.test.ts',
])
  assert.ok(
    unit.testResults.some((entry) => basename(entry.name) === name && entry.status === 'passed'),
  );
evidence.frontend = { path: unitPath, sha256: sha(unitBytes), passed: unit.numPassedTests };
evidence.generator = { ...evidence.frontend, includedSuite: 'block-generator.test.ts' };
evidence.workspace = { ...evidence.frontend, includedSuite: 'block-workspace.test.ts' };
evidence.rustAnalysis = {
  path: rustPath,
  sha256: sha(rustBytes),
  passed: rust.verification.targetedExpanded.passed,
  workspacePassed: rust.verification.workspace.passed,
};
evidence.wasm = {
  path: wasmPath,
  sha256: sha(wasmBytes),
  buildId: engine.wasmSha256,
  bytes: binary.length,
  analysisExport: 'analyze_code_draft',
};

const registration = {
  ...prior,
  releaseVersion: nextVersion,
  reviewedAtUtc: new Date().toISOString(),
  files: reviewedPaths.map((path) => ({ path, sha256: sha(read(path)) })),
  evidence,
  reason:
    '13.2 adds the bounded Rust AST-MAP-01 1.0.0 analysis producer and exact browser consumer, source-to-block projection for the existing twenty visible block kinds, source/selection location, controlled-input identity, stale-analysis and execution invalidation, and source-preserving block edits with trusted synthetic-return provenance. The explicit code editing entry starts one ephemeral EDIT-SYNC-01 document; invalid or unmapped drafts remain visible and cannot execute an earlier program. The original six exercises and twenty-four genuine tests, full-submission authority, saved-history/reward idempotency, current C subset, EXEC/STEP/JUDGE/CONTENT/SAVE contracts and 1000ms execution budget remain. The 29 reviewed files extend the prior 20 with analysis, projection, patching, document and editor sources. Final-source 45+3+15+15 browser gates, every declared bidirectional scenario in all three browsers, complete frontend checks, current Rust evidence and the new exact WASM build passed. P0.5-08 preferences, curriculum expansion, unlocks and persistent edit history are not included.',
  priorRegistration: { path: priorPath, sha256: sha(priorBytes) },
};
writeFileSync(
  resolve(root, `content/c/p0/blockly-release-${nextVersion}.json`),
  `${JSON.stringify(registration, null, 2)}\n`,
  { flag: 'wx' },
);
console.log(
  `Blockly ${nextVersion} registered: 29 sources, original45+3+15+15 gates, ${evidence.bidirectional.passed} bidirectional browser cases and ${evidence.frontend.passed} frontend tests.`,
);
