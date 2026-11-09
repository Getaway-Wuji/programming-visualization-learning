// Controlled resource loading proves initialization/cancellation, not interpreted execution.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ModuleStore, claimEngineSlot } from '../../web/src/engine/module';
import { prepareEngine } from '../../web/src/engine/preparation';

const assets = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../web/src/engine/preparation-assets', () => ({ preparationAssets: assets.load }));

const emptyWasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const wasmHash = '93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476';
const compiled = new WebAssembly.Module(emptyWasm);
const controllers: AbortController[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function signal() {
  const controller = new AbortController();
  controllers.push(controller);
  return controller;
}
function workerResponse(type = 'text/javascript', text = 'self.onmessage = () => {};') {
  return new Response(text, { headers: { 'content-type': type } });
}
function harness() {
  const fetchWasm = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response(emptyWasm, { headers: { 'content-type': 'application/wasm' } }),
    );
  const compile = vi.fn<typeof WebAssembly.compile>().mockResolvedValue(compiled);
  const digest = vi
    .fn()
    .mockResolvedValue(
      Uint8Array.from(wasmHash.match(/../g)!, (pair) => Number.parseInt(pair, 16)).buffer,
    );
  const store = new ModuleStore(
    { fetcher: fetchWasm, compile, digest },
    { url: '/engine.wasm', bytes: emptyWasm.length, sha256: wasmHash },
  );
  const fetchWorker = vi.fn<typeof fetch>().mockImplementation(async () => workerResponse());
  vi.stubGlobal('fetch', fetchWorker);
  const constructWorker = vi.fn();
  vi.stubGlobal('Worker', constructWorker);
  assets.load.mockResolvedValue({ store, workers: ['/worker.js'] });
  return { store, fetchWasm, compile, digest, fetchWorker, constructWorker };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await Promise.resolve();
  expect(check()).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  assets.load.mockReset();
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.abort());
  claimEngineSlot(() => {})();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('explicit engine resource preparation', () => {
  test('fully consumes real-JS MIME before validating/compiling the shared WASM, without a Worker', async () => {
    const h = harness();
    const body = deferred<void>();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const consumed = new ReadableStream<Uint8Array>({
      start: (controller) => {
        stream = controller;
      },
    });
    h.fetchWorker.mockResolvedValue(
      new Response(consumed, {
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      }),
    );
    const pending = prepareEngine('python', signal().signal);
    await until(() => h.fetchWorker.mock.calls.length === 1);
    stream.enqueue(new TextEncoder().encode('self.onmessage = () => {};'));
    void body.promise.then(() => stream.close());
    await Promise.resolve();
    expect(h.fetchWasm).not.toHaveBeenCalled();
    body.resolve();
    await pending;
    expect(h.fetchWorker).toHaveBeenCalledWith(
      '/worker.js',
      expect.objectContaining({
        mode: 'same-origin',
        credentials: 'omit',
        cache: 'default',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }),
    );
    expect(h.fetchWasm).toHaveBeenCalledOnce();
    expect(h.compile).toHaveBeenCalledOnce();
    expect(h.store.module).toBe(compiled);
    expect(h.constructWorker).not.toHaveBeenCalled();
  });

  test('preparation can exceed execution second and a later real store.load reuses compiled code', async () => {
    const h = harness();
    const response = deferred<Response>();
    h.fetchWorker.mockReturnValue(response.promise);
    const pending = prepareEngine('mysql', signal().signal);
    await until(() => h.fetchWorker.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(1001);
    response.resolve(workerResponse());
    await pending;
    expect(await h.store.load(new AbortController().signal, () => {})).toBe(compiled);
    expect(h.compile).toHaveBeenCalledOnce();
    expect(h.fetchWasm).toHaveBeenCalledOnce();
    expect(h.constructWorker).not.toHaveBeenCalled();
  });

  test.each(['text/html', 'application/json', 'application/octet-stream'])(
    'rejects worker MIME %s and allows retry',
    async (mime) => {
      const h = harness();
      h.fetchWorker.mockResolvedValueOnce(workerResponse(mime));
      await expect(prepareEngine('python', signal().signal)).rejects.toMatchObject({
        code: 'E_WORKER_LOAD',
      });
      expect(h.fetchWasm).not.toHaveBeenCalled();
      expect(h.store.module).toBeUndefined();
      await expect(prepareEngine('python', signal().signal)).resolves.toBeUndefined();
      expect(h.store.module).toBe(compiled);
    },
  );

  test.each(['empty', 'http', 'redirected', 'stream-error'])(
    'rejects incomplete/untrusted worker %s without ready',
    async (kind) => {
      const h = harness();
      let response = workerResponse();
      if (kind === 'empty') response = workerResponse('text/javascript', '');
      if (kind === 'http')
        response = new Response('missing', {
          status: 404,
          headers: { 'content-type': 'text/javascript' },
        });
      if (kind === 'redirected') Object.defineProperty(response, 'redirected', { value: true });
      if (kind === 'stream-error')
        response = new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('broken transfer'));
            },
          }),
          { headers: { 'content-type': 'text/javascript' } },
        );
      h.fetchWorker.mockResolvedValue(response);
      await expect(prepareEngine('mysql', signal().signal)).rejects.toMatchObject({
        code: 'E_WORKER_LOAD',
      });
      expect(h.fetchWasm).not.toHaveBeenCalled();
      expect(h.constructWorker).not.toHaveBeenCalled();
    },
  );

  test('already aborted preparation performs no imports or resource requests', async () => {
    const h = harness();
    const controller = signal();
    controller.abort();
    await expect(prepareEngine('c', controller.signal)).rejects.toMatchObject({
      code: 'E_PREPARATION_CANCELLED',
    });
    expect(assets.load).not.toHaveBeenCalled();
    expect(h.fetchWorker).not.toHaveBeenCalled();
  });

  test('abort rejects immediately even when worker fetch ignores its signal; late completion cannot compile', async () => {
    const h = harness();
    const response = deferred<Response>();
    h.fetchWorker.mockReturnValue(response.promise);
    const controller = signal();
    const pending = prepareEngine('mysql', controller.signal).catch((error: Error) => error);
    await until(() => h.fetchWorker.mock.calls.length === 1);
    const innerSignal = h.fetchWorker.mock.calls[0]![1]!.signal!;
    controller.abort();
    expect(await pending).toMatchObject({ code: 'E_PREPARATION_CANCELLED' });
    expect(innerSignal.aborted).toBe(true);
    response.resolve(workerResponse());
    await Promise.resolve();
    expect(h.fetchWasm).not.toHaveBeenCalled();
    expect(h.store.module).toBeUndefined();
  });

  test('abort rejects immediately during non-abortable compile and late compile cannot cache; retry works', async () => {
    const h = harness();
    const compile = deferred<WebAssembly.Module>();
    h.compile.mockReturnValueOnce(compile.promise);
    const controller = signal();
    const pending = prepareEngine('java', controller.signal).catch((error: Error) => error);
    await until(() => h.compile.mock.calls.length === 1);
    controller.abort();
    expect(await pending).toMatchObject({ code: 'E_PREPARATION_CANCELLED' });
    compile.resolve(compiled);
    await Promise.resolve();
    expect(h.store.module).toBeUndefined();
    await expect(prepareEngine('java', signal().signal)).resolves.toBeUndefined();
    expect(h.compile).toHaveBeenCalledTimes(2);
  });

  test('120-second preparation upper bound actively aborts hung requests and allows a fresh attempt', async () => {
    const h = harness();
    h.fetchWorker.mockReturnValueOnce(deferred<Response>().promise);
    const pending = prepareEngine('python', signal().signal).catch((error: Error) => error);
    await until(() => h.fetchWorker.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(119999);
    expect(h.fetchWorker.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ code: 'E_PREPARATION_TIMEOUT' });
    expect(h.fetchWorker.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(h.store.module).toBeUndefined();
    await expect(prepareEngine('python', signal().signal)).resolves.toBeUndefined();
  });

  test('another preparation or execution slot supersedes the old attempt', async () => {
    const h = harness();
    const firstResponse = deferred<Response>();
    h.fetchWorker.mockReturnValueOnce(firstResponse.promise);
    const first = prepareEngine('python', signal().signal).catch((error: Error) => error);
    await until(() => h.fetchWorker.mock.calls.length === 1);
    await prepareEngine('python', signal().signal);
    expect(await first).toMatchObject({ code: 'E_PREPARATION_CANCELLED' });
    expect(h.compile).toHaveBeenCalledOnce();
    const blockedResponse = deferred<Response>();
    h.fetchWorker.mockReturnValueOnce(blockedResponse.promise);
    const blocked = prepareEngine('mysql', signal().signal).catch((error: Error) => error);
    await until(() => h.fetchWorker.mock.calls.length === 3);
    const release = claimEngineSlot(() => {});
    expect(await blocked).toMatchObject({ code: 'E_PREPARATION_CANCELLED' });
    release();
    firstResponse.resolve(workerResponse());
    blockedResponse.resolve(workerResponse());
  });

  test('failed module validation does not resolve ready and can retry the actual store', async () => {
    const h = harness();
    h.fetchWasm.mockResolvedValueOnce(
      new Response(emptyWasm, { headers: { 'content-type': 'text/html' } }),
    );
    await expect(prepareEngine('rust', signal().signal)).rejects.toMatchObject({
      code: 'E_MODULE_LOAD',
    });
    expect(h.store.module).toBeUndefined();
    await prepareEngine('rust', signal().signal);
    expect(h.store.module).toBe(compiled);
  });

  test('returning to an engine reclaims its real store after another owner evicted it', async () => {
    const h = harness();
    await prepareEngine('python', signal().signal);
    const other = new ModuleStore(
      { fetcher: h.fetchWasm, compile: h.compile, digest: h.digest },
      { url: '/other.wasm', bytes: emptyWasm.length, sha256: wasmHash },
    );
    await other.load(new AbortController().signal, () => {});
    expect(h.store.module).toBeUndefined();
    await prepareEngine('python', signal().signal);
    expect(h.store.module).toBe(compiled);
    expect(other.module).toBeUndefined();
    expect(h.fetchWasm).toHaveBeenCalledTimes(3);
  });
});
