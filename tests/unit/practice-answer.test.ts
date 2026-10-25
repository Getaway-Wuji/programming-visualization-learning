import { describe, expect, it } from 'vitest';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import { answerFields, defaultAnswer, generateAnswer } from '../../web/src/practice/answer';

const ids = [
  'exercise.c.echo',
  'exercise.c.two-x-plus-three',
  'exercise.c.nonnegative',
  'exercise.c.two-loop-sums',
  'exercise.c.increment-at-index',
  'exercise.c.array-sum',
] as const;
const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).byteLength;

// Deliberately synthetic preparation for text/range tests only. Actual Rust
// preparation, execution and teaching judgement are separate integration gates.
function preparation(
  declarations: readonly [string, string][],
  lead = '#include <stdio.h>\nint main(void) {\n',
): PreparedSource {
  let text = lead;
  const bindingMap: PreparedSource['bindingMap'] = [];
  for (const [bindingKey, declaration] of declarations) {
    text += '    ';
    const start = byteLength(text);
    text += declaration;
    bindingMap.push({ bindingKey, byteRange: { start, end: byteLength(text) } });
    text += '\n';
  }
  text += '    printf("OLD_BODY\\n");\n    return 0;\n}\n';
  return { text, bindingMap, blockMap: [] };
}
function preparedFor(id: string) {
  if (id === 'exercise.c.two-loop-sums') return preparation([['param.n', 'int n = 5;']]);
  if (id === 'exercise.c.increment-at-index')
    return preparation([
      ['param.n', 'int n = 3;'],
      ['param.values', 'int values[3] = {4, 0, -2};'],
      ['param.k', 'int k = 1;'],
    ]);
  if (id === 'exercise.c.array-sum')
    return preparation([
      ['param.n', 'int n = 3;'],
      ['param.values', 'int values[3] = {3, -1, 2};'],
    ]);
  return preparation([['param.x', 'int x = 7;']]);
}
function blockText(source: PreparedSource, blockId: string) {
  const map = source.blockMap.find((item) => item.blockId === blockId)!;
  expect(map).toBeDefined();
  return new TextDecoder('utf-8', { fatal: true }).decode(
    encoder.encode(source.text).subarray(map.byteRange.start, map.byteRange.end),
  );
}

describe('09.3 finite answer generation', () => {
  it('offers exactly six finite lessons and independent default drafts', () => {
    for (const id of ids) {
      const fields = answerFields(id);
      const draft = defaultAnswer(id);
      expect(fields.map((field) => field.name).sort()).toEqual(Object.keys(draft).sort());
      expect(new Set(fields.map((field) => field.name)).size).toBe(fields.length);
      expect(Object.isFrozen(fields)).toBe(true);
      expect(fields.every((field) => Object.isFrozen(field))).toBe(true);
      expect(
        fields.every(
          (field) => field.options || (field.min !== undefined && field.max !== undefined),
        ),
      ).toBe(true);
      draft[fields[0].name] = 'changed';
      expect(defaultAnswer(id)[fields[0].name]).not.toBe('changed');
      expect(() => generateAnswer(id, preparedFor(id), defaultAnswer(id))).not.toThrow();
    }
  });

  it('preserves the exact UTF-8 input prefix and leaves preparation unmodified', () => {
    const prepared = preparation(
      [['param.x', 'int x = -999;']],
      '#include <stdio.h>\n/* 中文输入 🧩 */\nint main(void) {\n',
    );
    const before = structuredClone(prepared);
    const end = prepared.bindingMap[0].byteRange.end;
    const source = generateAnswer('exercise.c.echo', prepared, {
      outputSource: 'x',
      constant: '0',
      inputStyle: 'copy-zero',
    });
    expect(encoder.encode(source.text).slice(0, end)).toEqual(
      encoder.encode(prepared.text).slice(0, end),
    );
    expect(source.text).toContain('/* 中文输入 🧩 */');
    expect(source.text).toContain('int answerValue = x + 0;');
    expect(source.text).toContain('printf("%d\\n", answerValue);');
    expect(source.text).not.toContain('OLD_BODY');
    expect(prepared).toEqual(before);
    expect(source.bindingMap).toEqual(prepared.bindingMap);
    expect(source.bindingMap).not.toBe(prepared.bindingMap);
    source.bindingMap[0].byteRange.end = 1;
    expect(prepared).toEqual(before);
  });

  it('keeps all array/length/index bindings even when metadata order differs', () => {
    const prepared = preparedFor('exercise.c.increment-at-index');
    prepared.bindingMap.reverse();
    const source = generateAnswer('exercise.c.increment-at-index', prepared, { increment: '1' });
    expect(source.bindingMap).toEqual(prepared.bindingMap);
    expect(source.text).toContain('int n = 3;\n    int values[3] = {4, 0, -2};\n    int k = 1;');
    expect(source.text).toContain('values[k] = values[k] + 1;');
    expect(source.text).toContain('printf("%d\\n", values[k]);');
  });

  it('changes real C expressions for finite choices without assigning a judge result', () => {
    const prepared = preparedFor('exercise.c.two-x-plus-three');
    const first = generateAnswer('exercise.c.two-x-plus-three', prepared, {
      multiplier: '2',
      constant: '3',
      operation: '+',
      operandOrder: 'multiplier-first',
    });
    const swapped = generateAnswer('exercise.c.two-x-plus-three', prepared, {
      multiplier: '2',
      constant: '3',
      operation: '+',
      operandOrder: 'x-first',
    });
    const alternate = generateAnswer('exercise.c.two-x-plus-three', prepared, {
      multiplier: '2',
      constant: '-3',
      operation: '-',
      operandOrder: 'x-first',
    });
    expect(first.text).toContain('(2 * x) + 3');
    expect(swapped.text).toContain('(x * 2) + 3');
    expect(alternate.text).toContain('(x * 2) - -3');
    expect(first.text).not.toBe(swapped.text);
    expect(Object.keys(first).sort()).toEqual(['bindingMap', 'blockMap', 'text']);
  });

  it('maps the whole if/else to a stable site across different input widths', () => {
    const answer = { comparison: '>=', thenValue: '1', elseValue: '0' };
    const small = generateAnswer(
      'exercise.c.nonnegative',
      preparation([['param.x', 'int x = 0;']]),
      answer,
    );
    const large = generateAnswer(
      'exercise.c.nonnegative',
      preparation([['param.x', 'int x = -999;']]),
      answer,
    );
    expect(small.blockMap.map((item) => item.blockId)).toEqual(['answer.if']);
    expect(large.blockMap[0].byteRange.start).not.toBe(small.blockMap[0].byteRange.start);
    const control = blockText(small, 'answer.if');
    expect(control).toBe(
      'if (x >= 0) {\n        printf("%d\\n", 1);\n    } else {\n        printf("%d\\n", 0);\n    }',
    );
    expect(blockText(large, 'answer.if')).toBe(control);
  });

  it('uses distinct complete loop mappings and supports reversed traversal', () => {
    const prepared = preparedFor('exercise.c.two-loop-sums');
    const answer = {
      ...defaultAnswer('exercise.c.two-loop-sums'),
      whileBoundary: '<=',
      forBoundary: '<=',
    };
    const ascending = generateAnswer('exercise.c.two-loop-sums', prepared, answer);
    const descending = generateAnswer('exercise.c.two-loop-sums', prepared, {
      ...answer,
      direction: 'descending',
    });
    expect(ascending.blockMap.map((item) => item.blockId)).toEqual(['answer.while', 'answer.for']);
    expect(blockText(ascending, 'answer.while')).toMatch(/^while \(i <= n\) \{[\s\S]*\n {4}\}$/);
    expect(blockText(ascending, 'answer.for')).toMatch(
      /^for \(int j = 1; j <= n; j = j \+ 1\) \{[\s\S]*\n {4}\}$/,
    );
    expect(ascending.blockMap[0].byteRange.end).toBeLessThan(ascending.blockMap[1].byteRange.start);
    expect(descending.text).toContain('int i = n;');
    expect(blockText(descending, 'answer.while')).toContain('while (i >= 1)');
    expect(blockText(descending, 'answer.for')).toContain('for (int j = n; j >= 1; j = j - 1)');
  });

  it('supports array traversal with transparent local copying and no extra input', () => {
    const prepared = preparedFor('exercise.c.array-sum');
    const source = generateAnswer('exercise.c.array-sum', prepared, {
      initial: '0',
      operation: '+',
      inputStyle: 'copy-zero',
      direction: 'descending',
    });
    const loop = blockText(source, 'answer.loop');
    expect(loop).toContain('for (int i = n - 1; i >= 0; i = i - 1)');
    expect(loop).toContain('int item = values[i] + 0;');
    expect(loop).toContain('sum = sum + item;');
    expect(source.bindingMap).toEqual(prepared.bindingMap);
    expect(source.text).toContain('int sum = 0;');
  });

  it('rejects missing/extra/inherited fields and unknown finite options', () => {
    const id = 'exercise.c.nonnegative';
    const draft = defaultAnswer(id);
    for (const bad of [
      {},
      { ...draft, extra: '1' },
      { ...draft, comparison: '==' },
      { ...draft, comparison: '>= 0) { return 0; } //' },
      Object.assign(Object.create({ comparison: '>=' }), { thenValue: '1', elseValue: '0' }),
    ])
      expect(() => generateAnswer(id, preparedFor(id), bad)).toThrow('ANSWER_INVALID');
  });

  it('accepts declared integer endpoints and rejects noncanonical or out-of-range text', () => {
    const id = 'exercise.c.echo';
    for (const constant of ['-9', '0', '9'])
      expect(
        generateAnswer(id, preparedFor(id), { ...defaultAnswer(id), constant }).text,
      ).toContain(`, ${constant});`);
    for (const constant of [
      '',
      ' ',
      ' 1',
      '1 ',
      '+1',
      '-0',
      '01',
      '1.0',
      '1e0',
      '-10',
      '10',
      '0; return 0',
    ])
      expect(() => generateAnswer(id, preparedFor(id), { ...defaultAnswer(id), constant })).toThrow(
        'ANSWER_INVALID',
      );
    for (const increment of ['-2', '3'])
      expect(() =>
        generateAnswer(
          'exercise.c.increment-at-index',
          preparedFor('exercise.c.increment-at-index'),
          { increment },
        ),
      ).toThrow('ANSWER_INVALID');
  });

  it('rejects malformed input identities/ranges and split UTF-8 boundaries', () => {
    const id = 'exercise.c.echo';
    const prepared = preparedFor(id);
    const mutations: PreparedSource[] = [
      { ...prepared, bindingMap: [] },
      { ...prepared, bindingMap: [{ ...prepared.bindingMap[0], bindingKey: 'param.other' }] },
      { ...prepared, bindingMap: [{ bindingKey: 'param.x', byteRange: { start: -1, end: 1 } }] },
      { ...prepared, bindingMap: [{ bindingKey: 'param.x', byteRange: { start: 1, end: 99999 } }] },
      { ...prepared, bindingMap: [{ bindingKey: 'param.x', byteRange: { start: 1, end: 1 } }] },
      { ...prepared, text: '\ud800' + prepared.text },
      { ...prepared, text: 'x'.repeat(32769) },
      {
        text: '中int x = 0;',
        blockMap: [],
        bindingMap: [{ bindingKey: 'param.x', byteRange: { start: 1, end: 5 } }],
      },
    ];
    for (const bad of mutations)
      expect(() => generateAnswer(id, bad, defaultAnswer(id))).toThrow(
        'ANSWER_PREPARATION_INVALID',
      );
    const array = preparedFor('exercise.c.increment-at-index');
    array.bindingMap[1].bindingKey = 'param.n';
    expect(() =>
      generateAnswer(
        'exercise.c.increment-at-index',
        array,
        defaultAnswer('exercise.c.increment-at-index'),
      ),
    ).toThrow('ANSWER_PREPARATION_INVALID');
  });

  it('refuses unsupported exercises and oversize generated sources', () => {
    expect(() => answerFields('exercise.custom')).toThrow('ANSWER_UNSUPPORTED');
    expect(() => defaultAnswer('constructor')).toThrow('ANSWER_UNSUPPORTED');
    expect(() => generateAnswer('exercise.custom', preparedFor(ids[0]), {})).toThrow(
      'ANSWER_UNSUPPORTED',
    );
    const padding = ' '.repeat(32680);
    const prepared = preparation([['param.x', 'int x = 7;']], padding + 'int main(void) {\n');
    expect(byteLength(prepared.text)).toBeLessThanOrEqual(32768);
    expect(() =>
      generateAnswer(ids[0], prepared, { ...defaultAnswer(ids[0]), inputStyle: 'copy-zero' }),
    ).toThrow('ANSWER_SOURCE_LIMIT');
  });
});
