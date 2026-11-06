import {
  parsePython3CourseChunk,
  parsePython3CourseManifest,
} from '../../../shared/contracts/python3-content.mjs';
import { python3Build } from '../generated/python3/engine-build';
import type { PythonArticle, PythonManifest } from './content-types';
import { pythonCourseRelease } from './release.generated';

let manifest: PythonManifest | undefined;
const articles = new Map<number, PythonArticle>();

async function loadBytes(file: string, size: number, signal: AbortSignal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const url = new URL(import.meta.env.BASE_URL + 'content/python3/course/' + file, location.origin);
  if (url.origin !== location.origin) throw new Error('E_PY_CONTENT');
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: deadline });
  if (!response.ok || !response.body) throw new Error('E_PY_CONTENT');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(size);
  let received = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (received + part.value.length > size) throw new Error('E_PY_CONTENT_SIZE');
      bytes.set(part.value, received);
      received += part.value.length;
    }
    if (received !== size) throw new Error('E_PY_CONTENT_SIZE');
    return bytes;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function loadPythonManifest(signal: AbortSignal) {
  signal.throwIfAborted();
  if (manifest) return manifest;
  const candidate = await parsePython3CourseManifest(
    await loadBytes(pythonCourseRelease.manifestFile, pythonCourseRelease.manifestBytes, signal),
    pythonCourseRelease,
  );
  signal.throwIfAborted();
  if (candidate.engine.buildSha256 !== python3Build.wasmSha256) throw new Error('E_PY_CONTENT');
  return (manifest = candidate);
}

export async function loadPythonArticle(order: number, signal: AbortSignal) {
  const index = await loadPythonManifest(signal);
  const entry = index.chunks.find((row) => row.articleSourceOrder === order);
  if (!entry) throw new Error('E_PY_CONTENT_ORDER');
  const cached = articles.get(order);
  if (cached) return cached;
  const article = await parsePython3CourseChunk(
    await loadBytes(entry.file, entry.bytes, signal),
    index,
    order,
  );
  signal.throwIfAborted();
  articles.set(order, article);
  return article;
}
