import type { EditorHistoryContext } from './editor-history';
import { assertRecord, isSafeUint, isUtcTime, isUuid } from './validation';
import { StorageError, storageError } from './errors';
export interface CustomDraft {
  draftVersion: '1.0.0';
  generation: string;
  revision: number;
  source: string;
  updatedAt: string;
}
export interface CustomDraftWrite {
  expectedRevision: number;
  source: string;
  updatedAt: string;
}
const bytes = (s: string) => new TextEncoder().encode(s).length;
export function assertCustomDraft(value: unknown): asserts value is CustomDraft {
  if (!value || typeof value !== 'object') throw new StorageError('S_RECORD_INVALID');
  const r = value as Record<string, unknown>;
  if (r.draftVersion !== '1.0.0') throw new StorageError('S_VERSION_UNKNOWN');
  if (
    Object.keys(r).length !== 5 ||
    !['draftVersion', 'generation', 'revision', 'source', 'updatedAt'].every((k) => k in r) ||
    !isUuid(r.generation) ||
    !isSafeUint(r.revision) ||
    r.revision === 0 ||
    typeof r.source !== 'string' ||
    bytes(r.source) > 32768 ||
    !isUtcTime(r.updatedAt)
  )
    throw new StorageError('S_RECORD_INVALID');
}
export async function customDraftTransaction(
  db: IDBDatabase,
  context: EditorHistoryContext,
  write?: CustomDraftWrite,
): Promise<CustomDraft | null> {
  try {
    const check = (value: unknown) => {
      assertRecord('meta', value);
      if (value.generation !== context.generation) throw new StorageError('S_GENERATION_STALE');
      if (
        value.activePackageRef.id !== context.activePackageRef.id ||
        value.activePackageRef.version !== context.activePackageRef.version
      )
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
    };
    const result = await new Promise<CustomDraft | null>((resolve, reject) => {
      const tx = db.transaction(
        ['meta', 'customDrafts'],
        write ? 'readwrite' : 'readonly',
        write ? { durability: 'strict' } : undefined,
      );
      let result: CustomDraft | null = null;
      let failure: unknown;
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
      tx.oncomplete = () => resolve(result);
      const meta = tx.objectStore('meta').get('current');
      meta.onsuccess = () => {
        try {
          check(meta.result);
        } catch (e) {
          fail(e);
          return;
        }
        let count = 0;
        const countRequest = tx.objectStore('customDrafts').count();
        countRequest.onsuccess = () => {
          count = countRequest.result;
          if (count > 1) fail(new StorageError('S_RECORD_INVALID'));
        };
        const req = tx.objectStore('customDrafts').get('current');
        req.onsuccess = () => {
          try {
            if (count === 1 && req.result === undefined) throw new StorageError('S_RECORD_INVALID');
            if (req.result !== undefined) {
              assertCustomDraft(req.result);
              if (req.result.generation !== context.generation)
                throw new StorageError('S_GENERATION_STALE');
              result = req.result;
            }
            if (!write) return;
            if (
              !isSafeUint(write.expectedRevision) ||
              write.expectedRevision !== (result?.revision ?? 0)
            )
              throw new StorageError('S_REVISION_CONFLICT');
            const next: CustomDraft = {
              draftVersion: '1.0.0',
              generation: context.generation,
              revision: write.expectedRevision + 1,
              source: write.source,
              updatedAt: write.updatedAt,
            };
            assertCustomDraft(next);
            tx.objectStore('customDrafts').put(next, 'current');
            result = next;
          } catch (e) {
            fail(e);
          }
        };
      };
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly');
      let error: unknown;
      const req = tx.objectStore('meta').get('current');
      req.onsuccess = () => {
        try {
          check(req.result);
        } catch (e) {
          error = e;
        }
      };
      tx.oncomplete = () => (error ? reject(error) : resolve());
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } catch (e) {
    throw storageError(e);
  }
}
