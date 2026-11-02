import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeResult } from '../../web/src/engine/protocol';
import type {
  ExecuteRequest,
  ExecutionLocation,
  ExecutionNode,
} from '../../web/src/engine/protocol';
import { createSourceIndex, mapSourceLocation } from '../../web/src/player/source-location';

const bytes = (source: string) => new TextEncoder().encode(source).length;
const node = (nodeId: string, start: number, end: number): ExecutionNode => ({
  nodeId,
  kind: 'expression',
  parentId: null,
  byteRange: { start, end },
});
const sourceLocation = (start: number, end: number): ExecutionLocation => ({
  kind: 'source',
  byteRange: { start, end },
});

describe('08.3 original-source coordinate projection', () => {
  it('keeps UTF8, UTF16, scalar columns, tabs and all three newline forms distinct', () => {
    const source = '甲😀\tA\r\n乙\n丙\r丁';
    const index = createSourceIndex(source);
    expect(index.range({ start: 3, end: 7 })).toEqual({
      byteRange: { start: 3, end: 7 },
      utf16Range: { start: 1, end: 3 },
      start: { line: 1, column: 2 },
      end: { line: 1, column: 3 },
    });
    expect(index.range({ start: 8, end: 9 })!.start).toEqual({ line: 1, column: 4 });
    const last = index.range({ start: bytes(source) - 3, end: bytes(source) })!;
    expect(source.slice(last.utf16Range.start, last.utf16Range.end)).toBe('丁');
    expect(last.start).toEqual({ line: 4, column: 1 });
    expect(index.range({ start: 11, end: 14 })!.start).toEqual({ line: 2, column: 1 });
  });

  it('rejects byte endpoints inside a multibyte scalar or a CRLF pair', () => {
    const index = createSourceIndex('甲😀\r\nx');
    for (const range of [
      { start: 1, end: 3 },
      { start: 3, end: 5 },
      { start: 7, end: 8 },
      { start: -1, end: 0 },
      { start: 1.5, end: 3 },
      { start: 10, end: 11 },
      { start: 3, end: 0 },
    ])
      expect(index.range(range)).toBeNull();
    expect(index.range({ start: 7, end: 9 })).toMatchObject({
      utf16Range: { start: 3, end: 5 },
      end: { line: 2, column: 1 },
    });
  });

  it('projects one-line multiple nodes to distinct exact ranges', () => {
    const source = 'int main(){ int x=1; x=x+2; return x; }';
    const first = source.indexOf('int x');
    const second = source.indexOf('x=x');
    const nodes = [node('n1', first, first + 8), node('n2', second, second + 6)];
    const a = mapSourceLocation(source, nodes, { kind: 'source', nodeId: 'n1', edge: 'whole' });
    const b = mapSourceLocation(source, nodes, { kind: 'source', nodeId: 'n2', edge: 'whole' });
    expect(source.slice(a.range!.utf16Range.start, a.range!.utf16Range.end)).toBe('int x=1;');
    expect(source.slice(b.range!.utf16Range.start, b.range!.utf16Range.end)).toBe('x=x+2;');
    expect(a.range!.start.line).toBe(b.range!.start.line);
    expect(a.range!.start.column).not.toBe(b.range!.start.column);
  });

  it('uses exact first and last scalar edges, including supplementary characters', () => {
    const source = '😀甲😀';
    const nodes = [node('n1', 0, bytes(source))];
    for (const [edge, range] of [
      ['start', { start: 0, end: 4 }],
      ['whole', { start: 0, end: 11 }],
      ['end', { start: 7, end: 11 }],
    ] as const) {
      const result = mapSourceLocation(source, nodes, { kind: 'source', nodeId: 'n1', edge });
      expect(result.range!.byteRange).toEqual(range);
    }
  });

  it('honors explicit byteRange over a supplied node or edge', () => {
    const mapped = mapSourceLocation('abcdef', [node('n1', 0, 6)], {
      kind: 'source',
      nodeId: 'n1',
      edge: 'end',
      byteRange: { start: 1, end: 4 },
    });
    expect(mapped.range!.utf16Range).toEqual({ start: 1, end: 4 });
    expect(mapSourceLocation('abcdef', [], sourceLocation(1, 4)).range).toEqual(mapped.range);
  });

  it('does not mark initial-state or unrelated synthetic anchors', () => {
    const nodes = [node('main', 0, 3)];
    for (const reason of ['initial-state', 'pre-execution', 'worker-failure'] as const) {
      const mapped = mapSourceLocation('x{}', nodes, {
        kind: 'synthetic',
        reason,
        anchorNodeId: 'main',
      });
      expect(mapped.range).toBeNull();
      expect(mapped.synthetic).toBe(true);
      expect(mapped.description).not.toBe('');
    }
  });

  it('anchors implicit-return and scope.exit end to the actual closing brace', () => {
    const source = 'int main() {\r\n  int x=1;\r\n}';
    const nodes = [node('main', 0, bytes(source))];
    const implicit = mapSourceLocation(source, nodes, {
      kind: 'synthetic',
      reason: 'implicit-return',
      anchorNodeId: 'main',
    });
    const exit = mapSourceLocation(source, nodes, { kind: 'source', nodeId: 'main', edge: 'end' });
    expect(implicit.range).toEqual(exit.range);
    expect(source.slice(implicit.range!.utf16Range.start, implicit.range!.utf16Range.end)).toBe(
      '}',
    );
    expect(implicit.description).toContain('隐式返回');
    expect(implicit.range!.start).toEqual({ line: 3, column: 1 });
  });

  it('maps EOF and empty-source zero-width positions without inventing a character', () => {
    const source = '甲😀\r\n';
    const eof = mapSourceLocation(source, [], sourceLocation(bytes(source), bytes(source)));
    expect(eof.range).toMatchObject({
      utf16Range: { start: source.length, end: source.length },
      start: { line: 2, column: 1 },
      end: { line: 2, column: 1 },
    });
    expect(eof.description).toContain('零宽');
    expect(mapSourceLocation('', [], sourceLocation(0, 0)).range!.utf16Range).toEqual({
      start: 0,
      end: 0,
    });
  });

  it('explains missing, invalid and unknown locations without fabricating source', () => {
    const invalid = [
      { kind: 'source', nodeId: 'missing' },
      { kind: 'source', byteRange: { start: 0, end: 99 } },
      { kind: 'synthetic', reason: 'implicit-return', anchorNodeId: 'missing' },
      { kind: 'synthetic', reason: 'future-reason' },
      { kind: 'future-kind' },
    ] as ExecutionLocation[];
    for (const location of invalid) {
      const mapped = mapSourceLocation('x', [], location);
      expect(mapped.range).toBeNull();
      expect(mapped.description).toMatch(/无法定位|不可定位/);
    }
    expect(mapSourceLocation('x', [], null).range).toBeNull();
  });

  it('maps all exact node edges from an accepted archived real Rust trace', async () => {
    const base = new URL('../../tests/fixtures/execution/assignment/', import.meta.url);
    const request = JSON.parse(
      readFileSync(new URL('request.json', base), 'utf8'),
    ) as ExecuteRequest;
    const result = await decodeResult(
      Uint8Array.from(readFileSync(new URL('result.json', base))).buffer,
      request,
    );
    const source = request.source.text;
    for (const step of result.trace!.steps) {
      const mapped = mapSourceLocation(source, result.nodeMap, step.location);
      expect(mapped.range, `step ${step.seq}`).not.toBeNull();
      const range = mapped.range!;
      expect(bytes(source.slice(0, range.utf16Range.start))).toBe(range.byteRange.start);
      expect(bytes(source.slice(0, range.utf16Range.end))).toBe(range.byteRange.end);
    }
  });
});
