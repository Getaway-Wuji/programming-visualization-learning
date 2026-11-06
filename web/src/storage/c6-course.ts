import type { C6LearningIndex } from '../c6-learning';
import {
  assertC6CourseRows,
  type C6CourseRows,
  type C6CourseActivity,
  type C6CourseDraft,
} from '../c6-learning/model';
import { assertActiveCourseMeta } from './python3-meta';
import { isPythonProgress } from '../python3/identities';
import { readTransaction } from './client';
import type { SaveResult, StorageMutation, ReceiptSummary } from './client';
import { recordKey, STORE_NAMES } from './model';
import type { StorageSnapshot } from './model';
import { assertRecord, assertSnapshot } from './validation';
import { StorageError, storageError } from './errors';
import { isC6IndependentProgress } from '../c6-learning/independent';

interface CourseActivity {
  subjectRef: { id: string };
  revision: number;
}
interface CourseDraft {
  documentId: string;
  revision: number;
  source: string;
}
export interface CourseState<A extends CourseActivity, D extends CourseDraft> {
  snapshot: StorageSnapshot;
  rows: { activities: A[]; drafts: D[] };
}
export interface CourseRecipe<A extends CourseActivity, D extends CourseDraft> {
  operations: StorageMutation[];
  receipt?: ReceiptSummary;
  activities?: A[];
  draft?: D;
  deleteDraftId?: string;
}
export type C6CourseState = CourseState<C6CourseActivity, C6CourseDraft>;
export type C6CourseRecipe = CourseRecipe<C6CourseActivity, C6CourseDraft>;
export type PrepareC6Course = (state: C6CourseState) => C6CourseRecipe;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function invalid(): never {
  throw new StorageError('S_RECORD_INVALID');
}
export function readC6Rows(
  tx: IDBTransaction,
  index: C6LearningIndex,
  snapshot: StorageSnapshot,
  ready: (rows: C6CourseRows) => void,
  fail: (error: unknown) => void,
): void {
  const values: Record<string, unknown[]> = {};
  let remaining = 4;
  const finish = () => {
    if (--remaining) return;
    try {
      const rows: C6CourseRows = {
        activities: values.courseActivities as C6CourseActivity[],
        drafts: values.courseDrafts as C6CourseDraft[],
      };
      for (const [store, list] of [
        ['courseActivities', rows.activities],
        ['courseDrafts', rows.drafts],
      ] as const) {
        const keys = values[`${store}.keys`];
        if (keys.length !== list.length) invalid();
        list.forEach((row, i) => {
          const id =
            store === 'courseActivities'
              ? (row as C6CourseActivity).subjectRef?.id
              : (row as C6CourseDraft).documentId;
          if (!same(keys[i], [snapshot.meta.generation, id])) invalid();
        });
      }
      assertC6CourseState({ snapshot, rows }, index);
      ready(rows);
    } catch (error) {
      fail(error);
    }
  };
  for (const name of ['courseActivities', 'courseDrafts'])
    for (const keys of [false, true]) {
      const request = keys ? tx.objectStore(name).getAllKeys() : tx.objectStore(name).getAll();
      request.onsuccess = () => {
        values[`${name}${keys ? '.keys' : ''}`] = request.result;
        finish();
      };
    }
}

export function assertC6CourseState(state: C6CourseState, index: C6LearningIndex): void {
  const { snapshot, rows } = state;
  assertActiveCourseMeta(snapshot.meta);
  assertSnapshot(snapshot);
  assertC6CourseRows(rows, index, snapshot.meta.generation, snapshot.meta.revision);
  if (snapshot.aliases.length) invalid();
  for (const activity of rows.activities) {
    const progress = snapshot.progress.filter(
      (p) =>
        p.subjectRef.id === activity.subjectRef.id &&
        p.subjectRef.version === '2.0.0' &&
        p.packageRef.id === index.packageRef.id &&
        p.packageRef.version === '2.0.0',
    );
    if (activity.kind === 'lesson') {
      for (const [at, event] of [
        [activity.readAt, 'lesson.study-confirmed'],
        [activity.completedAt, 'lesson.completed'],
      ] as const)
        if ((at !== null) !== progress.some((p) => p.eventType === event && p.firstAt === at))
          invalid();
    } else {
      if ((activity.firstPass !== null) !== progress.some((p) => p.eventType === 'exercise.passed'))
        invalid();
      for (const attempt of [activity.latestAttempt, activity.firstPass].filter(
        (a) => a !== null,
      )) {
        if (
          !snapshot.receipts.some(
            (r) =>
              r.eventId === attempt.eventId &&
              r.subjectRef.id === activity.subjectRef.id &&
              r.occurredAt === attempt.at &&
              r.eventType ===
                (attempt.status === 'passed' ? 'exercise.passed' : 'exercise.attempt-evaluated'),
          )
        )
          invalid();
      }
    }
  }
  for (const p of snapshot.progress) {
    if (p.eventType.startsWith('case.') || isC6IndependentProgress(p)) continue;
    if (snapshot.meta.dbVersion === 11 && isPythonProgress(p)) continue;
    if (
      p.packageRef.id !== index.packageRef.id ||
      p.packageRef.version !== '2.0.0' ||
      p.subjectRef.version !== '2.0.0' ||
      p.learningRevision !== 1 ||
      !rows.activities.some((a) => a.subjectRef.id === p.subjectRef.id)
    )
      invalid();
  }
}

/** One synchronous IDB recipe spans learning rights, receipts, activities and drafts. */
export async function c6CourseTransaction(
  db: IDBDatabase,
  factory: IDBFactory,
  index: C6LearningIndex,
  options: { generation?: string; revision?: number; prepare?: PrepareC6Course } = {},
): Promise<{ state: C6CourseState; saved: SaveResult }> {
  if (db.version < 10) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return courseTransaction(
    db,
    factory,
    ['courseActivities', 'courseDrafts'],
    (state: C6CourseState) => assertC6CourseState(state, index),
    options,
  );
}

export async function courseTransaction<A extends CourseActivity, D extends CourseDraft>(
  db: IDBDatabase,
  factory: IDBFactory,
  [activityStore, draftStore]: readonly [string, string],
  assertState: (state: CourseState<A, D>) => void,
  options: {
    generation?: string;
    revision?: number;
    prepare?: (state: CourseState<A, D>) => CourseRecipe<A, D>;
  } = {},
): Promise<{ state: CourseState<A, D>; saved: SaveResult }> {
  const tx = db.transaction(
    [...STORE_NAMES, activityStore, draftStore],
    options.prepare ? 'readwrite' : 'readonly',
    options.prepare ? { durability: 'strict' } : undefined,
  );
  try {
    return await new Promise((resolve, reject) => {
      let failure: unknown;
      let output: { state: CourseState<A, D>; saved: SaveResult } | undefined;
      const fail = (error: unknown) => {
        failure ??= error;
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
      tx.oncomplete = () => (output ? resolve(output) : reject(new StorageError('S_ABORTED')));
      readTransaction(
        tx,
        (snapshot) => {
          const rows: CourseState<A, D>['rows'] = { activities: [], drafts: [] };
          let pending = 4;
          const gathered: Record<string, unknown[]> = {};
          const finish = () => {
            if (--pending) return;
            try {
              for (const [store, name] of [
                [activityStore, 'activities'],
                [draftStore, 'drafts'],
              ] as const) {
                const values = gathered[store],
                  keys = gathered[`${store}.keys`];
                if (values.length !== keys.length) invalid();
                Object.assign(rows, { [name]: values });
                values.forEach((value, i) => {
                  const r = value as A & D;
                  if (
                    !same(keys[i], [
                      snapshot.meta.generation,
                      store === activityStore ? r.subjectRef?.id : r.documentId,
                    ])
                  )
                    invalid();
                });
              }
              const state = { snapshot, rows };
              assertState(state);
              if (
                options.generation !== undefined &&
                snapshot.meta.generation !== options.generation
              )
                throw new StorageError('S_GENERATION_STALE');
              if (options.revision !== undefined && snapshot.meta.revision !== options.revision)
                throw new StorageError('S_REVISION_CONFLICT');
              if (!options.prepare) {
                output = {
                  state,
                  saved: { saved: true, revision: snapshot.meta.revision, replayed: false },
                };
                return;
              }
              const recipe = options.prepare(structuredClone(state));
              const previousReceipt =
                recipe.receipt &&
                snapshot.receipts.find((r) => r.eventId === recipe.receipt!.eventId);
              if (previousReceipt) {
                const { committedRevision, ...summary } = previousReceipt;
                if (!same(summary, recipe.receipt)) throw new StorageError('S_EVENT_ID_REUSED');
                output = {
                  state,
                  saved: { saved: true, revision: committedRevision, replayed: true },
                };
                return;
              }
              const hasWrites =
                recipe.operations.length ||
                recipe.receipt ||
                recipe.activities?.length ||
                recipe.draft ||
                recipe.deleteDraftId;
              if (!hasWrites) {
                output = {
                  state,
                  saved: { saved: true, revision: snapshot.meta.revision, replayed: false },
                };
                return;
              }
              if (snapshot.meta.revision === Number.MAX_SAFE_INTEGER) invalid();
              const next = structuredClone(state),
                revision = snapshot.meta.revision + 1;
              const generation = snapshot.meta.generation,
                touched = new Set<string>();
              for (const op of recipe.operations) {
                if (
                  !['progress', 'dailyFacts', 'goals', 'ledger'].includes(op.store) ||
                  !['add', 'put'].includes(op.mode)
                )
                  invalid();
                if (op.store === 'ledger' && op.mode !== 'add') invalid();
                assertRecord(op.store, op.value);
                const key = recordKey(op.store, generation, op.value as never),
                  token = JSON.stringify([op.store, key]);
                if (touched.has(token)) invalid();
                touched.add(token);
                const list = next.snapshot[op.store] as unknown[];
                const at = list.findIndex((v) =>
                  same(recordKey(op.store, generation, v as never), key),
                );
                if (at >= 0 && op.mode === 'add') invalid();
                if (at >= 0) list[at] = structuredClone(op.value);
                else list.push(structuredClone(op.value));
              }
              if (recipe.receipt) {
                const receipt = { ...recipe.receipt, committedRevision: revision };
                assertRecord('receipts', receipt);
                next.snapshot.receipts.push(receipt);
              }
              for (const activity of recipe.activities ?? []) {
                if (activity.revision !== revision) invalid();
                const at = next.rows.activities.findIndex(
                  (r) => r.subjectRef.id === activity.subjectRef.id,
                );
                if (at >= 0) next.rows.activities[at] = structuredClone(activity);
                else next.rows.activities.push(structuredClone(activity));
              }
              if (recipe.deleteDraftId)
                next.rows.drafts = next.rows.drafts.filter(
                  (d) => d.documentId !== recipe.deleteDraftId,
                );
              if (recipe.draft) {
                if (recipe.draft.revision !== revision) invalid();
                const at = next.rows.drafts.findIndex(
                  (d) => d.documentId === recipe.draft!.documentId,
                );
                if (at >= 0) next.rows.drafts[at] = structuredClone(recipe.draft);
                else next.rows.drafts.push(structuredClone(recipe.draft));
              }
              next.snapshot.meta.revision = revision;
              if (
                next.rows.drafts.length > 64 ||
                next.rows.drafts.reduce(
                  (n, d) => n + new TextEncoder().encode(d.source).length,
                  0,
                ) > 2097152
              )
                throw new StorageError('S_QUOTA');
              assertState(next);
              for (const op of recipe.operations)
                tx.objectStore(op.store)[op.mode](
                  op.value,
                  recordKey(op.store, generation, op.value as never),
                );
              if (recipe.receipt)
                tx.objectStore('receipts').add(next.snapshot.receipts.at(-1), [
                  generation,
                  recipe.receipt.eventId,
                ]);
              for (const activity of recipe.activities ?? [])
                tx.objectStore(activityStore).put(activity, [generation, activity.subjectRef.id]);
              if (recipe.deleteDraftId)
                tx.objectStore(draftStore).delete([generation, recipe.deleteDraftId]);
              if (recipe.draft)
                tx.objectStore(draftStore).put(recipe.draft, [generation, recipe.draft.documentId]);
              tx.objectStore('meta').put(next.snapshot.meta, 'current');
              output = { state: next, saved: { saved: true, revision, replayed: false } };
            } catch (error) {
              fail(error);
            }
          };
          for (const store of [activityStore, draftStore]) {
            for (const keys of [false, true]) {
              const req = keys
                ? tx.objectStore(store).getAllKeys()
                : tx.objectStore(store).getAll();
              req.onsuccess = () => {
                gathered[`${store}${keys ? '.keys' : ''}`] = req.result;
                finish();
              };
            }
          }
        },
        fail,
        factory,
        db.version,
      );
    });
  } catch (error) {
    throw storageError(error);
  }
}
