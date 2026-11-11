import {
  parseBookTeaching,
  validateBookTeachingEntry,
} from '../../../shared/contracts/book-teaching.mjs';
import type {
  BookTeachingChunk,
  BookTeachingLanguage,
} from '../../../shared/contracts/book-teaching.mjs';
import { bookTeachingRelease } from './book-teaching-release.generated';

const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

/** Read only independently published teaching text, after the original course asset was validated. */
export function createBookTeachingReader(
  release = bookTeachingRelease,
  fetcher: typeof fetch = fetch,
) {
  const chunks = new Map<string, BookTeachingChunk>();
  return async function bookTeachingBody(
    language: BookTeachingLanguage,
    group: string,
    id: string,
    title: string,
    original: readonly string[],
    signal: AbortSignal,
  ): Promise<string[]> {
    signal.throwIfAborted();
    const entry = release.chunks.find((row) => row.language === language && row.group === group);
    if (!entry) return [...original];
    validateBookTeachingEntry(entry);
    let chunk = chunks.get(entry.file);
    if (!chunk) {
      const url = new URL(
        `${import.meta.env.BASE_URL}content/teaching/${entry.file}`,
        location.origin,
      );
      if (url.origin !== location.origin || url.search || url.hash || url.username || url.password)
        throw new Error('E_BOOK_TEACHING_URL');
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
      const response = await fetcher(url, {
        credentials: 'omit',
        redirect: 'error',
        signal: deadline,
      });
      if (!response.ok || !response.body) throw new Error('E_BOOK_TEACHING_FETCH');
      const reader = response.body.getReader();
      const bytes = new Uint8Array(entry.bytes);
      let offset = 0;
      try {
        for (;;) {
          deadline.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          if (offset + part.value.length > bytes.length) throw new Error('E_BOOK_TEACHING_SIZE');
          bytes.set(part.value, offset);
          offset += part.value.length;
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (offset !== bytes.length || (await digest(bytes)) !== entry.sha256)
        throw new Error('E_BOOK_TEACHING_HASH');
      deadline.throwIfAborted();
      chunk = parseBookTeaching(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        entry,
        release.editorialRef,
      );
      chunks.set(entry.file, chunk);
    }
    const node = chunk.nodes.find((row) => row.id === id);
    if (
      !node ||
      node.title !== title ||
      (await digest(new TextEncoder().encode(original.join('\n\n')))) !== node.originalBodySha256
    )
      throw new Error('E_BOOK_TEACHING_BINDING');
    signal.throwIfAborted();
    return [...node.body];
  };
}
export const bookTeachingBody = createBookTeachingReader();
