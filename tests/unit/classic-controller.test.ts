import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { initSync, execute_memory } from '../../web/src/generated/memory/c_viz_memory';
import { engineBuild } from '../../web/src/generated/memory/engine-build';
import { MemoryExecutionClient } from '../../web/src/engine/memory-client';
import {
  decodeMemoryResult,
  encodeMemoryRequest,
  type MemoryRequest,
  type MemoryResult,
} from '../../web/src/engine/memory-protocol';
import { ClassicController } from '../../web/src/classics/controller';
import { classicCases, prepareClassic } from '../../web/src/classics/content';
beforeAll(() =>
  initSync({ module: readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm') }),
);
afterEach(() => vi.useRealTimers());
async function real(r: MemoryRequest) {
  return decodeMemoryResult(
    execute_memory(encodeMemoryRequest(r), engineBuild.wasmSha256, 1000).slice().buffer,
    r,
    engineBuild.wasmSha256,
  );
}
class RealClient extends MemoryExecutionClient {
  requests: MemoryRequest[] = [];
  override execute(r: MemoryRequest) {
    this.requests.push(structuredClone(r));
    return real(r);
  }
}
class HeldClient extends MemoryExecutionClient {
  pending: {
    request: MemoryRequest;
    resolve: (r: MemoryResult) => void;
    reject: (e: Error) => void;
  }[] = [];
  override execute(request: MemoryRequest) {
    return new Promise<MemoryResult>((resolve, reject) =>
      this.pending.push({ request, resolve, reject }),
    );
  }
  override invalidate() {}
  override cancel() {
    this.pending.at(-1)?.reject(Error('E_CANCELLED'));
  }
}
it('exact source and fixed input execute once; replay/seek/rates consume only the accepted trace', async () => {
  const client = new RealClient(),
    c = new ClassicController(client);
  await c.execute(classicCases[0], '3');
  expect(c.getSnapshot().status).toBe('ready');
  expect(client.requests[0].source).toBe(prepareClassic(classicCases[0], '3').source);
  expect(client.requests[0].input).toEqual([3]);
  c.seek(30);
  const saved = c.getSnapshot().view;
  c.step(1);
  c.step(-1);
  expect(c.getSnapshot().view).toEqual(saved);
  for (const r of [0.25, 0.5, 1, 1.5, 2, 4]) c.setRate(r);
  c.replay();
  expect(c.getSnapshot().view.cursor).toBe(0);
  expect(client.requests).toHaveLength(1);
  c.invalidate();
});
it('genuine older Hanoi result cannot replace the new GCD source or identity', async () => {
  const client = new HeldClient(),
    c = new ClassicController(client),
    old = c.execute(classicCases[0], '2'),
    a = client.pending[0],
    ar = await real(a.request),
    fresh = c.execute(classicCases[1], '84 30'),
    b = client.pending[1],
    br = await real(b.request);
  a.resolve(ar);
  await old;
  expect(c.getSnapshot().status).toBe('running');
  expect(c.getSnapshot().result).toBeNull();
  b.resolve(br);
  await fresh;
  expect(c.getSnapshot().result).toBe(br);
  expect(c.getSnapshot().request!.input).toEqual([84, 30]);
  c.invalidate();
});
it('clear/unmount invalidate real late results and malformed input never executes', async () => {
  for (const reason of ['clear', 'unmount']) {
    const client = new HeldClient(),
      c = new ClassicController(client),
      pending = c.execute(classicCases[0], '1'),
      item = client.pending[0],
      r = await real(item.request);
    c.invalidate();
    item.resolve(r);
    await pending;
    expect(c.getSnapshot().view.state, reason).toBeNull();
    await c.execute(classicCases[0], '6');
    expect(c.getSnapshot().error).toBe('E_INPUT_INVALID');
    expect(client.pending).toHaveLength(1);
    c.invalidate();
  }
});
it('cancel/deadline reject without retaining an accepted picture', async () => {
  const client = new HeldClient(),
    c = new ClassicController(client);
  let pending = c.execute(classicCases[0], '1');
  c.cancel();
  await pending;
  expect(c.getSnapshot().error).toBe('E_CANCELLED');
  pending = c.execute(classicCases[1], '0 0');
  client.pending[1].reject(Error('E_DEADLINE'));
  await pending;
  expect(c.getSnapshot().error).toBe('E_DEADLINE');
  expect(c.getSnapshot().view.state).toBeNull();
  c.invalidate();
});
it('one timer chain obeys speed/pause/invalidation without stale ticks', async () => {
  const c = new ClassicController(new RealClient());
  await c.execute(classicCases[1], '84 30');
  vi.useFakeTimers();
  c.play();
  vi.advanceTimersByTime(500);
  expect(c.getSnapshot().view.cursor).toBe(1);
  c.setRate(4);
  vi.advanceTimersByTime(125);
  expect(c.getSnapshot().view.cursor).toBe(2);
  c.pause();
  vi.advanceTimersByTime(1000);
  expect(c.getSnapshot().view.cursor).toBe(2);
  c.play();
  c.invalidate();
  vi.advanceTimersByTime(1000);
  expect(c.getSnapshot().view.state).toBeNull();
});
