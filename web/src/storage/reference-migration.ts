import { DB_NAME, CORE_STORE_NAMES as STORE_NAMES, recordKey } from './model';
import type { StoreName } from './model';
import { assertLegacySnapshot, type LegacyStorageSnapshot } from './v1-migration';
import { migrateLegacyReference } from './migrations';
import { StorageError, storageError } from './errors';

// Registered exercise recipe, never exported by the production entry point.
// Physical v1: the same nine stores; meta/current holds exact legacy0.9 root;
// every other store is empty. No structural change or arbitrary file import.
export async function migrateReferenceDatabase(
  factory: IDBFactory,
  name: string,
): Promise<LegacyStorageSnapshot> {
  if (name === DB_NAME || !name.startsWith(`${DB_NAME}.reference.`)) {
    throw new StorageError('S_MIGRATION_UNSUPPORTED');
  }
  let db: IDBDatabase | undefined;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => req.transaction!.abort();
      req.onerror = () => reject(storageError(req.error));
      req.onsuccess = () => resolve(req.result);
    });
    if (
      db.objectStoreNames.length !== 9 ||
      STORE_NAMES.some((s) => !db!.objectStoreNames.contains(s))
    ) {
      throw new StorageError('S_RECORD_INVALID');
    }
    db.onversionchange = () => db?.close();
    const tx = db.transaction(STORE_NAMES, 'readwrite', { durability: 'strict' });
    return await new Promise((resolve, reject) => {
      const all: Partial<Record<StoreName, unknown[]>> = {};
      const physicalKeys: Partial<Record<StoreName, IDBValidKey[]>> = {};
      let left = STORE_NAMES.length * 2;
      let output: LegacyStorageSnapshot | undefined;
      let failure: unknown;
      const fail = (error: unknown) => {
        failure ??= error;
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
      };
      tx.onabort = () => reject(storageError(failure ?? tx.error ?? new StorageError('S_ABORTED')));
      tx.onerror = () => {
        failure ??= tx.error;
      };
      tx.oncomplete = () => (output ? resolve(output) : reject(new StorageError('S_ABORTED')));
      const convert = () => {
        if (--left !== 0) return;
        try {
          if (
            all.meta!.length !== 1 ||
            physicalKeys.meta!.length !== 1 ||
            physicalKeys.meta![0] !== 'current'
          ) {
            throw new StorageError('S_RECORD_INVALID');
          }
          const legacy = all.meta![0];
          if (
            legacy &&
            typeof legacy === 'object' &&
            'schemaVersion' in legacy &&
            legacy.schemaVersion === '1.0.0'
          ) {
            const snapshot = Object.fromEntries(
              STORE_NAMES.map((s) => [
                s,
                s === 'meta' || s === 'settings' || s === 'avatar' ? all[s]![0] : all[s],
              ]),
            );
            assertLegacySnapshot(snapshot);
            for (const s of STORE_NAMES) {
              const rows =
                s === 'meta' || s === 'settings' || s === 'avatar' ? [snapshot[s]] : snapshot[s];
              if (
                rows.length !== physicalKeys[s]!.length ||
                rows.some(
                  (row, i) =>
                    factory.cmp(
                      recordKey(s, snapshot.meta.generation, row as never),
                      physicalKeys[s]![i],
                    ) !== 0,
                )
              ) {
                throw new StorageError('S_RECORD_INVALID');
              }
            }
            output = snapshot;
            return;
          }
          if (STORE_NAMES.some((s) => s !== 'meta' && all[s]!.length !== 0)) {
            throw new StorageError('S_RECORD_INVALID');
          }
          output = migrateLegacyReference(legacy);
          for (const s of [
            ...STORE_NAMES.filter((s) => s !== 'meta'),
            'meta',
          ] as (typeof STORE_NAMES)[number][]) {
            const rows =
              s === 'meta' || s === 'settings' || s === 'avatar' ? [output[s]] : output[s];
            for (const row of rows) {
              if (s === 'meta') tx.objectStore(s).put(row, 'current');
              else tx.objectStore(s).add(row, recordKey(s, output.meta.generation, row as never));
            }
          }
          // All writes, including the final version marker, share this one transaction.
        } catch (error) {
          fail(error);
        }
      };
      for (const s of STORE_NAMES) {
        const store = tx.objectStore(s);
        if (store.keyPath !== null || store.autoIncrement || store.indexNames.length) {
          fail(new StorageError('S_RECORD_INVALID'));
          return;
        }
        const values = store.getAll();
        values.onsuccess = () => {
          all[s] = values.result;
          convert();
        };
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          physicalKeys[s] = keys.result;
          convert();
        };
      }
    });
  } catch (error) {
    throw storageError(error);
  } finally {
    db?.close();
  }
}
