import type { PreparedSource } from '../engine/execution-client';
import type { ExecutionLocation, ExecutionNode } from '../engine/protocol';
import { mapSourceLocation } from '../player/source-location';

/** Location projection only: find the smallest generated block containing a Rust range. */
export function blocksAtLocation(
  source: PreparedSource | undefined,
  nodes: readonly ExecutionNode[],
  location: ExecutionLocation | null,
): string[] {
  if (!source || !location || location.kind !== 'source') return [];
  const range = mapSourceLocation(source.text, nodes, location).range?.byteRange;
  if (!range) return [];
  const matches = source.blockMap.filter(
    ({ byteRange }) => byteRange.start <= range.start && byteRange.end >= range.end,
  );
  if (!matches.length) return [];
  const size = Math.min(...matches.map(({ byteRange }) => byteRange.end - byteRange.start));
  return matches
    .filter(({ byteRange }) => byteRange.end - byteRange.start === size)
    .map(({ blockId }) => blockId);
}
