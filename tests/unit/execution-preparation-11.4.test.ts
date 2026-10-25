// Lifecycle of published static source preparation. No execution/trajectory or
// browser-performance claim is made by these dependency-controlled unit tests.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { ExecutionClient, type ExecutionCatalog } from '../../web/src/engine/execution-client';

const release = JSON.parse(readFileSync('content/c/p0/case-view-1.0.1.json', 'utf8')) as {
  catalogs: ExecutionCatalog[];
};
const catalog = release.catalogs.find((entry) => entry.subject.id === 'case.c.assignment')!;
const clients: ExecutionClient[] = [];

function setup() {
  let now = 0;
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error('Published source preparation must not load the execute Module.');
  });
  const createWorker = vi.fn<() => Worker>(() => {
    throw new Error('Published source preparation must not create a Worker.');
  });
  const client = new ExecutionClient({ now: () => now, fetcher, createWorker });
  clients.push(client);
  return { client, fetcher, createWorker, expire: () => (now = 1000) };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.invalidate();
});

test('published source is validated without compiling or instantiating the execute Module', async () => {
  const h = setup();
  const source = await h.client.prepare(catalog, { x: -999 });
  expect(source.text).toContain('int x = -999;');
  expect(source.bindingMap).toHaveLength(1);
  expect(source.blockMap).toEqual([]);
  expect(h.client.inspect()).toEqual({ state: 'idle', activeWorkers: 0, cachedModules: 0 });
  expect(h.fetcher).not.toHaveBeenCalled();
  expect(h.createWorker).not.toHaveBeenCalled();
});

test('cancellation invalidates a pending source hash and cannot restore it later', async () => {
  const h = setup();
  const outcome = h.client.prepare(catalog).then(
    () => 'unexpected-source',
    (error: Error) => error.message,
  );
  h.client.cancel();
  expect(await outcome).toBe('E_CANCELLED');
  // A separate new operation may finish while the cancelled continuation unwinds.
  const source = await h.client.prepare(catalog, { x: 0 });
  expect(source.text).toContain('int x = 0;');
  expect(h.client.inspect()).toEqual({ state: 'idle', activeWorkers: 0, cachedModules: 0 });
  expect(h.fetcher).not.toHaveBeenCalled();
  expect(h.createWorker).not.toHaveBeenCalled();
});

test('the original preparation deadline includes all asynchronous metadata checks', async () => {
  const h = setup();
  const outcome = h.client.prepare(catalog).then(
    () => 'unexpected-source',
    (error: Error) => error.message,
  );
  h.expire();
  expect(await outcome).toBe('E_DEADLINE');
  expect(h.client.inspect()).toEqual({ state: 'expired', activeWorkers: 0, cachedModules: 0 });
  expect(h.fetcher).not.toHaveBeenCalled();
  expect(h.createWorker).not.toHaveBeenCalled();
});

test('published preparation still participates in the single global engine slot', async () => {
  const first = setup();
  const next = setup();
  const obsolete = first.client.prepare(catalog).then(
    () => 'unexpected-source',
    (error: Error) => error.message,
  );
  const current = next.client.prepare(catalog, { x: 999 });
  expect(await obsolete).toBe('E_CANCELLED');
  expect((await current).text).toContain('int x = 999;');
  expect(first.client.inspect().state).toBe('cancelled');
  expect(next.client.inspect().state).toBe('idle');
  expect(first.fetcher).not.toHaveBeenCalled();
  expect(next.fetcher).not.toHaveBeenCalled();
});
