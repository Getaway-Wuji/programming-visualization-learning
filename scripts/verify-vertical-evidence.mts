/** Offline verification of six public 07.3 browser captures; never executes C. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
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

export const verticalKeys = [
  'assignment',
  'array-traversal',
  'bubble-sort',
  'array-empty',
  'assignment-div-zero',
  'array-out-of-bounds',
] as const;
export type VerticalKey = (typeof verticalKeys)[number];
type Variant = 'original' | 'division' | 'bounds';
interface Expected {
  caseId: string;
  variant: Variant;
  values: ExecuteRequest['input']['values'];
  stdout: string;
  diagnostic: 'E_DIV_ZERO' | 'E_INDEX_BOUNDS' | null;
}
// Authored expectations are independent of capture.expected and of any C rerun.
const expected: Record<VerticalKey, Expected> = {
  assignment: {
    caseId: 'case.c.assignment',
    variant: 'original',
    values: { x: -7 },
    stdout: '-5\n',
    diagnostic: null,
  },
  'array-traversal': {
    caseId: 'case.c.array-traversal',
    variant: 'original',
    values: { values: [-2, 5, 5, 0] },
    stdout: '8\n',
    diagnostic: null,
  },
  'bubble-sort': {
    caseId: 'case.c.bubble-sort',
    variant: 'original',
    values: { values: [4, -1, 4, 0] },
    stdout: '-1 0 4 4\n',
    diagnostic: null,
  },
  'array-empty': {
    caseId: 'case.c.array-traversal',
    variant: 'original',
    values: { values: [] },
    stdout: '0\n',
    diagnostic: null,
  },
  'assignment-div-zero': {
    caseId: 'case.c.assignment',
    variant: 'division',
    values: { x: -7 },
    stdout: '-7\n',
    diagnostic: 'E_DIV_ZERO',
  },
  'array-out-of-bounds': {
    caseId: 'case.c.array-traversal',
    variant: 'bounds',
    values: { values: [-2, 5, 5, 0] },
    stdout: '8\n',
    diagnostic: 'E_INDEX_BOUNDS',
  },
};
interface Catalog {
  packageRef: ExecuteRequest['packageRef'];
  subject: CaseEntity;
  program: ProgramEntity;
  inputSpec: InputSpecEntity;
}
export interface VerticalUi {
  caseId: string;
  route: string;
  displayedSource: string;
  inputValues: ExecuteRequest['input']['values'];
  draft: Record<string, string>;
  stdout: string;
  status: string;
  terminalText: string;
  stepsText: string;
  stepCount: number;
  diagnosticCodes: string[];
  diagnosticText: string[];
  readOnly: boolean;
  runId: string;
  submissionId: string;
}
interface Capture {
  captureVersion: string;
  evidenceLevel: string;
  dataRule: string;
  caseKey: string;
  caseId: string;
  project: string;
  browserVersion: string;
  variant: Variant;
  sourceKind: string;
  provenance: string;
  worker: {
    id: number;
    url: string;
    kind: string;
    operationId: string;
    responseOperationId: string;
    responseOk: boolean;
    terminated: boolean;
    moduleSeen: boolean;
  };
  requestByteLength: number;
  resultByteLength: number;
  requestSha256: string;
  resultSha256: string;
  catalogSha256: string;
  sourceSha256: string;
  fault: {
    programId: string;
    originalSource: string;
    modifiedSource: string;
    find: string;
    replace: string;
  } | null;
}
export interface VerticalPacket {
  requestBytes: Uint8Array;
  resultBytes: Uint8Array;
  catalogText: string;
  displayedSource: string;
  ui: VerticalUi;
  capture: Capture;
}
const workspace = fileURLToPath(new URL('../', import.meta.url));
const protocolModules = [
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
      // Node 24's TS stripping cannot load the existing parameter-property syntax.
      // Transpile only the pinned production validators, with source-addressed cache.
      assert.equal(ts.version, '6.0.3');
      const modules = protocolModules.map((name) => ({
        name,
        source: readFileSync(join(workspace, 'web/src/engine', `${name}.ts`), 'utf8'),
      }));
      const compilerOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext };
      // Bind the complete validator dependency graph and compiler options to a
      // new cache directory while keeping permanent capture archives read-only.
      const digest = sha256(
        ts.version +
          JSON.stringify(compilerOptions) +
          modules.map((item) => item.name + '\0' + item.source).join('\0'),
      );
      const directory = join(workspace, '.artifacts/07.3/verification-runtime', digest);
      mkdirSync(directory, { recursive: true });
      for (const item of modules) {
        let source = ts.transpileModule(item.source, {
          compilerOptions,
          fileName: `${item.name}.ts`,
        }).outputText;
        for (const name of protocolModules)
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
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
export function readVerticalPacket(directory: string): VerticalPacket {
  return {
    requestBytes: Uint8Array.from(readFileSync(join(directory, 'request.json'))),
    resultBytes: Uint8Array.from(readFileSync(join(directory, 'result.json'))),
    catalogText: readFileSync(join(directory, 'catalog.json'), 'utf8'),
    displayedSource: readFileSync(join(directory, 'source.c'), 'utf8'),
    ui: JSON.parse(readFileSync(join(directory, 'ui.json'), 'utf8')) as VerticalUi,
    capture: JSON.parse(readFileSync(join(directory, 'capture.json'), 'utf8')) as Capture,
  };
}
function oneReplacement(source: string, find: string, replace: string): string {
  assert.equal(source.split(find).length, 2, `Exactly one public-source fragment: ${find}`);
  return source.replace(find, replace);
}
function faultChange(variant: Exclude<Variant, 'original'>) {
  return variant === 'division'
    ? { find: 'x = x + 2;', replace: 'printf("%d\\n", x); x = x / 0;' }
    : { find: '    return 0;', replace: '    sum = values[n];\n    return 0;' };
}
function authoredSource(source: string, item: Expected): string {
  // This is a fixed acceptance oracle over public templates, not a source
  // preparation path exposed to the product and not an implementation of C.
  if (item.variant !== 'original') {
    const edit = faultChange(item.variant);
    source = oneReplacement(source, edit.find, edit.replace);
  }
  if ('x' in item.values) return oneReplacement(source, 'int x = 3;', 'int x = -7;');
  const values = item.values.values as readonly number[];
  source = oneReplacement(source, 'int n = 3;', `int n = ${values.length};`);
  const original =
    item.caseId === 'case.c.bubble-sort'
      ? 'int values[3] = {3, 1, 2};'
      : 'int values[3] = {3, -1, 2};';
  const declaration =
    item.caseId === 'case.c.bubble-sort'
      ? 'int values[4] = {4, -1, 4, 0};'
      : values.length === 0
        ? 'int values[1] = {0};'
        : 'int values[4] = {-2, 5, 5, 0};';
  return oneReplacement(source, original, declaration);
}
function sourceSlice(source: string, range: { start: number; end: number }): string {
  return Buffer.from(source, 'utf8').subarray(range.start, range.end).toString('utf8');
}
function locationText(location: ExecutionLocation, result: ExecuteResult, source: string): string {
  assert.equal(location.kind, 'source');
  if (location.kind !== 'source') throw new Error('Expected a real source location.');
  const range =
    location.byteRange ?? result.nodeMap.find((node) => node.nodeId === location.nodeId)?.byteRange;
  assert.ok(range, 'Source location must resolve to actual byte range.');
  return sourceSlice(source, range);
}
const objectValues = (object: TraceObject) =>
  Array.from(
    { length: object.length },
    (_, index) => object.cells.find((cell) => cell.index === index)?.value ?? object.defaultValue,
  );

export async function verifyVerticalPacket(
  packet: VerticalPacket,
  key: VerticalKey,
  recovery = false,
) {
  assert.ok(verticalKeys.includes(key), 'Only the six public samples are allowed.');
  assert.ok(!recovery || key === 'assignment-div-zero' || key === 'array-out-of-bounds');
  const normalKey = key === 'assignment-div-zero' ? 'assignment' : 'array-traversal';
  const item = expected[recovery ? normalKey : key];
  const { capture, ui } = packet;
  assert.equal(capture.caseKey, recovery ? `${key}-recovery` : key);
  assert.equal(capture.caseId, item.caseId);
  assert.equal(capture.captureVersion, '07.3-browser-capture@1');
  assert.equal(capture.evidenceLevel, 'production-ui-real-worker');
  assert.equal(capture.dataRule, 'DEC-001 KEEP-09 public developer samples only');
  assert.ok(capture.project && capture.browserVersion, 'Record the actual browser.');
  assert.equal(capture.variant, item.variant);
  assert.equal(
    capture.sourceKind,
    item.diagnostic ? 'test-isolated-content-fault' : 'public-content-original',
  );
  assert.equal(
    capture.provenance,
    item.diagnostic
      ? 'public-developer-test/isolated-fault-content-copy'
      : 'public-developer-test/original-content',
  );
  assert.equal(capture.worker.kind, 'execute');
  assert.equal(capture.worker.responseOk, true);
  assert.equal(capture.worker.terminated, true);
  assert.equal(capture.worker.moduleSeen, true);
  assert.ok(capture.worker.operationId);
  assert.equal(capture.worker.responseOperationId, capture.worker.operationId);
  const workerUrl = new URL(capture.worker.url);
  assert.equal(workerUrl.origin, 'http://127.0.0.1:4178');
  assert.match(workerUrl.pathname, /^\/assets\/execution\.worker-[A-Za-z0-9_-]+\.js$/u);
  assert.equal(packet.requestBytes.byteLength, capture.requestByteLength);
  assert.equal(packet.resultBytes.byteLength, capture.resultByteLength);
  assert.equal(sha256(packet.requestBytes), capture.requestSha256);
  assert.equal(sha256(packet.resultBytes), capture.resultSha256);
  assert.equal(sha256(packet.catalogText), capture.catalogSha256);
  assert.equal(sha256(packet.displayedSource), capture.sourceSha256);

  const request = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(packet.requestBytes),
  ) as ExecuteRequest;
  const validators = await protocol();
  assert.deepEqual(
    validators.encodeRequest(request),
    packet.requestBytes,
    'Canonical request, schema and ranges.',
  );
  const result = await validators.decodeResult(Uint8Array.from(packet.resultBytes).buffer, request);
  // decodeResult checks complete schema/identity/canonical UTF-8, all changes,
  // observations/checkpoints and the entire reverse sequence back to cursor 0.
  assert.equal(result.producer, 'rust');
  assert.equal(request.mode, 'case');
  assert.equal(request.judge, null);
  assert.equal(result.judgeResult, null);
  assert.equal(request.input.random, null);
  assert.deepEqual(request.input.values, item.values, 'Independent fixed public input.');
  assert.match(request.engineRef.buildId, /^[a-f0-9]{64}$/u);
  assert.equal(request.engineRef.id, 'engine.c.p0');
  assert.ok(
    request.remainingMs > 0 && request.remainingMs <= 1000,
    'Original deadline may only shrink.',
  );
  assert.deepEqual(request.budgetRef, { id: 'budget.p0', version: '1.0.0' });
  const catalog = JSON.parse(packet.catalogText) as Catalog;
  const baseline = JSON.parse(
    readFileSync(join(workspace, '项目文档/契约/02.1-内容样例.json'), 'utf8'),
  ) as ContentPackage;
  const subject = baseline.cases.find((subject) => subject.id === item.caseId)!;
  const program = baseline.programs.find((program) => program.id === subject.programRef.id)!;
  const inputSpec = baseline.inputSpecs.find((input) => input.id === program.inputRef.id)!;
  const referenceCatalog: Catalog = {
    packageRef: { id: baseline.packageId, version: baseline.packageVersion },
    subject,
    program: structuredClone(program),
    inputSpec,
  };
  if (item.diagnostic) {
    const edit = faultChange(item.variant as Exclude<Variant, 'original'>);
    const modifiedSource = oneReplacement(program.sourceExample, edit.find, edit.replace);
    assert.deepEqual(capture.fault, {
      programId: program.id,
      originalSource: program.sourceExample,
      modifiedSource,
      ...edit,
    });
    referenceCatalog.program = { ...program, sourceExample: modifiedSource };
  } else assert.equal(capture.fault, null);
  assert.deepEqual(
    catalog,
    referenceCatalog,
    'Only the recorded public content fault is permitted.',
  );
  assert.deepEqual(request.packageRef, catalog.packageRef);
  assert.deepEqual(request.subjectRef, { id: subject.id, version: subject.version });
  assert.deepEqual(request.programRef, subject.programRef);
  assert.deepEqual(request.input.specRef, program.inputRef);
  assert.deepEqual(request.languageRef, program.languageRef);
  assert.deepEqual(request.subsetRef, program.subsetRef);
  assert.equal(request.learningRevision, subject.learningRevision);
  assert.equal(request.source.text, authoredSource(program.sourceExample, item));
  assert.equal(packet.displayedSource, request.source.text);
  assert.deepEqual(request.source.blockMap, []);
  assert.deepEqual(
    request.source.bindingMap.map((value) => value.bindingKey),
    program.bindings.map((value) => value.bindingKey),
  );
  const bindingFacts = request.source.bindingMap.map((mapping) => {
    const resolved = result.resolvedBindings.find(
      (binding) => binding.bindingKey === mapping.bindingKey,
    )!;
    const node = result.nodeMap.find((node) => node.nodeId === resolved.declarationNodeId)!;
    assert.equal(node.kind, 'declaration');
    assert.deepEqual(node.byteRange, mapping.byteRange);
    const target = program.bindings.find((binding) => binding.bindingKey === mapping.bindingKey)!;
    const text = sourceSlice(request.source.text, mapping.byteRange);
    assert.match(text, new RegExp(`^int ${target.targetName}\\b`));
    return { bindingKey: mapping.bindingKey, nodeId: node.nodeId, byteRange: node.byteRange, text };
  });
  assert.equal(ui.caseId, item.caseId);
  assert.equal(ui.route, `#/visualize/${item.caseId}`);
  assert.equal(ui.displayedSource, request.source.text);
  assert.equal(ui.readOnly, true);
  assert.deepEqual(ui.inputValues, request.input.values);
  assert.equal(ui.runId, request.identity.runId);
  assert.equal(ui.submissionId, request.identity.submissionId);
  const status = item.diagnostic ? 'program-error' : 'completed';
  assert.equal(result.terminal.status, status);
  assert.equal(ui.status, status, 'The UI must have actually accepted the Worker result.');
  assert.equal(ui.terminalText, item.diagnostic ? '程序发生错误' : '程序正常结束');
  assert.ok(result.trace && result.stats);
  assert.equal(result.trace.completeness, item.diagnostic ? 'prefix' : 'complete');
  assert.equal(result.terminal.exitCode, item.diagnostic ? null : 0);
  assert.equal(ui.stepCount, result.trace.steps.length);
  assert.equal(
    ui.stepsText,
    `有效轨迹：${ui.stepCount} 步${item.diagnostic ? '（未完成的有效前缀）' : ''}`,
  );
  assert.deepEqual(ui.diagnosticCodes, item.diagnostic ? [item.diagnostic] : []);
  if (item.diagnostic) {
    assert.equal(result.terminal.diagnostics.length, 1);
    const diagnostic = result.terminal.diagnostics[0];
    assert.equal(diagnostic.code, item.diagnostic);
    assert.equal(diagnostic.origin, 'rust');
    assert.equal(diagnostic.stage, 'execute');
    assert.ok(
      ui.diagnosticText.some((text) => text.startsWith(`${item.diagnostic} · 阶段：execute`)),
    );
    assert.equal(
      locationText(diagnostic.location, result, request.source.text),
      item.variant === 'division' ? 'x / 0' : 'values[n]',
    );
    assert.deepEqual(result.terminal.location, diagnostic.location);
  } else {
    assert.deepEqual(result.terminal.diagnostics, []);
    assert.deepEqual(ui.diagnosticText, []);
  }
  assert.ok(result.stats.fuelUsed > 0 && result.stats.fuelUsed <= 1_000_000);
  assert.ok(result.stats.peakVirtualBytes > 0 && result.stats.peakVirtualBytes <= 1_048_576);
  assert.ok(result.trace.steps.length > 1 && result.trace.steps.length <= 20_000);
  assert.equal(result.trace.initialState.output, '');
  const objects = new Map<string, TraceObject>();
  const initial: Record<string, (number | null)[]> = {};
  const writes: {
    name: string;
    seq: number;
    index: number;
    before: number | null;
    after: number | null;
    source: string;
  }[] = [];
  const reads: { name: string; index: number; value: number }[] = [];
  const swaps: { indices: number[]; beforeValues: number[]; writeSeqs: number[] }[] = [];
  let stdout = '';
  let finalArray: (number | null)[] | undefined;
  for (const step of result.trace.steps) {
    for (const change of step.changes) {
      if (change.op === 'record' && change.table === 'objects') {
        const object = (change.after ?? change.before) as TraceObject;
        objects.set(object.id, object);
        if (step.kind === 'value.initialize') initial[object.name] = objectValues(object);
        if (change.after === null && object.name === 'values') finalArray = objectValues(object);
      } else if (change.op === 'cell') {
        const object = objects.get(change.objectId)!;
        if (step.kind === 'value.initialize') initial[object.name] = [change.after];
        else
          writes.push({
            name: object.name,
            seq: step.seq,
            index: change.index,
            before: change.before,
            after: change.after,
            source: locationText(step.location, result, request.source.text),
          });
      } else if (change.op === 'output') stdout += change.append;
    }
    for (const observation of step.observations) {
      if (observation.kind === 'read')
        reads.push({
          name: objects.get(observation.objectId)!.name,
          index: observation.index,
          value: observation.value,
        });
      if (observation.kind === 'swap')
        swaps.push({
          indices: observation.indices,
          beforeValues: observation.beforeValues,
          writeSeqs: observation.writeSeqs,
        });
    }
  }
  assert.equal(stdout, item.stdout, 'Independent fixed output from actual output deltas.');
  assert.equal(ui.stdout, stdout);
  const namedWrites = (name: string) => writes.filter((write) => write.name === name);
  if ('x' in item.values) {
    assert.deepEqual(initial.x, [-7]);
    assert.deepEqual(
      namedWrites('x').map((write) => [write.before, write.after]),
      item.diagnostic ? [] : [[-7, -5]],
    );
    for (const write of namedWrites('x')) assert.equal(write.source, 'x = x + 2;');
  } else {
    const values = item.values.values as number[];
    assert.deepEqual(initial.n, [values.length]);
    assert.deepEqual(initial.values, values.length ? values : [0]);
    if (item.caseId === 'case.c.bubble-sort') {
      assert.deepEqual(
        namedWrites('values').map((write) => [write.index, write.before, write.after]),
        [
          [0, 4, -1],
          [1, -1, 4],
          [2, 4, 0],
          [3, 0, 4],
          [1, 4, 0],
          [2, 0, 4],
        ],
      );
      assert.deepEqual(finalArray, [-1, 0, 4, 4]);
      assert.deepEqual(
        swaps.map((swap) => [swap.indices, swap.beforeValues]),
        [
          [
            [0, 1],
            [4, -1],
          ],
          [
            [2, 3],
            [4, 0],
          ],
          [
            [1, 2],
            [4, 0],
          ],
        ],
      );
      for (const write of namedWrites('values'))
        assert.ok(
          write.source === 'values[j] = values[j + 1];' || write.source === 'values[j + 1] = temp;',
        );
    } else {
      assert.deepEqual(initial.sum, [0]);
      assert.deepEqual(
        namedWrites('sum').map((write) => [write.before, write.after]),
        values.length
          ? [
              [0, -2],
              [-2, 3],
              [3, 8],
              [8, 8],
            ]
          : [],
      );
      for (const write of namedWrites('sum')) assert.equal(write.source, 'sum = sum + values[i];');
      assert.deepEqual(
        reads.filter((read) => read.name === 'values').map((read) => [read.index, read.value]),
        values.length
          ? [
              [0, -2],
              [1, 5],
              [2, 5],
              [3, 0],
            ]
          : [],
      );
      assert.deepEqual(namedWrites('values'), []);
    }
  }
  return {
    key: recovery ? `${key}-recovery` : key,
    project: capture.project,
    browserVersion: capture.browserVersion,
    caseId: item.caseId,
    variant: item.variant,
    runId: request.identity.runId,
    submissionId: request.identity.submissionId,
    contextId: request.identity.contextId,
    operationId: capture.worker.operationId,
    producer: result.producer,
    status,
    stdout,
    steps: result.trace.steps.length,
    checkpoints: result.trace.checkpoints.length,
    requestBytes: packet.requestBytes.byteLength,
    resultBytes: packet.resultBytes.byteLength,
    requestSha256: capture.requestSha256,
    resultSha256: capture.resultSha256,
    buildId: request.engineRef.buildId,
    bindingFacts,
    initial,
    writes,
    swaps,
    diagnostic: result.terminal.diagnostics[0] ?? null,
    checks: {
      canonicalRequest: true,
      fullProductionDecoder: true,
      allForwardAndInverseChanges: true,
      checkpoints: true,
      sourceAndBindingMap: true,
      independentKnownSemantics: true,
      acceptedUi: true,
      explicitPublicProvenance: true,
    },
  };
}

export async function verifyVerticalEvidence(root: string) {
  const samples = [];
  const recoveries = [];
  for (const key of verticalKeys) {
    const directory = join(root, key);
    const verified = await verifyVerticalPacket(readVerticalPacket(directory), key);
    samples.push(verified);
    if (existsSync(join(directory, 'recovery/capture.json'))) {
      const recovery = await verifyVerticalPacket(
        readVerticalPacket(join(directory, 'recovery')),
        key,
        true,
      );
      assert.notEqual(recovery.runId, verified.runId);
      assert.notEqual(recovery.submissionId, verified.submissionId);
      assert.notEqual(recovery.contextId, verified.contextId);
      assert.notEqual(recovery.operationId, verified.operationId);
      recoveries.push(recovery);
    }
  }
  for (const field of ['runId', 'submissionId', 'contextId', 'operationId'] as const)
    assert.equal(
      new Set([...samples, ...recoveries].map((sample) => sample[field])).size,
      samples.length + recoveries.length,
      `Every observed run requires a fresh ${field}.`,
    );
  return {
    evidenceVersion: '07.3-independent-verification@1',
    root: resolve(root),
    dataRule: 'DEC-001 KEEP-09 public developer samples only',
    method: 'Offline validation of captured production bytes; no C rerun or result substitution.',
    passed: true,
    sampleCount: samples.length,
    recoveryCount: recoveries.length,
    samples,
    recoveries,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(workspace, '项目文档/验收/07.3-真实轨迹'));
  const report = await verifyVerticalEvidence(root);
  const output = resolve(
    process.argv[3] ?? join(workspace, '.artifacts/07.3/semantic-verification.json'),
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(
    `07.3: ${report.sampleCount} public captures and ${report.recoveryCount} recoveries independently verified.\n${output}\n`,
  );
}
