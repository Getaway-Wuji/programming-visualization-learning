import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BlockGenerationError, generateBlockSource } from '../../web/src/blocks/generator';
import {
  BLOCK_LIMITS,
  type BlockExpression,
  type BlockProgram,
  type BlockStatement,
} from '../../web/src/blocks/model';
import { correctBlockProgram, starterProgram } from '../../web/src/blocks/starters';
import {
  decodePractice,
  exerciseCatalog,
  type CoursePractice,
  type ExerciseCatalog,
} from '../../web/src/content/practice';
import { practiceRelease } from '../../web/src/content/practice-release.generated';
import type { ExerciseTest } from '../../web/src/content/types';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import { decodeResult, encodeRequest, type ExecuteResult } from '../../web/src/engine/protocol';
import { initSync, execute_request, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';
import { caseSummary, exerciseRequest, submissionMet } from '../../web/src/practice/submission';

const ids = [
  'exercise.c.echo',
  'exercise.c.two-x-plus-three',
  'exercise.c.nonnegative',
  'exercise.c.two-loop-sums',
  'exercise.c.increment-at-index',
  'exercise.c.array-sum',
] as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
let course: CoursePractice;
function prepare(catalog: ExerciseCatalog, test = catalog.subject.tests[0]): PreparedSource {
  const input = Object.fromEntries(
    Object.keys(test.input)
      .sort()
      .map((key) => [key, test.input[key]]),
  );
  return (
    JSON.parse(
      decoder.decode(
        prepare_input(JSON.stringify(catalog), encoder.encode(JSON.stringify(input)), 1000),
      ),
    ) as { source: PreparedSource }
  ).source;
}
function stdout(result: ExecuteResult): string {
  return (
    result.trace?.steps
      .flatMap((step) =>
        step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
      )
      .join('') ?? ''
  );
}
async function execute(
  catalog: ExerciseCatalog,
  source: PreparedSource,
  test: ExerciseTest,
  index = 0,
  submissionId = crypto.randomUUID(),
  contextId = crypto.randomUUID(),
) {
  const request = exerciseRequest(
    catalog,
    source,
    { contextId, contextRevision: 1, sourceRevision: index + 1 },
    submissionId,
    test,
  );
  const bytes = execute_request(
    encodeRequest(request),
    JSON.stringify(catalog),
    engineBuild.wasmSha256,
    1000,
  ).slice();
  return { request, result: await decodeResult(bytes.buffer, request) };
}
function factories() {
  let next = 0;
  const id = () => `test.${++next}`;
  const integer = (value: number): BlockExpression => ({
    id: id(),
    kind: 'integer',
    value: String(value),
  });
  const variable = (name: string): BlockExpression => ({ id: id(), kind: 'variable', name });
  const unary = (operator: '+' | '-' | '!', operand: BlockExpression): BlockExpression => ({
    id: id(),
    kind: 'unary',
    operator,
    operand,
  });
  const binary = (
    kind: 'arithmetic' | 'compare' | 'logic',
    operator: string,
    left: BlockExpression,
    right: BlockExpression,
  ): BlockExpression => ({ id: id(), kind, operator, left, right }) as BlockExpression;
  const arithmetic = (operator: string, left: BlockExpression, right: BlockExpression) =>
    binary('arithmetic', operator, left, right);
  const compare = (operator: string, left: BlockExpression, right: BlockExpression) =>
    binary('compare', operator, left, right);
  const logic = (operator: string, left: BlockExpression, right: BlockExpression) =>
    binary('logic', operator, left, right);
  const declare = (
    name: string,
    initial: BlockExpression | null,
  ): BlockStatement & { kind: 'declare' } => ({ id: id(), kind: 'declare', name, initial });
  const assign = (name: string, value: BlockExpression): BlockStatement & { kind: 'assign' } => ({
    id: id(),
    kind: 'assign',
    name,
    value,
  });
  const print = (format: string, ...args: BlockExpression[]): BlockStatement => ({
    id: id(),
    kind: 'print',
    format,
    args,
  });
  const read = (name: string, index: BlockExpression): BlockExpression => ({
    id: id(),
    kind: 'array_read',
    name,
    index,
  });
  const program = (body: readonly BlockStatement[]): BlockProgram => ({
    id: 'test.main',
    kind: 'main',
    body,
  });
  return {
    id,
    integer,
    variable,
    unary,
    arithmetic,
    compare,
    logic,
    declare,
    assign,
    print,
    read,
    program,
  };
}
function plain(body: (f: ReturnType<typeof factories>) => readonly BlockStatement[]) {
  const catalog = exerciseCatalog(course, ids[0]);
  const f = factories();
  const bindings = starterProgram(ids[0], catalog.program.bindings).body;
  const program = f.program([...bindings.slice(0, catalog.program.bindings.length), ...body(f)]);
  const source = generateBlockSource(program, prepare(catalog), catalog.program.bindings);
  return { catalog, program, source };
}
function assertRanges(program: BlockProgram, source: PreparedSource, result?: ExecuteResult) {
  const seen: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') seen.push(record.id);
    Object.values(record).forEach(visit);
  };
  visit(program);
  expect(source.blockMap.map((entry) => entry.blockId).sort()).toEqual(seen.sort());
  const bytes = encoder.encode(source.text);
  for (const map of source.blockMap) {
    expect(map.byteRange.start).toBeGreaterThanOrEqual(0);
    expect(map.byteRange.end).toBeLessThanOrEqual(bytes.length);
    expect(map.byteRange.end).toBeGreaterThan(map.byteRange.start);
    expect(() => decoder.decode(bytes.subarray(0, map.byteRange.start))).not.toThrow();
    expect(() =>
      decoder.decode(bytes.subarray(map.byteRange.start, map.byteRange.end)),
    ).not.toThrow();
    if (result)
      expect(
        result.nodeMap.some(
          (node) =>
            node.byteRange.start === map.byteRange.start &&
            node.byteRange.end === map.byteRange.end,
        ),
        map.blockId,
      ).toBe(true);
  }
}
function rejected(program: BlockProgram, code: string, source?: PreparedSource) {
  const catalog = exerciseCatalog(course, ids[0]);
  try {
    generateBlockSource(program, source ?? prepare(catalog), catalog.program.bindings);
    throw new Error('Invalid block tree accepted');
  } catch (error) {
    expect(error).toBeInstanceOf(BlockGenerationError);
    expect((error as BlockGenerationError).code).toBe(code);
  }
}

describe('10.2 stable block generation with actual Rust/WASM', () => {
  beforeAll(async () => {
    course = await decodePractice(
      new Uint8Array(
        readFileSync(new URL(`../../web/public/${practiceRelease.file}`, import.meta.url)),
      ),
    );
    initSync({
      module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
    });
  });

  // Explicit per-call WASM budgets here prove semantics/identity; whole browser
  // submissions still have one original 1000 ms deadline in the session layer.
  it.each(ids)('executes every frozen test and exact teaching rule: %s', async (id) => {
    const catalog = exerciseCatalog(course, id);
    const program = correctBlockProgram(id, catalog.program.bindings);
    const before = JSON.stringify({ catalog, program });
    const submissionId = crypto.randomUUID(),
      contextId = crypto.randomUUID();
    const summaries = [];
    const sources = [];
    for (const [index, test] of catalog.subject.tests.entries()) {
      const prepared = prepare(catalog, test);
      const source = generateBlockSource(program, prepared, catalog.program.bindings);
      expect(source).toEqual(generateBlockSource(program, prepared, catalog.program.bindings));
      expect(source.bindingMap).toEqual(prepared.bindingMap);
      const prefixEnd = Math.max(...prepared.bindingMap.map((entry) => entry.byteRange.end));
      expect(encoder.encode(source.text).slice(0, prefixEnd)).toEqual(
        encoder.encode(prepared.text).slice(0, prefixEnd),
      );
      const { request, result } = await execute(
        catalog,
        source,
        test,
        index,
        submissionId,
        contextId,
      );
      expect(result.producer).toBe('rust');
      expect(result.identity).toEqual(request.identity);
      expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
      expect(result.trace?.completeness).toBe('complete');
      expect(result.judgeResult?.status).toBe('met');
      expect(stdout(result)).toBe(test.expectedStdout);
      assertRanges(program, source, result);
      summaries.push(caseSummary(request, result));
      sources.push(source);
    }
    expect(submissionMet(catalog, summaries)).toBe(true);
    if (id === ids[2]) {
      const condition = program.body.find((entry) => entry.kind === 'if')!;
      expect(
        new Set(summaries.flatMap((summary) => summary.coverage.map((entry) => entry.siteKey))),
      ).toEqual(new Set([condition.id]));
      expect(
        new Set(
          summaries.flatMap((summary) =>
            summary.coverage.filter((entry) => entry.visits > 0).map((entry) => entry.branch),
          ),
        ),
      ).toEqual(new Set(['then', 'else']));
      expect(
        new Set(
          sources.map(
            (source) =>
              source.blockMap.find((map) => map.blockId === condition.id)!.byteRange.start,
          ),
        ).size,
      ).toBeGreaterThan(1);
    }
    expect(JSON.stringify({ catalog, program })).toBe(before);
  });

  it.each(ids)('keeps the unfinished starter runnable and objectively unmet: %s', async (id) => {
    const catalog = exerciseCatalog(course, id);
    const program = starterProgram(id, catalog.program.bindings);
    let failed = false;
    for (const test of catalog.subject.tests) {
      const { result } = await execute(
        catalog,
        generateBlockSource(program, prepare(catalog, test), catalog.program.bindings),
        test,
      );
      expect(result.terminal.status).toBe('completed');
      if (result.judgeResult?.status === 'unmet') {
        failed = true;
        break;
      }
    }
    expect(failed).toBe(true);
    expect(program).toEqual(starterProgram(id, catalog.program.bindings));
  });

  it.each([0, 7])(
    'keeps an explicit return %s without appending an unreachable default',
    async (exitCode) => {
      const { catalog, program, source } = plain((f) => [
        f.print('中文🙂\n'),
        { id: f.id(), kind: 'return', value: f.integer(exitCode) },
      ]);
      expect(source.text.match(/return /g)).toHaveLength(1);
      expect(source.text).toMatch(new RegExp(`return ${exitCode};\\n}\\n$`));
      const { result } = await execute(catalog, source, catalog.subject.tests[0]);
      expect(result.terminal).toMatchObject({ status: 'completed', exitCode });
      expect(stdout(result)).toBe('中文🙂\n');
      assertRanges(program, source, result);
    },
  );

  it.each(['empty', 'conditional', 'while', 'for'] as const)(
    'keeps the default return for a reachable end: %s',
    async (kind) => {
      const { catalog, program, source } = plain((f) => {
        const returned: BlockStatement = { id: f.id(), kind: 'return', value: f.integer(7) };
        if (kind === 'empty') return [];
        if (kind === 'conditional')
          return [
            { id: f.id(), kind: 'if', condition: f.integer(0), then: [returned], else: null },
          ];
        if (kind === 'while')
          return [{ id: f.id(), kind: 'while', condition: f.integer(0), body: [returned] }];
        return [
          {
            id: f.id(),
            kind: 'for',
            init: null,
            condition: f.integer(0),
            update: null,
            body: [returned],
          },
        ];
      });
      expect(source.text.match(/return 0;/g)).toHaveLength(1);
      const { result } = await execute(catalog, source, catalog.subject.tests[0]);
      expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0 });
      assertRanges(program, source, result);
    },
  );

  it.each([0, 1])(
    'omits the default when a nested scope returns on both branches: %s',
    async (condition) => {
      const { catalog, program, source } = plain((f) => [
        {
          id: f.id(),
          kind: 'scope',
          body: [
            {
              id: f.id(),
              kind: 'if',
              condition: f.integer(condition),
              then: [{ id: f.id(), kind: 'return', value: f.integer(7) }],
              else: [{ id: f.id(), kind: 'return', value: f.integer(0) }],
            },
          ],
        },
      ]);
      expect(source.text.match(/return /g)).toHaveLength(2);
      const { result } = await execute(catalog, source, catalog.subject.tests[0]);
      expect(result.terminal).toMatchObject({ status: 'completed', exitCode: condition ? 7 : 0 });
      assertRanges(program, source, result);
    },
  );

  it('preserves all twenty teaching block classes, priority, scopes, for continue and innermost break', async () => {
    const { catalog, program, source } = plain((f) => [
      f.declare(
        'total',
        f.arithmetic('*', f.arithmetic('+', f.integer(2), f.integer(3)), f.integer(4)),
      ),
      { id: f.id(), kind: 'array_declare', name: 'a', length: '31', values: ['+4', '-2'] },
      {
        id: f.id(),
        kind: 'array_write',
        name: 'a',
        index: f.integer(30),
        value: f.unary('-', f.integer(7)),
      },
      {
        id: f.id(),
        kind: 'scope',
        body: [f.declare('total', f.integer(99)), f.print('%d\n', f.variable('total'))],
      },
      {
        id: f.id(),
        kind: 'if',
        condition: f.logic(
          '&&',
          f.compare('==', f.variable('total'), f.integer(20)),
          f.unary('!', f.integer(0)),
        ),
        then: [f.print('%d\n', f.variable('total'))],
        else: [],
      },
      f.declare('i', f.integer(0)),
      {
        id: f.id(),
        kind: 'while',
        condition: f.compare('<', f.variable('i'), f.integer(2)),
        body: [
          f.assign('i', f.arithmetic('+', f.variable('i'), f.integer(1))),
          { id: f.id(), kind: 'break' },
        ],
      },
      {
        id: f.id(),
        kind: 'for',
        init: f.declare('j', f.integer(0)),
        condition: f.compare('<', f.variable('j'), f.integer(4)),
        update: f.assign('j', f.arithmetic('+', f.variable('j'), f.integer(1))),
        body: [
          {
            id: f.id(),
            kind: 'if',
            condition: f.compare('==', f.variable('j'), f.integer(1)),
            then: [{ id: f.id(), kind: 'continue' }],
            else: null,
          },
          f.assign('total', f.arithmetic('+', f.variable('total'), f.variable('j'))),
        ],
      },
      f.print(
        '%d %d %d\n',
        f.variable('total'),
        f.read('a', f.integer(30)),
        f.unary('+', f.variable('i')),
      ),
      { id: f.id(), kind: 'return', value: f.integer(0) },
      f.print('MUST NOT EXECUTE'),
    ]);
    const { result } = await execute(catalog, source, catalog.subject.tests[0]);
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(stdout(result)).toBe('99\n20\n25 -7 1\n');
    assertRanges(program, source, result);
    expect(result.stats!.peakVirtualBytes).toBeGreaterThanOrEqual(31 * 4);
  });

  it('keeps short circuit, negative division/remainder and full int32 minimum semantics in Rust', async () => {
    const { catalog, source } = plain((f) => [
      f.print(
        '%d %d %d %d %d\n',
        f.arithmetic('/', f.unary('-', f.integer(7)), f.integer(3)),
        f.arithmetic('%', f.unary('-', f.integer(7)), f.integer(3)),
        f.arithmetic('-', f.unary('-', f.integer(2147483647)), f.integer(1)),
        f.logic('&&', f.integer(0), f.arithmetic('/', f.integer(1), f.integer(0))),
        f.logic('||', f.integer(1), f.arithmetic('/', f.integer(1), f.integer(0))),
      ),
    ]);
    const { result } = await execute(catalog, source, catalog.subject.tests[0]);
    expect(result.terminal.status).toBe('completed');
    expect(stdout(result)).toBe('-2 -1 -2147483648 0 1\n');
  });

  it('maps UTF-8 output and quotes/backslashes exactly without injecting C', async () => {
    const { catalog, program, source } = plain((f) => [
      f.print('中文🙂 "\\ %d %%\n', f.integer(7)),
    ]);
    expect(source.text).toContain('中文🙂 \\"\\\\ %d %%\\n');
    const { result } = await execute(catalog, source, catalog.subject.tests[0]);
    expect(result.terminal.status).toBe('completed');
    expect(stdout(result)).toBe('中文🙂 "\\ 7 %\n');
    assertRanges(program, source, result);
  });

  it('allows ordinary arrays above 30 and defers virtual allocation to executed Rust branches', async () => {
    const { catalog, source } = plain((f) => [
      {
        id: f.id(),
        kind: 'if',
        condition: f.integer(0),
        then: [
          { id: f.id(), kind: 'array_declare', name: 'huge', length: '2147483647', values: null },
        ],
        else: null,
      },
      f.print('ok\n'),
    ]);
    const { result } = await execute(catalog, source, catalog.subject.tests[0]);
    expect(result.terminal.status).toBe('completed');
    expect(stdout(result)).toBe('ok\n');
    const changed = plain((f) => [
      { id: f.id(), kind: 'array_declare', name: 'huge', length: '2147483647', values: null },
    ]);
    const allocated = await execute(
      changed.catalog,
      changed.source,
      changed.catalog.subject.tests[0],
    );
    expect(allocated.result.terminal.status).toBe('resource-limit');
    expect(allocated.result.terminal.diagnostics[0].code).toBe('E_MEMORY_LIMIT');
  });

  it('supports empty and assignment for slots with proper outer scope and break', async () => {
    const { catalog, program, source } = plain((f) => [
      f.declare('i', f.integer(9)),
      {
        id: f.id(),
        kind: 'for',
        init: f.assign('i', f.integer(0)),
        condition: null,
        update: null,
        body: [{ id: f.id(), kind: 'break' }],
      },
      { id: f.id(), kind: 'for', init: null, condition: f.integer(0), update: null, body: [] },
      f.print('%d\n', f.variable('i')),
    ]);
    const { result } = await execute(catalog, source, catalog.subject.tests[0]);
    expect(result.terminal.status).toBe('completed');
    expect(stdout(result)).toBe('0\n');
    assertRanges(program, source, result);
  });

  it('honors the frozen depth 64 boundary instead of the abandoned depth 32 draft', async () => {
    expect(BLOCK_LIMITS.depth).toBe(64);
    const deep = plain((f) => {
      let expression = f.integer(1);
      for (let index = 0; index < 63; index++) expression = f.unary('+', expression);
      return [f.declare('deep', expression)];
    });
    const { result } = await execute(deep.catalog, deep.source, deep.catalog.subject.tests[0]);
    expect(result.terminal.status).toBe('completed');
    expect(result.stats!.maxAstDepth).toBe(64);
    expect(result.stats!.maxSyntaxDepth).toBe(64);
    const catalog = exerciseCatalog(course, ids[0]);
    const f = factories();
    let expression = f.integer(1);
    for (let index = 0; index < 64; index++) expression = f.unary('+', expression);
    rejected(
      f.program([
        ...starterProgram(ids[0], catalog.program.bindings).body.slice(0, 1),
        f.declare('deep', expression),
      ]),
      'BLOCK_LIMIT',
    );
  });

  it('rejects deleted, renamed, duplicated, reordered and nested input source blocks', () => {
    const catalog = exerciseCatalog(course, ids[0]);
    const program = starterProgram(ids[0], catalog.program.bindings);
    rejected({ ...program, body: program.body.slice(1) }, 'BLOCK_INPUT');
    const input = program.body[0];
    rejected(
      {
        ...program,
        body: [{ ...input, name: 'renamed' } as BlockStatement, ...program.body.slice(1)],
      },
      'BLOCK_INPUT',
    );
    rejected(
      { ...program, body: [input, { ...input, id: 'duplicate.input' }, ...program.body.slice(1)] },
      'BLOCK_INPUT',
    );
    rejected(
      {
        ...program,
        body: [{ id: 'nested', kind: 'scope', body: [input] }, ...program.body.slice(1)],
      },
      'BLOCK_INPUT',
    );
    const arrayCatalog = exerciseCatalog(course, ids[4]);
    const arrayProgram = starterProgram(ids[4], arrayCatalog.program.bindings);
    expect(() =>
      generateBlockSource(
        {
          ...arrayProgram,
          body: [arrayProgram.body[1], arrayProgram.body[0], ...arrayProgram.body.slice(2)],
        },
        prepare(arrayCatalog),
        arrayCatalog.program.bindings,
      ),
    ).toThrow(BlockGenerationError);
  });

  it.each([
    [
      'missing expression',
      (f: ReturnType<typeof factories>) => f.declare('a', undefined as unknown as BlockExpression),
      'BLOCK_SHAPE',
    ],
    [
      'statement as expression',
      (f: ReturnType<typeof factories>) =>
        f.print('%d', { id: f.id(), kind: 'break' } as unknown as BlockExpression),
      'BLOCK_SHAPE',
    ],
    [
      'undeclared variable',
      (f: ReturnType<typeof factories>) => f.print('%d', f.variable('missing')),
      'BLOCK_REFERENCE',
    ],
    [
      'array as scalar',
      (f: ReturnType<typeof factories>) =>
        ({
          id: f.id(),
          kind: 'scope',
          body: [
            { id: f.id(), kind: 'array_declare', name: 'a', length: '1', values: null },
            f.print('%d', f.variable('a')),
          ],
        }) as BlockStatement,
      'BLOCK_REFERENCE',
    ],
    [
      'break outside loop',
      (f: ReturnType<typeof factories>) => ({ id: f.id(), kind: 'break' }) as BlockStatement,
      'BLOCK_LOOP',
    ],
    [
      'continue outside loop',
      (f: ReturnType<typeof factories>) => ({ id: f.id(), kind: 'continue' }) as BlockStatement,
      'BLOCK_LOOP',
    ],
    [
      'unsupported format',
      (f: ReturnType<typeof factories>) => f.print('%s', f.integer(0)),
      'BLOCK_FORMAT',
    ],
    [
      'format argument mismatch',
      (f: ReturnType<typeof factories>) => f.print('%d'),
      'BLOCK_FORMAT',
    ],
    ['unpaired surrogate', (f: ReturnType<typeof factories>) => f.print('\ud800'), 'BLOCK_FORMAT'],
    [
      'forbidden escape character',
      (f: ReturnType<typeof factories>) => f.print('\t'),
      'BLOCK_FORMAT',
    ],
    [
      'negative token',
      (f: ReturnType<typeof factories>) =>
        f.print('%d', { id: f.id(), kind: 'integer', value: '-1' }),
      'BLOCK_INTEGER',
    ],
    [
      'leading zero',
      (f: ReturnType<typeof factories>) =>
        f.print('%d', { id: f.id(), kind: 'integer', value: '01' }),
      'BLOCK_INTEGER',
    ],
    [
      'out of int32 token',
      (f: ReturnType<typeof factories>) =>
        f.print('%d', { id: f.id(), kind: 'integer', value: '2147483648' }),
      'BLOCK_INTEGER',
    ],
    [
      'source injection name',
      (f: ReturnType<typeof factories>) => f.declare('a; return 1;', f.integer(0)),
      'BLOCK_NAME',
    ],
    [
      'reserved identifier',
      (f: ReturnType<typeof factories>) => f.declare('main', f.integer(0)),
      'BLOCK_NAME',
    ],
    [
      'zero array',
      (f: ReturnType<typeof factories>) =>
        ({
          id: f.id(),
          kind: 'array_declare',
          name: 'a',
          length: '0',
          values: null,
        }) as BlockStatement,
      'BLOCK_INTEGER',
    ],
    [
      'empty initializer',
      (f: ReturnType<typeof factories>) =>
        ({
          id: f.id(),
          kind: 'array_declare',
          name: 'a',
          length: '1',
          values: [],
        }) as BlockStatement,
      'BLOCK_INTEGER',
    ],
    [
      'too many initializer values',
      (f: ReturnType<typeof factories>) =>
        ({
          id: f.id(),
          kind: 'array_declare',
          name: 'a',
          length: '1',
          values: ['1', '2'],
        }) as BlockStatement,
      'BLOCK_INTEGER',
    ],
    [
      'unsupported expression operator',
      (f: ReturnType<typeof factories>) =>
        f.print('%d', f.arithmetic('**', f.integer(1), f.integer(2))),
      'BLOCK_SHAPE',
    ],
    [
      'unsupported for initializer',
      (f: ReturnType<typeof factories>) =>
        ({
          id: f.id(),
          kind: 'for',
          init: f.print('bad'),
          condition: null,
          update: null,
          body: [],
        }) as unknown as BlockStatement,
      'BLOCK_SHAPE',
    ],
  ])('rejects malformed connections: %s', (_, make, code) => {
    const catalog = exerciseCatalog(course, ids[0]);
    const f = factories();
    rejected(
      f.program([...starterProgram(ids[0], catalog.program.bindings).body.slice(0, 1), make(f)]),
      code,
    );
  });

  it('rejects duplicate IDs, duplicate local declarations and expired block scopes', () => {
    const catalog = exerciseCatalog(course, ids[0]);
    const input = starterProgram(ids[0], catalog.program.bindings).body[0];
    const f = factories();
    const declaration = f.declare('a', f.integer(0));
    rejected(f.program([input, declaration, declaration]), 'BLOCK_ID');
    rejected(f.program([input, declaration, f.declare('a', f.integer(1))]), 'BLOCK_DUPLICATE');
    rejected(
      f.program([
        input,
        { id: f.id(), kind: 'scope', body: [declaration] },
        f.print('%d', f.variable('a')),
      ]),
      'BLOCK_REFERENCE',
    );
    rejected(
      f.program([
        input,
        {
          id: f.id(),
          kind: 'for',
          init: f.declare('i', f.integer(0)),
          condition: f.integer(0),
          update: null,
          body: [],
        },
        f.print('%d', f.variable('i')),
      ]),
      'BLOCK_REFERENCE',
    );
  });

  it('rejects broken prepared ranges and source budget overflow without truncation', () => {
    const catalog = exerciseCatalog(course, ids[0]);
    const program = starterProgram(ids[0], catalog.program.bindings);
    const prepared = prepare(catalog);
    rejected(program, 'BLOCK_PREPARATION', { ...prepared, bindingMap: [] });
    rejected(program, 'BLOCK_PREPARATION', {
      ...prepared,
      bindingMap: [{ ...prepared.bindingMap[0], byteRange: { start: -1, end: 20 } }],
    });
    rejected(program, 'BLOCK_PREPARATION', {
      ...prepared,
      bindingMap: [{ ...prepared.bindingMap[0], bindingKey: 'unknown' }],
    });
    const f = factories();
    rejected(f.program([program.body[0], f.print('文'.repeat(10923))]), 'BLOCK_SOURCE_LIMIT');
  });

  it('allows the complete 32768-byte source boundary and more than 512 finite nodes', async () => {
    const catalog = exerciseCatalog(course, ids[0]);
    const f = factories();
    const input = starterProgram(ids[0], catalog.program.bindings).body[0];
    const small = f.program([input, f.print('')]);
    const prepared = prepare(catalog);
    const base = generateBlockSource(small, prepared, catalog.program.bindings);
    const padding = 32768 - encoder.encode(base.text).byteLength;
    const maximum = {
      ...small,
      body: [input, { ...small.body[1], format: 'a'.repeat(padding) } as BlockStatement],
    };
    expect(
      encoder.encode(generateBlockSource(maximum, prepared, catalog.program.bindings).text),
    ).toHaveLength(32768);
    rejected(
      {
        ...maximum,
        body: [input, { ...maximum.body[1], format: 'a'.repeat(padding + 1) } as BlockStatement],
      },
      'BLOCK_SOURCE_LIMIT',
    );
    const many = f.program([input, ...Array.from({ length: 600 }, () => f.print(''))]);
    const source = generateBlockSource(many, prepared, catalog.program.bindings);
    expect(source.blockMap.length).toBe(602);
    const { result } = await execute(catalog, source, catalog.subject.tests[0]);
    expect(result.terminal.status).toBe('completed');
    assertRanges(many, source, result);
  });

  it('leaves runtime uninitialized reads and overflow as real Rust failures with a mapped node', async () => {
    const missing = plain((f) => [
      f.declare('uninitialized', null),
      f.print('%d', f.variable('uninitialized')),
    ]);
    const uninitialized = await execute(
      missing.catalog,
      missing.source,
      missing.catalog.subject.tests[0],
    );
    expect(uninitialized.result.terminal.status).toBe('program-error');
    expect(uninitialized.result.terminal.diagnostics[0].code).toBe('E_UNINITIALIZED');
    const overflow = plain((f) => [
      f.declare('tooLarge', f.arithmetic('+', f.integer(2147483647), f.integer(1))),
    ]);
    const failed = await execute(
      overflow.catalog,
      overflow.source,
      overflow.catalog.subject.tests[0],
    );
    expect(failed.result.terminal.status).toBe('program-error');
    expect(failed.result.terminal.diagnostics[0].code).toBe('E_INT_OVERFLOW');
    expect(failed.result.terminal.location.kind).toBe('source');
    assertRanges(overflow.program, overflow.source, failed.result);
  });
});
