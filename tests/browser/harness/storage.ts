import {
  openStorage,
  type StorageClient,
  type StorageMutation,
  type ReceiptSummary,
} from '../../../web/src/storage/client';
import { migrateReferenceDatabase } from '../../../web/src/storage/reference-migration';
import { CORE_STORE_NAMES, type StorageSnapshot } from '../../../web/src/storage/model';

/** Isolated infrastructure checks; these synthetic facts are never product learning events. */
const packageRef = { id: 'content.c.p0', version: '1.0.0' };
const subjectRef = { id: 'exercise.c.echo', version: '1.0.0' };
const occurredAt = '2026-10-15T02:00:00.000Z';
const localDate = '2026-10-15';

export interface HarnessError {
  code: string;
  saved: boolean;
  message: string;
}
export type HarnessResult<T> = { ok: true; value: T } | { ok: false; error: HarnessError };
export interface StorageAudit {
  opens: string[];
  localStorageWrites: number;
  events: { phase: string; transaction: number; store?: string; mode?: string; scope?: string[] }[];
}
export interface RawStore {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  rows: { key: IDBValidKey; value: unknown }[];
}
export interface RawDump {
  version: number;
  stores: RawStore[];
}
type ReceiptInput = Extract<ReceiptSummary, { eventType: 'exercise.passed' }>;
type Fault = 'quota' | 'abort-after-success';
let client: StorageClient | undefined;
let databaseName = '';
let fault: { kind: Fault; store: string } | undefined;
let transactionSequence = 0;
let blocker: IDBDatabase | undefined;
let pendingDelete: Promise<void> | undefined;
let pendingOpen: Promise<HarnessResult<StorageSnapshot>> | undefined;
let cancellation: AbortController | undefined;

const audit: StorageAudit = { opens: [], localStorageWrites: 0, events: [] };
const nativeOpen = indexedDB.open.bind(indexedDB);
const nativeDelete = indexedDB.deleteDatabase.bind(indexedDB);
const nativeTransaction = IDBDatabase.prototype.transaction;
const nativeAdd = IDBObjectStore.prototype.add;
const nativePut = IDBObjectStore.prototype.put;
const transactionIds = new WeakMap<IDBTransaction, number>();

indexedDB.open = (name: string, version?: number) => {
  audit.opens.push(name);
  return nativeOpen(name, version);
};
const nativeSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key: string, value: string) {
  audit.localStorageWrites += 1;
  nativeSetItem.call(this, key, value);
};
IDBDatabase.prototype.transaction = function (names, mode, options) {
  const transaction = nativeTransaction.call(this, names, mode, options);
  const id = ++transactionSequence;
  transactionIds.set(transaction, id);
  audit.events.push({
    phase: 'transaction',
    transaction: id,
    mode: transaction.mode,
    scope: Array.from(transaction.objectStoreNames),
  });
  transaction.addEventListener('complete', () =>
    audit.events.push({ phase: 'complete', transaction: id }),
  );
  transaction.addEventListener('abort', () =>
    audit.events.push({ phase: 'abort', transaction: id }),
  );
  return transaction;
};

function observeWrite(store: IDBObjectStore, run: () => IDBRequest<IDBValidKey>) {
  const selected = fault?.store === store.name ? fault : undefined;
  if (selected) fault = undefined;
  if (selected?.kind === 'quota') {
    // API fault injection, not an actual physical-disk or browser-quota exhaustion claim.
    throw new DOMException('Isolated quota failure injection', 'QuotaExceededError');
  }
  const request = run();
  request.addEventListener('success', () => {
    audit.events.push({
      phase: 'request-success',
      transaction: transactionIds.get(store.transaction) ?? 0,
      store: store.name,
    });
    if (selected?.kind === 'abort-after-success') store.transaction.abort();
  });
  return request;
}
IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
  return observeWrite(this, () =>
    key === undefined ? nativeAdd.call(this, value) : nativeAdd.call(this, value, key),
  );
};
IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
  return observeWrite(this, () =>
    key === undefined ? nativePut.call(this, value) : nativePut.call(this, value, key),
  );
};

async function result<T>(run: () => Promise<T>): Promise<HarnessResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    const value = error as { code?: unknown; saved?: unknown; message?: unknown };
    return {
      ok: false,
      error: {
        code: typeof value.code === 'string' ? value.code : 'UNCLASSIFIED',
        saved: value.saved === true,
        message: typeof value.message === 'string' ? value.message : String(error),
      },
    };
  }
}

function checkedName(name: string) {
  if (!/^c-viz-learning\.(?:test|reference)\.[a-zA-Z0-9.-]+$/.test(name)) {
    throw new Error('Harness only accesses its isolated test/reference databases.');
  }
  return name;
}

function rawOpen(name: string, version?: number, initialize?: (db: IDBDatabase) => void) {
  checkedName(name);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = nativeOpen(name, version);
    request.onupgradeneeded = () => initialize?.(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () =>
      reject(transaction.error ?? new Error('Raw fixture transaction aborted')),
    );
    transaction.addEventListener('error', () =>
      reject(transaction.error ?? new Error('Raw fixture transaction failed')),
    );
  });
}

async function rawDump(name = databaseName): Promise<RawDump> {
  const db = await rawOpen(name);
  try {
    const names = Array.from(db.objectStoreNames);
    const transaction = db.transaction(names, 'readonly');
    const done = complete(transaction);
    const stores = await Promise.all(
      names.map((name) => {
        const store = transaction.objectStore(name);
        return new Promise<RawStore>((resolve, reject) => {
          const rows: RawStore['rows'] = [];
          const cursor = store.openCursor();
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            if (cursor.result) {
              rows.push({ key: cursor.result.key, value: cursor.result.value });
              cursor.result.continue();
            } else
              resolve({ name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, rows });
          };
        });
      }),
    );
    await done;
    return { version: db.version, stores };
  } finally {
    db.close();
  }
}

function receipt(eventId: string, overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    eventId,
    eventType: 'exercise.passed',
    result: 'passed',
    subjectRef,
    packageRef,
    learningRevision: 1,
    goalVersion: 1,
    occurredAt,
    localDate,
    ...overrides,
  };
}

function eventMutations(snapshot: StorageSnapshot): StorageMutation[] {
  const changes: StorageMutation[] = [];
  if (!snapshot.goals.some((row) => row.localDate === localDate)) {
    changes.push({
      store: 'goals',
      mode: 'add',
      value: { localDate, goalVersion: 1, targets: null, achievedAt: null },
    });
  }
  if (
    !snapshot.progress.some(
      (row) => row.eventType === 'exercise.passed' && row.subjectRef.id === subjectRef.id,
    )
  ) {
    changes.push({
      store: 'progress',
      mode: 'add',
      value: {
        eventType: 'exercise.passed',
        result: 'passed',
        subjectRef,
        packageRef,
        learningRevision: 1,
        firstAt: occurredAt,
        lastAt: occurredAt,
      },
    });
  }
  if (
    !snapshot.dailyFacts.some(
      (row) => row.eventType === 'exercise.passed' && row.canonicalSubjectId === subjectRef.id,
    )
  ) {
    changes.push({
      store: 'dailyFacts',
      mode: 'add',
      value: {
        eventType: 'exercise.passed',
        subjectRef,
        canonicalSubjectId: subjectRef.id,
        occurredAt,
        localDate,
      },
    });
  }
  changes.push({
    store: 'ledger',
    mode: 'add',
    value: {
      sourceId: 'reward.exercise.first-pass',
      subjectId: subjectRef.id,
      localDate,
      occurredAt,
      status: 'pending',
      points: null,
      policyRef: null,
    },
  });
  return changes;
}

export const storageHarness = {
  audit,
  async open(name: string) {
    checkedName(name);
    client?.close();
    databaseName = name;
    return result(async () => {
      client = await openStorage({ name, activePackageRef: packageRef, timeZone: 'Asia/Shanghai' });
      return client.read();
    });
  },
  read() {
    return result(() => {
      if (!client) throw new Error('Client not opened');
      return client.read();
    });
  },
  probe() {
    return result(() => {
      if (!client) throw new Error('Client not opened');
      return client.probe();
    });
  },
  close() {
    client?.close();
    client = undefined;
  },
  rawDump,
  async commitEvent(
    eventId: string,
    overrides: Partial<ReceiptInput> = {},
    inject?: Fault,
    generation?: string,
  ) {
    return result(async () => {
      if (!client) throw new Error('Client not opened');
      const snapshot = await client.read();
      if (inject) fault = { kind: inject, store: inject === 'quota' ? 'ledger' : 'receipts' };
      try {
        const saved = await client.commitOnce(
          {
            generation: generation ?? snapshot.meta.generation,
            receipt: receipt(eventId, overrides),
          },
          eventMutations,
        );
        audit.events.push({ phase: 'saved-result', transaction: 0 });
        return saved;
      } finally {
        fault = undefined;
      }
    });
  },
  async patchMeta(patch: object) {
    const db = await rawOpen(databaseName);
    try {
      const transaction = db.transaction('meta', 'readwrite');
      const done = complete(transaction);
      const store = transaction.objectStore('meta');
      const read = store.get('current');
      read.onsuccess = () => store.put({ ...read.result, ...patch }, 'current');
      await done;
    } finally {
      db.close();
    }
  },
  async removeMeta() {
    const db = await rawOpen(databaseName);
    try {
      const transaction = db.transaction('meta', 'readwrite');
      const done = complete(transaction);
      transaction.objectStore('meta').delete('current');
      await done;
    } finally {
      db.close();
    }
  },
  async unavailable(name: string) {
    checkedName(name);
    const factory = new Proxy(indexedDB, {
      get(target, property) {
        if (property === 'open')
          return () => {
            throw new DOMException('Isolated storage disabled injection', 'SecurityError');
          };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return result(async () => {
      const unavailable = await openStorage({ name, factory, activePackageRef: packageRef });
      try {
        return await unavailable.probe();
      } finally {
        unavailable.close();
      }
    });
  },
  async futureVersion() {
    const db = await rawOpen(databaseName, 4);
    db.close();
  },
  async beginBlockedCancellation() {
    client?.close();
    client = undefined;
    blocker = await rawOpen(databaseName);
    const request = nativeDelete(databaseName);
    pendingDelete = new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve) => {
      request.onblocked = () => resolve();
    });
    cancellation = new AbortController();
    pendingOpen = result(async () => {
      const opened = await openStorage({
        name: databaseName,
        activePackageRef: packageRef,
        signal: cancellation?.signal,
      });
      try {
        return await opened.read();
      } finally {
        opened.close();
      }
    });
    return { blocked: true };
  },
  async cancelBlocked() {
    cancellation?.abort();
    if (!pendingOpen) throw new Error('Blocked open not started');
    return pendingOpen;
  },
  async releaseBlocked() {
    blocker?.close();
    blocker = undefined;
    await pendingDelete;
    // A second request waits behind any cancelled-but-late open, without a sleep.
    const request = nativeDelete(databaseName);
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Cancelled open leaked a live DB connection'));
    });
    return { released: true };
  },
  async seedReference(name: string, legacy: unknown) {
    if (!name.startsWith('c-viz-learning.reference.')) throw new Error('Reference name required');
    client?.close();
    client = undefined;
    databaseName = checkedName(name);
    const db = await rawOpen(name, 1, (opened) => {
      for (const store of CORE_STORE_NAMES) opened.createObjectStore(store);
    });
    try {
      const transaction = db.transaction(Array.from(CORE_STORE_NAMES), 'readwrite');
      const done = complete(transaction);
      transaction.objectStore('meta').put(legacy, 'current');
      await done;
    } finally {
      db.close();
    }
    return rawDump(name);
  },
  async migrate(inject?: Fault) {
    if (inject) fault = { kind: inject, store: 'progress' };
    try {
      return await result(() => migrateReferenceDatabase(indexedDB, databaseName));
    } finally {
      fault = undefined;
    }
  },
  async runSmoke(name: string, legacy?: unknown) {
    function successful<T>(answer: HarnessResult<T>): T {
      if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
      return answer.value;
    }
    const initial = successful(await storageHarness.open(name));
    const eventId = crypto.randomUUID();
    const first = successful(await storageHarness.commitEvent(eventId));
    const replay = successful(await storageHarness.commitEvent(eventId));
    successful(await storageHarness.commitEvent(crypto.randomUUID()));
    const before = successful(await storageHarness.read());
    const rejected = await storageHarness.commitEvent(eventId, { goalVersion: 2 });
    storageHarness.close();
    const reopened = successful(await storageHarness.open(name));
    const probe = successful(await storageHarness.probe());
    const scopes = audit.events
      .filter((event) => event.phase === 'transaction' && event.mode === 'readwrite')
      .map((event) => event.scope);
    let migration:
      | {
          preservedGeneration: boolean;
          progress: number;
          ledger: number;
          facts: number;
          receipts: number;
        }
      | undefined;
    await storageHarness.dispose();
    if (legacy !== undefined) {
      const referenceName = `c-viz-learning.reference.${crypto.randomUUID()}`;
      await storageHarness.seedReference(referenceName, legacy);
      const migrated = successful(await storageHarness.migrate());
      const source = legacy as { generation?: unknown };
      migration = {
        preservedGeneration: migrated.meta.generation === source.generation,
        progress: migrated.progress.length,
        ledger: migrated.ledger.length,
        facts: migrated.dailyFacts.length,
        receipts: migrated.receipts.length,
      };
      await storageHarness.dispose();
    }
    return {
      evidenceKind: 'synthetic native IndexedDB infrastructure; not real learning',
      defaultSettings: initial.settings,
      defaultAvatar: initial.avatar,
      first,
      replay,
      rejectCode: rejected.ok ? null : rejected.error.code,
      receipts: reopened.receipts.length,
      rewards: reopened.ledger.length,
      reopenedEqual: JSON.stringify(before) === JSON.stringify(reopened),
      available: probe.available,
      localStorageWrites: audit.localStorageWrites,
      scopes,
      migration,
    };
  },
  async dispose() {
    client?.close();
    client = undefined;
    blocker?.close();
    blocker = undefined;
    if (!databaseName) return;
    const request = nativeDelete(checkedName(databaseName));
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Test database disposal was blocked'));
    });
  },
};

declare global {
  interface Window {
    storageHarness: typeof storageHarness;
  }
}
window.storageHarness = storageHarness;
window.addEventListener('pagehide', () => {
  client?.close();
  blocker?.close();
});
