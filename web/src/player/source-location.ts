import type { ByteRange, ExecutionLocation, ExecutionNode } from '../engine/protocol';

export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceRange {
  byteRange: ByteRange;
  utf16Range: { start: number; end: number };
  start: SourcePosition;
  end: SourcePosition;
}

export interface MappedSourceLocation {
  range: SourceRange | null;
  description: string;
  synthetic: boolean;
}

interface Boundary extends SourcePosition {
  byte: number;
  utf16: number;
}

/** Coordinates refer to the original string. CRLF is an indivisible boundary;
 * tabs count as one scalar column, and supplementary scalars use two UTF-16 units.
 * This index interprets source coordinates only, never C syntax or control flow.
 */
export function createSourceIndex(source: string) {
  const boundaries: Boundary[] = [{ byte: 0, utf16: 0, line: 1, column: 1 }];
  const byByte = new Map<number, number>([[0, 0]]);
  let byte = 0;
  let utf16 = 0;
  let line = 1;
  let column = 1;
  while (utf16 < source.length) {
    const point = source.codePointAt(utf16)!;
    const scalar = String.fromCodePoint(point);
    const crlf = scalar === '\r' && source[utf16 + 1] === '\n';
    byte += crlf ? 2 : point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    utf16 += crlf ? 2 : scalar.length;
    if (scalar === '\r' || scalar === '\n') {
      ++line;
      column = 1;
    } else ++column;
    byByte.set(byte, boundaries.length);
    boundaries.push({ byte, utf16, line, column });
  }

  function range(byteRange: ByteRange, edge: 'start' | 'whole' | 'end' = 'whole') {
    const startIndex = byByte.get(byteRange.start);
    const endIndex = byByte.get(byteRange.end);
    if (
      startIndex === undefined ||
      endIndex === undefined ||
      startIndex > endIndex ||
      !Number.isSafeInteger(byteRange.start) ||
      !Number.isSafeInteger(byteRange.end)
    )
      return null;
    const first = boundaries[edge === 'end' && endIndex > startIndex ? endIndex - 1 : startIndex];
    const last = boundaries[edge === 'start' && endIndex > startIndex ? startIndex + 1 : endIndex];
    return {
      byteRange: { start: first.byte, end: last.byte },
      utf16Range: { start: first.utf16, end: last.utf16 },
      start: { line: first.line, column: first.column },
      end: { line: last.line, column: last.column },
    } satisfies SourceRange;
  }
  return { range };
}

const syntheticDescriptions: Record<
  Extract<ExecutionLocation, { kind: 'synthetic' }>['reason'],
  string
> = {
  'initial-state': '初始状态，尚未完成源码步骤',
  'implicit-return': '隐式返回 0（无显式 return 语句，锚定函数结束处）',
  'pre-execution': '执行前检查事件，没有对应源码步骤',
  'adapter-cancel': '执行适配层取消事件，没有对应源码步骤',
  'adapter-deadline': '执行适配层截止事件，没有对应源码步骤',
  'module-load': '执行模块加载事件，没有对应源码步骤',
  'worker-failure': '执行工作线程故障，没有对应源码步骤',
  'protocol-validation': '轨迹协议校验事件，没有对应源码步骤',
  'encoding-failure': '执行结果编码事件，没有对应源码步骤',
};

function describeRange(range: SourceRange): string {
  const { start, end } = range;
  if (range.byteRange.start === range.byteRange.end)
    return `第 ${start.line} 行，第 ${start.column} 列（零宽位置）`;
  return `第 ${start.line} 行，第 ${start.column} 列至第 ${end.line} 行，第 ${end.column} 列（末端不含）`;
}

export function mapSourceLocation(
  source: string,
  nodes: readonly ExecutionNode[],
  location: ExecutionLocation | null,
  index = createSourceIndex(source),
): MappedSourceLocation {
  if (!location)
    return { range: null, description: '尚无当前执行步骤，源码已就绪', synthetic: false };
  if (location.kind === 'synthetic') {
    const description = syntheticDescriptions[location.reason] ?? '未知无源码事件，无法定位';
    if (location.reason !== 'implicit-return') return { range: null, description, synthetic: true };
    const anchor = nodes.find((node) => node.nodeId === location.anchorNodeId);
    const range = anchor ? index.range(anchor.byteRange, 'end') : null;
    return {
      range,
      description: `${description}；${range ? describeRange(range) : '源码锚点不可定位'}`,
      synthetic: true,
    };
  }
  if (location.kind !== 'source')
    return { range: null, description: '未知定位类型，无法定位源码', synthetic: false };
  const node = nodes.find((candidate) => candidate.nodeId === location.nodeId);
  // A direct diagnostic range is authoritative even if there is no AST node.
  const range = location.byteRange
    ? index.range(location.byteRange)
    : node
      ? index.range(node.byteRange, location.edge ?? 'whole')
      : null;
  return {
    range,
    description: range ? describeRange(range) : '源码位置不可定位，未标记任何源码',
    synthetic: false,
  };
}
