/** Frozen EXEC-01 / STEP-01 / DIAG-01 / JSON-INT-01 1.0.0 browser boundary.
 * This module validates data; it never executes or reinterprets user C.
 */
import { validateTraceRelationships } from './trace-validation';
import { parseChunked, precheckJson } from './execution-json';
import {
  validateRequestSchema,
  validateResultSchema,
  validateTraceSchema,
} from './execution-schema.generated';
import {
  validateRequestSchema as validateP05RequestSchema,
  validateResultSchema as validateP05ResultSchema,
} from './execution-p05-schema.generated';

export interface Ref {
  id: string;
  version: string;
}
export interface ExecutionIdentity {
  contextId: string;
  contextRevision: number;
  submissionId: string;
  runId: string;
  sourceRevision: number;
  testCaseKey: string | null;
}
export interface ByteRange {
  start: number;
  end: number;
}
export type ExecutionLocation =
  | { kind: 'source'; nodeId?: string; edge?: 'start' | 'whole' | 'end'; byteRange?: ByteRange }
  | {
      kind: 'synthetic';
      reason:
        | 'initial-state'
        | 'implicit-return'
        | 'pre-execution'
        | 'adapter-cancel'
        | 'adapter-deadline'
        | 'module-load'
        | 'worker-failure'
        | 'protocol-validation'
        | 'encoding-failure';
      anchorNodeId?: string;
    };
export type DiagnosticCode =
  | 'E_LEX_INVALID'
  | 'E_PARSE_INVALID'
  | 'E_UNSUPPORTED_SYNTAX'
  | 'E_NAME_INVALID'
  | 'E_TYPE_INVALID'
  | 'E_FORMAT_INVALID'
  | 'E_UNINITIALIZED'
  | 'E_INDEX_BOUNDS'
  | 'E_DIV_ZERO'
  | 'E_INT_OVERFLOW'
  | 'E_INPUT_INVALID'
  | 'E_INPUT_ORDER'
  | 'E_BINDING_INVALID'
  | 'E_CONTENT_MISMATCH'
  | 'E_PROTOCOL_VERSION'
  | 'E_PROTOCOL_INVALID'
  | 'E_TRACE_INVALID'
  | 'E_SOURCE_LIMIT'
  | 'E_REQUEST_LIMIT'
  | 'E_DEPTH_LIMIT'
  | 'E_FUEL_LIMIT'
  | 'E_STEP_LIMIT'
  | 'E_MEMORY_LIMIT'
  | 'E_OUTPUT_LIMIT'
  | 'E_RESULT_LIMIT'
  | 'E_DEADLINE'
  | 'E_CANCELLED'
  | 'E_MODULE_LOAD'
  | 'E_WORKER_FAILURE'
  | 'E_WASM_TRAP'
  | 'E_ENCODING_FAILURE'
  | 'J_STDOUT_MISMATCH'
  | 'J_EXIT_NONZERO'
  | 'J_TEACHING_TARGET'
  | 'J_BINDING_MISMATCH';
export interface Diagnostic {
  code: DiagnosticCode;
  severity: 'error';
  origin: 'rust' | 'adapter' | 'protocol' | 'judge';
  stage:
    | 'preflight'
    | 'load'
    | 'lex'
    | 'parse'
    | 'semantic'
    | 'execute'
    | 'encode'
    | 'receive'
    | 'judge';
  location: ExecutionLocation;
  details: {
    expected?: number | string;
    actual?: number | string;
    limit?: number;
    used?: number;
    attempted?: number;
    dimension?: string;
    relatedNodeIds?: string[];
  };
}
export type JudgeRule = import('../content/types').JudgeRule;
export interface ExecuteRequest {
  kind: 'execute';
  protocolVersion: '1.0.0' | '1.1.0';
  traceVersion: '1.0.0';
  diagnosticVersion: '1.0.0';
  judgeVersion: '1.0.0' | '1.1.0';
  encodingVersion: '1.0.0';
  identity: ExecutionIdentity;
  mode: 'case' | 'exercise-test' | 'contract-probe';
  packageRef: Ref;
  languageRef: Ref;
  subsetRef: Ref;
  programRef: Ref | null;
  subjectRef: Ref | null;
  learningRevision: number | null;
  engineRef: Ref & { buildId: string };
  source: {
    text: string;
    blockMap: { blockId: string; byteRange: ByteRange }[];
    bindingMap: { bindingKey: string; byteRange: ByteRange }[];
  };
  input: {
    specRef: Ref | null;
    values: Readonly<Record<string, number | readonly number[]>>;
    random: { generatorRef: Ref; seed: string } | null;
  };
  judge: {
    profileRef: Ref;
    rule: JudgeRule;
    expectedStdout: string;
    expectedExitCode: 0;
    expectedArray?: number[];
  } | null;
  budgetRef: Ref;
  remainingMs: number;
}
export interface TraceFrame {
  id: string;
  functionNodeId: string;
  parentFrameId: string | null;
  scopeIds: string[];
}
export interface TraceScope {
  id: string;
  frameId: string;
  parentScopeId: string | null;
  nodeId: string;
  kind: 'main' | 'block' | 'for';
  objectIds: string[];
}
export interface TraceObject {
  id: string;
  declarationNodeId: string;
  frameId: string;
  scopeId: string;
  name: string;
  kind: 'int' | 'int-array';
  length: number;
  baseAddress: number;
  defaultValue: number | null;
  cells: { index: number; value: number }[];
}
export interface TraceControl {
  phase: 'ready' | 'running' | 'returned';
  nextNodeId: string | null;
  activeFrameId: string | null;
  returnValue: number | null;
  flowStack: {
    nodeId: string;
    stage: 'block' | 'init' | 'condition' | 'body' | 'update';
    iteration: number;
  }[];
}
export interface TraceAllocator {
  nextAddress: number;
  liveBytes: number;
  nextObject: number;
  nextScope: number;
  nextFrame: number;
}
export interface TraceCounters {
  comparisons: number;
  scalarWrites: number;
  arrayWrites: number;
  swaps: number;
}
export interface TraceState {
  frames: TraceFrame[];
  scopes: TraceScope[];
  objects: TraceObject[];
  control: TraceControl;
  allocator: TraceAllocator;
  output: string;
  counters: TraceCounters;
}
export type TraceRecord = TraceFrame | TraceScope | TraceObject;
export type TraceChange =
  | {
      op: 'record';
      table: 'frames' | 'scopes' | 'objects';
      id: string;
      index: number;
      before: TraceRecord | null;
      after: TraceRecord | null;
    }
  | { op: 'cell'; objectId: string; index: number; before: number | null; after: number | null }
  | { op: 'control'; before: TraceControl; after: TraceControl }
  | { op: 'allocator'; before: TraceAllocator; after: TraceAllocator }
  | { op: 'counters'; before: TraceCounters; after: TraceCounters }
  | { op: 'output'; beforeBytes: number; afterBytes: number; append: string };
export type TraceObservation =
  | { kind: 'read'; nodeId: string; objectId: string; index: number; value: number }
  | { kind: 'evaluate'; nodeId: string; operator: string; operands: number[]; value: number }
  | { kind: 'decision'; nodeId: string; value: number; branch: 'true' | 'false' }
  | { kind: 'short-circuit'; nodeId: string; skippedNodeId: string }
  | {
      kind: 'swap';
      nodeId: string;
      objectId: string;
      indices: number[];
      beforeValues: number[];
      writeSeqs: number[];
    };
export interface TraceStep {
  seq: number;
  kind:
    | 'program.enter'
    | 'object.declare'
    | 'value.initialize'
    | 'value.write'
    | 'condition'
    | 'scope.enter'
    | 'scope.exit'
    | 'output.append'
    | 'control.jump'
    | 'program.return'
    | 'nop';
  location: ExecutionLocation;
  changes: TraceChange[];
  observations: TraceObservation[];
}
export interface ExecutionTrace {
  dslVersion: '1.0.0';
  completeness: 'complete' | 'prefix';
  initialState: TraceState;
  steps: TraceStep[];
  checkpoints: { cursor: number; state: TraceState }[];
}
export interface ExecutionNode {
  nodeId: string;
  kind:
    | 'function'
    | 'block'
    | 'declaration'
    | 'assignment'
    | 'expression'
    | 'condition'
    | 'output'
    | 'return'
    | 'break'
    | 'continue'
    | 'empty'
    | 'if'
    | 'while'
    | 'for';
  parentId: string | null;
  byteRange: ByteRange;
}
export type TerminalStatus =
  | 'completed'
  | 'program-error'
  | 'rejected'
  | 'resource-limit'
  | 'cancelled'
  | 'infrastructure-failure';
export interface JudgeResult {
  profileRef: Ref;
  caseKey: string;
  status: 'met' | 'unmet' | 'not-evaluated';
  checks: {
    key: string;
    status: 'met' | 'unmet' | 'not-evaluated';
    nodeIds: string[];
    stepSeqs: number[];
    diagnosticCodes: DiagnosticCode[];
  }[];
  coverage: {
    siteKey: string;
    nodeId: string;
    branch: 'then' | 'else' | 'while' | 'for';
    visits: number;
  }[];
  observations: {
    kind: 'array-before-destroy';
    bindingKey: string;
    objectId: string;
    declarationNodeId: string;
    beforeCursor: number;
    location: ExecutionLocation;
    values: number[];
  }[];
}
export interface ExecuteResult {
  kind: 'result';
  protocolVersion: '1.0.0' | '1.1.0';
  traceVersion: '1.0.0';
  diagnosticVersion: '1.0.0';
  judgeVersion: '1.0.0' | '1.1.0';
  encodingVersion: '1.0.0';
  identity: ExecutionIdentity;
  producer: 'rust' | 'adapter';
  engineRef: ExecuteRequest['engineRef'];
  packageRef: Ref;
  languageRef: Ref;
  subsetRef: Ref;
  programRef: Ref | null;
  subjectRef: Ref | null;
  learningRevision: number | null;
  budgetRef: Ref;
  nodeMap: ExecutionNode[];
  resolvedBindings: { bindingKey: string; declarationNodeId: string }[];
  trace: ExecutionTrace | null;
  terminal: {
    status: TerminalStatus;
    exitCode: number | null;
    cursor: number | null;
    location: ExecutionLocation;
    diagnostics: Diagnostic[];
  };
  judgeResult: JudgeResult | null;
  stats: {
    fuelUsed: number;
    peakVirtualBytes: number;
    maxSyntaxDepth: number;
    maxAstDepth: number;
    rustMicros: number;
  } | null;
}

export class ProtocolFailure extends Error {
  constructor(
    public readonly code:
      'E_PROTOCOL_INVALID' | 'E_TRACE_INVALID' | 'E_PROTOCOL_VERSION' = 'E_PROTOCOL_INVALID',
  ) {
    super(code);
    this.name = 'ProtocolFailure';
  }
}
export function protocolAssert(
  value: unknown,
  code: ProtocolFailure['code'] = 'E_TRACE_INVALID',
): asserts value {
  if (!value) throw new ProtocolFailure(code);
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Work<T> = Generator<void, T, unknown>;
const utf8 = new TextEncoder();
const versions = [
  'protocolVersion',
  'traceVersion',
  'diagnosticVersion',
  'judgeVersion',
  'encodingVersion',
] as const;
export const REQUEST_BYTES_LIMIT = 65_536;
export const RESULT_BYTES_LIMIT = 16_777_216;
// Allocation strategy only, never a protocol resource limit: wider packets
// remain supported through the cancellable parser and encoder below.
const NATIVE_CONTAINER_BATCH = 250_000;

function validString(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = value.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function* canonical(value: unknown, depth = 0): Generator<string, void, unknown> {
  if (value === null || typeof value === 'boolean') {
    yield JSON.stringify(value);
    return;
  }
  if (typeof value === 'number') {
    protocolAssert(Number.isSafeInteger(value) && !Object.is(value, -0), 'E_PROTOCOL_INVALID');
    yield String(value);
    return;
  }
  if (typeof value === 'string') {
    protocolAssert(value.length <= 65_536 && validString(value), 'E_PROTOCOL_INVALID');
    yield JSON.stringify(value);
    return;
  }
  protocolAssert(typeof value === 'object' && value !== null && depth < 32, 'E_PROTOCOL_INVALID');
  if (Array.isArray(value)) {
    protocolAssert(value.length <= 1_000_000, 'E_PROTOCOL_INVALID');
    yield '[';
    for (let i = 0; i < value.length; i++) {
      if (i) yield ',';
      yield* canonical(value[i], depth + 1);
    }
    yield ']';
  } else {
    protocolAssert(
      Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
      'E_PROTOCOL_INVALID',
    );
    const object = value as Record<string, unknown>,
      keys: string[] = [];
    for (const key in object) {
      if (!Object.hasOwn(object, key)) continue;
      protocolAssert(keys.length < 32_768 && key.length <= 96, 'E_PROTOCOL_INVALID');
      keys.push(key);
      if ((keys.length & 255) === 0) yield '';
    }
    keys.sort();
    yield '{';
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      protocolAssert(/^[\x20-\x7e]+$/.test(key), 'E_PROTOCOL_INVALID');
      if (i) yield ',';
      yield JSON.stringify(key);
      yield ':';
      yield* canonical(object[key], depth + 1);
    }
    yield '}';
  }
}
export function* sameJson(a: unknown, b: unknown): Work<boolean> {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  yield;
  const left = Object.keys(a),
    right = Object.keys(b);
  if (left.length !== right.length) return false;
  for (const key of left) {
    if (
      !Object.hasOwn(b, key) ||
      !(yield* sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
    )
      return false;
  }
  return true;
}
async function runAsync<T>(work: Work<T>, guard: () => void): Promise<T> {
  let since = performance.now();
  guard();
  let next = work.next();
  while (!next.done) {
    guard();
    if (performance.now() - since >= 6) {
      await yieldTask();
      guard();
      since = performance.now();
    }
    next = work.next();
  }
  guard();
  return next.value;
}
// A posted task lets cancellation and input run without the nested-timer clamp.
// Ports close after each yield; no persistent scheduling worker or global queue.
export function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
export function sourceByteBoundaries(source: string): Set<number> {
  const points = new Set([0]);
  let offset = 0;
  for (let i = 0; i < source.length;) {
    const point = source.codePointAt(i)!;
    i += point > 0xffff ? 2 : 1;
    // TextEncoder replaces an isolated surrogate with U+FFFD (three bytes).
    offset += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (point === 13 && source.charCodeAt(i) === 10) {
      i++;
      offset++;
    }
    points.add(offset);
  }
  return points;
}
function requestRelationships(request: ExecuteRequest): void {
  protocolAssert(utf8.encode(request.source.text).length <= 32768, 'E_PROTOCOL_INVALID');
  const points = sourceByteBoundaries(request.source.text);
  for (const [map, key] of [
    [request.source.blockMap, 'blockId'],
    [request.source.bindingMap, 'bindingKey'],
  ] as const) {
    const seen = new Set<string>();
    for (const mapping of map) {
      const id = (mapping as unknown as Record<string, string>)[key];
      protocolAssert(
        !seen.has(id) &&
          mapping.byteRange.start <= mapping.byteRange.end &&
          points.has(mapping.byteRange.start) &&
          points.has(mapping.byteRange.end),
        'E_PROTOCOL_INVALID',
      );
      seen.add(id);
    }
  }
}
export function encodeRequest(request: ExecuteRequest): Uint8Array<ArrayBuffer> {
  let text = '',
    size = 0;
  for (const chunk of canonical(request)) {
    size += utf8.encode(chunk).length;
    protocolAssert(size <= REQUEST_BYTES_LIMIT, 'E_PROTOCOL_INVALID');
    text += chunk;
  }
  const p05 = request.protocolVersion === '1.1.0' && request.judgeVersion === '1.1.0';
  for (const key of versions)
    protocolAssert(
      request[key] ===
        (p05 && ['protocolVersion', 'judgeVersion'].includes(key) ? '1.1.0' : '1.0.0'),
      'E_PROTOCOL_VERSION',
    );
  protocolAssert(
    (p05 ? validateP05RequestSchema : validateRequestSchema)(request as unknown as Json),
    'E_PROTOCOL_INVALID',
  );
  requestRelationships(request);
  return utf8.encode(text);
}
export async function decodeResult(
  buffer: ArrayBuffer,
  request: ExecuteRequest,
  guard: () => void = () => {},
): Promise<ExecuteResult> {
  guard();
  const p05 = request.protocolVersion === '1.1.0' && request.judgeVersion === '1.1.0';
  protocolAssert(
    buffer instanceof ArrayBuffer &&
      buffer.byteLength > 0 &&
      buffer.byteLength <= RESULT_BYTES_LIMIT,
    'E_PROTOCOL_INVALID',
  );
  const bytes = new Uint8Array(buffer),
    decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let text = '';
  let decodedSince = performance.now();
  try {
    for (let at = 0; at < bytes.length; at += 65536) {
      text += decoder.decode(bytes.subarray(at, at + 65536), { stream: true });
      guard();
      if (performance.now() - decodedSince >= 6) {
        await yieldTask();
        guard();
        decodedSince = performance.now();
      }
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) throw new ProtocolFailure();
    throw error;
  }
  const shape = await runAsync(precheckJson(text), guard);
  guard();
  let value: Json;
  if (shape.containers <= NATIVE_CONTAINER_BATCH) {
    try {
      value = JSON.parse(text) as Json;
    } catch {
      throw new ProtocolFailure();
    }
  } else value = await runAsync(parseChunked(text), guard);
  guard();
  protocolAssert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'E_PROTOCOL_INVALID',
  );
  for (const key of versions)
    protocolAssert(
      value[key] === request[key] &&
        request[key] ===
          (p05 && ['protocolVersion', 'judgeVersion'].includes(key) ? '1.1.0' : '1.0.0'),
      'E_PROTOCOL_VERSION',
    );
  if (value.trace && typeof value.trace === 'object' && !Array.isArray(value.trace))
    protocolAssert(value.trace.dslVersion === '1.0.0', 'E_PROTOCOL_VERSION');
  const schemaValid = await runAsync(
    (p05 ? validateP05ResultSchema : validateResultSchema)(value, guard),
    guard,
  );
  if (
    !schemaValid &&
    value.producer === 'rust' &&
    value.trace &&
    typeof value.trace === 'object' &&
    !Array.isArray(value.trace)
  ) {
    protocolAssert(
      await runAsync(validateTraceSchema(value.trace, guard), guard),
      'E_TRACE_INVALID',
    );
    if (
      value.terminal &&
      typeof value.terminal === 'object' &&
      !Array.isArray(value.terminal) &&
      value.terminal.status === 'completed'
    )
      protocolAssert(value.trace.completeness === 'complete', 'E_TRACE_INVALID');
  }
  protocolAssert(schemaValid, 'E_PROTOCOL_INVALID');
  protocolAssert(value.producer !== 'fixture', 'E_PROTOCOL_INVALID');
  const result = value as unknown as ExecuteResult;
  for (const key of [
    'identity',
    'engineRef',
    'packageRef',
    'languageRef',
    'subsetRef',
    'programRef',
    'subjectRef',
    'learningRevision',
    'budgetRef',
  ] as const)
    protocolAssert(
      await runAsync(sameJson(result[key], request[key]), guard),
      'E_PROTOCOL_INVALID',
    );
  // Both versions use the strict lexical pass as their canonical proof: keys
  // are unique sorted nonnumeric ASCII, integers and escapes are shortest,
  // and the private native/chunked parser preserves those scalars exactly.
  // Schema/identity and full forward/inverse trace checks still run. Native
  // and chunked parsing preserve these validated scalars and sorted keys;
  // re-encoding the complete tree would repeat the same canonical proof.
  guard();
  await runAsync(validateTraceRelationships(result, request), guard);
  guard();
  return result;
}
export function makeAdapterResult(
  request: ExecuteRequest,
  status: Extract<
    TerminalStatus,
    'rejected' | 'resource-limit' | 'cancelled' | 'infrastructure-failure'
  >,
  code: DiagnosticCode,
): ExecuteResult {
  const reason: Extract<ExecutionLocation, { kind: 'synthetic' }>['reason'] =
    code === 'E_CANCELLED'
      ? 'adapter-cancel'
      : code === 'E_DEADLINE'
        ? 'adapter-deadline'
        : code === 'E_MODULE_LOAD'
          ? 'module-load'
          : code === 'E_ENCODING_FAILURE'
            ? 'encoding-failure'
            : code === 'E_PROTOCOL_INVALID' ||
                code === 'E_PROTOCOL_VERSION' ||
                code === 'E_TRACE_INVALID'
              ? 'protocol-validation'
              : 'worker-failure';
  const location: ExecutionLocation = { kind: 'synthetic', reason };
  return {
    kind: 'result',
    protocolVersion: request.protocolVersion,
    traceVersion: '1.0.0',
    diagnosticVersion: '1.0.0',
    judgeVersion: request.judgeVersion,
    encodingVersion: '1.0.0',
    identity: { ...request.identity },
    producer: 'adapter',
    engineRef: { ...request.engineRef },
    packageRef: { ...request.packageRef },
    languageRef: { ...request.languageRef },
    subsetRef: { ...request.subsetRef },
    programRef: request.programRef && { ...request.programRef },
    subjectRef: request.subjectRef && { ...request.subjectRef },
    learningRevision: request.learningRevision,
    budgetRef: { ...request.budgetRef },
    nodeMap: [],
    resolvedBindings: [],
    trace: null,
    terminal: {
      status,
      exitCode: null,
      cursor: null,
      location,
      diagnostics: [
        {
          code,
          severity: 'error',
          origin: 'adapter',
          stage:
            reason === 'module-load'
              ? 'load'
              : code === 'E_ENCODING_FAILURE'
                ? 'encode'
                : 'receive',
          location: { ...location },
          details: {},
        },
      ],
    },
    judgeResult: null,
    stats: null,
  };
}
