import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CourseReading } from '../../web/src/content/reading';
import type { ContentPackage } from '../../web/src/content/types';
import { lessonCompletionDetails } from '../../web/src/learning/completion';
import { applyLearningEvent, projectLearning } from '../../web/src/learning/domain';
import { savedCourseProjection } from '../../web/src/learning/profile-components';
import {
  reviewedCoursePredecessors,
  reviewedDurableSnapshot,
} from '../../web/src/learning/reviewed-release';
import type { LearningServiceState } from '../../web/src/learning/service';
import type { LearningCatalog, LearningCatalogEntity } from '../../web/src/learning/types';
import type { Progress, Ref, StorageSnapshot } from '../../web/src/storage/model';
import { assertSnapshot } from '../../web/src/storage/validation';
import {
  applyP05Operations,
  p05At,
  p05Catalog,
  p05Command,
  p05Date,
  p05Empty,
} from '../fixtures/p05-learning';

const content = JSON.parse(
  readFileSync('content/c/p05/course-1.0.0.json', 'utf8'),
) as ContentPackage;
const oldPackage = reviewedCoursePredecessors.course.packageRef;
const oldLessons = new Set(reviewedCoursePredecessors.course.lessons.map((entry) => entry.ref.id));

/** Structurally valid archive model only; this does not claim a real execution or IDB write. */
function completedRows(
  snapshot: StorageSnapshot,
  catalog: LearningCatalog,
  packageRef: Ref,
  lessonIds: ReadonlySet<string>,
) {
  const add = (entry: LearningCatalogEntity, eventType: Progress['eventType']) => {
    snapshot.progress.push({
      eventType,
      subjectRef: { ...entry.ref },
      packageRef: { ...packageRef },
      learningRevision: entry.learningRevision,
      result:
        eventType === 'exercise.passed'
          ? 'passed'
          : eventType === 'lesson.completed'
            ? 'completed'
            : 'confirmed',
      firstAt: p05At,
      lastAt: p05At,
    } as Progress);
  };
  for (const lesson of catalog.lessons.filter((entry) => lessonIds.has(entry.ref.id))) {
    add(lesson, 'lesson.study-confirmed');
    add(lesson, 'lesson.completed');
    snapshot.ledger.push({
      sourceId: 'reward.lesson.first-completion',
      subjectId: lesson.ref.id,
      localDate: p05Date,
      occurredAt: p05At,
      status: 'posted',
      points: 20,
      policyRef: { id: 'reward.policy.p0', version: '1.0.0' },
    });
    for (const ref of lesson.requiredExerciseRefs) {
      const exercise = catalog.exercises.find((entry) => entry.ref.id === ref.id)!;
      add(exercise, 'exercise.passed');
      snapshot.ledger.push({
        sourceId: 'reward.exercise.first-pass',
        subjectId: exercise.ref.id,
        localDate: p05Date,
        occurredAt: p05At,
        status: 'posted',
        points: 10,
        policyRef: { id: 'reward.policy.p0', version: '1.0.0' },
      });
    }
  }
  assertSnapshot(snapshot);
}
function view(snapshot: StorageSnapshot, candidate = false) {
  const catalog = p05Catalog();
  const reading = {
    readingVersion: '1.0.0',
    sourceSha256: 'model-only',
    packageRef: catalog.packageRef,
    chapters: content.chapters,
    lessons: content.lessons,
    programs: content.programs,
    knowledgePoints: content.knowledgePoints,
    exercises: content.exercises,
    cases: content.cases,
    catalog: { ...catalog, purpose: 'lesson-reading' },
  } as CourseReading;
  return {
    snapshot,
    reading,
    practiceCatalog: candidate ? null : catalog,
  } as LearningServiceState;
}
function counts(state: LearningServiceState) {
  const projection = savedCourseProjection(state)!;
  return {
    lessons: projection.lessons.filter((entry) => entry.completed).length,
    exercises: projection.exercises.filter((entry) => entry.passed).length,
    total: projection.lessons.length,
  };
}

describe('P0.5 durable displays respect the reviewed package edge', () => {
  for (const candidate of [false, true]) {
    const label = candidate ? 'reading-only candidate' : 'authorized course';
    it(`${label}: foreign package rows cannot turn old accepted versions into completion`, () => {
      const snapshot = p05Empty();
      completedRows(
        snapshot,
        reviewedCoursePredecessors.course,
        {
          id: 'content.foreign',
          version: '1.0.0',
        },
        oldLessons,
      );
      const before = structuredClone(snapshot);
      const state = view(snapshot, candidate);
      expect(counts(state)).toEqual({ lessons: 0, exercises: 0, total: 32 });
      expect(lessonCompletionDetails(state, 'lesson.c.variables-output')).toMatchObject({
        confirmed: false,
        completed: false,
        exercises: [{ passed: false }],
      });
      expect(
        reviewedDurableSnapshot(snapshot, state.practiceCatalog ?? state.reading!.catalog).progress,
      ).toEqual([]);
      expect(snapshot).toEqual(before);
    });

    it(`${label}: the exact old six remain six of thirty-two without rewriting the archive`, () => {
      const snapshot = p05Empty();
      completedRows(snapshot, reviewedCoursePredecessors.course, oldPackage, oldLessons);
      const before = structuredClone(snapshot);
      const state = view(snapshot, candidate);
      expect(counts(state)).toEqual({ lessons: 6, exercises: 6, total: 32 });
      expect(lessonCompletionDetails(state, 'lesson.c.variables-output')?.completed).toBe(true);
      expect(lessonCompletionDetails(state, 'lesson.c.first-program')?.completed).toBe(false);
      expect(snapshot).toEqual(before);
    });
  }

  it('a new lesson cannot borrow a same-version row from the old package', () => {
    const snapshot = p05Empty();
    completedRows(snapshot, p05Catalog(), oldPackage, new Set(['lesson.c.first-program']));
    const state = view(snapshot);
    expect(counts(state)).toEqual({ lessons: 0, exercises: 0, total: 32 });
    expect(lessonCompletionDetails(state, 'lesson.c.first-program')?.completed).toBe(false);
  });

  it('the p0 contract fixture package does not establish prior production completion', () => {
    const snapshot = p05Empty();
    completedRows(
      snapshot,
      reviewedCoursePredecessors.course,
      {
        id: 'content.c.p0',
        version: '1.0.0',
      },
      oldLessons,
    );
    const state = view(snapshot);
    expect(counts(state)).toEqual({ lessons: 0, exercises: 0, total: 32 });
    expect(lessonCompletionDetails(state, 'lesson.c.variables-output')?.completed).toBe(false);
  });

  it('matching current-package facts remain visible for old and newly added subjects', () => {
    const snapshot = p05Empty();
    const catalog = p05Catalog();
    completedRows(
      snapshot,
      catalog,
      catalog.packageRef,
      new Set(catalog.lessons.map((entry) => entry.ref.id)),
    );
    const before = structuredClone(snapshot);
    const state = view(snapshot);
    expect(counts(state)).toEqual({ lessons: 32, exercises: 32, total: 32 });
    expect(lessonCompletionDetails(state, 'lesson.c.first-program')?.completed).toBe(true);
    expect(reviewedDurableSnapshot(snapshot, catalog).progress).toEqual(snapshot.progress);
    expect(snapshot).toEqual(before);
  });

  it('a foreign confirmation cannot combine with a real new pass to complete or reward the lesson', () => {
    const snapshot = p05Empty();
    const catalog = p05Catalog();
    const lesson = reviewedCoursePredecessors.course.lessons[0];
    const foreignConfirmation: Progress = {
      eventType: 'lesson.study-confirmed',
      subjectRef: { ...lesson.ref },
      packageRef: { id: 'content.foreign', version: '1.0.0' },
      learningRevision: 1,
      result: 'confirmed',
      firstAt: p05At,
      lastAt: p05At,
    };
    snapshot.progress.push(foreignConfirmation);
    snapshot.goals.push({
      localDate: p05Date,
      goalVersion: 1,
      targets: null,
      achievedAt: null,
    });
    assertSnapshot(snapshot);
    const originalConfirmation = structuredClone(snapshot.progress[0]);
    const operations = applyLearningEvent(
      snapshot,
      p05Command(0, 'exercise.passed'),
      catalog,
      (value) => reviewedDurableSnapshot(value, catalog).progress,
    );
    expect(
      operations.some(
        (operation) =>
          operation.store === 'progress' && operation.value.eventType === 'lesson.completed',
      ),
    ).toBe(false);
    expect(
      operations.some(
        (operation) =>
          operation.store === 'ledger' &&
          operation.value.sourceId === 'reward.lesson.first-completion',
      ),
    ).toBe(false);
    expect(
      operations.filter(
        (operation) =>
          operation.store === 'ledger' && operation.value.sourceId === 'reward.exercise.first-pass',
      ),
    ).toHaveLength(1);
    applyP05Operations(snapshot, operations);
    expect(snapshot.progress.find((row) => row.eventType === 'lesson.study-confirmed')).toEqual(
      originalConfirmation,
    );
    const projection = projectLearning(
      snapshot,
      catalog,
      reviewedDurableSnapshot(snapshot, catalog).progress,
    );
    expect(projection.exercises[0].passed).toBe(true);
    expect(projection.lessons[0].completed).toBe(false);
    expect(lessonCompletionDetails(view(snapshot), lesson.ref.id)?.completed).toBe(false);
  });

  it('a foreign row at the same physical progress key blocks reuse and leaves the archive intact', () => {
    const snapshot = p05Empty();
    const catalog = p05Catalog();
    completedRows(
      snapshot,
      catalog,
      {
        id: 'content.foreign',
        version: '1.0.0',
      },
      new Set([reviewedCoursePredecessors.course.lessons[0].ref.id]),
    );
    snapshot.goals.push({ localDate: p05Date, goalVersion: 1, targets: null, achievedAt: null });
    assertSnapshot(snapshot);
    const before = structuredClone(snapshot);
    expect(() =>
      applyLearningEvent(
        snapshot,
        p05Command(0, 'exercise.passed'),
        catalog,
        (value) => reviewedDurableSnapshot(value, catalog).progress,
      ),
    ).toThrow('S_CONTENT_INCOMPATIBLE');
    expect(snapshot).toEqual(before);
  });
});
