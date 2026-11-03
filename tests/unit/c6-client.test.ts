/** Controlled delivery tests for lifecycle only. Injected decoders never grant execution receipts. */
import { afterEach, expect, test, vi } from 'vitest';
import { C6ExecutionClient, c6RunRequest, acceptedC6Request } from '../../web/src/engine/c6-client';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';
import type { C6Result, decodeC6Response } from '../../web/src/engine/c6-protocol';
const request = await c6RunRequest('int main(){return 0;}');
function fixture(): C6Result {
  return {
    execVersion: '1.5.0',
    dslVersion: '1.4.0',
    diagnosticVersion: '1.4.0',
    integerEncoding: '1.0.0',
    language: 'c',
    engine: { id: 'engine.rust.c6', version: '0.1.0', buildId: engineBuild.wasmSha256 },
    identity: {
      runId: request.runId,
      sourceRevision: request.sourceRevision,
      sourceSha256: request.sourceSha256,
    },
    types: [],
    nodeMap: [],
    trace: null,
    terminal: {
      status: 'error',
      code: 'E_PARSE_INVALID',
      byteRange: null,
      cursor: 0,
      returnValue: null,
    },
    stats: { fuelUsed: 0 },
  };
}
class WorkerStub {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  message?: { operationId: string; buffer: ArrayBuffer; remainingMs: number };
  terminate = vi.fn();
  postMessage = vi.fn((message) => {
    this.message = message;
  });
  reply(handler = this.onmessage, code?: string) {
    handler?.call(
      this as unknown as Worker,
      new MessageEvent('message', {
        data: code
          ? { ok: false, operationId: this.message!.operationId, code }
          : {
              ok: true,
              operationId: this.message!.operationId,
              buffer: new ArrayBuffer(1),
              wasmPages: 1,
            },
      }),
    );
  }
}
const clients: C6ExecutionClient[] = [];
function setup() {
  const workers: WorkerStub[] = [],
    now = vi.fn(() => 0),
    fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(new Uint8Array(engineBuild.wasmBytes), {
          headers: { 'content-type': 'application/wasm' },
        }),
    );
  const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  const decode = vi.fn<typeof decodeC6Response>(async () => fixture());
  const client = new C6ExecutionClient({
    now,
    fetcher,
    compile: async () => module,
    decode,
    digest: async () =>
      Uint8Array.from(engineBuild.wasmSha256.match(/../g)!, (s) => parseInt(s, 16)).buffer,
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
  for (const c of clients.splice(0)) c.invalidate();
  vi.useRealTimers();
});
test('cancel rejects a queued old delivery and releases its Worker', async () => {
  const h = setup(),
    pending = h.client.execute(request).catch((e: Error) => e.message);
  await until(() => h.workers.length === 1);
  const worker = h.workers[0],
    callback = worker.onmessage;
  h.client.cancel();
  worker.reply(callback);
  expect(await pending).toBe('E_CANCELLED');
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(h.decode).not.toHaveBeenCalled();
});
test('changing source revision and stdin supersedes the old callback', async () => {
  const h = setup(),
    old = h.client.execute(request).catch((e: Error) => e.message);
  await until(() => h.workers.length === 1);
  const callback = h.workers[0].onmessage;
  const latest = h.client.execute({
    ...request,
    runId: 'latest',
    sourceRevision: 'new-revision',
    input: { kind: 'stdin-ascii', text: '3' },
  });
  await until(() => h.workers.length === 2);
  h.workers[0].reply(callback);
  h.workers[1].reply();
  expect(await old).toBe('E_CANCELLED');
  await latest;
  expect(h.decode).toHaveBeenCalledOnce();
  expect(h.decode.mock.calls[0]?.[1]).toMatchObject({
    sourceRevision: 'new-revision',
    input: { text: '3' },
  });
});
test('caller mutations cannot change the captured source, hash or stdin', async () => {
  const h = setup(),
    draft = structuredClone(request),
    pending = h.client.execute(draft);
  draft.source = 'changed';
  draft.sourceSha256 = '0'.repeat(64);
  draft.input.text = 'changed';
  await until(() => h.workers.length === 1);
  const wire = JSON.parse(new TextDecoder().decode(h.workers[0].message!.buffer));
  expect(wire).toMatchObject({
    source: request.source,
    sourceSha256: request.sourceSha256,
    input: { text: '' },
  });
  h.workers[0].reply();
  await pending;
});
test('all clients share one live Worker and one compiled module owner', async () => {
  const first = setup(),
    second = setup(),
    old = first.client.execute(request).catch((e: Error) => e.message);
  await until(() => first.workers.length === 1);
  const latest = second.client.execute({ ...request, runId: 'other' });
  await until(() => second.workers.length === 1);
  second.workers[0].reply();
  expect(await old).toBe('E_CANCELLED');
  await latest;
  expect(first.workers[0].terminate).toHaveBeenCalledOnce();
  expect(first.client.inspect().cachedModules).toBe(0);
  expect(second.client.inspect().cachedModules).toBe(1);
});
test('a late reply is refused before decoding and validation time shares the deadline', async () => {
  const h = setup(),
    pending = h.client.execute(request).catch((e: Error) => e.message);
  await until(() => h.workers.length === 1);
  h.now.mockReturnValue(1000);
  h.workers[0].reply();
  expect(await pending).toBe('E_DEADLINE');
  expect(h.decode).not.toHaveBeenCalled();
  const next = setup();
  next.decode.mockImplementation(async (_bytes, _request, _build, guard) => {
    next.now.mockReturnValue(400);
    guard?.();
    return fixture();
  });
  const validation = next.client.execute(request, { started: -600 }).catch((e: Error) => e.message);
  await until(() => next.workers.length === 1);
  expect(next.workers[0].message!.remainingMs).toBe(400);
  next.workers[0].reply();
  expect(await validation).toBe('E_DEADLINE');
});
test('deadline timer, invalid shared starts and input encodings never allocate extra Workers', async () => {
  vi.useFakeTimers();
  const h = setup(),
    pending = h.client.execute(request, { started: -600 }).catch((e: Error) => e.message);
  await until(() => h.workers.length === 1);
  vi.advanceTimersByTime(400);
  expect(await pending).toBe('E_DEADLINE');
  expect(h.client.inspect().activeWorkers).toBe(0);
  for (const started of [1, NaN, Infinity, -1000]) {
    const x = setup();
    await expect(x.client.execute(request, { started })).rejects.toThrow();
    expect(x.workers).toHaveLength(0);
    expect(x.fetcher).not.toHaveBeenCalled();
  }
  const bad = setup();
  await expect(
    bad.client.execute({ ...request, input: { kind: 'stdin-ascii', text: '\0' } }),
  ).rejects.toThrow('E_PROTOCOL_INVALID');
  expect(bad.workers).toHaveLength(0);
});
test('injected decoder results never mint production learning receipts', async () => {
  const h = setup(),
    pending = h.client.execute(request);
  await until(() => h.workers.length === 1);
  h.workers[0].reply();
  const result = await pending;
  expect(acceptedC6Request(result)).toBeNull();
  expect(h.client.inspect().state).toBe('accepted');
});
test('only frozen diagnostic codes pass through Worker failures and a later operation recovers', async () => {
  for (const code of ['E_DUPLICATE', 'E_CONST_WRITE', 'E_NOT_REAL']) {
    const h = setup(),
      pending = h.client.execute(request).catch((e: Error) => e.message);
    await until(() => h.workers.length === 1);
    h.workers[0].reply(undefined, code);
    expect(await pending).toBe(code === 'E_NOT_REAL' ? 'E_WORKER_FAILURE' : code);
    const next = h.client.execute(request);
    await until(() => h.workers.length === 2);
    h.workers[1].reply();
    await next;
    expect(h.client.inspect().activeWorkers).toBe(0);
  }
});
test('cancellation during asynchronous decoding cannot publish a result', async () => {
  const h = setup();
  let complete: ((value: C6Result) => void) | undefined;
  h.decode.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve as (value: C6Result) => void;
      }),
  );
  const pending = h.client.execute(request).catch((e: Error) => e.message);
  await until(() => h.workers.length === 1);
  h.workers[0].reply();
  await until(() => !!complete);
  h.client.invalidate();
  complete!(fixture());
  expect(await pending).toBe('E_CANCELLED');
  expect(h.client.inspect().state).toBe('invalidated');
});
