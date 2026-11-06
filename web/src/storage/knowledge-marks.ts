import type { Ref, Meta } from './model';
import type { EditorHistoryContext } from './editor-history';
import {
  assertRecord,
  assertPublicRef,
  isPositiveInt,
  isUtcTime,
  isUuid,
  validationInternals,
} from './validation';
import { StorageError, storageError } from './errors';
import { isPythonMark, isPythonPackage } from '../python3/identities';
export interface KnowledgeMark {
  markVersion: '1.0.0';
  generation: string;
  revision: number;
  commandId: string;
  packageRef: Ref;
  knowledgeRef: Ref;
  lessonRef: Ref;
  marked: boolean;
  firstAt: string;
  lastAt: string;
}
export interface KnowledgeMarkCommand {
  commandId: string;
  expectedVersion: number;
  packageRef: Ref;
  knowledgeRef: Ref;
  lessonRef: Ref;
  marked: boolean;
  at: string;
}
const { row } = validationInternals;
function requireRule(value: unknown): asserts value {
  if (!value) throw new StorageError('S_RECORD_INVALID');
}
export function assertKnowledgeMark(value: unknown): asserts value is KnowledgeMark {
  const r = row(value, [
    'markVersion',
    'generation',
    'revision',
    'commandId',
    'packageRef',
    'knowledgeRef',
    'lessonRef',
    'marked',
    'firstAt',
    'lastAt',
  ]);
  requireRule(
    r.markVersion === '1.0.0' &&
      isUuid(r.generation) &&
      isUuid(r.commandId) &&
      isPositiveInt(r.revision),
  );
  for (const key of ['packageRef', 'knowledgeRef', 'lessonRef']) assertPublicRef(r[key]);
  if (isPythonPackage(r.packageRef as Ref))
    requireRule(isPythonMark(r as unknown as KnowledgeMark));
  requireRule(
    typeof r.marked === 'boolean' &&
      isUtcTime(r.firstAt) &&
      isUtcTime(r.lastAt) &&
      r.firstAt <= r.lastAt,
  );
}
const same = (a: Ref, b: Ref) => a.id === b.id && a.version === b.version;
function checkMeta(value: unknown, context: EditorHistoryContext): asserts value is Meta {
  assertRecord('meta', value);
  if (value.generation !== context.generation) throw new StorageError('S_GENERATION_STALE');
  if (!same(value.activePackageRef, context.activePackageRef))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
}
export async function knowledgeMarksTransaction(
  db: IDBDatabase,
  context: EditorHistoryContext,
  command?: KnowledgeMarkCommand,
): Promise<{ rows: KnowledgeMark[]; meta: Meta }> {
  try {
    const tx = db.transaction(
      ['meta', 'knowledgeMarks'],
      command ? 'readwrite' : 'readonly',
      command ? { durability: 'strict' } : undefined,
    );
    const result = await new Promise<{ rows: KnowledgeMark[]; meta: Meta }>((resolve, reject) => {
      let failure: unknown;
      let output: { rows: KnowledgeMark[]; meta: Meta };
      const fail = (error: unknown) => {
        failure = error;
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
      const m = tx.objectStore('meta').get('current');
      m.onsuccess = () => {
        try {
          checkMeta(m.result, context);
        } catch (error) {
          fail(error);
          return;
        }
        const meta: Meta = m.result;
        const rows: KnowledgeMark[] = [];
        const req = tx.objectStore('knowledgeMarks').openCursor();
        req.onsuccess = () => {
          try {
            const current = req.result;
            if (current) {
              assertKnowledgeMark(current.value);
              requireRule(
                current.value.generation === context.generation &&
                  JSON.stringify(current.primaryKey) ===
                    JSON.stringify([context.generation, current.value.knowledgeRef.id]),
              );
              rows.push(current.value);
              requireRule(rows.length <= 1000);
              current.continue();
              return;
            }
            requireRule(new TextEncoder().encode(JSON.stringify(rows)).length <= 1048576);
            if (command) {
              row(command, [
                'commandId',
                'expectedVersion',
                'packageRef',
                'knowledgeRef',
                'lessonRef',
                'marked',
                'at',
              ]);
              requireRule(
                isUuid(command.commandId) &&
                  Number.isSafeInteger(command.expectedVersion) &&
                  command.expectedVersion >= 0 &&
                  isUtcTime(command.at) &&
                  typeof command.marked === 'boolean',
              );
              for (const ref of [command.packageRef, command.knowledgeRef, command.lessonRef])
                assertPublicRef(ref);
              requireRule(
                same(command.packageRef, meta.activePackageRef) ||
                  (meta.dbVersion === 11 && isPythonMark(command)),
              );
              const old = rows.find((r) => r.knowledgeRef.id === command.knowledgeRef.id);
              if (old?.commandId === command.commandId) {
                if (
                  old.revision !== command.expectedVersion + 1 ||
                  old.marked !== command.marked ||
                  old.lastAt !== command.at ||
                  !same(old.packageRef, command.packageRef) ||
                  !same(old.knowledgeRef, command.knowledgeRef) ||
                  !same(old.lessonRef, command.lessonRef)
                )
                  throw new StorageError('S_EVENT_ID_REUSED');
              } else {
                if ((old?.revision ?? 0) !== command.expectedVersion)
                  throw new StorageError('S_REVISION_CONFLICT');
                if (!old || old.marked !== command.marked) {
                  requireRule(
                    (old?.revision ?? 0) < Number.MAX_SAFE_INTEGER &&
                      meta.revision < Number.MAX_SAFE_INTEGER &&
                      (!old || command.at >= old.lastAt),
                  );
                  const next: KnowledgeMark = {
                    markVersion: '1.0.0',
                    generation: context.generation,
                    revision: (old?.revision ?? 0) + 1,
                    commandId: command.commandId,
                    packageRef: { ...command.packageRef },
                    knowledgeRef: { ...command.knowledgeRef },
                    lessonRef: { ...command.lessonRef },
                    marked: command.marked,
                    firstAt: old?.firstAt ?? command.at,
                    lastAt: command.at,
                  };
                  assertKnowledgeMark(next);
                  if (old) rows.splice(rows.indexOf(old), 1, next);
                  else rows.push(next);
                  if (
                    rows.length > 1000 ||
                    new TextEncoder().encode(JSON.stringify(rows)).length > 1048576
                  )
                    throw new StorageError('S_QUOTA');
                  tx.objectStore('knowledgeMarks').put(next, [
                    context.generation,
                    next.knowledgeRef.id,
                  ]);
                  meta.revision++;
                  tx.objectStore('meta').put(meta, 'current');
                }
              }
            }
            output = { rows, meta };
          } catch (error) {
            fail(error);
          }
        };
      };
    });
    const ack = db.transaction('meta', 'readonly');
    await new Promise<void>((resolve, reject) => {
      let failure: unknown;
      const r = ack.objectStore('meta').get('current');
      r.onsuccess = () => {
        try {
          checkMeta(r.result, context);
        } catch (e) {
          failure = e;
        }
      };
      ack.oncomplete = () => (failure ? reject(failure) : resolve());
      ack.onabort = () => reject(ack.error);
    });
    return result;
  } catch (error) {
    throw storageError(error);
  }
}
