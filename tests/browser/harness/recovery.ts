import { createLearningAuthority, type LearningEvent } from '../../../web/src/learning/authority';
import { LearningService } from '../../../web/src/learning/service';
import type { LearningCommand } from '../../../web/src/learning/types';
import { openStorage } from '../../../web/src/storage/client';
import { STORE_NAMES, type StoreName } from '../../../web/src/storage/model';
import { syntheticCatalog, syntheticIds, type LearningRawRows } from './learning';
import type { HarnessResult } from './storage';

/** Isolated fault/recovery checks. All learning facts remain synthetic /checks facts. */
const catalog = syntheticCatalog();
const nativeOpen = indexedDB.open.bind(indexedDB);
const nativeDelete = indexedDB.deleteDatabase.bind(indexedDB);
const nativePut = IDBObjectStore.prototype.put;
const nativeAdd = IDBObjectStore.prototype.add;
const NativeBroadcast = globalThis.BroadcastChannel;
let service: LearningService | undefined;
let authority = createLearningAuthority(catalog, () => true);
let databaseName = '';
let clock = '2026-10-15T02:00:00.000Z';
let selectedId: string | undefined;
let denyOpen = false;
let denyNotifications = false;
let fault: { kind: 'quota' | 'security' | 'abort'; store: StoreName } | undefined;
const commands = new Map<string, LearningCommand>();
const names = new Set<string>();
const jobs = new Map<string, Promise<unknown>>();
let holding: { active: boolean; done: Promise<void>; db: IDBDatabase } | undefined;
export interface RecoveryAudit {
  phase: 'request-success' | 'abort' | 'complete' | 'write-attempt';
  store?: string;
  theme?: string;
}
const audit: RecoveryAudit[] = [];

function checkedName(name: string) {
  if (!/^c-viz-learning\.test\.recovery\.[a-zA-Z0-9.-]+$/.test(name))
    throw new Error('Recovery harness only accesses its isolated test databases.');
  return name;
}
function connected() {
  if (!service) throw new Error('Recovery service not opened.');
  return service;
}
async function result<T>(run: () => Promise<T> | T): Promise<HarnessResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    const source = error as { code?: unknown; saved?: unknown; message?: unknown };
    return {
      ok: false,
      error: {
        code: typeof source.code === 'string' ? source.code : 'UNCLASSIFIED',
        saved: source.saved === true,
        message: typeof source.message === 'string' ? source.message : String(error),
      },
    };
  }
}
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () =>
      reject(transaction.error ?? new Error('Raw transaction aborted.')),
    );
  });
}
async function rawOpen(name = databaseName, version?: number) {
  checkedName(name);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = version === undefined ? nativeOpen(name) : nativeOpen(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

indexedDB.open = function (name, version) {
  if (denyOpen && name === databaseName)
    throw new DOMException('Isolated storage permission injection', 'SecurityError');
  return version === undefined ? nativeOpen(name) : nativeOpen(name, version);
};
if (NativeBroadcast) {
  globalThis.BroadcastChannel = new Proxy(NativeBroadcast, {
    construct(target, args) {
      if (denyNotifications)
        throw new DOMException('Isolated missed notification injection', 'SecurityError');
      return Reflect.construct(target, args);
    },
  });
}
function write(store: IDBObjectStore, value: unknown, execute: () => IDBRequest<IDBValidKey>) {
  if (store.transaction.db.name !== databaseName) return execute();
  const selected = fault?.store === store.name ? fault : undefined;
  if (selected) fault = undefined;
  audit.push({
    phase: 'write-attempt',
    store: store.name,
    ...(store.name === 'settings' && value && typeof value === 'object' && 'theme' in value
      ? { theme: String(value.theme) }
      : {}),
  });
  if (selected?.kind === 'quota' || selected?.kind === 'security')
    throw new DOMException(
      'Isolated native write API fault',
      selected.kind === 'quota' ? 'QuotaExceededError' : 'SecurityError',
    );
  const request = execute();
  request.addEventListener('success', () => {
    audit.push({ phase: 'request-success', store: store.name });
    if (selected?.kind === 'abort') {
      store.transaction.addEventListener('abort', () =>
        audit.push({ phase: 'abort', store: store.name }),
      );
      store.transaction.abort();
    }
  });
  return request;
}
IDBObjectStore.prototype.put = function (value, key) {
  return write(this, value, () =>
    key === undefined ? nativePut.call(this, value) : nativePut.call(this, value, key),
  );
};
IDBObjectStore.prototype.add = function (value, key) {
  return write(this, value, () =>
    key === undefined ? nativeAdd.call(this, value) : nativeAdd.call(this, value, key),
  );
};

function event(type: LearningEvent['eventType'], id: string): LearningEvent {
  const entity = [...catalog.lessons, ...catalog.exercises, ...catalog.cases].find(
    (row) => row.ref.id === id,
  );
  return {
    eventContractVersion: '1.0.0',
    eventType: type,
    subjectRef: entity?.ref ?? { id, version: '1.0.0' },
    packageRef: catalog.packageRef,
    learningRevision: 1,
    result:
      type === 'exercise.passed' ? 'passed' : type === 'lesson.started' ? 'started' : 'confirmed',
  } as LearningEvent;
}
async function start(name: string) {
  service?.dispose();
  databaseName = checkedName(name);
  names.add(name);
  authority = createLearningAuthority(catalog, () => true);
  service = new LearningService({
    catalog,
    openStorage: () =>
      openStorage({
        name,
        recovery: true,
        activePackageRef: catalog.packageRef,
        timeZone: 'Asia/Shanghai',
      }),
    clock: () => clock,
    id: () => {
      const id = selectedId ?? crypto.randomUUID();
      selectedId = undefined;
      return id;
    },
  });
  await service.start();
  return service.getState();
}

export const recoveryHarness = {
  audit,
  open: start,
  async refresh() {
    await connected().refresh();
    return connected().getState();
  },
  state() {
    return connected().getState();
  },
  notifications(enabled: boolean) {
    denyNotifications = !enabled;
  },
  denyOpen(denied: boolean) {
    denyOpen = denied;
  },
  fault(kind: 'quota' | 'security' | 'abort', store: StoreName = 'receipts') {
    fault = { kind, store };
  },
  clearFault() {
    fault = undefined;
  },
  clock(at: string) {
    clock = at;
  },
  async capture(type: LearningEvent['eventType'], id: string, eventId = crypto.randomUUID()) {
    return result(async () => {
      selectedId = eventId;
      const command = await connected().capture(authority.issue(event(type, id)));
      commands.set(eventId, command);
      return structuredClone(command);
    });
  },
  commit(eventId: string) {
    return result(() => {
      const command = commands.get(eventId);
      if (!command) throw new Error('Captured command missing.');
      return connected().commitCommand(command);
    });
  },
  async learn(type: LearningEvent['eventType'], id: string, eventId = crypto.randomUUID()) {
    const captured = await recoveryHarness.capture(type, id, eventId);
    if (!captured.ok) return captured;
    return recoveryHarness.commit(eventId);
  },
  async seedStudy() {
    await connected().saveDisplay(
      { theme: 'dark', reducedMotion: 'on', playbackRate: 1.5 },
      connected().getState().snapshot!.meta.revision,
    );
    await connected().saveAvatar(
      { presetId: 'avatar.basic.01', accentColor: '#A246C8' },
      connected().getState().snapshot!.meta.revision,
    );
    await connected().saveGoalTemplate(
      { exercise: 2, lesson: 1, case: 1 },
      connected().getState().snapshot!.meta.revision,
    );
    for (const [type, id] of [
      ['lesson.study-confirmed', syntheticIds.lesson],
      ['exercise.passed', syntheticIds.first],
      ['exercise.passed', syntheticIds.second],
      ['case.view-confirmed', syntheticIds.case],
    ] as const) {
      const answer = await recoveryHarness.learn(type, id);
      if (!answer.ok) throw new Error(answer.error.message);
    }
    return connected().getState();
  },
  async saveDisplay(theme: 'light' | 'dark' | 'system') {
    const active = connected();
    await active.saveDisplay(
      { theme, reducedMotion: 'off', playbackRate: 2 },
      active.getState().snapshot!.meta.revision,
    );
    return active.getState();
  },
  async clear() {
    await connected().clearLocalData();
    return connected().getState();
  },
  async reset(store: 'settings' | 'avatar') {
    await connected().resetLocalPreference(store);
    return connected().getState();
  },
  async retry() {
    await connected().retryPending();
    return connected().getState();
  },
  startCommit(eventId: string) {
    const id = crypto.randomUUID();
    jobs.set(id, recoveryHarness.commit(eventId));
    return id;
  },
  startSave(theme: 'light' | 'dark' | 'system') {
    const id = crypto.randomUUID();
    jobs.set(id, recoveryHarness.saveDisplay(theme));
    return id;
  },
  startClear() {
    const id = crypto.randomUUID();
    jobs.set(id, recoveryHarness.clear());
    return id;
  },
  waitJob(id: string) {
    const job = jobs.get(id);
    if (!job) throw new Error('Recovery job missing.');
    return job;
  },
  async rawDump(): Promise<{ version: number; rows: LearningRawRows }> {
    const db = await rawOpen();
    try {
      const transaction = db.transaction(Array.from(db.objectStoreNames), 'readonly');
      const done = complete(transaction);
      const rows: LearningRawRows = Object.fromEntries(
        await Promise.all(
          Array.from(db.objectStoreNames).map(async (name) => {
            const store = transaction.objectStore(name);
            const values = await new Promise<unknown[]>((resolve, reject) => {
              const request = store.getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
              const request = store.getAllKeys();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return [name, values.map((value, index) => ({ key: keys[index]!, value }))];
          }),
        ),
      );
      await done;
      return { version: db.version, rows };
    } finally {
      db.close();
    }
  },
  async corrupt(store: StoreName, kind: 'invalid' | 'missing' | 'future' = 'invalid') {
    const db = await rawOpen();
    try {
      const transaction = db.transaction(store, 'readwrite');
      const done = complete(transaction);
      const selected = transaction.objectStore(store);
      const cursor = selected.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) throw new Error('A row is required before corruption.');
        if (kind === 'missing') cursor.result.delete();
        else {
          const row = cursor.result.value as Record<string, unknown>;
          cursor.result.update({
            ...row,
            ...(store === 'settings'
              ? { theme: 'ultraviolet' }
              : store === 'avatar'
                ? { accentColor: 'broken' }
                : store === 'meta'
                  ? kind === 'future'
                    ? { schemaVersion: '10.0.0' }
                    : { generation: '' }
                  : store === 'ledger'
                    ? { points: -1 }
                    : store === 'receipts'
                      ? { committedRevision: -1 }
                      : { learningRevision: 0 }),
          });
        }
      };
      await done;
    } finally {
      db.close();
    }
  },
  async futurePhysical() {
    const db = await rawOpen(databaseName, 10);
    db.close();
  },
  async hold() {
    if (holding) throw new Error('A native transaction is already held.');
    const db = await rawOpen();
    const transaction = db.transaction(STORE_NAMES, 'readwrite');
    const holder = { active: true, db, done: complete(transaction) };
    holding = holder;
    let first = true;
    await new Promise<void>((resolve, reject) => {
      const requestNext = () => {
        const request = transaction.objectStore('meta').get('current');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          if (first) {
            first = false;
            resolve();
          }
          if (holder.active) requestNext();
        };
      };
      requestNext();
    });
    return true;
  },
  async release() {
    const holder = holding;
    if (!holder) return;
    holder.active = false;
    await holder.done;
    holder.db.close();
    holding = undefined;
  },
  async close() {
    await recoveryHarness.release();
    service?.dispose();
    service = undefined;
  },
  async dispose() {
    await recoveryHarness.close();
    fault = undefined;
    denyOpen = false;
    commands.clear();
    jobs.clear();
    for (const name of names)
      await new Promise<void>((resolve, reject) => {
        const request = nativeDelete(checkedName(name));
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Recovery test database disposal blocked.'));
      });
    names.clear();
  },
};
declare global {
  interface Window {
    recoveryHarness: typeof recoveryHarness;
  }
}
window.recoveryHarness = recoveryHarness;
window.addEventListener('pagehide', () => {
  if (holding) holding.active = false;
  service?.dispose();
});
