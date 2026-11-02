// Injected lifecycle tests. Only the browser tests prove real Rust execution.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  caseRequest,
  ExecutionClient,
  type ExecutionCatalog,
} from '../../web/src/engine/execution-client';
import { engineBuild } from '../../web/src/generated/engine-build';
import { makeAdapterResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import type { ContentPackage } from '../../web/src/content/types';

const content = JSON.parse(
  readFileSync(new URL('../../shared/contracts/02.1-内容样例.json', import.meta.url), 'utf8'),
) as ContentPackage;
const subject = content.cases[0]!;
const program = content.programs.find((item) => item.id === subject.programRef.id)!;
const catalog: ExecutionCatalog = {
  packageRef: { id: content.packageId, version: content.packageVersion },
  subject,
  program,
  inputSpec: content.inputSpecs.find((item) => item.id === program.inputRef.id)!,
};
const source = { text: program.sourceExample, blockMap: [], bindingMap: [] };
function request() {
  return caseRequest(catalog, source, {
    contextId: 'unit-context',
    contextRevision: 1,
    sourceRevision: 1,
  });
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
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
  reply(
    value = { ok: true, operationId: this.message!.operationId, buffer: new ArrayBuffer(1) },
    handler = this.onmessage,
  ) {
    handler?.call(this as unknown as Worker, new MessageEvent('message', { data: value }));
  }
}
const clients: ExecutionClient[] = [];
test('UI bookkeeping never enters the protocol identity', () => {
  const ui = { contextId: 'ui-context', contextRevision: 1, sourceRevision: 1, token: 7 };
  expect(caseRequest(catalog, source, ui).identity).not.toHaveProperty('token');
});
function setup() {
  const workers: WorkerStub[] = [];
  const now = vi.fn(() => 0);
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(new Uint8Array(engineBuild.wasmBytes), {
        headers: { 'content-type': 'application/wasm' },
      }),
  );
  const digest = vi.fn(
    async () =>
      Uint8Array.from(engineBuild.wasmSha256.match(/../g)!, (pair) => parseInt(pair, 16)).buffer,
  );
  const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  const compile = vi.fn(async () => module);
  const decode = vi.fn(async (_buffer: ArrayBuffer, req: ExecuteRequest, guard?: () => void) => {
    guard?.();
    return {
      ...makeAdapterResult(req, 'rejected', 'E_CONTENT_MISMATCH'),
      producer: 'rust' as const,
    };
  });
  const client = new ExecutionClient({
    now,
    fetcher,
    digest,
    compile,
    decode,
    createWorker: () => {
      const worker = new WorkerStub();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
  clients.push(client);
  return { client, now, fetcher, digest, compile, decode, workers, module };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const client of clients.splice(0)) client.invalidate();
  vi.useRealTimers();
});

test.each(['fetch', 'digest', 'compile'] as const)(
  'cancelling during %s terminates the waiting worker and prevents late posts or cache writes',
  async (phase) => {
    const h = setup();
    const response = pending<Response>(),
      hash = pending<ArrayBuffer>(),
      compiled = pending<WebAssembly.Module>();
    if (phase === 'fetch') h.fetcher.mockReturnValue(response.promise);
    if (phase === 'digest') h.digest.mockReturnValue(hash.promise);
    if (phase === 'compile') h.compile.mockReturnValue(compiled.promise);
    const result = h.client.execute(request(), catalog);
    await until(() =>
      phase === 'fetch'
        ? h.fetcher.mock.calls.length > 0
        : phase === 'digest'
          ? h.digest.mock.calls.length > 0
          : h.compile.mock.calls.length > 0,
    );
    h.client.cancel();
    response.resolve(
      new Response(new Uint8Array(engineBuild.wasmBytes), {
        headers: { 'content-type': 'application/wasm' },
      }),
    );
    hash.resolve(
      Uint8Array.from(engineBuild.wasmSha256.match(/../g)!, (pair) => parseInt(pair, 16)).buffer,
    );
    compiled.resolve(h.module);
    expect((await result).terminal.status).toBe('cancelled');
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(h.workers).toHaveLength(1);
    expect(h.workers[0].terminate).toHaveBeenCalledOnce();
    expect(h.workers[0].postMessage).not.toHaveBeenCalled();
    expect(h.client.inspect().cachedModules).toBe(0);
  },
);
test('a waiting worker cannot publish startup messages or receive user data before the trusted module', async () => {
  const h = setup();
  h.fetcher.mockReturnValue(pending<Response>().promise);
  const result = h.client.execute(request(), catalog);
  await until(() => h.workers.length === 1);
  h.workers[0].reply({ ok: true, operationId: 'startup', buffer: new ArrayBuffer(1) });
  expect(h.decode).not.toHaveBeenCalled();
  expect(h.workers[0].postMessage).not.toHaveBeenCalled();
  h.client.cancel();
  expect((await result).terminal.status).toBe('cancelled');
  expect(h.workers[0].terminate).toHaveBeenCalledOnce();
});
test('the timer expires an unresolved download without trace, stats or judge', async () => {
  const h = setup();
  h.fetcher.mockReturnValue(pending<Response>().promise);
  const result = h.client.execute(request(), catalog);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toMatchObject({
    producer: 'adapter',
    trace: null,
    stats: null,
    judgeResult: null,
    terminal: { status: 'resource-limit', diagnostics: [{ code: 'E_DEADLINE' }] },
  });
});
test('an already exhausted shared deadline starts neither Worker nor module fetch', async () => {
  const h = setup();
  const result = await h.client.execute(request(), catalog, undefined, -1000);
  expect(result.terminal.diagnostics[0]?.code).toBe('E_DEADLINE');
  expect(h.workers).toHaveLength(0);
  expect(h.fetcher).not.toHaveBeenCalled();
  expect(h.client.inspect().activeWorkers).toBe(0);
});
test('superseding invalidates before terminating and ignores an already queued old callback', async () => {
  const h = setup();
  const old = h.client.execute(request(), catalog);
  await until(() => Boolean(h.workers[0]?.message));
  const worker = h.workers[0]!,
    handler = worker.onmessage;
  const latest = h.client.execute(request(), catalog);
  await until(() => Boolean(h.workers[1]?.message));
  expect((await old).terminal.status).toBe('cancelled');
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.reply(undefined, handler);
  expect(h.decode).not.toHaveBeenCalled();
  h.workers[1]!.reply();
  await latest;
  expect(h.decode).toHaveBeenCalledOnce();
  expect(h.client.inspect()).toMatchObject({
    state: 'accepted',
    activeWorkers: 0,
    cachedModules: 1,
  });
});
test('late cancellation and repeated terminal callbacks preserve an accepted terminal', async () => {
  const h = setup();
  const commit = vi.fn();
  const result = h.client.execute(request(), catalog, commit);
  await until(() => Boolean(h.workers[0]?.message));
  const worker = h.workers[0]!,
    handler = worker.onmessage;
  worker.reply();
  await result;
  h.client.cancel();
  worker.reply(undefined, handler);
  expect(commit).toHaveBeenCalledOnce();
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(h.client.inspect().state).toBe('accepted');
});
test('a source change in the caller cannot mutate the dispatched identity or source', async () => {
  const h = setup();
  const req = request();
  const original = req.identity.contextId;
  const result = h.client.execute(req, catalog);
  req.identity.contextId = 'edited';
  await until(() => Boolean(h.workers[0]?.message));
  h.workers[0]!.reply();
  expect((await result).identity.contextId).toBe(original);
});
test.each(['validation', 'commit'] as const)(
  'expiry during %s returns failure and cannot become accepted',
  async (phase) => {
    const h = setup();
    if (phase === 'validation')
      h.decode.mockImplementation(async (_buffer, req) => {
        h.now.mockReturnValue(1000);
        return {
          ...makeAdapterResult(req, 'rejected', 'E_CONTENT_MISMATCH'),
          producer: 'rust' as const,
        };
      });
    const result = h.client.execute(request(), catalog, () => {
      if (phase === 'commit') h.now.mockReturnValue(1000);
    });
    await until(() => Boolean(h.workers[0]?.message));
    h.workers[0]!.reply();
    expect((await result).terminal.diagnostics[0]!.code).toBe('E_DEADLINE');
    expect(h.client.inspect().state).toBe('expired');
  },
);
test('a wrong operation and an oversized buffer fail before decoding', async () => {
  for (const bad of ['identity', 'size']) {
    const h = setup();
    const result = h.client.execute(request(), catalog);
    await until(() => Boolean(h.workers[0]?.message));
    h.workers[0]!.reply({
      ok: true,
      operationId: bad === 'identity' ? 'wrong' : h.workers[0]!.message!.operationId,
      buffer: new ArrayBuffer(bad === 'size' ? 16777217 : 1),
    });
    expect((await result).terminal.status).toBe('infrastructure-failure');
    expect(h.decode).not.toHaveBeenCalled();
  }
});
