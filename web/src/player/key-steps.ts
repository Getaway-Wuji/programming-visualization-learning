import type { ExecuteResult, TraceStep } from '../engine/protocol';
import type { AlgorithmResult, AlgorithmStep } from '../engine/algorithm-protocol';
import type { MemoryResult, MemoryStep } from '../engine/memory-protocol';

export type StepDetail = 'key' | 'all';
type Result = ExecuteResult | AlgorithmResult | MemoryResult;
const cache = new WeakMap<Result, readonly number[]>();

/** Select display stops from recorded actions. Never evaluate the program or alter its trace. */
export function keyStepCursors(result: Result): readonly number[] {
  const cached = cache.get(result);
  if (cached) return cached;
  const steps: readonly (TraceStep | AlgorithmStep | MemoryStep)[] = result.trace?.steps ?? [];
  const stops = [0];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const bookkeeping = [
      'program.enter',
      'object.declare',
      'scope.enter',
      'scope.exit',
      'control.jump',
      'nop',
    ].includes(step.kind);
    const loopUpdate =
      step.kind === 'value.write' &&
      'observations' in step &&
      step.changes.some(
        (change) => change.op === 'control' && change.before.flowStack.at(-1)?.stage === 'update',
      );
    const unchangedWrite =
      step.kind === 'value.write' &&
      !step.changes.some((change) => change.op === 'cell' && change.before !== change.after);
    if (!bookkeeping && !loopUpdate && !unchangedWrite) stops.push(index + 1);
  }
  if (steps.length && stops.at(-1) !== steps.length) stops.push(steps.length);
  cache.set(result, stops);
  return stops;
}

export function nextStepCursor(
  stops: readonly number[],
  cursor: number,
  direction: -1 | 1,
): number {
  let low = 0,
    high = stops.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (stops[mid] < cursor || (direction === 1 && stops[mid] === cursor)) low = mid + 1;
    else high = mid;
  }
  return direction === 1 ? (stops[low] ?? cursor) : (stops[low - 1] ?? cursor);
}

export function keyStepPosition(stops: readonly number[], cursor: number): number {
  let low = 0,
    high = stops.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (stops[mid] <= cursor) low = mid + 1;
    else high = mid;
  }
  return Math.max(0, low - 1);
}
