import { courseTransaction, type CourseState, type CourseRecipe } from './c6-course';
import { assertJavaMeta, JAVA_DB_VERSION, JAVA_STORES } from './java-meta';
import { isJavaDocument, isJavaLesson, isJavaProgress, javaExercise } from '../java/identities';
import { assertPublicRef, isSafeUint, isUtcTime, isUuid, validationInternals } from './validation';
import { StorageError } from './errors';
import type { PublicRef } from './model';

interface ActivityBase {
  activityVersion: '2.2.0';
  generation: string;
  subjectRef: PublicRef;
  revision: number;
}
export interface JavaAttempt {
  eventId: string;
  at: string;
  status: 'passed' | 'failed';
  caseCount: number;
  failedCaseKey: string | null;
  category: 'wrong-answer' | 'teaching-goal-unmet' | 'program-error' | null;
}
export type JavaCourseActivity = ActivityBase &
  (
    | { kind: 'lesson'; readAt: string; completedAt: string }
    | { kind: 'exercise'; latestAttempt: JavaAttempt; firstPass: JavaAttempt | null }
  );
export interface JavaDraft {
  draftVersion: '2.2.0';
  generation: string;
  documentId: string;
  revision: number;
  updatedAt: string;
  source: string;
}
export type JavaCourseState = CourseState<JavaCourseActivity, JavaDraft>;
export type JavaCourseRecipe = CourseRecipe<JavaCourseActivity, JavaDraft>;
export type PrepareJavaCourse = (state: JavaCourseState) => JavaCourseRecipe;

const { row } = validationInternals;
const requireRule: typeof validationInternals.requireRule = validationInternals.requireRule;
const encoder = new TextEncoder();
const scalarText = (value: unknown): value is string =>
  typeof value === 'string' &&
  !/[\uD800-\uDFFF]/u.test(value) &&
  encoder.encode(value).length <= 32768;

function assertJavaCourseState({ snapshot, rows }: JavaCourseState) {
  assertJavaMeta(snapshot.meta);
  requireRule(rows.activities.length <= 402 && rows.drafts.length <= 64);
  const revisions = (r: { generation: string; revision: number }) =>
    r.generation === snapshot.meta.generation &&
    isSafeUint(r.revision) &&
    r.revision > 0 &&
    r.revision <= snapshot.meta.revision;
  let bytes = 0;
  for (const draft of rows.drafts) {
    row(draft, ['draftVersion', 'generation', 'documentId', 'revision', 'updatedAt', 'source']);
    requireRule(
      draft.draftVersion === '2.2.0' &&
        revisions(draft) &&
        isJavaDocument(draft.documentId) &&
        isUtcTime(draft.updatedAt) &&
        scalarText(draft.source),
    );
    bytes += encoder.encode(draft.source).length;
  }
  if (bytes > 2097152) throw new StorageError('S_QUOTA');
  const progress = snapshot.progress.filter(isJavaProgress);
  const byId = new Map(rows.activities.map((r) => [r.subjectRef?.id, r]));
  requireRule(byId.size === rows.activities.length);
  for (const p of progress) requireRule(byId.has(p.subjectRef.id));
  for (const activity of rows.activities) {
    requireRule(activity.kind === 'lesson' || activity.kind === 'exercise');
    row(activity, [
      'activityVersion',
      'generation',
      'subjectRef',
      'revision',
      'kind',
      ...(activity.kind === 'lesson' ? ['readAt', 'completedAt'] : ['latestAttempt', 'firstPass']),
    ]);
    assertPublicRef(activity.subjectRef);
    requireRule(
      activity.activityVersion === '2.2.0' &&
        revisions(activity) &&
        activity.subjectRef.version === '1.0.0',
    );
    const id = activity.subjectRef.id;
    const facts = progress.filter((p) => p.subjectRef.id === id);
    if (activity.kind === 'lesson') {
      requireRule(
        isJavaLesson(id) &&
          isUtcTime(activity.readAt) &&
          isUtcTime(activity.completedAt) &&
          facts.some(
            (p) => p.eventType === 'lesson.study-confirmed' && p.firstAt === activity.readAt,
          ) &&
          facts.some(
            (p) => p.eventType === 'lesson.completed' && p.firstAt === activity.completedAt,
          ),
      );
      continue;
    }
    requireRule(javaExercise(id));
    requireRule(
      Boolean(activity.firstPass) === facts.some((p) => p.eventType === 'exercise.passed'),
    );
    if (activity.firstPass) requireRule(activity.firstPass.status === 'passed');
    for (const attempt of [
      activity.latestAttempt,
      ...(activity.firstPass ? [activity.firstPass] : []),
    ]) {
      row(attempt, ['eventId', 'at', 'status', 'caseCount', 'failedCaseKey', 'category']);
      requireRule(
        isUuid(attempt.eventId) &&
          isUtcTime(attempt.at) &&
          attempt.caseCount === 4 &&
          (attempt.status === 'passed'
            ? attempt.category === null && attempt.failedCaseKey === null
            : attempt.status === 'failed' &&
              ['wrong-answer', 'teaching-goal-unmet', 'program-error'].includes(
                attempt.category ?? '',
              ) &&
              /^case-[1-4]$/u.test(attempt.failedCaseKey ?? '')),
      );
      requireRule(
        snapshot.receipts.some(
          (r) =>
            isJavaProgress(r) &&
            r.eventId === attempt.eventId &&
            r.subjectRef.id === id &&
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

export function javaCourseTransaction(
  db: IDBDatabase,
  factory: IDBFactory,
  options?: { generation?: string; revision?: number; prepare?: PrepareJavaCourse },
) {
  if (db.version !== JAVA_DB_VERSION) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return courseTransaction(db, factory, JAVA_STORES, assertJavaCourseState, options);
}
