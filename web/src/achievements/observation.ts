import { acceptedMemoryRequest } from '../engine/memory-client';
import type { MemoryResult, MemoryFrame } from '../engine/memory-protocol';
import { stackExamples } from '../stack/examples';
import type { MemoryPlayer } from '../engine/memory-player';
import type { Ref } from '../storage/model';

export interface ObservationFact {
  readonly type: 'observation.view-confirmed';
}
const facts = new WeakMap<ObservationFact, Ref>();
export function observationSubject(fact: ObservationFact): Ref | null {
  const ref = facts.get(fact);
  return ref ? { ...ref } : null;
}
/** Coverage has no authority of its own. Only an accepted production run can issue a fact. */
export class AdjacentCoverage {
  private seen = new Set<number>();
  private previous: number | null = null;
  constructor(readonly length: number) {}
  interrupt() {
    this.previous = null;
  }
  present(cursor: number) {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.length) return false;
    const before = this.seen.size;
    if (cursor === 0 || (this.previous === cursor - 1 && this.seen.has(cursor - 1)))
      this.seen.add(cursor);
    this.previous = cursor;
    return before !== this.seen.size;
  }
  snapshot() {
    return {
      seen: this.seen.size,
      total: this.length + 1,
      complete: this.seen.size === this.length + 1,
    };
  }
}
function recursive(result: MemoryResult) {
  if (!result.trace) return false;
  const frames = new Map<string, MemoryFrame>(
    result.trace.initialState.frames.map((f) => [f.id, f]),
  );
  for (const s of result.trace.steps)
    for (const c of s.changes) {
      if (c.op !== 'record' || c.table !== 'frames') continue;
      const f = c.after as MemoryFrame | null;
      if (f) {
        let parent = f.parentFrameId;
        const visited = new Set<string>();
        while (parent && !visited.has(parent)) {
          visited.add(parent);
          const p = frames.get(parent);
          if (!p) break;
          if (p.functionNodeId === f.functionNodeId) return true;
          parent = p.parentFrameId;
        }
        frames.set(f.id, f);
      } else frames.delete(c.id);
    }
  return false;
}
export function createObservationWatch(result: MemoryResult, isCurrent: () => boolean) {
  const request = acceptedMemoryRequest(result);
  if (
    !request ||
    !result.trace ||
    result.trace.completeness !== 'complete' ||
    result.terminal.status !== 'completed' ||
    result.terminal.returnValue !== 0 ||
    request.runId !== result.identity.runId ||
    request.sourceRevision !== result.identity.sourceRevision
  )
    return null;
  const example = stackExamples.find(
    (e) =>
      ['functions', 'hanoi'].includes(e.id) &&
      e.source === request.source &&
      e.language === request.language,
  );
  if (
    !example ||
    (example.id === 'functions'
      ? request.input.length !== 0
      : request.input.length !== 1 ||
        !Number.isInteger(request.input[0]) ||
        request.input[0] < 2 ||
        request.input[0] > 5) ||
    !recursive(result)
  )
    return null;
  const subjectRef = { id: `observation.stack.${example.id}`, version: '1.0.0' };
  const coverage = new AdjacentCoverage(result.trace.steps.length);
  let fact: ObservationFact | null = null;
  return {
    present(view: ReturnType<MemoryPlayer['snapshot']>) {
      if (
        !isCurrent() ||
        !view.state ||
        view.identity?.runId !== request.runId ||
        view.identity.sourceRevision !== request.sourceRevision
      ) {
        coverage.interrupt();
        return false;
      }
      return coverage.present(view.cursor);
    },
    interrupt: () => coverage.interrupt(),
    snapshot: () => ({ ...coverage.snapshot(), subjectRef: { ...subjectRef } }),
    confirm() {
      if (!isCurrent() || !coverage.snapshot().complete) return null;
      if (!fact) {
        fact = Object.freeze({ type: 'observation.view-confirmed' });
        facts.set(fact, subjectRef);
      }
      return fact;
    },
  };
}
