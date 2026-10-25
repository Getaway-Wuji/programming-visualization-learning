/// <reference types="vite/client" />
import { ContentError, MAX_CONTENT_BYTES, parseContent } from './validator.mjs';
import type { ContentPackage } from './types';

export interface ContentSnapshot {
  readonly package: ContentPackage | null;
  readonly stale: boolean;
  readonly error: ContentError | null;
}
export interface ContentRepository {
  load(signal?: AbortSignal): Promise<ContentPackage>;
  getSnapshot(): ContentSnapshot;
}

// No shared pending request: aborting one consumer cannot cancel another consumer.
export function createContentRepository({
  url,
  fetcher = globalThis.fetch,
}: {
  url?: string;
  fetcher?: typeof fetch;
} = {}): ContentRepository {
  let snapshot: ContentSnapshot = { package: null, stale: false, error: null };
  let requestGeneration = 0;
  const baseUrl = import.meta.env.BASE_URL;
  const contentUrl = url ?? `${baseUrl}content/sample/02.1-content-1.0.0.json`;
  return {
    getSnapshot: () => snapshot,
    async load(signal) {
      const generation = ++requestGeneration;
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 10_000);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const location = globalThis.location;
        const target = new URL(contentUrl, location.href);
        const publicRoot = new URL(`${baseUrl}content/`, location.href);
        if (
          !['http:', 'https:'].includes(target.protocol) ||
          target.origin !== location.origin ||
          target.username ||
          target.password ||
          target.search ||
          target.hash ||
          !target.pathname.startsWith(publicRoot.pathname) ||
          !target.pathname.endsWith('.json')
        ) {
          throw new ContentError('CONTENT_RESOURCE_FORBIDDEN');
        }
        if (controller.signal.aborted) throw new ContentError('CONTENT_LOAD_CANCELLED');
        // Race even an injected fetcher/body that ignores AbortSignal against cancellation.
        const abortPromise = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () =>
              reject(
                new ContentError(timedOut ? 'CONTENT_LOAD_TIMEOUT' : 'CONTENT_LOAD_CANCELLED'),
              ),
            { once: true },
          );
        });
        const response = await Promise.race([
          fetcher(target, {
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          }),
          abortPromise,
        ]);
        if (!response.ok) throw new ContentError('CONTENT_LOAD_FAILED');
        if (response.redirected) throw new ContentError('CONTENT_RESOURCE_FORBIDDEN');
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > MAX_CONTENT_BYTES)) {
          throw new ContentError('CONTENT_SIZE_EXCEEDED');
        }
        if (!response.body) throw new ContentError('CONTENT_LOAD_FAILED');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const chunk = await Promise.race([reader.read(), abortPromise]);
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_CONTENT_BYTES) throw new ContentError('CONTENT_SIZE_EXCEEDED');
          chunks.push(chunk.value);
        }
        if (controller.signal.aborted) {
          throw new ContentError(timedOut ? 'CONTENT_LOAD_TIMEOUT' : 'CONTENT_LOAD_CANCELLED');
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const content = parseContent(bytes);
        if (generation === requestGeneration)
          snapshot = { package: content, stale: false, error: null };
        return content;
      } catch (failure) {
        const error =
          failure instanceof ContentError
            ? failure
            : new ContentError(
                timedOut
                  ? 'CONTENT_LOAD_TIMEOUT'
                  : controller.signal.aborted
                    ? 'CONTENT_LOAD_CANCELLED'
                    : 'CONTENT_LOAD_FAILED',
              );
        if (generation === requestGeneration && error.code !== 'CONTENT_LOAD_CANCELLED') {
          snapshot = { package: snapshot.package, stale: snapshot.package !== null, error };
        }
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        controller.abort();
        // Never wait on a hostile stream's cancel promise.
        void reader?.cancel().catch(() => undefined);
      }
    },
  };
}
