import type { AdvancedResult } from '../engine/advanced-protocol';
import { createSourceIndex } from '../player/source-location';

/** Source annotations identify a presentation group; every state change still
 * comes from the accepted Rust trace. No swap is evaluated in the frontend. */
export function teachingSwapGroups(source: string, result: AdvancedResult) {
  const ranges = [...source.matchAll(/\/\/ 交换开始([\s\S]*?)\/\/ 交换结束/g)].map((match) => ({
    start: new TextEncoder().encode(source.slice(0, match.index)).length,
    end: new TextEncoder().encode(source.slice(0, match.index + match[0].length)).length,
  }));
  const nodes = new Map(result.nodeMap.map((node) => [node.nodeId, node.byteRange.start]));
  const groups: { start: number; end: number }[] = [];
  let active = -1;
  for (const [index, step] of (result.trace?.steps ?? []).entries()) {
    const at = nodes.get(step.nodeId) ?? -1;
    const group = ranges.findIndex((range) => at >= range.start && at < range.end);
    if (group < 0) {
      active = -1;
      continue;
    }
    if (active === group) groups[groups.length - 1].end = index + 1;
    else groups.push({ start: index, end: index + 1 });
    active = group;
  }
  return groups;
}

export function teachingStartCursor(source: string, result: AdvancedResult): number {
  const marker = source.indexOf('// 开始观察算法');
  if (marker < 0) return 0;
  const boundary = new TextEncoder().encode(source.slice(0, marker)).length;
  const nodes = new Map(result.nodeMap.map((n) => [n.nodeId, n]));
  const at =
    result.trace?.steps.findIndex((step) => {
      if ((nodes.get(step.nodeId)?.byteRange.start ?? -1) >= boundary) return true;
      return step.changes.some(
        (change) =>
          change.op === 'record' &&
          change.table === 'frames' &&
          change.after &&
          'callNodeId' in change.after &&
          typeof change.after.callNodeId === 'string' &&
          (nodes.get(change.after.callNodeId)?.byteRange.start ?? -1) >= boundary,
      );
    }) ?? -1;
  return Math.max(0, at);
}

/** Leave the final algorithm arrangement on screen before main's scope is
 * destroyed. The complete return/cleanup trace remains validated and reversible. */
export function teachingEndCursor(source: string, result: AdvancedResult): number {
  const steps = result.trace?.steps ?? [];
  if (!source.includes('// 开始观察算法')) return steps.length;
  const main = steps
    .flatMap((step) => step.changes)
    .find(
      (change) =>
        change.op === 'record' &&
        change.table === 'frames' &&
        change.after &&
        'functionName' in change.after &&
        change.after.functionName === 'main',
    );
  const frame = main?.op === 'record' ? main.after?.id : null;
  const first = steps
    .flatMap((step) => step.changes)
    .find(
      (change) =>
        change.op === 'record' &&
        change.table === 'objects' &&
        change.after &&
        'frameId' in change.after &&
        change.after.frameId === frame,
    );
  const scope =
    first?.op === 'record' && first.after && 'scopeId' in first.after ? first.after.scopeId : null;
  if (!scope) return steps.length;
  const end = steps.findIndex((step) =>
    step.changes.some(
      (change) =>
        change.op === 'record' &&
        change.table === 'objects' &&
        change.before &&
        change.after &&
        'alive' in change.before &&
        'alive' in change.after &&
        change.before.alive &&
        !change.after.alive &&
        change.before.scopeId === scope,
    ),
  );
  return end < 0 ? steps.length : end;
}

/** Display stops are selected from the accepted trace; skipped deltas still apply. */
export function teachingStops(source: string, result: AdvancedResult): number[] {
  const stops = [0];
  const nodes = new Map(result.nodeMap.map((n) => [n.nodeId, n]));
  const index = createSourceIndex(source);
  let previousNode = '';
  for (const [i, step] of (result.trace?.steps ?? []).entries()) {
    if (
      ['program.enter', 'object.declare', 'scope.enter', 'scope.exit', 'control.jump'].includes(
        step.kind,
      )
    )
      continue;
    const node = nodes.get(step.nodeId);
    const range = node ? index.range(node.byteRange) : null;
    const at = range?.utf16Range.start ?? 0;
    const lineStart = source.lastIndexOf('\n', at - 1) + 1;
    const lineEnd = source.indexOf('\n', at);
    const line = source.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
    if (
      /^(for|while)\s*\(/.test(line) &&
      !source.slice(lineStart, at).includes('{') &&
      ['condition', 'value.write', 'value.initialize'].includes(step.kind)
    )
      continue;
    if (/^[{};\s]*$/.test(line)) continue;
    if (
      step.kind === 'value.write' &&
      !step.changes.some((c) => c.op === 'cell' && c.before !== c.after)
    )
      continue;
    if (previousNode === step.nodeId && stops.length > 1) stops[stops.length - 1] = i + 1;
    else stops.push(i + 1);
    previousNode = step.nodeId;
  }
  const length = result.trace?.steps.length ?? 0;
  if (length && stops.at(-1) !== length) stops.push(length);
  const groups = teachingSwapGroups(source, result);
  return [
    ...new Set([
      ...stops.filter(
        (cursor) => !groups.some((group) => cursor > group.start && cursor < group.end),
      ),
      ...groups.map((group) => group.end),
    ]),
  ].sort((a, b) => a - b);
}
