import type { InputBinding } from '../content/types';
import type { ByteRange } from '../engine/protocol';
import type { PreparedSource } from '../engine/execution-client';
import type {
  AnalysisNode,
  MappingIssue,
  ReverseProjection,
  SyntheticSegment,
  ValidAnalysisResult,
} from './analysis-types';
import type { BlockExpression, BlockProgram, BlockStatement } from './model';

type Block = BlockProgram | BlockStatement | BlockExpression;
type WithoutId<T> = T extends Block ? Omit<T, 'id'> : never;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
let codeId = 0;
const reservedNames = new Set([
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

export interface ReverseOptions {
  previous?: ReverseProjection;
  stableProgram?: BlockProgram;
  trustedSyntheticRanges?: readonly ByteRange[];
  generationMode?: 'canonical' | 'preserve';
  allocateId?: () => string;
}
export class UnmappedSourceError extends Error {
  constructor(public readonly issues: MappingIssue[]) {
    super(issues.map((issue) => issue.reason).join(', '));
    this.name = 'UnmappedSourceError';
  }
}
export function programNodes(program: BlockProgram): Map<string, Block> {
  const found = new Map<string, Block>();
  const stack: Block[] = [program];
  while (stack.length) {
    const node = stack.pop()!;
    if (found.has(node.id) || found.size >= 32768) throw new Error('BLOCK_STRUCTURE');
    found.set(node.id, node);
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value])
        if (child && typeof child === 'object' && 'kind' in child) stack.push(child as Block);
    }
  }
  return found;
}
function paths(program: BlockProgram): Map<string, Block> {
  const found = new Map<string, Block>();
  const visit = (node: Block, path: string) => {
    found.set(path, node);
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        value.forEach((child, index) => {
          if (child && typeof child === 'object' && 'kind' in child)
            visit(child as Block, `${path}.${key}.${index}`);
        });
      } else if (value && typeof value === 'object' && 'kind' in value)
        visit(value as Block, `${path}.${key}`);
    }
  };
  visit(program, 'root');
  return found;
}
export function programStructure(program: BlockProgram): string {
  return JSON.stringify(program, (key, value: unknown) => {
    if (key === 'id') return undefined;
    if (
      value &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === 'array_declare' &&
      'values' in value &&
      Array.isArray(value.values)
    )
      return { ...value, values: value.values.map((item: string) => String(Number(item))) };
    return value;
  });
}
const sameRange = (a: ByteRange, b: ByteRange) => a.start === b.start && a.end === b.end;
const slice = (source: string, range: ByteRange) =>
  decoder.decode(encoder.encode(source).subarray(range.start, range.end));
function childIds(node: AnalysisNode): string[] {
  switch (node.kind) {
    case 'function':
      return [node.body];
    case 'block':
      return node.statements;
    case 'declaration':
      return node.initializer.kind === 'none'
        ? []
        : node.initializer.kind === 'scalar'
          ? [node.initializer.expression]
          : node.initializer.elements;
    case 'assignment':
      return [node.target, node.value];
    case 'if':
      return [node.condition, node.thenBlock, ...(node.elseBlock === null ? [] : [node.elseBlock])];
    case 'while':
      return [node.condition, node.body];
    case 'for':
      return [node.init, node.condition, node.update, node.body].filter(
        (id): id is string => id !== null,
      );
    case 'condition':
      return [node.expression];
    case 'output':
      return node.arguments;
    case 'return':
      return [node.value];
    case 'index':
      return [node.array, node.index];
    case 'unary':
      return [node.operand];
    case 'binary':
      return [node.left, node.right];
    default:
      return [];
  }
}
function bindingSignatures(result: ValidAnalysisResult): Map<string, string> {
  const nodes = new Map(result.checkedAst.nodes.map((node) => [node.nodeId, node]));
  const nodePaths = new Map<string, string>();
  const pending: { id: string; path: string }[] = [{ id: result.checkedAst.rootId, path: 'root' }];
  while (pending.length) {
    const item = pending.pop()!;
    const node = nodes.get(item.id);
    if (!node || nodePaths.has(item.id)) throw new Error('BLOCK_STRUCTURE');
    nodePaths.set(item.id, item.path);
    childIds(node).forEach((id, index) => pending.push({ id, path: `${item.path}.${index}` }));
  }
  const direct = new Map<string, string>();
  for (const node of result.checkedAst.nodes)
    if (node.kind === 'name') {
      const declaration = nodes.get(node.resolvedDeclarationId);
      if (declaration?.kind !== 'declaration') throw new Error('BLOCK_STRUCTURE');
      const input = result.bindingMap.find((binding) =>
        sameRange(binding.byteRange, declaration.byteRange),
      );
      direct.set(
        node.nodeId,
        input
          ? `input:${input.bindingKey}`
          : `${nodePaths.get(declaration.nodeId)}:${declaration.name}:${declaration.arrayLength}`,
      );
    }
  const signatures = new Map<string, string[]>();
  for (let index = result.checkedAst.nodes.length - 1; index >= 0; index--) {
    const node = result.checkedAst.nodes[index];
    signatures.set(node.nodeId, [
      ...(direct.has(node.nodeId) ? [direct.get(node.nodeId)!] : []),
      ...childIds(node).flatMap((id) => signatures.get(id) ?? []),
    ]);
  }
  return new Map(
    result.checkedAst.nodes.map((node) => [
      `${node.byteRange.start}:${node.byteRange.end}`,
      JSON.stringify(signatures.get(node.nodeId)!),
    ]),
  );
}
function unchangedRanges(
  before: string,
  after: string,
): (oldRange: ByteRange, newRange: ByteRange) => boolean {
  const left = encoder.encode(before),
    right = encoder.encode(after);
  let prefix = 0,
    suffix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]
  )
    suffix++;
  const delta = right.length - left.length;
  return (oldRange, newRange) =>
    (oldRange.end <= prefix && sameRange(oldRange, newRange)) ||
    (oldRange.start >= left.length - suffix &&
      newRange.start === oldRange.start + delta &&
      newRange.end === oldRange.end + delta);
}

/** Consume only the checked Rust projection; this function never parses C text. */
export function reverseAnalysis(
  result: ValidAnalysisResult,
  sourceText: string,
  bindings: readonly InputBinding[],
  options: ReverseOptions = {},
): ReverseProjection {
  const nodes = new Map(result.checkedAst.nodes.map((node) => [node.nodeId, node]));
  const mapped: PreparedSource['blockMap'] = [];
  const syntheticSegments: SyntheticSegment[] = [];
  const allocate = options.allocateId ?? (() => `block.code.${++codeId}`);
  let count = 0;
  function fail(reason: MappingIssue['reason'], node?: AnalysisNode): never {
    throw new UnmappedSourceError([
      { reason, nodeId: node?.nodeId ?? null, blockId: null, byteRange: node?.byteRange ?? null },
    ]);
  }
  const get = (id: string): AnalysisNode => nodes.get(id) ?? fail('UNSUPPORTED_RANGE');
  const allocated = new Set<string>();
  const tag = <T extends Block>(node: AnalysisNode, shape: WithoutId<T>): T => {
    if (++count > 32768) fail('BLOCK_STRUCTURE', node);
    const id = allocate();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(id) || allocated.has(id))
      fail('BLOCK_STRUCTURE', node);
    allocated.add(id);
    mapped.push({ blockId: id, byteRange: { ...node.byteRange } });
    return { id, ...shape } as T;
  };
  const name = (node: AnalysisNode, value: string): string => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value) || reservedNames.has(value))
      fail('BLOCK_NAME', node);
    return value;
  };
  const expression = (id: string, depth = 1): BlockExpression => {
    const node = get(id);
    if (depth > 64) fail('BLOCK_STRUCTURE', node);
    switch (node.kind) {
      case 'integer':
        return tag(node, { kind: 'integer', value: node.value });
      case 'name':
        return tag(node, { kind: 'variable', name: name(node, node.name) });
      case 'unary':
        return tag(node, {
          kind: 'unary',
          operator: node.operator,
          operand: expression(node.operand, depth + 1),
        });
      case 'binary': {
        const left = expression(node.left, depth + 1),
          right = expression(node.right, depth + 1);
        if (['+', '-', '*', '/', '%'].includes(node.operator))
          return tag(node, {
            kind: 'arithmetic',
            operator: node.operator as '+' | '-' | '*' | '/' | '%',
            left,
            right,
          });
        if (['<', '<=', '>', '>=', '==', '!='].includes(node.operator))
          return tag(node, {
            kind: 'compare',
            operator: node.operator as '<' | '<=' | '>' | '>=' | '==' | '!=',
            left,
            right,
          });
        return tag(node, { kind: 'logic', operator: node.operator as '&&' | '||', left, right });
      }
      case 'index': {
        const array = get(node.array);
        if (array.kind !== 'name') fail('UNSUPPORTED_RANGE', node);
        return tag(node, {
          kind: 'array_read',
          name: name(array, array.name),
          index: expression(node.index, depth + 1),
        });
      }
      default:
        return fail('UNSUPPORTED_RANGE', node);
    }
  };
  const condition = (id: string): BlockExpression => {
    const node = get(id);
    if (node.kind !== 'condition') fail('UNSUPPORTED_RANGE', node);
    return expression(node.expression);
  };
  const signedLiteral = (id: string): string => {
    const node = get(id);
    if (node.kind === 'integer') return node.value;
    if (node.kind === 'unary' && (node.operator === '+' || node.operator === '-')) {
      const child = get(node.operand);
      if (child.kind === 'integer')
        return String(node.operator === '-' ? -Number(child.value) : Number(child.value));
    }
    return fail('UNSUPPORTED_RANGE', node);
  };
  const inputFor = (node: AnalysisNode): InputBinding | undefined => {
    const entry = result.bindingMap.find((item) => sameRange(item.byteRange, node.byteRange));
    return entry ? bindings.find((binding) => binding.bindingKey === entry.bindingKey) : undefined;
  };
  const statements = (id: string, depth: number): BlockStatement[] => {
    const block = get(id);
    if (block.kind !== 'block') fail('UNSUPPORTED_RANGE', block);
    return block.statements.flatMap((child) => {
      const node = get(child);
      const trusted = options.trustedSyntheticRanges?.some((range) =>
        sameRange(range, node.byteRange),
      );
      if (trusted) {
        const value = node.kind === 'return' ? get(node.value) : null;
        if (
          node.kind !== 'return' ||
          value?.kind !== 'integer' ||
          value.value !== '0' ||
          id !==
            (get(result.checkedAst.rootId) as Extract<AnalysisNode, { kind: 'function' }>).body ||
          child !== block.statements.at(-1)
        )
          fail('UNSUPPORTED_RANGE', node);
        syntheticSegments.push({
          kind: 'synthetic-tail-return',
          nodeId: node.nodeId,
          byteRange: { ...node.byteRange },
        });
        return [];
      }
      return [statement(child, depth)];
    });
  };
  const statement = (id: string, depth = 1): BlockStatement => {
    const node = get(id);
    if (depth > 64) fail('BLOCK_STRUCTURE', node);
    switch (node.kind) {
      case 'declaration': {
        const binding = inputFor(node);
        if (binding)
          return tag(node, {
            kind: 'input',
            bindingKey: binding.bindingKey,
            name: name(node, binding.targetName),
            targetKind: binding.targetKind,
          });
        if (node.arrayLength !== null) {
          if (node.initializer.kind === 'scalar') fail('UNSUPPORTED_RANGE', node);
          return tag(node, {
            kind: 'array_declare',
            name: name(node, node.name),
            length: node.arrayLength,
            values:
              node.initializer.kind === 'none'
                ? null
                : node.initializer.elements.map(signedLiteral),
          });
        }
        if (node.initializer.kind === 'array') fail('UNSUPPORTED_RANGE', node);
        return tag(node, {
          kind: 'declare',
          name: name(node, node.name),
          initial:
            node.initializer.kind === 'none' ? null : expression(node.initializer.expression),
        });
      }
      case 'assignment': {
        const target = get(node.target);
        if (target.kind === 'name')
          return tag(node, {
            kind: 'assign',
            name: name(target, target.name),
            value: expression(node.value),
          });
        if (target.kind !== 'index') fail('UNSUPPORTED_RANGE', node);
        const array = get(target.array);
        if (array.kind !== 'name') fail('UNSUPPORTED_RANGE', node);
        return tag(node, {
          kind: 'array_write',
          name: name(array, array.name),
          index: expression(target.index),
          value: expression(node.value),
        });
      }
      case 'if':
        return tag(node, {
          kind: 'if',
          condition: condition(node.condition),
          then: statements(node.thenBlock, depth + 1),
          else: node.elseBlock === null ? null : statements(node.elseBlock, depth + 1),
        });
      case 'while':
        return tag(node, {
          kind: 'while',
          condition: condition(node.condition),
          body: statements(node.body, depth + 1),
        });
      case 'for': {
        const init = node.init === null ? null : statement(node.init, depth + 1);
        const update = node.update === null ? null : statement(node.update, depth + 1);
        if (
          (init !== null && init.kind !== 'declare' && init.kind !== 'assign') ||
          (update !== null && update.kind !== 'assign')
        )
          fail('FOR_ARRAY_TARGET', node);
        return tag(node, {
          kind: 'for',
          init,
          condition: node.condition === null ? null : condition(node.condition),
          update,
          body: statements(node.body, depth + 1),
        });
      }
      case 'break':
        return tag(node, { kind: 'break' });
      case 'continue':
        return tag(node, { kind: 'continue' });
      case 'output': {
        if (
          Array.from(node.format).some((ch) => {
            const value = ch.codePointAt(0)!;
            return (value < 32 && value !== 10) || value === 127;
          })
        )
          fail('BLOCK_FORMAT', node);
        return tag(node, {
          kind: 'print',
          format: node.format,
          args: node.arguments.map((arg) => expression(arg)),
        });
      }
      case 'return':
        return tag(node, { kind: 'return', value: expression(node.value) });
      case 'block':
        return tag(node, { kind: 'scope', body: statements(node.nodeId, depth + 1) });
      case 'empty':
        return fail('EMPTY_STATEMENT', node);
      default:
        return fail('UNSUPPORTED_RANGE', node);
    }
  };
  const root = get(result.checkedAst.rootId);
  if (root.kind !== 'function') fail('UNSUPPORTED_RANGE', root);
  let program: BlockProgram = tag(root, { kind: 'main', body: statements(root.body, 1) });
  if (syntheticSegments.length !== (options.trustedSyntheticRanges?.length ?? 0))
    fail('UNSUPPORTED_RANGE');
  const currentPaths = paths(program);
  const stablePaths = options.stableProgram ? paths(options.stableProgram) : null;
  if (
    options.stableProgram &&
    programStructure(options.stableProgram) !== programStructure(program)
  )
    fail('BLOCK_STRUCTURE');
  const previousPaths = options.previous ? paths(options.previous.program) : null;
  const unchanged = options.previous
    ? unchangedRanges(options.previous.sourceText, sourceText)
    : null;
  const oldBindings = options.previous ? bindingSignatures(options.previous.analysis) : null;
  const newBindings = options.previous ? bindingSignatures(result) : null;
  const oldRanges = new Map(
    options.previous?.source.blockMap.map((entry) => [entry.blockId, entry.byteRange]),
  );
  const newRanges = new Map(mapped.map((entry) => [entry.blockId, entry.byteRange]));
  const replacements = new Map<string, string>();
  for (const [path, node] of currentPaths) {
    const stable = stablePaths?.get(path);
    if (stable) {
      replacements.set(node.id, stable.id);
      continue;
    }
    const previous = previousPaths?.get(path);
    const oldRange = previous && oldRanges.get(previous.id),
      nextRange = newRanges.get(node.id);
    if (
      previous &&
      previous.kind === node.kind &&
      oldRange &&
      nextRange &&
      unchanged?.(oldRange, nextRange) &&
      oldBindings?.get(`${oldRange.start}:${oldRange.end}`) ===
        newBindings?.get(`${nextRange.start}:${nextRange.end}`) &&
      slice(options.previous!.sourceText, oldRange) === slice(sourceText, nextRange)
    )
      replacements.set(node.id, previous.id);
  }
  if (replacements.size)
    program = JSON.parse(
      JSON.stringify(program, (key, value: unknown) =>
        key === 'id' && typeof value === 'string' ? (replacements.get(value) ?? value) : value,
      ),
    ) as BlockProgram;
  for (const entry of mapped) entry.blockId = replacements.get(entry.blockId) ?? entry.blockId;
  programNodes(program);
  const source: PreparedSource = {
    text: sourceText,
    blockMap: mapped,
    bindingMap: result.bindingMap.map((entry) => ({
      bindingKey: entry.bindingKey,
      byteRange: { ...entry.byteRange },
    })),
  };
  return {
    documentRevision: result.identity.documentRevision,
    sourceText,
    program,
    source,
    provenance: {
      documentRevision: result.identity.documentRevision,
      generationMode: options.generationMode ?? 'preserve',
      trivia: result.trivia,
      syntheticSegments,
    },
    analysis: result,
    issues: [],
  };
}

/** Call only for the result of the current trusted generateBlockSource transaction. */
export function generatedSyntheticRanges(
  source: PreparedSource,
  program: BlockProgram,
): ByteRange[] {
  const tail = '    return 0;\n}\n';
  if (!source.text.endsWith(tail) || !source.blockMap.some((entry) => entry.blockId === program.id))
    throw new Error('UNTRUSTED_GENERATED_SOURCE');
  const start = encoder.encode(source.text).length - encoder.encode(tail).length + 4;
  return [{ start, end: start + encoder.encode('return 0;').length }];
}
