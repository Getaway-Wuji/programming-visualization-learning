/** Explicit P1 algorithm protocol. This branch grants no learning authority. */
import { precheckJson } from './execution-json';

export interface AlgorithmRequest {
  execVersion: '1.2.0';
  dslVersion: '1.1.0';
  diagnosticVersion: '1.1.0';
  integerEncoding: '1.0.0';
  language: 'c' | 'cpp';
  engineId: 'engine.rust.p1';
  runId: string;
  sourceRevision: string;
  source: string;
  input: number[];
}
export interface AlgorithmNode {
  nodeId: string;
  kind: string;
  byteRange: { start: number; end: number };
}
export interface AlgorithmFrame {
  id: string;
  functionNodeId: string;
  functionName: string;
  parentFrameId: string | null;
  callNodeId: string | null;
  scopeIds: string[];
}
export interface AlgorithmScope {
  id: string;
  frameId: string;
  nodeId: string;
  objectIds: string[];
  aliases: { name: string; objectId: string }[];
}
export interface AlgorithmObject {
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
export interface AlgorithmState {
  frames: AlgorithmFrame[];
  scopes: AlgorithmScope[];
  objects: AlgorithmObject[];
  control: {
    activeFrameId: string | null;
    nextNodeId: string | null;
    returnValue: number | null;
    inputCursor: number;
  };
  allocator: {
    nextAddress: number;
    liveBytes: number;
    nextObject: number;
    nextScope: number;
    nextFrame: number;
  };
  output: string;
  counters: { comparisons: number; scalarWrites: number; arrayWrites: number; swaps: number };
}
type RecordValue = AlgorithmFrame | AlgorithmScope | AlgorithmObject;
export type AlgorithmChange =
  | {
      op: 'record';
      table: 'frames' | 'scopes' | 'objects';
      id: string;
      index: number;
      before: RecordValue | null;
      after: RecordValue | null;
    }
  | { op: 'cell'; objectId: string; index: number; before: number | null; after: number | null }
  | { op: 'control'; before: AlgorithmState['control']; after: AlgorithmState['control'] }
  | { op: 'allocator'; before: AlgorithmState['allocator']; after: AlgorithmState['allocator'] }
  | { op: 'counters'; before: AlgorithmState['counters']; after: AlgorithmState['counters'] }
  | { op: 'output'; beforeBytes: number; afterBytes: number; append: string };
export interface AlgorithmStep {
  seq: number;
  kind: string;
  nodeId: string;
  changes: AlgorithmChange[];
}
export interface AlgorithmTrace {
  dslVersion: '1.1.0';
  completeness: 'complete' | 'prefix';
  initialState: AlgorithmState;
  steps: AlgorithmStep[];
  checkpoints: { cursor: number; state: AlgorithmState }[];
}
export interface AlgorithmResult {
  execVersion: '1.2.0';
  dslVersion: '1.1.0';
  diagnosticVersion: '1.1.0';
  integerEncoding: '1.0.0';
  language: 'c' | 'cpp';
  engine: { id: 'engine.rust.p1'; version: '0.1.0'; buildId: string };
  identity: { runId: string; sourceRevision: string };
  nodeMap: AlgorithmNode[];
  trace: AlgorithmTrace | null;
  terminal: {
    status: 'completed' | 'error' | 'limited' | 'cancelled';
    code: string | null;
    byteRange: { start: number; end: number } | null;
    cursor: number;
    returnValue: number | null;
  };
  stats: { fuelUsed: number };
}

export function algorithmAssert(condition: unknown): asserts condition {
  if (!condition) throw new Error('E_PROTOCOL_INVALID');
}
const enc = new TextEncoder();
const size = (text: string) => (text === '' ? 0 : enc.encode(text).length);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function keys(
  value: unknown,
  expected: readonly string[],
): asserts value is Record<string, unknown> {
  algorithmAssert(record(value));
  algorithmAssert(Object.keys(value).length === expected.length);
  for (const key of expected) algorithmAssert(key in value);
}
// Reuse closed schemas throughout long traces instead of allocating the same
// key arrays for every state, delta and record. Every key is still checked.
const fields = {
  state: ['frames', 'scopes', 'objects', 'control', 'allocator', 'output', 'counters'],
  frame: ['id', 'functionNodeId', 'functionName', 'parentFrameId', 'callNodeId', 'scopeIds'],
  scope: ['id', 'frameId', 'nodeId', 'objectIds', 'aliases'],
  object: [
    'id',
    'declarationNodeId',
    'frameId',
    'scopeId',
    'name',
    'kind',
    'length',
    'baseAddress',
    'defaultValue',
    'cells',
  ],
  control: ['activeFrameId', 'nextNodeId', 'returnValue', 'inputCursor'],
  allocator: ['nextAddress', 'liveBytes', 'nextObject', 'nextScope', 'nextFrame'],
  counters: ['comparisons', 'scalarWrites', 'arrayWrites', 'swaps'],
  step: ['seq', 'kind', 'nodeId', 'changes'],
  recordChange: ['op', 'table', 'id', 'index', 'before', 'after'],
  cellChange: ['op', 'objectId', 'index', 'before', 'after'],
  outputChange: ['op', 'beforeBytes', 'afterBytes', 'append'],
  singletonChange: ['op', 'before', 'after'],
  checkpoint: ['cursor', 'state'],
} as const;
const uint = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const int = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= -2147483648 && (n as number) <= 2147483647;
const nullableInt = (n: unknown) => n === null || int(n);
const recordIdPatterns = new Map([
  ['f', /^f[1-9][0-9]{0,14}$/],
  ['s', /^s[1-9][0-9]{0,14}$/],
  ['o', /^o[1-9][0-9]{0,14}$/],
  ['n', /^n[1-9][0-9]{0,14}$/],
]);
const id = (value: unknown, prefix?: string): value is string =>
  typeof value === 'string' &&
  (prefix
    ? Boolean(recordIdPatterns.get(prefix)?.test(value))
    : /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value));
const name = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && value.length <= 32768;
const nodeKinds = [
  'function',
  'parameter',
  'block',
  'declaration',
  'assignment',
  'if',
  'while',
  'for',
  'return',
  'break',
  'continue',
  'empty',
  'expression',
  'expression-statement',
  'call',
  'output',
  'input',
];
const stepKinds = [
  'program.enter',
  'function.enter',
  'function.return',
  'program.return',
  'object.declare',
  'value.initialize',
  'value.write',
  'condition',
  'scope.enter',
  'scope.exit',
  'output.append',
  'input.read',
  'control.jump',
  'nop',
];
const errorCodes = [
  'E_PROTOCOL_INVALID',
  'E_UNSUPPORTED_VERSION',
  'E_SOURCE_LIMIT',
  'E_REQUEST_LIMIT',
  'E_INPUT_INVALID',
  'E_LEX_INVALID',
  'E_PARSE_INVALID',
  'E_NAME_INVALID',
  'E_UNSUPPORTED_SYNTAX',
  'E_DEPTH_LIMIT',
  'E_FUNCTION_LIMIT',
  'E_PARAMETER_LIMIT',
  'E_DUPLICATE',
  'E_UNDECLARED',
  'E_TYPE_INVALID',
  'E_ARGUMENTS',
  'E_RETURN_MISSING',
  'E_STACK_LIMIT',
  'E_UNINITIALIZED',
  'E_BOUNDS',
  'E_DIV_ZERO',
  'E_OVERFLOW',
  'E_INPUT_EXHAUSTED',
  'E_OUTPUT_LIMIT',
  'E_MEMORY_LIMIT',
  'E_STEP_LIMIT',
  'E_RESULT_LIMIT',
  'E_FUEL_LIMIT',
  'E_DEADLINE',
  'E_CANCELLED',
  'E_ENCODING_FAILURE',
];
function ids(value: unknown, prefix: string): asserts value is string[] {
  algorithmAssert(
    Array.isArray(value) &&
      value.every((item) => id(item, prefix)) &&
      new Set(value).size === value.length,
  );
}
export function canonicalAlgorithmJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAlgorithmJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalAlgorithmJson(object[key])}`)
    .join(',')}}`;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (i in a && !equal(a[i], b[i])) return false;
    return true;
  }
  if (!record(a) || !record(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) if (!(key in b) || !equal(a[key], b[key])) return false;
  return true;
}
function yieldAlgorithmTask(): Promise<void> {
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
export function encodeAlgorithmRequest(request: AlgorithmRequest): Uint8Array<ArrayBuffer> {
  keys(request, [
    'execVersion',
    'dslVersion',
    'diagnosticVersion',
    'integerEncoding',
    'language',
    'engineId',
    'runId',
    'sourceRevision',
    'source',
    'input',
  ]);
  algorithmAssert(
    request.execVersion === '1.2.0' &&
      request.dslVersion === '1.1.0' &&
      request.diagnosticVersion === '1.1.0' &&
      request.integerEncoding === '1.0.0',
  );
  algorithmAssert(request.language === 'c' || request.language === 'cpp');
  algorithmAssert(
    request.engineId === 'engine.rust.p1' && id(request.runId) && id(request.sourceRevision),
  );
  algorithmAssert(typeof request.source === 'string' && size(request.source) <= 32768);
  for (const scalar of request.source) {
    const code = scalar.codePointAt(0)!;
    algorithmAssert(code < 0xd800 || code > 0xdfff);
  }
  algorithmAssert(
    Array.isArray(request.input) &&
      request.input.length <= 30 &&
      request.input.every((value) => int(value) && value >= -999 && value <= 999),
  );
  const bytes = enc.encode(canonicalAlgorithmJson(request));
  algorithmAssert(bytes.length <= 65536);
  return bytes;
}

interface ValidationCache {
  records: WeakMap<object, string>;
  singletons: WeakMap<object, string>;
  tables: WeakMap<object, string>;
  frames?: {
    rows: AlgorithmFrame[];
    byId: Map<string, AlgorithmFrame>;
    positions: Map<string, number>;
    maximumId: number;
  };
  scopes?: {
    rows: AlgorithmScope[];
    byId: Map<string, AlgorithmScope>;
    byFrame: Map<string, string[]>;
    maximumId: number;
  };
  objects?: {
    rows: AlgorithmObject[];
    byId: Map<string, AlgorithmObject>;
    byScope: Map<string, string[]>;
    maximumId: number;
    endAddress: number;
    liveBytes: number;
  };
  relationships?: Pick<AlgorithmState, 'frames' | 'scopes' | 'objects'>;
}
function validateRecord(
  table: string,
  value: unknown,
  nodes: Map<string, AlgorithmNode>,
  cache?: ValidationCache,
) {
  if (record(value) && cache?.records.get(value) === table) return;
  if (table === 'frames') {
    keys(value, fields.frame);
    algorithmAssert(id(value.id, 'f') && name(value.functionName));
    algorithmAssert(
      typeof value.functionNodeId === 'string' &&
        nodes.get(value.functionNodeId)?.kind === 'function',
    );
    algorithmAssert(value.parentFrameId === null || id(value.parentFrameId, 'f'));
    algorithmAssert(
      value.callNodeId === null ||
        (typeof value.callNodeId === 'string' && nodes.get(value.callNodeId)?.kind === 'call'),
    );
    ids(value.scopeIds, 's');
  } else if (table === 'scopes') {
    keys(value, fields.scope);
    algorithmAssert(
      id(value.id, 's') &&
        id(value.frameId, 'f') &&
        typeof value.nodeId === 'string' &&
        nodes.has(value.nodeId),
    );
    ids(value.objectIds, 'o');
    algorithmAssert(['block', 'for'].includes(nodes.get(value.nodeId as string)!.kind));
    algorithmAssert(Array.isArray(value.aliases) && value.aliases.length <= 8);
    for (const alias of value.aliases) {
      keys(alias, ['name', 'objectId']);
      algorithmAssert(name(alias.name) && id(alias.objectId, 'o'));
    }
    algorithmAssert(
      new Set(value.aliases.map((alias) => (alias as { name: string }).name)).size ===
        value.aliases.length,
    );
  } else {
    algorithmAssert(table === 'objects');
    keys(value, fields.object);
    algorithmAssert(
      id(value.id, 'o') && id(value.frameId, 'f') && id(value.scopeId, 's') && name(value.name),
    );
    algorithmAssert(
      typeof value.declarationNodeId === 'string' && nodes.has(value.declarationNodeId),
    );
    algorithmAssert(
      ['declaration', 'parameter'].includes(nodes.get(value.declarationNodeId)!.kind),
    );
    algorithmAssert(value.kind === 'int' || value.kind === 'int-array');
    algorithmAssert(
      uint(value.length) &&
        value.length >= 1 &&
        value.length <= 262144 &&
        (value.kind !== 'int' || value.length === 1),
    );
    algorithmAssert(
      uint(value.baseAddress) &&
        value.baseAddress >= 4096 &&
        value.baseAddress % 4 === 0 &&
        nullableInt(value.defaultValue),
    );
    algorithmAssert(Array.isArray(value.cells) && value.cells.length <= value.length);
    let previous = -1;
    for (const cell of value.cells) {
      keys(cell, ['index', 'value']);
      algorithmAssert(
        uint(cell.index) &&
          cell.index > previous &&
          cell.index < value.length &&
          int(cell.value) &&
          cell.value !== value.defaultValue,
      );
      previous = cell.index;
    }
  }
  if (record(value)) cache?.records.set(value, table);
}
function validateSingleton(
  op: string,
  value: unknown,
  nodes: Map<string, AlgorithmNode>,
  inputLength: number,
  cache?: ValidationCache,
) {
  if (record(value) && cache?.singletons.get(value) === op) return;
  if (op === 'control') {
    keys(value, fields.control);
    algorithmAssert(value.activeFrameId === null || id(value.activeFrameId, 'f'));
    algorithmAssert(
      value.nextNodeId === null ||
        (typeof value.nextNodeId === 'string' && nodes.has(value.nextNodeId)),
    );
    algorithmAssert(
      nullableInt(value.returnValue) && uint(value.inputCursor) && value.inputCursor <= inputLength,
    );
  } else if (op === 'allocator') {
    keys(value, fields.allocator);
    algorithmAssert(
      uint(value.nextAddress) && value.nextAddress >= 4096 && value.nextAddress % 4 === 0,
    );
    algorithmAssert(
      uint(value.liveBytes) && value.liveBytes <= 1048576 && value.liveBytes % 4 === 0,
    );
    for (const key of ['nextObject', 'nextScope', 'nextFrame'])
      algorithmAssert(uint(value[key]) && value[key] > 0);
  } else {
    algorithmAssert(op === 'counters');
    keys(value, fields.counters);
    algorithmAssert(Object.values(value).every(uint));
  }
  if (record(value)) cache?.singletons.set(value, op);
}
function validateState(
  state: AlgorithmState,
  nodes: Map<string, AlgorithmNode>,
  inputLength: number,
  cache: ValidationCache,
) {
  keys(state, fields.state);
  algorithmAssert(
    Array.isArray(state.frames) &&
      state.frames.length <= 32 &&
      Array.isArray(state.scopes) &&
      Array.isArray(state.objects),
  );
  for (const table of ['frames', 'scopes', 'objects'] as const) {
    const rows = state[table];
    if (cache.tables.get(rows) !== table) {
      for (const item of rows) validateRecord(table, item, nodes, cache);
      algorithmAssert(new Set(rows.map((item) => item.id)).size === rows.length);
      cache.tables.set(rows, table);
    }
  }
  for (const op of ['control', 'allocator', 'counters'] as const)
    validateSingleton(op, state[op], nodes, inputLength, cache);
  algorithmAssert(typeof state.output === 'string' && size(state.output) <= 16384);
  // These facts depend only on immutable private table snapshots. Allocator
  // ceilings and control still have to be checked for every projected state.
  let frames = cache.frames;
  if (frames?.rows !== state.frames) {
    frames = { rows: state.frames, byId: new Map(), positions: new Map(), maximumId: 0 };
    for (const [i, frame] of state.frames.entries()) {
      algorithmAssert(frame.parentFrameId === (i ? state.frames[i - 1].id : null));
      algorithmAssert((i === 0) === (frame.callNodeId === null));
      frames.byId.set(frame.id, frame);
      frames.positions.set(frame.id, i);
      frames.maximumId = Math.max(frames.maximumId, Number(frame.id.slice(1)));
    }
    cache.frames = frames;
  }
  let scopes = cache.scopes;
  if (scopes?.rows !== state.scopes) {
    scopes = { rows: state.scopes, byId: new Map(), byFrame: new Map(), maximumId: 0 };
    for (const scope of state.scopes) {
      scopes.byId.set(scope.id, scope);
      scopes.maximumId = Math.max(scopes.maximumId, Number(scope.id.slice(1)));
      const list = scopes.byFrame.get(scope.frameId) ?? [];
      list.push(scope.id);
      scopes.byFrame.set(scope.frameId, list);
    }
    cache.scopes = scopes;
  }
  let objects = cache.objects;
  if (objects?.rows !== state.objects) {
    objects = {
      rows: state.objects,
      byId: new Map(),
      byScope: new Map(),
      maximumId: 0,
      endAddress: 4096,
      liveBytes: 0,
    };
    for (const object of [...state.objects].sort((a, b) => a.baseAddress - b.baseAddress)) {
      algorithmAssert(object.baseAddress >= objects.endAddress);
      objects.endAddress = object.baseAddress + object.length * 4;
      algorithmAssert(Number.isSafeInteger(objects.endAddress));
      objects.liveBytes += object.length * 4;
      objects.maximumId = Math.max(objects.maximumId, Number(object.id.slice(1)));
      objects.byId.set(object.id, object);
    }
    // Scope object IDs follow declaration order rather than address order.
    for (const object of state.objects) {
      const list = objects.byScope.get(object.scopeId) ?? [];
      list.push(object.id);
      objects.byScope.set(object.scopeId, list);
    }
    cache.objects = objects;
  }
  algorithmAssert(frames.maximumId < state.allocator.nextFrame);
  algorithmAssert(scopes.maximumId < state.allocator.nextScope);
  algorithmAssert(objects.maximumId < state.allocator.nextObject);
  algorithmAssert(objects.endAddress <= state.allocator.nextAddress);
  algorithmAssert(objects.liveBytes === state.allocator.liveBytes);
  const prior = cache.relationships;
  if (
    prior?.frames !== state.frames ||
    prior.scopes !== state.scopes ||
    prior.objects !== state.objects
  ) {
    for (const frame of state.frames)
      algorithmAssert(equal(frame.scopeIds, scopes.byFrame.get(frame.id) ?? []));
    for (const scope of state.scopes) {
      algorithmAssert(frames.byId.has(scope.frameId));
      algorithmAssert(equal(scope.objectIds, objects.byScope.get(scope.id) ?? []));
      const names = scope.objectIds.map((key) => objects.byId.get(key)!.name);
      for (const alias of scope.aliases) {
        const target = objects.byId.get(alias.objectId);
        algorithmAssert(target?.kind === 'int-array');
        algorithmAssert(
          frames.positions.get(target.frameId)! < frames.positions.get(scope.frameId)!,
        );
        names.push(alias.name);
      }
      algorithmAssert(new Set(names).size === names.length);
    }
    for (const object of state.objects)
      algorithmAssert(scopes.byId.get(object.scopeId)?.frameId === object.frameId);
    cache.relationships = state;
  }
  algorithmAssert(state.control.activeFrameId === (state.frames.at(-1)?.id ?? null));
}

/** Applies only recorded deltas, in either direction; never evaluates source. */
export function projectAlgorithmStep(
  state: AlgorithmState,
  step: AlgorithmStep,
  backward = false,
): AlgorithmState {
  return projectStep(state, step, backward);
}

function writableTable<K extends 'frames' | 'scopes' | 'objects'>(
  next: AlgorithmState,
  state: AlgorithmState,
  table: K,
): AlgorithmState[K] {
  if (next[table] === state[table]) next[table] = state[table].slice() as AlgorithmState[K];
  return next[table];
}

function projectStep(
  state: AlgorithmState,
  step: AlgorithmStep,
  backward = false,
  reuseParsed = false,
): AlgorithmState {
  // Copy only touched records. Earlier states and checkpoint records remain
  // immutable; a deep copy of the whole live stack per delta is unnecessary.
  // Private validation can retain untouched immutable tables, allowing the
  // per-decode cache to recognize them. Public playback keeps distinct arrays.
  const next: AlgorithmState = reuseParsed
    ? { ...state }
    : {
        ...state,
        frames: [...state.frames],
        scopes: [...state.scopes],
        objects: [...state.objects],
      };
  const { changes } = step;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[backward ? changes.length - 1 - i : i];
    if (change.op === 'record') {
      const table: RecordValue[] = writableTable(next, state, change.table);
      const before = backward ? change.after : change.before;
      const after = backward ? change.before : change.after;
      algorithmAssert(
        change.index <= table.length &&
          (before === null
            ? !table.some((item) => item.id === change.id)
            : equal(table[change.index], before)),
      );
      if (before === null)
        table.splice(change.index, 0, reuseParsed ? after! : structuredClone(after!));
      else if (after === null) table.splice(change.index, 1);
      else table[change.index] = reuseParsed ? after : structuredClone(after);
    } else if (change.op === 'cell') {
      const objects = writableTable(next, state, 'objects');
      const position = objects.findIndex((item) => item.id === change.objectId);
      algorithmAssert(position >= 0);
      const previous = objects[position];
      const object = { ...previous, cells: [...previous.cells] };
      objects[position] = object;
      algorithmAssert(change.index < object.length);
      const before = backward ? change.after : change.before;
      const after = backward ? change.before : change.after;
      const at = object.cells.findIndex((cell) => cell.index === change.index);
      algorithmAssert((at < 0 ? object.defaultValue : object.cells[at].value) === before);
      if (at >= 0) object.cells.splice(at, 1);
      if (after !== object.defaultValue) {
        algorithmAssert(after !== null);
        object.cells.push({ index: change.index, value: after });
        object.cells.sort((a, b) => a.index - b.index);
      }
    } else if (change.op === 'output') {
      algorithmAssert(size(next.output) === (backward ? change.afterBytes : change.beforeBytes));
      if (backward) {
        algorithmAssert(next.output.endsWith(change.append));
        next.output = next.output.slice(0, next.output.length - change.append.length);
      } else next.output += change.append;
      algorithmAssert(size(next.output) === (backward ? change.beforeBytes : change.afterBytes));
    } else {
      const before = backward ? change.after : change.before;
      const after = backward ? change.before : change.after;
      algorithmAssert(equal(next[change.op], before));
      Object.assign(next, { [change.op]: reuseParsed ? after : structuredClone(after) });
    }
  }
  return next;
}

function validateChange(
  change: AlgorithmChange,
  nodes: Map<string, AlgorithmNode>,
  inputLength: number,
  cache: ValidationCache,
) {
  algorithmAssert(record(change));
  if (change.op === 'record') {
    keys(change, fields.recordChange);
    algorithmAssert(
      ['frames', 'scopes', 'objects'].includes(change.table) &&
        uint(change.index) &&
        (change.before !== null || change.after !== null),
    );
    // Projection compares every before value with the fully validated current
    // state, including all keys and nested values. Only the new after record
    // needs another shape check; keep the change identity check for deletions.
    if (change.before !== null)
      algorithmAssert(record(change.before) && change.before.id === change.id);
    if (change.after !== null) {
      validateRecord(change.table, change.after, nodes, cache);
      algorithmAssert(change.after.id === change.id);
    }
    if (change.before && change.after && change.table === 'objects') {
      const before = change.before as AlgorithmObject;
      const after = change.after as AlgorithmObject;
      for (const key of [
        'id',
        'declarationNodeId',
        'frameId',
        'scopeId',
        'name',
        'kind',
        'length',
        'baseAddress',
      ] as const)
        algorithmAssert(before[key] === after[key]);
    }
    if (change.before && change.after && change.table === 'frames') {
      const before = change.before as AlgorithmFrame,
        after = change.after as AlgorithmFrame;
      for (const key of [
        'id',
        'functionNodeId',
        'functionName',
        'parentFrameId',
        'callNodeId',
      ] as const)
        algorithmAssert(before[key] === after[key]);
    }
    if (change.before && change.after && change.table === 'scopes') {
      const before = change.before as AlgorithmScope,
        after = change.after as AlgorithmScope;
      for (const key of ['id', 'frameId', 'nodeId'] as const)
        algorithmAssert(before[key] === after[key]);
    }
  } else if (change.op === 'cell') {
    keys(change, fields.cellChange);
    algorithmAssert(
      id(change.objectId, 'o') &&
        uint(change.index) &&
        nullableInt(change.before) &&
        nullableInt(change.after),
    );
  } else if (change.op === 'output') {
    keys(change, fields.outputChange);
    algorithmAssert(
      uint(change.beforeBytes) &&
        uint(change.afterBytes) &&
        change.afterBytes <= 16384 &&
        typeof change.append === 'string' &&
        change.afterBytes === change.beforeBytes + size(change.append),
    );
  } else {
    algorithmAssert(['control', 'allocator', 'counters'].includes(change.op));
    keys(change, fields.singletonChange);
    validateSingleton(change.op, change.after, nodes, inputLength, cache);
  }
}

export async function decodeAlgorithmResult(
  buffer: ArrayBuffer,
  request: AlgorithmRequest,
  buildId: string,
  guard: () => void = () => {},
): Promise<AlgorithmResult> {
  try {
    guard();
    algorithmAssert(buffer.byteLength > 0 && buffer.byteLength <= 16777216);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const lexical = precheckJson(text);
    let sinceYield = performance.now();
    for (let check = lexical.next(); !check.done; check = lexical.next()) {
      guard();
      if (performance.now() - sinceYield >= 6) {
        await yieldAlgorithmTask();
        guard();
        sinceYield = performance.now();
      }
    }
    guard();
    const result = JSON.parse(text) as AlgorithmResult;
    // Private to one decode; immutable parsed records are reused by projection.
    // Cross-table references and allocator/control bounds remain state-specific.
    const cache: ValidationCache = {
      records: new WeakMap(),
      singletons: new WeakMap(),
      tables: new WeakMap(),
    };
    keys(result, [
      'execVersion',
      'dslVersion',
      'diagnosticVersion',
      'integerEncoding',
      'language',
      'engine',
      'identity',
      'nodeMap',
      'trace',
      'terminal',
      'stats',
    ]);
    algorithmAssert(
      result.execVersion === '1.2.0' &&
        result.dslVersion === '1.1.0' &&
        result.diagnosticVersion === '1.1.0' &&
        result.integerEncoding === '1.0.0' &&
        result.language === request.language,
    );
    keys(result.engine, ['id', 'version', 'buildId']);
    algorithmAssert(
      result.engine.id === 'engine.rust.p1' &&
        result.engine.version === '0.1.0' &&
        result.engine.buildId === buildId,
    );
    keys(result.identity, ['runId', 'sourceRevision']);
    algorithmAssert(
      result.identity.runId === request.runId &&
        result.identity.sourceRevision === request.sourceRevision,
    );
    const boundaries = new Set<number>([0]);
    let bytes = 0;
    let previousWasCR = false;
    for (const scalar of request.source) {
      if (previousWasCR && scalar === '\n') boundaries.delete(bytes);
      bytes += size(scalar);
      boundaries.add(bytes);
      previousWasCR = scalar === '\r';
    }
    const range = (value: unknown) => {
      keys(value, ['start', 'end']);
      algorithmAssert(
        uint(value.start) &&
          uint(value.end) &&
          value.start <= value.end &&
          boundaries.has(value.start) &&
          boundaries.has(value.end),
      );
    };
    algorithmAssert(Array.isArray(result.nodeMap) && result.nodeMap.length <= 32768);
    const nodes = new Map<string, AlgorithmNode>();
    for (const [index, node] of result.nodeMap.entries()) {
      keys(node, ['nodeId', 'kind', 'byteRange']);
      algorithmAssert(node.nodeId === `n${index + 1}` && nodeKinds.includes(node.kind));
      range(node.byteRange);
      nodes.set(node.nodeId, node);
    }
    keys(result.terminal, ['status', 'code', 'byteRange', 'cursor', 'returnValue']);
    algorithmAssert(
      ['completed', 'error', 'limited', 'cancelled'].includes(result.terminal.status),
    );
    algorithmAssert(result.terminal.code === null || errorCodes.includes(result.terminal.code));
    if (result.terminal.byteRange !== null) range(result.terminal.byteRange);
    algorithmAssert(uint(result.terminal.cursor) && nullableInt(result.terminal.returnValue));
    algorithmAssert((result.terminal.status === 'completed') === (result.terminal.code === null));
    algorithmAssert(
      (result.terminal.status === 'cancelled') === (result.terminal.code === 'E_CANCELLED'),
    );
    const limited =
      result.terminal.code !== null &&
      (result.terminal.code.endsWith('_LIMIT') || result.terminal.code === 'E_DEADLINE');
    algorithmAssert((result.terminal.status === 'limited') === limited);
    if (result.terminal.status === 'completed') algorithmAssert(result.terminal.byteRange === null);
    keys(result.stats, ['fuelUsed']);
    algorithmAssert(uint(result.stats.fuelUsed) && result.stats.fuelUsed <= 1000000);
    if (result.trace === null) {
      algorithmAssert(result.terminal.status !== 'completed' && result.terminal.cursor === 0);
      return result;
    }
    algorithmAssert(
      result.terminal.status !== 'cancelled' && result.terminal.code !== 'E_DEADLINE',
    );
    const trace = result.trace;
    keys(trace, ['dslVersion', 'completeness', 'initialState', 'steps', 'checkpoints']);
    algorithmAssert(
      trace.dslVersion === '1.1.0' &&
        trace.completeness === (result.terminal.status === 'completed' ? 'complete' : 'prefix'),
    );
    algorithmAssert(
      Array.isArray(trace.steps) &&
        trace.steps.length <= 20000 &&
        result.terminal.cursor === trace.steps.length &&
        Array.isArray(trace.checkpoints),
    );
    algorithmAssert(trace.checkpoints.length === Math.floor(trace.steps.length / 128) + 1);
    validateState(trace.initialState, nodes, request.input.length, cache);
    algorithmAssert(
      trace.initialState.frames.length === 0 &&
        trace.initialState.scopes.length === 0 &&
        trace.initialState.objects.length === 0 &&
        trace.initialState.output === '' &&
        trace.initialState.control.inputCursor === 0 &&
        trace.initialState.control.returnValue === null &&
        equal(trace.initialState.counters, {
          comparisons: 0,
          scalarWrites: 0,
          arrayWrites: 0,
          swaps: 0,
        }) &&
        equal(trace.initialState.allocator, {
          nextAddress: 4096,
          liveBytes: 0,
          nextObject: 1,
          nextScope: 1,
          nextFrame: 1,
        }),
    );
    let state = trace.initialState;
    for (let cursor = 0; cursor <= trace.steps.length; cursor++) {
      if (cursor % 128 === 0) {
        const checkpoint = trace.checkpoints[cursor / 128];
        keys(checkpoint, fields.checkpoint);
        algorithmAssert(checkpoint.cursor === cursor && equal(checkpoint.state, state));
      }
      if (cursor === trace.steps.length) break;
      if (cursor % 32 === 0) {
        guard();
        if (performance.now() - sinceYield >= 6) {
          await yieldAlgorithmTask();
          guard();
          sinceYield = performance.now();
        }
      }
      const step = trace.steps[cursor];
      keys(step, fields.step);
      algorithmAssert(
        step.seq === cursor + 1 &&
          stepKinds.includes(step.kind) &&
          nodes.has(step.nodeId) &&
          Array.isArray(step.changes),
      );
      for (const change of step.changes) validateChange(change, nodes, request.input.length, cache);
      const next = projectStep(state, step, false, true);
      validateState(next, nodes, request.input.length, cache);
      const count = next.frames.length - state.frames.length;
      algorithmAssert(
        count ===
          (['program.enter', 'function.enter'].includes(step.kind)
            ? 1
            : ['program.return', 'function.return'].includes(step.kind)
              ? -1
              : 0),
      );
      if (step.kind === 'program.enter')
        algorithmAssert(state.frames.length === 0 && next.frames[0].functionName === 'main');
      if (step.kind === 'program.return') algorithmAssert(next.frames.length === 0);
      for (const key of ['nextAddress', 'nextObject', 'nextScope', 'nextFrame'] as const)
        algorithmAssert(next.allocator[key] >= state.allocator[key]);
      for (const key of ['comparisons', 'scalarWrites', 'arrayWrites', 'swaps'] as const)
        algorithmAssert(next.counters[key] >= state.counters[key]);
      algorithmAssert(next.control.inputCursor >= state.control.inputCursor);
      algorithmAssert(equal(projectStep(next, step, true, true), state));
      state = next;
    }
    if (result.terminal.status === 'completed')
      algorithmAssert(
        result.terminal.returnValue === state.control.returnValue &&
          state.frames.length === 0 &&
          state.objects.length === 0 &&
          state.scopes.length === 0 &&
          state.allocator.liveBytes === 0,
      );
    else algorithmAssert(result.terminal.returnValue === null);
    guard();
    return result;
  } catch (error) {
    if (error instanceof Error && /^E_[A-Z_]+$/.test(error.message)) throw error;
    throw new Error('E_PROTOCOL_INVALID', { cause: error });
  }
}
