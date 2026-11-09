// Dependency-injected cache ownership checks; the empty module does not prove interpreter execution.
import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { ModuleStore, type ModuleDependencies } from '../../web/src/engine/module';

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const sha256 = createHash('sha256').update(wasm).digest('hex');
const emptyGuard = () => undefined;
const signal = () => new AbortController().signal;
const emptyModule = () => new WebAssembly.Module(wasm);
const digestBuffer = () =>
  Uint8Array.from(sha256.match(/../g)!, (pair) => Number.parseInt(pair, 16)).buffer;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function response(bytes = wasm, mime = 'application/wasm') {
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': mime } });
}

function setup(name: string) {
  const module = emptyModule();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
  const digest = vi
    .fn<NonNullable<ModuleDependencies['digest']>>()
    .mockImplementation(async () => digestBuffer());
  const compile = vi.fn<typeof WebAssembly.compile>().mockResolvedValue(module);
  const store = new ModuleStore(
    { fetcher, digest, compile },
    { url: `https://unit.invalid/${name}.wasm`, bytes: wasm.length, sha256 },
  );
  return { module, fetcher, digest, compile, store };
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await Promise.resolve();
  expect(predicate()).toBe(true);
}

function observed(pending: Promise<WebAssembly.Module>) {
  return pending.catch((error: Error) => error);
}

describe('ModuleStore owner and late asynchronous completion', () => {
  test('an old owner cannot install its module after another store takes ownership', async () => {
    const first = setup('first');
    const second = setup('second');
    const lateCompile = deferred<WebAssembly.Module>();
    first.compile.mockReturnValue(lateCompile.promise);
    const oldLoad = observed(first.store.load(signal(), emptyGuard));
    await until(() => first.compile.mock.calls.length === 1);

    await expect(second.store.load(signal(), emptyGuard)).resolves.toBe(second.module);
    expect(first.store.module).toBeUndefined();
    expect(second.store.module).toBe(second.module);

    lateCompile.resolve(first.module);
    await expect(oldLoad).resolves.toMatchObject({ message: 'E_CANCELLED' });
    expect(first.store.module).toBeUndefined();
    expect(second.store.module).toBe(second.module);
  });

  test('A to B to A keeps the second A load when the first A compilation finishes last', async () => {
    const first = setup('first');
    const second = setup('second');
    const lateCompile = deferred<WebAssembly.Module>();
    const currentModule = emptyModule();
    first.compile.mockReturnValueOnce(lateCompile.promise).mockResolvedValueOnce(currentModule);
    const oldLoad = observed(first.store.load(signal(), emptyGuard));
    await until(() => first.compile.mock.calls.length === 1);

    await second.store.load(signal(), emptyGuard);
    await expect(first.store.load(signal(), emptyGuard)).resolves.toBe(currentModule);
    expect(second.store.module).toBeUndefined();

    lateCompile.resolve(first.module);
    await expect(oldLoad).resolves.toMatchObject({ message: 'E_CANCELLED' });
    expect(first.store.module).toBe(currentModule);
    expect(second.store.module).toBeUndefined();
    expect(first.compile).toHaveBeenCalledTimes(2);
  });

  test('a later uncached load on the same store supersedes an older pending compilation', async () => {
    const current = setup('same-owner');
    const lateCompile = deferred<WebAssembly.Module>();
    const currentModule = emptyModule();
    current.compile.mockReturnValueOnce(lateCompile.promise).mockResolvedValueOnce(currentModule);
    const oldLoad = observed(current.store.load(signal(), emptyGuard));
    await until(() => current.compile.mock.calls.length === 1);

    await expect(current.store.load(signal(), emptyGuard)).resolves.toBe(currentModule);
    lateCompile.resolve(current.module);
    await expect(oldLoad).resolves.toMatchObject({ message: 'E_CANCELLED' });
    expect(current.store.module).toBe(currentModule);
  });

  test.each(['digest', 'compile'] as const)(
    'an abort during %s rejects late caching even when the caller guard does nothing',
    async (phase) => {
      const current = setup(`aborted-${phase}`);
      const controller = new AbortController();
      const lateDigest = deferred<ArrayBuffer>();
      const lateCompile = deferred<WebAssembly.Module>();
      if (phase === 'digest') current.digest.mockReturnValue(lateDigest.promise);
      else current.compile.mockReturnValue(lateCompile.promise);
      const pending = observed(current.store.load(controller.signal, emptyGuard));
      await until(() => current[phase].mock.calls.length === 1);

      controller.abort();
      lateDigest.resolve(digestBuffer());
      lateCompile.resolve(current.module);
      await expect(pending).resolves.toMatchObject({ message: 'E_CANCELLED' });
      expect(current.store.module).toBeUndefined();
      if (phase === 'digest') expect(current.compile).not.toHaveBeenCalled();
    },
  );

  test('a current cached owner reuses its validated module without fetching or compiling again', async () => {
    const current = setup('cached-owner');
    await expect(current.store.load(signal(), emptyGuard)).resolves.toBe(current.module);
    await expect(current.store.load(signal(), emptyGuard)).resolves.toBe(current.module);
    expect(current.fetcher).toHaveBeenCalledOnce();
    expect(current.digest).toHaveBeenCalledOnce();
    expect(current.compile).toHaveBeenCalledOnce();
    expect(current.store.module).toBe(current.module);
  });

  test.each(['mime', 'short', 'long', 'sha256'] as const)(
    'invalid %s cannot reach compilation or populate the cache',
    async (invalid) => {
      const current = setup(`invalid-${invalid}`);
      if (invalid === 'mime')
        current.fetcher.mockImplementation(async () => response(wasm, 'text/html'));
      if (invalid === 'short')
        current.fetcher.mockImplementation(async () => response(wasm.slice(0, -1)));
      if (invalid === 'long')
        current.fetcher.mockImplementation(async () => response(new Uint8Array([...wasm, 0])));
      if (invalid === 'sha256') current.digest.mockResolvedValue(new ArrayBuffer(32));

      await expect(current.store.load(signal(), emptyGuard)).rejects.toThrow('E_MODULE_LOAD');
      expect(current.compile).not.toHaveBeenCalled();
      expect(current.store.module).toBeUndefined();
      if (invalid !== 'sha256') expect(current.digest).not.toHaveBeenCalled();

      current.fetcher.mockImplementation(async () => response());
      current.digest.mockImplementation(async () => digestBuffer());
      await expect(current.store.load(signal(), emptyGuard)).resolves.toBe(current.module);
      expect(current.compile).toHaveBeenCalledOnce();
    },
  );
});
