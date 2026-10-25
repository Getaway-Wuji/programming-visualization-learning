import type { InputField, InputSpecEntity, InputValues } from '../content/types';

export const INPUT_TEXT_LIMIT = 4096;
export const RANDOM_GENERATOR_REF = Object.freeze({
  id: 'generator.c.p0-input',
  version: '1.0.0',
} as const);

export type InputDraft = Readonly<Record<string, string>>;
export type InputIssueCode =
  | 'INPUT_MISSING_FIELD'
  | 'INPUT_UNKNOWN_FIELD'
  | 'INPUT_TYPE'
  | 'INPUT_EMPTY'
  | 'INPUT_INTEGER'
  | 'INPUT_RANGE'
  | 'INPUT_LENGTH'
  | 'INPUT_INDEX'
  | 'INPUT_ORDER'
  | 'INPUT_TEXT_LIMIT'
  | 'INPUT_SEED'
  | 'INPUT_RANDOM_LENGTH';
export interface InputIssue {
  field: string;
  code: InputIssueCode;
  message: string;
}
export type InputResult = { ok: true; values: InputValues } | { ok: false; issues: InputIssue[] };
export interface RandomInput {
  values: InputValues;
  random: { generatorRef: typeof RANDOM_GENERATOR_REF; seed: string };
}
export class InputDataError extends Error {
  readonly issues: InputIssue[];
  constructor(issues: InputIssue[]) {
    super(issues[0]?.message ?? '输入无效。');
    this.name = 'InputDataError';
    this.issues = issues;
  }
}

function issue(field: string, code: InputIssueCode, message: string): InputIssue {
  return { field, code, message };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function checkKeys(spec: InputSpecEntity, value: Record<string, unknown>): InputIssue[] {
  const expected = new Set(spec.fields.map((field) => field.key));
  const issues: InputIssue[] = [];
  for (const key of Reflect.ownKeys(value))
    if (typeof key !== 'string' || !expected.has(key))
      issues.push(issue(String(key), 'INPUT_UNKNOWN_FIELD', '包含未声明的输入参数。'));
  for (const field of spec.fields)
    if (!Object.hasOwn(value, field.key))
      issues.push(issue(field.key, 'INPUT_MISSING_FIELD', `缺少参数 ${field.key}。`));
  return issues;
}
function integerIssue(field: InputField, value: unknown, index?: number): InputIssue | null {
  const label = index === undefined ? field.key : `${field.key} 第 ${index + 1} 项`;
  if (typeof value !== 'number' || !Number.isInteger(value))
    return issue(field.key, 'INPUT_INTEGER', `${label} 必须是十进制整数。`);
  if (!Number.isSafeInteger(value) || value < field.min || value > field.max)
    return issue(field.key, 'INPUT_RANGE', `${label} 必须在 ${field.min} 到 ${field.max} 之间。`);
  return null;
}

// Only declared fields are supplied by the user. A length-of target belongs to
// Rust's source preparation and must never be a second editable input here.
export function validateInputValues(spec: InputSpecEntity, input: unknown): InputResult {
  if (!isRecord(input))
    return { ok: false, issues: [issue('input', 'INPUT_TYPE', '输入必须是参数对象。')] };
  const issues = checkKeys(spec, input);
  const values: Record<string, number | number[]> = {};
  for (const field of spec.fields) {
    if (!Object.hasOwn(input, field.key)) continue;
    const item = input[field.key];
    if (field.kind === 'integer') {
      const problem = integerIssue(field, item);
      if (problem) issues.push(problem);
      else values[field.key] = item === 0 ? 0 : (item as number);
      continue;
    }
    if (!Array.isArray(item)) {
      issues.push(issue(field.key, 'INPUT_TYPE', `${field.key} 必须是整数数组。`));
      continue;
    }
    const min = field.minItems ?? 0,
      max = field.maxItems ?? 30;
    if (item.length < min || item.length > max) {
      issues.push(
        issue(field.key, 'INPUT_LENGTH', `${field.key} 的长度必须在 ${min} 到 ${max} 项之间。`),
      );
      continue;
    }
    const sequence: number[] = [];
    for (let at = 0; at < item.length; at++) {
      const problem = integerIssue(field, Object.hasOwn(item, at) ? item[at] : undefined, at);
      if (problem) issues.push(problem);
      else sequence.push(item[at] === 0 ? 0 : item[at]);
    }
    if (sequence.length === item.length) values[field.key] = sequence;
  }
  for (const relation of spec.relations) {
    const item = values[relation.field];
    if (relation.kind === 'index-in') {
      const target = values[relation.target ?? ''];
      if (typeof item === 'number' && Array.isArray(target) && (item < 0 || item >= target.length))
        issues.push(
          issue(
            relation.field,
            'INPUT_INDEX',
            `${relation.field} 必须满足 0 ≤ ${relation.field} < ${target.length}（实际数组长度）。`,
          ),
        );
    } else if (
      relation.kind === 'nondecreasing' &&
      Array.isArray(item) &&
      item.some((number, at) => at > 0 && number < item[at - 1])
    )
      issues.push(
        issue(
          relation.field,
          'INPUT_ORDER',
          `${relation.field} 必须按非递减顺序输入，允许重复值。`,
        ),
      );
  }
  return issues.length ? { ok: false, issues } : { ok: true, values };
}

export function defaultDraft(spec: InputSpecEntity, input: InputValues): Record<string, string> {
  const checked = validateInputValues(spec, input);
  if (!checked.ok) throw new InputDataError(checked.issues);
  return Object.fromEntries(
    spec.fields.map((field) => {
      const item = checked.values[field.key];
      return [
        field.key,
        Array.isArray(item) ? (item.length ? item.join(', ') : '[]') : String(item),
      ];
    }),
  );
}

function parseField(field: InputField, raw: string): number | number[] | InputIssue {
  if (raw.length > INPUT_TEXT_LIMIT)
    return issue(
      field.key,
      'INPUT_TEXT_LIMIT',
      `${field.key} 输入文本长度不能超过 ${INPUT_TEXT_LIMIT}。`,
    );
  let text = raw.trim();
  if (!text)
    return issue(
      field.key,
      'INPUT_EMPTY',
      field.kind === 'integer'
        ? `请输入 ${field.key} 的整数值。`
        : `请输入 ${field.key}，空数组请填写 []。`,
    );
  if (field.kind === 'integer') {
    if (!/^[+-]?[0-9]+$/.test(text))
      return issue(field.key, 'INPUT_INTEGER', `${field.key} 必须是十进制整数。`);
    const number = Number(text);
    if (!Number.isFinite(number))
      return issue(
        field.key,
        'INPUT_RANGE',
        `${field.key} 必须在 ${field.min} 到 ${field.max} 之间。`,
      );
    return integerIssue(field, number) ?? (number === 0 ? 0 : number);
  }
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1).trim();
  if (!text) return [];
  const groups = text.split(/[,，]/u);
  if (groups.some((group) => !group.trim()))
    return issue(field.key, 'INPUT_INTEGER', `${field.key} 的逗号之间不能缺少整数。`);
  const tokens = groups.flatMap((group) => group.trim().split(/\s+/u));
  if (tokens.length < (field.minItems ?? 0) || tokens.length > (field.maxItems ?? 30))
    return issue(
      field.key,
      'INPUT_LENGTH',
      `${field.key} 的长度必须在 ${field.minItems ?? 0} 到 ${field.maxItems ?? 30} 项之间。`,
    );
  const sequence: number[] = [];
  for (let at = 0; at < tokens.length; at++) {
    if (!/^[+-]?[0-9]+$/.test(tokens[at]))
      return issue(field.key, 'INPUT_INTEGER', `${field.key} 第 ${at + 1} 项必须是十进制整数。`);
    const number = Number(tokens[at]),
      problem = Number.isFinite(number)
        ? integerIssue(field, number, at)
        : issue(
            field.key,
            'INPUT_RANGE',
            `${field.key} 第 ${at + 1} 项必须在 ${field.min} 到 ${field.max} 之间。`,
          );
    if (problem) return problem;
    sequence.push(number === 0 ? 0 : number);
  }
  return sequence;
}
export function parseInputDraft(spec: InputSpecEntity, draft: unknown): InputResult {
  if (!isRecord(draft))
    return { ok: false, issues: [issue('input', 'INPUT_TYPE', '输入草稿必须是参数对象。')] };
  const issues = checkKeys(spec, draft);
  const values: Record<string, number | number[]> = {};
  for (const field of spec.fields) {
    if (!Object.hasOwn(draft, field.key)) continue;
    const raw = draft[field.key];
    if (typeof raw !== 'string') {
      issues.push(issue(field.key, 'INPUT_TYPE', `${field.key} 必须是文本输入。`));
      continue;
    }
    const parsed = parseField(field, raw);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) issues.push(parsed);
    else values[field.key] = parsed;
  }
  return issues.length ? { ok: false, issues } : validateInputValues(spec, values);
}

function seedState(seed: string): number {
  let count = 0;
  for (const character of seed) {
    const point = character.codePointAt(0)!;
    if ((point >= 0xd800 && point <= 0xdfff) || ++count > 128)
      throw new InputDataError([
        issue('seed', 'INPUT_SEED', '种子必须包含 1 到 128 个有效 Unicode 字符。'),
      ]);
  }
  if (!count)
    throw new InputDataError([
      issue('seed', 'INPUT_SEED', '种子必须包含 1 到 128 个有效 Unicode 字符。'),
    ]);
  let state = 2166136261;
  for (const byte of new TextEncoder().encode(seed))
    state = Math.imul(state ^ byte, 16777619) >>> 0;
  return state || 0x6d2b79f5;
}
function randomIntegers(seed: string): (min: number, max: number) => number {
  let state = seedState(seed);
  return (min, max) => {
    const span = max - min + 1,
      boundary = Math.floor(4294967296 / span) * span;
    if (!Number.isSafeInteger(span) || span < 1 || span > 4294967296)
      throw new InputDataError([issue('input', 'INPUT_RANGE', '随机输入范围无效。')]);
    let sample: number;
    do {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      sample = state >>> 0;
    } while (sample >= boundary);
    return min + (sample % span);
  };
}

// generator.c.p0-input@1.0.0: UTF-8 FNV-1a32 -> xorshift32,
// rejection sampling on the full unsigned 32-bit interval. No ambient RNG.
export function generateInput(spec: InputSpecEntity, seed: string, length?: number): RandomInput {
  if (typeof seed !== 'string')
    throw new InputDataError([issue('seed', 'INPUT_SEED', '种子必须是文本。')]);
  const integer = randomIntegers(seed),
    sequences = spec.fields.filter((field) => field.kind === 'sequence');
  if (
    length !== undefined &&
    (!Number.isSafeInteger(length) ||
      length < 0 ||
      length > 30 ||
      !sequences.length ||
      sequences.some((field) => length < (field.minItems ?? 0) || length > (field.maxItems ?? 30)))
  )
    throw new InputDataError([
      issue('length', 'INPUT_RANDOM_LENGTH', '随机数组长度必须在该案例允许的 0 到 30 项范围内。'),
    ]);
  const indices = new Set(
      spec.relations
        .filter((relation) => relation.kind === 'index-in')
        .map((relation) => relation.field),
    ),
    sorted = new Set(
      spec.relations
        .filter((relation) => relation.kind === 'nondecreasing')
        .map((relation) => relation.field),
    ),
    values: Record<string, number | number[]> = {};
  for (const field of spec.fields) {
    if (indices.has(field.key)) continue;
    if (field.kind === 'integer') values[field.key] = integer(field.min, field.max);
    else {
      const count = length ?? integer(field.minItems ?? 0, field.maxItems ?? 30),
        sequence = Array.from({ length: count }, () => integer(field.min, field.max));
      if (sorted.has(field.key)) sequence.sort((a, b) => a - b);
      values[field.key] = sequence;
    }
  }
  for (const relation of spec.relations) {
    if (relation.kind !== 'index-in') continue;
    const field = spec.fields.find((candidate) => candidate.key === relation.field)!,
      target = values[relation.target ?? ''];
    if (!Array.isArray(target) || !target.length)
      throw new InputDataError([
        issue(relation.field, 'INPUT_INDEX', '数组为空，无法生成有效索引。'),
      ]);
    values[field.key] = integer(Math.max(0, field.min), Math.min(field.max, target.length - 1));
  }
  const checked = validateInputValues(spec, values);
  if (!checked.ok) throw new InputDataError(checked.issues);
  return { values: checked.values, random: { generatorRef: { ...RANDOM_GENERATOR_REF }, seed } };
}
