import type { EntityRef } from './types';
import { c6TeachingRelease } from './c6-teaching-release.generated';
import {
  C6TeachingContentError,
  C6_TEACHING_LIMITS,
  parseC6TeachingManifest,
  parseC6TeachingChunk,
} from './c6-teaching-validator.mjs';
import type {
  C6TeachingChunk,
  C6TeachingChunkId,
  C6TeachingEntity,
  C6TeachingEntityKind,
  C6TeachingManifest,
  C6TeachingNode,
} from './c6-teaching-types';

export interface C6TeachingSnapshot {
  readonly generation: number;
  readonly manifest: C6TeachingManifest | null;
  readonly loadedChunkIds: readonly C6TeachingChunkId[];
  readonly error: C6TeachingContentError | null;
}
export interface C6TeachingRepository {
  loadManifest(signal?: AbortSignal): Promise<C6TeachingManifest>;
  loadChunk(id: C6TeachingChunkId, signal?: AbortSignal): Promise<C6TeachingChunk>;
  loadNode(sourceNodeId: string, signal?: AbortSignal): Promise<C6TeachingNode>;
  loadEntity(
    reference: EntityRef,
    kind: C6TeachingEntityKind,
    signal?: AbortSignal,
  ): Promise<C6TeachingEntity>;
  getSnapshot(): C6TeachingSnapshot;
  reset(): void;
}

export function createC6TeachingRepository({
  fetcher = globalThis.fetch,
  manifestUrl,
  timeoutMs = 10_000,
}: {
  fetcher?: typeof fetch;
  manifestUrl?: string;
  timeoutMs?: number;
} = {}): C6TeachingRepository {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
    throw new C6TeachingContentError('C6_TEACHING_INVALID');
  let generation = 0;
  let manifest: C6TeachingManifest | null = null;
  let error: C6TeachingContentError | null = null;
  const chunks = new Map<C6TeachingChunkId, C6TeachingChunk>();
  const controllers = new Set<AbortController>();
  const base = import.meta.env.BASE_URL;
  const address = () =>
    manifestUrl ?? `${base}content/c/primer6-teaching/${c6TeachingRelease.manifestFile}`;
  function target(raw: string): URL {
    try {
      const location = globalThis.location;
      const root = new URL(`${base}content/c/primer6-teaching/`, location.href);
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
      throw new C6TeachingContentError('C6_TEACHING_FORBIDDEN');
    }
  }
  function current(requestGeneration: number, signal?: AbortSignal) {
    if (requestGeneration !== generation || signal?.aborted)
      throw new C6TeachingContentError('C6_TEACHING_CANCELLED');
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
        reject(
          new C6TeachingContentError(timedOut ? 'C6_TEACHING_TIMEOUT' : 'C6_TEACHING_CANCELLED'),
        );
      if (controller.signal.aborted) rejectAbort();
      else controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    void aborted.catch(() => undefined);
    const guard = () => {
      current(requestGeneration, signal);
      if (globalThis.performance.now() >= deadline) {
        timedOut = true;
        controller.abort();
        throw new C6TeachingContentError('C6_TEACHING_TIMEOUT');
      }
      if (controller.signal.aborted) throw new C6TeachingContentError('C6_TEACHING_CANCELLED');
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
      if (!response.ok || !response.body)
        throw new C6TeachingContentError('C6_TEACHING_LOAD_FAILED');
      if (response.redirected || (response.url && target(response.url).href !== url.href))
        throw new C6TeachingContentError('C6_TEACHING_FORBIDDEN');
      const declared = response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
        throw new C6TeachingContentError('C6_TEACHING_SIZE');
      reader = response.body.getReader();
      const received = new Uint8Array(limit);
      let size = 0;
      for (;;) {
        guard();
        const part = await Promise.race([reader.read(), aborted]);
        guard();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array))
          throw new C6TeachingContentError('C6_TEACHING_INVALID');
        if (size + part.value.byteLength > limit)
          throw new C6TeachingContentError('C6_TEACHING_SIZE');
        received.set(part.value, size);
        size += part.value.byteLength;
      }
      const result = await Promise.race([consume(received.slice(0, size)), aborted]);
      guard();
      return result;
    } catch (failure) {
      const issue =
        failure instanceof C6TeachingContentError
          ? failure
          : new C6TeachingContentError(
              timedOut
                ? 'C6_TEACHING_TIMEOUT'
                : controller.signal.aborted || requestGeneration !== generation
                  ? 'C6_TEACHING_CANCELLED'
                  : 'C6_TEACHING_LOAD_FAILED',
            );
      if (requestGeneration === generation && issue.code !== 'C6_TEACHING_CANCELLED') error = issue;
      throw issue;
    } finally {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      controllers.delete(controller);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    }
  }
  const repository: C6TeachingRepository = {
    getSnapshot: () =>
      Object.freeze({
        generation,
        manifest,
        loadedChunkIds: Object.freeze([...chunks.keys()]),
        error,
      }),
    reset() {
      ++generation;
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
        C6_TEACHING_LIMITS.manifest,
        async (bytes) => {
          const parsed = await parseC6TeachingManifest(bytes, c6TeachingRelease.manifestSha256);
          if (
            parsed.engineBuildSha256 !== c6TeachingRelease.engineBuildSha256 ||
            parsed.sourceSha256 !== c6TeachingRelease.sourceSha256 ||
            parsed.scopeRevision !== c6TeachingRelease.scopeRevision
          )
            throw new C6TeachingContentError('C6_TEACHING_HASH');
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
      const entry = catalog.chunks.find((entry) => entry.id === id);
      if (!entry) throw new C6TeachingContentError('C6_TEACHING_REFERENCE');
      const cached = chunks.get(id);
      if (cached) return cached;
      const loaded = await resource(
        target(new URL(entry.file, target(address())).href),
        Math.min(entry.bytes, C6_TEACHING_LIMITS.chunk),
        (bytes) => parseC6TeachingChunk(bytes, catalog, id),
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
      const entry = catalog.nodes.find((node) => node.id === id);
      if (!entry) throw new C6TeachingContentError('C6_TEACHING_REFERENCE');
      const chunk = await repository.loadChunk(entry.chunkId, signal);
      current(requestGeneration, signal);
      const node = chunk.nodes.find((node) => node.sourceNodeId === id);
      if (!node) throw new C6TeachingContentError('C6_TEACHING_REFERENCE');
      return node;
    },
    async loadEntity(reference, kind, signal) {
      if (
        !['lessons', 'activities', 'examples', 'exercises', 'knowledge', 'programs'].includes(
          kind,
        ) ||
        reference.version !== '2.0.0'
      )
        throw new C6TeachingContentError('C6_TEACHING_REFERENCE');
      const requestGeneration = generation;
      const catalog = await repository.loadManifest(signal);
      current(requestGeneration, signal);
      const entry = catalog.chunks.find((entry) => entry.entityIds[kind]?.includes(reference.id));
      if (!entry) throw new C6TeachingContentError('C6_TEACHING_REFERENCE');
      const chunk = await repository.loadChunk(entry.id, signal);
      current(requestGeneration, signal);
      const entity = chunk[kind].find((entity) => entity.ref.id === reference.id);
      if (!entity) throw new C6TeachingContentError('C6_TEACHING_REFERENCE');
      return entity;
    },
  };
  return repository;
}
