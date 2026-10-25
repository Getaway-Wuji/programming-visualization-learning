import type { Progress, Ref, StorageSnapshot } from '../storage/model';
import type { LearningCatalog, LearningCatalogEntity } from './types';
import { sameRef } from './catalog';

export const reviewedCasePackage: Ref = { id: 'content.c.p0', version: '1.0.2' };
const coursePackage: Ref = { id: 'content.c.p0', version: '1.0.1' };

export function hasReviewedCaseRelease(cases: LearningCatalog): boolean {
  return (
    cases.purpose === 'case-view' &&
    sameRef(cases.packageRef, reviewedCasePackage) &&
    cases.cases.length === 7
  );
}

/** The case release and course authorization remain independently byte-verified. */
export function hasReviewedCaseAssembly(course: LearningCatalog, cases: LearningCatalog): boolean {
  return (
    course.purpose === 'course-practice' &&
    sameRef(course.packageRef, coursePackage) &&
    course.lessons.length === 6 &&
    course.exercises.length === 6 &&
    hasReviewedCaseRelease(cases)
  );
}

function matches(row: Progress, entity: LearningCatalogEntity, prior: boolean): boolean {
  return (
    row.subjectRef.id === entity.ref.id &&
    row.learningRevision === entity.learningRevision &&
    (row.subjectRef.version === entity.ref.version ||
      (prior && entity.acceptedPriorVersions.includes(row.subjectRef.version)))
  );
}

/** A legacy meta marker never grants fixture or foreign-package learning history. */
export function reviewedHistory(
  row: Progress,
  course: LearningCatalog,
  cases: LearningCatalog,
): boolean {
  if (row.eventType.startsWith('case.')) {
    if (sameRef(row.packageRef, coursePackage))
      return (
        row.subjectRef.version === '1.0.1' &&
        cases.cases.some((entity) => matches(row, entity, true))
      );
    return (
      sameRef(row.packageRef, reviewedCasePackage) &&
      cases.cases.some((entity) => matches(row, entity, false))
    );
  }
  if (!sameRef(row.packageRef, coursePackage)) return false;
  const entities = row.eventType.startsWith('lesson.') ? course.lessons : course.exercises;
  return entities.some((entity) => matches(row, entity, false));
}

/** Filter only the computation copy; immutable stored history is never removed or relabeled. */
export function reviewedSnapshot(
  snapshot: StorageSnapshot,
  course: LearningCatalog,
  cases: LearningCatalog,
): StorageSnapshot {
  return {
    ...snapshot,
    progress: snapshot.progress.filter((row) => reviewedHistory(row, course, cases)),
  };
}
