// The P1 schema is a separate closed branch; no old schema is rewritten.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const object = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const array = (items, maxItems = 32768) => ({ type: 'array', items, maxItems });
const str = { type: 'string', maxLength: 32768 };
const uint = { type: 'integer', minimum: 0, maximum: 9007199254740991 };
const int = { type: 'integer', minimum: -2147483648, maximum: 2147483647 };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const literal = (value) => ({ const: value });
const enumOf = (...values) => ({ enum: values });
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$' };
const nodeId = { type: 'string', pattern: '^n[1-9][0-9]*$' };
const dynamicId = (prefix) => ({ type: 'string', pattern: `^${prefix}[1-9][0-9]*$` });
const range = object({ start: uint, end: uint });
const frame = object({
  id: dynamicId('f'),
  functionNodeId: nodeId,
  functionName: str,
  parentFrameId: nullable(dynamicId('f')),
  callNodeId: nullable(nodeId),
  scopeIds: array(dynamicId('s')),
});
const scope = object({
  id: dynamicId('s'),
  frameId: dynamicId('f'),
  nodeId,
  objectIds: array(dynamicId('o')),
  aliases: array(object({ name: str, objectId: dynamicId('o') }), 8),
});
const cell = object({ index: uint, value: int });
const memoryObject = object({
  id: dynamicId('o'),
  declarationNodeId: nodeId,
  frameId: dynamicId('f'),
  scopeId: dynamicId('s'),
  name: str,
  kind: enumOf('int', 'int-array'),
  length: { type: 'integer', minimum: 1, maximum: 262144 },
  baseAddress: uint,
  defaultValue: nullable(int),
  cells: array(cell, 262144),
});
const control = object({
  activeFrameId: nullable(dynamicId('f')),
  nextNodeId: nullable(nodeId),
  returnValue: nullable(int),
  inputCursor: { type: 'integer', minimum: 0, maximum: 30 },
});
const allocator = object({
  nextAddress: uint,
  liveBytes: { type: 'integer', minimum: 0, maximum: 1048576 },
  nextObject: uint,
  nextScope: uint,
  nextFrame: uint,
});
const counters = object({ comparisons: uint, scalarWrites: uint, arrayWrites: uint, swaps: uint });
const state = object({
  frames: array(frame, 32),
  scopes: array(scope),
  objects: array(memoryObject, 262144),
  control,
  allocator,
  output: str,
  counters,
});
const changes = {
  oneOf: [
    ...[
      ['frames', frame],
      ['scopes', scope],
      ['objects', memoryObject],
    ].map(([table, entry]) =>
      object({
        op: literal('record'),
        table: literal(table),
        id: dynamicId(table[0] === 'f' ? 'f' : table[0] === 's' ? 's' : 'o'),
        index: uint,
        before: nullable(entry),
        after: nullable(entry),
      }),
    ),
    object({
      op: literal('cell'),
      objectId: dynamicId('o'),
      index: uint,
      before: nullable(int),
      after: nullable(int),
    }),
    ...[
      ['control', control],
      ['allocator', allocator],
      ['counters', counters],
    ].map(([op, entry]) => object({ op: literal(op), before: entry, after: entry })),
    object({ op: literal('output'), beforeBytes: uint, afterBytes: uint, append: str }),
  ],
};
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
const codes = [
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
const versions = {
  execVersion: literal('1.2.0'),
  dslVersion: literal('1.1.0'),
  diagnosticVersion: literal('1.1.0'),
  integerEncoding: literal('1.0.0'),
  language: enumOf('c', 'cpp'),
};
const request = object({
  ...versions,
  engineId: literal('engine.rust.p1'),
  runId: id,
  sourceRevision: id,
  source: str,
  input: array({ type: 'integer', minimum: -999, maximum: 999 }, 30),
});
const trace = object({
  dslVersion: literal('1.1.0'),
  completeness: enumOf('complete', 'prefix'),
  initialState: ref('state'),
  steps: array(
    object({
      seq: { type: 'integer', minimum: 1, maximum: 20000 },
      kind: enumOf(...stepKinds),
      nodeId,
      changes: array(changes),
    }),
    20000,
  ),
  checkpoints: array(object({ cursor: uint, state: ref('state') }), 157),
});
const result = object({
  ...versions,
  engine: object({
    id: literal('engine.rust.p1'),
    version: literal('0.1.0'),
    buildId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  }),
  identity: object({ runId: id, sourceRevision: id }),
  nodeMap: array(object({ nodeId, kind: enumOf(...nodeKinds), byteRange: range })),
  trace: nullable(ref('trace')),
  terminal: object({
    status: enumOf('completed', 'error', 'limited', 'cancelled'),
    code: nullable(enumOf(...codes)),
    byteRange: nullable(range),
    cursor: { type: 'integer', minimum: 0, maximum: 20000 },
    returnValue: nullable(int),
  }),
  stats: object({ fuelUsed: { type: 'integer', minimum: 0, maximum: 1000000 } }),
});
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:c-viz:algorithm:1.2.0',
  title: '12.1 explicit algorithm execution',
  oneOf: [ref('request'), ref('result')],
  $defs: { request, result, state, trace },
};
const path = '项目文档/契约/12.1-算法执行.schema.json';
const bytes = JSON.stringify(schema, null, 2) + '\n';
if (process.argv.includes('--check')) assert.equal(readFileSync(path, 'utf8'), bytes);
else writeFileSync(path, bytes);
console.log('P1 closed request/result schema matches its independent generator.');
