/** Offline 08.4 capture verification. Reads public test artifacts; never executes C. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { CaseSetSample } from '../tests/fixtures/case-set';
import type {
  CaseEntity,
  ContentPackage,
  InputSpecEntity,
  ProgramEntity,
} from '../web/src/content/types';
import type {
  ExecuteRequest,
  ExecuteResult,
  ExecutionLocation,
  TraceObject,
} from '../web/src/engine/protocol';

// This fixture contains only project-authored public inputs and known outputs.
// Node's pinned TS stripper loads it without introducing a product execution path.
const { caseSetIds, caseSetSamples } = (await import(
  new URL('../tests/fixtures/case-set.ts', import.meta.url).href
)) as typeof import('../tests/fixtures/case-set');

export interface CaseCatalog {
  packageRef: ExecuteRequest['packageRef'];
  subject: CaseEntity;
  program: ProgramEntity;
  inputSpec: InputSpecEntity;
}
/** Producer of the immutable 08.4 representative archive; never a live-engine fallback. */
export const CASE_ARCHIVE_BUILD_ID =
  'd0614714ac5673bfbd7c8b512dd35b39661da9b40993aefdd13e6a2f0b8d04ae';
interface Walk {
  forwardCursors: number[];
  reverseCursors: number[];
  finalArrayObserved: number[] | null;
  allStatesChecked: boolean;
  sourceRangesChecked: boolean;
}
interface Rate {
  rate: number;
  periodMs: number;
  cursors: number[];
  endCursor: number;
  endStatus: string;
  stdout: string;
  allStatesChecked: boolean;
}
export interface CaseUi {
  captureVersion: string;
  evidenceLevel: string;
  key: string;
  caseId: string;
  project: string;
  browserVersion: string;
  route: string;
  readOnly: boolean;
  sourceKind: string;
  displayedSource: string;
  values: ExecuteRequest['input']['values'];
  stdout: string;
  terminal: string;
  steps: number;
  identity: ExecuteRequest['identity'];
  initialCursor: number;
  initialView: {
    cursor: number;
    viewCursor: number;
    status: string;
    kind: string;
    output: string;
    scalars: unknown[];
    arrays: unknown[];
    counters: Record<string, string>;
    marks: unknown[];
    terminalMarkCount: number;
  };
  walk: Walk | null;
  rates: Rate[];
  replay: { cycles: number; initialRestored: boolean; noNewExecution: boolean } | null;
  storage: {
    storeNames: string[];
    beforeSha256: string;
    afterSha256: string;
    unchanged: boolean;
    scope: string;
  };
  worker: {
    kind: string;
    moduleSeen: boolean;
    responseOk: boolean;
    terminated: boolean;
    operationId: string;
    responseOperationId: string;
    url: string;
  };
  requestByteLength: number;
  resultByteLength: number;
  requestSha256: string;
  resultSha256: string;
  catalogSha256: string;
  sourceSha256: string;
}
export interface CasePacket {
  requestBytes: Uint8Array;
  resultBytes: Uint8Array;
  catalogText: string;
  displayedSource: string;
  ui: CaseUi;
}
const workspace = fileURLToPath(new URL('../', import.meta.url));
const modules = [
  'protocol',
  'trace-validation',
  'execution-json',
  'execution-schema.generated',
  'execution-p05-schema.generated',
];
type Protocol = typeof import('../web/src/engine/protocol');
let protocolPromise: Promise<Protocol> | undefined;
function protocol(): Promise<Protocol> {
  if (!protocolPromise)
    protocolPromise = (async () => {
      assert.equal(ts.version, '6.0.3');
      const sources = modules.map((name) => ({
        name,
        text: readFileSync(join(workspace, 'web/src/engine', `${name}.ts`), 'utf8'),
      }));
      const compilerOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext };
      // Every runtime dependency and compiler option belongs to the cache key;
      // the added 1.1 dependency must never modify a historical cache directory.
      const digest = sha256(
        ts.version +
          JSON.stringify(compilerOptions) +
          sources.map((item) => item.name + '\0' + item.text).join('\0'),
      );
      const directory = join(workspace, '.artifacts/08.4/verification-runtime', digest);
      mkdirSync(directory, { recursive: true });
      for (const item of sources) {
        let source = ts.transpileModule(item.text, {
          compilerOptions,
          fileName: `${item.name}.ts`,
        }).outputText;
        for (const name of modules)
          source = source
            .replaceAll(`'./${name}'`, `'./${name}.mjs'`)
            .replaceAll(`"./${name}"`, `"./${name}.mjs"`);
        const target = join(directory, `${item.name}.mjs`);
        if (!existsSync(target) || readFileSync(target, 'utf8') !== source)
          writeFileSync(target, source);
      }
      return (await import(pathToFileURL(join(directory, 'protocol.mjs')).href)) as Protocol;
    })();
  return protocolPromise;
}
export const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export function readCasePacket(directory: string): CasePacket {
  return {
    requestBytes: Uint8Array.from(readFileSync(join(directory, 'request.json'))),
    resultBytes: Uint8Array.from(readFileSync(join(directory, 'result.json'))),
    catalogText: readFileSync(join(directory, 'catalog.json'), 'utf8'),
    displayedSource: readFileSync(join(directory, 'source.c'), 'utf8'),
    ui: JSON.parse(readFileSync(join(directory, 'ui.json'), 'utf8')) as CaseUi,
  };
}
const sourceSlice = (source: string, range: { start: number; end: number }) =>
  Buffer.from(source, 'utf8').subarray(range.start, range.end).toString('utf8');
function locationText(source: string, result: ExecuteResult, location: ExecutionLocation) {
  assert.equal(location.kind, 'source');
  if (location.kind !== 'source') throw new Error('A real source location is required.');
  const range =
    location.byteRange ?? result.nodeMap.find((node) => node.nodeId === location.nodeId)?.byteRange;
  assert.ok(range);
  return sourceSlice(source, range);
}
const cells = (object: TraceObject) =>
  Array.from(
    { length: object.length },
    (_, index) => object.cells.find((cell) => cell.index === index)?.value ?? object.defaultValue,
  );

/** Only prepares the expected declaration text of the seven fixed public templates. */
export function expectedCaseSource(
  program: ProgramEntity,
  values: ExecuteRequest['input']['values'],
) {
  let source = program.sourceExample;
  for (const binding of program.bindings) {
    assert.match(binding.targetName, /^[A-Za-z_][A-Za-z0-9_]*$/u);
    const input = values[binding.inputKey];
    const expression =
      binding.targetKind === 'array'
        ? `[${Math.max(1, (input as readonly number[]).length)}] = {${(input as readonly number[]).length ? (input as readonly number[]).join(', ') : '0'}}`
        : ` = ${binding.targetKind === 'logical-length' ? (input as readonly number[]).length : input}`;
    const pattern = new RegExp(`\\bint ${binding.targetName}(?:\\[[^\\]]+\\])? = [^;]+;`, 'gu');
    assert.equal([...source.matchAll(pattern)].length, 1, 'One frozen public input declaration.');
    source = source.replace(pattern, `int ${binding.targetName}${expression};`);
  }
  return source;
}

/** Fixed input/output and trace facts; caller must first run the complete production decoder. */
export function verifyCaseExecution(
  request: ExecuteRequest,
  result: ExecuteResult,
  catalog: CaseCatalog,
  sample: CaseSetSample,
  expectedBuildId = sha256(readFileSync(join(workspace, 'web/src/generated/c_viz_wasm_bg.wasm'))),
) {
  const baseline = JSON.parse(
    readFileSync(join(workspace, 'shared/contracts/02.1-内容样例.json'), 'utf8'),
  ) as ContentPackage;
  const subject = baseline.cases.find((item) => item.id === sample.caseId)!;
  assert.ok(subject);
  const program = baseline.programs.find((item) => item.id === subject.programRef.id)!;
  const inputSpec = baseline.inputSpecs.find((item) => item.id === program.inputRef.id)!;
  assert.deepEqual(catalog, {
    packageRef: { id: baseline.packageId, version: baseline.packageVersion },
    subject,
    program,
    inputSpec,
  });
  assert.equal(request.mode, 'case');
  assert.equal(request.judge, null);
  assert.equal(result.judgeResult, null);
  assert.equal(request.input.random, null);
  assert.deepEqual(request.input.values, sample.values);
  assert.deepEqual(request.packageRef, catalog.packageRef);
  assert.deepEqual(request.programRef, subject.programRef);
  assert.deepEqual(request.subjectRef, { id: subject.id, version: subject.version });
  assert.deepEqual(request.input.specRef, program.inputRef);
  assert.deepEqual(request.languageRef, program.languageRef);
  assert.deepEqual(request.subsetRef, program.subsetRef);
  assert.equal(request.learningRevision, subject.learningRevision);
  assert.deepEqual(request.budgetRef, { id: 'budget.p0', version: '1.0.0' });
  assert.equal(request.engineRef.id, 'engine.c.p0');
  assert.ok(request.remainingMs > 0 && request.remainingMs <= 1000);
  assert.match(request.engineRef.buildId, /^[a-f0-9]{64}$/u);
  assert.equal(request.engineRef.buildId, expectedBuildId);
  assert.equal(request.source.text, expectedCaseSource(program, sample.values));
  assert.deepEqual(request.source.blockMap, []);
  assert.deepEqual(
    request.source.bindingMap.map((item) => item.bindingKey),
    program.bindings.map((item) => item.bindingKey),
  );
  for (const mapping of request.source.bindingMap) {
    const resolved = result.resolvedBindings.find(
      (item) => item.bindingKey === mapping.bindingKey,
    )!;
    assert.ok(resolved);
    const node = result.nodeMap.find((item) => item.nodeId === resolved.declarationNodeId)!;
    assert.equal(node.kind, 'declaration');
    assert.deepEqual(mapping.byteRange, node.byteRange);
  }
  assert.equal(result.producer, 'rust');
  assert.equal(result.terminal.status, 'completed');
  assert.equal(result.terminal.exitCode, 0);
  assert.deepEqual(result.terminal.diagnostics, []);
  assert.ok(result.trace && result.stats);
  assert.equal(result.trace.completeness, 'complete');
  assert.ok(result.trace.steps.length > 1 && result.trace.steps.length <= 20_000);
  const names = new Map<string, string>();
  const initial: Record<string, (number | null)[]> = {};
  const writes: {
    seq: number;
    name: string;
    index: number;
    before: number | null;
    after: number | null;
    source: string;
  }[] = [];
  const comparisons: { seq: number; source: string; operands: number[]; value: number }[] = [];
  const swaps: { seq: number; indices: number[]; beforeValues: number[] }[] = [];
  let stdout = '';
  let finalArray: (number | null)[] | null = null;
  for (const step of result.trace.steps) {
    for (const change of step.changes) {
      if (change.op === 'record' && change.table === 'objects') {
        const object = (change.after ?? change.before) as TraceObject;
        names.set(object.id, object.name);
        if (step.kind === 'value.initialize') initial[object.name] = cells(object);
        if (change.after === null && object.name === 'values') finalArray = cells(object);
      } else if (change.op === 'cell') {
        const name = names.get(change.objectId)!;
        assert.ok(name);
        if (step.kind === 'value.initialize') initial[name] = [change.after];
        else
          writes.push({
            seq: step.seq,
            name,
            index: change.index,
            before: change.before,
            after: change.after,
            source: locationText(request.source.text, result, step.location),
          });
      } else if (change.op === 'output') stdout += change.append;
    }
    for (const observation of step.observations) {
      if (
        observation.kind === 'evaluate' &&
        ['<', '<=', '>', '>=', '==', '!='].includes(observation.operator)
      ) {
        const node = result.nodeMap.find((item) => item.nodeId === observation.nodeId)!;
        comparisons.push({
          seq: step.seq,
          source: sourceSlice(request.source.text, node.byteRange),
          operands: observation.operands,
          value: observation.value,
        });
      } else if (observation.kind === 'swap') {
        assert.notEqual(
          observation.indices[0],
          observation.indices[1],
          'A swap may not exchange one cell with itself.',
        );
        swaps.push({
          seq: step.seq,
          indices: observation.indices,
          beforeValues: observation.beforeValues,
        });
      }
    }
  }
  assert.equal(
    stdout,
    sample.stdout,
    'Project-authored fixed output, not capture-supplied expectations.',
  );
  for (const binding of program.bindings) {
    const value = sample.values[binding.inputKey];
    const expected =
      binding.targetKind === 'array'
        ? (value as number[]).length
          ? value
          : [0]
        : [binding.targetKind === 'logical-length' ? (value as number[]).length : value];
    assert.deepEqual(
      initial[binding.targetName],
      expected,
      'The bound C declaration initialized the actual input.',
    );
  }
  if (sample.finalArray) {
    assert.ok(finalArray);
    assert.deepEqual(finalArray.slice(0, sample.finalArray.length), sample.finalArray);
  }
  if ((sample.key.endsWith('-equal') || sample.key.endsWith('-ordered')) && sample.finalArray) {
    assert.deepEqual(swaps, []);
    assert.deepEqual(
      writes.filter((item) => item.name === 'values'),
      [],
    );
  }
  if (sample.caseId === 'case.c.loops') {
    const count = sample.values.n as number;
    for (const condition of ['i <= n', 'j <= n']) {
      const values = comparisons
        .filter((item) => item.source === condition)
        .map((item) => item.value);
      assert.deepEqual(
        values,
        [...Array<number>(count).fill(1), 0],
        'Both real loop conditions include their final false check.',
      );
    }
  }
  if (sample.key === 'search-duplicate') {
    assert.deepEqual(
      writes.filter((item) => item.name === 'answer').map((item) => item.after),
      [2, 1],
    );
    const firstHit = writes.find((item) => item.name === 'answer')!;
    assert.ok(
      writes.some(
        (item) =>
          item.seq > firstHit.seq && item.name === 'right' && item.source === 'right = mid - 1;',
      ),
    );
  }
  if (
    sample.caseId === 'case.c.selection-sort' &&
    (sample.key.endsWith('-equal') || sample.key.endsWith('-ordered'))
  ) {
    const guards = comparisons.filter((item) => item.source === 'minIndex != i');
    assert.equal(guards.length, (sample.values.values as number[]).length - 1);
    assert.ok(guards.every((item) => item.value === 0));
  }
  return {
    initial,
    writes,
    swaps,
    comparisons,
    stdout,
    finalArray,
    steps: result.trace.steps.length,
    checkpoints: result.trace.checkpoints.length,
  };
}

export async function verifyCasePacket(
  packet: CasePacket,
  key: string,
  project: string,
  expectedBuildId?: string,
) {
  const sample = caseSetSamples.find((item) => item.key === key);
  assert.ok(sample, 'Only the frozen 42 public samples are accepted.');
  const ui = packet.ui;
  assert.equal(ui.captureVersion, '08.4-browser-capture@1');
  assert.equal(ui.evidenceLevel, 'production-ui-real-worker');
  assert.equal(ui.key, key);
  assert.equal(ui.caseId, sample.caseId);
  assert.equal(ui.project, project);
  assert.ok(ui.browserVersion);
  assert.equal(ui.sourceKind, 'public-content-original');
  assert.equal(ui.readOnly, true);
  assert.equal(ui.route, `#/visualize/${sample.caseId}`);
  assert.equal(ui.requestByteLength, packet.requestBytes.byteLength);
  assert.equal(ui.resultByteLength, packet.resultBytes.byteLength);
  assert.equal(ui.requestSha256, sha256(packet.requestBytes));
  assert.equal(ui.resultSha256, sha256(packet.resultBytes));
  assert.equal(ui.catalogSha256, sha256(packet.catalogText));
  assert.equal(ui.sourceSha256, sha256(packet.displayedSource));
  assert.equal(ui.worker.kind, 'execute');
  assert.ok(ui.worker.moduleSeen && ui.worker.responseOk && ui.worker.terminated);
  assert.ok(ui.worker.operationId);
  assert.equal(ui.worker.responseOperationId, ui.worker.operationId);
  const workerUrl = new URL(ui.worker.url);
  assert.equal(workerUrl.hostname, '127.0.0.1');
  assert.equal(workerUrl.protocol, 'http:');
  assert.match(workerUrl.pathname, /^\/assets\/execution\.worker-[A-Za-z0-9_-]+\.js$/u);
  const request = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(packet.requestBytes),
  ) as ExecuteRequest;
  const validators = await protocol();
  assert.deepEqual(validators.encodeRequest(request), packet.requestBytes);
  const result = await validators.decodeResult(Uint8Array.from(packet.resultBytes).buffer, request);
  const catalog = JSON.parse(packet.catalogText) as CaseCatalog;
  const facts = verifyCaseExecution(request, result, catalog, sample, expectedBuildId);
  assert.equal(packet.displayedSource, request.source.text);
  assert.equal(ui.displayedSource, request.source.text);
  assert.deepEqual(ui.values, sample.values);
  assert.deepEqual(ui.identity, request.identity);
  assert.equal(ui.stdout, facts.stdout);
  assert.equal(ui.terminal, 'completed');
  assert.equal(ui.steps, facts.steps);
  assert.equal(ui.initialCursor, 0);
  assert.equal(ui.initialView.cursor, 0);
  assert.equal(ui.initialView.viewCursor, 0);
  assert.equal(ui.initialView.status, 'ready');
  assert.equal(ui.initialView.kind, '');
  assert.equal(ui.initialView.output, '');
  assert.deepEqual(ui.initialView.scalars, []);
  assert.deepEqual(ui.initialView.arrays, []);
  assert.deepEqual(ui.initialView.counters, {
    comparisons: '0',
    scalarWrites: '0',
    arrayWrites: '0',
    swaps: '0',
  });
  assert.deepEqual(ui.initialView.marks, []);
  assert.equal(ui.initialView.terminalMarkCount, 0);
  assert.equal(ui.storage.scope, 'native-nine-stores+localStorage+sessionStorage');
  assert.deepEqual(
    [...ui.storage.storeNames].sort(),
    [
      'meta',
      'settings',
      'avatar',
      'progress',
      'dailyFacts',
      'goals',
      'ledger',
      'receipts',
      'aliases',
    ].sort(),
  );
  assert.match(ui.storage.beforeSha256, /^[a-f0-9]{64}$/u);
  assert.equal(ui.storage.beforeSha256, ui.storage.afterSha256);
  assert.equal(ui.storage.unchanged, true);
  if (sample.walk) {
    assert.ok(ui.walk && ui.replay);
    assert.deepEqual(
      ui.walk.forwardCursors,
      Array.from({ length: facts.steps + 1 }, (_, index) => index),
    );
    assert.deepEqual(
      ui.walk.reverseCursors,
      Array.from({ length: facts.steps + 1 }, (_, index) => facts.steps - index),
    );
    assert.ok(ui.walk.allStatesChecked && ui.walk.sourceRangesChecked);
    assert.deepEqual(ui.walk.finalArrayObserved, sample.finalArray ?? null);
    assert.equal(ui.replay.cycles, 6);
    assert.ok(ui.replay.initialRestored && ui.replay.noNewExecution);
    assert.deepEqual(
      ui.rates.map((rate) => rate.rate),
      [0.25, 0.5, 1, 1.5, 2, 4],
    );
    for (const rate of ui.rates) {
      // The browser test advances a virtual timer by the ceiling of one interval.
      // This is a deterministic playback check, not a wall-clock speed benchmark.
      assert.equal(rate.periodMs, Math.ceil(500 / rate.rate));
      assert.deepEqual(
        rate.cursors,
        Array.from({ length: facts.steps + 1 }, (_, index) => index),
      );
      assert.equal(rate.endCursor, facts.steps);
      assert.equal(rate.endStatus, 'ended');
      assert.equal(rate.stdout, sample.stdout);
      assert.equal(rate.allStatesChecked, true);
    }
  } else {
    assert.equal(ui.walk, null);
    assert.deepEqual(ui.rates, []);
    assert.equal(ui.replay, null);
  }
  return {
    key,
    caseId: sample.caseId,
    project,
    browserVersion: ui.browserVersion,
    runId: request.identity.runId,
    operationId: ui.worker.operationId,
    buildId: request.engineRef.buildId,
    requestSha256: ui.requestSha256,
    resultSha256: ui.resultSha256,
    sourceSha256: ui.sourceSha256,
    ...facts,
    checks: {
      fullProductionDecoder: true,
      allForwardInverseDeltasAndCheckpoints: true,
      unchangedFrozenCatalog: true,
      actualBoundInput: true,
      knownOutput: true,
      uiAcceptedRealWorker: true,
      storageUnchanged: true,
      fullUiWalk: !!sample.walk,
      sixRatesAndReplays: !!sample.walk,
    },
  };
}
export async function verifyCaseEvidence(
  root: string,
  projects = ['chrome', 'edge', 'firefox-automation'],
) {
  assert.ok(projects.length > 0 && new Set(projects).size === projects.length);
  assert.ok(
    projects.every((project) => ['chrome', 'edge', 'firefox-automation'].includes(project)),
  );
  assert.equal(caseSetSamples.length, 42);
  assert.equal(new Set(caseSetSamples.map((item) => item.key)).size, 42);
  assert.deepEqual([...new Set(caseSetSamples.map((item) => item.caseId))], [...caseSetIds]);
  const samples = [];
  for (const project of projects) {
    const directory = join(root, project);
    assert.deepEqual(
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
      caseSetSamples.map((item) => item.key).sort(),
      'Exactly the frozen case matrix for each actual browser.',
    );
    for (const sample of caseSetSamples)
      samples.push(
        await verifyCasePacket(readCasePacket(join(directory, sample.key)), sample.key, project),
      );
  }
  assert.equal(
    new Set(samples.map((item) => item.runId)).size,
    samples.length,
    'Every UI execution requires a fresh run identity.',
  );
  return {
    evidenceVersion: '08.4-independent-verification@1',
    root: resolve(root),
    dataRule: 'DEC-001 KEEP-09 public developer samples only',
    method:
      'Offline production decoder and fixed semantic oracles over original browser Worker bytes; no C rerun, user profile or reward grant.',
    passed: true,
    projects,
    completeInputMatrix: true,
    completeBrowserMatrix: projects.length === 3,
    cases: caseSetIds.length,
    inputsPerProject: caseSetSamples.length,
    sampleCount: samples.length,
    fullUiWalkCount: samples.filter((sample) => sample.checks.fullUiWalk).length,
    samples,
  };
}
/** Seven permanent representatives are explicitly a subset of the full 42-input matrix. */
export async function verifyCaseRepresentatives(root: string) {
  // These are historical producer bytes. Pin their immutable provenance rather
  // than rewriting the archive to claim it came from a newer engine build.
  const manifestBytes = readFileSync(join(root, 'manifest.json'));
  assert.equal(
    sha256(manifestBytes),
    'bbb9691f428383bf7ba86a7cbb9252aaf815b2fb6083a5ec1c3f86ce71116740',
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    entries: { files: { path: string; bytes: number; sha256: string }[] }[];
  };
  assert.equal(manifest.entries.length, 7);
  const files = manifest.entries.flatMap((entry) => entry.files);
  assert.equal(files.length, 35);
  for (const file of files) {
    const bytes = readFileSync(join(root, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha256(bytes), file.sha256);
  }
  const representatives = caseSetSamples.filter((sample) => sample.walk);
  assert.deepEqual(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
    representatives.map((sample) => sample.key).sort(),
    'Exactly seven archived public representatives.',
  );
  const samples = [];
  let project: string | undefined;
  for (const sample of representatives) {
    const packet = readCasePacket(join(root, sample.key));
    project ??= packet.ui.project;
    assert.equal(packet.ui.project, project);
    samples.push(await verifyCasePacket(packet, sample.key, project, CASE_ARCHIVE_BUILD_ID));
  }
  assert.equal(new Set(samples.map((sample) => sample.runId)).size, 7);
  return {
    evidenceVersion: '08.4-independent-representatives@1',
    historicalEngineBuildId: CASE_ARCHIVE_BUILD_ID,
    root: resolve(root),
    dataRule: 'DEC-001 KEEP-09 public developer samples only',
    method:
      'Offline production decoder over seven permanent UI representatives; explicitly not the complete 42-input or three-browser matrix.',
    passed: true,
    projects: [project!],
    cases: 7,
    sampleCount: samples.length,
    fullUiWalkCount: samples.length,
    completeMatrix: false,
    completeInputMatrix: false,
    completeBrowserMatrix: false,
    samples,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const positional: string[] = [];
  let projects: string[] | undefined;
  let representatives = false;
  for (let at = 2; at < process.argv.length; at++) {
    const argument = process.argv[at];
    if (argument === '--representatives') representatives = true;
    else if (argument === '--projects') {
      assert.ok(process.argv[at + 1], '--projects needs a comma-separated list.');
      projects = process.argv[++at].split(',');
    } else {
      assert.ok(!argument.startsWith('--'), `Unknown option ${argument}`);
      positional.push(argument);
    }
  }
  assert.ok(
    positional.length <= 2,
    'Usage: verify-case-set.mts [captureRoot] [outputReport] [--projects chrome,edge,firefox-automation] [--representatives]',
  );
  assert.ok(
    !representatives || !projects,
    'Representatives infer one project from their original UI records.',
  );
  const root = resolve(positional[0] ?? join(workspace, '.artifacts/08.4/browser-captures'));
  const output = resolve(
    positional[1] ?? join(workspace, '.artifacts/08.4/case-verification.json'),
  );
  const report = representatives
    ? await verifyCaseRepresentatives(root)
    : await verifyCaseEvidence(root, projects);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(
    `08.4: ${report.sampleCount} real UI captures independently verified across ${report.projects.length} browsers.\n${output}\n`,
  );
}
