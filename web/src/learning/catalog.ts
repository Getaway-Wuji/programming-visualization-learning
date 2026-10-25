import type { ContentPackage } from '../content/types';
import type { Ref } from '../storage/model';
import {
  assertPublicRef,
  isPositiveInt,
  isVersion,
  validationInternals,
} from '../storage/validation';
import type { LearningCatalog, LearningCatalogEntity } from './types';

const { row, list } = validationInternals;
const requireRule: typeof validationInternals.requireRule = validationInternals.requireRule;
export function sameRef(first: Ref, second: Ref): boolean {
  return first.id === second.id && first.version === second.version;
}
function entity(value: unknown, kind: string, extra: readonly string[]) {
  const fields = row(value, ['ref', 'learningRevision', 'acceptedPriorVersions', ...extra]);
  assertPublicRef(fields.ref);
  requireRule(fields.ref.id.startsWith(`${kind}.`) && isPositiveInt(fields.learningRevision));
  const prior = list(fields.acceptedPriorVersions);
  requireRule(prior.every(isVersion) && new Set(prior).size === prior.length);
  return fields;
}
function freezeEntity<T extends LearningCatalogEntity>(value: T): T {
  Object.freeze(value.ref);
  Object.freeze(value.acceptedPriorVersions);
  return Object.freeze(value);
}
/** Validates the small learning projection; it does not publish or authenticate content. */
export function createLearningCatalog(source: LearningCatalog): LearningCatalog {
  const root = row(source, ['purpose', 'packageRef', 'lessons', 'exercises', 'cases']);
  requireRule(
    root.purpose === 'publishable' ||
      root.purpose === 'contract-fixture' ||
      root.purpose === 'lesson-reading' ||
      root.purpose === 'course-practice' ||
      root.purpose === 'case-view',
  );
  assertPublicRef(root.packageRef);
  const lessons = list(root.lessons);
  const exercises = list(root.exercises);
  const cases = list(root.cases);
  const ids = new Set<string>();
  for (const [kind, entries, extra] of [
    ['lesson', lessons, ['requiredExerciseRefs']],
    ['exercise', exercises, ['lessonRef', 'caseKeys']],
    ['case', cases, []],
  ] as const) {
    for (const value of entries) {
      const fields = entity(value, kind, extra);
      const ref = fields.ref as Ref;
      requireRule(!ids.has(ref.id));
      ids.add(ref.id);
      if (kind === 'lesson') {
        const required = list(fields.requiredExerciseRefs);
        requireRule(required.length > 0);
        for (const ref of required) assertPublicRef(ref);
        requireRule(new Set(required.map((ref) => (ref as Ref).id)).size === required.length);
      } else if (kind === 'exercise') {
        assertPublicRef(fields.lessonRef);
        const keys = list(fields.caseKeys);
        requireRule(
          keys.length > 0 &&
            keys.every(
              (key) => typeof key === 'string' && key.length <= 96 && /^[a-z][a-z0-9-]*$/.test(key),
            ) &&
            new Set(keys).size === keys.length,
        );
      }
    }
  }
  for (const lesson of source.lessons) {
    for (const ref of lesson.requiredExerciseRefs) {
      const exercise = source.exercises.find((value) => sameRef(value.ref, ref));
      requireRule(exercise && sameRef(exercise.lessonRef, lesson.ref));
    }
  }
  for (const exercise of source.exercises)
    requireRule(source.lessons.some((lesson) => sameRef(lesson.ref, exercise.lessonRef)));
  const result = structuredClone(source);
  Object.freeze(result.packageRef);
  for (const lesson of result.lessons) {
    lesson.requiredExerciseRefs.forEach(Object.freeze);
    Object.freeze(lesson.requiredExerciseRefs);
    freezeEntity(lesson);
  }
  for (const exercise of result.exercises) {
    Object.freeze(exercise.lessonRef);
    Object.freeze(exercise.caseKeys);
    freezeEntity(exercise);
  }
  result.cases.forEach(freezeEntity);
  Object.freeze(result.lessons);
  Object.freeze(result.exercises);
  Object.freeze(result.cases);
  return Object.freeze(result);
}

/** Called only after the content owner has validated the complete public package. */
export function catalogFromContent(content: ContentPackage): LearningCatalog {
  const base = (value: {
    id: string;
    version: string;
    learningRevision: number;
    acceptedPriorVersions: readonly string[];
  }) => ({
    ref: { id: value.id, version: value.version },
    learningRevision: value.learningRevision,
    acceptedPriorVersions: [...value.acceptedPriorVersions],
  });
  return createLearningCatalog({
    purpose: content.purpose,
    packageRef: { id: content.packageId, version: content.packageVersion },
    lessons: content.lessons.map((value) => ({
      ...base(value),
      requiredExerciseRefs: value.requiredExerciseRefs.map((ref) => ({ ...ref })),
    })),
    exercises: content.exercises.map((value) => ({
      ...base(value),
      lessonRef: { ...value.lessonRef },
      caseKeys: value.tests.map((test) => test.caseKey),
    })),
    cases: content.cases.map(base),
  });
}
