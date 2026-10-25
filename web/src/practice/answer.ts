import type { PreparedSource } from '../engine/execution-client';

export interface AnswerField {
  readonly name: string;
  readonly label: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly min?: number;
  readonly max?: number;
}
type Answer = Readonly<Record<string, string>>;
interface AnswerDefinition {
  fields: readonly AnswerField[];
  defaults: Answer;
  bindings: readonly string[];
}
const options = (...values: string[]) => values.map((value) => ({ value, label: value }));
const choice = (name: string, label: string, values: string[]): AnswerField => ({
  name,
  label,
  options: options(...values),
});
const integer = (name: string, label: string, min = -9, max = 9): AnswerField => ({
  name,
  label,
  min,
  max,
});
const inputStyle: AnswerField = {
  name: 'inputStyle',
  label: '读取方式',
  options: [
    { value: 'direct', label: '直接使用读取值' },
    { value: 'copy-zero', label: '复制到临时变量并加 0' },
  ],
};
const direction: AnswerField = {
  name: 'direction',
  label: '遍历方向',
  options: [
    { value: 'ascending', label: '从下界向上遍历' },
    { value: 'descending', label: '从上界向下遍历' },
  ],
};
const definitions: Record<string, AnswerDefinition> = {
  'exercise.c.echo': {
    fields: [
      {
        name: 'outputSource',
        label: '输出内容',
        options: [
          { value: 'x', label: '输入变量 x' },
          { value: 'constant', label: '下方固定数值' },
        ],
      },
      integer('constant', '固定数值'),
      inputStyle,
    ],
    defaults: { outputSource: 'constant', constant: '0', inputStyle: 'direct' },
    bindings: ['param.x'],
  },
  'exercise.c.two-x-plus-three': {
    fields: [
      integer('multiplier', '乘数'),
      integer('constant', '常数'),
      choice('operation', '乘法之后的运算', ['+', '-']),
      {
        name: 'operandOrder',
        label: '乘法操作数顺序',
        options: [
          { value: 'multiplier-first', label: '乘数在前' },
          { value: 'x-first', label: '输入 x 在前' },
        ],
      },
    ],
    defaults: { multiplier: '1', constant: '0', operation: '+', operandOrder: 'multiplier-first' },
    bindings: ['param.x'],
  },
  'exercise.c.nonnegative': {
    fields: [
      choice('comparison', 'x 与 0 的比较', ['>=', '>', '<']),
      integer('thenValue', '条件成立时输出'),
      integer('elseValue', '条件不成立时输出'),
    ],
    defaults: { comparison: '>', thenValue: '1', elseValue: '0' },
    bindings: ['param.x'],
  },
  'exercise.c.two-loop-sums': {
    fields: [
      choice('whileInitial', 'while 累加初值', ['0', '1']),
      choice('whileStart', 'while 下界（向上起值，向下终值）', ['0', '1']),
      choice('whileBoundary', 'while 端点（<= 包含，< 不包含）', ['<=', '<']),
      choice('whileOperation', 'while 累加运算', ['+', '-']),
      choice('forInitial', 'for 累加初值', ['0', '1']),
      choice('forStart', 'for 下界（向上起值，向下终值）', ['0', '1']),
      choice('forBoundary', 'for 端点（<= 包含，< 不包含）', ['<=', '<']),
      choice('forOperation', 'for 累加运算', ['+', '-']),
      direction,
    ],
    defaults: {
      whileInitial: '0',
      whileStart: '1',
      whileBoundary: '<',
      whileOperation: '+',
      forInitial: '0',
      forStart: '1',
      forBoundary: '<',
      forOperation: '+',
      direction: 'ascending',
    },
    bindings: ['param.n'],
  },
  'exercise.c.increment-at-index': {
    fields: [integer('increment', '指定元素增加的数值', -1, 2)],
    defaults: { increment: '0' },
    bindings: ['param.n', 'param.values', 'param.k'],
  },
  'exercise.c.array-sum': {
    fields: [
      choice('initial', '累加初值', ['0', '1']),
      choice('operation', '累加运算', ['+', '-']),
      inputStyle,
      direction,
    ],
    defaults: { initial: '1', operation: '+', inputStyle: 'direct', direction: 'ascending' },
    bindings: ['param.n', 'param.values'],
  },
};
// UI consumers cannot silently change the finite generation vocabulary.
for (const definition of Object.values(definitions)) {
  for (const field of definition.fields) {
    field.options?.forEach(Object.freeze);
    if (field.options) Object.freeze(field.options);
    Object.freeze(field);
  }
  Object.freeze(definition.fields);
  Object.freeze(definition.defaults);
  Object.freeze(definition.bindings);
  Object.freeze(definition);
}
Object.freeze(definitions);

function definitionFor(exerciseId: string): AnswerDefinition {
  if (!Object.hasOwn(definitions, exerciseId)) throw new Error('ANSWER_UNSUPPORTED');
  return definitions[exerciseId];
}

export function answerFields(exerciseId: string): readonly AnswerField[] {
  return definitionFor(exerciseId).fields;
}

export function defaultAnswer(exerciseId: string): Record<string, string> {
  return { ...definitionFor(exerciseId).defaults };
}

function validateAnswer(definition: AnswerDefinition, answer: Answer) {
  if (
    !answer ||
    typeof answer !== 'object' ||
    Array.isArray(answer) ||
    Object.keys(answer).length !== definition.fields.length
  )
    throw new Error('ANSWER_INVALID');
  for (const field of definition.fields) {
    if (!Object.hasOwn(answer, field.name)) throw new Error('ANSWER_INVALID');
    const value = answer[field.name];
    if (typeof value !== 'string') throw new Error('ANSWER_INVALID');
    if (field.options) {
      // Option keys such as "multiplier-first" are longer than numeric input.
      if (!field.options.some((option) => option.value === value))
        throw new Error('ANSWER_INVALID');
    } else if (
      value.length > 4 ||
      !/^(?:0|-?[1-9]\d*)$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < field.min! ||
      Number(value) > field.max!
    )
      throw new Error('ANSWER_INVALID');
  }
}

/**
 * Assemble finite lesson answers, never parse or execute C. The input prefix
 * and its declaration ranges are borrowed from Rust's accepted preparation.
 */
export function generateAnswer(
  exerciseId: string,
  prepared: PreparedSource,
  answer: Answer,
): PreparedSource {
  const definition = definitionFor(exerciseId);
  validateAnswer(definition, answer);
  const encoder = new TextEncoder();
  const sourceBytes = encoder.encode(prepared.text);
  if (
    sourceBytes.byteLength > 32768 ||
    new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes) !== prepared.text ||
    prepared.bindingMap.length !== definition.bindings.length
  )
    throw new Error('ANSWER_PREPARATION_INVALID');
  const keys = new Set<string>();
  let prefixEnd = 0;
  const ranges = [...prepared.bindingMap].sort((a, b) => a.byteRange.start - b.byteRange.start);
  for (const binding of ranges) {
    const { start, end } = binding.byteRange;
    if (
      !definition.bindings.includes(binding.bindingKey) ||
      keys.has(binding.bindingKey) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < prefixEnd ||
      end <= start ||
      end > sourceBytes.byteLength
    )
      throw new Error('ANSWER_PREPARATION_INVALID');
    // Ensure neither bound splits a UTF-8 scalar. No C text is interpreted.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes.subarray(0, start));
      new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes.subarray(start, end));
    } catch {
      throw new Error('ANSWER_PREPARATION_INVALID');
    }
    keys.add(binding.bindingKey);
    prefixEnd = end;
  }
  let text = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes.subarray(0, prefixEnd));
  const blockMap: PreparedSource['blockMap'] = [];
  const append = (part: string) => (text += part);
  const control = (blockId: string, part: string) => {
    const start = encoder.encode(text).byteLength;
    append(part);
    blockMap.push({ blockId, byteRange: { start, end: encoder.encode(text).byteLength } });
  };
  append('\n');
  if (exerciseId === 'exercise.c.echo') {
    if (answer.inputStyle === 'copy-zero') append('    int answerValue = x + 0;\n');
    const value =
      answer.outputSource === 'constant'
        ? answer.constant
        : answer.inputStyle === 'copy-zero'
          ? 'answerValue'
          : 'x';
    append(`    printf("%d\\n", ${value});\n`);
  } else if (exerciseId === 'exercise.c.two-x-plus-three') {
    const multiplication =
      answer.operandOrder === 'x-first' ? `x * ${answer.multiplier}` : `${answer.multiplier} * x`;
    append(`    int result = (${multiplication}) ${answer.operation} ${answer.constant};\n`);
    append('    printf("%d\\n", result);\n');
  } else if (exerciseId === 'exercise.c.nonnegative') {
    append('    ');
    control(
      'answer.if',
      `if (x ${answer.comparison} 0) {\n` +
        `        printf("%d\\n", ${answer.thenValue});\n` +
        '    } else {\n' +
        `        printf("%d\\n", ${answer.elseValue});\n` +
        '    }',
    );
    append('\n');
  } else if (exerciseId === 'exercise.c.two-loop-sums') {
    const descending = answer.direction === 'descending';
    const step = descending ? '-' : '+';
    const initial = (start: string) => (descending ? 'n' : start);
    const condition = (variable: string, start: string, boundary: string) =>
      descending
        ? `${variable} ${boundary === '<=' ? '>=' : '>'} ${start}`
        : `${variable} ${boundary} n`;
    append(`    int i = ${initial(answer.whileStart)};\n`);
    append(`    int sumWhile = ${answer.whileInitial};\n    `);
    control(
      'answer.while',
      `while (${condition('i', answer.whileStart, answer.whileBoundary)}) {\n` +
        `        sumWhile = sumWhile ${answer.whileOperation} i;\n` +
        `        i = i ${step} 1;\n` +
        '    }',
    );
    append(`\n    int sumFor = ${answer.forInitial};\n    `);
    control(
      'answer.for',
      `for (int j = ${initial(answer.forStart)}; ${condition('j', answer.forStart, answer.forBoundary)}; j = j ${step} 1) {\n` +
        `        sumFor = sumFor ${answer.forOperation} j;\n` +
        '    }',
    );
    append('\n    printf("%d\\n%d\\n", sumWhile, sumFor);\n');
  } else if (exerciseId === 'exercise.c.increment-at-index') {
    append(`    values[k] = values[k] + ${answer.increment};\n`);
    append('    printf("%d\\n", values[k]);\n');
  } else if (exerciseId === 'exercise.c.array-sum') {
    const descending = answer.direction === 'descending';
    append(`    int sum = ${answer.initial};\n    `);
    const loop = descending
      ? 'for (int i = n - 1; i >= 0; i = i - 1)'
      : 'for (int i = 0; i < n; i = i + 1)';
    const body =
      answer.inputStyle === 'copy-zero'
        ? '        int item = values[i] + 0;\n' + `        sum = sum ${answer.operation} item;\n`
        : `        sum = sum ${answer.operation} values[i];\n`;
    control('answer.loop', `${loop} {\n${body}    }`);
    append('\n    printf("%d\\n", sum);\n');
  }
  append('    return 0;\n}\n');
  if (encoder.encode(text).byteLength > 32768) throw new Error('ANSWER_SOURCE_LIMIT');
  return {
    text,
    bindingMap: prepared.bindingMap.map(({ bindingKey, byteRange }) => ({
      bindingKey,
      byteRange: { ...byteRange },
    })),
    blockMap,
  };
}
