import type { Ref } from './model';
import {
  assertRecord,
  assertPublicRef,
  isPositiveInt,
  isSafeUint,
  isUtcTime,
  isUuid,
  validationInternals,
} from './validation';
import { StorageError, storageError } from './errors';

export const EDIT_HISTORY_STORE = 'editHistory';
export const EDIT_HISTORY_LIMITS = Object.freeze({
  entries: 100,
  bytes: 8 * 1024 * 1024,
  workspaceBytes: 1048576,
  sourceBytes: 32768,
});
export interface EditorScope {
  packageRef: Ref;
  exerciseRef: Ref;
  programRef: Ref;
  mode: 'independent' | 'correction' | 'reconstruction';
}
export interface EditorSnapshot {
  historyVersion: '1.0.0' | '1.1.0';
  entryId: string;
  writerId: string;
  generation: string;
  sequence: number;
  captureVersion: number;
  createdAt: string;
  scope: EditorScope;
  reason: 'initial' | 'code' | 'blocks' | 'move' | 'restore';
  documentRevision: number;
  authority: 'code' | 'blocks';
  codeText: string;
  workspaceJson: string;
  inputJson: string;
  state: 'pending' | 'synced' | 'invalid' | 'unmapped' | 'error';
  restoredFrom: string | null;
}
export type EditorSnapshotDraft = Omit<EditorSnapshot, 'sequence'>;
export interface EditorHistoryContext {
  generation: string;
  activePackageRef: Ref;
  epoch: number;
}
export interface EditorHistorySave {
  saved: true;
  record: EditorSnapshot | null;
  pruned: number;
}
const { row } = validationInternals;
const requireRule: typeof validationInternals.requireRule = validationInternals.requireRule;
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
export const historyBytes = (value: EditorSnapshot) => bytes(JSON.stringify(value));
const canonicalRecord = (value: EditorSnapshot) =>
  JSON.stringify({ ...value, sequence: 0 }, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
export const sameEditorScope = (a: EditorScope, b: EditorScope) =>
  a.mode === b.mode &&
  (['packageRef', 'exerciseRef', 'programRef'] as const).every(
    (key) => a[key].id === b[key].id && a[key].version === b[key].version,
  );
export function assertEditorSnapshot(
  value: unknown,
  draft = false,
): asserts value is EditorSnapshot {
  const data = row(value, [
    'historyVersion',
    'entryId',
    'writerId',
    'generation',
    ...(draft ? [] : ['sequence']),
    'captureVersion',
    'createdAt',
    'scope',
    'reason',
    'documentRevision',
    'authority',
    'codeText',
    'workspaceJson',
    'inputJson',
    'state',
    'restoredFrom',
  ]);
  requireRule(data.historyVersion === '1.0.0' || data.historyVersion === '1.1.0');
  requireRule(isUuid(data.entryId) && isUuid(data.writerId) && isUuid(data.generation));
  requireRule(draft || isPositiveInt(data.sequence));
  requireRule(
    isSafeUint(data.captureVersion) &&
      isPositiveInt(data.documentRevision) &&
      isUtcTime(data.createdAt),
  );
  const scope = row(data.scope, ['packageRef', 'exerciseRef', 'programRef', 'mode']);
  assertPublicRef(scope.packageRef);
  assertPublicRef(scope.exerciseRef);
  assertPublicRef(scope.programRef);
  requireRule(
    scope.mode === 'independent' ||
      scope.mode === 'correction' ||
      (data.historyVersion === '1.1.0' && scope.mode === 'reconstruction'),
  );
  requireRule(['initial', 'code', 'blocks', 'move', 'restore'].includes(data.reason as string));
  requireRule(data.authority === 'code' || data.authority === 'blocks');
  requireRule(['pending', 'synced', 'invalid', 'unmapped', 'error'].includes(data.state as string));
  requireRule(data.restoredFrom === null || isUuid(data.restoredFrom));
  requireRule(
    typeof data.codeText === 'string' && bytes(data.codeText) <= EDIT_HISTORY_LIMITS.sourceBytes,
  );
  requireRule(
    typeof data.workspaceJson === 'string' &&
      bytes(data.workspaceJson) <= EDIT_HISTORY_LIMITS.workspaceBytes,
  );
  requireRule(typeof data.inputJson === 'string' && bytes(data.inputJson) <= 8192);
}
function checkMeta(value: unknown, context: EditorHistoryContext) {
  assertRecord('meta', value);
  if (value.generation !== context.generation) throw new StorageError('S_GENERATION_STALE');
  if (
    value.activePackageRef.id !== context.activePackageRef.id ||
    value.activePackageRef.version !== context.activePackageRef.version
  )
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
}

/** Separate bounded partition: ordinary learning reads never clone code history. */
export async function editorHistoryTransaction(
  db: IDBDatabase,
  context: EditorHistoryContext,
  write?: { record: EditorSnapshotDraft; updateOnly: boolean },
): Promise<EditorHistorySave | EditorSnapshot[]> {
  try {
    const tx = db.transaction(
      ['meta', EDIT_HISTORY_STORE],
      write ? 'readwrite' : 'readonly',
      write ? { durability: 'strict' } : undefined,
    );
    const result = await new Promise<EditorHistorySave | EditorSnapshot[]>((resolve, reject) => {
      let failure: unknown;
      let output: EditorHistorySave | EditorSnapshot[] | undefined;
      const fail = (error: unknown) => {
        failure ??= error;
        try {
          tx.abort();
        } catch {
          /* ended */
        }
      };
      tx.onabort = () => reject(storageError(failure ?? tx.error ?? new StorageError('S_ABORTED')));
      tx.onerror = () => {
        failure ??= tx.error;
      };
      tx.oncomplete = () => (output ? resolve(output) : reject(new StorageError('S_ABORTED')));
      const meta = tx.objectStore('meta').get('current');
      meta.onsuccess = () => {
        try {
          checkMeta(meta.result, context);
        } catch (error) {
          fail(error);
          return;
        }
        const records: EditorSnapshot[] = [];
        let total = 0;
        const cursor = tx.objectStore(EDIT_HISTORY_STORE).openCursor();
        cursor.onsuccess = () => {
          try {
            const current = cursor.result;
            if (current) {
              assertEditorSnapshot(current.value);
              const record = current.value;
              if (
                record.generation !== context.generation ||
                JSON.stringify(current.primaryKey) !==
                  JSON.stringify([record.generation, record.entryId])
              )
                throw new StorageError('S_RECORD_INVALID');
              records.push(record);
              total += historyBytes(record);
              if (records.length > EDIT_HISTORY_LIMITS.entries || total > EDIT_HISTORY_LIMITS.bytes)
                throw new StorageError('S_RECORD_INVALID');
              current.continue();
              return;
            }
            records.sort((a, b) => a.sequence - b.sequence);
            if (new Set(records.map((r) => r.sequence)).size !== records.length)
              throw new StorageError('S_RECORD_INVALID');
            if (!write) {
              output = records;
              return;
            }
            assertEditorSnapshot(write.record, true);
            if (write.record.generation !== context.generation)
              throw new StorageError('S_GENERATION_STALE');
            const old = records.find((record) => record.entryId === write.record.entryId);
            if (!old && write.updateOnly) {
              output = { saved: true, record: null, pruned: 0 };
              return;
            }
            if (
              old &&
              (old.writerId !== write.record.writerId ||
                old.createdAt !== write.record.createdAt ||
                !sameEditorScope(old.scope, write.record.scope))
            )
              throw new StorageError('S_RECORD_INVALID');
            if (old && old.captureVersion >= write.record.captureVersion) {
              if (
                old.captureVersion === write.record.captureVersion &&
                canonicalRecord(old) !== canonicalRecord({ ...write.record, sequence: 0 })
              )
                throw new StorageError('S_RECORD_INVALID');
              output = { saved: true, record: old, pruned: 0 };
              return;
            }
            const sequence = old?.sequence ?? (records.at(-1)?.sequence ?? 0) + 1;
            const next: EditorSnapshot = { ...structuredClone(write.record), sequence };
            assertEditorSnapshot(next);
            const nextSize = historyBytes(next);
            if (nextSize > EDIT_HISTORY_LIMITS.bytes) throw new StorageError('S_QUOTA');
            const combined = records.filter((record) => record.entryId !== next.entryId);
            combined.push(next);
            combined.sort((a, b) => a.sequence - b.sequence);
            total = combined.reduce((sum, r) => sum + historyBytes(r), 0);
            let pruned = 0;
            while (
              combined.length > EDIT_HISTORY_LIMITS.entries ||
              total > EDIT_HISTORY_LIMITS.bytes
            ) {
              const first = combined.shift()!;
              total -= historyBytes(first);
              tx.objectStore(EDIT_HISTORY_STORE).delete([first.generation, first.entryId]);
              pruned++;
            }
            // A validity update to an older entry may itself be the oldest entry.
            const retained = combined.some((record) => record.entryId === next.entryId);
            if (retained)
              tx.objectStore(EDIT_HISTORY_STORE).put(next, [next.generation, next.entryId]);
            output = { saved: true, record: retained ? next : null, pruned };
          } catch (error) {
            fail(error);
          }
        };
      };
    });
    // A clear may win between commit and this ACK; never report the old draft saved.
    const verify = db.transaction('meta', 'readonly');
    await new Promise<void>((resolve, reject) => {
      let failure: unknown;
      const request = verify.objectStore('meta').get('current');
      request.onsuccess = () => {
        try {
          checkMeta(request.result, context);
        } catch (error) {
          failure = error;
        }
      };
      verify.oncomplete = () => (failure ? reject(failure) : resolve());
      verify.onabort = () => reject(verify.error ?? new StorageError('S_ABORTED'));
    });
    return result;
  } catch (error) {
    throw storageError(error);
  }
}
