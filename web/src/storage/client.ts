import {
  DB_NAME,
  DB_VERSION,
  STORE_NAMES,
  ALL_STORE_NAMES,
  V7_STORE_NAMES,
  V8_STORE_NAMES,
  SCHEMA_VERSION,
  createMeta,
  defaultSettings,
  defaultAvatar,
  defaultAppearance,
  CORE_STORE_NAMES,
  recordKey,
} from './model';
import type {
  LedgerEntry,
  Meta,
  Ref,
  Receipt,
  StorageRecords,
  StorageSnapshot,
  StoreName,
} from './model';
import { assertRecord, assertSnapshot, isSafeUint, isTimeZone, isUuid } from './validation';
import { StorageError, storageError } from './errors';
import { assertC6Meta, C6_RESET_STORES, createC6ResetMeta, queueC6ResetUpgrade } from './c6-reset';
import {
  PYTHON_DB_VERSION,
  PYTHON_STORES,
  physicalSchemaVersion,
  queuePythonStores,
  toPythonMeta,
} from './python3-meta';
import {
  pythonCourseTransaction,
  readPythonUpgradeRows,
  type PreparePythonCourse,
} from './python3-course';
import { assertPythonMeta } from './python3-meta';
import { JAVA_DB_VERSION, JAVA_STORES, queueJavaStores, toJavaMeta } from './java-meta';
import { javaCourseTransaction, type PrepareJavaCourse } from './java-course';
import { c6ActivationIndex } from './c6-activation';
import type { C6StorageActivation } from './c6-activation';
import { c6CourseTransaction, readC6Rows, type PrepareC6Course } from './c6-course';
import type { C6LearningIndex } from '../c6-learning';
import { upgradeV1Snapshot } from './v1-migration';
import { usableBackground } from './appearance-assets';
import { upgradeV2Meta } from './v2-migration';
import { upgradeV3Meta } from './v3-migration';
import { upgradeV4Meta } from './v4-migration';
import { upgradeV5Meta } from './v5-migration';
import { upgradeV6Meta } from './v6-migration';
import { upgradeV7Meta } from './v7-migration';
import { upgradeV8Meta } from './v8-migration';
import { weaknessesTransaction, type WeaknessReader } from './weaknesses';
import { customDraftTransaction, type CustomDraftWrite } from './custom-draft';
import { achievementsTransaction, type AchievementSourceReader } from './achievements';
import type { AchievementEvidence } from '../achievements/model';
import { reviewCardsTransaction, type ReviewSourceReader } from './review-cards';
import type { ReviewCommand } from '../review-scheduler/model';
import { knowledgeMarksTransaction, type KnowledgeMarkCommand } from './knowledge-marks';
import { editorHistoryTransaction } from './editor-history';
import type {
  EditorHistoryContext,
  EditorHistorySave,
  EditorSnapshot,
  EditorSnapshotDraft,
} from './editor-history';
import {
  hasUnknownRecoveryVersion,
  inspectRecoveryRows,
  readRawTransaction,
  sameRecoveryValue,
} from './recovery';
import type { RawStorageRows, RecoveryRead } from './recovery';

type MutableStore = Exclude<StoreName, 'meta' | 'appearanceAssets'>;
export type StorageMutation = {
  [S in MutableStore]: { store: S; mode: 'add' | 'put'; value: StorageRecords[S] };
}[MutableStore];
type Prepare = (snapshot: StorageSnapshot) => StorageMutation[];
type WithoutRevision<T> = T extends unknown ? Omit<T, 'committedRevision'> : never;
export type ReceiptSummary = WithoutRevision<Receipt>;
export interface SaveResult {
  saved: true;
  revision: number;
  replayed: boolean;
}

/** Internal guard shared by the transaction and focused transition tests. */
export function assertRewardSettlement(previous: LedgerEntry | undefined, next: LedgerEntry): void {
  assertRecord('ledger', next);
  if (
    !previous ||
    previous.status !== 'pending' ||
    next.status !== 'posted' ||
    previous.sourceId !== next.sourceId ||
    previous.subjectId !== next.subjectId ||
    previous.localDate !== next.localDate ||
    previous.occurredAt !== next.occurredAt
  )
    throw new StorageError('S_RECORD_INVALID');
}

/** Internal reviewed-package transition; no learning row or receipt is synthesized. */
export function prepareReviewedCourseSwitch(
  meta: Meta,
  generation: string,
  expectedRevision: number,
): Meta {
  assertRecord('meta', meta);
  if (meta.schemaVersion !== SCHEMA_VERSION) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  if (meta.generation !== generation) throw new StorageError('S_GENERATION_STALE');
  if (meta.revision !== expectedRevision) throw new StorageError('S_REVISION_CONFLICT');
  if (meta.activePackageRef.id === 'content.c.p05' && meta.activePackageRef.version === '1.0.0')
    return meta;
  if (
    meta.activePackageRef.id !== 'content.c.p0' ||
    !['1.0.1', '1.0.2'].includes(meta.activePackageRef.version)
  )
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  if (meta.revision === Number.MAX_SAFE_INTEGER) throw new StorageError('S_RECORD_INVALID');
  const next: Meta = {
    ...meta,
    revision: meta.revision + 1,
    activePackageRef: { id: 'content.c.p05', version: '1.0.0' },
  };
  assertRecord('meta', next);
  return next;
}

export interface OpenStorageOptions {
  activePackageRef: Ref;
  /** Internal capability from the successfully loaded pinned C6 learning index. */
  c6Activation?: C6StorageActivation;
  enablePython?: boolean;
  enableJava?: boolean;
  signal?: AbortSignal;
  onBlocked?: () => void;
  // Dependency injection is internal; the public entry point fixes the production DB.
  name?: string;
  factory?: IDBFactory;
  timeZone?: string;
  recovery?: boolean;
}

function physicalStores(db: IDBDatabase): readonly string[] {
  if (db.version === JAVA_DB_VERSION) return [...C6_RESET_STORES, ...PYTHON_STORES, ...JAVA_STORES];
  if (db.version === PYTHON_DB_VERSION) return [...C6_RESET_STORES, ...PYTHON_STORES];
  if (db.version === 10) return C6_RESET_STORES;
  if (db.version === DB_VERSION) return ALL_STORE_NAMES;
  throw new StorageError('S_VERSION_UNKNOWN');
}
function checkLayout(db: IDBDatabase): void {
  const names = physicalStores(db);
  if (
    db.objectStoreNames.length !== names.length ||
    names.some((store) => !db.objectStoreNames.contains(store))
  ) {
    throw new StorageError('S_RECORD_INVALID');
  }
  const tx = db.transaction(names, 'readonly');
  for (const name of names) {
    const store = tx.objectStore(name);
    if (store.keyPath !== null || store.autoIncrement || store.indexNames.length) {
      throw new StorageError('S_RECORD_INVALID');
    }
  }
}

function transaction(db: IDBDatabase, mode: IDBTransactionMode): IDBTransaction {
  return db.transaction(
    db.version >= 10 ? [...STORE_NAMES, 'courseActivities', 'courseDrafts'] : STORE_NAMES,
    mode,
    mode === 'readwrite' ? { durability: 'strict' } : undefined,
  );
}

function checkedMeta(value: unknown): asserts value is Meta {
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion !== SCHEMA_VERSION &&
    value.schemaVersion !== '10.0.0' &&
    value.schemaVersion !== '11.0.0' &&
    value.schemaVersion !== '12.0.0'
  ) {
    throw new StorageError(
      value.schemaVersion === '0.9.0' ? 'S_MIGRATION_UNSUPPORTED' : 'S_VERSION_UNKNOWN',
    );
  }
  assertRecord('meta', value);
}

// All requests are queued immediately. Conversion/validation is synchronous inside
// their callbacks, with no network, timers or UI waits within an IDB transaction.
export function readTransaction(
  tx: IDBTransaction,
  ready: (snapshot: StorageSnapshot, appearanceReadOnly: boolean) => void,
  fail: (error: unknown) => void,
  factory: IDBFactory,
  expectedDbVersion: number = DB_VERSION,
  c6Index?: C6LearningIndex,
): void {
  if (![DB_VERSION, 10, PYTHON_DB_VERSION, JAVA_DB_VERSION].includes(expectedDbVersion)) {
    fail(new StorageError('S_VERSION_UNKNOWN'));
    return;
  }
  readRawTransaction(
    tx,
    (raw) => {
      try {
        const recovery = inspectRecoveryRows(
          raw,
          (a, b) => factory.cmp(a, b),
          physicalSchemaVersion(expectedDbVersion),
        );
        if (!recovery.writable || !recovery.snapshot)
          throw new StorageError(recovery.errorCode ?? 'S_RECORD_INVALID');
        if (recovery.snapshot.meta.dbVersion !== expectedDbVersion)
          throw new StorageError('S_VERSION_UNKNOWN');
        if (c6Index && expectedDbVersion >= 10) {
          const snapshot = recovery.snapshot;
          readC6Rows(
            tx,
            c6Index,
            snapshot,
            () => ready(snapshot, recovery.appearanceReadOnly),
            fail,
          );
        } else ready(recovery.snapshot, recovery.appearanceReadOnly);
      } catch (error) {
        fail(error);
      }
    },
    fail,
  );
}
export class StorageClient {
  private closed = false;
  private channel: BroadcastChannel | undefined;
  private listeners = new Set<() => void>();
  private guards = new Map<
    string,
    { raw: Pick<RawStorageRows, 'meta' | 'settings' | 'avatar'>; recovery: RecoveryRead }
  >();
  private fallback: boolean;
  get timeZoneFallback(): boolean {
    return this.fallback;
  }
  constructor(
    private readonly db: IDBDatabase,
    fallback: boolean,
    private readonly factory: IDBFactory,
    private readonly initialization?: {
      activePackageRef: Ref;
      timeZone?: string;
      c6Activation?: C6StorageActivation;
    },
  ) {
    if (db.version >= 10) {
      if (!initialization?.c6Activation) throw new StorageError('S_CONTENT_INCOMPATIBLE');
      const index = c6ActivationIndex(initialization.c6Activation);
      if (
        initialization.activePackageRef.id !== index.packageRef.id ||
        initialization.activePackageRef.version !== index.packageRef.version
      )
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
    }
    this.fallback = fallback;
    db.onversionchange = () => {
      this.close();
      this.notifyInvalidation();
    };
    db.onclose = () => {
      this.close();
      this.notifyInvalidation();
    };
    if (db.name === DB_NAME && typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel('c-viz-learning.invalidate');
        this.channel.onmessage = (event: MessageEvent<unknown>) => {
          if (this.closed || !validInvalidation(event.data)) return;
          this.notifyInvalidation();
        };
      } catch {
        // Notification permissions are independent from IndexedDB availability.
        // Every read/write checks the database even when this hint is unavailable.
      }
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.guards.clear();
    this.channel?.close();
    this.channel = undefined;
    this.db.close();
  }
  subscribeInvalidation(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notifyInvalidation(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a UI subscriber cannot affect storage */
      }
    }
  }
  private broadcast(meta: Pick<Meta, 'generation' | 'revision'>): void {
    try {
      this.channel?.postMessage({ generation: meta.generation, revision: meta.revision });
    } catch {
      /* hints are optional; every read/write rechecks the DB */
    }
  }
  private connection(): IDBDatabase {
    if (this.closed) throw new StorageError('S_STORAGE_UNAVAILABLE');
    return this.db;
  }
  /** Final read-only revision gate. The action runs synchronously while meta is locked. */
  atSavedRevision(generation: string, revision: number, action: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      let failure: unknown;
      let performed = false;
      const tx = this.connection().transaction(['meta'], 'readonly');
      tx.onabort = () => reject(storageError(failure ?? tx.error ?? new StorageError('S_ABORTED')));
      tx.onerror = () => {
        failure ??= tx.error;
      };
      tx.oncomplete = () => (performed ? resolve() : reject(new StorageError('S_ABORTED')));
      const request = tx.objectStore('meta').get('current');
      request.onsuccess = () => {
        try {
          const meta: unknown = request.result;
          checkedMeta(meta);
          if (meta.generation !== generation) throw new StorageError('S_GENERATION_STALE');
          if (meta.revision !== revision) throw new StorageError('S_REVISION_CONFLICT');
          action();
          performed = true;
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }
  readEditorHistory(context: EditorHistoryContext): Promise<EditorSnapshot[]> {
    return editorHistoryTransaction(this.connection(), context) as Promise<EditorSnapshot[]>;
  }
  async syncAchievements(
    context: EditorHistoryContext,
    derive: AchievementSourceReader,
    observation?: AchievementEvidence,
  ) {
    const result = await achievementsTransaction(
      this.connection(),
      this.factory,
      context,
      derive,
      observation,
    );
    if (result.changed) this.broadcast(result.meta);
    return result;
  }
  async syncReviewCards(
    context: EditorHistoryContext,
    derive: ReviewSourceReader,
    at: string,
    command?: ReviewCommand,
  ) {
    const result = await reviewCardsTransaction(
      this.connection(),
      this.factory,
      context,
      derive,
      at,
      command,
    );
    if (result.changed) this.broadcast(result.meta);
    return result;
  }
  async readKnowledgeMarks(context: EditorHistoryContext) {
    return (await knowledgeMarksTransaction(this.connection(), context)).rows;
  }
  async syncWeaknesses(context: EditorHistoryContext, derive: WeaknessReader, at: string) {
    const result = await weaknessesTransaction(
      this.connection(),
      this.factory,
      context,
      derive,
      at,
    );
    if (result.changed) this.broadcast(result.meta);
    return result;
  }
  async saveKnowledgeMark(context: EditorHistoryContext, command: KnowledgeMarkCommand) {
    const result = await knowledgeMarksTransaction(this.connection(), context, command);
    this.broadcast(result.meta);
    return result.rows;
  }
  saveEditorHistory(
    context: EditorHistoryContext,
    record: EditorSnapshotDraft,
    updateOnly: boolean,
  ): Promise<EditorHistorySave> {
    return editorHistoryTransaction(this.connection(), context, {
      record,
      updateOnly,
    }) as Promise<EditorHistorySave>;
  }
  customDraft(context: EditorHistoryContext, write?: CustomDraftWrite) {
    return customDraftTransaction(this.connection(), context, write);
  }
  async read(): Promise<StorageSnapshot> {
    const recovery = await this.readRecovery();
    if (!recovery.writable || !recovery.snapshot)
      throw new StorageError(recovery.errorCode ?? 'S_RECORD_INVALID');
    return recovery.snapshot;
  }
  async readC6Course() {
    if (!this.initialization?.c6Activation) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    return (
      await c6CourseTransaction(
        this.connection(),
        this.factory,
        c6ActivationIndex(this.initialization.c6Activation),
      )
    ).state;
  }
  async commitC6Course(
    generation: string,
    revision: number,
    prepare: PrepareC6Course,
  ): Promise<SaveResult> {
    if (!this.initialization?.c6Activation) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const result = await c6CourseTransaction(
      this.connection(),
      this.factory,
      c6ActivationIndex(this.initialization.c6Activation),
      { generation, revision, prepare },
    );
    const current = await this.readC6Course();
    if (current.snapshot.meta.generation !== generation)
      throw new StorageError('S_GENERATION_STALE');
    if (!result.saved.replayed) this.broadcast(current.snapshot.meta);
    return result.saved;
  }
  async readPythonCourse() {
    return (await pythonCourseTransaction(this.connection(), this.factory)).state;
  }
  async commitPythonCourse(generation: string, revision: number, prepare: PreparePythonCourse) {
    const result = await pythonCourseTransaction(this.connection(), this.factory, {
      generation,
      revision,
      prepare,
    });
    if (!result.saved.replayed) this.broadcast(result.state.snapshot.meta);
    return result.saved;
  }
  async readJavaCourse() {
    return (await javaCourseTransaction(this.connection(), this.factory)).state;
  }
  async commitJavaCourse(generation: string, revision: number, prepare: PrepareJavaCourse) {
    const result = await javaCourseTransaction(this.connection(), this.factory, {
      generation,
      revision,
      prepare,
    });
    if (!result.saved.replayed) this.broadcast(result.state.snapshot.meta);
    return result.saved;
  }
  async probe(): Promise<{ available: true }> {
    const initial = await this.read();
    await this.execute(initial.meta.generation, () => [], undefined, undefined, true);
    return { available: true };
  }
  private async readRaw(): Promise<RawStorageRows> {
    try {
      const db = this.connection();
      checkLayout(db);
      const tx = transaction(db, 'readonly');
      return await new Promise((resolve, reject) => {
        let raw: RawStorageRows | undefined;
        let failure: unknown;
        tx.oncomplete = () => (raw ? resolve(raw) : reject(storageError(failure)));
        tx.onabort = () =>
          reject(storageError(failure ?? tx.error ?? new StorageError('S_ABORTED')));
        tx.onerror = () => {
          failure ??= tx.error;
        };
        readRawTransaction(
          tx,
          (value) => {
            raw = value;
          },
          (error) => {
            failure = error;
            try {
              tx.abort();
            } catch {
              /* already ended */
            }
          },
        );
      });
    } catch (error) {
      throw storageError(error);
    }
  }
  async readRecovery(): Promise<RecoveryRead> {
    const raw = await this.readRaw();
    const recovery: RecoveryRead = {
      ...inspectRecoveryRows(
        raw,
        (a, b) => this.factory.cmp(a, b),
        physicalSchemaVersion(this.connection().version),
      ),
      guard: crypto.randomUUID(),
    };
    if (recovery.snapshot && recovery.snapshot.meta.dbVersion !== this.connection().version) {
      recovery.snapshot = null;
      recovery.writable = false;
      recovery.canClear = false;
      recovery.errorCode = 'S_VERSION_UNKNOWN';
      recovery.issues.push({ store: 'layout', count: 1 });
    }
    if (recovery.snapshot?.appearanceAssets.length && !recovery.appearanceReadOnly) {
      const valid = await usableBackground(recovery.snapshot.appearanceAssets[0]);
      const latest = await this.readRaw();
      if (!sameRecoveryValue(raw.meta, latest.meta)) return this.readRecovery();
      if (!valid) {
        recovery.appearanceReadOnly = true;
        recovery.issues.push({ store: 'appearanceAssets', count: 1 });
        recovery.snapshot.appearance = defaultAppearance();
        recovery.snapshot.appearanceAssets = [];
      }
    }
    if (this.connection().version >= 10 && recovery.writable && recovery.snapshot) {
      try {
        const state = await this.readC6Course();
        if (!sameRecoveryValue(state.snapshot.meta, recovery.snapshot.meta))
          return this.readRecovery();
        if (this.connection().version >= PYTHON_DB_VERSION) {
          const python = await this.readPythonCourse();
          if (!sameRecoveryValue(python.snapshot.meta, recovery.snapshot.meta))
            return this.readRecovery();
        }
        if (this.connection().version === JAVA_DB_VERSION) {
          const java = await this.readJavaCourse();
          if (!sameRecoveryValue(java.snapshot.meta, recovery.snapshot.meta))
            return this.readRecovery();
        }
      } catch (error) {
        const code = storageError(error).code;
        if (code !== 'S_RECORD_INVALID' && code !== 'S_VERSION_UNKNOWN') throw error;
        recovery.snapshot = null;
        recovery.courseReadOnly = true;
        recovery.writable = false;
        recovery.ledgerUncertain = true;
        recovery.errorCode = code;
        recovery.canClear &&= code !== 'S_VERSION_UNKNOWN';
        recovery.resettable = [];
        recovery.issues.push({ store: 'course', count: 1 });
      }
    }
    this.guards.set(recovery.guard, {
      raw: structuredClone({ meta: raw.meta, settings: raw.settings, avatar: raw.avatar }),
      recovery: structuredClone(recovery),
    });
    // Confirmation history is private and bounded; stale UI can read again.
    if (this.guards.size > 16) this.guards.delete(this.guards.keys().next().value!);
    return recovery;
  }
  async clear(guard: string): Promise<StorageSnapshot> {
    const confirmation = this.guards.get(guard);
    if (!confirmation) throw new StorageError('S_REVISION_CONFLICT');
    if (!confirmation.recovery.canClear)
      throw new StorageError(confirmation.recovery.errorCode ?? 'S_RECORD_INVALID');
    const previous = confirmation.recovery.snapshot?.meta;
    const activePackageRef = this.initialization?.activePackageRef ?? previous?.activePackageRef;
    if (!activePackageRef) throw new StorageError('S_STORAGE_UNAVAILABLE');
    let timeZone =
      this.initialization?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fallback = !isTimeZone(timeZone);
    if (fallback) timeZone = 'UTC';
    const baseMeta =
      this.connection().version >= 10
        ? createC6ResetMeta(crypto.randomUUID(), timeZone, new Date().toISOString())
        : createMeta({
            generation: crypto.randomUUID(),
            timeZone,
            createdAt: new Date().toISOString(),
            activePackageRef,
          });
    const meta =
      baseMeta.dbVersion === 10 && this.connection().version >= PYTHON_DB_VERSION
        ? this.connection().version === JAVA_DB_VERSION
          ? toJavaMeta(toPythonMeta(baseMeta))
          : toPythonMeta(baseMeta)
        : baseMeta;
    assertRecord('meta', meta);
    if (meta.generation === rawGeneration(confirmation.raw.meta))
      throw new StorageError('S_RECORD_INVALID');
    try {
      await this.repairTransaction(guard, 'clear', (_raw, tx) => {
        for (const name of physicalStores(this.connection())) tx.objectStore(name).clear();
        tx.objectStore('meta').add(meta, 'current');
        tx.objectStore('settings').add(defaultSettings(), 'current');
        tx.objectStore('avatar').add(defaultAvatar(), 'current');
        tx.objectStore('appearance').add(defaultAppearance(), 'current');
      });
      const current = await this.read();
      if (current.meta.generation !== meta.generation) throw new StorageError('S_GENERATION_STALE');
      this.fallback = fallback;
      this.guards.clear();
      this.broadcast(current.meta);
      return current;
    } catch (error) {
      throw storageError(error);
    }
  }
  async resetSingleton(store: 'settings' | 'avatar', guard: string): Promise<RecoveryRead> {
    const confirmation = this.guards.get(guard);
    if (!confirmation?.recovery.resettable.includes(store) || !confirmation.recovery.snapshot)
      throw new StorageError('S_REVISION_CONFLICT');
    const generation = confirmation.recovery.snapshot.meta.generation;
    try {
      await this.repairTransaction(guard, store, (raw, tx) => {
        const meta = raw.meta.values[0];
        checkedMeta(meta);
        if (meta.revision === Number.MAX_SAFE_INTEGER) throw new StorageError('S_RECORD_INVALID');
        // This explicitly confirmed singleton is the complete repair scope.
        tx.objectStore(store).clear();
        tx.objectStore(store).add(
          store === 'settings' ? defaultSettings() : defaultAvatar(),
          'current',
        );
        tx.objectStore('meta').put({ ...meta, revision: meta.revision + 1 }, 'current');
      });
      const current = await this.readRecovery();
      if (current.snapshot?.meta.generation !== generation)
        throw new StorageError('S_GENERATION_STALE');
      this.broadcast(current.snapshot.meta);
      return current;
    } catch (error) {
      throw storageError(error);
    }
  }
  /** Explicitly confirmed scope: all appearance rows/assets, never learning data. */
  async resetAppearance(generation: string, expectedRevision: number): Promise<SaveResult> {
    const confirmation = await this.readRecovery();
    if (
      confirmation.errorCode === 'S_VERSION_UNKNOWN' ||
      confirmation.errorCode === 'S_MIGRATION_UNSUPPORTED'
    )
      throw new StorageError(confirmation.errorCode);
    if (!confirmation.appearanceCanReset || !confirmation.snapshot)
      throw new StorageError('S_RECORD_INVALID');
    if (confirmation.snapshot.meta.generation !== generation)
      throw new StorageError('S_GENERATION_STALE');
    if (confirmation.snapshot.meta.revision !== expectedRevision)
      throw new StorageError('S_REVISION_CONFLICT');
    await this.repairTransaction(confirmation.guard, 'appearance', (raw, tx) => {
      const meta = raw.meta.values[0];
      checkedMeta(meta);
      const settings = raw.settings.values[0];
      assertRecord('settings', settings);
      if (meta.revision === Number.MAX_SAFE_INTEGER) throw new StorageError('S_RECORD_INVALID');
      tx.objectStore('appearance').clear();
      tx.objectStore('appearanceAssets').clear();
      tx.objectStore('appearance').add(defaultAppearance(), 'current');
      tx.objectStore('settings').put({ ...settings, theme: 'light' }, 'current');
      tx.objectStore('meta').put({ ...meta, revision: meta.revision + 1 }, 'current');
    });
    const current = await this.readRecovery();
    if (current.snapshot?.meta.generation !== generation)
      throw new StorageError('S_GENERATION_STALE');
    this.broadcast(current.snapshot.meta);
    return { saved: true, revision: expectedRevision + 1, replayed: false };
  }
  private async repairTransaction(
    guard: string,
    operation: 'clear' | 'settings' | 'avatar' | 'appearance',
    write: (raw: RawStorageRows, tx: IDBTransaction) => void,
  ): Promise<void> {
    const confirmation = this.guards.get(guard);
    if (!confirmation) throw new StorageError('S_REVISION_CONFLICT');
    const db = this.connection();
    checkLayout(db);
    const tx = db.transaction(physicalStores(db), 'readwrite', { durability: 'strict' });
    return new Promise((resolve, reject) => {
      let failure: unknown;
      let written = false;
      const fail = (error: unknown) => {
        failure ??= error;
        try {
          tx.abort();
        } catch {
          /* already ended */
        }
      };
      tx.onabort = () => reject(storageError(failure ?? tx.error ?? new StorageError('S_ABORTED')));
      tx.onerror = () => {
        failure ??= tx.error;
      };
      tx.oncomplete = () => (written ? resolve() : reject(new StorageError('S_ABORTED')));
      readRawTransaction(
        tx,
        (raw) => {
          try {
            if (hasUnknownRecoveryVersion(raw, physicalSchemaVersion(db.version)))
              throw new StorageError('S_VERSION_UNKNOWN');
            const oldMeta = confirmation.recovery.snapshot?.meta;
            const currentMeta =
              raw.meta.keys.length === 1 &&
              raw.meta.keys[0] === 'current' &&
              raw.meta.values.length === 1
                ? raw.meta.values[0]
                : undefined;
            const oldGeneration = rawGeneration(confirmation.raw.meta);
            const currentGeneration = rawGeneration(raw.meta);
            if (oldGeneration && currentGeneration && currentGeneration !== oldGeneration)
              throw new StorageError('S_GENERATION_STALE');
            if (operation === 'clear' && oldMeta) {
              // Same-generation writes committed before clear are intentionally cleared.
              checkedMeta(currentMeta);
              if (currentMeta.generation !== oldMeta.generation)
                throw new StorageError('S_GENERATION_STALE');
              if (currentMeta.revision < oldMeta.revision)
                throw new StorageError('S_REVISION_CONFLICT');
            } else if (!sameRecoveryValue(raw.meta, confirmation.raw.meta)) {
              throw new StorageError('S_REVISION_CONFLICT');
            }
            if (
              operation !== 'clear' &&
              operation !== 'appearance' &&
              !sameRecoveryValue(raw[operation], confirmation.raw[operation])
            )
              throw new StorageError('S_REVISION_CONFLICT');
            if (
              operation === 'clear' &&
              !inspectRecoveryRows(
                raw,
                (a, b) => this.factory.cmp(a, b),
                physicalSchemaVersion(db.version),
              ).canClear
            )
              throw new StorageError('S_RECORD_INVALID');
            write(raw, tx);
            written = true;
          } catch (error) {
            fail(error);
          }
        },
        fail,
      );
    });
  }
  // Internal primitive for the trusted learning/settings layer. It accepts only
  // closed SAVE rows, computes keys itself and writes deltas, never a whole archive.
  async commit(
    generation: string,
    prepare: Prepare,
    expectedRevision?: number,
  ): Promise<SaveResult> {
    return this.execute(generation, prepare, undefined, expectedRevision);
  }
  async commitOnce(
    command: { generation: string; receipt: ReceiptSummary },
    prepare: Prepare,
  ): Promise<SaveResult> {
    return this.execute(command.generation, prepare, command.receipt);
  }
  async commitAppearance(
    generation: string,
    prepare: Prepare,
    expectedRevision: number,
  ): Promise<SaveResult> {
    const recovery = await this.readRecovery();
    if (recovery.appearanceReadOnly)
      throw new StorageError(recovery.errorCode ?? 'S_RECORD_INVALID');
    return this.execute(generation, prepare, undefined, expectedRevision, false, false, true);
  }
  /** DEC-P05-007: switch the reviewed case assembly without rewriting a learning row. */
  async switchReviewedCaseRelease(
    generation: string,
    expectedRevision: number,
  ): Promise<SaveResult> {
    try {
      const tx = transaction(this.connection(), 'readwrite');
      const result = await new Promise<SaveResult>((resolve, reject) => {
        let failure: unknown;
        let saved: SaveResult | undefined;
        const fail = (error: unknown) => {
          failure ??= error;
          try {
            tx.abort();
          } catch {
            /* already ended */
          }
        };
        tx.onabort = () =>
          reject(storageError(failure ?? tx.error ?? new StorageError('S_ABORTED')));
        tx.onerror = () => {
          failure ??= tx.error;
        };
        tx.oncomplete = () => (saved ? resolve(saved) : reject(new StorageError('S_ABORTED')));
        readTransaction(
          tx,
          (snapshot) => {
            try {
              const meta = snapshot.meta;
              if (meta.generation !== generation) throw new StorageError('S_GENERATION_STALE');
              if (meta.revision !== expectedRevision) throw new StorageError('S_REVISION_CONFLICT');
              if (
                meta.activePackageRef.id !== 'content.c.p0' ||
                !['1.0.0', '1.0.1', '1.0.2'].includes(meta.activePackageRef.version)
              )
                throw new StorageError('S_CONTENT_INCOMPATIBLE');
              if (meta.activePackageRef.version === '1.0.2') {
                saved = { saved: true, revision: meta.revision, replayed: false };
                return;
              }
              if (meta.revision === Number.MAX_SAFE_INTEGER)
                throw new StorageError('S_RECORD_INVALID');
              const next = {
                ...meta,
                revision: meta.revision + 1,
                activePackageRef: { id: 'content.c.p0', version: '1.0.2' },
              };
              assertRecord('meta', next);
              tx.objectStore('meta').put(next, 'current');
              saved = { saved: true, revision: next.revision, replayed: false };
            } catch (error) {
              fail(error);
            }
          },
          fail,
          this.factory,
          this.connection().version,
          this.initialization?.c6Activation
            ? c6ActivationIndex(this.initialization.c6Activation)
            : undefined,
        );
      });
      const current = await this.read();
      if (current.meta.generation !== generation) throw new StorageError('S_GENERATION_STALE');
      if (result.revision !== expectedRevision) this.broadcast(current.meta);
      return result;
    } catch (error) {
      throw storageError(error);
    }
  }
  /** P0.5-09: CAS switch only after the complete new assembly is verified. */
  async switchReviewedCourseRelease(
    generation: string,
    expectedRevision: number,
  ): Promise<SaveResult> {
    try {
      const tx = transaction(this.connection(), 'readwrite');
      const result = await new Promise<SaveResult>((resolve, reject) => {
        let failure: unknown;
        let saved: SaveResult | undefined;
        const fail = (error: unknown) => {
          failure ??= error;
          try {
            tx.abort();
          } catch {
            /* already ended */
          }
        };
        tx.onabort = () =>
          reject(storageError(failure ?? tx.error ?? new StorageError('S_ABORTED')));
        tx.onerror = () => {
          failure ??= tx.error;
        };
        tx.oncomplete = () => (saved ? resolve(saved) : reject(new StorageError('S_ABORTED')));
        readTransaction(
          tx,
          (snapshot) => {
            try {
              const next = prepareReviewedCourseSwitch(snapshot.meta, generation, expectedRevision);
              if (next !== snapshot.meta) tx.objectStore('meta').put(next, 'current');
              saved = { saved: true, revision: next.revision, replayed: false };
            } catch (error) {
              fail(error);
            }
          },
          fail,
          this.factory,
          this.connection().version,
          this.initialization?.c6Activation
            ? c6ActivationIndex(this.initialization.c6Activation)
            : undefined,
        );
      });
      const current = await this.read();
      if (current.meta.generation !== generation) throw new StorageError('S_GENERATION_STALE');
      if (result.revision !== expectedRevision) this.broadcast(current.meta);
      return result;
    } catch (error) {
      throw storageError(error);
    }
  }
  /** Trusted reward recipe: update existing pending rights, never create facts or rights. */
  async settleRewards(generation: string, prepare: Prepare): Promise<SaveResult> {
    return this.execute(generation, prepare, undefined, undefined, false, true);
  }
  private async execute(
    generation: string,
    prepare: Prepare,
    receipt?: ReceiptSummary,
    expectedRevision?: number,
    probe = false,
    settlementOnly = false,
    appearanceEdit = false,
  ): Promise<SaveResult> {
    try {
      const tx = transaction(this.connection(), 'readwrite');
      const result = await new Promise<SaveResult>((resolve, reject) => {
        let failure: unknown;
        let saved: SaveResult | undefined;
        tx.onabort = () =>
          reject(storageError(failure ?? tx.error ?? new StorageError('S_ABORTED')));
        tx.onerror = () => {
          failure ??= tx.error;
        };
        tx.oncomplete = () => (saved ? resolve(saved) : reject(new StorageError('S_ABORTED')));
        const fail = (error: unknown) => {
          failure ??= error;
          try {
            tx.abort();
          } catch {
            /* already finished */
          }
        };
        readTransaction(
          tx,
          (snapshot, appearanceReadOnly) => {
            try {
              if (snapshot.meta.generation !== generation)
                throw new StorageError('S_GENERATION_STALE');
              if (receipt) {
                assertRecord('receipts', { ...receipt, committedRevision: 1 });
                const previous = snapshot.receipts.find((row) => row.eventId === receipt.eventId);
                if (previous) {
                  const { committedRevision, ...summary } = previous;
                  if (!sameRecord(summary, receipt)) throw new StorageError('S_EVENT_ID_REUSED');
                  saved = { saved: true, revision: committedRevision, replayed: true };
                  return;
                }
              }
              if (expectedRevision !== undefined && snapshot.meta.revision !== expectedRevision) {
                throw new StorageError('S_REVISION_CONFLICT');
              }
              if (appearanceEdit && appearanceReadOnly) throw new StorageError('S_RECORD_INVALID');
              const operations = prepare(structuredClone(snapshot));
              if (!Array.isArray(operations)) throw new StorageError('S_RECORD_INVALID');
              if (probe) {
                tx.objectStore('meta').put(snapshot.meta, 'current');
                saved = { saved: true, revision: snapshot.meta.revision, replayed: false };
                return;
              }
              if (operations.length === 0 && !receipt) {
                saved = { saved: true, revision: snapshot.meta.revision, replayed: false };
                return;
              }
              if (snapshot.meta.revision === Number.MAX_SAFE_INTEGER)
                throw new StorageError('S_RECORD_INVALID');
              const next = structuredClone(snapshot);
              const revision = next.meta.revision + 1;
              const writes: StorageMutation[] = [];
              const touched = new Set<string>();
              for (const op of operations) {
                if (
                  !op ||
                  !STORE_NAMES.includes(op.store) ||
                  op.store === ('meta' as string) ||
                  op.store === ('appearanceAssets' as string) ||
                  (op.mode !== 'add' && op.mode !== 'put') ||
                  Object.keys(op).some((key) => !['store', 'mode', 'value'].includes(key))
                ) {
                  throw new StorageError('S_RECORD_INVALID');
                }
                if (
                  (op.store === 'appearance' && !appearanceEdit) ||
                  (appearanceEdit && op.store !== 'appearance' && op.store !== 'settings')
                )
                  throw new StorageError('S_RECORD_INVALID');
                // Ordinary writes keep first rights append-only. The settlement
                // path admits only a closed pending-to-posted transition below.
                if (
                  op.store === 'receipts' ||
                  op.store === 'aliases' ||
                  (op.store === 'ledger' && op.mode !== 'add' && !settlementOnly) ||
                  (settlementOnly && (op.store !== 'ledger' || op.mode !== 'put'))
                )
                  throw new StorageError('S_RECORD_INVALID');
                assertRecord(op.store, op.value);
                const key = recordKey(op.store, generation, op.value as never);
                const token = JSON.stringify([op.store, key]);
                if (touched.has(token)) throw new StorageError('S_RECORD_INVALID');
                touched.add(token);
                if (op.store === 'settings' || op.store === 'avatar' || op.store === 'appearance') {
                  if (op.store === 'appearance' && appearanceReadOnly)
                    throw new StorageError('S_RECORD_INVALID');
                  if (expectedRevision === undefined || op.mode !== 'put')
                    throw new StorageError('S_REVISION_CONFLICT');
                  Object.assign(next, { [op.store]: structuredClone(op.value) });
                } else {
                  const rows = next[op.store] as unknown[];
                  const at = rows.findIndex((row) =>
                    sameRecord(recordKey(op.store, generation, row as never), key),
                  );
                  if (settlementOnly) {
                    if (op.store !== 'ledger') throw new StorageError('S_RECORD_INVALID');
                    assertRewardSettlement(next.ledger[at], op.value);
                  }
                  if (at >= 0 && op.store === 'ledger' && !settlementOnly) continue;
                  if (at >= 0 && op.mode === 'add') throw new StorageError('S_RECORD_INVALID');
                  if (at >= 0) rows[at] = structuredClone(op.value);
                  else rows.push(structuredClone(op.value));
                }
                writes.push(op);
              }
              if (receipt) {
                const fullReceipt = { ...structuredClone(receipt), committedRevision: revision };
                assertRecord('receipts', fullReceipt);
                next.receipts.push(fullReceipt);
              }
              next.meta.revision = revision;
              assertSnapshot(next);
              for (const op of writes) {
                tx.objectStore(op.store)[op.mode](
                  op.value,
                  recordKey(op.store, generation, op.value as never),
                );
              }
              if (receipt)
                tx.objectStore('receipts').add(next.receipts.at(-1), [generation, receipt.eventId]);
              tx.objectStore('meta').put(next.meta, 'current');
              saved = { saved: true, revision, replayed: false };
            } catch (error) {
              fail(error);
            }
          },
          fail,
          this.factory,
          this.connection().version,
          this.initialization?.c6Activation
            ? c6ActivationIndex(this.initialization.c6Activation)
            : undefined,
        );
      });
      // A complete event is necessary but a clear could have committed before ACK.
      const current = await this.read();
      if (current.meta.generation !== generation) throw new StorageError('S_GENERATION_STALE');
      if (!probe && !result.replayed) {
        // Notifications are optional invalidation hints, never a commit dependency.
        this.broadcast(current.meta);
      }
      return result;
    } catch (error) {
      throw storageError(error);
    }
  }
}

function validInvalidation(value: unknown): boolean {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 2
  )
    return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Boolean(
    fields.generation &&
    fields.revision &&
    'value' in fields.generation &&
    'value' in fields.revision &&
    isUuid(fields.generation.value) &&
    isSafeUint(fields.revision.value),
  );
}
function rawGeneration(source: RawStorageRows['meta']): string | undefined {
  const index = source.keys.findIndex((key) => key === 'current');
  const candidate = source.values[index];
  if (!candidate || typeof candidate !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(candidate, 'generation');
  return descriptor && 'value' in descriptor && isUuid(descriptor.value)
    ? descriptor.value
    : undefined;
}

function sameRecord(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return (
    ka.length === kb.length &&
    ka.every(
      (key, index) =>
        key === kb[index] &&
        sameRecord((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

export async function openStorage(options: OpenStorageOptions): Promise<StorageClient> {
  let client: StorageClient | undefined;
  try {
    if (options.signal?.aborted) throw new StorageError('S_ABORTED');
    const index = options.c6Activation ? c6ActivationIndex(options.c6Activation) : null;
    if ((options.enablePython && !index) || (options.enableJava && !options.enablePython))
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const targetVersion = options.enableJava
      ? JAVA_DB_VERSION
      : index
        ? options.enablePython
          ? PYTHON_DB_VERSION
          : 10
        : DB_VERSION;
    const activePackageRef = { ...options.activePackageRef };
    if (activePackageRef.id === 'content.c.primer6' && !index)
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    if (
      index &&
      (activePackageRef.id !== index.packageRef.id ||
        activePackageRef.version !== index.packageRef.version)
    )
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new StorageError('S_STORAGE_UNAVAILABLE');
    let timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    let fallback = false;
    let createdNew = false;
    try {
      new Intl.DateTimeFormat('en', { timeZone }).format();
    } catch {
      timeZone = 'UTC';
      fallback = true;
    }
    const resetMeta = index
      ? createC6ResetMeta(crypto.randomUUID(), timeZone, new Date().toISOString())
      : null;
    const meta =
      resetMeta ??
      createMeta({
        generation: crypto.randomUUID(),
        timeZone,
        createdAt: new Date().toISOString(),
        activePackageRef,
      });
    assertRecord('meta', meta);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(options.name ?? DB_NAME, targetVersion);
      let stopped = false;
      let failure: unknown;
      const cancel = () => {
        stopped = true;
        request.transaction?.abort();
        reject(new StorageError('S_ABORTED'));
      };
      const cleanup = () => options.signal?.removeEventListener('abort', cancel);
      options.signal?.addEventListener('abort', cancel, { once: true });
      request.onblocked = () => {
        options.onBlocked?.();
        if (index) {
          // A later release of the blocking tab must not silently start a RESET
          // after this attempt has already reported failure. Retry is explicit.
          stopped = true;
          cleanup();
          reject(new StorageError('S_UPGRADE_BLOCKED'));
        }
      };
      request.onupgradeneeded = (event) => {
        try {
          if (stopped) {
            request.transaction!.abort();
            return;
          }
          if (resetMeta) {
            createdNew = event.oldVersion === 0;
            const db = request.result;
            const tx = request.transaction!;
            const afterC6 = (value: ReturnType<typeof createC6ResetMeta>) => {
              const python = queuePythonStores(db, tx, value);
              if (options.enableJava) queueJavaStores(db, tx, python);
            };
            if (
              (options.enablePython && event.oldVersion === 10) ||
              (options.enableJava && event.oldVersion === PYTHON_DB_VERSION)
            ) {
              const oldVersion = event.oldVersion;
              const names =
                oldVersion === 10 ? C6_RESET_STORES : [...C6_RESET_STORES, ...PYTHON_STORES];
              if (
                db.objectStoreNames.length !== names.length ||
                names.some((name) => {
                  if (!db.objectStoreNames.contains(name)) return true;
                  const store = tx.objectStore(name);
                  return store.keyPath !== null || store.autoIncrement || store.indexNames.length;
                })
              )
                throw new StorageError('S_MIGRATION_UNSUPPORTED');
              const fail = (error: unknown) => {
                failure = error;
                tx.abort();
              };
              readTransaction(
                tx,
                (snapshot) => {
                  try {
                    if (oldVersion === 10) {
                      assertC6Meta(snapshot.meta);
                      afterC6(snapshot.meta);
                    } else {
                      const meta = snapshot.meta;
                      assertPythonMeta(meta);
                      readPythonUpgradeRows(
                        tx,
                        factory,
                        snapshot,
                        () => queueJavaStores(db, tx, meta),
                        fail,
                      );
                    }
                  } catch (error) {
                    fail(error);
                  }
                },
                fail,
                factory,
                oldVersion,
                index!,
              );
              return;
            }
            queueC6ResetUpgrade(
              db,
              tx,
              event.oldVersion,
              resetMeta,
              (error) => {
                failure = error;
              },
              options.enablePython ? afterC6 : undefined,
            );
            return;
          }
          if (event.oldVersion === 1) {
            const db = request.result;
            const tx = request.transaction!;
            if (
              db.objectStoreNames.length !== CORE_STORE_NAMES.length ||
              CORE_STORE_NAMES.some((name) => !db.objectStoreNames.contains(name))
            )
              throw new StorageError('S_MIGRATION_UNSUPPORTED');
            const raw: Record<string, { keys: IDBValidKey[]; values: unknown[] }> = {};
            let remaining = CORE_STORE_NAMES.length * 2;
            const finish = () => {
              if (--remaining !== 0) return;
              try {
                const previous = Object.fromEntries(
                  CORE_STORE_NAMES.map((name) => [
                    name,
                    name === 'meta' || name === 'settings' || name === 'avatar'
                      ? raw[name].values[0]
                      : raw[name].values,
                  ]),
                );
                const upgraded = upgradeV1Snapshot(previous);
                for (const name of CORE_STORE_NAMES) {
                  const rows =
                    name === 'meta' || name === 'settings' || name === 'avatar'
                      ? [previous[name]]
                      : (previous[name] as unknown[]);
                  if (
                    rows.length !== raw[name].keys.length ||
                    (['meta', 'settings', 'avatar'].includes(name) &&
                      raw[name].values.length !== 1) ||
                    rows.some(
                      (row, index) =>
                        factory.cmp(
                          recordKey(name, upgraded.meta.generation, row as never),
                          raw[name].keys[index],
                        ) !== 0,
                    )
                  )
                    throw new StorageError('S_RECORD_INVALID');
                }
                db.createObjectStore('appearance');
                db.createObjectStore('appearanceAssets');
                db.createObjectStore('editHistory');
                db.createObjectStore('knowledgeMarks');
                db.createObjectStore('reviewCards');
                db.createObjectStore('achievements');
                tx.objectStore('appearance').add(upgraded.appearance, 'current');
                tx.objectStore('meta').put(upgraded.meta, 'current');
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
            for (const name of CORE_STORE_NAMES) {
              const store = tx.objectStore(name);
              if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
                throw new StorageError('S_MIGRATION_UNSUPPORTED');
              raw[name] = { keys: [], values: [] };
              const values = store.getAll();
              values.onsuccess = () => {
                raw[name].values = values.result;
                finish();
              };
              const keys = store.getAllKeys();
              keys.onsuccess = () => {
                raw[name].keys = keys.result;
                finish();
              };
            }
            db.createObjectStore('customDrafts');
            db.createObjectStore('weaknesses');
            return;
          }
          if (event.oldVersion === 2) {
            const db = request.result,
              tx = request.transaction!;
            if (
              db.objectStoreNames.length !== STORE_NAMES.length ||
              STORE_NAMES.some((name) => !db.objectStoreNames.contains(name))
            )
              throw new StorageError('S_MIGRATION_UNSUPPORTED');
            for (const name of STORE_NAMES) {
              const store = tx.objectStore(name);
              if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
                throw new StorageError('S_MIGRATION_UNSUPPORTED');
            }
            const values = tx.objectStore('meta').getAll();
            values.onsuccess = () => {
              try {
                for (const value of values.result) upgradeV2Meta(value); // Reject unknown future meta without deleting anything.
                const keys = tx.objectStore('meta').getAllKeys();
                keys.onsuccess = () => {
                  try {
                    const next =
                      values.result.length === 1 && keys.result[0] === 'current'
                        ? upgradeV2Meta(values.result[0])
                        : null;
                    db.createObjectStore('editHistory');
                    db.createObjectStore('knowledgeMarks');
                    db.createObjectStore('reviewCards');
                    db.createObjectStore('achievements');
                    if (next) tx.objectStore('meta').put(next, 'current');
                  } catch (error) {
                    failure = error;
                    tx.abort();
                  }
                };
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
            db.createObjectStore('customDrafts');
            db.createObjectStore('weaknesses');
            return;
          }
          if (event.oldVersion === 3) {
            const db = request.result,
              tx = request.transaction!;
            const prior = [...STORE_NAMES, 'editHistory'];
            if (
              db.objectStoreNames.length !== prior.length ||
              prior.some((name) => !db.objectStoreNames.contains(name))
            )
              throw new StorageError('S_MIGRATION_UNSUPPORTED');
            for (const name of prior) {
              const store = tx.objectStore(name);
              if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
                throw new StorageError('S_MIGRATION_UNSUPPORTED');
            }
            const values = tx.objectStore('meta').getAll();
            values.onsuccess = () => {
              try {
                for (const value of values.result) upgradeV3Meta(value);
                const keys = tx.objectStore('meta').getAllKeys();
                keys.onsuccess = () => {
                  try {
                    const next =
                      values.result.length === 1 && keys.result[0] === 'current'
                        ? upgradeV3Meta(values.result[0])
                        : null;
                    db.createObjectStore('knowledgeMarks');
                    db.createObjectStore('reviewCards');
                    db.createObjectStore('achievements');
                    if (next) tx.objectStore('meta').put(next, 'current');
                  } catch (error) {
                    failure = error;
                    tx.abort();
                  }
                };
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
            db.createObjectStore('customDrafts');
            db.createObjectStore('weaknesses');
            return;
          }
          if (event.oldVersion === 4) {
            const db = request.result,
              tx = request.transaction!;
            const prior = [...STORE_NAMES, 'editHistory', 'knowledgeMarks'];
            if (
              db.objectStoreNames.length !== prior.length ||
              prior.some((name) => !db.objectStoreNames.contains(name))
            )
              throw new StorageError('S_MIGRATION_UNSUPPORTED');
            for (const name of prior) {
              const store = tx.objectStore(name);
              if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
                throw new StorageError('S_MIGRATION_UNSUPPORTED');
            }
            const values = tx.objectStore('meta').getAll();
            values.onsuccess = () => {
              try {
                for (const value of values.result) upgradeV4Meta(value);
                const keys = tx.objectStore('meta').getAllKeys();
                keys.onsuccess = () => {
                  try {
                    const next =
                      values.result.length === 1 && keys.result[0] === 'current'
                        ? upgradeV4Meta(values.result[0])
                        : null;
                    db.createObjectStore('reviewCards');
                    db.createObjectStore('achievements');
                    if (next) tx.objectStore('meta').put(next, 'current');
                  } catch (error) {
                    failure = error;
                    tx.abort();
                  }
                };
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
            db.createObjectStore('customDrafts');
            db.createObjectStore('weaknesses');
            return;
          }
          if (event.oldVersion === 5) {
            const db = request.result,
              tx = request.transaction!;
            const prior = [...STORE_NAMES, 'editHistory', 'knowledgeMarks', 'reviewCards'];
            if (
              db.objectStoreNames.length !== prior.length ||
              prior.some((name) => !db.objectStoreNames.contains(name))
            )
              throw new StorageError('S_MIGRATION_UNSUPPORTED');
            for (const name of prior) {
              const store = tx.objectStore(name);
              if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
                throw new StorageError('S_MIGRATION_UNSUPPORTED');
            }
            const values = tx.objectStore('meta').getAll();
            values.onsuccess = () => {
              try {
                for (const value of values.result) upgradeV5Meta(value);
                const keys = tx.objectStore('meta').getAllKeys();
                keys.onsuccess = () => {
                  try {
                    const next =
                      values.result.length === 1 && keys.result[0] === 'current'
                        ? upgradeV5Meta(values.result[0])
                        : null;
                    db.createObjectStore('achievements');
                    if (next) tx.objectStore('meta').put(next, 'current');
                  } catch (error) {
                    failure = error;
                    tx.abort();
                  }
                };
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
            db.createObjectStore('customDrafts');
            db.createObjectStore('weaknesses');
            return;
          }
          if (event.oldVersion === 6) {
            const db = request.result,
              tx = request.transaction!;
            if (
              db.objectStoreNames.length !== V7_STORE_NAMES.length ||
              V7_STORE_NAMES.some((name) => !db.objectStoreNames.contains(name))
            )
              throw new StorageError('S_MIGRATION_UNSUPPORTED');
            for (const name of V7_STORE_NAMES) {
              const store = tx.objectStore(name);
              if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
                throw new StorageError('S_MIGRATION_UNSUPPORTED');
            }
            const values = tx.objectStore('meta').getAll();
            values.onsuccess = () => {
              try {
                for (const value of values.result) upgradeV6Meta(value);
                const keys = tx.objectStore('meta').getAllKeys();
                keys.onsuccess = () => {
                  try {
                    const next =
                      values.result.length === 1 && keys.result[0] === 'current'
                        ? upgradeV6Meta(values.result[0])
                        : null;
                    if (next) tx.objectStore('meta').put(next, 'current');
                  } catch (error) {
                    failure = error;
                    tx.abort();
                  }
                };
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
            db.createObjectStore('customDrafts');
            db.createObjectStore('weaknesses');
            return;
          }
          if (event.oldVersion === 7) {
            const db = request.result,
              tx = request.transaction!;
            if (
              db.objectStoreNames.length !== V7_STORE_NAMES.length ||
              V7_STORE_NAMES.some((name) => !db.objectStoreNames.contains(name))
            )
              throw new StorageError('S_MIGRATION_UNSUPPORTED');
            for (const name of V7_STORE_NAMES) {
              const store = tx.objectStore(name);
              if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
                throw new StorageError('S_MIGRATION_UNSUPPORTED');
            }
            const values = tx.objectStore('meta').getAll();
            values.onsuccess = () => {
              try {
                for (const value of values.result) upgradeV7Meta(value);
                const keys = tx.objectStore('meta').getAllKeys();
                keys.onsuccess = () => {
                  try {
                    const next =
                      values.result.length === 1 && keys.result[0] === 'current'
                        ? upgradeV7Meta(values.result[0])
                        : null;
                    if (next) tx.objectStore('meta').put(next, 'current');
                  } catch (error) {
                    failure = error;
                    tx.abort();
                  }
                };
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
            db.createObjectStore('customDrafts');
            db.createObjectStore('weaknesses');
            return;
          }
          if (event.oldVersion === 8) {
            const db = request.result,
              tx = request.transaction!;
            if (
              db.objectStoreNames.length !== V8_STORE_NAMES.length ||
              V8_STORE_NAMES.some((name) => !db.objectStoreNames.contains(name))
            )
              throw new StorageError('S_MIGRATION_UNSUPPORTED');
            for (const name of V8_STORE_NAMES) {
              const store = tx.objectStore(name);
              if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
                throw new StorageError('S_MIGRATION_UNSUPPORTED');
            }
            const values = tx.objectStore('meta').getAll(),
              keys = tx.objectStore('meta').getAllKeys();
            values.onsuccess = () => {
              try {
                for (const value of values.result) upgradeV8Meta(value);
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
            keys.onsuccess = () => {
              try {
                const next =
                  values.result.length === 1 && keys.result[0] === 'current'
                    ? upgradeV8Meta(values.result[0])
                    : null;
                if (next) tx.objectStore('meta').put(next, 'current');
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
            db.createObjectStore('weaknesses');
            return;
          }
          if (event.oldVersion !== 0) throw new StorageError('S_MIGRATION_UNSUPPORTED');
          createdNew = true;
          for (const name of ALL_STORE_NAMES) request.result.createObjectStore(name);
          const tx = request.transaction!;
          tx.objectStore('meta').add(meta, 'current');
          tx.objectStore('settings').add(defaultSettings(), 'current');
          tx.objectStore('avatar').add(defaultAvatar(), 'current');
          tx.objectStore('appearance').add(defaultAppearance(), 'current');
        } catch (error) {
          failure = error;
          request.transaction?.abort();
        }
      };
      request.onerror = () => {
        cleanup();
        reject(storageError(failure ?? request.error));
      };
      request.onsuccess = () => {
        cleanup();
        if (stopped) {
          request.result.close();
          return;
        }
        resolve(request.result);
      };
    });
    try {
      checkLayout(db);
    } catch (error) {
      db.close();
      throw error;
    }
    try {
      client = new StorageClient(db, fallback && createdNew, factory, {
        activePackageRef,
        timeZone: options.timeZone,
        c6Activation: options.c6Activation,
      });
    } catch (error) {
      db.close();
      throw error;
    }
    if (options.recovery) {
      const recovery = await client.readRecovery();
      if (
        (recovery.errorCode === 'S_VERSION_UNKNOWN' && !(index && recovery.courseReadOnly)) ||
        recovery.errorCode === 'S_MIGRATION_UNSUPPORTED'
      )
        throw new StorageError(recovery.errorCode);
      if (recovery.writable) await client.probe();
    } else await client.probe();
    if (options.signal?.aborted) throw new StorageError('S_ABORTED');
    return client;
  } catch (error) {
    client?.close();
    throw storageError(error);
  }
}
