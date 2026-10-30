import type { ByteRange, Diagnostic, ExecutionLocation } from '../engine/protocol';
import { createSourceIndex } from '../player/source-location';
import { diagnosticMessage } from './messages';

// A presentation input, not a new wire protocol. P1 does not report stage/origin.
export interface DisplayDiagnostic {
  code: string;
  stage?: Diagnostic['stage'];
  origin?: Diagnostic['origin'];
  location?: ExecutionLocation;
  details?: Diagnostic['details'];
}
export interface DiagnosticSource {
  text: string;
  language?: 'c' | 'cpp';
  nodes?: readonly { nodeId: string; byteRange: ByteRange }[];
  blockMap?: readonly { blockId: string; byteRange: ByteRange }[];
}
const stages: Record<Diagnostic['stage'], string> = {
  preflight: '执行前检查',
  load: '模块加载',
  lex: '词法检查',
  parse: '语法检查',
  semantic: '语义检查',
  execute: '运行',
  encode: '结果编码',
  receive: '结果接收',
  judge: '教学判定',
};
const origins = {
  rust: 'Rust 解释器',
  adapter: '执行适配',
  protocol: '接口校验',
  judge: '教学判定',
};
export function presentDiagnostic(diagnostic: DisplayDiagnostic, source: DiagnosticSource) {
  const index = createSourceIndex(source.text);
  const location = diagnostic.location;
  const node =
    location?.kind === 'source' && source.nodes?.find((node) => node.nodeId === location.nodeId);
  const range =
    location?.kind === 'source'
      ? location.byteRange
        ? index.range(location.byteRange)
        : node
          ? index.range(node.byteRange, location.edge)
          : null
      : null;
  const file = source.language === 'cpp' ? 'main.cpp' : 'main.c';
  const copy = diagnosticMessage(diagnostic.code, diagnostic.details?.expected);
  const blocks = range
    ? (source.blockMap ?? []).filter(
        ({ byteRange }) =>
          byteRange.start <= range.byteRange.start &&
          byteRange.end >= range.byteRange.end &&
          (range.byteRange.start !== range.byteRange.end || range.byteRange.start < byteRange.end),
      )
    : [];
  const minimum = Math.min(...blocks.map(({ byteRange }) => byteRange.end - byteRange.start));
  const blockIds = blocks
    .filter(({ byteRange }) => byteRange.end - byteRange.start === minimum)
    .map(({ blockId }) => blockId);
  let excerpt: {
    before: string;
    marked: string;
    after: string;
    clippedStart: boolean;
    clippedEnd: boolean;
  } | null = null;
  if (range) {
    const offset = range.utf16Range.start;
    const prefix =
      source.text
        .slice(0, offset)
        .split(/\r\n|\r|\n/)
        .at(-1) ?? '';
    const rest = source.text.slice(offset).split(/\r\n|\r|\n/)[0];
    const width = Math.min(range.utf16Range.end - offset, rest.length);
    const marked = Array.from(rest.slice(0, width)).slice(0, 160).join('');
    const before = Array.from(prefix).slice(-40).join('');
    const after = Array.from(rest.slice(width))
      .slice(0, Math.max(0, 160 - Array.from(marked).length))
      .join('');
    excerpt = {
      before,
      marked,
      after,
      clippedStart: before.length < prefix.length,
      clippedEnd: marked.length + after.length < rest.length,
    };
  }
  return {
    ...copy,
    file,
    range,
    blockIds,
    excerpt,
    gcc: `${file}${range ? `:${range.start.line}:${range.start.column}` : ''}: error: ${copy.summary} [${diagnostic.code}]`,
    stage: diagnostic.stage ? stages[diagnostic.stage] : '阶段未单独提供',
    origin: diagnostic.origin ? origins[diagnostic.origin] : '执行结果',
    unavailable:
      location?.kind === 'synthetic'
        ? '此诊断没有对应的源码位置，未标记任何语句。'
        : '未提供可核对的源码位置，未猜测行列。',
  };
}
