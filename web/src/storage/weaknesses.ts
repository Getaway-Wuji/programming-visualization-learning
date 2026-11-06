import { physicalSchemaVersion } from './python3-meta';
import { STORE_NAMES, type StorageSnapshot, type Meta } from './model';
import type { EditorHistoryContext } from './editor-history';
import { assertRecord, isUtcTime } from './validation';
import { StorageError, storageError } from './errors';
import { readRawTransaction, inspectRecoveryRows } from './recovery';
import { assertKnowledgeMark, type KnowledgeMark } from './knowledge-marks';
import { assertWeaknessSummary, type WeaknessSummary } from '../weaknesses/model';
export type WeaknessReader = (
  snapshot: StorageSnapshot,
  marks: readonly KnowledgeMark[],
) => WeaknessSummary;
export async function weaknessesTransaction(
  db: IDBDatabase,
  factory: IDBFactory,
  context: EditorHistoryContext,
  derive: WeaknessReader,
  at: string,
) {
  const check = (value: unknown): Meta => {
    assertRecord('meta', value);
    if (value.generation !== context.generation) throw new StorageError('S_GENERATION_STALE');
    if (
      value.activePackageRef.id !== context.activePackageRef.id ||
      value.activePackageRef.version !== context.activePackageRef.version
    )
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    return value;
  };
  try {
    if (!isUtcTime(at)) throw new StorageError('S_DATE_INVALID');
    const tx = db.transaction([...STORE_NAMES, 'knowledgeMarks', 'weaknesses'], 'readwrite', {
      durability: 'strict',
    });
    const result = await new Promise<{ summary: WeaknessSummary; meta: Meta; changed: boolean }>(
      (resolve, reject) => {
        let failure: unknown,
          snapshot: StorageSnapshot,
          old: WeaknessSummary | undefined,
          remaining = 3,
          output: { summary: WeaknessSummary; meta: Meta; changed: boolean };
        const marks: KnowledgeMark[] = [];
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
            const meta = check(snapshot.meta);
            if (
              old &&
              (old.generation !== context.generation || old.sourceRevision > meta.revision)
            )
              throw new StorageError('S_RECORD_INVALID');
            if (new TextEncoder().encode(JSON.stringify(marks)).length > 1048576)
              throw new StorageError('S_RECORD_INVALID');
            const summary = derive(snapshot, marks);
            assertWeaknessSummary(summary);
            if (summary.generation !== context.generation)
              throw new StorageError('S_GENERATION_STALE');
            if (old && old.observedDate > summary.observedDate)
              throw new StorageError('S_DATE_INVALID');
            const changed =
              !old ||
              JSON.stringify({ ...old, sourceRevision: 0 }) !==
                JSON.stringify({ ...summary, sourceRevision: 0 });
            if (changed) {
              tx.objectStore('weaknesses').put(summary, 'current');
              meta.revision++;
              assertRecord('meta', meta);
              tx.objectStore('meta').put(meta, 'current');
            }
            output = { summary: changed ? summary : old!, meta, changed };
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
        for (const name of ['knowledgeMarks', 'weaknesses'] as const) {
          let count = 0;
          const req = tx.objectStore(name).openCursor();
          req.onsuccess = () => {
            try {
              const c = req.result;
              if (!c) {
                finish();
                return;
              }
              count++;
              if (name === 'knowledgeMarks') {
                assertKnowledgeMark(c.value);
                const v = c.value;
                if (
                  count > 1000 ||
                  v.generation !== context.generation ||
                  factory.cmp(c.primaryKey, [context.generation, v.knowledgeRef.id]) !== 0
                )
                  throw new StorageError('S_RECORD_INVALID');
                marks.push(v);
              } else {
                if (count > 1 || c.primaryKey !== 'current')
                  throw new StorageError('S_RECORD_INVALID');
                assertWeaknessSummary(c.value);
                old = c.value;
              }
              c.continue();
            } catch (e) {
              fail(e);
            }
          };
        }
      },
    );
    const ack = db.transaction('meta', 'readonly');
    await new Promise<void>((resolve, reject) => {
      let failure: unknown;
      const req = ack.objectStore('meta').get('current');
      req.onsuccess = () => {
        try {
          check(req.result);
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
