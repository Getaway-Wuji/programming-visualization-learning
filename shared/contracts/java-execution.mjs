// Closed Java EXEC1.7 / STEP1.6 / DIAG1.6 / JUDGE2.2 / EDIT2.2 wire contract.
const record = (properties) => ({
  type: 'object',
  required: Object.keys(properties),
  additionalProperties: false,
  properties,
});
const constant = (value) => ({ const: value });
const enumeration = (...values) => ({ enum: values });
const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const str = (maxLength) => ({ type: 'string', maxLength });
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const variants = (...schemas) => ({ oneOf: schemas });
const nullable = (schema) => variants(constant(null), schema);
const ref = (name) => ({ $ref: '#/$defs/' + name });
const keyPattern = '^[a-zA-Z_][a-zA-Z0-9_]{0,63}$';
const name = { type: 'string', pattern: keyPattern };
const id = { type: 'string', pattern: '^[a-zA-Z0-9._-]{1,96}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const bool = { type: 'boolean' };
const nodeId = int(1, 32768);
const objectId = int(1, 4096);
const cursor = int(0, 20000);
const positiveCursor = int(1, 20000);
const outputBytes = int(0, 16384);
const value = ref('value');
const object = ref('object');
const control = ref('control');
const allocator = ref('allocator');
const counters = ref('counters');
const frame = ref('frame');
const state = ref('state');
const nodes = list(ref('node'), 32768);
const variant = (kind, properties = {}) => record({ kind: constant(kind), ...properties });
const change = (op, properties) => record({ op: constant(op), ...properties });
const pair = (schema) => ({ before: schema, after: schema });
const dictionary = (pattern, maximum, value) => ({
  type: 'object',
  patternProperties: { [pattern]: value },
  maxProperties: maximum,
  additionalProperties: false,
});
const stamps = {
  language: constant('java'),
  engineId: constant('engine.rust.java'),
  engineVersion: constant('0.1.0'),
  javaReference: constant('21'),
  execVersion: constant('1.7.0'),
  dslVersion: constant('1.6.0'),
  diagnosticVersion: constant('1.6.0'),
  integerEncoding: constant('1.1.0'),
  runId: id,
  sourceRevision: id,
  sourceSha256: hash,
};
const packageRef = record({ id: constant('content.java.runoob'), version: constant('1.0.0') });
const profileRef = record({ id, version: constant('1.0.0') });
const judgeIdentity = { judgeVersion: constant('2.2.0'), packageRef, profileRef };
const editIdentity = { editVersion: constant('2.2.0'), packageRef, documentId: id };

export const javaRequestSchema = record({
  ...stamps,
  source: str(32768),
  operation: variants(
    variant('run', { input: record({ kind: constant('stdin-utf8'), text: str(256) }) }),
    variant('judge', judgeIdentity),
    variant('edit', editIdentity),
  ),
});

const byteRange = record({ start: int(0, 32768), end: int(0, 32768) });
const diagnostic = record({
  byteRange,
  stage: enumeration('lex', 'parse', 'type', 'runtime', 'budget'),
  code: enumeration(
    'E_JAVA_UNSUPPORTED', 'E_JAVA_SYNTAX', 'E_JAVA_LITERAL', 'E_JAVA_MAIN',
    'E_JAVA_DUPLICATE', 'E_JAVA_RETURN', 'E_JAVA_UNREACHABLE', 'E_JAVA_TYPE',
    'E_JAVA_NAME', 'E_JAVA_CONTROL', 'E_JAVA_NULL', 'E_JAVA_INDEX',
    'E_JAVA_NEGATIVE_ARRAY', 'E_JAVA_SCANNER_LIMIT', 'E_JAVA_EOF', 'E_JAVA_INPUT',
    'E_JAVA_ZERO_DIVISION', 'E_CANCELLED', 'E_DEPTH_LIMIT', 'E_MEMORY_LIMIT',
    'E_STACK_LIMIT', 'E_STEP_LIMIT', 'E_RESULT_LIMIT', 'E_FUEL_LIMIT', 'E_DEADLINE',
    'E_OUTPUT_LIMIT',
  ),
});
const terminal = record({
  status: enumeration('completed', 'error', 'limited', 'cancelled'),
  cursor,
  diagnostic: nullable(diagnostic),
});
const packet = record({ terminal, trace: nullable(ref('trace')) });
export const javaResponseSchema = {
  ...record({
    ...stamps,
    engineBuildSha256: hash,
    nodeMap: nodes,
    result: variants(
      variant('run', { packet }),
      variant('judge', {
        ...judgeIdentity,
        status: enumeration('passed', 'failed', 'incomplete'),
        diagnostic: nullable(diagnostic),
        cases: list(record({
          caseKey: int(1, 4),
          stdoutMatches: bool,
          observationMatches: bool,
          observations: list(record({ seq: positiveCursor, nodeId, tag: constant('print'), value }), 17),
          packet,
        }), 4),
      }),
      variant('edit', {
        ...editIdentity,
        status: enumeration('mapped', 'code-only', 'invalid', 'unsupported'),
        diagnostic: nullable(diagnostic),
        blockMap: nodes,
      }),
    ),
    usage: record({
      steps: cursor,
      objects: int(0, 4096),
      outputBytes,
      resultBytes: int(1, 16777216),
    }),
    fuel: int(0, 1000000),
  }),
  $defs: {
    node: record({
      nodeId, byteRange,
      kind: enumeration(
        'class', 'method', 'block', 'scope', 'if', 'while', 'for', 'return',
        'break', 'continue', 'declare', 'assign', 'increment', 'call-statement',
        'binary', 'unary', 'cast', 'index', 'receiver-call', 'field', 'literal',
        'call', 'name', 'group', 'new-array', 'new-object',
      ),
    }),
    value: variants(
      variant('null'),
      variant('bool', { value: bool }),
      variant('int', { value: int(-2147483648, 2147483647) }),
      variant('long', { value: { type: 'string', pattern: '^(?:0|-?[1-9][0-9]{0,18})$' } }),
      variant('string', { value: str(4096) }),
      variant('ref', { objectId }),
    ),
    object: variants(
      variant('int-array', { slots: list(value, 256) }),
      variant('string-array', { slots: list(value, 256) }),
      variant('instance', { className: name, fields: dictionary(keyPattern, 128, value) }),
      variant('scanner'),
    ),
    frame: record({ id: positiveCursor, methodNodeId: nodeId, callNodeId: nodeId,
      bindings: dictionary(keyPattern, 128, value) }),
    control: record({ nodeId: nullable(nodeId), path: list(nodeId, 256), inputCursor: int(0, 256) }),
    allocator: record({ objects: int(0, 4096), frames: cursor, liveBytes: int(0, 1048576) }),
    counters: record({ writes: cursor, calls: cursor, comparisons: cursor }),
    state: record({
      frames: list(frame, 32),
      objects: dictionary('^o[0-9]{4}$', 4096, object),
      control, allocator, counters, output: str(16384),
    }),
    change: variants(
      change('binding', { frameId: positiveCursor, name, ...pair(nullable(value)) }),
      change('frame', pair(nullable(frame))),
      change('object', { objectId, ...pair(nullable(object)) }),
      change('slot', { objectId, index: int(0, 255), ...pair(value) }),
      change('field', { objectId, name, ...pair(value) }),
      change('control', pair(control)),
      change('allocator', pair(allocator)),
      change('counters', pair(counters)),
      change('output', { beforeBytes: outputBytes, afterBytes: outputBytes, append: str(16384) }),
    ),
    trace: record({
      completeness: enumeration('complete', 'prefix'),
      initialState: state,
      steps: list(record({
        seq: positiveCursor, nodeId, value: nullable(value),
        kind: enumeration(
          'allocate', 'frame-enter', 'frame-exit', 'scope-exit', 'declare', 'assign',
          'branch', 'while-test', 'for-test', 'return', 'break', 'continue', 'object-write',
          'unary', 'convert', 'array-read', 'field-read', 'string-length', 'print',
          'input-read', 'short-circuit', 'boolean-right', 'string-concat', 'add',
          'subtract', 'multiply', 'divide', 'remainder', 'compare',
        ),
        changes: list(ref('change'), 132),
      }), 20000),
      checkpoints: list(record({ cursor: positiveCursor, state }), 156),
    }),
  },
};
