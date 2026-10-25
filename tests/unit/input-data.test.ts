import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ContentPackage, InputSpecEntity } from '../../web/src/content/types';
import {
  defaultDraft,
  generateInput,
  INPUT_TEXT_LIMIT,
  InputDataError,
  parseInputDraft,
  RANDOM_GENERATOR_REF,
  validateInputValues,
} from '../../web/src/engine/input-data';
import type { InputIssueCode, InputResult } from '../../web/src/engine/input-data';

const content = JSON.parse(
  readFileSync(new URL('../../项目文档/契约/02.1-内容样例.json', import.meta.url), 'utf8'),
) as ContentPackage;
function spec(id: string): InputSpecEntity {
  return content.inputSpecs.find((item) => item.id === `input.c.${id}`)!;
}
const scalar = spec('scalar-x'),
  count = spec('loop-count'),
  sequence = spec('int-sequence'),
  update = spec('array-update'),
  search = spec('sorted-search');

function failure(result: InputResult, code: InputIssueCode, field?: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected rejected input.');
  expect(result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code, ...(field ? { field } : {}) })]),
  );
  expect(result.issues.every((issue) => issue.message.length > 0)).toBe(true);
}
function generatedFailure(run: () => unknown, code: InputIssueCode) {
  try {
    run();
    throw new Error('Expected rejected generation.');
  } catch (error) {
    expect(error).toBeInstanceOf(InputDataError);
    expect((error as InputDataError).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
  }
}

describe('07.2 declared input parsing and validation', () => {
  it('round-trips all frozen examples and all 24 exercise inputs without adding derived n', () => {
    let cases = 0;
    for (const program of content.programs) {
      const inputSpec = content.inputSpecs.find((item) => item.id === program.inputRef.id)!;
      expect(parseInputDraft(inputSpec, defaultDraft(inputSpec, program.exampleInput))).toEqual({
        ok: true,
        values: program.exampleInput,
      });
    }
    for (const exercise of content.exercises) {
      const program = content.programs.find((item) => item.id === exercise.programRef.id)!,
        inputSpec = content.inputSpecs.find((item) => item.id === program.inputRef.id)!;
      for (const test of exercise.tests) {
        cases++;
        expect(parseInputDraft(inputSpec, defaultDraft(inputSpec, test.input))).toEqual({
          ok: true,
          values: test.input,
        });
      }
    }
    expect(cases).toBe(24);
    expect(defaultDraft(sequence, { values: [] })).toEqual({ values: '[]' });
    expect(defaultDraft(update, { values: [1, 2], k: 1 })).toEqual({ values: '1, 2', k: '1' });
  });

  it('accepts signed decimal digits and leading zeroes, canonicalizing zero and numbers', () => {
    expect(parseInputDraft(scalar, { x: ' +00999 ' })).toEqual({ ok: true, values: { x: 999 } });
    expect(parseInputDraft(scalar, { x: '-000' })).toEqual({ ok: true, values: { x: 0 } });
    const zero = parseInputDraft(scalar, { x: '-0' });
    if (!zero.ok) throw new Error('Expected canonical zero.');
    expect(Object.is(zero.values.x, -0)).toBe(false);
    expect(parseInputDraft(sequence, { values: ' [ -0999, +0000\t001，999 ] ' })).toEqual({
      ok: true,
      values: { values: [-999, 0, 1, 999] },
    });
  });

  it('supports commas, Chinese commas, whitespace and optional outer array brackets', () => {
    for (const text of ['1,2,3', '1，2，3', '1 2\n3', '1, 2\t3', '[1, 2, 3]', '\u00a01\u30002 3 '])
      expect(parseInputDraft(sequence, { values: text })).toEqual({
        ok: true,
        values: { values: [1, 2, 3] },
      });
  });

  it('requires explicit empty array notation and respects the nonempty update domain', () => {
    for (const text of ['', ' ', '\n\t']) {
      failure(parseInputDraft(sequence, { values: text }), 'INPUT_EMPTY', 'values');
      failure(parseInputDraft(scalar, { x: text }), 'INPUT_EMPTY', 'x');
    }
    for (const text of ['[]', ' [ \n ] ']) {
      expect(parseInputDraft(sequence, { values: text })).toEqual({
        ok: true,
        values: { values: [] },
      });
      expect(parseInputDraft(search, { values: text, target: '0' })).toEqual({
        ok: true,
        values: { values: [], target: 0 },
      });
      failure(parseInputDraft(update, { values: text, k: '0' }), 'INPUT_LENGTH', 'values');
    }
  });

  it('never drops missing comma slots, including mixed separators', () => {
    for (const text of [',1', '1,', '1,,2', '1, ,2', '1，,2', '[,]', '[1,,2]', '[1, ]'])
      failure(parseInputDraft(sequence, { values: text }), 'INPUT_INTEGER', 'values');
  });

  it('rejects nondecimal syntax, fractional/exponential values, nonnumbers and source fragments', () => {
    for (const text of [
      '1.0',
      '1.5',
      '1e2',
      'NaN',
      'Infinity',
      '-Infinity',
      '0x10',
      '0b10',
      '１２',
      '+',
      '1;return 0;',
      '[]',
    ])
      failure(parseInputDraft(scalar, { x: text }), 'INPUT_INTEGER', 'x');
    for (const text of ['[1', '1]', '[[1]]', '[1] [2]', '1;2', '1 NaN', '1 2.0', '1 2e1'])
      failure(parseInputDraft(sequence, { values: text }), 'INPUT_INTEGER', 'values');
  });

  it('reports out of range decimal input without truncating', () => {
    for (const text of ['1000', '-1000', '9007199254740993', '9'.repeat(400)])
      failure(parseInputDraft(scalar, { x: text }), 'INPUT_RANGE', 'x');
    failure(parseInputDraft(sequence, { values: '1 -1000' }), 'INPUT_RANGE', 'values');
    expect(parseInputDraft(count, { n: '0' })).toEqual({ ok: true, values: { n: 0 } });
    expect(parseInputDraft(count, { n: '30' })).toEqual({ ok: true, values: { n: 30 } });
    for (const text of ['-1', '31'])
      failure(parseInputDraft(count, { n: text }), 'INPUT_RANGE', 'n');
  });

  it('accepts 30 array elements and rejects 31 with no slicing', () => {
    const thirty = Array.from({ length: 30 }, (_, at) => at - 15);
    expect(parseInputDraft(sequence, { values: thirty.join(' ') })).toEqual({
      ok: true,
      values: { values: thirty },
    });
    failure(parseInputDraft(sequence, { values: [...thirty, 0].join(',') }), 'INPUT_LENGTH');
    failure(validateInputValues(sequence, { values: Array(31).fill(0) }), 'INPUT_LENGTH');
  });

  it('bounds raw text before trim or splitting at exactly 4096 UTF-16 code units', () => {
    expect(parseInputDraft(scalar, { x: '1'.padEnd(INPUT_TEXT_LIMIT) })).toEqual({
      ok: true,
      values: { x: 1 },
    });
    failure(
      parseInputDraft(scalar, { x: '1'.padEnd(INPUT_TEXT_LIMIT + 1) }),
      'INPUT_TEXT_LIMIT',
      'x',
    );
    failure(
      parseInputDraft(sequence, { values: '[]'.padEnd(INPUT_TEXT_LIMIT + 1) }),
      'INPUT_TEXT_LIMIT',
      'values',
    );
    failure(
      parseInputDraft(sequence, { values: '🌱'.repeat(INPUT_TEXT_LIMIT / 2 + 1) }),
      'INPUT_TEXT_LIMIT',
    );
  });

  it('rejects unknown, missing and derived fields in both draft and actual inputs', () => {
    for (const fn of [parseInputDraft, validateInputValues]) {
      failure(fn(scalar, {}), 'INPUT_MISSING_FIELD', 'x');
      failure(
        fn(sequence, { values: fn === parseInputDraft ? '[]' : [], n: 0 }),
        'INPUT_UNKNOWN_FIELD',
        'n',
      );
      failure(
        fn(scalar, { x: fn === parseInputDraft ? '1' : 1, extra: 1 }),
        'INPUT_UNKNOWN_FIELD',
        'extra',
      );
      for (const value of [null, [], 1, '1', new Date()]) failure(fn(scalar, value), 'INPUT_TYPE');
      failure(fn(scalar, JSON.parse('{"x":1,"__proto__":2}')), 'INPUT_UNKNOWN_FIELD', '__proto__');
    }
    failure(parseInputDraft(scalar, { x: 1 }), 'INPUT_TYPE', 'x');
    failure(parseInputDraft(scalar, Object.create({ x: '1' })), 'INPUT_TYPE');
  });

  it('validates runtime numeric types, sparse arrays and safe integer bounds', () => {
    for (const x of [NaN, Infinity, -Infinity, 1.5, '1', null, [], {}])
      failure(validateInputValues(scalar, { x }), 'INPUT_INTEGER', 'x');
    for (const x of [1000, -1000, Number.MAX_SAFE_INTEGER + 1])
      failure(validateInputValues(scalar, { x }), 'INPUT_RANGE', 'x');
    failure(validateInputValues(sequence, { values: '[]' }), 'INPUT_TYPE');
    const sparse: number[] = Array(3);
    sparse[0] = 1;
    sparse[2] = 2;
    failure(validateInputValues(sequence, { values: sparse }), 'INPUT_INTEGER');
    failure(validateInputValues(sequence, { values: [undefined] }), 'INPUT_INTEGER');
    failure(validateInputValues(sequence, { values: [NaN] }), 'INPUT_INTEGER');
  });

  it('checks update indices against the actual logical length, including both boundaries', () => {
    expect(parseInputDraft(update, { values: '9', k: '0' })).toEqual({
      ok: true,
      values: { values: [9], k: 0 },
    });
    expect(parseInputDraft(update, { values: '9 8', k: '1' })).toEqual({
      ok: true,
      values: { values: [9, 8], k: 1 },
    });
    failure(parseInputDraft(update, { values: '9', k: '1' }), 'INPUT_INDEX', 'k');
    failure(validateInputValues(update, { values: [9], k: 29 }), 'INPUT_INDEX', 'k');
    failure(validateInputValues(update, { values: [9], k: -1 }), 'INPUT_RANGE', 'k');
  });

  it('requires nondecreasing manual search input without silently sorting the user data', () => {
    const original = Object.freeze({ values: Object.freeze([2, 1, 3]), target: 2 });
    failure(validateInputValues(search, original), 'INPUT_ORDER', 'values');
    failure(parseInputDraft(search, { values: '2 1 3', target: '2' }), 'INPUT_ORDER', 'values');
    expect(original.values).toEqual([2, 1, 3]);
    expect(parseInputDraft(search, { values: '-999 -999 0 999', target: '-999' })).toEqual({
      ok: true,
      values: { values: [-999, -999, 0, 999], target: -999 },
    });
  });

  it('does not mutate source values and returns fresh arrays for accepted validation', () => {
    const original = Object.freeze({ values: Object.freeze([1, 2]), k: 1 });
    const result = validateInputValues(update, original);
    expect(result).toEqual({ ok: true, values: original });
    if (result.ok) expect(result.values.values).not.toBe(original.values);
    expect(defaultDraft(update, original)).toEqual({ values: '1, 2', k: '1' });
    expect(() => defaultDraft(scalar, { x: 1000 })).toThrow(InputDataError);
  });
});

describe('generator.c.p0-input@1.0.0 reproducible data (independent Python integer vectors)', () => {
  it('matches fixed FNV/xorshift output vectors for ASCII and Unicode UTF-8 seeds', () => {
    expect(generateInput(sequence, 'seed', 5)).toEqual({
      values: { values: [-948, -96, -177, 813, 509] },
      random: { generatorRef: { id: 'generator.c.p0-input', version: '1.0.0' }, seed: 'seed' },
    });
    expect(generateInput(sequence, '教学🌱', 5).values).toEqual({
      values: [649, 909, -808, 675, -135],
    });
    expect(generateInput(scalar, '0').values).toEqual({ x: -506 });
    expect(generateInput(count, 'seed').values).toEqual({ n: 12 });
  });

  it('consumes a length draw only when length was omitted', () => {
    expect(generateInput(sequence, 'seed').values).toEqual({
      values: [-96, -177, 813, 509, 760, -438, -396, 437, -881, -818, 345, 363],
    });
    expect(generateInput(sequence, ' ', 0).values).toEqual({ values: [] });
    expect(generateInput(sequence, ' ').values).toEqual({ values: [192, 528] });
  });

  it('sorts only generated search data and draws the target after the original array elements', () => {
    expect(generateInput(search, 'seed', 5).values).toEqual({
      values: [-948, -177, -96, 509, 813],
      target: 760,
    });
    expect(generateInput(search, '教学🌱', 5).values).toEqual({
      values: [-808, -135, 649, 675, 909],
      target: 79,
    });
    expect(generateInput(search, 'seed', 0).values).toEqual({ values: [], target: -948 });
  });

  it('rejects unsigned samples beyond the interval boundary, avoiding modulo bias', () => {
    // Python: FNV=2334636484; first sample=4294966955 >= 4294965443;
    // second sample=91834750; -999 + 91834750 % 1999 = -309.
    expect(generateInput(scalar, 'reject-4125267').values).toEqual({ x: -309 });
    expect(generateInput(sequence, 'reject-4125267', 1).values).toEqual({ values: [-309] });
  });

  it('uses the fixed nonzero fallback for a zero FNV hash', () => {
    // Independently inverted FNV over printable ASCII: hash('+!=yG') = 0.
    expect(generateInput(sequence, '+!=yG', 5).values).toEqual({
      values: [-67, 783, -825, 358, -981],
    });
  });

  it('does not normalize or trim seed text', () => {
    expect(generateInput(scalar, ' ').values).toEqual({ x: 114 });
    expect(generateInput(scalar, 'é').values).toEqual({ x: 655 });
    expect(generateInput(scalar, 'e\u0301').values).toEqual({ x: 344 });
    expect(generateInput(scalar, ' seed').random.seed).toBe(' seed');
    expect(generateInput(scalar, 'seed ')).not.toEqual(generateInput(scalar, 'seed'));
  });

  it('accepts one to 128 Unicode scalars, rejects empty, invalid surrogate and overlong seeds', () => {
    expect(generateInput(scalar, '🌱'.repeat(128)).random.seed).toBe('🌱'.repeat(128));
    expect(generateInput(scalar, '\u0000').random.seed).toBe('\u0000');
    for (const seed of ['', 'a'.repeat(129), '🌱'.repeat(129), '\ud800', '\udfff', 'a\ud800b'])
      generatedFailure(() => generateInput(scalar, seed), 'INPUT_SEED');
    generatedFailure(() => generateInput(scalar, 5 as unknown as string), 'INPUT_SEED');
  });

  it('rejects invalid lengths and nonarray length options instead of silently clamping', () => {
    for (const length of [-1, 31, 1.5, NaN, Infinity, '3' as unknown as number])
      generatedFailure(() => generateInput(sequence, 'seed', length), 'INPUT_RANDOM_LENGTH');
    generatedFailure(() => generateInput(update, 'seed', 0), 'INPUT_RANDOM_LENGTH');
    generatedFailure(() => generateInput(scalar, 'seed', 3), 'INPUT_RANDOM_LENGTH');
  });

  it('generates actual-length indices without an extra discarded index draw or derived fields', () => {
    // After 5 element samples the sixth raw sample is 168741347, so k=2.
    expect(generateInput(update, 'seed', 5).values).toEqual({
      values: [-948, -96, -177, 813, 509],
      k: 2,
    });
    expect(generateInput(update, 'seed', 1).values).toEqual({ values: [-948], k: 0 });
    expect(Object.keys(generateInput(update, 'seed', 30).values)).toEqual(['values', 'k']);
  });

  it('validates every generated result and all allowed lengths across multiple seeds', () => {
    const seeds = ['0', 'seed', '教学🌱', ' ', '+!=yG', 'reject-4125267'];
    for (const inputSpec of content.inputSpecs)
      for (const seed of seeds) {
        const generated = generateInput(inputSpec, seed);
        expect(validateInputValues(inputSpec, generated.values)).toEqual({
          ok: true,
          values: generated.values,
        });
        expect(generateInput(inputSpec, seed)).toEqual(generated);
        if (!inputSpec.fields.some((field) => field.kind === 'sequence')) continue;
        for (let length = inputSpec.id === update.id ? 1 : 0; length <= 30; length++) {
          const result = generateInput(inputSpec, seed, length);
          expect(validateInputValues(inputSpec, result.values).ok).toBe(true);
          expect(result.values.values).toHaveLength(length);
          expect(parseInputDraft(inputSpec, defaultDraft(inputSpec, result.values))).toEqual({
            ok: true,
            values: result.values,
          });
        }
      }
  });

  it('uses no ambient randomness and keeps independent reproducible return objects', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Ambient RNG prohibited');
    });
    try {
      const first = generateInput(sequence, 'seed', 5),
        second = generateInput(sequence, 'seed', 5);
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(first.values.values).not.toBe(second.values.values);
      expect(first.random.generatorRef).not.toBe(second.random.generatorRef);
      expect(first.random.generatorRef).toEqual(RANDOM_GENERATOR_REF);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
});
