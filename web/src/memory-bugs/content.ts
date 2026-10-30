import registry from '../../../content/cpp/bugs/questions-1.0.0.json' with { type: 'json' };
import { hasBugLearningSupplement } from '../bugs/content';
import type { LearningCatalog, LearningExercise } from '../learning/types';
import type { EntityRef } from '../content/types';

const same = (a: EntityRef, b: EntityRef) => a.id === b.id && a.version === b.version;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(registry);
if (
  registry.registryVersion !== '1.0.0' ||
  registry.questions.length !== 4 ||
  registry.questions.filter((q) => q.category === 'pointer').length !== 2 ||
  registry.questions.filter((q) => q.category === 'loop').length !== 2 ||
  new Set(registry.questions.map((q) => q.exerciseRef.id)).size !== 4 ||
  registry.questions.some(
    (q) =>
      q.language !== 'cpp' ||
      q.hints.length !== 3 ||
      q.tests.length !== 4 ||
      new Set(q.tests.map((t) => t.caseKey)).size !== 4 ||
      q.tests.some(
        (t) =>
          t.input.length !== 1 ||
          !t.input.every((n) => Number.isInteger(n) && n >= -999 && n <= 999),
      ) ||
      (q.category === 'pointer'
        ? q.goal !== 'indirect-read'
        : q.goal !== 'loop-iterations' || q.tests.some((t) => t.input[0] < 0)),
  )
)
  throw new Error('MEMORY_BUG_REGISTRY');
export const memoryBugRegistry = registry;
export const memoryBugQuestions = registry.questions;
export type MemoryBugQuestion = (typeof memoryBugQuestions)[number];
export function memoryBugQuestion(id: string) {
  return memoryBugQuestions.find((q) => q.exerciseRef.id === id);
}
export function memoryBugLearningExercises(): LearningExercise[] {
  return memoryBugQuestions.map((q) => ({
    ref: q.exerciseRef,
    learningRevision: 1,
    acceptedPriorVersions: [],
    lessonRef: q.lessonRef,
    caseKeys: q.tests.map((t) => t.caseKey),
  }));
}
export function hasMemoryBugLearningSupplement(exercises: readonly LearningExercise[]) {
  const ids = new Set(memoryBugQuestions.map((q) => q.exerciseRef.id));
  return (
    exercises.length === 40 &&
    hasBugLearningSupplement(exercises.filter((e) => !ids.has(e.ref.id))) &&
    memoryBugLearningExercises().every((expected) => {
      const actual = exercises.find((e) => same(e.ref, expected.ref));
      return (
        actual &&
        actual.learningRevision === 1 &&
        actual.acceptedPriorVersions.length === 0 &&
        same(actual.lessonRef, expected.lessonRef) &&
        actual.caseKeys.length === 4 &&
        actual.caseKeys.every((key, i) => key === expected.caseKeys[i])
      );
    })
  );
}
export function extendMemoryBugLearning(catalog: LearningCatalog): LearningCatalog {
  if (
    !same(catalog.packageRef, registry.packageRef) ||
    !hasBugLearningSupplement(catalog.exercises)
  )
    throw new Error('MEMORY_BUG_CATALOG');
  return { ...catalog, exercises: [...catalog.exercises, ...memoryBugLearningExercises()] };
}
