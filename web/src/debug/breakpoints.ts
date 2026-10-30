import type { MemoryResult } from '../engine/memory-protocol';

/** Source coordinates only. No C/C++ evaluation or algorithm reconstruction. */
export function sourceLines(source: string) {
  let start = 0;
  let byteStart = 0;
  const encoder = new TextEncoder();
  return source.split(/\r\n|\r|\n/).map((text, index) => {
    const line = { number: index + 1, text, start, end: start + text.length, byteStart };
    const ending = source.slice(line.end).match(/^(?:\r\n|\r|\n)/)?.[0] ?? '';
    start = line.end + ending.length;
    byteStart += encoder.encode(text + ending).length;
    return line;
  });
}

export function stepVisits(source: string, result: MemoryResult) {
  const lines = sourceLines(source);
  const nodes = new Map(result.nodeMap.map((node) => [node.nodeId, node]));
  const controls = result.nodeMap
    .filter((node) => ['if', 'while', 'for'].includes(node.kind))
    .sort((a, b) => a.byteRange.end - a.byteRange.start - (b.byteRange.end - b.byteRange.start));
  const loopConditions = new Set(
    [
      ...new Set(
        (result.trace?.steps ?? [])
          .filter((step) => step.kind === 'condition')
          .map((step) => step.nodeId),
      ),
    ].filter((id) => {
      const node = nodes.get(id)!;
      const owner = controls.find(
        (control) =>
          control.byteRange.start <= node.byteRange.start &&
          control.byteRange.end >= node.byteRange.end,
      );
      return owner && ['while', 'for'].includes(owner.kind);
    }),
  );
  let activeFrame = result.trace?.initialState.control.activeFrameId ?? null;
  let previousLine = 0;
  let previousFrame: string | null = null;
  const lineAt = (byteStart: number) => {
    let low = 0;
    let high = lines.length;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (lines[mid].byteStart <= byteStart) low = mid;
      else high = mid;
    }
    return lines[low].number;
  };
  return (result.trace?.steps ?? []).map((step) => {
    const node = nodes.get(step.nodeId)!;
    const line = lineAt(node.byteRange.start);
    let callSite: { line: number; byteRange: { start: number; end: number } } | null = null;
    if (step.kind === 'function.enter') {
      for (const change of step.changes) {
        if (
          change.op === 'record' &&
          change.table === 'frames' &&
          change.before === null &&
          change.after &&
          'callNodeId' in change.after &&
          change.after.callNodeId
        ) {
          const call = nodes.get(change.after.callNodeId)!;
          callSite = { line: lineAt(call.byteRange.start), byteRange: call.byteRange };
        }
      }
    }
    const beforeFrame = activeFrame;
    for (const change of step.changes)
      if (change.op === 'control') activeFrame = change.after.activeFrameId;
    const frame = step.kind.endsWith('.return') ? beforeFrame : activeFrame;
    const loopTest = step.kind === 'condition' && loopConditions.has(step.nodeId);
    const entry = line !== previousLine || frame !== previousFrame || loopTest;
    previousLine = line;
    previousFrame = frame;
    return { line, entry, callSite };
  });
}
