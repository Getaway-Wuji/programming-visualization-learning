import type { InputBinding } from '../content/types';
import type { PreparedSource } from '../engine/execution-client';
import {
  BLOCK_LIMITS,
  type BlockExpression,
  type BlockProgram,
  type BlockStatement,
} from './model';

export type BlockErrorCode =
  | 'BLOCK_SHAPE'
  | 'BLOCK_LIMIT'
  | 'BLOCK_ID'
  | 'BLOCK_NAME'
  | 'BLOCK_REFERENCE'
  | 'BLOCK_DUPLICATE'
  | 'BLOCK_INTEGER'
  | 'BLOCK_FORMAT'
  | 'BLOCK_LOOP'
  | 'BLOCK_INPUT'
  | 'BLOCK_PREPARATION'
  | 'BLOCK_SOURCE_LIMIT';

export class BlockGenerationError extends Error {
  constructor(
    public readonly code: BlockErrorCode,
    public readonly blockId: string | null = null,
  ) {
    super(code);
    this.name = 'BlockGenerationError';
  }
}

type Scope = Map<string, 'scalar' | 'array'>;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const keywords = new Set([
  'auto',
  'break',
  'case',
  'char',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extern',
  'float',
  'for',
  'goto',
  'if',
  'inline',
  'int',
  'long',
  'register',
  'restrict',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'typedef',
  'union',
  'unsigned',
  'void',
  'volatile',
  'while',
  'main',
  'printf',
]);
function fail(code: BlockErrorCode, id: string | null = null): never {
  throw new BlockGenerationError(code, id);
}
function identifier(value: unknown, id: string | null): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value) || keywords.has(value))
    fail('BLOCK_NAME', id);
}
function unsigned(value: unknown, id: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > 10 ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    Number(value) > 2147483647
  )
    fail('BLOCK_INTEGER', id);
}
function signed(value: unknown, id: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 11 ||
    !/^[+-]?(0|[1-9]\d*)$/.test(value) ||
    Math.abs(Number(value)) > 2147483647
  )
    fail('BLOCK_INTEGER', id);
  return String(Number(value));
}
function formatLiteral(value: unknown, args: unknown, id: string): string {
  if (
    typeof value !== 'string' ||
    !Array.isArray(args) ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0)!;
      return (code < 32 && code !== 10) || code === 127;
    })
  )
    fail('BLOCK_FORMAT', id);
  if (decoder.decode(encoder.encode(value)) !== value) fail('BLOCK_FORMAT', id);
  let count = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '%') continue;
    const next = value[++index];
    if (next === 'd') count++;
    else if (next !== '%') fail('BLOCK_FORMAT', id);
  }
  if (count !== args.length) fail('BLOCK_FORMAT', id);
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

/**
 * Generate text and byte ranges together. Rust remains the only C parser and
 * executor; these checks validate the finite block vocabulary and connections.
 * The accepted Rust input declarations are copied byte for byte, never rebuilt.
 */
export function generateBlockSource(
  program: BlockProgram,
  prepared: PreparedSource,
  programBindings: readonly InputBinding[],
): PreparedSource {
  let currentId: string | null = null;
  const ids = new Set<string>();
  let count = 0;
  const node = (value: unknown, kind: string, fields: readonly string[], depth: number): string => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('BLOCK_SHAPE', currentId);
    const record = value as Record<string, unknown>;
    currentId = typeof record.id === 'string' ? record.id : null;
    if (
      record.kind !== kind ||
      Object.keys(record).length !== fields.length + 2 ||
      !['id', 'kind', ...fields].every((key) => Object.hasOwn(record, key))
    )
      fail('BLOCK_SHAPE', currentId);
    if (
      typeof record.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(record.id) ||
      ids.has(record.id)
    )
      fail('BLOCK_ID', currentId);
    if (++count > BLOCK_LIMITS.nodes || depth > BLOCK_LIMITS.depth) fail('BLOCK_LIMIT', currentId);
    ids.add(record.id);
    return record.id;
  };
  node(program, 'main', ['body'], 0);
  if (
    !Array.isArray(program.body) ||
    !Array.isArray(programBindings) ||
    !prepared ||
    typeof prepared.text !== 'string' ||
    !Array.isArray(prepared.bindingMap)
  )
    fail('BLOCK_PREPARATION');
  const bytes = encoder.encode(prepared.text);
  if (
    bytes.byteLength > BLOCK_LIMITS.sourceBytes ||
    decoder.decode(bytes) !== prepared.text ||
    prepared.bindingMap.length !== programBindings.length
  )
    fail('BLOCK_PREPARATION');
  if (prepared.bindingMap.some((entry) => !entry || typeof entry !== 'object' || !entry.byteRange))
    fail('BLOCK_PREPARATION');
  const rangeBindings = [...prepared.bindingMap].sort(
    (a, b) => a.byteRange.start - b.byteRange.start,
  );
  const bindingKeys = new Set<string>();
  let prefixEnd = 0;
  for (const entry of rangeBindings) {
    const { start, end } = entry.byteRange;
    const binding = programBindings.filter((item) => item.bindingKey === entry.bindingKey);
    if (
      binding.length !== 1 ||
      bindingKeys.has(entry.bindingKey) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < prefixEnd ||
      end <= start ||
      end > bytes.byteLength
    )
      fail('BLOCK_PREPARATION');
    if (
      (bytes[start - 1] === 13 && bytes[start] === 10) ||
      (bytes[end - 1] === 13 && bytes[end] === 10)
    )
      fail('BLOCK_PREPARATION');
    try {
      decoder.decode(bytes.subarray(0, start));
      decoder.decode(bytes.subarray(start, end));
    } catch {
      fail('BLOCK_PREPARATION');
    }
    bindingKeys.add(entry.bindingKey);
    prefixEnd = end;
  }
  const blockMap: PreparedSource['blockMap'] = [];
  let text = prefixEnd
    ? decoder.decode(bytes.subarray(0, prefixEnd)) + '\n'
    : '#include <stdio.h>\nint main(void) {\n';
  let offset = encoder.encode(text).byteLength;
  const append = (part: string) => {
    text += part;
    offset += encoder.encode(part).byteLength;
    if (offset > BLOCK_LIMITS.sourceBytes) fail('BLOCK_SOURCE_LIMIT', currentId);
  };
  const mapped = (id: string, render: () => void) => {
    const start = offset;
    render();
    blockMap.push({ blockId: id, byteRange: { start, end: offset } });
  };
  const rootScope: Scope = new Map();
  const declare = (
    scope: Scope,
    local: Set<string>,
    name: string,
    type: 'scalar' | 'array',
    id: string,
  ) => {
    identifier(name, id);
    if (local.has(name)) fail('BLOCK_DUPLICATE', id);
    local.add(name);
    scope.set(name, type);
  };
  const reference = (scope: Scope, name: string, type: 'scalar' | 'array', id: string) => {
    identifier(name, id);
    if (scope.get(name) !== type) fail('BLOCK_REFERENCE', id);
  };
  const rootLocal = new Set<string>();
  for (const [index, entry] of rangeBindings.entries()) {
    const input = program.body[index];
    if (!input || input.kind !== 'input') fail('BLOCK_INPUT', program.id);
    const id = node(input, 'input', ['bindingKey', 'name', 'targetKind'], 1);
    const binding = programBindings.find((item) => item.bindingKey === entry.bindingKey)!;
    if (
      input.bindingKey !== entry.bindingKey ||
      input.name !== binding.targetName ||
      input.targetKind !== binding.targetKind
    )
      fail('BLOCK_INPUT', id);
    declare(
      rootScope,
      rootLocal,
      input.name,
      input.targetKind === 'array' ? 'array' : 'scalar',
      id,
    );
    blockMap.push({ blockId: id, byteRange: { ...entry.byteRange } });
  }

  const expression = (value: BlockExpression, scope: Scope, depth: number, astDepth = 1): void => {
    if (!value || typeof value !== 'object') fail('BLOCK_SHAPE', currentId);
    const fields =
      value.kind === 'integer'
        ? ['value']
        : value.kind === 'variable'
          ? ['name']
          : value.kind === 'unary'
            ? ['operator', 'operand']
            : value.kind === 'array_read'
              ? ['name', 'index']
              : ['operator', 'left', 'right'];
    const id = node(value, value.kind, fields, depth);
    if (astDepth > BLOCK_LIMITS.depth) fail('BLOCK_LIMIT', id);
    mapped(id, () => {
      switch (value.kind) {
        case 'integer':
          unsigned(value.value, id);
          append(value.value);
          break;
        case 'variable':
          reference(scope, value.name, 'scalar', id);
          append(value.name);
          break;
        case 'unary':
          if (!['+', '-', '!'].includes(value.operator)) fail('BLOCK_SHAPE', id);
          append(`(${value.operator} `);
          expression(value.operand, scope, depth + 1, astDepth + 1);
          append(')');
          break;
        case 'arithmetic':
        case 'compare':
        case 'logic': {
          const operators =
            value.kind === 'arithmetic'
              ? ['+', '-', '*', '/', '%']
              : value.kind === 'compare'
                ? ['<', '<=', '>', '>=', '==', '!=']
                : ['&&', '||'];
          if (!operators.includes(value.operator)) fail('BLOCK_SHAPE', id);
          append('(');
          expression(value.left, scope, depth + 1, astDepth + 1);
          append(` ${value.operator} `);
          expression(value.right, scope, depth + 1, astDepth + 1);
          append(')');
          break;
        }
        case 'array_read':
          reference(scope, value.name, 'array', id);
          append(`${value.name}[`);
          expression(value.index, scope, depth + 1, astDepth + 1);
          append(']');
          break;
        default:
          fail('BLOCK_SHAPE', id);
      }
    });
  };
  const simple = (
    statement: BlockStatement,
    scope: Scope,
    local: Set<string>,
    depth: number,
    semicolon = true,
  ): void => {
    if (!statement || typeof statement !== 'object') fail('BLOCK_SHAPE', currentId);
    const fields =
      statement.kind === 'declare'
        ? ['name', 'initial']
        : statement.kind === 'assign'
          ? ['name', 'value']
          : statement.kind === 'array_write'
            ? ['name', 'index', 'value']
            : [];
    const id = node(statement, statement.kind, fields, depth);
    mapped(id, () => {
      if (statement.kind === 'declare') {
        declare(scope, local, statement.name, 'scalar', id);
        append(`int ${statement.name}`);
        if (statement.initial !== null) {
          append(' = ');
          expression(statement.initial, scope, depth);
        }
      } else if (statement.kind === 'assign') {
        reference(scope, statement.name, 'scalar', id);
        append(`${statement.name} = `);
        expression(statement.value, scope, depth);
      } else if (statement.kind === 'array_write') {
        reference(scope, statement.name, 'array', id);
        append(`${statement.name}[`);
        expression(statement.index, scope, depth + 1);
        append('] = ');
        expression(statement.value, scope, depth);
      } else fail('BLOCK_SHAPE', id);
      if (semicolon) append(';');
    });
  };
  const body = (
    list: readonly BlockStatement[],
    parent: Scope,
    depth: number,
    loopDepth: number,
    indent: number,
  ): void => {
    if (!Array.isArray(list)) fail('BLOCK_SHAPE', currentId);
    const scope = new Map(parent);
    const local = new Set<string>();
    for (const item of list) statement(item, scope, local, depth, loopDepth, indent);
  };
  const statement = (
    item: BlockStatement,
    scope: Scope,
    local: Set<string>,
    depth: number,
    loopDepth: number,
    indent: number,
  ): void => {
    if (!item || typeof item !== 'object') fail('BLOCK_SHAPE', currentId);
    if (item.kind === 'input') fail('BLOCK_INPUT', item.id);
    append('    '.repeat(indent));
    if (item.kind === 'declare' || item.kind === 'assign' || item.kind === 'array_write') {
      simple(item, scope, local, depth);
      append('\n');
      return;
    }
    const fields =
      item.kind === 'if'
        ? ['condition', 'then', 'else']
        : item.kind === 'while'
          ? ['condition', 'body']
          : item.kind === 'for'
            ? ['init', 'condition', 'update', 'body']
            : item.kind === 'array_declare'
              ? ['name', 'length', 'values']
              : item.kind === 'print'
                ? ['format', 'args']
                : item.kind === 'return'
                  ? ['value']
                  : item.kind === 'scope'
                    ? ['body']
                    : [];
    const control = item.kind === 'if' || item.kind === 'while' || item.kind === 'for';
    const id = node(item, item.kind, fields, depth + (control ? 1 : 0));
    const nested = (list: readonly BlockStatement[], parent: Scope, loops: number) => {
      const childDepth = depth + (control ? 2 : 1);
      if (childDepth > BLOCK_LIMITS.depth) fail('BLOCK_LIMIT', id);
      append('{\n');
      body(list, parent, childDepth, loops, indent + 1);
      append('    '.repeat(indent) + '}');
    };
    mapped(id, () => {
      switch (item.kind) {
        case 'array_declare':
          unsigned(item.length, id);
          if (depth + 1 > BLOCK_LIMITS.depth) fail('BLOCK_LIMIT', id);
          if (
            Number(item.length) === 0 ||
            (item.values !== null &&
              (!Array.isArray(item.values) ||
                item.values.length === 0 ||
                item.values.length > Number(item.length)))
          )
            fail('BLOCK_INTEGER', id);
          declare(scope, local, item.name, 'array', id);
          append(`int ${item.name}[${item.length}]`);
          if (item.values !== null)
            append(` = {${item.values.map((value) => signed(value, id)).join(', ')}}`);
          append(';');
          break;
        case 'if':
          append('if (');
          expression(item.condition, scope, depth + 2);
          append(') ');
          nested(item.then, scope, loopDepth);
          if (item.else !== null) {
            append(' else ');
            nested(item.else, scope, loopDepth);
          }
          break;
        case 'while':
          append('while (');
          expression(item.condition, scope, depth + 2);
          append(') ');
          nested(item.body, scope, loopDepth + 1);
          break;
        case 'for': {
          const forScope = new Map(scope);
          const forLocal = new Set<string>();
          append('for (');
          if (item.init !== null) {
            if (!['declare', 'assign'].includes(item.init.kind)) fail('BLOCK_SHAPE', id);
            simple(item.init, forScope, forLocal, depth + 2);
          } else append(';');
          append(' ');
          if (item.condition !== null) expression(item.condition, forScope, depth + 2);
          append('; ');
          if (item.update !== null) {
            if (item.update.kind !== 'assign') fail('BLOCK_SHAPE', id);
            simple(item.update, forScope, forLocal, depth + 2, false);
          }
          append(') ');
          nested(item.body, forScope, loopDepth + 1);
          break;
        }
        case 'break':
        case 'continue':
          if (!loopDepth) fail('BLOCK_LOOP', id);
          append(`${item.kind};`);
          break;
        case 'print': {
          if (depth + 1 > BLOCK_LIMITS.depth) fail('BLOCK_LIMIT', id);
          const format = formatLiteral(item.format, item.args, id);
          append(`printf("${format}"`);
          for (const arg of item.args) {
            append(', ');
            expression(arg, scope, depth + 1);
          }
          append(');');
          break;
        }
        case 'return':
          append('return ');
          expression(item.value, scope, depth);
          append(';');
          break;
        case 'scope':
          nested(item.body, scope, loopDepth);
          break;
        default:
          fail('BLOCK_SHAPE', id);
      }
    });
    append('\n');
  };
  for (const item of program.body.slice(rangeBindings.length))
    statement(item, rootScope, rootLocal, 1, 0, 1);
  // Check only the validated block structure, without evaluating conditions.
  // A return inside a loop or just one branch still needs the default exit.
  const alwaysReturns = (list: readonly BlockStatement[]): boolean =>
    list.some(
      (item) =>
        item.kind === 'return' ||
        (item.kind === 'scope' && alwaysReturns(item.body)) ||
        (item.kind === 'if' &&
          item.else !== null &&
          alwaysReturns(item.then) &&
          alwaysReturns(item.else)),
    );
  if (!alwaysReturns(program.body)) append('    return 0;\n');
  append('}\n');
  const mainStart = text.indexOf('int main');
  if (mainStart < 0) fail('BLOCK_PREPARATION');
  blockMap.push({
    blockId: program.id,
    byteRange: { start: encoder.encode(text.slice(0, mainStart)).byteLength, end: offset - 1 },
  });
  return {
    text,
    bindingMap: prepared.bindingMap.map((entry) => ({
      bindingKey: entry.bindingKey,
      byteRange: { ...entry.byteRange },
    })),
    blockMap,
  };
}
