/** Explicit P1 memory protocol. This branch grants no learning authority. */
import { precheckJson } from './execution-json';

export interface MemoryRequest {
  execVersion: '1.3.0';
  dslVersion: '1.2.0';
  diagnosticVersion: '1.2.0';
  integerEncoding: '1.0.0';
  language: 'c' | 'cpp';
  engineId: 'engine.rust.memory';
  runId: string;
  sourceRevision: string;
  source: string;
  input: number[];
}
export interface MemoryNode {
  nodeId: string;
  kind: string;
  byteRange: { start: number; end: number };
}
export interface MemoryFrame {
  id: string;
  functionNodeId: string;
  functionName: string;
  parentFrameId: string | null;
  callNodeId: string | null;
  scopeIds: string[];
}
export interface MemoryScope {
  id: string;
  frameId: string;
  nodeId: string;
  objectIds: string[];
  aliases: { name: string; objectId: string }[];
}
export interface MemoryObject {
  id: string;
  declarationNodeId: string;
  frameId: string | null;
  scopeId: string | null;
  name: string;
  typeName: string;
  length: number;
  byteLength: number;
  baseAddress: number;
  storage: 'automatic' | 'heap';
  alive: boolean;
  zeroInitialized: boolean;
  cells: { byteOffset: number; value: MemoryValue }[];
}
export interface MemoryPointer {
  objectId: string | null;
  byteOffset: number;
  lowerBound: number;
  upperBound: number;
  pointeeType: string;
}
export type MemoryValue = number | MemoryPointer | null;
export interface MemoryType {
  name: string;
  kind: 'int' | 'pointer' | 'struct';
  byteSize: number;
  pointeeType: string | null;
  fields: { name: string; typeName: string; byteOffset: number }[];
}
export interface MemoryState {
  frames: MemoryFrame[];
  scopes: MemoryScope[];
  objects: MemoryObject[];
  control: {
    activeFrameId: string | null;
    nextNodeId: string | null;
    returnValue: MemoryValue;
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
type RecordValue = MemoryFrame | MemoryScope | MemoryObject;
export type MemoryChange =
  | {
      op: 'record';
      table: 'frames' | 'scopes' | 'objects';
      id: string;
      index: number;
      before: RecordValue | null;
      after: RecordValue | null;
    }
  | { op: 'cell'; objectId: string; byteOffset: number; before: MemoryValue; after: MemoryValue }
  | { op: 'control'; before: MemoryState['control']; after: MemoryState['control'] }
  | { op: 'allocator'; before: MemoryState['allocator']; after: MemoryState['allocator'] }
  | { op: 'counters'; before: MemoryState['counters']; after: MemoryState['counters'] }
  | { op: 'output'; beforeBytes: number; afterBytes: number; append: string };
export interface MemoryStep {
  seq: number;
  kind: string;
  nodeId: string;
  changes: MemoryChange[];
}
export interface MemoryTrace {
  dslVersion: '1.2.0';
  completeness: 'complete' | 'prefix';
  initialState: MemoryState;
  steps: MemoryStep[];
  checkpoints: { cursor: number; state: MemoryState }[];
}
export interface MemoryResult {
  execVersion: '1.3.0';
  dslVersion: '1.2.0';
  diagnosticVersion: '1.2.0';
  integerEncoding: '1.0.0';
  language: 'c' | 'cpp';
  engine: { id: 'engine.rust.memory'; version: '0.1.0'; buildId: string };
  identity: { runId: string; sourceRevision: string };
  nodeMap: MemoryNode[];
  types: MemoryType[];
  trace: MemoryTrace | null;
  terminal: {
    status: 'completed' | 'error' | 'limited' | 'cancelled';
    code: string | null;
    byteRange: { start: number; end: number } | null;
    cursor: number;
    returnValue: number | null;
  };
  stats: { fuelUsed: number };
}

export function memoryAssert(condition: unknown): asserts condition {
  if (!condition) throw new Error('E_PROTOCOL_INVALID');
}
const enc = new TextEncoder();
const size = (text: string) => enc.encode(text).length;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function keys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  memoryAssert(record(value));
  const actual = Object.keys(value);
  memoryAssert(actual.length === expected.length && expected.every((key) => key in value));
}
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
  'struct',
  'field',
  'delete',
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
  'memory.allocate',
  'memory.release',
  'pointer.write',
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
  'E_NULL_POINTER',
  'E_DANGLING_POINTER',
  'E_POINTER_BOUNDS',
  'E_INVALID_DELETE',
  'E_DOUBLE_DELETE',
  'E_OBJECT_LIMIT',
  'E_HEAP_LIMIT',
  'E_STRUCT_LIMIT',
  'E_FIELD_LIMIT',
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
type TypeMap = Map<string, MemoryType>;
interface ValidationCache {
  records: WeakMap<object, string>;
  singletons: WeakMap<object, string>;
  tables: WeakMap<object, string>;
}
function validateTypes(value: unknown): TypeMap {
  memoryAssert(Array.isArray(value) && value.length >= 1 && value.length <= 18);
  const types: TypeMap = new Map();
  for (const item of value) {
    keys(item, ['name', 'kind', 'byteSize', 'pointeeType', 'fields']);
    memoryAssert(
      typeof item.name === 'string' &&
        /^[A-Za-z_][A-Za-z0-9_]*\*?$/.test(item.name) &&
        !types.has(item.name) &&
        ['int', 'pointer', 'struct'].includes(item.kind as string) &&
        uint(item.byteSize) &&
        item.byteSize >= 4 &&
        item.byteSize <= 64 &&
        item.byteSize % 4 === 0 &&
        Array.isArray(item.fields),
    );
    types.set(item.name, item as unknown as MemoryType);
  }
  memoryAssert(types.get('int')?.kind === 'int');
  let structures = 0;
  for (const type of types.values()) {
    if (type.kind === 'int') {
      memoryAssert(
        type.name === 'int' &&
          type.byteSize === 4 &&
          type.pointeeType === null &&
          type.fields.length === 0,
      );
    } else if (type.kind === 'pointer') {
      const target = types.get(type.pointeeType ?? '');
      memoryAssert(
        target &&
          target.kind !== 'pointer' &&
          type.name === `${target.name}*` &&
          type.byteSize === 8 &&
          type.fields.length === 0,
      );
    } else {
      structures++;
      memoryAssert(
        name(type.name) &&
          type.name !== 'int' &&
          type.pointeeType === null &&
          type.fields.length >= 1 &&
          type.fields.length <= 8,
      );
      const names = new Set<string>();
      let offset = 0;
      for (const field of type.fields) {
        keys(field, ['name', 'typeName', 'byteOffset']);
        const fieldType =
          typeof field.typeName === 'string' ? types.get(field.typeName) : undefined;
        memoryAssert(
          name(field.name) &&
            !names.has(field.name) &&
            fieldType &&
            fieldType.kind !== 'struct' &&
            field.byteOffset === offset,
        );
        names.add(field.name);
        offset += fieldType.byteSize;
      }
      memoryAssert(type.byteSize === offset);
    }
  }
  memoryAssert(structures <= 8);
  return types;
}
function valueShape(value: unknown, types: TypeMap): asserts value is MemoryValue {
  if (value === null || int(value)) return;
  keys(value, ['objectId', 'byteOffset', 'lowerBound', 'upperBound', 'pointeeType']);
  memoryAssert(value.objectId === null || id(value.objectId, 'o'));
  memoryAssert(uint(value.byteOffset) && uint(value.lowerBound) && uint(value.upperBound));
  const target = typeof value.pointeeType === 'string' ? types.get(value.pointeeType) : undefined;
  memoryAssert(target && target.kind !== 'pointer');
  if (value.objectId === null)
    memoryAssert(value.byteOffset === 0 && value.lowerBound === 0 && value.upperBound === 0);
  else
    memoryAssert(
      value.lowerBound <= value.byteOffset &&
        value.byteOffset <= value.upperBound &&
        value.lowerBound < value.upperBound &&
        (value.byteOffset - value.lowerBound) % target.byteSize === 0,
    );
}
function cellType(object: MemoryObject, byteOffset: number, types: TypeMap): MemoryType {
  const type = types.get(object.typeName);
  memoryAssert(type && uint(byteOffset) && byteOffset < object.byteLength);
  const relative = byteOffset % type.byteSize;
  if (type.kind !== 'struct') {
    memoryAssert(relative === 0);
    return type;
  }
  const field = type.fields.find((item) => item.byteOffset === relative);
  memoryAssert(field);
  const result = types.get(field.typeName);
  memoryAssert(result && result.kind !== 'struct');
  return result;
}
function defaultCell(object: MemoryObject, byteOffset: number, types: TypeMap): MemoryValue {
  const type = cellType(object, byteOffset, types);
  if (!object.zeroInitialized) return null;
  return type.kind === 'int'
    ? 0
    : {
        objectId: null,
        byteOffset: 0,
        lowerBound: 0,
        upperBound: 0,
        pointeeType: type.pointeeType!,
      };
}
function valueType(value: MemoryValue, type: MemoryType, types: TypeMap) {
  valueShape(value, types);
  memoryAssert(
    value === null ||
      (type.kind === 'int'
        ? typeof value === 'number'
        : typeof value === 'object' && value.pointeeType === type.pointeeType),
  );
}
function pointerTarget(pointer: MemoryPointer, objects: Map<string, MemoryObject>, types: TypeMap) {
  if (pointer.objectId === null) return;
  const object = objects.get(pointer.objectId);
  memoryAssert(object && pointer.upperBound <= object.byteLength);
  if (object.typeName === pointer.pointeeType) {
    memoryAssert(pointer.lowerBound === 0 && pointer.upperBound === object.byteLength);
    return;
  }
  const type = types.get(object.typeName)!;
  memoryAssert(type.kind === 'struct');
  const element = Math.floor(pointer.lowerBound / type.byteSize) * type.byteSize;
  const field = type.fields.find(
    (item) =>
      item.byteOffset === pointer.lowerBound - element && item.typeName === pointer.pointeeType,
  );
  memoryAssert(
    field && pointer.upperBound === pointer.lowerBound + types.get(field.typeName)!.byteSize,
  );
}
function ids(value: unknown, prefix: string): asserts value is string[] {
  memoryAssert(
    Array.isArray(value) &&
      value.every((item) => id(item, prefix)) &&
      new Set(value).size === value.length,
  );
}
export function canonicalMemoryJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalMemoryJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalMemoryJson(object[key])}`)
    .join(',')}}`;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  if (!record(a) || !record(b)) return false;
  const aKeys = Object.keys(a);
  return (
    aKeys.length === Object.keys(b).length &&
    aKeys.every((key) => key in b && equal(a[key], b[key]))
  );
}
function yieldMemoryTask(): Promise<void> {
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
export function encodeMemoryRequest(request: MemoryRequest): Uint8Array<ArrayBuffer> {
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
  memoryAssert(
    request.execVersion === '1.3.0' &&
      request.dslVersion === '1.2.0' &&
      request.diagnosticVersion === '1.2.0' &&
      request.integerEncoding === '1.0.0',
  );
  memoryAssert(request.language === 'c' || request.language === 'cpp');
  memoryAssert(
    request.engineId === 'engine.rust.memory' && id(request.runId) && id(request.sourceRevision),
  );
  memoryAssert(typeof request.source === 'string' && size(request.source) <= 32768);
  for (const scalar of request.source) {
    const code = scalar.codePointAt(0)!;
    memoryAssert(code < 0xd800 || code > 0xdfff);
  }
  memoryAssert(
    Array.isArray(request.input) &&
      request.input.length <= 30 &&
      request.input.every((value) => int(value) && value >= -999 && value <= 999),
  );
  const bytes = enc.encode(canonicalMemoryJson(request));
  memoryAssert(bytes.length <= 65536);
  return bytes;
}

function validateRecord(
  table: string,
  value: unknown,
  nodes: Map<string, MemoryNode>,
  types: TypeMap,
  cache?: ValidationCache,
) {
  if (record(value) && cache?.records.get(value) === table) return;
  if (table === 'frames') {
    keys(value, [
      'id',
      'functionNodeId',
      'functionName',
      'parentFrameId',
      'callNodeId',
      'scopeIds',
    ]);
    memoryAssert(id(value.id, 'f') && name(value.functionName));
    memoryAssert(
      typeof value.functionNodeId === 'string' &&
        nodes.get(value.functionNodeId)?.kind === 'function',
    );
    memoryAssert(value.parentFrameId === null || id(value.parentFrameId, 'f'));
    memoryAssert(
      value.callNodeId === null ||
        (typeof value.callNodeId === 'string' && nodes.get(value.callNodeId)?.kind === 'call'),
    );
    ids(value.scopeIds, 's');
  } else if (table === 'scopes') {
    keys(value, ['id', 'frameId', 'nodeId', 'objectIds', 'aliases']);
    memoryAssert(
      id(value.id, 's') &&
        id(value.frameId, 'f') &&
        typeof value.nodeId === 'string' &&
        nodes.has(value.nodeId),
    );
    ids(value.objectIds, 'o');
    memoryAssert(['block', 'for'].includes(nodes.get(value.nodeId as string)!.kind));
    memoryAssert(Array.isArray(value.aliases) && value.aliases.length <= 8);
    for (const alias of value.aliases) {
      keys(alias, ['name', 'objectId']);
      memoryAssert(name(alias.name) && id(alias.objectId, 'o'));
    }
    memoryAssert(
      new Set(value.aliases.map((alias) => (alias as { name: string }).name)).size ===
        value.aliases.length,
    );
  } else {
    memoryAssert(table === 'objects');
    keys(value, [
      'id',
      'declarationNodeId',
      'frameId',
      'scopeId',
      'name',
      'typeName',
      'length',
      'byteLength',
      'baseAddress',
      'storage',
      'alive',
      'zeroInitialized',
      'cells',
    ]);
    memoryAssert(
      id(value.id, 'o') &&
        name(value.name) &&
        (value.storage === 'automatic'
          ? id(value.frameId, 'f') && id(value.scopeId, 's')
          : value.storage === 'heap' && value.frameId === null && value.scopeId === null),
    );
    memoryAssert(typeof value.declarationNodeId === 'string' && nodes.has(value.declarationNodeId));
    memoryAssert(
      (value.storage === 'heap' ? ['expression'] : ['declaration', 'parameter']).includes(
        nodes.get(value.declarationNodeId)!.kind,
      ),
    );
    const type = typeof value.typeName === 'string' ? types.get(value.typeName) : undefined;
    memoryAssert(type);
    memoryAssert(value.storage !== 'heap' || type.kind !== 'pointer');
    memoryAssert(
      uint(value.length) &&
        value.length >= 1 &&
        value.length <= 262144 &&
        uint(value.byteLength) &&
        value.byteLength === value.length * type.byteSize &&
        value.byteLength <= 1048576 &&
        (value.storage !== 'heap' || value.length === 1),
    );
    memoryAssert(
      uint(value.baseAddress) &&
        value.baseAddress >= 4096 &&
        value.baseAddress % 4 === 0 &&
        typeof value.alive === 'boolean' &&
        typeof value.zeroInitialized === 'boolean',
    );
    memoryAssert(
      Array.isArray(value.cells) &&
        value.cells.length <= value.byteLength / 4 &&
        (value.alive || value.cells.length === 0),
    );
    let previous = -1;
    for (const cell of value.cells) {
      keys(cell, ['byteOffset', 'value']);
      memoryAssert(uint(cell.byteOffset) && cell.byteOffset > previous);
      const object = value as unknown as MemoryObject;
      valueType(cell.value as MemoryValue, cellType(object, cell.byteOffset, types), types);
      memoryAssert(!equal(cell.value, defaultCell(object, cell.byteOffset, types)));
      previous = cell.byteOffset;
    }
  }
  if (record(value)) cache?.records.set(value, table);
}
function validateSingleton(
  op: string,
  value: unknown,
  nodes: Map<string, MemoryNode>,
  inputLength: number,
  types: TypeMap,
  cache?: ValidationCache,
) {
  if (record(value) && cache?.singletons.get(value) === op) return;
  if (op === 'control') {
    keys(value, ['activeFrameId', 'nextNodeId', 'returnValue', 'inputCursor']);
    memoryAssert(value.activeFrameId === null || id(value.activeFrameId, 'f'));
    memoryAssert(
      value.nextNodeId === null ||
        (typeof value.nextNodeId === 'string' && nodes.has(value.nextNodeId)),
    );
    memoryAssert(uint(value.inputCursor) && value.inputCursor <= inputLength);
    valueShape(value.returnValue, types);
  } else if (op === 'allocator') {
    keys(value, ['nextAddress', 'liveBytes', 'nextObject', 'nextScope', 'nextFrame']);
    memoryAssert(
      uint(value.nextAddress) && value.nextAddress >= 4096 && value.nextAddress % 4 === 0,
    );
    memoryAssert(uint(value.liveBytes) && value.liveBytes <= 1048576 && value.liveBytes % 4 === 0);
    for (const key of ['nextObject', 'nextScope', 'nextFrame'])
      memoryAssert(uint(value[key]) && value[key] > 0);
  } else {
    memoryAssert(op === 'counters');
    keys(value, ['comparisons', 'scalarWrites', 'arrayWrites', 'swaps']);
    memoryAssert(Object.values(value).every(uint));
  }
  if (record(value)) cache?.singletons.set(value, op);
}
function validateState(
  state: MemoryState,
  nodes: Map<string, MemoryNode>,
  inputLength: number,
  types: TypeMap,
  cache?: ValidationCache,
) {
  keys(state, ['frames', 'scopes', 'objects', 'control', 'allocator', 'output', 'counters']);
  memoryAssert(
    Array.isArray(state.frames) &&
      state.frames.length <= 32 &&
      Array.isArray(state.scopes) &&
      Array.isArray(state.objects) &&
      state.objects.length <= 4096,
  );
  for (const table of ['frames', 'scopes', 'objects'] as const) {
    const rows = state[table];
    if (cache?.tables.get(rows) !== table) {
      for (const item of rows) validateRecord(table, item, nodes, types, cache);
      memoryAssert(new Set(rows.map((item) => item.id)).size === rows.length);
      cache?.tables.set(rows, table);
    }
  }
  for (const op of ['control', 'allocator', 'counters'] as const)
    validateSingleton(op, state[op], nodes, inputLength, types, cache);
  memoryAssert(typeof state.output === 'string' && size(state.output) <= 16384);
  const frames = new Map(state.frames.map((frame) => [frame.id, frame]));
  const framePositions = new Map(state.frames.map((frame, index) => [frame.id, index]));
  const scopes = new Map(state.scopes.map((scope) => [scope.id, scope]));
  const objects = new Map(state.objects.map((object) => [object.id, object]));
  const scopeIdsByFrame = new Map<string, string[]>();
  const objectIdsByScope = new Map<string, string[]>();
  for (const scope of state.scopes) {
    const list = scopeIdsByFrame.get(scope.frameId) ?? [];
    list.push(scope.id);
    scopeIdsByFrame.set(scope.frameId, list);
  }
  for (const object of state.objects) {
    if (!object.alive || object.storage !== 'automatic') continue;
    const list = objectIdsByScope.get(object.scopeId!) ?? [];
    list.push(object.id);
    objectIdsByScope.set(object.scopeId!, list);
  }
  let liveBytes = 0;
  for (const [i, frame] of state.frames.entries()) {
    memoryAssert(frame.parentFrameId === (i ? state.frames[i - 1].id : null));
    memoryAssert((i === 0) === (frame.callNodeId === null));
    memoryAssert(Number(frame.id.slice(1)) < state.allocator.nextFrame);
    memoryAssert(equal(frame.scopeIds, scopeIdsByFrame.get(frame.id) ?? []));
  }
  for (const scope of state.scopes) {
    memoryAssert(
      frames.has(scope.frameId) && Number(scope.id.slice(1)) < state.allocator.nextScope,
    );
    memoryAssert(equal(scope.objectIds, objectIdsByScope.get(scope.id) ?? []));
    const names = scope.objectIds.map((key) => objects.get(key)!.name);
    for (const alias of scope.aliases) {
      const target = objects.get(alias.objectId);
      memoryAssert(target?.alive && target.storage === 'automatic');
      memoryAssert(framePositions.get(target.frameId!)! < framePositions.get(scope.frameId)!);
      names.push(alias.name);
    }
    memoryAssert(new Set(names).size === names.length);
  }
  const addresses = [...state.objects].sort((a, b) => a.baseAddress - b.baseAddress);
  memoryAssert(state.allocator.nextObject === state.objects.length + 1);
  for (const [index, object] of state.objects.entries())
    memoryAssert(object.id === `o${index + 1}`);
  let end = 4096;
  let heap = 0;
  for (const object of addresses) {
    memoryAssert(Number(object.id.slice(1)) < state.allocator.nextObject);
    if (object.alive && object.storage === 'automatic')
      memoryAssert(scopes.get(object.scopeId!)?.frameId === object.frameId);
    memoryAssert(object.baseAddress >= end);
    end = object.baseAddress + object.byteLength;
    memoryAssert(Number.isSafeInteger(end) && end <= state.allocator.nextAddress);
    if (object.alive) {
      liveBytes += object.byteLength;
      if (object.storage === 'heap') heap++;
    }
    for (const cell of object.cells)
      if (cell.value !== null && typeof cell.value === 'object')
        pointerTarget(cell.value, objects, types);
  }
  memoryAssert(heap <= 128);
  if (state.control.returnValue !== null && typeof state.control.returnValue === 'object')
    pointerTarget(state.control.returnValue, objects, types);
  memoryAssert(liveBytes === state.allocator.liveBytes);
  memoryAssert(state.control.activeFrameId === (state.frames.at(-1)?.id ?? null));
}

/** Applies only recorded deltas, in either direction; never evaluates source. */
export function projectMemoryStep(
  state: MemoryState,
  step: MemoryStep,
  typeDefinitions: MemoryType[],
  backward = false,
): MemoryState {
  const types = new Map(typeDefinitions.map((type) => [type.name, type]));
  return projectStep(state, step, types, backward);
}
function projectStep(
  state: MemoryState,
  step: MemoryStep,
  types: TypeMap,
  backward = false,
  reuseParsed = false,
): MemoryState {
  // Copy only touched records. Earlier states and checkpoint records remain
  // immutable; a deep copy of the whole live stack per delta is unnecessary.
  const next: MemoryState = { ...state };
  const writable = (table: 'frames' | 'scopes' | 'objects'): RecordValue[] => {
    if (next[table] === state[table]) Object.assign(next, { [table]: [...state[table]] });
    return next[table];
  };
  const changes = backward ? [...step.changes].reverse() : step.changes;
  for (const change of changes) {
    if (change.op === 'record') {
      const table = writable(change.table);
      const before = backward ? change.after : change.before;
      const after = backward ? change.before : change.after;
      memoryAssert(
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
      writable('objects');
      const position = next.objects.findIndex((item) => item.id === change.objectId);
      memoryAssert(position >= 0);
      const previous = next.objects[position];
      const object = { ...previous, cells: [...previous.cells] };
      next.objects[position] = object;
      memoryAssert(object.alive);
      const type = cellType(object, change.byteOffset, types);
      const before = backward ? change.after : change.before;
      const after = backward ? change.before : change.after;
      const at = object.cells.findIndex((cell) => cell.byteOffset === change.byteOffset);
      memoryAssert(
        equal(
          at < 0 ? defaultCell(object, change.byteOffset, types) : object.cells[at].value,
          before,
        ),
      );
      valueType(after, type, types);
      if (at >= 0) object.cells.splice(at, 1);
      if (!equal(after, defaultCell(object, change.byteOffset, types))) {
        object.cells.push({
          byteOffset: change.byteOffset,
          value: reuseParsed ? after : structuredClone(after),
        });
        object.cells.sort((a, b) => a.byteOffset - b.byteOffset);
      }
    } else if (change.op === 'output') {
      memoryAssert(size(next.output) === (backward ? change.afterBytes : change.beforeBytes));
      if (backward) {
        memoryAssert(next.output.endsWith(change.append));
        next.output = next.output.slice(0, next.output.length - change.append.length);
      } else next.output += change.append;
      memoryAssert(size(next.output) === (backward ? change.beforeBytes : change.afterBytes));
    } else {
      const before = backward ? change.after : change.before;
      const after = backward ? change.before : change.after;
      memoryAssert(equal(next[change.op], before));
      Object.assign(next, { [change.op]: reuseParsed ? after : structuredClone(after) });
    }
  }
  return next;
}

function validateChange(
  change: MemoryChange,
  nodes: Map<string, MemoryNode>,
  inputLength: number,
  types: TypeMap,
  cache?: ValidationCache,
) {
  memoryAssert(record(change));
  if (change.op === 'record') {
    keys(change, ['op', 'table', 'id', 'index', 'before', 'after']);
    memoryAssert(
      ['frames', 'scopes', 'objects'].includes(change.table) &&
        uint(change.index) &&
        (change.before !== null || change.after !== null),
    );
    for (const item of [change.before, change.after])
      if (item !== null) {
        validateRecord(change.table, item, nodes, types, cache);
        memoryAssert(item.id === change.id);
      }
    if (change.before && change.after && change.table === 'objects') {
      const before = change.before as MemoryObject;
      const after = change.after as MemoryObject;
      for (const key of [
        'id',
        'declarationNodeId',
        'frameId',
        'scopeId',
        'name',
        'typeName',
        'length',
        'byteLength',
        'baseAddress',
        'storage',
      ] as const)
        memoryAssert(before[key] === after[key]);
      memoryAssert(before.alive && (after.alive || after.cells.length === 0));
    }
    if (change.table === 'objects') {
      memoryAssert(change.after !== null);
      if (change.before === null) memoryAssert((change.after as MemoryObject).alive);
    }
    if (change.before && change.after && change.table === 'frames') {
      const before = change.before as MemoryFrame,
        after = change.after as MemoryFrame;
      for (const key of [
        'id',
        'functionNodeId',
        'functionName',
        'parentFrameId',
        'callNodeId',
      ] as const)
        memoryAssert(before[key] === after[key]);
    }
    if (change.before && change.after && change.table === 'scopes') {
      const before = change.before as MemoryScope,
        after = change.after as MemoryScope;
      for (const key of ['id', 'frameId', 'nodeId'] as const)
        memoryAssert(before[key] === after[key]);
    }
  } else if (change.op === 'cell') {
    keys(change, ['op', 'objectId', 'byteOffset', 'before', 'after']);
    memoryAssert(id(change.objectId, 'o') && uint(change.byteOffset));
    valueShape(change.before, types);
    valueShape(change.after, types);
  } else if (change.op === 'output') {
    keys(change, ['op', 'beforeBytes', 'afterBytes', 'append']);
    memoryAssert(
      uint(change.beforeBytes) &&
        uint(change.afterBytes) &&
        change.afterBytes <= 16384 &&
        typeof change.append === 'string' &&
        change.afterBytes === change.beforeBytes + size(change.append),
    );
  } else {
    memoryAssert(['control', 'allocator', 'counters'].includes(change.op));
    keys(change, ['op', 'before', 'after']);
    validateSingleton(change.op, change.before, nodes, inputLength, types, cache);
    validateSingleton(change.op, change.after, nodes, inputLength, types, cache);
  }
}

export async function decodeMemoryResult(
  buffer: ArrayBuffer,
  request: MemoryRequest,
  buildId: string,
  guard: () => void = () => {},
): Promise<MemoryResult> {
  try {
    guard();
    memoryAssert(buffer.byteLength > 0 && buffer.byteLength <= 16777216);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const lexical = precheckJson(text);
    let sinceYield = performance.now();
    for (let check = lexical.next(); !check.done; check = lexical.next()) {
      guard();
      if (performance.now() - sinceYield >= 6) {
        await yieldMemoryTask();
        guard();
        sinceYield = performance.now();
      }
    }
    guard();
    const result = JSON.parse(text) as MemoryResult;
    // Parsed records are private until this decode finishes. Projection uses
    // copy-on-write, so a record already checked in this decode never changes.
    // Keep the cache local: callers may mutate a previously returned packet.
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
      'types',
      'trace',
      'terminal',
      'stats',
    ]);
    memoryAssert(
      result.execVersion === '1.3.0' &&
        result.dslVersion === '1.2.0' &&
        result.diagnosticVersion === '1.2.0' &&
        result.integerEncoding === '1.0.0' &&
        result.language === request.language,
    );
    const types =
      result.trace === null && Array.isArray(result.types) && result.types.length === 0
        ? new Map<string, MemoryType>()
        : validateTypes(result.types);
    keys(result.engine, ['id', 'version', 'buildId']);
    memoryAssert(
      result.engine.id === 'engine.rust.memory' &&
        result.engine.version === '0.1.0' &&
        result.engine.buildId === buildId,
    );
    keys(result.identity, ['runId', 'sourceRevision']);
    memoryAssert(
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
      memoryAssert(
        uint(value.start) &&
          uint(value.end) &&
          value.start <= value.end &&
          boundaries.has(value.start) &&
          boundaries.has(value.end),
      );
    };
    memoryAssert(Array.isArray(result.nodeMap) && result.nodeMap.length <= 32768);
    const nodes = new Map<string, MemoryNode>();
    for (const [index, node] of result.nodeMap.entries()) {
      keys(node, ['nodeId', 'kind', 'byteRange']);
      memoryAssert(node.nodeId === `n${index + 1}` && nodeKinds.includes(node.kind));
      range(node.byteRange);
      nodes.set(node.nodeId, node);
    }
    keys(result.terminal, ['status', 'code', 'byteRange', 'cursor', 'returnValue']);
    memoryAssert(['completed', 'error', 'limited', 'cancelled'].includes(result.terminal.status));
    memoryAssert(result.terminal.code === null || errorCodes.includes(result.terminal.code));
    if (result.terminal.byteRange !== null) range(result.terminal.byteRange);
    memoryAssert(uint(result.terminal.cursor) && nullableInt(result.terminal.returnValue));
    memoryAssert((result.terminal.status === 'completed') === (result.terminal.code === null));
    memoryAssert(
      (result.terminal.status === 'cancelled') === (result.terminal.code === 'E_CANCELLED'),
    );
    const limited =
      result.terminal.code !== null &&
      (result.terminal.code.endsWith('_LIMIT') || result.terminal.code === 'E_DEADLINE');
    memoryAssert((result.terminal.status === 'limited') === limited);
    if (result.terminal.status === 'completed') memoryAssert(result.terminal.byteRange === null);
    keys(result.stats, ['fuelUsed']);
    memoryAssert(uint(result.stats.fuelUsed) && result.stats.fuelUsed <= 1000000);
    memoryAssert(result.terminal.status !== 'cancelled' && result.terminal.code !== 'E_DEADLINE');
    if (result.trace === null) {
      memoryAssert(result.terminal.status !== 'completed' && result.terminal.cursor === 0);
      return result;
    }
    const trace = result.trace;
    keys(trace, ['dslVersion', 'completeness', 'initialState', 'steps', 'checkpoints']);
    memoryAssert(
      trace.dslVersion === '1.2.0' &&
        trace.completeness === (result.terminal.status === 'completed' ? 'complete' : 'prefix'),
    );
    memoryAssert(
      Array.isArray(trace.steps) &&
        trace.steps.length <= 20000 &&
        result.terminal.cursor === trace.steps.length &&
        Array.isArray(trace.checkpoints),
    );
    memoryAssert(trace.checkpoints.length === Math.floor(trace.steps.length / 128) + 1);
    validateState(trace.initialState, nodes, request.input.length, types, cache);
    memoryAssert(
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
        keys(checkpoint, ['cursor', 'state']);
        memoryAssert(checkpoint.cursor === cursor && equal(checkpoint.state, state));
      }
      if (cursor === trace.steps.length) break;
      if (cursor % 32 === 0) {
        guard();
        if (performance.now() - sinceYield >= 6) {
          await yieldMemoryTask();
          guard();
          sinceYield = performance.now();
        }
      }
      const step = trace.steps[cursor];
      keys(step, ['seq', 'kind', 'nodeId', 'changes']);
      memoryAssert(
        step.seq === cursor + 1 &&
          stepKinds.includes(step.kind) &&
          nodes.has(step.nodeId) &&
          Array.isArray(step.changes),
      );
      const records = new Set<string>();
      const cells = new Map<string, Set<number>>();
      const singletons = new Set<string>();
      for (const change of step.changes) {
        validateChange(change, nodes, request.input.length, types, cache);
        // A producer diff has one final change per target. Disallow hidden
        // intermediate writes which could otherwise disappear before state
        // provenance validation, including record/cell overlap on one object.
        if (change.op === 'record') {
          const key = `${change.table}:${change.id}`;
          memoryAssert(!records.has(key));
          memoryAssert(change.table !== 'objects' || !cells.has(change.id));
          records.add(key);
        } else if (change.op === 'cell') {
          const offsets = cells.get(change.objectId) ?? new Set<number>();
          memoryAssert(
            !offsets.has(change.byteOffset) && !records.has(`objects:${change.objectId}`),
          );
          offsets.add(change.byteOffset);
          cells.set(change.objectId, offsets);
        } else {
          memoryAssert(!singletons.has(change.op));
          singletons.add(change.op);
        }
      }
      // These parsed records remain private for this decode. Projection never
      // mutates them; public playback keeps the default deep-copy boundary.
      const next = projectStep(state, step, types, false, true);
      validateState(next, nodes, request.input.length, types, cache);
      const count = next.frames.length - state.frames.length;
      memoryAssert(
        count ===
          (['program.enter', 'function.enter'].includes(step.kind)
            ? 1
            : ['program.return', 'function.return'].includes(step.kind)
              ? -1
              : 0),
      );
      if (step.kind === 'program.enter')
        memoryAssert(state.frames.length === 0 && next.frames[0].functionName === 'main');
      if (step.kind === 'program.return') memoryAssert(next.frames.length === 0);
      for (const key of ['nextAddress', 'nextObject', 'nextScope', 'nextFrame'] as const)
        memoryAssert(next.allocator[key] >= state.allocator[key]);
      for (const key of ['comparisons', 'scalarWrites', 'arrayWrites', 'swaps'] as const)
        memoryAssert(next.counters[key] >= state.counters[key]);
      memoryAssert(next.control.inputCursor >= state.control.inputCursor);
      memoryAssert(equal(projectStep(next, step, types, true, true), state));
      state = next;
    }
    if (result.terminal.status === 'completed')
      memoryAssert(
        result.terminal.returnValue === state.control.returnValue &&
          state.frames.length === 0 &&
          state.objects.every((object) => !object.alive || object.storage === 'heap') &&
          state.scopes.length === 0 &&
          state.allocator.liveBytes ===
            state.objects
              .filter((object) => object.alive)
              .reduce((sum, object) => sum + object.byteLength, 0),
      );
    else memoryAssert(result.terminal.returnValue === null);
    guard();
    return result;
  } catch (error) {
    if (error instanceof Error && /^E_[A-Z_]+$/.test(error.message)) throw error;
    throw new Error('E_PROTOCOL_INVALID', { cause: error });
  }
}
