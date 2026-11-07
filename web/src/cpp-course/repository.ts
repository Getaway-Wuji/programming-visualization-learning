import type { CppInput } from '../engine/cpp-course-protocol';
import { cppCourseBuild } from '../generated/cpp-course/engine-build';
import { cppCourseRelease } from './release.generated';

interface Asset {
  file: string;
  bytes: number;
  sha256: string;
}
export interface CppCatalogEntry {
  id: string;
  title: string;
  number: string;
  parent: string | null;
  depth: number;
  order: number;
  printedPage: number;
  leaf: boolean;
  group: number;
}
export interface CppManifest {
  version: '1.0.0';
  language: 'cpp';
  engineSha256: string;
  source: { title: string; author: string; publisher: string; year: number; isbn: string };
  counts: { nodes: number; leaves: number; runnable: number };
  catalog: CppCatalogEntry[];
  chunks: (Asset & { group: number; nodes: number })[];
}
export interface CppCase {
  id: string;
  input: CppInput;
  expected: string;
}
export type CppExample =
  | { mode: 'wasm'; description: string; source: string; cases: CppCase[] }
  | {
      mode: 'reading';
      reason: string;
      description: string;
      source: string | null;
      result: string | null;
    };
export type CppActivity =
  | { mode: 'judge'; profile: string; prompt: string; starter: string; hint: string }
  | { mode: 'self-check'; prompt: string; answer: string };
export interface CppLesson extends CppCatalogEntry {
  body: string[];
  example: CppExample | null;
  activity: CppActivity | null;
}
interface Unit {
  version: '1.0.0';
  language: 'cpp';
  group: number;
  nodes: CppLesson[];
}

let manifest: CppManifest | undefined;
const units = new Map<number, Unit>();

async function verifiedAsset<T>(asset: Asset, signal: AbortSignal): Promise<T> {
  if (
    !/^(?:manifest|unit-\d{2})-1\.0\.0\.json$/.test(asset.file) ||
    asset.bytes > 1048576 ||
    asset.bytes < 1
  )
    throw new Error('E_CPP_CONTENT');
  const url = new URL(
    import.meta.env.BASE_URL + 'content/cpp/course/' + asset.file,
    location.origin,
  );
  if (url.origin !== location.origin) throw new Error('E_CPP_CONTENT');
  const request = await fetch(url, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!request.ok || !request.body) throw new Error('E_CPP_CONTENT');
  const reader = request.body.getReader();
  const bytes = new Uint8Array(asset.bytes);
  let offset = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (offset + part.value.length > bytes.length) throw new Error('E_CPP_CONTENT_SIZE');
      bytes.set(part.value, offset);
      offset += part.value.length;
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (offset !== bytes.length) throw new Error('E_CPP_CONTENT_SIZE');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha = Array.from(digest, (item) => item.toString(16).padStart(2, '0')).join('');
  signal.throwIfAborted();
  if (sha !== asset.sha256) throw new Error('E_CPP_CONTENT_HASH');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
}

export async function loadCppManifest(signal: AbortSignal) {
  signal.throwIfAborted();
  if (manifest) return manifest;
  const verified = await verifiedAsset<CppManifest>(cppCourseRelease, signal);
  if (verified.engineSha256 !== cppCourseBuild.wasmSha256 || verified.language !== 'cpp')
    throw new Error('E_CPP_CONTENT');
  return (manifest = verified);
}

export async function loadCppLesson(id: string, signal: AbortSignal) {
  const index = await loadCppManifest(signal);
  const entry = index.catalog.find((node) => node.id === id);
  if (!entry) throw new Error('E_CPP_LESSON_UNKNOWN');
  let unit = units.get(entry.group);
  if (!unit) {
    const asset = index.chunks[entry.group];
    unit = await verifiedAsset<Unit>(asset, signal);
    if (unit.group !== entry.group || unit.nodes.length !== asset.nodes || unit.language !== 'cpp')
      throw new Error('E_CPP_CONTENT');
    units.set(entry.group, unit);
  }
  const lesson = unit.nodes.find((node) => node.id === id);
  if (!lesson) throw new Error('E_CPP_LESSON_UNKNOWN');
  return { lesson, index };
}
