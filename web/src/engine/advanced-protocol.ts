/** Explicit P1 advanced protocol. This branch grants no learning authority. */
import { precheckJson } from './execution-json';

export interface AdvancedRequest {
  execVersion: '1.4.0';
  dslVersion: '1.3.0';
  diagnosticVersion: '1.3.0';
  integerEncoding: '1.0.0';
  language: 'c' | 'cpp';
  engineId: 'engine.rust.advanced';
  runId: string;
  sourceRevision: string;
  source: string;
  input: { kind: 'integers'; values: number[] } | { kind: 'lines'; values: string[] };
}
export interface AdvancedNode {
  nodeId: string;
  kind: string;
  byteRange: { start: number; end: number };
}
export interface AdvancedFrame {
  id: string;
  functionNodeId: string;
  functionName: string;
  parentFrameId: string | null;
  callNodeId: string | null;
  scopeIds: string[];
}
export interface AdvancedScope {
  id: string;
  frameId: string;
  nodeId: string;
  objectIds: string[];
  aliases: { name: string; objectId: string }[];
}
export interface AdvancedObject {
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
  cells: { byteOffset: number; value: AdvancedValue }[];
}
export interface AdvancedPointer {
  objectId: string | null;
  byteOffset: number;
  lowerBound: number;
  upperBound: number;
  pointeeType: string;
}
export type AdvancedValue = number | string | AdvancedPointer | null;
export interface AdvancedType {
  name: string;
  kind: 'int' | 'pointer' | 'struct' | 'string';
  byteSize: number;
  pointeeType: string | null;
  fields: { name: string; typeName: string; byteOffset: number }[];
}
export interface AdvancedState {
  frames: AdvancedFrame[];
  scopes: AdvancedScope[];
  objects: AdvancedObject[];
  control: {
    activeFrameId: string | null;
    nextNodeId: string | null;
    returnValue: AdvancedValue;
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
type RecordValue = AdvancedFrame | AdvancedScope | AdvancedObject;
export type AdvancedChange =
  | {
      op: 'record';
      table: 'frames' | 'scopes' | 'objects';
      id: string;
      index: number;
      before: RecordValue | null;
      after: RecordValue | null;
    }
  | {
      op: 'cell';
      objectId: string;
      byteOffset: number;
      before: AdvancedValue;
      after: AdvancedValue;
    }
  | { op: 'control'; before: AdvancedState['control']; after: AdvancedState['control'] }
  | { op: 'allocator'; before: AdvancedState['allocator']; after: AdvancedState['allocator'] }
  | { op: 'counters'; before: AdvancedState['counters']; after: AdvancedState['counters'] }
  | { op: 'output'; beforeBytes: number; afterBytes: number; append: string };
export interface AdvancedStep {
  seq: number;
  kind: string;
  nodeId: string;
  changes: AdvancedChange[];
}
export interface AdvancedTrace {
  dslVersion: '1.3.0';
  completeness: 'complete' | 'prefix';
  initialState: AdvancedState;
  steps: AdvancedStep[];
  checkpoints: { cursor: number; state: AdvancedState }[];
}
export interface AdvancedResult {
  execVersion: '1.4.0';
  dslVersion: '1.3.0';
  diagnosticVersion: '1.3.0';
  integerEncoding: '1.0.0';
  language: 'c' | 'cpp';
  engine: { id: 'engine.rust.advanced'; version: '0.1.0'; buildId: string };
  identity: { runId: string; sourceRevision: string };
  nodeMap: AdvancedNode[];
  types: AdvancedType[];
  trace: AdvancedTrace | null;
  terminal: {
    status: 'completed' | 'error' | 'limited' | 'cancelled';
    code: string | null;
    byteRange: { start: number; end: number } | null;
    cursor: number;
    returnValue: number | null;
  };
  stats: { fuelUsed: number };
}

export function advancedAssert(condition: unknown): asserts condition {
  if (!condition) throw new Error('E_PROTOCOL_INVALID');
}
const enc = new TextEncoder();
const size = (text: string) => enc.encode(text).length;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function keys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  advancedAssert(record(value));
  const actual = Object.keys(value);
  advancedAssert(actual.length === expected.length && expected.every((key) => key in value));
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
  'advanced.allocate',
  'advanced.release',
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
  'E_INPUT_KIND',
  'E_STRING_BOUNDS',
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
type TypeMap = Map<string, AdvancedType>;
interface ValidationCache {
  records: WeakMap<object, string>;
  singletons: WeakMap<object, string>;
  tables: WeakMap<object, string>;
}
function validateTypes(value: unknown): TypeMap {
  advancedAssert(Array.isArray(value) && value.length >= 1 && value.length <= 19);
  const types: TypeMap = new Map();
  for (const item of value) {
    keys(item, ['name', 'kind', 'byteSize', 'pointeeType', 'fields']);
    advancedAssert(
      typeof item.name === 'string' &&
        /^[A-Za-z_][A-Za-z0-9_]*\*?$/.test(item.name) &&
        !types.has(item.name) &&
        ['int', 'pointer', 'struct', 'string'].includes(item.kind as string) &&
        uint(item.byteSize) &&
        item.byteSize >= 4 &&
        item.byteSize <= 64 &&
        item.byteSize % 4 === 0 &&
        Array.isArray(item.fields),
    );
    types.set(item.name, item as unknown as AdvancedType);
  }
  advancedAssert(types.get('int')?.kind === 'int');
  let structures = 0;
  for (const type of types.values()) {
    if (type.kind === 'int') {
      advancedAssert(
        type.name === 'int' &&
          type.byteSize === 4 &&
          type.pointeeType === null &&
          type.fields.length === 0,
      );
    } else if (type.kind === 'string') {
      advancedAssert(
        type.name === 'string' &&
          type.byteSize === 32 &&
          type.pointeeType === null &&
          type.fields.length === 0,
      );
    } else if (type.kind === 'pointer') {
      const target = types.get(type.pointeeType ?? '');
      advancedAssert(
        target &&
          target.kind !== 'pointer' &&
          target.kind !== 'string' &&
          type.name === `${target.name}*` &&
          type.byteSize === 8 &&
          type.fields.length === 0,
      );
    } else {
      structures++;
      advancedAssert(
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
        advancedAssert(
          name(field.name) &&
            !names.has(field.name) &&
            fieldType &&
            fieldType.kind !== 'struct' &&
            fieldType.kind !== 'string' &&
            field.byteOffset === offset,
        );
        names.add(field.name);
        offset += fieldType.byteSize;
      }
      advancedAssert(type.byteSize === offset);
    }
  }
  advancedAssert(structures <= 8);
  return types;
}
function valueShape(value: unknown, types: TypeMap): asserts value is AdvancedValue {
  if (value === null || int(value)) return;
  if (typeof value === 'string') {
    advancedAssert(value.length <= 30 && /^[\x20-\x7e]*$/.test(value));
    return;
  }
  keys(value, ['objectId', 'byteOffset', 'lowerBound', 'upperBound', 'pointeeType']);
  advancedAssert(value.objectId === null || id(value.objectId, 'o'));
  advancedAssert(uint(value.byteOffset) && uint(value.lowerBound) && uint(value.upperBound));
  const target = typeof value.pointeeType === 'string' ? types.get(value.pointeeType) : undefined;
  advancedAssert(target && target.kind !== 'pointer' && target.kind !== 'string');
  if (value.objectId === null)
    advancedAssert(value.byteOffset === 0 && value.lowerBound === 0 && value.upperBound === 0);
  else
    advancedAssert(
      value.lowerBound <= value.byteOffset &&
        value.byteOffset <= value.upperBound &&
        value.lowerBound < value.upperBound &&
        (value.byteOffset - value.lowerBound) % target.byteSize === 0,
    );
}
function cellType(object: AdvancedObject, byteOffset: number, types: TypeMap): AdvancedType {
  const type = types.get(object.typeName);
  advancedAssert(type && uint(byteOffset) && byteOffset < object.byteLength);
  const relative = byteOffset % type.byteSize;
  if (type.kind !== 'struct') {
    advancedAssert(relative === 0);
    return type;
  }
  const field = type.fields.find((item) => item.byteOffset === relative);
  advancedAssert(field);
  const result = types.get(field.typeName);
  advancedAssert(result && result.kind !== 'struct');
  return result;
}
function defaultCell(object: AdvancedObject, byteOffset: number, types: TypeMap): AdvancedValue {
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
function valueType(value: AdvancedValue, type: AdvancedType, types: TypeMap) {
  valueShape(value, types);
  advancedAssert(
    value === null ||
      (type.kind === 'int'
        ? typeof value === 'number'
        : type.kind === 'string'
          ? typeof value === 'string'
          : typeof value === 'object' && value.pointeeType === type.pointeeType),
  );
}
function pointerTarget(
  pointer: AdvancedPointer,
  objects: Map<string, AdvancedObject>,
  types: TypeMap,
) {
  if (pointer.objectId === null) return;
  const object = objects.get(pointer.objectId);
  advancedAssert(object && pointer.upperBound <= object.byteLength);
  if (object.typeName === pointer.pointeeType) {
    advancedAssert(pointer.lowerBound === 0 && pointer.upperBound === object.byteLength);
    return;
  }
  const type = types.get(object.typeName)!;
  advancedAssert(type.kind === 'struct');
  const element = Math.floor(pointer.lowerBound / type.byteSize) * type.byteSize;
  const field = type.fields.find(
    (item) =>
      item.byteOffset === pointer.lowerBound - element && item.typeName === pointer.pointeeType,
  );
  advancedAssert(
    field && pointer.upperBound === pointer.lowerBound + types.get(field.typeName)!.byteSize,
  );
}
function ids(value: unknown, prefix: string): asserts value is string[] {
  advancedAssert(
    Array.isArray(value) &&
      value.every((item) => id(item, prefix)) &&
      new Set(value).size === value.length,
  );
}
export function canonicalAdvancedJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAdvancedJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalAdvancedJson(object[key])}`)
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
function yieldAdvancedTask(): Promise<void> {
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
export function encodeAdvancedRequest(request: AdvancedRequest): Uint8Array<ArrayBuffer> {
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
  advancedAssert(
    request.execVersion === '1.4.0' &&
      request.dslVersion === '1.3.0' &&
      request.diagnosticVersion === '1.3.0' &&
      request.integerEncoding === '1.0.0',
  );
  advancedAssert(request.language === 'c' || request.language === 'cpp');
  advancedAssert(
    request.engineId === 'engine.rust.advanced' && id(request.runId) && id(request.sourceRevision),
  );
  advancedAssert(typeof request.source === 'string' && size(request.source) <= 32768);
  for (const scalar of request.source) {
    const code = scalar.codePointAt(0)!;
    advancedAssert(code < 0xd800 || code > 0xdfff);
  }
  keys(request.input, ['kind', 'values']);
  advancedAssert(Array.isArray(request.input.values));
  if (request.input.kind === 'integers') {
    advancedAssert(
      request.input.values.length <= 30 &&
        request.input.values.every((value) => int(value) && value >= -999 && value <= 999),
    );
  } else {
    advancedAssert(
      request.input.kind === 'lines' &&
        request.language === 'cpp' &&
        request.input.values.length <= 2 &&
        request.input.values.every(
          (value) =>
            typeof value === 'string' && value.length <= 30 && /^[\x20-\x7e]*$/.test(value),
        ),
    );
  }
  const bytes = enc.encode(canonicalAdvancedJson(request));
  advancedAssert(bytes.length <= 65536);
  return bytes;
}

function validateRecord(
  table: string,
  value: unknown,
  nodes: Map<string, AdvancedNode>,
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
    advancedAssert(id(value.id, 'f') && name(value.functionName));
    advancedAssert(
      typeof value.functionNodeId === 'string' &&
        nodes.get(value.functionNodeId)?.kind === 'function',
    );
    advancedAssert(value.parentFrameId === null || id(value.parentFrameId, 'f'));
    advancedAssert(
      value.callNodeId === null ||
        (typeof value.callNodeId === 'string' && nodes.get(value.callNodeId)?.kind === 'call'),
    );
    ids(value.scopeIds, 's');
  } else if (table === 'scopes') {
    keys(value, ['id', 'frameId', 'nodeId', 'objectIds', 'aliases']);
    advancedAssert(
      id(value.id, 's') &&
        id(value.frameId, 'f') &&
        typeof value.nodeId === 'string' &&
        nodes.has(value.nodeId),
    );
    ids(value.objectIds, 'o');
    advancedAssert(['block', 'for'].includes(nodes.get(value.nodeId as string)!.kind));
    advancedAssert(Array.isArray(value.aliases) && value.aliases.length <= 8);
    for (const alias of value.aliases) {
      keys(alias, ['name', 'objectId']);
      advancedAssert(name(alias.name) && id(alias.objectId, 'o'));
    }
    advancedAssert(
      new Set(value.aliases.map((alias) => (alias as { name: string }).name)).size ===
        value.aliases.length,
    );
  } else {
    advancedAssert(table === 'objects');
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
    advancedAssert(
      id(value.id, 'o') &&
        name(value.name) &&
        (value.storage === 'automatic'
          ? id(value.frameId, 'f') && id(value.scopeId, 's')
          : value.storage === 'heap' && value.frameId === null && value.scopeId === null),
    );
    advancedAssert(
      typeof value.declarationNodeId === 'string' && nodes.has(value.declarationNodeId),
    );
    advancedAssert(
      (value.storage === 'heap' ? ['expression'] : ['declaration', 'parameter']).includes(
        nodes.get(value.declarationNodeId)!.kind,
      ),
    );
    const type = typeof value.typeName === 'string' ? types.get(value.typeName) : undefined;
    advancedAssert(type);
    advancedAssert(value.storage !== 'heap' || type.kind !== 'pointer');
    advancedAssert(
      uint(value.length) &&
        value.length >= 1 &&
        value.length <= 262144 &&
        uint(value.byteLength) &&
        value.byteLength === value.length * type.byteSize &&
        value.byteLength <= 1048576 &&
        (value.storage !== 'heap' || value.length === 1),
    );
    advancedAssert(
      uint(value.baseAddress) &&
        value.baseAddress >= 4096 &&
        value.baseAddress % 4 === 0 &&
        typeof value.alive === 'boolean' &&
        typeof value.zeroInitialized === 'boolean',
    );
    advancedAssert(
      Array.isArray(value.cells) &&
        value.cells.length <= value.byteLength / 4 &&
        (value.alive || value.cells.length === 0),
    );
    if (types.get(value.typeName as string)?.kind === 'string')
      advancedAssert(
        value.length === 1 && value.storage === 'automatic' && value.zeroInitialized === false,
      );
    let previous = -1;
    for (const cell of value.cells) {
      keys(cell, ['byteOffset', 'value']);
      advancedAssert(uint(cell.byteOffset) && cell.byteOffset > previous);
      const object = value as unknown as AdvancedObject;
      valueType(cell.value as AdvancedValue, cellType(object, cell.byteOffset, types), types);
      advancedAssert(!equal(cell.value, defaultCell(object, cell.byteOffset, types)));
      previous = cell.byteOffset;
    }
  }
  if (record(value)) cache?.records.set(value, table);
}
function validateSingleton(
  op: string,
  value: unknown,
  nodes: Map<string, AdvancedNode>,
  inputLength: number,
  types: TypeMap,
  cache?: ValidationCache,
) {
  if (record(value) && cache?.singletons.get(value) === op) return;
  if (op === 'control') {
    keys(value, ['activeFrameId', 'nextNodeId', 'returnValue', 'inputCursor']);
    advancedAssert(value.activeFrameId === null || id(value.activeFrameId, 'f'));
    advancedAssert(
      value.nextNodeId === null ||
        (typeof value.nextNodeId === 'string' && nodes.has(value.nextNodeId)),
    );
    advancedAssert(uint(value.inputCursor) && value.inputCursor <= inputLength);
    valueShape(value.returnValue, types);
  } else if (op === 'allocator') {
    keys(value, ['nextAddress', 'liveBytes', 'nextObject', 'nextScope', 'nextFrame']);
    advancedAssert(
      uint(value.nextAddress) && value.nextAddress >= 4096 && value.nextAddress % 4 === 0,
    );
    advancedAssert(
      uint(value.liveBytes) && value.liveBytes <= 1048576 && value.liveBytes % 4 === 0,
    );
    for (const key of ['nextObject', 'nextScope', 'nextFrame'])
      advancedAssert(uint(value[key]) && value[key] > 0);
  } else {
    advancedAssert(op === 'counters');
    keys(value, ['comparisons', 'scalarWrites', 'arrayWrites', 'swaps']);
    advancedAssert(Object.values(value).every(uint));
  }
  if (record(value)) cache?.singletons.set(value, op);
}
function validateState(
  state: AdvancedState,
  nodes: Map<string, AdvancedNode>,
  inputLength: number,
  types: TypeMap,
  cache?: ValidationCache,
) {
  keys(state, ['frames', 'scopes', 'objects', 'control', 'allocator', 'output', 'counters']);
  advancedAssert(
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
      advancedAssert(new Set(rows.map((item) => item.id)).size === rows.length);
      cache?.tables.set(rows, table);
    }
  }
  for (const op of ['control', 'allocator', 'counters'] as const)
    validateSingleton(op, state[op], nodes, inputLength, types, cache);
  advancedAssert(typeof state.output === 'string' && size(state.output) <= 16384);
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
    advancedAssert(frame.parentFrameId === (i ? state.frames[i - 1].id : null));
    advancedAssert((i === 0) === (frame.callNodeId === null));
    advancedAssert(Number(frame.id.slice(1)) < state.allocator.nextFrame);
    advancedAssert(equal(frame.scopeIds, scopeIdsByFrame.get(frame.id) ?? []));
  }
  for (const scope of state.scopes) {
    advancedAssert(
      frames.has(scope.frameId) && Number(scope.id.slice(1)) < state.allocator.nextScope,
    );
    advancedAssert(equal(scope.objectIds, objectIdsByScope.get(scope.id) ?? []));
    const names = scope.objectIds.map((key) => objects.get(key)!.name);
    for (const alias of scope.aliases) {
      const target = objects.get(alias.objectId);
      advancedAssert(target?.alive && target.storage === 'automatic');
      advancedAssert(framePositions.get(target.frameId!)! < framePositions.get(scope.frameId)!);
      names.push(alias.name);
    }
    advancedAssert(new Set(names).size === names.length);
  }
  const addresses = [...state.objects].sort((a, b) => a.baseAddress - b.baseAddress);
  advancedAssert(state.allocator.nextObject === state.objects.length + 1);
  for (const [index, object] of state.objects.entries())
    advancedAssert(object.id === `o${index + 1}`);
  let end = 4096;
  let heap = 0;
  for (const object of addresses) {
    advancedAssert(Number(object.id.slice(1)) < state.allocator.nextObject);
    if (object.alive && object.storage === 'automatic')
      advancedAssert(scopes.get(object.scopeId!)?.frameId === object.frameId);
    advancedAssert(object.baseAddress >= end);
    end = object.baseAddress + object.byteLength;
    advancedAssert(Number.isSafeInteger(end) && end <= state.allocator.nextAddress);
    if (object.alive) {
      liveBytes += object.byteLength;
      if (object.storage === 'heap') heap++;
    }
    for (const cell of object.cells)
      if (cell.value !== null && typeof cell.value === 'object')
        pointerTarget(cell.value, objects, types);
  }
  advancedAssert(heap <= 128);
  if (state.control.returnValue !== null && typeof state.control.returnValue === 'object')
    pointerTarget(state.control.returnValue, objects, types);
  advancedAssert(liveBytes === state.allocator.liveBytes);
  advancedAssert(state.control.activeFrameId === (state.frames.at(-1)?.id ?? null));
}

/** Applies only recorded deltas, in either direction; never evaluates source. */
export function projectAdvancedStep(
  state: AdvancedState,
  step: AdvancedStep,
  typeDefinitions: AdvancedType[],
  backward = false,
): AdvancedState {
  const types = new Map(typeDefinitions.map((type) => [type.name, type]));
  return projectStep(state, step, types, backward);
}
function projectStep(
  state: AdvancedState,
  step: AdvancedStep,
  types: TypeMap,
  backward = false,
  detachChanges = true,
): AdvancedState {
  // Copy only touched records. Earlier states and checkpoint records remain
  // immutable; a deep copy of the whole live stack per delta is unnecessary.
  const next: AdvancedState = { ...state };
  // During course packet validation, the parsed records are private to the
  // validator. Reuse them across projections, which only mutate copied tables.
  const detach = detachChanges ? structuredClone : <T>(value: T) => value;
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
      advancedAssert(
        change.index <= table.length &&
          (before === null
            ? !table.some((item) => item.id === change.id)
            : equal(table[change.index], before)),
      );
      if (before === null) table.splice(change.index, 0, detach(after!));
      else if (after === null) table.splice(change.index, 1);
      else table[change.index] = detach(after);
    } else if (change.op === 'cell') {
      writable('objects');
      const position = next.objects.findIndex((item) => item.id === change.objectId);
      advancedAssert(position >= 0);
      const previous = next.objects[position];
      const object = { ...previous, cells: [...previous.cells] };
      next.objects[position] = object;
      advancedAssert(object.alive);
      const type = cellType(object, change.byteOffset, types);
      const before = backward ? change.after : change.before;
      const after = backward ? change.before : change.after;
      const at = object.cells.findIndex((cell) => cell.byteOffset === change.byteOffset);
      advancedAssert(
        equal(
          at < 0 ? defaultCell(object, change.byteOffset, types) : object.cells[at].value,
          before,
        ),
      );
      valueType(after, type, types);
      if (at >= 0) object.cells.splice(at, 1);
      if (!equal(after, defaultCell(object, change.byteOffset, types))) {
        object.cells.push({ byteOffset: change.byteOffset, value: detach(after) });
        object.cells.sort((a, b) => a.byteOffset - b.byteOffset);
      }
    } else if (change.op === 'output') {
      advancedAssert(size(next.output) === (backward ? change.afterBytes : change.beforeBytes));
      if (backward) {
        advancedAssert(next.output.endsWith(change.append));
        next.output = next.output.slice(0, next.output.length - change.append.length);
      } else next.output += change.append;
      advancedAssert(size(next.output) === (backward ? change.beforeBytes : change.afterBytes));
    } else {
      const before = backward ? change.after : change.before;
      const after = backward ? change.before : change.after;
      advancedAssert(equal(next[change.op], before));
      Object.assign(next, { [change.op]: detach(after) });
    }
  }
  return next;
}

function validateChange(
  change: AdvancedChange,
  nodes: Map<string, AdvancedNode>,
  inputLength: number,
  types: TypeMap,
  cache?: ValidationCache,
) {
  advancedAssert(record(change));
  if (change.op === 'record') {
    keys(change, ['op', 'table', 'id', 'index', 'before', 'after']);
    advancedAssert(
      ['frames', 'scopes', 'objects'].includes(change.table) &&
        uint(change.index) &&
        (change.before !== null || change.after !== null),
    );
    for (const item of [change.before, change.after])
      if (item !== null) {
        validateRecord(change.table, item, nodes, types, cache);
        advancedAssert(item.id === change.id);
      }
    if (change.before && change.after && change.table === 'objects') {
      const before = change.before as AdvancedObject;
      const after = change.after as AdvancedObject;
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
        advancedAssert(before[key] === after[key]);
      advancedAssert(before.alive && (after.alive || after.cells.length === 0));
    }
    if (change.table === 'objects') {
      advancedAssert(change.after !== null);
      if (change.before === null) advancedAssert((change.after as AdvancedObject).alive);
    }
    if (change.before && change.after && change.table === 'frames') {
      const before = change.before as AdvancedFrame,
        after = change.after as AdvancedFrame;
      for (const key of [
        'id',
        'functionNodeId',
        'functionName',
        'parentFrameId',
        'callNodeId',
      ] as const)
        advancedAssert(before[key] === after[key]);
    }
    if (change.before && change.after && change.table === 'scopes') {
      const before = change.before as AdvancedScope,
        after = change.after as AdvancedScope;
      for (const key of ['id', 'frameId', 'nodeId'] as const)
        advancedAssert(before[key] === after[key]);
    }
  } else if (change.op === 'cell') {
    keys(change, ['op', 'objectId', 'byteOffset', 'before', 'after']);
    advancedAssert(id(change.objectId, 'o') && uint(change.byteOffset));
    valueShape(change.before, types);
    valueShape(change.after, types);
  } else if (change.op === 'output') {
    keys(change, ['op', 'beforeBytes', 'afterBytes', 'append']);
    advancedAssert(
      uint(change.beforeBytes) &&
        uint(change.afterBytes) &&
        change.afterBytes <= 16384 &&
        typeof change.append === 'string' &&
        change.afterBytes === change.beforeBytes + size(change.append),
    );
  } else {
    advancedAssert(['control', 'allocator', 'counters'].includes(change.op));
    keys(change, ['op', 'before', 'after']);
    validateSingleton(change.op, change.before, nodes, inputLength, types, cache);
    validateSingleton(change.op, change.after, nodes, inputLength, types, cache);
  }
}

export async function decodeAdvancedResult(
  buffer: ArrayBuffer,
  request: AdvancedRequest,
  buildId: string,
  guard: () => void = () => {},
): Promise<AdvancedResult> {
  try {
    guard();
    advancedAssert(buffer.byteLength > 0 && buffer.byteLength <= 16777216);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const lexical = precheckJson(text);
    let sinceYield = performance.now();
    for (let check = lexical.next(); !check.done; check = lexical.next()) {
      guard();
      if (performance.now() - sinceYield >= 6) {
        await yieldAdvancedTask();
        guard();
        sinceYield = performance.now();
      }
    }
    guard();
    return await validateAdvancedPacket(
      JSON.parse(text) as AdvancedResult,
      request,
      buildId,
      guard,
    );
  } catch (error) {
    if (error instanceof Error && /^E_[A-Z_]+$/.test(error.message)) throw error;
    throw new Error('E_PROTOCOL_INVALID', { cause: error });
  }
}

/** Validate a decoded packet after the caller's bounded JSON preflight. */
export async function validateAdvancedPacket(
  result: AdvancedResult,
  request: AdvancedRequest,
  buildId: string,
  guard: () => void,
  course = false,
): Promise<AdvancedResult> {
  let sinceYield = performance.now();
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
  advancedAssert(
    result.execVersion === '1.4.0' &&
      result.dslVersion === '1.3.0' &&
      result.diagnosticVersion === '1.3.0' &&
      result.integerEncoding === '1.0.0' &&
      result.language === request.language,
  );
  const types =
    result.trace === null && Array.isArray(result.types) && result.types.length === 0
      ? new Map<string, AdvancedType>()
      : validateTypes(result.types);
  keys(result.engine, ['id', 'version', 'buildId']);
  advancedAssert(
    result.engine.id === 'engine.rust.advanced' &&
      result.engine.version === '0.1.0' &&
      result.engine.buildId === buildId,
  );
  keys(result.identity, ['runId', 'sourceRevision']);
  advancedAssert(
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
    advancedAssert(
      uint(value.start) &&
        uint(value.end) &&
        value.start <= value.end &&
        boundaries.has(value.start) &&
        boundaries.has(value.end),
    );
  };
  advancedAssert(Array.isArray(result.nodeMap) && result.nodeMap.length <= 32768);
  const nodes = new Map<string, AdvancedNode>();
  for (const [index, node] of result.nodeMap.entries()) {
    keys(node, ['nodeId', 'kind', 'byteRange']);
    advancedAssert(
      node.nodeId === `n${index + 1}` &&
        (nodeKinds.includes(node.kind) || (course && node.kind === 'do-while')),
    );
    range(node.byteRange);
    nodes.set(node.nodeId, node);
  }
  keys(result.terminal, ['status', 'code', 'byteRange', 'cursor', 'returnValue']);
  advancedAssert(['completed', 'error', 'limited', 'cancelled'].includes(result.terminal.status));
  advancedAssert(result.terminal.code === null || errorCodes.includes(result.terminal.code));
  if (result.terminal.byteRange !== null) range(result.terminal.byteRange);
  advancedAssert(uint(result.terminal.cursor) && nullableInt(result.terminal.returnValue));
  advancedAssert((result.terminal.status === 'completed') === (result.terminal.code === null));
  advancedAssert(
    (result.terminal.status === 'cancelled') === (result.terminal.code === 'E_CANCELLED'),
  );
  const limited =
    result.terminal.code !== null &&
    (result.terminal.code.endsWith('_LIMIT') || result.terminal.code === 'E_DEADLINE');
  advancedAssert((result.terminal.status === 'limited') === limited);
  if (result.terminal.status === 'completed') advancedAssert(result.terminal.byteRange === null);
  keys(result.stats, ['fuelUsed']);
  advancedAssert(uint(result.stats.fuelUsed) && result.stats.fuelUsed <= 1000000);
  advancedAssert(result.terminal.status !== 'cancelled' && result.terminal.code !== 'E_DEADLINE');
  if (result.trace === null) {
    advancedAssert(result.terminal.status !== 'completed' && result.terminal.cursor === 0);
    return result;
  }
  const trace = result.trace;
  keys(trace, ['dslVersion', 'completeness', 'initialState', 'steps', 'checkpoints']);
  advancedAssert(
    trace.dslVersion === '1.3.0' &&
      trace.completeness === (result.terminal.status === 'completed' ? 'complete' : 'prefix'),
  );
  advancedAssert(
    Array.isArray(trace.steps) &&
      trace.steps.length <= 20000 &&
      result.terminal.cursor === trace.steps.length &&
      Array.isArray(trace.checkpoints),
  );
  advancedAssert(trace.checkpoints.length === Math.floor(trace.steps.length / 128) + 1);
  validateState(trace.initialState, nodes, request.input.values.length, types, cache);
  advancedAssert(
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
      advancedAssert(checkpoint.cursor === cursor && equal(checkpoint.state, state));
    }
    if (cursor === trace.steps.length) break;
    if (cursor % 32 === 0) {
      guard();
      if (performance.now() - sinceYield >= 6) {
        await yieldAdvancedTask();
        guard();
        sinceYield = performance.now();
      }
    }
    const step = trace.steps[cursor];
    keys(step, ['seq', 'kind', 'nodeId', 'changes']);
    advancedAssert(
      step.seq === cursor + 1 &&
        stepKinds.includes(step.kind) &&
        nodes.has(step.nodeId) &&
        Array.isArray(step.changes),
    );
    const records = new Set<string>();
    const cells = new Map<string, Set<number>>();
    const singletons = new Set<string>();
    for (const change of step.changes) {
      validateChange(change, nodes, request.input.values.length, types, cache);
      // A producer diff has one final change per target. Disallow hidden
      // intermediate writes which could otherwise disappear before state
      // provenance validation, including record/cell overlap on one object.
      if (change.op === 'record') {
        const key = `${change.table}:${change.id}`;
        advancedAssert(!records.has(key));
        advancedAssert(change.table !== 'objects' || !cells.has(change.id));
        records.add(key);
      } else if (change.op === 'cell') {
        const offsets = cells.get(change.objectId) ?? new Set<number>();
        advancedAssert(
          !offsets.has(change.byteOffset) && !records.has(`objects:${change.objectId}`),
        );
        offsets.add(change.byteOffset);
        cells.set(change.objectId, offsets);
      } else {
        advancedAssert(!singletons.has(change.op));
        singletons.add(change.op);
      }
    }
    const next = projectStep(state, step, types, false, !course);
    validateState(next, nodes, request.input.values.length, types, cache);
    const count = next.frames.length - state.frames.length;
    advancedAssert(
      count ===
        (['program.enter', 'function.enter'].includes(step.kind)
          ? 1
          : ['program.return', 'function.return'].includes(step.kind)
            ? -1
            : 0),
    );
    if (step.kind === 'program.enter')
      advancedAssert(state.frames.length === 0 && next.frames[0].functionName === 'main');
    if (step.kind === 'program.return') advancedAssert(next.frames.length === 0);
    for (const key of ['nextAddress', 'nextObject', 'nextScope', 'nextFrame'] as const)
      advancedAssert(next.allocator[key] >= state.allocator[key]);
    for (const key of ['comparisons', 'scalarWrites', 'arrayWrites', 'swaps'] as const)
      advancedAssert(next.counters[key] >= state.counters[key]);
    advancedAssert(next.control.inputCursor >= state.control.inputCursor);
    advancedAssert(equal(projectStep(next, step, types, true, !course), state));
    state = next;
  }
  if (result.terminal.status === 'completed')
    advancedAssert(
      result.terminal.returnValue === state.control.returnValue &&
        state.frames.length === 0 &&
        state.objects.every((object) => !object.alive || object.storage === 'heap') &&
        state.scopes.length === 0 &&
        state.allocator.liveBytes ===
          state.objects
            .filter((object) => object.alive)
            .reduce((sum, object) => sum + object.byteLength, 0),
    );
  else advancedAssert(result.terminal.returnValue === null);
  guard();
  return result;
}
