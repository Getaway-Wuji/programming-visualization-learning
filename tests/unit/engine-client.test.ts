// These tests exercise the production client's lifecycle through injected
// dependencies. Fake Workers and the empty module do not prove Rust execution.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EngineClient } from '../../web/src/engine/client';
import { engineBuild } from '../../web/src/generated/engine-build';
import type { BuildCheckReport, ProbeRequest } from '../../web/src/engine/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function hashBuffer() {
  return Uint8Array.from(engineBuild.wasmSha256.match(/../g)!, (pair) => Number.parseInt(pair, 16))
    .buffer;
}

function moduleResponse() {
  return new Response(new Uint8Array(engineBuild.wasmBytes), {
    headers: { 'Content-Type': 'application/wasm' },
  });
}

class FakeWorker {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  readonly requests: ProbeRequest[] = [];
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn((request: ProbeRequest) => {
    this.requests.push(request);
  });

  get worker() {
    return this as unknown as Worker;
  }

  reply(data: unknown, handler = this.onmessage) {
    handler?.call(this.worker, new MessageEvent('message', { data }));
  }

  successfulResponse(overrides: Record<string, unknown> = {}) {
    const request = this.requests[0]!;
    const build = {
      kind: 'build-probe',
      probeVersion: '1.0.0',
      nonce: request.nonce,
      engineVersion: engineBuild.engineVersion,
      interpreterReady: false,
    };
    return {
      ok: true,
      checkId: request.checkId,
      workerInstanceId: `unit-worker-${request.checkId}`,
      maximumPages: 2048,
      buffer: new TextEncoder().encode(JSON.stringify(build)).buffer,
      ...overrides,
    };
  }
}

const clients: EngineClient[] = [];

function harness() {
  const workers: FakeWorker[] = [];
  const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => moduleResponse());
  const digest = vi
    .fn<(bytes: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>>()
    .mockImplementation(async () => hashBuffer());
  const compile = vi.fn<typeof WebAssembly.compile>().mockResolvedValue(module);
  const now = vi.fn<() => number>().mockReturnValue(0);
  const createWorker = vi.fn<() => Worker>().mockImplementation(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker.worker;
  });
  const client = new EngineClient({ fetcher, digest, compile, now, createWorker });
  clients.push(client);
  return { client, workers, module, fetcher, digest, compile, now, createWorker };
}

function observe(promise: Promise<BuildCheckReport>) {
  return promise.then(
    (value) => ({ status: 'resolved' as const, value }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 80 && !predicate(); attempt++) await Promise.resolve();
  expect(predicate()).toBe(true);
}

async function flush() {
  for (let attempt = 0; attempt < 40; attempt++) await Promise.resolve();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const client of clients.splice(0)) client.cancel();
  vi.useRealTimers();
});

describe('EngineClient dependency-injected lifecycle', () => {
  test('cancelling an unresolved fetch aborts it and rejects its late response', async () => {
    const setup = harness();
    const response = deferred<Response>();
    setup.fetcher.mockReturnValue(response.promise);
    const outcome = observe(setup.client.check());
    const signal = setup.fetcher.mock.calls[0]![1]!.signal!;

    setup.client.cancel();
    expect(signal.aborted).toBe(true);
    await expect(outcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'CHECK_CANCELLED' },
    });
    response.resolve(moduleResponse());
    await flush();

    expect(setup.digest).not.toHaveBeenCalled();
    expect(setup.compile).not.toHaveBeenCalled();
    expect(setup.createWorker).not.toHaveBeenCalled();
    expect(setup.client.inspect()).toEqual({
      state: 'cancelled',
      checkId: null,
      activeWorkers: 0,
      cachedModules: 0,
    });
  });

  test.each(['digest', 'compile'] as const)(
    'cancellation during %s prevents a late completion from caching or starting a Worker',
    async (phase) => {
      const setup = harness();
      const pendingDigest = deferred<ArrayBuffer>();
      const pendingCompile = deferred<WebAssembly.Module>();
      if (phase === 'digest') setup.digest.mockReturnValue(pendingDigest.promise);
      else setup.compile.mockReturnValue(pendingCompile.promise);
      const outcome = observe(setup.client.check());
      await until(() => setup[phase].mock.calls.length === 1);

      setup.client.cancel();
      pendingDigest.resolve(hashBuffer());
      pendingCompile.resolve(setup.module);
      await expect(outcome).resolves.toMatchObject({
        status: 'rejected',
        error: { code: 'CHECK_CANCELLED' },
      });
      await flush();

      expect(setup.client.inspect().cachedModules).toBe(0);
      expect(setup.createWorker).not.toHaveBeenCalled();
      if (phase === 'digest') expect(setup.compile).not.toHaveBeenCalled();
    },
  );

  test.each(['digest', 'compile'] as const)(
    'the original deadline expires during %s without granting another time budget',
    async (phase) => {
      const setup = harness();
      const pendingDigest = deferred<ArrayBuffer>();
      const pendingCompile = deferred<WebAssembly.Module>();
      if (phase === 'digest') setup.digest.mockReturnValue(pendingDigest.promise);
      else setup.compile.mockReturnValue(pendingCompile.promise);
      const outcome = observe(setup.client.check());
      await until(() => setup[phase].mock.calls.length === 1);

      setup.now.mockReturnValue(1000);
      pendingDigest.resolve(hashBuffer());
      pendingCompile.resolve(setup.module);
      await expect(outcome).resolves.toMatchObject({
        status: 'rejected',
        error: { code: 'CHECK_TIMEOUT' },
      });

      expect(setup.client.inspect().state).toBe('timed-out');
      expect(setup.client.inspect().cachedModules).toBe(0);
      expect(setup.createWorker).not.toHaveBeenCalled();
    },
  );

  test('the deadline timer rejects a fetch that never settles', async () => {
    const setup = harness();
    setup.fetcher.mockReturnValue(deferred<Response>().promise);
    const outcome = observe(setup.client.check());
    const signal = setup.fetcher.mock.calls[0]![1]!.signal!;

    await vi.advanceTimersByTimeAsync(1000);

    await expect(outcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'CHECK_TIMEOUT' },
    });
    expect(signal.aborted).toBe(true);
    expect(setup.createWorker).not.toHaveBeenCalled();
  });

  test('a valid reply reaching the deadline during decode/validation is not accepted', async () => {
    const setup = harness();
    const outcome = observe(setup.client.check());
    await until(() => setup.workers.length === 1);
    setup.now.mockReturnValueOnce(999).mockReturnValueOnce(1000).mockReturnValue(1000);

    setup.workers[0]!.reply(setup.workers[0]!.successfulResponse());

    await expect(outcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'CHECK_TIMEOUT' },
    });
    expect(setup.workers[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(setup.client.inspect().state).toBe('timed-out');
  });

  test('a reply reaching the deadline while forming the final report is not accepted', async () => {
    const setup = harness();
    const outcome = observe(setup.client.check());
    await until(() => setup.workers.length === 1);
    setup.now.mockReturnValueOnce(998).mockReturnValueOnce(999).mockReturnValue(1000);

    setup.workers[0]!.reply(setup.workers[0]!.successfulResponse());

    await expect(outcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'CHECK_TIMEOUT' },
    });
    expect(setup.workers[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(setup.client.inspect().state).toBe('timed-out');
  });

  test.each(['checkId', 'nonce', 'fatal-utf8', 'oversized', 'duplicate-key'] as const)(
    'rejects a %s response without reporting readiness',
    async (problem) => {
      const setup = harness();
      const outcome = observe(setup.client.check());
      await until(() => setup.workers.length === 1);
      const worker = setup.workers[0]!;
      let response = worker.successfulResponse();
      if (problem === 'checkId') response = worker.successfulResponse({ checkId: 'other-check' });
      if (problem === 'nonce') {
        const body = JSON.parse(new TextDecoder().decode(response.buffer));
        body.nonce = (worker.requests[0]!.nonce + 1) % 4294967296;
        response = worker.successfulResponse({
          buffer: new TextEncoder().encode(JSON.stringify(body)).buffer,
        });
      }
      if (problem === 'fatal-utf8') {
        response = worker.successfulResponse({ buffer: new Uint8Array([0xc3, 0x28]).buffer });
      }
      if (problem === 'oversized') {
        response = worker.successfulResponse({ buffer: new ArrayBuffer(1025) });
      }
      if (problem === 'duplicate-key') {
        const body = new TextDecoder().decode(response.buffer);
        response = worker.successfulResponse({
          buffer: new TextEncoder().encode(`{"kind":"build-probe",${body.slice(1)}`).buffer,
        });
      }
      worker.reply(response);

      await expect(outcome).resolves.toMatchObject({
        status: 'rejected',
        error: { code: 'RESPONSE_INVALID' },
      });
      expect(setup.client.inspect().state).toBe('failed');
      expect(setup.client.inspect().activeWorkers).toBe(0);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );

  test('a new check terminates the old Worker and ignores its queued reply', async () => {
    const setup = harness();
    const oldOutcome = observe(setup.client.check());
    await until(() => setup.workers.length === 1);
    const oldWorker = setup.workers[0]!;
    const queuedHandler = oldWorker.onmessage;
    const queuedReply = oldWorker.successfulResponse();

    const newOutcome = observe(setup.client.check());
    await until(() => setup.workers.length === 2);
    const currentWorker = setup.workers[1]!;
    const currentId = currentWorker.requests[0]!.checkId;
    await expect(oldOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'CHECK_CANCELLED' },
    });
    expect(oldWorker.terminate).toHaveBeenCalledTimes(1);
    oldWorker.reply(queuedReply, queuedHandler);

    expect(setup.client.inspect()).toMatchObject({
      state: 'loading',
      checkId: currentId,
      activeWorkers: 1,
    });
    currentWorker.reply(currentWorker.successfulResponse());
    await expect(newOutcome).resolves.toMatchObject({
      status: 'resolved',
      value: { checkId: currentId, moduleMode: 'warm' },
    });
    expect(currentWorker.terminate).toHaveBeenCalledTimes(1);
  });

  test('warm checks reuse only the compiled Module and release distinct Worker objects', async () => {
    const setup = harness();
    const cold = observe(setup.client.check());
    await until(() => setup.workers.length === 1);
    setup.workers[0]!.reply(setup.workers[0]!.successfulResponse());
    await expect(cold).resolves.toMatchObject({
      status: 'resolved',
      value: { moduleMode: 'cold' },
    });

    const warm = observe(setup.client.check());
    await until(() => setup.workers.length === 2);
    setup.workers[1]!.reply(setup.workers[1]!.successfulResponse());
    await expect(warm).resolves.toMatchObject({
      status: 'resolved',
      value: { moduleMode: 'warm' },
    });

    expect(setup.fetcher).toHaveBeenCalledTimes(1);
    expect(setup.digest).toHaveBeenCalledTimes(1);
    expect(setup.compile).toHaveBeenCalledTimes(1);
    expect(setup.workers[0]).not.toBe(setup.workers[1]);
    for (const worker of setup.workers) {
      expect(worker.requests[0]!.module).toBe(setup.module);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(worker.onmessage).toBeNull();
    }
    expect(setup.client.inspect()).toEqual({
      state: 'ready',
      checkId: null,
      activeWorkers: 0,
      cachedModules: 1,
    });
  });

  test('duplicate terminal callbacks and cancellation cannot rewrite an accepted check', async () => {
    const setup = harness();
    const outcome = observe(setup.client.check());
    await until(() => setup.workers.length === 1);
    const worker = setup.workers[0]!;
    const queuedHandler = worker.onmessage;
    worker.reply(worker.successfulResponse());
    await expect(outcome).resolves.toMatchObject({ status: 'resolved' });

    worker.reply({ checkId: 'bad-check', ok: false }, queuedHandler);
    worker.reply(worker.successfulResponse(), queuedHandler);
    setup.client.cancel();

    expect(setup.client.inspect().state).toBe('ready');
    expect(setup.client.inspect().activeWorkers).toBe(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
