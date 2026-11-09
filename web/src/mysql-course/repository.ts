import { mysqlBuild } from '../generated/mysql/engine-build';
import { mysqlEqual, mysqlProfile, mysqlProfileIds } from '../engine/mysql-data';
import type { MysqlProfile } from '../engine/mysql-types';
export type { MysqlProfile } from '../engine/mysql-types';
import { mysqlCourseRelease } from './release.generated';

export interface MysqlContentAsset {
  file: string;
  bytes: number;
  sha256: string;
}
export interface MysqlCatalogEntry {
  id: string;
  sourceNodeId: string;
  number: string;
  title: string;
  parent: string | null;
  depth: number;
  order: number;
  group: number;
  leaf: boolean;
  printedPage: number;
  physicalPage: number | null;
  coverage: 'body-present' | 'toc-only';
}
export interface MysqlBook {
  title: string;
  author: string;
  publisher: string;
  edition: string;
  isbn: string;
  pdfSha256: string;
}
export interface MysqlSourceCoverage {
  physicalPages: 24;
  bodyChapters: number[];
  bodyNodes: 21;
  tocOnlyNodes: 353;
  bodyPrintedPages: number[];
  bodyPhysicalPages: number[];
  note: string;
}
export interface MysqlSource {
  version: '1.0.0';
  language: 'mysql';
  dialect: '8.0';
  book: MysqlBook;
  coverage: MysqlSourceCoverage;
  catalog: MysqlCatalogEntry[];
}
export interface MysqlManifest {
  version: '1.0.0';
  language: 'mysql';
  dialect: '8.0';
  packageRef: { id: 'content.mysql.book'; version: '1.0.0' };
  engineSha256: string;
  source: MysqlBook;
  coverage: MysqlSourceCoverage;
  sourceFile: MysqlContentAsset;
  registryFile: MysqlContentAsset;
  counts: {
    nodes: 374;
    chapters: 17;
    sections: 128;
    subsections: 229;
    leaves: 300;
    parents: 74;
    reading: 288;
    runnable: 12;
    exampleCases: 48;
    judgeCases: 48;
  };
  catalog: MysqlCatalogEntry[];
  chunks: (MysqlContentAsset & { group: number; nodes: number })[];
}
export interface MysqlReference {
  title: string;
  url: string;
}
export type MysqlExample =
  | {
      mode: 'reading';
      language: 'sql' | 'text' | 'shell' | 'php';
      source: string;
      description: string;
      result: string;
      reason: string;
    }
  | {
      mode: 'wasm';
      language: 'sql';
      source: string;
      description: string;
      result: string;
      profile: string;
      caseIndices: number[];
    };
export type MysqlActivity =
  | { mode: 'self-check'; prompt: string; answer: string; hints: string[] }
  | { mode: 'judge'; profile: string; prompt: string; starter: string; hints: string[] };
export interface MysqlLesson extends MysqlCatalogEntry {
  body: string[];
  example: MysqlExample | null;
  activity: MysqlActivity | null;
  references: MysqlReference[];
}
interface Unit {
  version: '1.0.0';
  language: 'mysql';
  dialect: '8.0';
  group: number;
  nodes: MysqlLesson[];
}
const metaKeys = [
  'id',
  'sourceNodeId',
  'number',
  'title',
  'parent',
  'depth',
  'order',
  'group',
  'leaf',
  'printedPage',
  'physicalPage',
  'coverage',
];
const counts = {
  nodes: 374,
  chapters: 17,
  sections: 128,
  subsections: 229,
  leaves: 300,
  parents: 74,
  reading: 288,
  runnable: 12,
  exampleCases: 48,
  judgeCases: 48,
};
const hosts = new Set([
  'dev.mysql.com',
  'docs.oracle.com',
  'docs.phpmyadmin.net',
  'learn.microsoft.com',
  'www.navicat.com',
  'www.php.net',
  'www.xp.cn',
]);
const fixedProfiles = mysqlProfileIds.map((id) => freeze(mysqlProfile(id)!));
const profilesByLesson = new Map(fixedProfiles.map((profile) => [profile.lessonId, profile]));
function ensure(value: unknown, code = 'E_MYSQL_CONTENT_SCHEMA'): asserts value {
  if (!value) throw new Error(code);
}
function record(value: unknown, names: string[]): Record<string, unknown> {
  ensure(value && typeof value === 'object' && !Array.isArray(value));
  ensure(mysqlEqual(Object.keys(value).sort(), [...names].sort()));
  return value as Record<string, unknown>;
}
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) &&
  typeof value === 'number' &&
  value >= min &&
  value <= max &&
  !Object.is(value, -0);
function envelope(value: Record<string, unknown>) {
  ensure(value.version === '1.0.0' && value.language === 'mysql' && value.dialect === '8.0');
}
function book(value: unknown) {
  const b = record(value, ['title', 'author', 'publisher', 'edition', 'isbn', 'pdfSha256']);
  ensure(Object.values(b).every(text) && b.isbn === '978-7-302-66582-3');
  ensure(b.pdfSha256 === '1b3a99aa60325cf12c7feabdcc75b90e5b0f32a388d38b3ff5abaa7f3077099f');
}
function coverage(value: unknown) {
  const c = record(value, [
    'physicalPages',
    'bodyChapters',
    'bodyNodes',
    'tocOnlyNodes',
    'bodyPrintedPages',
    'bodyPhysicalPages',
    'note',
  ]);
  ensure(c.physicalPages === 24 && c.bodyNodes === 21 && c.tocOnlyNodes === 353 && text(c.note));
  ensure(
    mysqlEqual(c.bodyChapters, [1]) &&
      mysqlEqual(c.bodyPrintedPages, [1, 14]) &&
      mysqlEqual(c.bodyPhysicalPages, [11, 24]),
  );
}
function asset(value: unknown, expected?: string) {
  const a = record(value, ['file', 'bytes', 'sha256']);
  ensure(
    typeof a.file === 'string' &&
      /^(?:manifest|source|exercises|unit-(?:0[1-9]|1[0-7]))-1\.0\.0\.json$/u.test(a.file),
  );
  ensure(!expected || a.file === expected);
  ensure(
    integer(a.bytes, 1, 1048576) &&
      typeof a.sha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(a.sha256),
  );
}
function metadata(value: unknown, order: number) {
  const n = record(value, metaKeys);
  ensure(typeof n.number === 'string' && /^(?:[1-9]|1[0-7])(?:\.[1-9]\d*){0,2}$/u.test(n.number));
  ensure(n.id === 'mysql.lesson.' + n.number && text(n.title));
  ensure(
    n.depth === n.number.split('.').length &&
      n.group === Number(n.number.split('.')[0]) &&
      n.order === order &&
      typeof n.leaf === 'boolean',
  );
  ensure(
    n.sourceNodeId ===
      (n.depth === 1
        ? 'mysql.source.chapter-' + n.number
        : 'mysql.source.' + n.number.replaceAll('.', '-')),
  );
  ensure(
    n.parent ===
      (n.depth === 1 ? null : 'mysql.lesson.' + n.number.slice(0, n.number.lastIndexOf('.'))),
  );
  ensure(integer(n.printedPage, 1, 369));
  ensure(n.coverage === (n.group === 1 ? 'body-present' : 'toc-only'));
  ensure(n.group === 1 ? integer(n.physicalPage, 11, 24) : n.physicalPage === null);
}
function catalog(value: unknown) {
  ensure(Array.isArray(value) && value.length === 374);
  const seen = new Set<string>(),
    parents = new Set<string>();
  let previousGroup = 1;
  for (const [index, item] of value.entries()) {
    metadata(item, index + 1);
    const n = item as MysqlCatalogEntry;
    ensure(!seen.has(n.id) && (n.parent === null || seen.has(n.parent)));
    ensure(n.group >= previousGroup && n.group <= previousGroup + 1);
    previousGroup = n.group;
    seen.add(n.id);
    if (n.parent) parents.add(n.parent);
  }
  ensure(previousGroup === 17 && parents.size === 74);
  ensure(value.every((n: MysqlCatalogEntry) => n.leaf === !parents.has(n.id)));
  ensure(
    mysqlEqual(
      [1, 2, 3].map((depth) => value.filter((n: MysqlCatalogEntry) => n.depth === depth).length),
      [17, 128, 229],
    ),
  );
  ensure(value.filter((n: MysqlCatalogEntry) => n.coverage === 'body-present').length === 21);
  for (const p of fixedProfiles) {
    ensure(
      value.some(
        (n: MysqlCatalogEntry) =>
          n.id === p.lessonId && n.sourceNodeId === p.sourceNodeId && n.leaf,
      ),
    );
  }
}
function validateManifest(value: unknown): MysqlManifest {
  const m = record(value, [
    'version',
    'language',
    'dialect',
    'packageRef',
    'engineSha256',
    'source',
    'coverage',
    'sourceFile',
    'registryFile',
    'counts',
    'catalog',
    'chunks',
  ]);
  envelope(m);
  book(m.source);
  coverage(m.coverage);
  ensure(mysqlEqual(m.packageRef, { id: 'content.mysql.book', version: '1.0.0' }));
  ensure(m.engineSha256 === mysqlBuild.wasmSha256, 'E_MYSQL_CONTENT_ENGINE');
  ensure(mysqlEqual(m.counts, counts));
  asset(m.sourceFile, 'source-1.0.0.json');
  asset(m.registryFile, 'exercises-1.0.0.json');
  catalog(m.catalog);
  ensure(Array.isArray(m.chunks) && m.chunks.length === 17);
  const rows = m.catalog as MysqlCatalogEntry[];
  for (const [index, item] of m.chunks.entries()) {
    const c = record(item, ['file', 'bytes', 'sha256', 'group', 'nodes']);
    asset(
      { file: c.file, bytes: c.bytes, sha256: c.sha256 },
      `unit-${String(index + 1).padStart(2, '0')}-1.0.0.json`,
    );
    ensure(c.group === index + 1 && c.nodes === rows.filter((n) => n.group === index + 1).length);
  }
  return value as MysqlManifest;
}
function validateSource(value: unknown, index: MysqlManifest): MysqlSource {
  const s = record(value, ['version', 'language', 'dialect', 'book', 'coverage', 'catalog']);
  envelope(s);
  book(s.book);
  coverage(s.coverage);
  catalog(s.catalog);
  ensure(
    mysqlEqual(s.book, index.source) &&
      mysqlEqual(s.coverage, index.coverage) &&
      mysqlEqual(s.catalog, index.catalog),
  );
  return value as MysqlSource;
}
function validateRegistry(value: unknown): MysqlProfile[] {
  ensure(Array.isArray(value) && value.length === 12);
  for (const [i, p] of value.entries()) ensure(mysqlEqual(p, fixedProfiles[i]));
  return value as MysqlProfile[];
}
function validateUnit(value: unknown, index: MysqlManifest, group: number): Unit {
  const u = record(value, ['version', 'language', 'dialect', 'group', 'nodes']);
  envelope(u);
  ensure(u.group === group && Array.isArray(u.nodes));
  const rows = index.catalog.filter((n) => n.group === group);
  ensure(u.nodes.length === rows.length);
  const prose = new Set<string>();
  for (const [i, item] of u.nodes.entries()) {
    const n = record(item, [...metaKeys, 'body', 'example', 'activity', 'references']);
    ensure(mysqlEqual(Object.fromEntries(metaKeys.map((key) => [key, n[key]])), rows[i]));
    ensure(Array.isArray(n.body) && n.body.length >= (n.leaf ? 3 : 2) && n.body.every(text));
    const body = n.body.join('\n');
    ensure(body.length >= (n.leaf ? 140 : 80) && !prose.has(body));
    prose.add(body);
    ensure(Array.isArray(n.references) && n.references.length > 0 && n.references.length <= 16);
    for (const item of n.references) {
      const ref = record(item, ['title', 'url']);
      ensure(text(ref.title) && text(ref.url));
      let url: URL;
      try {
        url = new URL(ref.url);
      } catch {
        throw new Error('E_MYSQL_CONTENT_SCHEMA');
      }
      ensure(
        url.protocol === 'https:' &&
          hosts.has(url.hostname) &&
          !url.username &&
          !url.password &&
          !url.port,
      );
    }
    if (!n.leaf) {
      ensure(n.example === null && n.activity === null);
      continue;
    }
    const p = profilesByLesson.get(String(n.id));
    if (!p) {
      const e = record(n.example, [
        'mode',
        'language',
        'source',
        'description',
        'result',
        'reason',
      ]);
      const a = record(n.activity, ['mode', 'prompt', 'answer', 'hints']);
      ensure(
        e.mode === 'reading' &&
          typeof e.language === 'string' &&
          ['sql', 'text', 'shell', 'php'].includes(e.language),
      );
      ensure(
        [e.source, e.description, e.result, e.reason, a.prompt, a.answer].every(text) &&
          a.mode === 'self-check',
      );
      ensure(Array.isArray(a.hints) && a.hints.length === 3 && a.hints.every(text));
    } else {
      const e = record(n.example, [
        'mode',
        'language',
        'source',
        'description',
        'result',
        'profile',
        'caseIndices',
      ]);
      const a = record(n.activity, ['mode', 'profile', 'prompt', 'starter', 'hints']);
      ensure(
        e.mode === 'wasm' &&
          e.language === 'sql' &&
          e.profile === p.id &&
          e.source === p.referenceSource &&
          text(e.description) &&
          text(e.result),
      );
      ensure(mysqlEqual(e.caseIndices, [0, 1, 2, 3]));
      ensure(
        a.mode === 'judge' &&
          a.profile === p.id &&
          a.prompt === p.goal &&
          a.starter === p.starter &&
          mysqlEqual(a.hints, p.hints),
      );
    }
  }
  return value as Unit;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
let cachedManifest: MysqlManifest | undefined,
  cachedSource: MysqlSource | undefined,
  cachedRegistry: MysqlProfile[] | undefined;
const units = new Map<number, Unit>();
async function verifiedAsset(assetInfo: MysqlContentAsset, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  asset(assetInfo);
  const base = import.meta.env.BASE_URL;
  ensure(/^\/(?:[A-Za-z0-9_-]+\/)*$/u.test(base));
  const url = new URL(base + 'content/mysql/course/' + assetInfo.file, location.origin);
  ensure(url.origin === location.origin);
  const active = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: active });
  ensure(response.ok && response.body, 'E_MYSQL_CONTENT_FETCH');
  const reader = response.body.getReader(),
    bytes = new Uint8Array(assetInfo.bytes);
  let offset = 0;
  try {
    for (;;) {
      active.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      ensure(offset + part.value.length <= bytes.length, 'E_MYSQL_CONTENT_SIZE');
      bytes.set(part.value, offset);
      offset += part.value.length;
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  ensure(offset === bytes.length, 'E_MYSQL_CONTENT_SIZE');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  active.throwIfAborted();
  ensure(
    Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('') === assetInfo.sha256,
    'E_MYSQL_CONTENT_HASH',
  );
  try {
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const value: unknown = JSON.parse(raw);
    ensure(raw === JSON.stringify(value, null, 2) + '\n');
    return value;
  } catch (error) {
    throw new Error('E_MYSQL_CONTENT_SCHEMA', { cause: error });
  }
}
async function index(signal: AbortSignal) {
  signal.throwIfAborted();
  if (cachedManifest) return cachedManifest;
  const result = validateManifest(await verifiedAsset(mysqlCourseRelease, signal));
  signal.throwIfAborted();
  return (cachedManifest ??= freeze(result));
}
export async function loadMysqlManifest(signal: AbortSignal): Promise<MysqlManifest> {
  const manifest = await index(signal);
  signal.throwIfAborted();
  return structuredClone(manifest);
}
export async function loadMysqlSource(signal: AbortSignal): Promise<MysqlSource> {
  const manifest = await index(signal);
  signal.throwIfAborted();
  if (!cachedSource) {
    const result = validateSource(await verifiedAsset(manifest.sourceFile, signal), manifest);
    signal.throwIfAborted();
    cachedSource ??= freeze(result);
  }
  return structuredClone(cachedSource);
}
export async function loadMysqlExercises(signal: AbortSignal): Promise<MysqlProfile[]> {
  const manifest = await index(signal);
  signal.throwIfAborted();
  if (!cachedRegistry) {
    const result = validateRegistry(await verifiedAsset(manifest.registryFile, signal));
    signal.throwIfAborted();
    cachedRegistry ??= freeze(result);
  }
  return structuredClone(cachedRegistry);
}
export async function loadMysqlLesson(
  id: string,
  signal: AbortSignal,
): Promise<{ lesson: MysqlLesson; index: MysqlManifest }> {
  const manifest = await index(signal);
  signal.throwIfAborted();
  const row = manifest.catalog.find((n) => n.id === id);
  ensure(row, 'E_MYSQL_LESSON_UNKNOWN');
  let unit = units.get(row.group);
  if (!unit) {
    const chunk = manifest.chunks[row.group - 1];
    const loaded = validateUnit(
      await verifiedAsset({ file: chunk.file, bytes: chunk.bytes, sha256: chunk.sha256 }, signal),
      manifest,
      row.group,
    );
    signal.throwIfAborted();
    if (!units.has(row.group)) units.set(row.group, freeze(loaded));
    unit = units.get(row.group)!;
  }
  const lesson = unit.nodes.find((n) => n.id === id);
  ensure(lesson, 'E_MYSQL_LESSON_UNKNOWN');
  signal.throwIfAborted();
  return { lesson: structuredClone(lesson), index: structuredClone(manifest) };
}
