import { rust2018Build } from '../generated/rust2018/engine-build';
import { rust2018CourseRelease } from './release.generated';

interface Asset {
  file: string;
  bytes: number;
  sha256: string;
}
export interface RustCatalogEntry {
  id: string;
  sourceNodeId: string;
  title: string;
  parent: string | null;
  depth: number;
  order: number;
  group: number;
  physicalPage: number;
  printedPage: null;
  leaf: boolean;
}
export interface RustManifest {
  version: '1.0.0';
  language: 'rust';
  edition: '2018';
  packageRef: { id: 'content.rust2018.book'; version: '1.0.0' };
  engineSha256: string;
  source: {
    title: string;
    authors: string[];
    translators: string[];
    publisher: string;
    edition: string;
    isbn: string;
    pdfSha256: string;
    physicalPages: number;
    printedPagesAvailable: boolean;
    rewrite: string;
  };
  sourceFile: Asset;
  registryFile: Asset;
  counts: {
    nodes: number;
    chapters: number;
    appendices: number;
    sections: number;
    subsections: number;
    leaves: number;
    reading: number;
    runnable: number;
    judgeCases: number;
  };
  catalog: RustCatalogEntry[];
  chunks: (Asset & { group: number; nodes: number })[];
}
export interface RustCase {
  input: string;
  expected: string;
  requiredFeatures: string[];
}
export interface RustExample {
  mode: 'reading' | 'wasm';
  language: 'rust' | 'shell' | 'text';
  source: string;
  description: string;
  result: string;
  reason?: string;
  cases?: RustCase[];
}
export type RustActivity =
  | { mode: 'self-check'; prompt: string; answer: string; hints: string[] }
  | { mode: 'judge'; profile: string; prompt: string; starter: string; hints: string[] };
export interface RustLesson extends RustCatalogEntry {
  body: string[];
  example: RustExample | null;
  activity: RustActivity | null;
}
interface Unit {
  version: '1.0.0';
  language: 'rust';
  edition: '2018';
  group: number;
  nodes: RustLesson[];
}

let manifest: RustManifest | undefined;
const units = new Map<number, Unit>();

async function verifiedAsset<T>(asset: Asset, signal: AbortSignal): Promise<T> {
  if (
    !/^(?:manifest|unit-\d{2}|source|exercises)-1\.0\.0\.json$/u.test(asset.file) ||
    !Number.isInteger(asset.bytes) ||
    asset.bytes < 1 ||
    asset.bytes > 1048576 ||
    !/^[a-f0-9]{64}$/u.test(asset.sha256)
  )
    throw new Error('E_RUST_CONTENT');
  const url = new URL(
    import.meta.env.BASE_URL + 'content/rust2018/course/' + asset.file,
    location.origin,
  );
  if (url.origin !== location.origin) throw new Error('E_RUST_CONTENT');
  const request = await fetch(url, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!request.ok || !request.body) throw new Error('E_RUST_CONTENT');
  const reader = request.body.getReader();
  const bytes = new Uint8Array(asset.bytes);
  let offset = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (offset + part.value.length > bytes.length) throw new Error('E_RUST_CONTENT_SIZE');
      bytes.set(part.value, offset);
      offset += part.value.length;
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (offset !== bytes.length) throw new Error('E_RUST_CONTENT_SIZE');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  signal.throwIfAborted();
  if (sha256 !== asset.sha256) throw new Error('E_RUST_CONTENT_HASH');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
}

export async function loadRustManifest(signal: AbortSignal) {
  signal.throwIfAborted();
  if (manifest) return manifest;
  const verified = await verifiedAsset<RustManifest>(rust2018CourseRelease, signal);
  if (
    verified.version !== '1.0.0' ||
    verified.language !== 'rust' ||
    verified.edition !== '2018' ||
    verified.engineSha256 !== rust2018Build.wasmSha256
  )
    throw new Error('E_RUST_CONTENT');
  return (manifest = verified);
}

export async function loadRustLesson(id: string, signal: AbortSignal) {
  const index = await loadRustManifest(signal);
  const entry = index.catalog.find((node) => node.id === id);
  if (!entry) throw new Error('E_RUST_LESSON_UNKNOWN');
  let unit = units.get(entry.group);
  if (!unit) {
    const asset = index.chunks[entry.group - 1];
    if (!asset || asset.group !== entry.group) throw new Error('E_RUST_CONTENT');
    unit = await verifiedAsset<Unit>(asset, signal);
    if (
      unit.version !== '1.0.0' ||
      unit.language !== 'rust' ||
      unit.edition !== '2018' ||
      unit.group !== entry.group ||
      unit.nodes.length !== asset.nodes
    )
      throw new Error('E_RUST_CONTENT');
    units.set(entry.group, unit);
  }
  const lesson = unit.nodes.find((node) => node.id === id);
  if (!lesson) throw new Error('E_RUST_LESSON_UNKNOWN');
  return { lesson, index };
}

export function loadRustExercises(signal: AbortSignal) {
  return loadRustManifest(signal).then((index) =>
    verifiedAsset<RustExercise[]>(index.registryFile, signal),
  );
}

export interface RustExercise {
  id: string;
  lesson: string;
  sourceNodeId: string;
  title: string;
  source: string;
  cases: RustCase[];
  requiredFeatures: string[];
  goal: string;
  hints: string[];
  starter: string;
  topic: string;
}
