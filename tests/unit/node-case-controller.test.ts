import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { initSync, execute_memory } from '../../web/src/generated/memory/c_viz_memory';
import { engineBuild } from '../../web/src/generated/memory/engine-build';
import { MemoryExecutionClient } from '../../web/src/engine/memory-client';
import {
  encodeMemoryRequest,
  decodeMemoryResult,
  type MemoryRequest,
  type MemoryResult,
} from '../../web/src/engine/memory-protocol';
import { NodeCaseController } from '../../web/src/node-cases/controller';
import { nodeCases, prepareNodeCase } from '../../web/src/node-cases/content';
beforeAll(() =>
  initSync({ module: readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm') }),
);
afterEach(() => vi.useRealTimers());
async function real(request: MemoryRequest) {
  const bytes = execute_memory(encodeMemoryRequest(request), engineBuild.wasmSha256, 1000).slice();
  return decodeMemoryResult(bytes.buffer, request, engineBuild.wasmSha256);
}
class RealClient extends MemoryExecutionClient {
  requests: MemoryRequest[] = [];
  override execute(request: MemoryRequest) {
    this.requests.push(structuredClone(request));
    return real(request);
  }
}
class HeldClient extends MemoryExecutionClient {
  pending: {
    request: MemoryRequest;
    resolve: (result: MemoryResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  override execute(request: MemoryRequest) {
    return new Promise<MemoryResult>((resolve, reject) =>
      this.pending.push({ request, resolve, reject }),
    );
  }
  override invalidate() {
    /* Keep real replies deliverable to exercise the controller's generation guard. */
  }
  override cancel() {
    this.pending.at(-1)?.reject(Error('E_CANCELLED'));
  }
}
it('exact operation encoding/source enters the real client; replay, step and speed never execute again', async () => {
  const client = new RealClient(),
    controller = new NodeCaseController(client),
    spec = nodeCases[0],
    draft = '插 0 -999\n删 0\n遍历';
  await controller.execute(spec, draft);
  expect(controller.getSnapshot().status).toBe('ready');
  expect(client.requests).toHaveLength(1);
  expect(client.requests[0].source).toBe(prepareNodeCase(spec, draft).source);
  expect(client.requests[0].input).toEqual([1, 0, -999, 2, 0, 3]);
  controller.seek(30);
  const saved = controller.getSnapshot().view;
  controller.step(1);
  controller.step(-1);
  expect(controller.getSnapshot().view).toEqual(saved);
  for (const rate of [0.25, 0.5, 1, 1.5, 2, 4]) controller.setRate(rate);
  controller.replay();
  expect(controller.getSnapshot().view.cursor).toBe(0);
  expect(client.requests).toHaveLength(1);
  controller.invalidate();
});
it('actual old list result cannot replace a newer BST draft and identity', async () => {
  const client = new HeldClient(),
    controller = new NodeCaseController(client),
    old = controller.execute(nodeCases[0], '插 0 7\n遍历'),
    a = client.pending[0],
    oldResult = await real(a.request);
  const fresh = controller.execute(nodeCases[1], '插 -3\n前序'),
    b = client.pending[1],
    freshResult = await real(b.request);
  a.resolve(oldResult);
  await old;
  expect(controller.getSnapshot().status).toBe('running');
  expect(controller.getSnapshot().result).toBeNull();
  b.resolve(freshResult);
  await fresh;
  expect(controller.getSnapshot().result).toBe(freshResult);
  expect(controller.getSnapshot().request?.input).toEqual([1, -3, 3]);
  controller.invalidate();
});
it('clear/unmount invalidation rejects genuine late replies; malformed input never reaches a client', async () => {
  for (const reason of ['clear', 'unmount']) {
    const client = new HeldClient(),
      controller = new NodeCaseController(client),
      pending = controller.execute(nodeCases[0], '插 0 0'),
      a = client.pending[0],
      result = await real(a.request);
    controller.invalidate();
    a.resolve(result);
    await pending;
    expect(controller.getSnapshot().status, reason).toBe('idle');
    expect(controller.getSnapshot().view.state).toBeNull();
    await controller.execute(nodeCases[0], '插 0 1000');
    expect(controller.getSnapshot().error).toBe('E_INPUT_INVALID');
    expect(client.pending).toHaveLength(1);
    controller.invalidate();
  }
});
it('cancel and native-style deadline failure leave no previous accepted picture', async () => {
  const client = new HeldClient(),
    controller = new NodeCaseController(client);
  let pending = controller.execute(nodeCases[0], '插 0 1');
  controller.cancel();
  await pending;
  expect(controller.getSnapshot().error).toBe('E_CANCELLED');
  expect(controller.getSnapshot().result).toBeNull();
  pending = controller.execute(nodeCases[1], '中序');
  client.pending[1].reject(Error('E_DEADLINE'));
  await pending;
  expect(controller.getSnapshot().error).toBe('E_DEADLINE');
  expect(controller.getSnapshot().view.state).toBeNull();
  controller.invalidate();
});
it('one cancellable timer chain handles six rates, pause and replacement without stale ticks', async () => {
  const controller = new NodeCaseController(new RealClient());
  await controller.execute(nodeCases[1], '插 1\n中序');
  vi.useFakeTimers();
  controller.play();
  vi.advanceTimersByTime(500);
  expect(controller.getSnapshot().view.cursor).toBe(1);
  controller.setRate(4);
  vi.advanceTimersByTime(125);
  expect(controller.getSnapshot().view.cursor).toBe(2);
  controller.pause();
  vi.advanceTimersByTime(1000);
  expect(controller.getSnapshot().view.cursor).toBe(2);
  controller.play();
  controller.invalidate();
  vi.advanceTimersByTime(1000);
  expect(controller.getSnapshot().view.cursor).toBe(0);
  expect(controller.getSnapshot().view.state).toBeNull();
});
