export const rust2018Protocol = Object.freeze({
  version: '1.0.0',
  language: 'rust',
  edition: '2018',
  deadlineMs: 1000,
  requestBytes: 65536,
  resultBytes: 16777216,
  sourceBytes: 32768,
  inputBytes: 256,
  wasmPages: 2048,
  judgeCases: 4,
});

export const rust2018NodeKinds = Object.freeze([
  'function',
  'param',
  'block',
  'let',
  'assign',
  'expression',
  'while',
  'loop',
  'for',
  'return',
  'break',
  'continue',
  'print',
  'read-line',
  'int',
  'bool',
  'text',
  'name',
  'unary',
  'binary',
  'call',
  'if',
  'array',
  'repeat',
  'index',
  'borrow',
  'method',
  'parse',
  'parse-inferred',
  'string-new',
  'string-from',
]);
export const rust2018Events = Object.freeze([
  'scope-enter',
  'scope-exit',
  'declare',
  'assign',
  'array-write',
  'arithmetic',
  'condition',
  'loop',
  'call',
  'return',
  'input',
  'output',
  'string-create',
  'clone',
  'move',
  'borrow-shared',
  'borrow-mut',
  'borrow-end',
  'drop',
]);
export const rust2018DiagnosticCodes = Object.freeze([
  'E_REQUEST_INVALID',
  'E_VERSION_UNSUPPORTED',
  'E_SOURCE_LIMIT',
  'E_INPUT_LIMIT',
  'E_PROFILE_UNKNOWN',
  'E_LEX',
  'E_SYNTAX',
  'E_UNSUPPORTED',
  'E_TYPE',
  'E_NAME',
  'E_IMMUTABLE',
  'E_MOVED',
  'E_BORROW_CONFLICT',
  'E_BORROW_MUTABLE',
  'E_ENTRY',
  'E_ARITY',
  'E_RETURN',
  'E_ARRAY_BOUNDS',
  'E_OVERFLOW',
  'E_DIV_ZERO',
  'E_PARSE_INT',
  'E_STEP_LIMIT',
  'E_FUEL_LIMIT',
  'E_STACK_LIMIT',
  'E_MEMORY_LIMIT',
  'E_OBJECT_LIMIT',
  'E_OUTPUT_LIMIT',
  'E_RESULT_LIMIT',
  'E_DEPTH_LIMIT',
  'E_DEADLINE',
]);

const record = (properties) => ({
  type: 'object',
  required: Object.keys(properties),
  additionalProperties: false,
  properties,
});
const constant = (value) => ({ const: value });
const enumeration = (...values) => ({ enum: values });
const integer = (minimum, maximum = Number.MAX_SAFE_INTEGER) => ({
  type: 'integer',
  minimum,
  maximum,
});
const text = (maxLength) => ({ type: 'string', maxLength });
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const variants = (...oneOf) => ({ oneOf });
const nullable = (schema) => variants(constant(null), schema);
const ref = (name) => ({ $ref: '#/$defs/' + name });
const boolean = { type: 'boolean' };
const id = integer(1);
const nodeId = integer(1, 32768);
const opaque = { type: 'string', pattern: '^[A-Za-z0-9._-]{1,96}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const stamps = {
  version: constant('1.0.0'),
  language: constant('rust'),
  edition: constant('2018'),
};
const request = { ...stamps, runId: opaque, sourceRevision: opaque, source: text(32768) };
export const rust2018RequestSchema = variants(
  record({ ...request, operation: constant('execute'), input: text(256) }),
  record({ ...request, operation: constant('analyze') }),
  record({ ...request, operation: constant('judge'), profile: opaque, reviewCase: integer(0, 3) }),
);

const range = record({ start: integer(0, 32768), end: integer(0, 32768) });
const diagnostic = record({ code: enumeration(...rust2018DiagnosticCodes), byteRange: range });
const status = enumeration('completed', 'error', 'limited');
const type = {
  type: 'string',
  pattern: '^(?:i32|bool|unit|String|\\[i32;(?:[1-9]|[12][0-9]|30)\\]|&(?:mut )?(?:i32|String))$',
};
const valueVariant = (kind, properties = {}) => record({ kind: constant(kind), ...properties });
const tables = {
  bindings: ref('binding'),
  objects: ref('object'),
  loans: ref('loan'),
  temporaries: ref('temporary'),
};
const singleton = {
  frames: list(ref('frame'), 32),
  control: ref('control'),
  allocator: ref('allocator'),
  output: text(16384),
};
const change = variants(
  ...Object.entries(tables).map(([component, schema]) =>
    record({
      component: constant(component),
      id,
      before: nullable(schema),
      after: nullable(schema),
    }),
  ),
  ...Object.entries(singleton).map(([component, schema]) =>
    record({
      component: constant(component),
      before: schema,
      after: schema,
    }),
  ),
);
export const rust2018ResponseSchema = {
  ...record({
    ...stamps,
    operation: enumeration('execute', 'analyze', 'judge'),
    buildId: hash,
    identity: record({ runId: opaque, sourceRevision: opaque }),
    status,
    diagnostic: nullable(diagnostic),
    nodeMap: list(
      record({ id: nodeId, kind: enumeration(...rust2018NodeKinds), byteRange: range }),
      32768,
    ),
    analysis: nullable(
      record({
        status: enumeration('mapped', 'code-only', 'invalid', 'unsupported'),
        blockMap: list(nodeId, 32768),
      }),
    ),
    judgement: nullable(
      record({
        passed: boolean,
        reviewCase: integer(0, 3),
        cases: list(
          record({
            index: integer(0, 3),
            status,
            passed: boolean,
            diagnostic: nullable(diagnostic),
          }),
          4,
        ),
      }),
    ),
    replay: nullable(
      record({
        terminal: record({ status, diagnostic: nullable(diagnostic), cursor: integer(0, 20000) }),
        trace: record({
          initialState: ref('state'),
          steps: list(
            record({
              seq: integer(1, 20000),
              nodeId,
              event: enumeration(...rust2018Events),
              changes: list(change, 16384),
            }),
            20000,
          ),
          checkpoints: list(record({ cursor: integer(0, 20000), state: ref('state') }), 157),
          completeness: enumeration('complete', 'prefix'),
        }),
      }),
    ),
    usage: record({
      fuel: integer(0, 1000000),
      steps: integer(0, 20000),
      objects: integer(0, 4096),
      outputBytes: integer(0, 16384),
      resultBytes: integer(0, 16777216),
    }),
  }),
  $defs: {
    value: variants(
      valueVariant('unit'),
      valueVariant('i32', { value: integer(-2147483648, 2147483647) }),
      valueVariant('bool', { value: boolean }),
      valueVariant('string-object', { objectId: integer(1, 4096) }),
      valueVariant('array-object', { objectId: integer(1, 4096) }),
      valueVariant('reference', { loanId: id }),
    ),
    frame: record({
      id,
      functionNode: nodeId,
      callNode: nullable(nodeId),
      scopeIds: list(id, 20000),
    }),
    binding: record({
      id,
      declarationNode: nodeId,
      frameId: id,
      scopeId: id,
      name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$', maxLength: 32768 },
      type,
      mutable: boolean,
      status: enumeration('live', 'moved'),
      value: ref('value'),
    }),
    object: variants(
      record({
        id: integer(1, 4096),
        kind: constant('string'),
        text: text(4096),
        items: constant(null),
        alive: boolean,
      }),
      record({
        id: integer(1, 4096),
        kind: constant('array'),
        text: constant(null),
        items: { ...list(integer(-2147483648, 2147483647), 30), minItems: 1 },
        alive: boolean,
      }),
    ),
    loan: record({ id, targetBindingId: id, mutable: boolean, parameterBindingId: id }),
    temporary: record({ id, type, value: ref('value') }),
    control: record({
      nodeId: nullable(nodeId),
      inputCursor: integer(0, 256),
      returnValue: nullable(ref('value')),
    }),
    allocator: record({
      nextFrame: id,
      nextScope: id,
      nextBinding: id,
      nextObject: integer(1, 4097),
      nextLoan: id,
      nextTemporary: id,
      liveBytes: integer(0, 1048576),
    }),
    state: record({
      frames: list(ref('frame'), 32),
      bindings: list(ref('binding'), 4096),
      objects: list(ref('object'), 4096),
      loans: list(ref('loan'), 256),
      temporaries: list(ref('temporary'), 4096),
      control: ref('control'),
      allocator: ref('allocator'),
      output: text(16384),
    }),
  },
};
