import { createLearningCatalog } from '../../web/src/learning/catalog';
import { reviewedCoursePredecessors } from '../../web/src/learning/reviewed-release';
import type { LearningCatalog, LearningCommand } from '../../web/src/learning/types';
import type { StorageMutation } from '../../web/src/storage/client';
import {
  createMeta,
  emptySnapshot,
  recordKey,
  type StorageSnapshot,
} from '../../web/src/storage/model';
import { assertSnapshot } from '../../web/src/storage/validation';

export const p05Package = { id: 'content.c.p05', version: '1.0.0' };
export const p05Generation = '09000000-0000-4000-8000-000000000001';
export const p05At = '2026-10-27T02:00:00.000Z';
export const p05Date = '2026-10-27';
const pairs = [
  ['first-program', 'first-output'],
  ['printf-layout', 'printf-layout'],
  ['statement-order', 'ordered-updates'],
  ['initialization-assignment', 'reassign-value'],
  ['temporary-swap', 'swap-with-temp'],
  ['scope-shadowing', 'shadowed-values'],
  ['integer-safety', 'wide-product'],
  ['quotient-remainder', 'quotient-remainder'],
  ['boolean-logic', 'boolean-flags'],
  ['short-circuit-safety', 'guarded-division'],
  ['single-if', 'absolute-with-if'],
  ['nested-conditions', 'sign-classification'],
  ['interval-boundaries', 'in-closed-range'],
  ['while-countdown', 'while-countdown'],
  ['loop-control', 'odd-sum-until-stop'],
  ['nested-loops', 'grid-count'],
  ['array-initialization', 'partial-array-init'],
  ['array-traversal-output', 'print-logical-array'],
  ['logical-length-guards', 'safe-array-access'],
  ['array-extrema', 'array-extrema'],
  ['array-counting', 'count-positive'],
  ['linear-search-first', 'linear-search-first'],
  ['adjacent-order', 'check-nondecreasing'],
  ['bubble-sort', 'bubble-sort'],
  ['selection-sort', 'selection-sort'],
  ['binary-search-first', 'binary-search-first'],
] as const;

/** A catalog-only lifecycle fixture. It supplies no execution or publication evidence. */
export function p05Catalog(): LearningCatalog {
  const old = reviewedCoursePredecessors.course;
  const base = (id: string) => ({
    ref: { id, version: '1.0.0' },
    learningRevision: 1,
    acceptedPriorVersions: [],
  });
  return createLearningCatalog({
    purpose: 'course-practice',
    packageRef: p05Package,
    lessons: [
      ...old.lessons.map((lesson) => ({
        ...lesson,
        ref: { id: lesson.ref.id, version: '1.1.0' },
        acceptedPriorVersions: ['1.0.1'],
        requiredExerciseRefs: lesson.requiredExerciseRefs.map((ref) => ({
          ...ref,
          version: '1.1.0',
        })),
      })),
      ...pairs.map(([lesson, exercise]) => ({
        ...base(`lesson.c.${lesson}`),
        requiredExerciseRefs: [{ id: `exercise.c.${exercise}`, version: '1.0.0' }],
      })),
    ],
    exercises: [
      ...old.exercises.map((exercise) => ({
        ...exercise,
        ref: { id: exercise.ref.id, version: '1.1.0' },
        acceptedPriorVersions: ['1.0.1'],
        lessonRef: { ...exercise.lessonRef, version: '1.1.0' },
      })),
      ...pairs.map(([lesson, exercise]) => ({
        ...base(`exercise.c.${exercise}`),
        lessonRef: { id: `lesson.c.${lesson}`, version: '1.0.0' },
        caseKeys: ['model-case'],
      })),
    ],
    cases: reviewedCoursePredecessors.cases.cases.map((item) => ({
      ...item,
      ref: { id: item.ref.id, version: '1.1.0' },
      acceptedPriorVersions: [...new Set(['1.0.1', item.ref.version])],
    })),
  });
}
export function p05CaseCatalog(): LearningCatalog {
  return createLearningCatalog({
    purpose: 'case-view',
    packageRef: p05Package,
    lessons: [],
    exercises: [],
    cases: p05Catalog().cases,
  });
}
export function p05Empty(packageRef = p05Package): StorageSnapshot {
  return emptySnapshot(
    createMeta({
      generation: p05Generation,
      timeZone: 'Asia/Shanghai',
      createdAt: p05At,
      activePackageRef: packageRef,
    }),
  );
}
/** Apply real domain deltas to a test model, without claiming IndexedDB behavior. */
export function applyP05Operations(snapshot: StorageSnapshot, operations: StorageMutation[]): void {
  for (const operation of operations) {
    if (
      operation.store === 'settings' ||
      operation.store === 'avatar' ||
      operation.store === 'appearance'
    ) {
      Object.assign(snapshot, { [operation.store]: structuredClone(operation.value) });
      continue;
    }
    const rows = snapshot[operation.store] as unknown[];
    const key = JSON.stringify(
      recordKey(operation.store, snapshot.meta.generation, operation.value as never),
    );
    const index = rows.findIndex(
      (row) =>
        JSON.stringify(recordKey(operation.store, snapshot.meta.generation, row as never)) === key,
    );
    if (index >= 0) rows[index] = structuredClone(operation.value);
    else rows.push(structuredClone(operation.value));
  }
  if (operations.length) snapshot.meta.revision++;
  assertSnapshot(snapshot);
}
let counter = 0;
export function p05Command(
  index: number,
  type: 'exercise.passed' | 'lesson.study-confirmed',
  catalog = p05Catalog(),
): LearningCommand {
  counter++;
  return {
    generation: p05Generation,
    receipt: {
      eventId: `09000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
      eventType: type,
      packageRef: catalog.packageRef,
      subjectRef:
        type === 'exercise.passed' ? catalog.exercises[index].ref : catalog.lessons[index].ref,
      learningRevision: 1,
      result: type === 'exercise.passed' ? 'passed' : 'confirmed',
      goalVersion: 1,
      occurredAt: p05At,
      localDate: p05Date,
    } as LearningCommand['receipt'],
  };
}
