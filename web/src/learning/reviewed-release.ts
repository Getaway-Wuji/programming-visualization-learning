import type { Progress, Ref, StorageSnapshot } from '../storage/model';
import type { LearningCatalog, LearningCatalogEntity } from './types';
import { createLearningCatalog, sameRef } from './catalog';
import predecessorJson from '../../../content/learning/p05-predecessors-1.0.0.json?raw';
import { isCompatibleLearningHistory } from './domain';
import { hasBugLearningSupplement } from '../bugs/content';
import { hasMemoryBugLearningSupplement } from '../memory-bugs/content';

export const reviewedCasePackage: Ref = { id: 'content.c.p0', version: '1.0.2' };
const coursePackage: Ref = { id: 'content.c.p0', version: '1.0.1' };
export const reviewedCoursePackage: Readonly<Ref> = Object.freeze({
  id: 'content.c.p05',
  version: '1.0.0',
});
const predecessor = JSON.parse(predecessorJson) as {
  predecessorVersion: string;
  targetPackageRef: Ref;
  sources: { path: string; sha256: string }[];
  course: LearningCatalog;
  cases: LearningCatalog;
};
// The build separately hashes each immutable predecessor source. This small
// bundled projection grants compatibility only, never a learning issuer.
export const reviewedCoursePredecessors = Object.freeze({
  course: createLearningCatalog(predecessor.course),
  cases: createLearningCatalog(predecessor.cases),
});
if (
  predecessor.predecessorVersion !== '1.0.0' ||
  !sameRef(predecessor.targetPackageRef, reviewedCoursePackage) ||
  !sameRef(reviewedCoursePredecessors.course.packageRef, coursePackage) ||
  !sameRef(reviewedCoursePredecessors.cases.packageRef, reviewedCasePackage) ||
  reviewedCoursePredecessors.course.lessons.length !== 6 ||
  reviewedCoursePredecessors.course.exercises.length !== 6 ||
  reviewedCoursePredecessors.course.cases.length !== 7 ||
  reviewedCoursePredecessors.cases.cases.length !== 7 ||
  predecessor.sources.length !== 5 ||
  predecessor.sources.some((entry) => !/^[a-f0-9]{64}$/.test(entry.sha256))
)
  throw new Error('COURSE_PREDECESSOR_RELEASE');

/** The new course and seven cases must be one completely verified package. */
export function hasReviewedCourseAssembly(
  course: LearningCatalog,
  cases: LearningCatalog,
): boolean {
  if (
    course.purpose !== 'course-practice' ||
    cases.purpose !== 'case-view' ||
    !sameRef(course.packageRef, reviewedCoursePackage) ||
    !sameRef(cases.packageRef, reviewedCoursePackage) ||
    course.lessons.length !== 32 ||
    (course.exercises.length !== 32 &&
      !hasBugLearningSupplement(course.exercises) &&
      !hasMemoryBugLearningSupplement(course.exercises)) ||
    cases.cases.length !== 7
  )
    return false;
  for (const kind of ['lessons', 'exercises'] as const) {
    if (
      !reviewedCoursePredecessors.course[kind].every((old) =>
        course[kind].some(
          (current) =>
            current.ref.id === old.ref.id &&
            current.ref.version === '1.1.0' &&
            current.learningRevision === old.learningRevision &&
            current.acceptedPriorVersions.length === 1 &&
            current.acceptedPriorVersions[0] === old.ref.version,
        ),
      )
    )
      return false;
  }
  return reviewedCoursePredecessors.cases.cases.every((old) =>
    cases.cases.some(
      (current) =>
        current.ref.id === old.ref.id &&
        current.ref.version === '1.1.0' &&
        current.learningRevision === old.learningRevision &&
        [old.ref.version, ...old.acceptedPriorVersions].every((version) =>
          current.acceptedPriorVersions.includes(version),
        ),
    ),
  );
}

/** Stable identity and each explicitly reviewed package/version edge are required. */
export function reviewedCourseHistory(
  row: Progress,
  course: LearningCatalog,
  cases: LearningCatalog,
): boolean {
  if (!hasReviewedCourseAssembly(course, cases)) return false;
  const kind = row.eventType.startsWith('case.')
    ? 'cases'
    : row.eventType.startsWith('lesson.')
      ? 'lessons'
      : 'exercises';
  const current = kind === 'cases' ? cases.cases : course[kind];
  if (sameRef(row.packageRef, reviewedCoursePackage))
    return current.some((entity) => matches(row, entity, false));
  const previous = sameRef(row.packageRef, coursePackage)
    ? reviewedCoursePredecessors.course[kind]
    : kind === 'cases' && sameRef(row.packageRef, reviewedCasePackage)
      ? reviewedCoursePredecessors.cases.cases
      : [];
  return (
    previous.some((entity) => matches(row, entity, false)) &&
    current.some((entity) => matches(row, entity, true))
  );
}

/** Preserve original rows and ledger bytes; only the read projection is filtered. */
export function reviewedCourseSnapshot(
  snapshot: StorageSnapshot,
  course: LearningCatalog,
  cases: LearningCatalog,
): StorageSnapshot {
  return {
    ...snapshot,
    progress: snapshot.progress.filter((row) => reviewedCourseHistory(row, course, cases)),
  };
}

/** Shared durable UI projection: foreign-package rows never become saved completion. */
export function reviewedDurableSnapshot(
  snapshot: StorageSnapshot,
  catalog: LearningCatalog,
): StorageSnapshot {
  const expanded = sameRef(catalog.packageRef, reviewedCoursePackage);
  return {
    ...snapshot,
    progress: snapshot.progress.filter((row) => {
      const kind = row.eventType.startsWith('case.')
        ? 'cases'
        : row.eventType.startsWith('lesson.')
          ? 'lessons'
          : 'exercises';
      const current = catalog[kind];
      if (sameRef(row.packageRef, catalog.packageRef))
        return current.some((entry) =>
          expanded
            ? matches(row, entry, false)
            : isCompatibleLearningHistory(
                row,
                entry,
                kind === 'cases' ? 'case' : kind === 'lessons' ? 'lesson' : 'exercise',
                snapshot.aliases,
              ),
        );
      if (expanded) {
        const prior = sameRef(row.packageRef, coursePackage)
          ? reviewedCoursePredecessors.course[kind]
          : kind === 'cases' && sameRef(row.packageRef, reviewedCasePackage)
            ? reviewedCoursePredecessors.cases.cases
            : [];
        return (
          prior.some((entry) => matches(row, entry, false)) &&
          current.some((entry) => matches(row, entry, true))
        );
      }
      if (
        sameRef(catalog.packageRef, coursePackage) &&
        kind === 'cases' &&
        sameRef(row.packageRef, reviewedCasePackage)
      )
        return reviewedCoursePredecessors.cases.cases.some((entry) => matches(row, entry, false));
      return false;
    }),
  };
}

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
