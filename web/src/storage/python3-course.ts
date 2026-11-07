import { courseTransaction, type CourseState, type CourseRecipe } from './c6-course';
import { PYTHON_DB_VERSION, PYTHON_STORES } from './python3-meta';
import { assertActiveCourseMeta, CPP_DB_VERSION } from './cpp-course-meta';
import { JAVA_DB_VERSION } from './java-meta';
import {
  isPythonDocument,
  isPythonLesson,
  isPythonProgress,
  pythonExercise,
} from '../python3/identities';
import { assertPublicRef, isSafeUint, isUtcTime, isUuid, validationInternals } from './validation';
import { StorageError } from './errors';
import type { PublicRef, StorageSnapshot } from './model';

interface ActivityBase {
  activityVersion: '2.1.0';
  generation: string;
  subjectRef: PublicRef;
  revision: number;
}
export interface PythonAttempt {
  eventId: string;
  at: string;
  status: 'passed' | 'failed';
  caseCount: number;
  failedCaseKey: string | null;
  category: 'wrong-answer' | 'teaching-goal-unmet' | 'program-error' | null;
}
export type PythonCourseActivity = ActivityBase &
  (
    | { kind: 'lesson'; readAt: string; completedAt: string }
    | { kind: 'exercise'; latestAttempt: PythonAttempt; firstPass: PythonAttempt | null }
  );
export interface PythonDraft {
  draftVersion: '2.1.0';
  generation: string;
  documentId: string;
  revision: number;
  updatedAt: string;
  source: string;
}
export type PythonCourseState = CourseState<PythonCourseActivity, PythonDraft>;
export type PythonCourseRecipe = CourseRecipe<PythonCourseActivity, PythonDraft>;
export type PreparePythonCourse = (state: PythonCourseState) => PythonCourseRecipe;

const { row } = validationInternals;
const requireRule: typeof validationInternals.requireRule = validationInternals.requireRule;
const encoder = new TextEncoder();
const scalarText = (value: unknown): value is string =>
  typeof value === 'string' &&
  !/[\uD800-\uDFFF]/u.test(value) &&
  encoder.encode(value).length <= 32768;

function assertPythonCourseState({ snapshot, rows }: PythonCourseState) {
  assertActiveCourseMeta(snapshot.meta);
  requireRule(snapshot.meta.dbVersion >= PYTHON_DB_VERSION);
  requireRule(rows.activities.length <= 778 && rows.drafts.length <= 64);
  const revisions = (r: { generation: string; revision: number }) =>
    r.generation === snapshot.meta.generation &&
    isSafeUint(r.revision) &&
    r.revision > 0 &&
    r.revision <= snapshot.meta.revision;
  let bytes = 0;
  for (const draft of rows.drafts) {
    row(draft, ['draftVersion', 'generation', 'documentId', 'revision', 'updatedAt', 'source']);
    requireRule(
      draft.draftVersion === '2.1.0' &&
        revisions(draft) &&
        isPythonDocument(draft.documentId) &&
        isUtcTime(draft.updatedAt) &&
        scalarText(draft.source),
    );
    bytes += encoder.encode(draft.source).length;
  }
  if (bytes > 2097152) throw new StorageError('S_QUOTA');
  const progress = snapshot.progress.filter(isPythonProgress);
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
      activity.activityVersion === '2.1.0' &&
        revisions(activity) &&
        activity.subjectRef.version === '1.0.0',
    );
    const id = activity.subjectRef.id;
    const facts = progress.filter((p) => p.subjectRef.id === id);
    if (activity.kind === 'lesson') {
      requireRule(
        isPythonLesson(id) &&
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
    requireRule(pythonExercise(id));
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
            isPythonProgress(r) &&
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

export function pythonCourseTransaction(
  db: IDBDatabase,
  factory: IDBFactory,
  options?: { generation?: string; revision?: number; prepare?: PreparePythonCourse },
) {
  if (![PYTHON_DB_VERSION, JAVA_DB_VERSION, CPP_DB_VERSION].includes(db.version))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return courseTransaction(db, factory, PYTHON_STORES, assertPythonCourseState, options);
}

/** Validate the DB11 course and its original keys inside the DB12 versionchange. */
export function readPythonUpgradeRows(
  tx: IDBTransaction,
  factory: IDBFactory,
  snapshot: StorageSnapshot,
  ready: () => void,
  fail: (error: unknown) => void,
) {
  const [activities, drafts] = PYTHON_STORES.map((name) => tx.objectStore(name));
  const requests = [
    activities.getAll(),
    activities.getAllKeys(),
    drafts.getAll(),
    drafts.getAllKeys(),
  ];
  let pending = requests.length;
  for (const request of requests) {
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      if (--pending) return;
      try {
        const [activityRows, activityKeys, draftRows, draftKeys] = requests.map(
          (request) => request.result,
        );
        const rows = {
          activities: activityRows as PythonCourseActivity[],
          drafts: draftRows as PythonDraft[],
        };
        assertPythonCourseState({ snapshot, rows });
        requireRule(
          activityRows.length === activityKeys.length && draftRows.length === draftKeys.length,
        );
        const generation = snapshot.meta.generation;
        rows.activities.forEach((row, index) =>
          requireRule(factory.cmp(activityKeys[index], [generation, row.subjectRef.id]) === 0),
        );
        rows.drafts.forEach((row, index) =>
          requireRule(factory.cmp(draftKeys[index], [generation, row.documentId]) === 0),
        );
        ready();
      } catch (error) {
        fail(error);
      }
    };
  }
}
