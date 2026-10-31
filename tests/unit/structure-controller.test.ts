import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { initSync, execute_algorithm } from '../../web/src/generated/algorithm/c_viz_algorithm';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
import { AlgorithmExecutionClient } from '../../web/src/engine/algorithm-client';
import {
  encodeAlgorithmRequest,
  decodeAlgorithmResult,
  type AlgorithmRequest,
  type AlgorithmResult,
} from '../../web/src/engine/algorithm-protocol';
import { StructureController } from '../../web/src/structures/controller';
import { structureCases, prepareStructure } from '../../web/src/structures/content';
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
class RealClient extends AlgorithmExecutionClient {
  requests: AlgorithmRequest[] = [];
  override execute(request: AlgorithmRequest) {
    this.requests.push(structuredClone(request));
    return real(request);
  }
}
class HeldClient extends AlgorithmExecutionClient {
  pending: {
    request: AlgorithmRequest;
    resolve: (result: AlgorithmResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  override execute(request: AlgorithmRequest) {
    return new Promise<AlgorithmResult>((resolve, reject) =>
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
    controller = new StructureController(client),
    spec = structureCases[0],
    draft = '入 -999\n出\n出';
  await controller.execute(spec, draft);
  expect(controller.getSnapshot().status).toBe('ready');
  expect(client.requests).toHaveLength(1);
  expect(client.requests[0].source).toBe(prepareStructure(spec, draft).source);
  expect(client.requests[0].input).toEqual([1, -999, 2, 2]);
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
it('actual old stack result cannot replace a newer queue draft and identity', async () => {
  const client = new HeldClient(),
    controller = new StructureController(client),
    old = controller.execute(structureCases[0], '入 7\n出'),
    a = client.pending[0],
    oldResult = await real(a.request);
  const fresh = controller.execute(structureCases[1], '入 -3\n出'),
    b = client.pending[1],
    freshResult = await real(b.request);
  a.resolve(oldResult);
  await old;
  expect(controller.getSnapshot().status).toBe('running');
  expect(controller.getSnapshot().result).toBeNull();
  b.resolve(freshResult);
  await fresh;
  expect(controller.getSnapshot().result).toBe(freshResult);
  expect(controller.getSnapshot().request?.input).toEqual([1, -3, 2]);
  controller.invalidate();
});
it('clear/unmount invalidation rejects genuine late replies; malformed input never reaches a client', async () => {
  for (const reason of ['clear', 'unmount']) {
    const client = new HeldClient(),
      controller = new StructureController(client),
      pending = controller.execute(structureCases[0], '入 0'),
      a = client.pending[0],
      result = await real(a.request);
    controller.invalidate();
    a.resolve(result);
    await pending;
    expect(controller.getSnapshot().status, reason).toBe('idle');
    expect(controller.getSnapshot().view.state).toBeNull();
    await controller.execute(structureCases[0], '入 1000');
    expect(controller.getSnapshot().error).toBe('E_INPUT_INVALID');
    expect(client.pending).toHaveLength(1);
    controller.invalidate();
  }
});
it('cancel and native-style deadline failure leave no previous accepted picture', async () => {
  const client = new HeldClient(),
    controller = new StructureController(client);
  let pending = controller.execute(structureCases[0], '入 1');
  controller.cancel();
  await pending;
  expect(controller.getSnapshot().error).toBe('E_CANCELLED');
  expect(controller.getSnapshot().result).toBeNull();
  pending = controller.execute(structureCases[1], '出');
  client.pending[1].reject(Error('E_DEADLINE'));
  await pending;
  expect(controller.getSnapshot().error).toBe('E_DEADLINE');
  expect(controller.getSnapshot().view.state).toBeNull();
  controller.invalidate();
});
it('one cancellable timer chain handles six rates, pause and replacement without stale ticks', async () => {
  const controller = new StructureController(new RealClient());
  await controller.execute(structureCases[1], '入 1\n出');
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
