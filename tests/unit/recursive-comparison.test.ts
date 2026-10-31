import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { initSync, execute_algorithm } from '../../web/src/generated/algorithm/c_viz_algorithm';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
import {
  decodeAlgorithmResult,
  encodeAlgorithmRequest,
  type AlgorithmRequest,
  type AlgorithmResult,
} from '../../web/src/engine/algorithm-protocol';
import { RecursivePairController } from '../../web/src/algorithms/pair-controller';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
beforeAll(() =>
  initSync({ module: readFileSync('web/src/generated/algorithm/c_viz_algorithm_bg.wasm') }),
);
afterEach(() => vi.useRealTimers());
async function real(request: AlgorithmRequest) {
  const bytes = execute_algorithm(
    encodeAlgorithmRequest(request),
    engineBuild.wasmSha256,
    1000,
  ).slice();
  return decodeAlgorithmResult(bytes.buffer, request, engineBuild.wasmSha256);
}
class Client {
  requests: { request: AlgorithmRequest; start?: number }[] = [];
  invalidate = vi.fn();
  async execute(request: AlgorithmRequest, start?: number) {
    this.requests.push({ request, start });
    return real(request);
  }
}
class Held extends Client {
  pending: {
    resolve: (result: AlgorithmResult) => void;
    reject: (error: Error) => void;
    request: AlgorithmRequest;
  }[] = [];
  override execute(request: AlgorithmRequest, start?: number) {
    this.requests.push({ request, start });
    return new Promise<AlgorithmResult>((resolve, reject) =>
      this.pending.push({ resolve, reject, request }),
    );
  }
}
async function until(check: () => boolean) {
  for (let i = 0; i < 1000 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(check()).toBe(true);
}
it('freezes independent equal input copies, exact C++ sources and one common start; full state reverse and short hold', async () => {
  const a = new Client(),
    b = new Client(),
    controller = new RecursivePairController({ clients: [a, b], now: () => 12 });
  const values = [7, -3, 0, 5, -3, 2, 9];
  controller.prepare(values);
  values[0] = 999;
  const prepared = controller.getSnapshot().lanes;
  expect(prepared[0].prepared!.input).toEqual([7, -3, 0, 5, -3, 2, 9]);
  expect(prepared[0].prepared!.input).not.toBe(prepared[1].prepared!.input);
  expect(Object.isFrozen(prepared[0].prepared!.input)).toBe(true);
  await controller.execute();
  const done = controller.getSnapshot();
  expect(done.phase).toBe('settled');
  expect(a.requests[0].start).toBe(12);
  expect(b.requests[0].start).toBe(12);
  expect(a.requests[0].request.runId).not.toBe(b.requests[0].request.runId);
  expect(a.requests[0].request.source).toBe(prepared[0].prepared!.source);
  expect(b.requests[0].request.source).toBe(prepared[1].prepared!.source);
  for (const cursor of [
    43,
    Math.min(...done.lanes.map((l) => l.view.length)) + 1,
    done.length,
    0,
  ]) {
    controller.seek(cursor);
    controller.getSnapshot().lanes.forEach((lane) => {
      const player = new AlgorithmPlayer();
      player.accept(lane.result!);
      player.seek(Math.min(cursor, lane.view.length));
      expect(lane.view).toEqual(player.snapshot());
    });
  }
  expect(controller.getSnapshot().lanes.every((l) => l.view.cursor === 0)).toBe(true);
  controller.invalidate();
});
it('cancel retains final accepted side and rejects a genuine late second side', async () => {
  const a = new Client(),
    b = new Held(),
    controller = new RecursivePairController({ clients: [a, b] });
  controller.prepare([3, 1, 2]);
  const pending = controller.execute();
  await until(() => b.pending.length === 1);
  const result = await real(b.pending[0].request);
  controller.cancel();
  b.pending[0].resolve(result);
  await pending;
  const view = controller.getSnapshot();
  expect(view.phase).toBe('cancelled');
  expect(view.lanes[0].phase).toBe('accepted');
  expect(view.lanes[1].result).toBeNull();
  controller.seek(view.length);
  expect(controller.getSnapshot().lanes[0].view.state!.output).toBe('1 2 3 \n');
  controller.invalidate();
});
it('input/clear/unmount invalidation drops both sides and genuine late replies', async () => {
  for (const reason of ['input', 'clear', 'unmount']) {
    const a = new Held(),
      b = new Client(),
      controller = new RecursivePairController({ clients: [a, b] });
    controller.prepare([2, 1]);
    const pending = controller.execute();
    await until(() => a.pending.length === 1);
    const result = await real(a.pending[0].request);
    controller.invalidate();
    a.pending[0].resolve(result);
    await pending;
    expect(controller.getSnapshot().phase, reason).toBe('idle');
    expect(controller.getSnapshot().groupId).toBe('');
    expect(
      controller
        .getSnapshot()
        .lanes.every((l) => !l.result && !l.prepared && l.view.state === null),
    ).toBe(true);
    expect(b.requests).toHaveLength(0);
  }
});
it('a failed side remains independent and second receives the original deadline; rejects bad input', async () => {
  const a = new Held(),
    b = new Client(),
    controller = new RecursivePairController({ clients: [a, b], now: () => 20 });
  controller.prepare([2, 1]);
  const pending = controller.execute();
  a.pending[0].reject(Error('E_DEADLINE'));
  await pending;
  expect(controller.getSnapshot().lanes[0].error).toBe('E_DEADLINE');
  expect(controller.getSnapshot().lanes[1].phase).toBe('accepted');
  expect(b.requests[0].start).toBe(20);
  controller.prepare([1000]);
  expect(controller.getSnapshot().phase).toBe('failed');
  expect(controller.getSnapshot().lanes.every((l) => l.prepared === null)).toBe(true);
  controller.invalidate();
});
it('replay and timer/rate changes consume traces only; replacement clears stale ticks and identities', async () => {
  const a = new Client(),
    b = new Client(),
    controller = new RecursivePairController({ clients: [a, b] });
  controller.prepare([4, 1, 3, 2], true);
  expect(controller.getSnapshot().lanes[0].spec.id).toBe('case.cpp.quick-sort');
  await controller.execute();
  const old = controller.getSnapshot().groupId;
  vi.useFakeTimers();
  controller.play();
  vi.advanceTimersByTime(500);
  expect(controller.getSnapshot().cursor).toBe(1);
  controller.setRate(4);
  vi.advanceTimersByTime(125);
  expect(controller.getSnapshot().cursor).toBe(2);
  controller.pause();
  vi.advanceTimersByTime(1000);
  expect(controller.getSnapshot().cursor).toBe(2);
  controller.seek(0);
  expect(a.requests).toHaveLength(1);
  controller.play();
  controller.prepare([1]);
  vi.advanceTimersByTime(1000);
  expect(controller.getSnapshot().cursor).toBe(0);
  expect(controller.getSnapshot().groupId).not.toBe(old);
  controller.invalidate();
});
it('new run invalidates old identities while empty input still has a real trace', async () => {
  const a = new Client(),
    b = new Client(),
    controller = new RecursivePairController({ clients: [a, b] });
  controller.prepare([]);
  await controller.execute();
  const first = controller.getSnapshot().lanes.map((l) => l.request!.runId);
  await controller.execute();
  expect(controller.getSnapshot().lanes.every((l, i) => l.request!.runId !== first[i])).toBe(true);
  controller.invalidate();
});
