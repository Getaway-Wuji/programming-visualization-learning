import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  ExecuteRequest,
  ExecuteResult,
  TraceChange,
  TraceScope,
} from '../../web/src/engine/protocol';
import { ProtocolFailure } from '../../web/src/engine/protocol';
import { validateTraceRelationships } from '../../web/src/engine/trace-validation';

const keys = [
  'assignment-negative',
  'branch-positive',
  'loops-normal',
  'array-mixed',
  'bubble-sort-mixed',
  'selection-sort-mixed',
  'search-duplicate',
];
function packet(key = 'bubble-sort-mixed') {
  const directory = new URL(`../../项目文档/验收/08.4-真实案例/${key}/`, import.meta.url);
  return {
    request: JSON.parse(readFileSync(new URL('request.json', directory), 'utf8')) as ExecuteRequest,
    result: JSON.parse(readFileSync(new URL('result.json', directory), 'utf8')) as ExecuteResult,
  };
}
function finish(work: Generator<void, void, unknown>): void {
  while (!work.next().done) {
    // Exercise the entire forward and inverse relationship validator.
  }
}
function changes(result: ExecuteResult): TraceChange[] {
  return result.trace!.steps.flatMap((step) => step.changes);
}
function changedScope(result: ExecuteResult, requireObjects = false): TraceScope {
  const change = changes(result).find(
    (change) =>
      change.op === 'record' &&
      change.table === 'scopes' &&
      change.after !== null &&
      (!requireObjects || ('objectIds' in change.after && change.after.objectIds.length > 1)),
  )!;
  if (change.op !== 'record') throw new Error('Missing archived scope change');
  return change.after as TraceScope;
}

// These are historical real Rust packets and intentionally invalid copies.
// They test relationship rejection only, not current-build provenance or timing.
describe('11.4 allocation-efficient full-state validation regressions', () => {
  it.each(keys)('retains all historical forward/inverse states without mutating %s', (key) => {
    const { result, request } = packet(key);
    const before = JSON.stringify(result);
    expect(() => finish(validateTraceRelationships(result, request))).not.toThrow();
    expect(JSON.stringify(result)).toBe(before);
  });

  it.each(['frame', 'scope'] as const)('rejects cross-%s object ownership', (owner) => {
    const { result, request } = packet();
    const change = changes(result).find(
      (change) => change.op === 'record' && change.table === 'objects' && change.after,
    )!;
    if (change.op !== 'record' || !change.after || !('scopeId' in change.after))
      throw new Error('Missing archived object declaration');
    if (owner === 'frame') change.after.frameId = 'f999';
    else change.after.scopeId = 's999';
    expect(() => finish(validateTraceRelationships(result, request))).toThrow(ProtocolFailure);
  });

  it.each(['order', 'extra', 'missing'] as const)(
    'rejects %s in scope object membership',
    (kind) => {
      const { result, request } = packet();
      const scope = changedScope(result, true);
      if (kind === 'order') scope.objectIds.reverse();
      else if (kind === 'extra') scope.objectIds.push('o999');
      else scope.objectIds.pop();
      expect(() => finish(validateTraceRelationships(result, request))).toThrow(ProtocolFailure);
    },
  );

  it('rejects a frame whose scope order disagrees with the live scope table', () => {
    const { result, request } = packet();
    const change = changes(result).find(
      (change) =>
        change.op === 'record' &&
        change.table === 'frames' &&
        change.after &&
        'scopeIds' in change.after &&
        change.after.scopeIds.length > 1,
    )!;
    if (change.op !== 'record' || !change.after || !('scopeIds' in change.after))
      throw new Error('Missing archived nested frame');
    change.after.scopeIds.reverse();
    expect(() => finish(validateTraceRelationships(result, request))).toThrow(ProtocolFailure);
  });

  it.each(['last-step', 'checkpoint', 'inverse', 'counter'] as const)(
    'still rejects malformed %s after the entire preceding trace',
    (kind) => {
      const { result, request } = packet();
      const last = result.trace!.steps.at(-1)!;
      if (kind === 'last-step') last.seq++;
      else if (kind === 'checkpoint')
        result.trace!.checkpoints.at(-1)!.state.allocator.nextObject++;
      else if (kind === 'counter') {
        const change = changes(result).findLast((change) => change.op === 'counters')!;
        if (change.op !== 'counters') throw new Error('Missing archived counters');
        change.after.comparisons++;
      } else {
        const change = last.changes.find((change) => change.op === 'control')!;
        if (change.op !== 'control') throw new Error('Missing archived return control');
        change.before.activeFrameId = 'f999';
      }
      expect(() => finish(validateTraceRelationships(result, request))).toThrow(ProtocolFailure);
    },
  );
});
