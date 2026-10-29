import type { InputBinding } from '../content/types';
import type { ByteRange } from '../engine/protocol';
import type { AnalysisNode, ReverseProjection } from './analysis-types';
import type { BlockExpression, BlockProgram, BlockStatement } from './model';
import { programNodes } from './reverse';
export { generatedSyntheticRanges } from './reverse';

type Statement = BlockStatement;
interface Patch {
  range: ByteRange;
  text: string;
}
export interface SourcePatchResult {
  text: string;
  syntheticRanges: ByteRange[];
  commentsMoved: boolean;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const within = (inner: ByteRange, outer: ByteRange) =>
  inner.start >= outer.start && inner.end <= outer.end;

/** Syntax printing for finite IR fragments only. Rust checks the patched complete source. */
function expression(node: BlockExpression): string {
  switch (node.kind) {
    case 'integer':
      return node.value;
    case 'variable':
      return node.name;
    case 'unary':
      return `(${node.operator} ${expression(node.operand)})`;
    case 'arithmetic':
    case 'compare':
    case 'logic':
      return `(${expression(node.left)} ${node.operator} ${expression(node.right)})`;
    case 'array_read':
      return `${node.name}[${expression(node.index)}]`;
  }
}
function render(node: Statement, depth: number, newline: string): string {
  if (depth > 64) throw new Error('BLOCK_LIMIT');
  const indent = '    '.repeat(depth);
  const body = (items: readonly Statement[]) =>
    `{${newline}${items.map((item) => `${indent}    ${render(item, depth + 1, newline)}${newline}`).join('')}${indent}}`;
  const simple = (item: Statement): string => {
    if (item.kind === 'declare')
      return `int ${item.name}${item.initial ? ` = ${expression(item.initial)}` : ''}`;
    if (item.kind === 'assign') return `${item.name} = ${expression(item.value)}`;
    if (item.kind === 'array_write')
      return `${item.name}[${expression(item.index)}] = ${expression(item.value)}`;
    throw new Error('BLOCK_STRUCTURE');
  };
  switch (node.kind) {
    case 'declare':
    case 'assign':
    case 'array_write':
      return `${simple(node)};`;
    case 'array_declare':
      return `int ${node.name}[${node.length}]${node.values === null ? '' : ` = {${node.values.join(', ')}}`};`;
    case 'print':
      return `printf("${node.format.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"${node.args.map((arg) => `, ${expression(arg)}`).join('')});`;
    case 'return':
      return `return ${expression(node.value)};`;
    case 'break':
      return 'break;';
    case 'continue':
      return 'continue;';
    case 'scope':
      return body(node.body);
    case 'if':
      return `if (${expression(node.condition)}) ${body(node.then)}${node.else === null ? '' : ` else ${body(node.else)}`}`;
    case 'while':
      return `while (${expression(node.condition)}) ${body(node.body)}`;
    case 'for':
      return `for (${node.init ? simple(node.init) : ''}; ${node.condition ? expression(node.condition) : ''}; ${node.update ? simple(node.update) : ''}) ${body(node.body)}`;
    case 'input':
      throw new Error('BLOCK_INPUT');
  }
}

/** Keep an increasing set of existing statements; moves become explicit remove/insert pairs. */
function retainedIds(before: readonly Statement[], after: readonly Statement[]): Set<string> {
  const order = new Map(before.map((node, index) => [node.id, index]));
  const values = after.flatMap((node) =>
    order.has(node.id) ? [{ id: node.id, value: order.get(node.id)! }] : [],
  );
  const tails: number[] = [],
    positions: number[] = [],
    parents = new Array<number>(values.length).fill(-1);
  values.forEach((item, index) => {
    let low = 0,
      high = tails.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (tails[mid]! < item.value) low = mid + 1;
      else high = mid;
    }
    tails[low] = item.value;
    parents[index] = low ? positions[low - 1]! : -1;
    positions[low] = index;
  });
  const kept = new Set<string>();
  for (let current = positions.at(-1) ?? -1; current >= 0; current = parents[current]!)
    kept.add(values[current]!.id);
  return kept;
}

/** Patch only source ranges proven by the last accepted Rust analysis. */
export function patchBlockSource(
  previous: ReverseProjection,
  program: BlockProgram,
  bindings: readonly InputBinding[] = [],
): SourcePatchResult {
  const oldNodes = programNodes(previous.program),
    nextNodes = programNodes(program);
  const bytes = encoder.encode(previous.sourceText);
  const ast = new Map(previous.analysis.checkedAst.nodes.map((node) => [node.nodeId, node]));
  const ranges = new Map(previous.source.blockMap.map((item) => [item.blockId, item.byteRange]));
  const patches: Patch[] = [];
  const newline = previous.sourceText.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  let commentsMoved = false;
  const text = (range: ByteRange) => decoder.decode(bytes.subarray(range.start, range.end));
  const mapped = (id: string): ByteRange =>
    ranges.get(id) ??
    (() => {
      throw new Error('UNSUPPORTED_RANGE');
    })();
  const nodeAst = (id: string): AnalysisNode => {
    const range = mapped(id);
    const found = previous.analysis.checkedAst.nodes.find(
      (node) => node.byteRange.start === range.start && node.byteRange.end === range.end,
    );
    if (!found) throw new Error('UNSUPPORTED_RANGE');
    return found;
  };
  const comments = (range: ByteRange, depth: number): string => {
    const items = previous.provenance.trivia.filter(
      (item) => item.kind !== 'whitespace' && within(item.byteRange, range),
    );
    // Replacing/deleting a parent while simultaneously moving one of its
    // commented descendants elsewhere cannot use the ordinary lift operation:
    // that would copy the same comment both before the parent and at its new
    // destination. Keep both drafts and reject this ambiguous transaction.
    if (items.length) {
      const owner = [...oldNodes.values()].find((node) => {
        const entry = ranges.get(node.id);
        return entry?.start === range.start && entry.end === range.end;
      });
      const nextOwner = owner && nextNodes.get(owner.id);
      const retained = new Set<string>();
      const pending = nextOwner ? [nextOwner] : [];
      while (pending.length) {
        const node = pending.pop()!;
        retained.add(node.id);
        for (const value of Object.values(node))
          for (const child of Array.isArray(value) ? value : [value])
            if (child && typeof child === 'object' && 'kind' in child)
              pending.push(child as BlockProgram | BlockStatement | BlockExpression);
      }
      for (const [id, entry] of ranges)
        if (
          id !== owner?.id &&
          within(entry, range) &&
          nextNodes.has(id) &&
          !retained.has(id) &&
          items.some((item) => within(item.byteRange, entry))
        )
          throw new Error('UNSUPPORTED_RANGE');
    }
    if (items.length) commentsMoved = true;
    return items.map((item) => `${text(item.byteRange)}${newline}${'    '.repeat(depth)}`).join('');
  };
  const printable = (node: Statement, depth: number): string => {
    const prior = oldNodes.get(node.id);
    if (prior && same(prior, node)) return text(mapped(node.id));
    return `${prior ? comments(mapped(node.id), depth) : ''}${render(node, depth, newline)}`;
  };
  const sourceBlock = (
    owner: BlockProgram | Statement,
    slot: 'body' | 'then' | 'else',
  ): Extract<AnalysisNode, { kind: 'block' }> => {
    const source = nodeAst(owner.id);
    const child =
      source.kind === 'function' || source.kind === 'while' || source.kind === 'for'
        ? ast.get(source.body)
        : source.kind === 'if'
          ? ast.get(slot === 'then' ? source.thenBlock : (source.elseBlock ?? ''))
          : source;
    if (!child || child.kind !== 'block') throw new Error('UNSUPPORTED_RANGE');
    return child;
  };
  const ownSignature = (node: Statement): string =>
    JSON.stringify(node, (key, value: unknown) => {
      if (key === 'body' || key === 'then') return undefined;
      if (key === 'else') return value === null ? null : 'present';
      return value;
    });
  const patchStatement = (before: Statement, after: Statement, depth: number): void => {
    if (same(before, after)) return;
    if (before.kind !== after.kind || ownSignature(before) !== ownSignature(after)) {
      if (before.kind === 'input' || after.kind === 'input') throw new Error('BLOCK_INPUT');
      patches.push({
        range: mapped(before.id),
        text: `${comments(mapped(before.id), depth)}${render(after, depth, newline)}`,
      });
      return;
    }
    if (before.kind === 'if' && after.kind === 'if') {
      patchBody(before, 'then', before.then, after.then, depth + 1);
      if (before.else !== null && after.else !== null)
        patchBody(before, 'else', before.else, after.else, depth + 1);
    } else if (
      (before.kind === 'while' || before.kind === 'for' || before.kind === 'scope') &&
      (after.kind === 'while' || after.kind === 'for' || after.kind === 'scope')
    )
      patchBody(before, 'body', before.body, after.body, depth + 1);
  };
  const patchBody = (
    owner: BlockProgram | Statement,
    slot: 'body' | 'then' | 'else',
    before: readonly Statement[],
    after: readonly Statement[],
    depth: number,
  ): void => {
    const kept = retainedIds(before, after);
    const source = sourceBlock(owner, slot);
    let end = source.byteRange.end - 1;
    if (owner.kind === 'main') {
      const tail = previous.provenance.syntheticSegments[0];
      if (tail) end = tail.byteRange.start;
    }
    for (const node of before) {
      if (kept.has(node.id)) {
        const next = after.find((item) => item.id === node.id)!;
        patchStatement(node, next, depth);
      } else {
        if (node.kind === 'input') throw new Error('BLOCK_INPUT');
        patches.push({
          range: mapped(node.id),
          text: nextNodes.has(node.id) ? '' : comments(mapped(node.id), depth),
        });
      }
    }
    const pending: Statement[] = [];
    const insert = (offset: number) => {
      if (!pending.length) return;
      if (pending.some((node) => node.kind === 'input')) throw new Error('BLOCK_INPUT');
      const indent = '    '.repeat(depth);
      patches.push({
        range: { start: offset, end: offset },
        text: `${newline}${indent}${pending.map((node) => printable(node, depth)).join(newline + indent)}${newline}${offset === end ? '    '.repeat(Math.max(0, depth - 1)) : indent}`,
      });
      pending.length = 0;
    };
    for (const node of after) {
      if (kept.has(node.id)) insert(mapped(node.id).start);
      else pending.push(node);
    }
    insert(end);
  };
  if (program.id !== previous.program.id) throw new Error('BLOCK_STRUCTURE');
  if (bindings.length) {
    for (let index = 0; index < bindings.length; index++)
      if (!same(previous.program.body[index], program.body[index])) throw new Error('BLOCK_INPUT');
  }
  patchBody(previous.program, 'body', previous.program.body, program.body, 1);
  patches.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  for (let index = 1; index < patches.length; index++)
    if (patches[index]!.range.start < patches[index - 1]!.range.end)
      throw new Error('UNSUPPORTED_RANGE');
  let cursor = 0,
    output = '';
  for (const patch of patches) {
    output += text({ start: cursor, end: patch.range.start }) + patch.text;
    cursor = patch.range.end;
  }
  output += text({ start: cursor, end: bytes.length });
  if (encoder.encode(output).length > 32768) throw new Error('BLOCK_SOURCE_LIMIT');
  const syntheticRanges = previous.provenance.syntheticSegments.flatMap((segment) => {
    if (
      patches.some(
        (patch) =>
          patch.range.start < segment.byteRange.end && patch.range.end > segment.byteRange.start,
      )
    )
      return [];
    const delta = patches
      .filter((patch) => patch.range.end <= segment.byteRange.start)
      .reduce(
        (sum, patch) =>
          sum + encoder.encode(patch.text).length - (patch.range.end - patch.range.start),
        0,
      );
    return [{ start: segment.byteRange.start + delta, end: segment.byteRange.end + delta }];
  });
  return { text: output, syntheticRanges, commentsMoved };
}
