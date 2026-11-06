import { physicalSchemaVersion } from './python3-meta';
import { STORE_NAMES, type Meta, type StorageSnapshot } from './model';
import type { EditorHistoryContext } from './editor-history';
import { assertRecord } from './validation';
import { readRawTransaction, inspectRecoveryRows } from './recovery';
import { StorageError, storageError } from './errors';
import {
  assertAchievement,
  mergeAchievements,
  achievementCatalog,
  c6AchievementCatalog,
  type Achievement,
  type AchievementEvidence,
} from '../achievements/model';

export type AchievementSourceReader = (snapshot: StorageSnapshot) => AchievementEvidence[];
export async function achievementsTransaction(
  db: IDBDatabase,
  factory: IDBFactory,
  context: EditorHistoryContext,
  derive: AchievementSourceReader,
  observation?: AchievementEvidence,
) {
  const catalog = db.version >= 10 ? c6AchievementCatalog : achievementCatalog;
  try {
    const checkMeta = (v: unknown): Meta => {
      assertRecord('meta', v);
      if (v.generation !== context.generation) throw new StorageError('S_GENERATION_STALE');
      if (
        v.activePackageRef.id !== context.activePackageRef.id ||
        v.activePackageRef.version !== context.activePackageRef.version
      )
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
      return v;
    };
    const tx = db.transaction([...STORE_NAMES, 'achievements'], 'readwrite', {
      durability: 'strict',
    });
    const result = await new Promise<{ rows: Achievement[]; meta: Meta; changed: boolean }>(
      (resolve, reject) => {
        let failure: unknown,
          snapshot: StorageSnapshot,
          output: { rows: Achievement[]; meta: Meta; changed: boolean },
          remaining = 2;
        const previous: Achievement[] = [];
        const fail = (e: unknown) => {
          failure = e;
          try {
            tx.abort();
          } catch {
            /* ended */
          }
        };
        tx.onabort = () => reject(storageError(failure ?? tx.error));
        tx.onerror = () => {
          failure ??= tx.error;
        };
        tx.oncomplete = () => resolve(output);
        const finish = () => {
          if (--remaining !== 0) return;
          try {
            const meta = checkMeta(snapshot.meta);
            const sources = derive(snapshot);
            if (observation) {
              if (observation.kind !== 'observation') throw new StorageError('S_RECORD_INVALID');
              sources.push(observation);
            }
            const rows = mergeAchievements(previous, sources, context.generation, catalog);
            let changed = false;
            for (const r of rows)
              if (
                JSON.stringify(r) !==
                JSON.stringify(previous.find((p) => p.badgeRef.id === r.badgeRef.id))
              ) {
                changed = true;
                tx.objectStore('achievements').put(r, [context.generation, r.badgeRef.id]);
              }
            if (changed) {
              meta.revision++;
              assertRecord('meta', meta);
              tx.objectStore('meta').put(meta, 'current');
            }
            output = { rows, meta, changed };
          } catch (e) {
            fail(e);
          }
        };
        readRawTransaction(
          tx,
          (raw) => {
            try {
              const r = inspectRecoveryRows(
                raw,
                (a, b) => factory.cmp(a, b),
                physicalSchemaVersion(db.version),
              );
              if (!r.writable || !r.snapshot)
                throw new StorageError(r.errorCode ?? 'S_RECORD_INVALID');
              snapshot = r.snapshot;
              finish();
            } catch (e) {
              fail(e);
            }
          },
          fail,
        );
        const req = tx.objectStore('achievements').openCursor();
        req.onsuccess = () => {
          try {
            const c = req.result;
            if (!c) {
              finish();
              return;
            }
            const v = c.value;
            assertAchievement(v, catalog);
            if (
              v.generation !== context.generation ||
              factory.cmp(c.primaryKey, [context.generation, v.badgeRef.id]) !== 0
            )
              throw new StorageError('S_RECORD_INVALID');
            previous.push(v);
            if (
              previous.length > 100 ||
              new TextEncoder().encode(JSON.stringify(previous)).length > 131072
            )
              throw new StorageError('S_RECORD_INVALID');
            c.continue();
          } catch (e) {
            fail(e);
          }
        };
      },
    );
    const ack = db.transaction('meta', 'readonly');
    await new Promise<void>((resolve, reject) => {
      let failure: unknown;
      const req = ack.objectStore('meta').get('current');
      req.onsuccess = () => {
        try {
          checkMeta(req.result);
        } catch (e) {
          failure = e;
        }
      };
      ack.oncomplete = () => (failure ? reject(failure) : resolve());
      ack.onabort = () => reject(ack.error);
    });
    return result;
  } catch (e) {
    throw storageError(e);
  }
}
