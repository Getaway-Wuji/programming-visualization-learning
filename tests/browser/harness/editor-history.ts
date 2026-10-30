import { openStorage, type StorageClient } from '../../../web/src/storage/client';
import { STORE_NAMES } from '../../../web/src/storage/model';
import type {
  EditorHistoryContext,
  EditorSnapshotDraft,
} from '../../../web/src/storage/editor-history';

let client: StorageClient;
let context: EditorHistoryContext;
let databaseName = '';
let serial = 0;
const packageRef = { id: 'content.c.p0', version: '1.0.0' };
const writerId = crypto.randomUUID();
const complete = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
async function raw() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function result<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() };
  } catch (error) {
    return { ok: false as const, code: (error as { code?: string }).code ?? 'UNKNOWN' };
  }
}
const historyHarness = {
  async open(name: string) {
    if (!/^c-viz-learning\.test\.[\w-]+$/.test(name)) throw new Error('Isolated database required');
    client?.close();
    databaseName = name;
    client = await openStorage({ name, activePackageRef: packageRef, timeZone: 'Asia/Shanghai' });
    const snapshot = await client.read();
    context = { generation: snapshot.meta.generation, activePackageRef: packageRef, epoch: 0 };
    return snapshot;
  },
  read: () => client.read(),
  history: () => result(() => client.readEditorHistory(context)),
  async save(
    codeText = 'int main(){}',
    workspaceJson = '{}',
    entryId: string = crypto.randomUUID(),
    captureVersion = 0,
    updateOnly = false,
  ) {
    const record: EditorSnapshotDraft = {
      historyVersion: '1.0.0',
      entryId,
      writerId,
      generation: context.generation,
      captureVersion,
      createdAt: '2026-10-30T00:00:00.000Z',
      scope: {
        packageRef,
        exerciseRef: { id: 'exercise.c.echo', version: '1.0.0' },
        programRef: { id: 'program.c.echo', version: '1.0.0' },
        mode: 'independent',
      },
      reason: 'code',
      documentRevision: ++serial,
      authority: 'code',
      codeText,
      workspaceJson,
      inputJson: '{}',
      state: 'invalid',
      restoredFrom: null,
    };
    return result(() => client.saveEditorHistory(context, record, updateOnly));
  },
  async batch(count: number, workspaceBytes = 2) {
    const results = [];
    for (let i = 0; i < count; i++)
      results.push(
        await historyHarness.save(
          `/* ${i} */`,
          JSON.stringify({ padding: 'x'.repeat(Math.max(0, workspaceBytes - 14)) }),
        ),
      );
    return results;
  },
  async fault(kind: 'quota' | 'abort') {
    const native = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'editHistory') {
        if (kind === 'quota') throw new DOMException('QA injection', 'QuotaExceededError');
        const request = native.call(this, value, key);
        request.addEventListener('success', () => this.transaction.abort());
        return request;
      }
      return native.call(this, value, key);
    };
    try {
      return await historyHarness.save();
    } finally {
      IDBObjectStore.prototype.put = native;
    }
  },
  async clear() {
    const recovery = await client.readRecovery();
    // Keep the pre-clear context deliberately, to test stale writes.
    return client.clear(recovery.guard);
  },
  async corrupt() {
    const db = await raw();
    try {
      const tx = db.transaction('editHistory', 'readwrite'),
        done = complete(tx);
      tx.objectStore('editHistory').put({ broken: true }, [
        context.generation,
        crypto.randomUUID(),
      ]);
      await done;
    } finally {
      db.close();
    }
  },
  async seedV2(kind: 'valid' | 'future' | 'damaged' = 'valid') {
    const snapshot = await client.read();
    client.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    const before = structuredClone(snapshot);
    Object.assign(before.meta, {
      schemaVersion: kind === 'future' ? '4.0.0' : '2.0.0',
      dbVersion: 2,
      revision: 7,
      ...(kind === 'damaged' ? { generation: '' } : {}),
    });
    before.settings.playbackRate = 2;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2);
      request.onupgradeneeded = () => {
        for (const name of STORE_NAMES) request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(STORE_NAMES, 'readwrite'),
        done = complete(tx);
      for (const name of ['meta', 'settings', 'avatar', 'appearance'] as const)
        tx.objectStore(name).put(before[name], 'current');
      await done;
    } finally {
      db.close();
    }
    return before;
  },
  reopen: () =>
    result(async () => {
      await historyHarness.open(databaseName);
      return client.read();
    }),
  recover: () =>
    result(async () => {
      client = await openStorage({
        name: databaseName,
        activePackageRef: packageRef,
        recovery: true,
      });
      return client.readRecovery();
    }),
};
declare global {
  interface Window {
    historyHarness: typeof historyHarness;
  }
}
window.historyHarness = historyHarness;
