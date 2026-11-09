import { assertActiveCourseMeta, MYSQL_DB_VERSION } from './mysql-meta';
import { courseTransaction, type CourseState, type CourseRecipe } from './c6-course';
import { JAVA_DB_VERSION, JAVA_STORES } from './java-meta';
import { CPP_DB_VERSION, CPP_STORES } from './cpp-course-meta';
import { RUST_DB_VERSION, RUST_STORES } from './rust2018-meta';
import {
  isRustDocument,
  isRustLesson,
  isRustProgress,
  rustExercise,
} from '../rust2018-course/identities';
import { cppExercise, isCppDocument, isCppLesson, isCppProgress } from '../cpp-course/identities';
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

function assertTextCourseState(
  { snapshot, rows }: JavaCourseState,
  language: 'java' | 'cpp' | 'rust' = 'java',
) {
  assertActiveCourseMeta(snapshot.meta);
  const predicates = {
    java: [isJavaDocument, isJavaLesson, isJavaProgress, javaExercise, 402],
    cpp: [isCppDocument, isCppLesson, isCppProgress, cppExercise, 307],
    rust: [isRustDocument, isRustLesson, isRustProgress, rustExercise, 311],
  } as const;
  const [isDocument, isLesson, isProgress, exercise, maxActivities] = predicates[language];
  requireRule(rows.activities.length <= maxActivities && rows.drafts.length <= 64);
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
        isDocument(draft.documentId) &&
        isUtcTime(draft.updatedAt) &&
        scalarText(draft.source),
    );
    bytes += encoder.encode(draft.source).length;
  }
  if (bytes > 2097152) throw new StorageError('S_QUOTA');
  const progress = snapshot.progress.filter(isProgress);
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
        isLesson(id) &&
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
    requireRule(exercise(id));
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
            isProgress(r) &&
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
  if (![JAVA_DB_VERSION, CPP_DB_VERSION, RUST_DB_VERSION, MYSQL_DB_VERSION].includes(db.version))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return courseTransaction(db, factory, JAVA_STORES, assertTextCourseState, options);
}

export function cppCourseTransaction(
  db: IDBDatabase,
  factory: IDBFactory,
  options?: { generation?: string; revision?: number; prepare?: PrepareJavaCourse },
) {
  if (![CPP_DB_VERSION, RUST_DB_VERSION, MYSQL_DB_VERSION].includes(db.version))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return courseTransaction(
    db,
    factory,
    CPP_STORES,
    (state) => assertTextCourseState(state, 'cpp'),
    options,
  );
}

export function rustCourseTransaction(
  db: IDBDatabase,
  factory: IDBFactory,
  options?: { generation?: string; revision?: number; prepare?: PrepareJavaCourse },
) {
  if (![RUST_DB_VERSION, MYSQL_DB_VERSION].includes(db.version))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return courseTransaction(
    db,
    factory,
    RUST_STORES,
    (state) => assertTextCourseState(state, 'rust'),
    options,
  );
}

export function readJavaUpgradeRows(
  tx: IDBTransaction,
  factory: IDBFactory,
  snapshot: JavaCourseState['snapshot'],
  ready: () => void,
  fail: (error: unknown) => void,
  language: 'java' | 'cpp' | 'rust' = 'java',
) {
  const stores = language === 'rust' ? RUST_STORES : language === 'cpp' ? CPP_STORES : JAVA_STORES;
  const [activities, drafts] = stores.map((name) => tx.objectStore(name));
  const activityRows = activities.getAll();
  const activityKeys = activities.getAllKeys();
  const draftRows = drafts.getAll();
  const draftKeys = drafts.getAllKeys();
  let remaining = 4;
  const finish = () => {
    if (--remaining) return;
    try {
      const rows = {
        activities: activityRows.result as JavaCourseActivity[],
        drafts: draftRows.result as JavaDraft[],
      };
      assertTextCourseState({ snapshot, rows }, language);
      const generation = snapshot.meta.generation;
      requireRule(
        rows.activities.length === activityKeys.result.length &&
          rows.drafts.length === draftKeys.result.length,
      );
      rows.activities.forEach((row, index) =>
        requireRule(factory.cmp(activityKeys.result[index], [generation, row.subjectRef.id]) === 0),
      );
      rows.drafts.forEach((row, index) =>
        requireRule(factory.cmp(draftKeys.result[index], [generation, row.documentId]) === 0),
      );
      ready();
    } catch (error) {
      fail(error);
    }
  };
  for (const request of [activityRows, activityKeys, draftRows, draftKeys]) {
    request.onsuccess = finish;
    request.onerror = () => fail(request.error);
  }
}
