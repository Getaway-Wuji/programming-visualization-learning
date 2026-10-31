import { afterEach, expect, test, vi } from 'vitest';
import { AlgorithmExecutionClient } from '../../web/src/engine/algorithm-client';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
import type { decodeAlgorithmResult } from '../../web/src/engine/algorithm-protocol';
import { fixture, request } from './algorithm-fixture';

class WorkerStub {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  message?: { operationId: string; buffer: ArrayBuffer; remainingMs: number };
  terminate = vi.fn();
  postMessage = vi.fn((message) => {
    this.message = message;
  });
  reply(handler = this.onmessage) {
    handler?.call(
      this as unknown as Worker,
      new MessageEvent('message', {
        data: {
          ok: true,
          operationId: this.message!.operationId,
          buffer: new ArrayBuffer(1),
          wasmPages: 1,
        },
      }),
    );
  }
}
const clients: AlgorithmExecutionClient[] = [];
function setup() {
  const workers: WorkerStub[] = [];
  const now = vi.fn(() => 0);
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(new Uint8Array(engineBuild.wasmBytes), {
        headers: { 'content-type': 'application/wasm' },
      }),
  );
  const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  const compile = vi.fn(async () => module);
  const decode = vi.fn<typeof decodeAlgorithmResult>(async () => fixture(engineBuild.wasmSha256));
  const client = new AlgorithmExecutionClient({
    now,
    fetcher,
    compile,
    decode,
    digest: async () =>
      Uint8Array.from(engineBuild.wasmSha256.match(/../g)!, (pair) => parseInt(pair, 16)).buffer,
    createWorker: () => {
      const worker = new WorkerStub();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
  clients.push(client);
  return { client, workers, now, decode, fetcher };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await Promise.resolve();
  expect(check()).toBe(true);
}
afterEach(() => {
  for (const client of clients.splice(0)) client.invalidate();
  vi.useRealTimers();
});
test('cancelling an in-flight run terminates Worker and rejects queued success', async () => {
  const h = setup();
  const pending = h.client.execute(request).catch((error: Error) => error.message);
  await until(() => h.workers.length === 1);
  const worker = h.workers[0],
    handler = worker.onmessage;
  h.client.cancel();
  worker.reply(handler);
  expect(await pending).toBe('E_CANCELLED');
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(h.decode).not.toHaveBeenCalled();
});
test('source/language replacement supersedes identity and the old callback cannot accept', async () => {
  const h = setup();
  const old = h.client.execute(request).catch((error: Error) => error.message);
  await until(() => h.workers.length === 1);
  const handler = h.workers[0].onmessage;
  const latest = h.client.execute({
    ...request,
    runId: 'replacement',
    sourceRevision: 'revision2',
    language: 'cpp',
  });
  await until(() => h.workers.length === 2);
  h.workers[0].reply(handler);
  h.workers[1].reply();
  expect(await old).toBe('E_CANCELLED');
  await expect(latest).resolves.toBeDefined();
  expect(h.decode).toHaveBeenCalledOnce();
  expect(h.decode.mock.calls[0]?.[1]).toMatchObject({
    language: 'cpp',
    sourceRevision: 'revision2',
  });
});
test('deadline is rechecked at reply and no late success reaches validation', async () => {
  const h = setup();
  const pending = h.client.execute(request).catch((error: Error) => error.message);
  await until(() => h.workers.length === 1);
  h.now.mockReturnValue(1000);
  h.workers[0].reply();
  expect(await pending).toBe('E_DEADLINE');
  expect(h.decode).not.toHaveBeenCalled();
  expect(h.client.inspect()).toMatchObject({ state: 'expired', activeWorkers: 0 });
});
test('another execution client claims the same single Worker slot', async () => {
  const first = setup(),
    second = setup();
  const old = first.client.execute(request).catch((error: Error) => error.message);
  await until(() => first.workers.length === 1);
  const replacement = second.client.execute({ ...request, runId: 'second' });
  await until(() => second.workers.length === 1);
  second.workers[0].reply();
  expect(await old).toBe('E_CANCELLED');
  await replacement;
  expect(first.workers[0].terminate).toHaveBeenCalledOnce();
  expect(first.client.inspect().cachedModules).toBe(0);
  expect(second.client.inspect().cachedModules).toBe(1);
});
test('caller edits after submit cannot mutate the captured source or input', async () => {
  const h = setup();
  const draft = structuredClone(request);
  const pending = h.client.execute(draft);
  draft.source = 'changed';
  draft.input.push(42);
  draft.language = 'cpp';
  await until(() => h.workers.length === 1);
  const wire = JSON.parse(new TextDecoder().decode(h.workers[0].message!.buffer));
  expect(wire).toMatchObject({ source: request.source, input: [], language: 'c' });
  h.workers[0].reply();
  await pending;
});
test('a shared start gives the second operation only the remaining Worker and timer budget', async () => {
  vi.useFakeTimers();
  const h = setup();
  const pending = h.client.execute(request, -600).catch((error: Error) => error.message);
  await until(() => h.workers.length === 1);
  expect(h.workers[0].message!.remainingMs).toBe(400);
  vi.advanceTimersByTime(399);
  expect(h.client.inspect().activeWorkers).toBe(1);
  vi.advanceTimersByTime(1);
  expect(await pending).toBe('E_DEADLINE');
  expect(h.workers[0].terminate).toHaveBeenCalledOnce();
});
test('expired, future and nonfinite shared starts never load or allocate a Worker', async () => {
  for (const start of [-1000, 1, NaN, Infinity]) {
    const h = setup();
    await expect(h.client.execute(request, start)).rejects.toThrow('E_DEADLINE');
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.workers).toHaveLength(0);
  }
});
test('the shared deadline includes asynchronous result validation', async () => {
  const h = setup();
  h.decode.mockImplementation(async (_bytes, _request, _build, guard) => {
    h.now.mockReturnValue(400);
    guard?.();
    return fixture(engineBuild.wasmSha256);
  });
  const pending = h.client.execute(request, -600).catch((error: Error) => error.message);
  await until(() => h.workers.length === 1);
  h.workers[0].reply();
  expect(await pending).toBe('E_DEADLINE');
  expect(h.client.inspect().state).toBe('expired');
});
