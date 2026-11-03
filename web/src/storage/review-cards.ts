import { STORE_NAMES, type StorageSnapshot, type Meta } from './model';
import type { EditorHistoryContext } from './editor-history';
import { assertRecord, isUtcTime, localDateAt } from './validation';
import { StorageError, storageError } from './errors';
import { readRawTransaction, inspectRecoveryRows } from './recovery';
import { assertKnowledgeMark, type KnowledgeMark } from './knowledge-marks';
import {
  assertReviewCard,
  synchronizeCards,
  applyReviewCommand,
  type ReviewCard,
  type ReviewSource,
  type ReviewCommand,
} from '../review-scheduler/model';
export type ReviewSourceReader = (
  snapshot: StorageSnapshot,
  marks: readonly KnowledgeMark[],
) => ReviewSource[];
export async function reviewCardsTransaction(
  db: IDBDatabase,
  factory: IDBFactory,
  context: EditorHistoryContext,
  derive: ReviewSourceReader,
  at: string,
  command?: ReviewCommand,
) {
  try {
    if (!isUtcTime(at)) throw new StorageError('S_DATE_INVALID');
    const checkMeta = (value: unknown): Meta => {
      assertRecord('meta', value);
      if (value.generation !== context.generation) throw new StorageError('S_GENERATION_STALE');
      if (
        value.activePackageRef.id !== context.activePackageRef.id ||
        value.activePackageRef.version !== context.activePackageRef.version
      )
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
      return value;
    };
    const tx = db.transaction([...STORE_NAMES, 'knowledgeMarks', 'reviewCards'], 'readwrite', {
      durability: 'strict',
    });
    const result = await new Promise<{ rows: ReviewCard[]; meta: Meta; changed: boolean }>(
      (resolve, reject) => {
        let failure: unknown,
          output: { rows: ReviewCard[]; meta: Meta; changed: boolean },
          snapshot: StorageSnapshot,
          remaining = 3;
        const marks: KnowledgeMark[] = [],
          cards: ReviewCard[] = [];
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
            for (const c of cards) {
              if (
                (c.lastReview &&
                  localDateAt(c.lastReview.at, meta.timeZone) !== c.lastReview.localDate) ||
                (c.lastCommand &&
                  localDateAt(c.lastCommand.at, meta.timeZone) !== c.lastCommand.localDate)
              )
                throw new StorageError('S_DATE_INVALID');
            }
            if (new TextEncoder().encode(JSON.stringify(marks)).length > 1048576)
              throw new StorageError('S_RECORD_INVALID');
            let rows = synchronizeCards(
              cards,
              derive(snapshot, marks),
              context.generation,
              at,
              meta.timeZone,
            );
            if (command) rows = applyReviewCommand(rows, command, meta.timeZone);
            if (
              rows.length > 1000 ||
              new TextEncoder().encode(JSON.stringify(rows)).length > 2097152
            )
              throw new StorageError('S_QUOTA');
            let changed = false;
            for (const c of rows) {
              assertReviewCard(c);
              const old = cards.find((o) => o.cardId === c.cardId);
              if (JSON.stringify(old) !== JSON.stringify(c)) {
                changed = true;
                tx.objectStore('reviewCards').put(c, [context.generation, c.cardId]);
              }
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
                db.version === 10 ? '10.0.0' : '9.0.0',
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
        for (const name of ['knowledgeMarks', 'reviewCards'] as const) {
          const req = tx.objectStore(name).openCursor();
          req.onsuccess = () => {
            try {
              const cursor = req.result;
              if (!cursor) {
                finish();
                return;
              }
              const v = cursor.value;
              let identity: string;
              if (name === 'knowledgeMarks') {
                assertKnowledgeMark(v);
                marks.push(v);
                identity = v.knowledgeRef.id;
              } else {
                assertReviewCard(v);
                cards.push(v);
                identity = v.cardId;
              }
              if (
                v.generation !== context.generation ||
                factory.cmp(cursor.primaryKey, [context.generation, identity]) !== 0
              )
                throw new StorageError('S_RECORD_INVALID');
              if (marks.length > 1000 || cards.length > 1000)
                throw new StorageError('S_RECORD_INVALID');
              cursor.continue();
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
