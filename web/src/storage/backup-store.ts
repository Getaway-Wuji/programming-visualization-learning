import type { C6LearningIndex } from '../c6-learning';
import type { StorageSnapshot } from './model';
import { assertMysqlMeta } from './mysql-meta';
import { StorageError, storageError } from './errors';
import {
  BACKUP_LIMITS,
  BACKUP_STORES,
  restoredBackupRows,
  validateBackupRows,
  type BackupRows,
  type PreparedBackup,
} from './backup';

/** All partitions are captured by one readonly transaction, including code history and Blob data. */
export function readBackupRows(db: IDBDatabase): Promise<BackupRows> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...BACKUP_STORES], 'readonly');
    const rows = {} as BackupRows;
    let failure: unknown,
      pending = BACKUP_STORES.length * 2;
    const gathered: Record<string, unknown[]> = {};
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
    tx.oncomplete = () => (pending ? reject(new StorageError('S_ABORTED')) : resolve(rows));
    for (const name of BACKUP_STORES)
      for (const keys of [false, true]) {
        const store = tx.objectStore(name);
        const request = keys
          ? store.getAllKeys(undefined, BACKUP_LIMITS.rows + 1)
          : store.getAll(undefined, BACKUP_LIMITS.rows + 1);
        request.onsuccess = () => {
          gathered[`${name}${keys ? '.keys' : ''}`] = request.result;
          if (--pending) return;
          try {
            let count = 0;
            for (const storeName of BACKUP_STORES) {
              const values = gathered[storeName],
                keyList = gathered[`${storeName}.keys`];
              if (values.length !== keyList.length || (count += values.length) > BACKUP_LIMITS.rows)
                throw new StorageError('S_QUOTA');
              rows[storeName] = values.map((value, i) => ({
                key: keyList[i] as IDBValidKey,
                value,
              }));
            }
          } catch (error) {
            fail(error);
          }
        };
      }
  });
}

/** Validation precedes the transaction. Any failed request rolls back the entire replacement. */
export async function restoreBackup(
  db: IDBDatabase,
  factory: IDBFactory,
  index: C6LearningIndex,
  prepared: PreparedBackup,
  expectedGeneration: string,
  expectedRevision: number,
): Promise<StorageSnapshot> {
  const rows = restoredBackupRows(prepared, crypto.randomUUID(), expectedRevision);
  const snapshot = validateBackupRows(rows, index, (a, b) => factory.cmp(a, b));
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...BACKUP_STORES], 'readwrite', { durability: 'strict' });
    let failure: unknown,
      written = false;
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
    const meta = tx.objectStore('meta').get('current');
    meta.onsuccess = () => {
      try {
        assertMysqlMeta(meta.result);
        if (meta.result.generation !== expectedGeneration)
          throw new StorageError('S_GENERATION_STALE');
        if (meta.result.revision !== expectedRevision)
          throw new StorageError('S_REVISION_CONFLICT');
        for (const name of BACKUP_STORES) {
          const store = tx.objectStore(name);
          store.clear();
          for (const r of rows[name]) store.add(r.value, r.key);
        }
        written = true;
      } catch (error) {
        fail(error);
      }
    };
  });
  return snapshot;
}
