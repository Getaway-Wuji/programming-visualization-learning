import { c6CourseRelease } from './c6-course-release.generated';
import {
  C6ContentError,
  C6_CONTENT_LIMITS,
  parseC6Chunk,
  parseC6Manifest,
} from './c6-course-validator.mjs';
import type { C6BodyNode, C6ChunkId, C6CourseChunk, C6CourseManifest } from './c6-course-types';

export interface C6CourseSnapshot {
  readonly generation: number;
  readonly manifest: C6CourseManifest | null;
  readonly loadedChunkIds: readonly C6ChunkId[];
  readonly error: C6ContentError | null;
}
export interface C6CourseRepository {
  loadManifest(signal?: AbortSignal): Promise<C6CourseManifest>;
  loadChunk(id: C6ChunkId, signal?: AbortSignal): Promise<C6CourseChunk>;
  loadNode(sourceNodeId: string, signal?: AbortSignal): Promise<C6BodyNode>;
  getSnapshot(): C6CourseSnapshot;
  reset(): void;
}

export function createC6CourseRepository({
  fetcher = globalThis.fetch,
  manifestUrl,
  timeoutMs = 10_000,
}: { fetcher?: typeof fetch; manifestUrl?: string; timeoutMs?: number } = {}): C6CourseRepository {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
    throw new C6ContentError('C6_CONTENT_INVALID');
  let generation = 0;
  let manifest: C6CourseManifest | null = null;
  let error: C6ContentError | null = null;
  const chunks = new Map<C6ChunkId, C6CourseChunk>();
  const controllers = new Set<AbortController>();
  const base = import.meta.env.BASE_URL;
  const address = () => manifestUrl ?? `${base}content/c/primer6/${c6CourseRelease.manifestFile}`;
  function target(raw: string): URL {
    try {
      const location = globalThis.location;
      const root = new URL(`${base}content/c/primer6/`, location.href);
      const url = new URL(raw, location.href);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== location.origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.startsWith(root.pathname) ||
        !url.pathname.endsWith('.json') ||
        /%2f|%5c|%2e/i.test(url.pathname)
      )
        throw new Error('forbidden');
      return url;
    } catch {
      throw new C6ContentError('C6_CONTENT_FORBIDDEN');
    }
  }
  function current(requestGeneration: number, signal?: AbortSignal) {
    if (requestGeneration !== generation || signal?.aborted)
      throw new C6ContentError('C6_CONTENT_CANCELLED');
  }
  async function resource<T>(
    url: URL,
    limit: number,
    consume: (bytes: Uint8Array) => Promise<T>,
    signal: AbortSignal | undefined,
    requestGeneration: number,
  ): Promise<T> {
    current(requestGeneration, signal);
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    const deadline = globalThis.performance.now() + timeoutMs;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const aborted = new Promise<never>((_, reject) => {
      const rejectAbort = () =>
        reject(new C6ContentError(timedOut ? 'C6_CONTENT_TIMEOUT' : 'C6_CONTENT_CANCELLED'));
      if (controller.signal.aborted) rejectAbort();
      else controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    // An injected fetcher may throw synchronously before Promise.race is constructed.
    void aborted.catch(() => undefined);
    const guard = () => {
      current(requestGeneration, signal);
      if (globalThis.performance.now() >= deadline) {
        timedOut = true;
        controller.abort();
        throw new C6ContentError('C6_CONTENT_TIMEOUT');
      }
      if (controller.signal.aborted) throw new C6ContentError('C6_CONTENT_CANCELLED');
    };
    try {
      const response = await Promise.race([
        fetcher(url, {
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        }),
        aborted,
      ]);
      if (!response.ok || !response.body) throw new C6ContentError('C6_CONTENT_LOAD_FAILED');
      if (response.redirected) throw new C6ContentError('C6_CONTENT_FORBIDDEN');
      if (response.url && target(response.url).href !== url.href)
        throw new C6ContentError('C6_CONTENT_FORBIDDEN');
      const declared = response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
        throw new C6ContentError('C6_CONTENT_SIZE');
      reader = response.body.getReader();
      const received = new Uint8Array(limit);
      let size = 0;
      while (true) {
        guard();
        const part = await Promise.race([reader.read(), aborted]);
        guard();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) throw new C6ContentError('C6_CONTENT_INVALID');
        if (size + part.value.byteLength > limit) throw new C6ContentError('C6_CONTENT_SIZE');
        received.set(part.value, size);
        size += part.value.byteLength;
      }
      const bytes = received.slice(0, size);
      const result = await Promise.race([consume(bytes), aborted]);
      guard();
      if (controller.signal.aborted)
        throw new C6ContentError(timedOut ? 'C6_CONTENT_TIMEOUT' : 'C6_CONTENT_CANCELLED');
      return result;
    } catch (failure) {
      const issue =
        failure instanceof C6ContentError
          ? failure
          : new C6ContentError(
              timedOut
                ? 'C6_CONTENT_TIMEOUT'
                : controller.signal.aborted || requestGeneration !== generation
                  ? 'C6_CONTENT_CANCELLED'
                  : 'C6_CONTENT_LOAD_FAILED',
            );
      if (requestGeneration === generation && issue.code !== 'C6_CONTENT_CANCELLED') error = issue;
      throw issue;
    } finally {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      controllers.delete(controller);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    }
  }
  const repository: C6CourseRepository = {
    getSnapshot: () =>
      Object.freeze({
        generation,
        manifest,
        loadedChunkIds: Object.freeze([...chunks.keys()]),
        error,
      }),
    reset() {
      generation++;
      manifest = null;
      error = null;
      chunks.clear();
      for (const controller of controllers) controller.abort();
    },
    async loadManifest(signal) {
      const requestGeneration = generation;
      current(requestGeneration, signal);
      if (manifest) return manifest;
      const loaded = await resource(
        target(address()),
        C6_CONTENT_LIMITS.manifest,
        async (bytes) => {
          const parsed = await parseC6Manifest(bytes, c6CourseRelease.manifestSha256);
          if (
            parsed.engineBuildSha256 !== c6CourseRelease.engineBuildSha256 ||
            parsed.scopeRevision !== c6CourseRelease.scopeRevision
          )
            throw new C6ContentError('C6_CONTENT_HASH');
          return parsed;
        },
        signal,
        requestGeneration,
      );
      current(requestGeneration, signal);
      manifest ??= loaded;
      error = null;
      return manifest;
    },
    async loadChunk(id, signal) {
      const requestGeneration = generation;
      current(requestGeneration, signal);
      const catalog = await repository.loadManifest(signal);
      current(requestGeneration, signal);
      const entry = catalog.chunks.find((c) => c.id === id);
      if (!entry) throw new C6ContentError('C6_CONTENT_REFERENCE');
      const cached = chunks.get(id);
      if (cached) return cached;
      const url = target(new URL(entry.file, target(address())).href);
      const loaded = await resource(
        url,
        Math.min(entry.bytes, C6_CONTENT_LIMITS.chunk),
        (bytes) => parseC6Chunk(bytes, catalog, id),
        signal,
        requestGeneration,
      );
      current(requestGeneration, signal);
      chunks.set(id, loaded);
      error = null;
      return loaded;
    },
    async loadNode(id, signal) {
      const requestGeneration = generation;
      const catalog = await repository.loadManifest(signal);
      current(requestGeneration, signal);
      const node = catalog.nodes.find((n) => n.id === id);
      if (!node) throw new C6ContentError('C6_CONTENT_REFERENCE');
      const chunk = await repository.loadChunk(node.chunkId, signal);
      current(requestGeneration, signal);
      const body = chunk.nodes.find((n) => n.sourceNodeId === id);
      if (!body) throw new C6ContentError('C6_CONTENT_REFERENCE');
      return body;
    },
  };
  return repository;
}
