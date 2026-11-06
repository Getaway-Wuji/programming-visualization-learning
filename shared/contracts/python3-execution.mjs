// Closed EXEC1.6 / STEP1.5 / DIAG1.5 / JUDGE2.1 / EDIT2.1 wire contract.
const object = (properties) => ({
  type: 'object',
  required: Object.keys(properties),
  properties,
  additionalProperties: false,
});
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const text = (maxLength) => ({ type: 'string', maxLength });
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const oneOf = (...items) => ({ oneOf: items });
const enumeration = (...values) => ({ enum: values });
const nullable = (schema) => oneOf({ type: 'null' }, schema);
const constant = (value) => ({ const: value });
const ref = (name) => ({ $ref: '#/$defs/' + name });
const id = { type: 'string', pattern: '^[a-zA-Z0-9._-]{1,96}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const bool = { type: 'boolean' };
const uint = integer(0, 16_777_216);
const nodeId = integer(1, 65_536);
const objectId = integer(1, 4096);
const frameId = integer(0, 20_000);
const safe = integer(-9007199254740991, 9007199254740991);
const reference = object({ id, version: constant('1.0.0') });
const packageRef = object({ id: constant('content.python.runoob3'), version: constant('1.0.0') });
const stamps = {
  language: constant('python'),
  engineId: constant('engine.rust.python3'),
  engineVersion: constant('0.1.0'),
  pythonReference: constant('3.13'),
  execVersion: constant('1.6.0'),
  dslVersion: constant('1.5.0'),
  diagnosticVersion: constant('1.5.0'),
  integerEncoding: constant('1.0.0'),
  runId: id,
  sourceRevision: id,
  sourceSha256: hash,
};
const variant = (kind, value = {}) => object({ kind: constant(kind), ...value });
export const python3RequestSchema = object({
  ...stamps,
  source: text(32768),
  operation: oneOf(
    variant('run', { input: object({ kind: constant('stdin-utf8'), text: text(256) }) }),
    variant('judge', { judgeVersion: constant('2.1.0'), packageRef, profileRef: reference }),
    variant('edit', { editVersion: constant('2.1.0'), packageRef, documentId: id }),
  ),
});

const byteRange = object({ start: integer(0, 32768), end: integer(0, 32768) });
const status = enumeration('completed', 'error', 'limited', 'cancelled');
const nodeKind = enumeration(
  'assign', 'expression', 'if', 'while', 'for', 'def', 'return', 'break', 'continue', 'pass',
  'none', 'bool', 'int', 'float', 'string', 'name', 'list', 'group', 'unary', 'binary',
  'compare', 'index', 'slice', 'call', 'method',
);
const eventKind = enumeration(
  'expression-end', 'bind', 'if-test', 'return', 'break', 'continue', 'pass', 'while-test',
  'loop-exit', 'range-test', 'list-write', 'list-create', 'unary', 'boolean-right', 'boolean-short',
  'compare', 'integer-floor', 'integer-remainder', 'true-division', 'subtract', 'string-concat',
  'binary', 'list-collect', 'list-index', 'string-index', 'list-slice', 'string-slice',
  'list-append', 'list-pop', 'frame-enter', 'frame-exit', 'length', 'truth', 'absolute',
  'string-convert', 'integer-convert', 'float-convert', 'print', 'input-prompt', 'input-read',
);
const change = (op, properties) => object({ op: constant(op), ...properties });
const pair = (schema) => ({ before: schema, after: schema });
const dictionary = (pattern, maximum, value) => ({
  type: 'object',
  maxProperties: maximum,
  patternProperties: { [pattern]: value },
  additionalProperties: false,
});
const namePattern = '^[A-Za-z_][A-Za-z0-9_]{0,63}$';
const name = { type: 'string', pattern: namePattern };
const values = list(ref('value'), 256);
const bindings = dictionary(namePattern, 128, ref('value'));

export const python3ResponseSchema = {
  ...object({
    ...stamps,
    engineBuildSha256: hash,
    nodeMap: list(ref('node'), 65536),
    usage: object({ steps: integer(0, 20000), objects: integer(0, 4096),
      outputBytes: integer(0, 16384), resultBytes: uint }),
    fuel: integer(0, 1000000),
    result: oneOf(
      variant('run', { packet: ref('packet') }),
      variant('judge', { judgeVersion: constant('2.1.0'), packageRef, profileRef: reference,
        status: enumeration('passed', 'failed', 'incomplete'), diagnostic: nullable(ref('diagnostic')),
        cases: list(ref('case'), 4) }),
      variant('edit', { editVersion: constant('2.1.0'), packageRef, documentId: id,
        status: enumeration('mapped', 'code-only', 'invalid', 'unsupported'),
        diagnostic: nullable(ref('diagnostic')), blockMap: list(ref('node'), 65536) }),
    ),
  }),
  $defs: {
    node: object({ nodeId, byteRange, kind: nodeKind }),
    diagnostic: object({ code: enumeration(
      'E_PY_SYNTAX', 'E_PY_INDENTATION', 'E_PY_UNSUPPORTED', 'E_PY_NAME', 'E_PY_UNBOUND_LOCAL',
      'E_PY_TYPE', 'E_PY_ZERO_DIVISION', 'E_PY_INDEX', 'E_PY_VALUE', 'E_PY_EOF',
      'E_PY_INTEGER_LIMIT', 'E_PY_FLOAT_NONFINITE', 'E_FUEL_LIMIT', 'E_DEADLINE', 'E_CANCELLED',
      'E_SOURCE_LIMIT', 'E_STEP_LIMIT', 'E_MEMORY_LIMIT', 'E_OUTPUT_LIMIT', 'E_RESULT_LIMIT',
      'E_STACK_LIMIT', 'E_DEPTH_LIMIT', 'E_ENCODING_FAILURE'),
      byteRange, stage: enumeration('lexer', 'parser', 'runtime', 'preflight', 'judge', 'encode') }),
    value: oneOf(
      variant('none'), variant('bool', { value: bool }), variant('int', { value: safe }),
      variant('f64', { bits: { type: 'string', pattern: '^[a-f0-9]{16}$' } }),
      variant('str', { value: text(4096) }), variant('list-ref', { objectId }),
      variant('function-ref', { nodeId }), variant('builtin-ref', { name: enumeration(
        'print', 'input', 'len', 'bool', 'abs', 'str', 'int', 'float', 'range') }),
    ),
    frame: object({ id: integer(1, 20000), functionNodeId: nodeId, callNodeId: nodeId, bindings }),
    control: object({
      nodeId: nullable(nodeId), pending: list(nodeId, 256), inputCursor: integer(0, 256),
      iterations: list(object({ nodeId, frameId, index: integer(0, 20000),
        current: nullable(safe), stop: nullable(safe), stride: nullable(safe) }), 256),
    }),
    allocator: object({ nextObject: integer(0, 4096), nextFrame: frameId, liveBytes: integer(0, 1048576) }),
    counters: object({ assignments: uint, listWrites: uint, comparisons: uint, calls: uint }),
    state: object({ globals: bindings, frames: list(ref('frame'), 32),
      objects: dictionary('^o[1-9][0-9]{0,3}$', 4096, values),
      control: ref('control'), allocator: ref('allocator'), output: text(16384), counters: ref('counters') }),
    change: oneOf(
      change('binding', { frameId, name, ...pair(nullable(ref('value'))) }),
      change('object', { objectId, ...pair(nullable(values)) }),
      change('slot', { objectId, index: integer(0, 255),
        beforeLen: integer(0, 256), afterLen: integer(0, 256), ...pair(nullable(ref('value'))) }),
      change('frame', pair(nullable(ref('frame')))),
      change('control', pair(ref('control'))),
      change('allocator', pair(ref('allocator'))),
      change('output', { beforeBytes: integer(0, 16384), afterBytes: integer(0, 16384), append: text(16384) }),
      change('counters', pair(ref('counters'))),
    ),
    step: object({ seq: integer(1, 20000), kind: eventKind, nodeId, value: nullable(ref('value')),
      changes: list(ref('change'), 4100) }),
    trace: object({ completeness: enumeration('complete', 'prefix'), initialState: ref('state'),
      steps: list(ref('step'), 20000),
      checkpoints: list(object({ cursor: integer(128, 20000), state: ref('state') }), 156) }),
    packet: object({ terminal: object({ status, cursor: integer(0, 20000), diagnostic: nullable(ref('diagnostic')) }),
      trace: nullable(ref('trace')) }),
    case: object({ caseKey: integer(1, 4), stdoutMatches: bool, observationMatches: bool,
      observations: list(object({ seq: integer(1, 20000), nodeId, tag: eventKind, value: nullable(ref('value')) }), 24),
      packet: ref('packet') }),
  },
};
