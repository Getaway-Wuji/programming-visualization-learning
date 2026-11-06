import {
  parseJava3CourseChunk,
  parseJava3CourseManifest,
} from '../../../shared/contracts/java-content.mjs';
import { javaBuild } from '../generated/java/engine-build';
import type { JavaArticle, JavaManifest } from './content-types';
import { javaCourseRelease } from './release.generated';

let manifest: JavaManifest | undefined;
const articles = new Map<number, JavaArticle>();

async function loadBytes(file: string, size: number, signal: AbortSignal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const url = new URL(import.meta.env.BASE_URL + 'content/java/course/' + file, location.origin);
  if (url.origin !== location.origin) throw new Error('E_JAVA_CONTENT');
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: deadline });
  if (!response.ok || !response.body) throw new Error('E_JAVA_CONTENT');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(size);
  let received = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (received + part.value.length > size) throw new Error('E_JAVA_CONTENT_SIZE');
      bytes.set(part.value, received);
      received += part.value.length;
    }
    if (received !== size) throw new Error('E_JAVA_CONTENT_SIZE');
    return bytes;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function loadJavaManifest(signal: AbortSignal) {
  signal.throwIfAborted();
  if (manifest) return manifest;
  const candidate = await parseJava3CourseManifest(
    await loadBytes(javaCourseRelease.manifestFile, javaCourseRelease.manifestBytes, signal),
    javaCourseRelease,
  );
  signal.throwIfAborted();
  if (candidate.engine.buildSha256 !== javaBuild.wasmSha256) throw new Error('E_JAVA_CONTENT');
  return (manifest = candidate);
}

export async function loadJavaArticle(order: number, signal: AbortSignal) {
  const index = await loadJavaManifest(signal);
  const entry = index.chunks.find((row) => row.articleSourceOrder === order);
  if (!entry) throw new Error('E_JAVA_CONTENT_ORDER');
  const cached = articles.get(order);
  if (cached) return cached;
  const article = await parseJava3CourseChunk(
    await loadBytes(entry.file, entry.bytes, signal),
    index,
    order,
  );
  signal.throwIfAborted();
  articles.set(order, article);
  return article;
}
