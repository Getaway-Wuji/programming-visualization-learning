import { courseTransaction, type CourseState, type CourseRecipe } from './c6-course';
import { assertMysqlMeta, MYSQL_DB_VERSION, MYSQL_STORES } from './mysql-meta';
import {
  isMysqlDocument,
  isMysqlLesson,
  isMysqlProgress,
  mysqlExercise,
} from '../mysql-course/identities';
import { canonicalMysqlJson, mysqlBytes, validateMysqlSession } from '../engine/mysql-data';
import type { MysqlSession } from '../engine/mysql-types';
import { assertPublicRef, isSafeUint, isUtcTime, isUuid, validationInternals } from './validation';
import type { PublicRef } from './model';
import { StorageError } from './errors';

export interface MysqlDraftInput {
  source: string;
  session: MysqlSession;
}
export interface MysqlDraft extends MysqlDraftInput {
  draftVersion: '1.0.0';
  generation: string;
  documentId: string;
  revision: number;
  updatedAt: string;
}
export type MysqlFailureReason = 'wrong-result' | 'wrong-database' | 'goal-unmet' | 'program-error';
export interface MysqlAttempt {
  eventId: string;
  at: string;
  status: 'passed' | 'failed';
  caseCount: 4;
  failedCaseKey: string | null;
  category: 'wrong-answer' | 'teaching-goal-unmet' | 'program-error' | null;
  reason: MysqlFailureReason | null;
}
interface ActivityBase {
  activityVersion: '1.0.0';
  generation: string;
  subjectRef: PublicRef;
  revision: number;
}
export type MysqlCourseActivity = ActivityBase &
  (
    | { kind: 'lesson'; readAt: string; completedAt: string }
    | { kind: 'exercise'; latestAttempt: MysqlAttempt; firstPass: MysqlAttempt | null }
  );
export type MysqlCourseState = CourseState<MysqlCourseActivity, MysqlDraft>;
export type MysqlCourseRows = MysqlCourseState['rows'];
export type MysqlCourseRecipe = CourseRecipe<MysqlCourseActivity, MysqlDraft>;
export type PrepareMysqlCourse = (state: MysqlCourseState) => MysqlCourseRecipe;
const { row } = validationInternals;
const requireRule: typeof validationInternals.requireRule = validationInternals.requireRule;
export const mysqlAttemptCategory = (reason: MysqlFailureReason) =>
  reason === 'goal-unmet'
    ? 'teaching-goal-unmet'
    : reason === 'program-error'
      ? 'program-error'
      : 'wrong-answer';

/** Reject accessors, exotic objects, cycles and sparse arrays before invoking the SQL validator. */
function plainJson(value: unknown) {
  const ancestors = new Set<object>();
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.exit) {
      ancestors.delete(item.value as object);
      continue;
    }
    requireRule(++count <= 100000 && item.depth <= 64);
    const v = item.value;
    if (v === null || typeof v === 'boolean') continue;
    if (typeof v === 'string') {
      requireRule(new TextDecoder().decode(new TextEncoder().encode(v)) === v);
      continue;
    }
    if (typeof v === 'number') {
      requireRule(Number.isSafeInteger(v) && !Object.is(v, -0));
      continue;
    }
    requireRule(v !== null && typeof v === 'object');
    requireRule(!ancestors.has(v));
    const array = Array.isArray(v);
    requireRule(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype));
    const descriptors = Object.getOwnPropertyDescriptors(v);
    const keys = Reflect.ownKeys(descriptors);
    requireRule(keys.every((k) => typeof k === 'string' && 'value' in descriptors[k]));
    if (array) {
      requireRule(
        keys.length === v.length + 1 &&
          keys.every(
            (k) => k === 'length' || (/^(0|[1-9]\d*)$/u.test(String(k)) && Number(k) < v.length),
          ),
      );
    }
    ancestors.add(v);
    stack.push({ ...item, exit: true });
    for (const key of keys)
      if (!(array && key === 'length'))
        stack.push({ value: descriptors[key as string].value, depth: item.depth + 1 });
  }
}
export function assertMysqlDraftInput(value: unknown): asserts value is MysqlDraftInput {
  row(value, ['source', 'session']);
  const input = value as MysqlDraftInput;
  requireRule(typeof input.source === 'string' && mysqlBytes(input.source) <= 32768);
  plainJson(input);
  try {
    validateMysqlSession(input.session);
  } catch {
    throw new StorageError('S_RECORD_INVALID');
  }
}
export function assertMysqlCourseState({ snapshot, rows }: MysqlCourseState) {
  assertMysqlMeta(snapshot.meta);
  requireRule(rows.activities.length <= 312 && rows.drafts.length <= 64);
  const revisions = (v: { generation: string; revision: number }) =>
    v.generation === snapshot.meta.generation &&
    isSafeUint(v.revision) &&
    v.revision > 0 &&
    v.revision <= snapshot.meta.revision;
  let bytes = 0;
  const documents = new Set<string>();
  for (const d of rows.drafts) {
    row(d, [
      'draftVersion',
      'generation',
      'documentId',
      'revision',
      'updatedAt',
      'source',
      'session',
    ]);
    requireRule(
      d.draftVersion === '1.0.0' &&
        revisions(d) &&
        isMysqlDocument(d.documentId) &&
        isUtcTime(d.updatedAt) &&
        !documents.has(d.documentId),
    );
    documents.add(d.documentId);
    assertMysqlDraftInput({ source: d.source, session: d.session });
    bytes += mysqlBytes(canonicalMysqlJson({ source: d.source, session: d.session }));
  }
  if (bytes > 2097152) throw new StorageError('S_QUOTA');
  const progress = snapshot.progress.filter(isMysqlProgress);
  const byId = new Map(rows.activities.map((r) => [r.subjectRef?.id, r]));
  requireRule(byId.size === rows.activities.length);
  for (const p of progress) requireRule(byId.has(p.subjectRef.id));
  for (const a of rows.activities) {
    requireRule(a.kind === 'lesson' || a.kind === 'exercise');
    row(a, [
      'activityVersion',
      'generation',
      'subjectRef',
      'revision',
      'kind',
      ...(a.kind === 'lesson' ? ['readAt', 'completedAt'] : ['latestAttempt', 'firstPass']),
    ]);
    assertPublicRef(a.subjectRef);
    requireRule(a.activityVersion === '1.0.0' && revisions(a) && a.subjectRef.version === '1.0.0');
    const facts = progress.filter((p) => p.subjectRef.id === a.subjectRef.id);
    if (a.kind === 'lesson') {
      requireRule(
        isMysqlLesson(a.subjectRef.id) &&
          isUtcTime(a.readAt) &&
          isUtcTime(a.completedAt) &&
          facts.some((p) => p.eventType === 'lesson.study-confirmed' && p.firstAt === a.readAt) &&
          facts.some((p) => p.eventType === 'lesson.completed' && p.firstAt === a.completedAt),
      );
      continue;
    }
    requireRule(mysqlExercise(a.subjectRef.id));
    requireRule(Boolean(a.firstPass) === facts.some((p) => p.eventType === 'exercise.passed'));
    if (a.firstPass)
      requireRule(
        a.firstPass.status === 'passed' &&
          facts.some((p) => p.eventType === 'exercise.passed' && p.firstAt === a.firstPass!.at) &&
          a.latestAttempt.at >= a.firstPass.at,
      );
    for (const attempt of [a.latestAttempt, ...(a.firstPass ? [a.firstPass] : [])]) {
      row(attempt, ['eventId', 'at', 'status', 'caseCount', 'failedCaseKey', 'category', 'reason']);
      requireRule(isUuid(attempt.eventId) && isUtcTime(attempt.at) && attempt.caseCount === 4);
      requireRule(
        attempt.status === 'passed'
          ? attempt.reason === null && attempt.category === null && attempt.failedCaseKey === null
          : attempt.status === 'failed' &&
              ['wrong-result', 'wrong-database', 'goal-unmet', 'program-error'].includes(
                attempt.reason ?? '',
              ) &&
              attempt.category === mysqlAttemptCategory(attempt.reason!) &&
              /^case-[1-4]$/u.test(attempt.failedCaseKey ?? ''),
      );
      requireRule(
        snapshot.receipts.some(
          (r) =>
            isMysqlProgress(r) &&
            r.eventId === attempt.eventId &&
            r.subjectRef.id === a.subjectRef.id &&
            r.occurredAt === attempt.at &&
            (attempt.status === 'passed'
              ? r.eventType === 'exercise.passed'
              : r.eventType === 'exercise.attempt-evaluated' &&
                r.resultCategory === attempt.category &&
                r.failedCaseKey === attempt.failedCaseKey),
        ),
      );
    }
  }
}
export function mysqlCourseTransaction(
  db: IDBDatabase,
  factory: IDBFactory,
  options?: { generation?: string; revision?: number; prepare?: PrepareMysqlCourse },
) {
  if (db.version !== MYSQL_DB_VERSION) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return courseTransaction(db, factory, MYSQL_STORES, assertMysqlCourseState, options);
}
