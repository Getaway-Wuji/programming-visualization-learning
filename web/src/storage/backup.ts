import type { C6LearningIndex } from '../c6-learning';
import { assertC6CourseState, type C6CourseState } from './c6-course';
import { C6_RESET_STORES } from './c6-reset';
import { PYTHON_STORES } from './python3-meta';
import { JAVA_STORES } from './java-meta';
import { CPP_STORES } from './cpp-course-meta';
import { RUST_STORES } from './rust2018-meta';
import { MYSQL_STORES, assertMysqlMeta } from './mysql-meta';
import { assertPythonCourseState, type PythonCourseState } from './python3-course';
import { assertTextCourseState, type JavaCourseState } from './java-course';
import { assertMysqlCourseState, type MysqlCourseState } from './mysql-course';
import { STORE_NAMES, type AppearanceAsset, type StorageSnapshot } from './model';
import { inspectRecoveryRows, type RawStorageRows } from './recovery';
import { assertCustomDraft } from './custom-draft';
import { assertEditorSnapshot, EDIT_HISTORY_LIMITS, historyBytes } from './editor-history';
import { assertKnowledgeMark } from './knowledge-marks';
import { assertReviewCard } from '../review-scheduler/model';
import { assertAchievement, c6AchievementCatalog } from '../achievements/model';
import { assertWeaknessSummary } from '../weaknesses/model';
import { isUtcTime, localDateAt, validationInternals } from './validation';
import { usableBackground } from './appearance-assets';
import { StorageError } from './errors';

export const BACKUP_LIMITS = Object.freeze({ bytes: 48 * 1024 * 1024, rows: 100_000 });
export const BACKUP_STORES = Object.freeze([
  ...C6_RESET_STORES,
  ...PYTHON_STORES,
  ...JAVA_STORES,
  ...CPP_STORES,
  ...RUST_STORES,
  ...MYSQL_STORES,
] as const);
export type BackupStore = (typeof BACKUP_STORES)[number];
export interface BackupRow {
  key: IDBValidKey;
  value: unknown;
}
export type BackupRows = Record<BackupStore, BackupRow[]>;
export interface BackupSummary {
  readonly createdAt: string;
  readonly records: number;
  readonly storeCounts: Readonly<Record<BackupStore, number>>;
  readonly lessons: number;
  readonly passedExercises: number;
  readonly points: number;
  readonly background: boolean;
}
export interface PreparedBackup {
  readonly summary: BackupSummary;
}
interface Candidate {
  rows: BackupRows;
  snapshot: StorageSnapshot;
}
const prepared = new WeakMap<PreparedBackup, Candidate>();
const encoder = new TextEncoder();
const { row } = validationInternals;
function check(ok: unknown): asserts ok {
  if (!ok) throw new StorageError('S_RECORD_INVALID');
}
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

/** Only JSON primitives/closed records are admitted. Files never supply executable values. */
function jsonTree(value: unknown) {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const item = stack.pop()!;
    check(++count <= 2_000_000 && item.depth <= 48);
    const v = item.value;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') continue;
    if (typeof v === 'number') {
      check(Number.isFinite(v));
      continue;
    }
    check(v && typeof v === 'object');
    const array = Array.isArray(v);
    check(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype));
    const keys = Object.keys(v);
    if (array) check(keys.length === v.length);
    for (const key of keys) {
      check(!['__proto__', 'constructor', 'prototype'].includes(key));
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      check('value' in d);
      stack.push({ value: d.value, depth: item.depth + 1 });
    }
  }
}
function rawCore(rows: BackupRows): RawStorageRows {
  return Object.fromEntries(
    STORE_NAMES.map((name) => [
      name,
      {
        keys: rows[name].map((r) => r.key),
        values: rows[name].map((r) => r.value),
      },
    ]),
  ) as RawStorageRows;
}
function values<T>(rows: BackupRows, store: BackupStore): T[] {
  return rows[store].map((r) => r.value as T);
}
function courseRows<T>(rows: BackupRows, stores: readonly [BackupStore, BackupStore]) {
  return { activities: values(rows, stores[0]), drafts: values(rows, stores[1]) } as T;
}
/** Validate all saved partitions and their real cross-record relations before granting a restore. */
export function validateBackupRows(
  rows: BackupRows,
  index: C6LearningIndex,
  compare: (a: IDBValidKey, b: IDBValidKey) => number,
): StorageSnapshot {
  row(rows, [...BACKUP_STORES]);
  let total = 0;
  for (const name of BACKUP_STORES) {
    check(Array.isArray(rows[name]));
    total += rows[name].length;
    check(total <= BACKUP_LIMITS.rows);
    for (let i = 0; i < rows[name].length; i++) {
      const r = rows[name][i];
      row(r, ['key', 'value']);
      // Native IDB key order also rejects duplicate and invalid keys.
      try {
        check(compare(r.key, r.key) === 0 && (!i || compare(rows[name][i - 1].key, r.key) < 0));
      } catch {
        throw new StorageError('S_RECORD_INVALID');
      }
    }
  }
  const recovery = inspectRecoveryRows(rawCore(rows), compare, '15.0.0');
  check(recovery.writable && !recovery.issues.length && recovery.snapshot);
  const snapshot = recovery.snapshot;
  assertMysqlMeta(snapshot.meta);
  const generation = snapshot.meta.generation;
  for (const stores of [
    ['courseActivities', 'courseDrafts'],
    PYTHON_STORES,
    JAVA_STORES,
    CPP_STORES,
    RUST_STORES,
    MYSQL_STORES,
  ] as const) {
    for (const name of stores)
      for (const r of rows[name]) {
        check(r.value && typeof r.value === 'object');
        const v = r.value as {
          generation: string;
          subjectRef?: { id: string };
          documentId?: string;
        };
        check(v.generation === generation);
        check(
          compare(r.key, [
            generation,
            name.endsWith('Activities') ? v.subjectRef!.id : v.documentId!,
          ]) === 0,
        );
      }
  }
  assertC6CourseState(
    {
      snapshot,
      rows: courseRows<C6CourseState['rows']>(rows, ['courseActivities', 'courseDrafts']),
    },
    index,
  );
  assertPythonCourseState({
    snapshot,
    rows: courseRows<PythonCourseState['rows']>(rows, PYTHON_STORES),
  });
  for (const [language, stores] of [
    ['java', JAVA_STORES],
    ['cpp', CPP_STORES],
    ['rust', RUST_STORES],
  ] as const)
    assertTextCourseState(
      { snapshot, rows: courseRows<JavaCourseState['rows']>(rows, stores) },
      language,
    );
  assertMysqlCourseState({
    snapshot,
    rows: courseRows<MysqlCourseState['rows']>(rows, MYSQL_STORES),
  });
  const limits = {
    editHistory: 100,
    knowledgeMarks: 1000,
    reviewCards: 1000,
    achievements: 100,
    customDrafts: 1,
    weaknesses: 1,
  } as const;
  for (const name of Object.keys(limits) as (keyof typeof limits)[])
    check(rows[name].length <= limits[name]);
  const uniqueSequences = new Set<number>();
  for (const r of rows.editHistory) {
    assertEditorSnapshot(r.value);
    const v = r.value;
    check(
      v.generation === generation &&
        compare(r.key, [generation, v.entryId]) === 0 &&
        !uniqueSequences.has(v.sequence),
    );
    uniqueSequences.add(v.sequence);
  }
  check(
    values<Parameters<typeof historyBytes>[0]>(rows, 'editHistory').reduce(
      (n, v) => n + historyBytes(v),
      0,
    ) <= EDIT_HISTORY_LIMITS.bytes,
  );
  for (const r of rows.knowledgeMarks) {
    assertKnowledgeMark(r.value);
    check(
      r.value.generation === generation &&
        compare(r.key, [generation, r.value.knowledgeRef.id]) === 0,
    );
  }
  check(bytes(values(rows, 'knowledgeMarks')) <= 1048576);
  for (const r of rows.reviewCards) {
    assertReviewCard(r.value);
    const v = r.value;
    check(v.generation === generation && compare(r.key, [generation, v.cardId]) === 0);
    for (const e of [v.lastReview, v.lastCommand])
      if (e) check(localDateAt(e.at, snapshot.meta.timeZone) === e.localDate);
  }
  check(bytes(values(rows, 'reviewCards')) <= 2097152);
  for (const r of rows.achievements) {
    assertAchievement(r.value, c6AchievementCatalog);
    check(
      r.value.generation === generation && compare(r.key, [generation, r.value.badgeRef.id]) === 0,
    );
  }
  check(bytes(values(rows, 'achievements')) <= 131072);
  for (const r of rows.customDrafts) {
    assertCustomDraft(r.value);
    check(r.value.generation === generation && r.key === 'current');
  }
  for (const r of rows.weaknesses) {
    assertWeaknessSummary(r.value);
    check(
      r.value.generation === generation &&
        r.value.sourceRevision <= snapshot.meta.revision &&
        r.key === 'current',
    );
  }
  return snapshot;
}
async function digest(value: unknown) {
  return [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value)))),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
function base64(data: Uint8Array) {
  let text = '';
  for (let i = 0; i < data.length; i += 8192)
    text += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(text);
}
async function encodedStores(rows: BackupRows) {
  const encoded = structuredClone(rows);
  for (const r of encoded.appearanceAssets) {
    const asset = r.value as AppearanceAsset;
    check(await usableBackground(asset));
    r.value = { ...asset, blob: base64(new Uint8Array(await asset.blob.arrayBuffer())) };
  }
  return encoded;
}
export async function createBackupFile(
  rows: BackupRows,
  index: C6LearningIndex,
  compare: (a: IDBValidKey, b: IDBValidKey) => number,
): Promise<Blob> {
  validateBackupRows(rows, index, compare);
  const stores = await encodedStores(rows);
  const archive = {
    format: 'c-viz.local-backup',
    version: '1.0.0',
    dbVersion: 15,
    createdAt: new Date().toISOString(),
    sha256: await digest(stores),
    stores,
  };
  const file = new Blob([JSON.stringify(archive)], { type: 'application/json' });
  if (file.size > BACKUP_LIMITS.bytes) throw new StorageError('S_QUOTA');
  return file;
}
export async function prepareBackupFile(
  file: Blob,
  index: C6LearningIndex,
  compare: (a: IDBValidKey, b: IDBValidKey) => number,
): Promise<PreparedBackup> {
  if (file.size > BACKUP_LIMITS.bytes) throw new StorageError('S_QUOTA');
  check(file.size > 0);
  let packet: unknown;
  try {
    const data = await file.arrayBuffer();
    check(data.byteLength === file.size && data.byteLength <= BACKUP_LIMITS.bytes);
    packet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch {
    throw new StorageError('S_RECORD_INVALID');
  }
  jsonTree(packet);
  const archive = row(packet, ['format', 'version', 'dbVersion', 'createdAt', 'sha256', 'stores']);
  if (
    archive.format !== 'c-viz.local-backup' ||
    archive.version !== '1.0.0' ||
    archive.dbVersion !== 15
  )
    throw new StorageError('S_VERSION_UNKNOWN');
  check(
    isUtcTime(archive.createdAt) &&
      typeof archive.sha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(archive.sha256),
  );
  check((await digest(archive.stores)) === archive.sha256);
  const rows = archive.stores as BackupRows;
  row(rows, [...BACKUP_STORES]);
  check(Array.isArray(rows.appearanceAssets) && rows.appearanceAssets.length <= 1);
  for (const r of rows.appearanceAssets) {
    const asset = row(r.value, ['assetId', 'mimeType', 'byteLength', 'width', 'height', 'blob']);
    check(
      typeof asset.blob === 'string' &&
        /^[A-Za-z0-9+/]*={0,2}$/u.test(asset.blob) &&
        asset.blob.length <= Math.ceil(5_242_880 / 3) * 4,
    );
    let binary: string;
    try {
      binary = atob(asset.blob);
    } catch {
      throw new StorageError('S_RECORD_INVALID');
    }
    check(btoa(binary) === asset.blob && binary.length === asset.byteLength);
    const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    asset.blob = new Blob([data], { type: String(asset.mimeType) });
    r.value = asset;
  }
  const snapshot = validateBackupRows(rows, index, compare);
  for (const asset of snapshot.appearanceAssets) check(await usableBackground(asset));
  const summary: BackupSummary = Object.freeze({
    createdAt: archive.createdAt,
    records: BACKUP_STORES.reduce((n, name) => n + rows[name].length, 0),
    storeCounts: Object.freeze(
      Object.fromEntries(BACKUP_STORES.map((name) => [name, rows[name].length])) as Record<
        BackupStore,
        number
      >,
    ),
    lessons: snapshot.progress.filter((p) => p.eventType === 'lesson.completed').length,
    passedExercises: snapshot.progress.filter((p) => p.eventType === 'exercise.passed').length,
    points: snapshot.ledger.reduce((n, r) => n + (r.points ?? 0), 0),
    background: snapshot.appearanceAssets.length > 0,
  });
  const token = Object.freeze({ summary });
  prepared.set(token, { rows, snapshot });
  return token;
}
/** Private capability: no parsed object or mutated preview can become a write recipe. */
export function restoredBackupRows(
  token: PreparedBackup,
  generation: string,
  revision: number,
): BackupRows {
  const candidate = prepared.get(token);
  check(candidate);
  const rows = structuredClone(candidate.rows);
  const previous = candidate.snapshot.meta.generation;
  for (const name of BACKUP_STORES)
    for (const r of rows[name]) {
      if (Array.isArray(r.key) && r.key[0] === previous) r.key[0] = generation;
      const v = r.value as Record<string, unknown>;
      if (v.generation === previous) v.generation = generation;
    }
  const meta = rows.meta[0].value as StorageSnapshot['meta'];
  meta.revision = Math.max(meta.revision, revision) + 1;
  check(Number.isSafeInteger(meta.revision));
  return rows;
}
