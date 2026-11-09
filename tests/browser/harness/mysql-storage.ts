import {
  openStorage,
  type StorageClient,
  type StorageMutation,
} from '../../../web/src/storage/client';
import { C6_RESET_STORES, createC6ResetMeta } from '../../../web/src/storage/c6-reset';
import { PYTHON_STORES, toPythonMeta } from '../../../web/src/storage/python3-meta';
import { JAVA_STORES, toJavaMeta } from '../../../web/src/storage/java-meta';
import { CPP_STORES, toCppMeta } from '../../../web/src/storage/cpp-course-meta';
import { RUST_STORES, toRustMeta } from '../../../web/src/storage/rust2018-meta';
import {
  defaultAppearance,
  defaultAvatar,
  defaultSettings,
  emptySnapshot,
  recordKey,
  type Meta,
  type StorageSnapshot,
} from '../../../web/src/storage/model';
import { createC6StorageActivation } from '../../../web/src/storage/c6-activation';
import { createC6TeachingRepository } from '../../../web/src/content/c6-teaching-repository';
import { loadC6LearningIndex } from '../../../web/src/c6-learning';
import {
  applyPythonLearningEvent,
  applyJavaLearningEvent,
  applyCppLearningEvent,
  applyRustLearningEvent,
} from '../../../web/src/learning/domain';
import { pythonLessonIds } from '../../../web/src/python3/release.generated';
import { javaLessonIds } from '../../../web/src/java/release.generated';
import { cppLessonIds } from '../../../web/src/cpp-course/release.generated';
import { rust2018LessonIds } from '../../../web/src/rust2018-course/release.generated';
import type { LearningCommand } from '../../../web/src/learning/types';
import {
  assertMysqlDraftInput,
  type MysqlDraftInput,
  type MysqlCourseRecipe,
} from '../../../web/src/storage/mysql-course';
import { canonicalMysqlJson, defaultMysqlSession } from '../../../web/src/engine/mysql-data';
import { MysqlClient } from '../../../web/src/engine/mysql-client';
import { StorageError } from '../../../web/src/storage/errors';
import { MysqlPlayer } from '../../../web/src/engine/mysql-player';

// Every database name is supplied by the test and must be in this isolated namespace.
const namespace = 'c-viz-learning.test.mysql-storage.';
const at = '2026-11-09T02:00:00.000Z';
const clients = new Map<string, StorageClient>();
const blockers = new Map<string, IDBDatabase>();
const invalidations = new Map<string, number>();
const nativePut = IDBObjectStore.prototype.put;
const nativeCreate = IDBDatabase.prototype.createObjectStore;
let fault: 'quota' | 'abort-after-success' | 'upgrade-create' | 'upgrade-meta' | undefined;
IDBObjectStore.prototype.put = function (value, key) {
  if (
    fault === 'upgrade-meta' &&
    this.name === 'meta' &&
    this.transaction.mode === 'versionchange'
  ) {
    fault = undefined;
    throw new DOMException('Isolated upgrade fault', 'QuotaExceededError');
  }
  const selected = this.name === 'mysqlDrafts' ? fault : undefined;
  if (selected === 'quota') {
    fault = undefined;
    throw new DOMException('Isolated write fault', 'QuotaExceededError');
  }
  const request = nativePut.call(this, value, key!);
  if (selected === 'abort-after-success') {
    fault = undefined;
    request.addEventListener('success', () => this.transaction.abort(), { once: true });
  }
  return request;
};
IDBDatabase.prototype.createObjectStore = function (name, options) {
  if (fault === 'upgrade-create' && name === 'mysqlDrafts') {
    fault = undefined;
    throw new DOMException('Isolated second-store failure', 'UnknownError');
  }
  return nativeCreate.call(this, name, options);
};
function checkedName(name: string) {
  if (!name.startsWith(namespace)) throw new Error('Isolated database namespace required');
  return name;
}
async function db(
  name: string,
  version?: number,
  upgrade?: (db: IDBDatabase, tx: IDBTransaction) => void,
) {
  checkedName(name);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade?.(request.result, request.transaction!);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function complete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Aborted'));
  });
}
async function activation() {
  const manifest = await createC6TeachingRepository().loadManifest();
  const index = await loadC6LearningIndex(manifest);
  return { index, token: createC6StorageActivation(index) };
}
function apply(snapshot: StorageSnapshot, operations: StorageMutation[]) {
  for (const op of operations) {
    const rows = snapshot[op.store] as unknown[];
    const key = JSON.stringify(recordKey(op.store, snapshot.meta.generation, op.value as never));
    const index = rows.findIndex(
      (row) => JSON.stringify(recordKey(op.store, snapshot.meta.generation, row as never)) === key,
    );
    if (index < 0) rows.push(op.value);
    else rows[index] = op.value;
  }
}
async function seed(
  name: string,
  version = 14,
  corrupt?: { store: string; kind: 'row' | 'key' | 'index' | 'extra-store' | 'meta' },
) {
  const { index } = await activation();
  let meta: Meta = createC6ResetMeta(crypto.randomUUID(), 'UTC', at);
  if (version >= 11 && meta.dbVersion === 10) meta = toPythonMeta(meta);
  if (version >= 12 && meta.dbVersion === 11) meta = toJavaMeta(meta);
  if (version >= 13 && meta.dbVersion === 12) meta = toCppMeta(meta);
  if (version >= 14 && meta.dbVersion === 13) meta = toRustMeta(meta);
  meta.revision = 7;
  const snapshot = emptySnapshot(meta);
  snapshot.goals.push({ localDate: '2026-11-09', goalVersion: 1, targets: null, achievedAt: null });
  const languageRows: Record<string, { activities: unknown[]; drafts: unknown[] }> = {};
  const languages = [
    ['python', 11, pythonLessonIds[0], 'content.python.runoob3', applyPythonLearningEvent],
    ['java', 12, javaLessonIds[0], 'content.java.runoob', applyJavaLearningEvent],
    ['cpp', 13, cppLessonIds[0], 'content.cpp.book', applyCppLearningEvent],
    ['rust', 14, rust2018LessonIds[0], 'content.rust2018.book', applyRustLearningEvent],
  ] as const;
  for (const [language, minimum, lesson, packageId, transition] of languages) {
    if (version < minimum) continue;
    const receipt: LearningCommand['receipt'] = {
      eventId: crypto.randomUUID(),
      eventType: 'lesson.study-confirmed',
      result: 'confirmed',
      subjectRef: { id: lesson, version: '1.0.0' },
      packageRef: { id: packageId, version: '1.0.0' },
      learningRevision: 1,
      occurredAt: at,
      localDate: '2026-11-09',
      goalVersion: 1,
    };
    apply(snapshot, transition(snapshot, { generation: meta.generation, receipt }));
    snapshot.meta.revision++;
    snapshot.receipts.push({ ...receipt, committedRevision: snapshot.meta.revision });
    const draftVersion = language === 'python' ? '2.1.0' : '2.2.0';
    languageRows[language] = {
      activities: [
        {
          activityVersion: draftVersion,
          generation: meta.generation,
          subjectRef: receipt.subjectRef,
          revision: snapshot.meta.revision,
          kind: 'lesson',
          readAt: at,
          completedAt: at,
        },
      ],
      drafts: [
        {
          draftVersion,
          generation: meta.generation,
          documentId: language === 'python' ? 'py3.document.free' : `${language}.document.free`,
          revision: snapshot.meta.revision,
          updatedAt: at,
          source: `saved-${language}`,
        },
      ],
    };
  }
  const names = [
    ...C6_RESET_STORES,
    ...(version >= 11 ? PYTHON_STORES : []),
    ...(version >= 12 ? JAVA_STORES : []),
    ...(version >= 13 ? CPP_STORES : []),
    ...(version >= 14 ? RUST_STORES : []),
  ];
  const database = await db(name, version, (database) => {
    for (const name of names) {
      const store = database.createObjectStore(name);
      if (corrupt?.kind === 'index' && corrupt.store === name)
        store.createIndex('unexpected', 'source');
    }
    if (corrupt?.kind === 'extra-store') database.createObjectStore('unknownStore');
  });
  const tx = database.transaction(names, 'readwrite');
  const done = complete(tx);
  const put = (store: string, key: IDBValidKey, value: unknown) =>
    tx.objectStore(store).put(value, key);
  put(
    'meta',
    'current',
    corrupt?.kind === 'meta' ? { ...snapshot.meta, schemaVersion: '99.0.0' } : snapshot.meta,
  );
  put('settings', 'current', defaultSettings());
  put('avatar', 'current', defaultAvatar());
  put('appearance', 'current', defaultAppearance());
  for (const store of ['progress', 'receipts', 'dailyFacts', 'goals', 'ledger', 'aliases'] as const)
    for (const row of snapshot[store])
      put(store, recordKey(store, meta.generation, row as never), row);
  // Blob construction is synchronous; native byte hashing occurs only after the IDB transaction.
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ),
    (c) => c.charCodeAt(0),
  );
  put('appearanceAssets', [meta.generation, 'background'], {
    assetId: 'background',
    mimeType: 'image/png',
    byteLength: png.length,
    width: 1,
    height: 1,
    blob: new Blob([png], { type: 'image/png' }),
  });
  const c6Draft = {
    draftVersion: '2.0.0',
    generation: meta.generation,
    documentId: 'c6.predecessor',
    nodeRef: { id: index.lessons[0][1], version: '2.0.0' },
    exerciseRef: null,
    sourceRevision: 'old-c-source',
    source: 'int main(){return 0;}',
    input: '',
    revision: 1,
    updatedAt: at,
  };
  put('courseDrafts', [meta.generation, c6Draft.documentId], c6Draft);
  for (const [language, rows] of Object.entries(languageRows)) {
    for (const [suffix, values] of Object.entries(rows))
      for (const raw of values) {
        const row = raw as { subjectRef?: { id: string }; documentId?: string };
        const store = `${language}${suffix === 'activities' ? 'Activities' : 'Drafts'}`;
        const value =
          corrupt?.kind === 'row' && corrupt.store === store ? { ...row, invalid: true } : row;
        const key = [
          meta.generation,
          corrupt?.kind === 'key' && corrupt.store === store
            ? 'wrong-native-key'
            : (row.subjectRef?.id ?? row.documentId)!,
        ];
        put(store, key, value);
      }
  }
  if (corrupt?.kind === 'row' && corrupt.store === 'courseDrafts')
    put('courseDrafts', [meta.generation, c6Draft.documentId], {
      ...c6Draft,
      sourceRevision: null,
    });
  if (corrupt?.kind === 'key' && corrupt.store === 'courseDrafts') {
    tx.objectStore('courseDrafts').delete([meta.generation, c6Draft.documentId]);
    put('courseDrafts', [meta.generation, 'wrong-native-key'], c6Draft);
  }
  await done;
  database.close();
  return dump(name);
}
async function normalize(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const digest = await crypto.subtle.digest('SHA-256', await value.arrayBuffer());
    return {
      blob: true,
      type: value.type,
      size: value.size,
      sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    };
  }
  if (Array.isArray(value)) return Promise.all(value.map(normalize));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [key, await normalize(item)]),
      ),
    );
  return value;
}
async function dump(name: string) {
  const database = await db(name);
  const version = database.version;
  const names = [...database.objectStoreNames];
  const tx = database.transaction(names, 'readonly');
  const done = complete(tx);
  const rows = names.map((name) => {
    const store = tx.objectStore(name),
      keys = store.getAllKeys(),
      values = store.getAll();
    return {
      name,
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      indexes: [...store.indexNames],
      keys,
      values,
    };
  });
  await done;
  database.close();
  return {
    version,
    stores: await Promise.all(
      rows.map(async (row) => ({
        name: row.name,
        keyPath: row.keyPath,
        autoIncrement: row.autoIncrement,
        indexes: row.indexes,
        keys: row.keys.result,
        values: (await normalize(row.values.result)) as unknown[],
      })),
    ),
  };
}
async function open(name: string) {
  const { index, token } = await activation();
  const client = await openStorage({
    name: checkedName(name),
    activePackageRef: index.packageRef,
    c6Activation: token,
    enablePython: true,
    enableJava: true,
    enableCpp: true,
    enableRust: true,
    enableMysql: true,
  });
  const id = crypto.randomUUID();
  clients.set(id, client);
  return { id, snapshot: await client.read(), recovery: await client.readRecovery() };
}
function client(id: string) {
  const value = clients.get(id);
  if (!value) throw new Error('Client missing');
  return value;
}
async function save(
  id: string,
  input: MysqlDraftInput,
  expectedDraft: number | null,
  expectedMeta?: number,
  generation?: string,
) {
  assertMysqlDraftInput(input);
  const captured = structuredClone(input);
  const storage = client(id);
  const state = await storage.readMysqlCourse();
  return storage.commitMysqlCourse(
    generation ?? state.snapshot.meta.generation,
    expectedMeta ?? state.snapshot.meta.revision,
    ({ snapshot, rows }): MysqlCourseRecipe => {
      const prior = rows.drafts.find((row) => row.documentId === 'mysql.document.free');
      if ((prior?.revision ?? null) !== expectedDraft)
        throw new StorageError('S_REVISION_CONFLICT');
      return {
        operations: [],
        draft: {
          draftVersion: '1.0.0',
          generation: snapshot.meta.generation,
          documentId: 'mysql.document.free',
          ...captured,
          revision: snapshot.meta.revision + 1,
          updatedAt: at,
        },
      };
    },
  );
}
async function guarded<T>(action: () => Promise<T>) {
  try {
    return { ok: true as const, value: await action() };
  } catch (error) {
    return { ok: false as const, code: error instanceof Error ? error.message : String(error) };
  }
}
const harness = {
  seed,
  dump,
  open: (name: string) => guarded(() => open(name)),
  async block(name: string) {
    blockers.set(name, await db(name));
  },
  unblock(name: string) {
    blockers.get(name)?.close();
    blockers.delete(name);
  },
  async future(name: string) {
    const database = await db(name, 16);
    database.close();
  },
  async openOld(name: string) {
    const { index, token } = await activation();
    const storage = await openStorage({
      name: checkedName(name),
      activePackageRef: index.packageRef,
      c6Activation: token,
      enablePython: true,
      enableJava: true,
      enableCpp: true,
      enableRust: true,
    });
    const id = crypto.randomUUID();
    clients.set(id, storage);
    invalidations.set(id, 0);
    storage.subscribeInvalidation(() => invalidations.set(id, (invalidations.get(id) ?? 0) + 1));
    return id;
  },
  invalidations(id: string) {
    return invalidations.get(id) ?? 0;
  },
  async close(id: string) {
    client(id).close();
    clients.delete(id);
  },
  read: (id: string) => guarded(() => client(id).readMysqlCourse()),
  async oldReads(id: string) {
    const storage = client(id);
    return Promise.all([
      storage.readC6Course(),
      storage.readPythonCourse(),
      storage.readJavaCourse(),
      storage.readCppCourse(),
      storage.readRustCourse(),
    ]);
  },
  async save(
    id: string,
    input: MysqlDraftInput,
    expectedDraft: number | null,
    expectedMeta?: number,
    generation?: string,
  ) {
    return guarded(() => save(id, input, expectedDraft, expectedMeta, generation));
  },
  fail(next: typeof fault) {
    fault = next;
  },
  session: defaultMysqlSession,
  async run(source: string, session = defaultMysqlSession()) {
    const response = await new MysqlClient().run(source, session);
    if (!response.replay) throw new Error(response.diagnostic?.code ?? response.status);
    const player = new MysqlPlayer(response.replay);
    player.seek(player.length);
    return {
      status: response.status,
      session: structuredClone(player.state.session),
      proofPersisted: false,
    };
  },
  async clear(id: string) {
    const storage = client(id);
    const recovery = await storage.readRecovery();
    return storage.clear(recovery.guard);
  },
  async corruptMysql(name: string) {
    const database = await db(name);
    const tx = database.transaction(['mysqlDrafts'], 'readwrite');
    const done = complete(tx);
    tx.objectStore('mysqlDrafts').put({ invalid: true }, ['invalid', 'row']);
    await done;
    database.close();
  },
  async recovered(id: string) {
    return client(id).readRecovery();
  },
  async oldWrite(id: string) {
    const storage = client(id);
    const next = await storage.readRustCourse();
    await storage.commitRustCourse(
      next.snapshot.meta.generation,
      next.snapshot.meta.revision,
      ({ snapshot }) => ({
        operations: [],
        draft: {
          draftVersion: '2.2.0',
          generation: snapshot.meta.generation,
          documentId: 'rust.document.free',
          source: 'new-rust',
          updatedAt: at,
          revision: snapshot.meta.revision + 1,
        },
      }),
    );
    return storage.readRustCourse();
  },
  equal: canonicalMysqlJson,
};
declare global {
  interface Window {
    mysqlStorageHarness: typeof harness;
  }
}
window.mysqlStorageHarness = harness;
