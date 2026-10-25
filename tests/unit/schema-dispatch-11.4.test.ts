import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FROZEN_EXEC_SCHEMA_SHA256,
  validateRequestSchema,
  validateResultSchema,
  validateTraceSchema,
} from '../../web/src/engine/execution-schema.generated';
import type { SchemaValue } from '../../web/src/engine/execution-schema.generated';
import {
  FROZEN_EXEC_SCHEMA_SHA256 as previousSchemaHash,
  validateRequestSchema as previousRequest,
  validateResultSchema as previousResult,
  validateTraceSchema as previousTrace,
} from '../fixtures/execution-schema-before-dispatch-11.4';

const frozenValidatorHash = 'f279d2e1f1af9478330961094165048eb85f840254da78df4a13ad9f715dc3ec';
const keys = [
  'assignment-negative',
  'branch-positive',
  'loops-normal',
  'array-mixed',
  'bubble-sort-mixed',
  'selection-sort-mixed',
  'search-duplicate',
];
function finish<T>(work: Generator<void, T, unknown>): T {
  let next = work.next();
  while (!next.done) next = work.next();
  return next.value;
}
const record = (value: unknown) => value as Record<string, SchemaValue>;
function archived(key: string, file: string): SchemaValue {
  return JSON.parse(
    readFileSync(
      new URL(`../../项目文档/验收/08.4-真实案例/${key}/${file}.json`, import.meta.url),
      'utf8',
    ),
  ) as SchemaValue;
}
const base = record(record(archived('bubble-sort-mixed', 'result')).trace);
const emptyTrace: Record<string, SchemaValue> = {
  ...base,
  checkpoints: [(base.checkpoints as SchemaValue[])[0]],
  steps: [],
};
type Union = 'location' | 'change' | 'observation';
const control = record(record(base.initialState).control);
const allocator = record(record(base.initialState).allocator);
const counters = record(record(base.initialState).counters);
const examples: { union: Union; name: string; value: Record<string, SchemaValue> }[] = [
  {
    union: 'location',
    name: 'source-node',
    value: { kind: 'source', nodeId: 'n1', edge: 'whole' },
  },
  {
    union: 'location',
    name: 'synthetic',
    value: { kind: 'synthetic', reason: 'implicit-return', anchorNodeId: 'n1' },
  },
  {
    union: 'change',
    name: 'record-frame',
    value: {
      op: 'record',
      table: 'frames',
      id: 'f1',
      index: 0,
      before: null,
      after: { id: 'f1', functionNodeId: 'n1', parentFrameId: null, scopeIds: ['s1'] },
    },
  },
  {
    union: 'change',
    name: 'record-scope',
    value: {
      op: 'record',
      table: 'scopes',
      id: 's1',
      index: 0,
      before: null,
      after: {
        id: 's1',
        frameId: 'f1',
        parentScopeId: null,
        nodeId: 'n2',
        kind: 'main',
        objectIds: ['o1'],
      },
    },
  },
  {
    union: 'change',
    name: 'record-object',
    value: {
      op: 'record',
      table: 'objects',
      id: 'o1',
      index: 0,
      before: null,
      after: {
        id: 'o1',
        declarationNodeId: 'n3',
        frameId: 'f1',
        scopeId: 's1',
        name: 'value',
        kind: 'int',
        length: 1,
        baseAddress: 4096,
        defaultValue: null,
        cells: [{ index: 0, value: 42 }],
      },
    },
  },
  {
    union: 'change',
    name: 'cell',
    value: { op: 'cell', objectId: 'o1', index: 0, before: null, after: -2147483648 },
  },
  { union: 'change', name: 'control', value: { op: 'control', before: control, after: control } },
  {
    union: 'change',
    name: 'allocator',
    value: { op: 'allocator', before: allocator, after: allocator },
  },
  {
    union: 'change',
    name: 'counters',
    value: { op: 'counters', before: counters, after: counters },
  },
  {
    union: 'change',
    name: 'output',
    value: { op: 'output', beforeBytes: 0, afterBytes: 8, append: '中文😀' },
  },
  {
    union: 'observation',
    name: 'read',
    value: { kind: 'read', nodeId: 'n1', objectId: 'o1', index: 0, value: 2147483647 },
  },
  {
    union: 'observation',
    name: 'evaluate',
    value: { kind: 'evaluate', nodeId: 'n1', operator: '+', operands: [1, 2], value: 3 },
  },
  {
    union: 'observation',
    name: 'decision',
    value: { kind: 'decision', nodeId: 'n1', value: 0, branch: 'false' },
  },
  {
    union: 'observation',
    name: 'short-circuit',
    value: { kind: 'short-circuit', nodeId: 'n1', skippedNodeId: 'n2' },
  },
  {
    union: 'observation',
    name: 'swap',
    value: {
      kind: 'swap',
      nodeId: 'n1',
      objectId: 'o1',
      indices: [0, 1],
      beforeValues: [3, -1],
      writeSeqs: [3, 4],
    },
  },
];
function wrapped(union: Union, value: SchemaValue): SchemaValue {
  return {
    ...emptyTrace,
    steps: [
      {
        seq: 1,
        kind: 'nop',
        location: union === 'location' ? value : { kind: 'source', nodeId: 'n1', edge: 'whole' },
        changes: union === 'change' ? [value] : [],
        observations: union === 'observation' ? [value] : [],
      },
    ],
  };
}
function compare(union: Union, value: SchemaValue): boolean {
  const trace = wrapped(union, value);
  const previous = finish(previousTrace(trace, () => {}));
  expect(finish(validateTraceSchema(trace, () => {}))).toBe(previous);
  return previous;
}
function paths(value: SchemaValue, prefix: string[] = []): string[][] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = [...prefix, key];
    return [path, ...paths(child, path)];
  });
}
function parentAt(value: SchemaValue, path: string[]): Record<string, SchemaValue> {
  let at = value;
  for (const key of path.slice(0, -1)) at = record(at)[key];
  return record(at);
}

describe('11.4 statically disjoint oneOf dispatch preserves the frozen schema', () => {
  it('retains the immutable complete old validator and unchanged public schema hash', () => {
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            new URL('../fixtures/execution-schema-before-dispatch-11.4.ts', import.meta.url),
          ),
        )
        .digest('hex'),
    ).toBe(frozenValidatorHash);
    expect(FROZEN_EXEC_SCHEMA_SHA256).toBe(previousSchemaHash);
    const generated = readFileSync(
      new URL('../../web/src/engine/execution-schema.generated.ts', import.meta.url),
      'utf8',
    );
    expect(generated.match(/switch \(value\[/g)).toHaveLength(3);
  });

  it.each(examples)('validates the entire selected $union branch: $name', ({ union, value }) => {
    expect(compare(union, value)).toBe(true);
  });

  it.each(examples)(
    'matches the old validator for every hostile field in $name',
    ({ union, value }) => {
      const tag = union === 'change' ? 'op' : 'kind';
      for (const replacement of [
        null,
        false,
        0,
        '',
        [],
        {},
        'unknown-tag',
        '__proto__',
        'constructor',
      ] satisfies SchemaValue[]) {
        const malformed = structuredClone(value);
        malformed[tag] = replacement;
        expect(compare(union, malformed)).toBe(false);
      }
      const absent = structuredClone(value);
      delete absent[tag];
      expect(compare(union, absent)).toBe(false);
      expect(compare(union, { ...value, unexpected: true })).toBe(false);
      const inherited = structuredClone(value);
      delete inherited[tag];
      Object.setPrototypeOf(inherited, { [tag]: value[tag] });
      expect(compare(union, inherited)).toBe(false);
      expect(compare(union, Object.assign(Object.create(null), value) as SchemaValue)).toBe(true);
      for (const path of paths(value)) {
        for (const replacement of [
          null,
          false,
          0,
          '',
          [],
          {},
          9007199254740992,
        ] satisfies SchemaValue[]) {
          const malformed = structuredClone(value);
          parentAt(malformed, path)[path.at(-1)!] = replacement;
          compare(union, malformed);
        }
        const malformed = structuredClone(value);
        delete parentAt(malformed, path)[path.at(-1)!];
        compare(union, malformed);
      }
    },
  );

  it.each(keys)('matches full request, result and trace decisions on archived real %s', (key) => {
    const request = archived(key, 'request');
    const result = archived(key, 'result');
    const requestAccepted = previousRequest(request);
    const resultAccepted = finish(previousResult(result, () => {}));
    const traceAccepted = finish(previousTrace(record(result).trace, () => {}));
    expect(requestAccepted && resultAccepted && traceAccepted).toBe(true);
    expect(validateRequestSchema(request)).toBe(requestAccepted);
    expect(finish(validateResultSchema(result, () => {}))).toBe(resultAccepted);
    expect(finish(validateTraceSchema(record(result).trace, () => {}))).toBe(traceAccepted);
  });

  it('matches full decisions for all authored contract normal/error/limit fixtures', () => {
    for (const name of ['02.2-正常轨迹样例.json', '02.2-失败与超限轨迹样例.json']) {
      const fixtures = JSON.parse(
        readFileSync(new URL(`../../项目文档/契约/${name}`, import.meta.url), 'utf8'),
      ) as { fixtures: { request: SchemaValue; result: SchemaValue }[] };
      for (const fixture of fixtures.fixtures) {
        expect(validateRequestSchema(fixture.request)).toBe(previousRequest(fixture.request));
        expect(finish(validateResultSchema(fixture.result, () => {}))).toBe(
          finish(previousResult(fixture.result, () => {})),
        );
      }
    }
  });

  it('matches full result rejection for hostile top-level and nested schema fields', () => {
    for (const path of [
      ['kind'],
      ['identity', 'runId'],
      ['nodeMap', '0', 'nodeId'],
      ['terminal', 'status'],
      ['terminal', 'location', 'kind'],
      ['trace', 'dslVersion'],
      ['trace', 'steps', '0', 'location', 'kind'],
      ['trace', 'steps', '0', 'changes', '0', 'op'],
      ['trace', 'checkpoints', '0', 'state', 'allocator', 'nextObject'],
    ]) {
      const result = structuredClone(archived('bubble-sort-mixed', 'result'));
      parentAt(result, path)[path.at(-1)!] = false;
      expect(finish(previousResult(result, () => {}))).toBe(false);
      expect(finish(validateResultSchema(result, () => {}))).toBe(false);
    }
  });

  it('preserves a byte-range-only source location at the terminal boundary', () => {
    const result = structuredClone(record(archived('bubble-sort-mixed', 'result')));
    record(result.terminal).location = { kind: 'source', byteRange: { start: 0, end: 4 } };
    expect(finish(previousResult(result, () => {}))).toBe(true);
    expect(finish(validateResultSchema(result, () => {}))).toBe(true);
  });

  it('still runs guards inside selected branches and propagates owner cancellation', () => {
    const trace = structuredClone(emptyTrace);
    trace.steps = Array.from({ length: 32 }, (_, index) => ({
      seq: index + 1,
      kind: 'nop',
      location: { kind: 'source', nodeId: 'n1', edge: 'whole' },
      changes: [{ op: 'control', before: control, after: control }],
      observations: [],
    }));
    for (const validator of [previousTrace, validateTraceSchema]) {
      let calls = 0;
      expect(() =>
        finish(
          validator(trace, () => {
            if (++calls === 9) throw new Error('owner-cancelled-schema-dispatch');
          }),
        ),
      ).toThrow('owner-cancelled-schema-dispatch');
      expect(calls).toBe(9);
    }
  });
});
