import registry from '../../../content/c/bugs/questions-1.0.0.json' with { type: 'json' };
import type { CoursePractice, ExerciseCatalog } from '../content/practice';
import type { LearningExercise } from '../learning/types';
import type { EntityRef } from '../content/types';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(registry);

export const bugQuestions = registry.questions;
export const bugRegistryRef = registry.registryRef;
export type BugQuestion = (typeof bugQuestions)[number];
const same = (a: EntityRef, b: EntityRef) => a.id === b.id && a.version === b.version;
if (
  registry.registryVersion !== '1.0.0' ||
  bugQuestions.length !== 4 ||
  new Set(bugQuestions.map((q) => q.exerciseRef.id)).size !== 4 ||
  bugQuestions.filter((q) => q.category === 'syntax').length !== 2 ||
  bugQuestions.filter((q) => q.category === 'logic').length !== 2 ||
  bugQuestions.some(
    (q) =>
      q.tests.length !== 4 ||
      new Set(q.tests.map((t) => t.caseKey)).size !== 4 ||
      q.hints.length !== 3 ||
      q.tests.some((t) => t.expectedExitCode !== 0),
  )
)
  throw new Error('BUG_REGISTRY_INVALID');

export function extendBugPractice(practice: CoursePractice): CoursePractice {
  if (!same(practice.packageRef, registry.packageRef)) throw new Error('BUG_PACKAGE_INVALID');
  const additions = bugQuestions.map((question) => {
    const base = practice.exercises.find((e) => same(e, question.baseExerciseRef));
    if (!base || practice.exercises.some((e) => e.id === question.exerciseRef.id))
      throw new Error('BUG_BASE_INVALID');
    return {
      ...structuredClone(base),
      ...question.exerciseRef,
      title: question.title,
      prompt: question.prompt,
      learningRevision: 1,
      acceptedPriorVersions: [],
      tests: question.tests.map((test) => ({
        ...structuredClone(test),
        expectedExitCode: 0 as const,
      })),
    };
  });
  return { ...practice, exercises: [...practice.exercises, ...additions] };
}
/** Recognize this exact supplement; accepting arbitrary four new identities is forbidden. */
export function hasBugLearningSupplement(exercises: readonly LearningExercise[]) {
  return (
    exercises.length === 36 &&
    bugQuestions.every((q) => {
      const actual = exercises.find((e) => same(e.ref, q.exerciseRef));
      const base = exercises.find((e) => same(e.ref, q.baseExerciseRef));
      return (
        actual &&
        base &&
        same(actual.lessonRef, base.lessonRef) &&
        actual.learningRevision === 1 &&
        actual.acceptedPriorVersions.length === 0 &&
        actual.caseKeys.length === 4 &&
        actual.caseKeys.every((key, i) => key === q.tests[i].caseKey)
      );
    })
  );
}
export function bugQuestion(catalog: ExerciseCatalog): BugQuestion | undefined {
  if (!same(catalog.packageRef, registry.packageRef)) return undefined;
  return bugQuestions.find((q) => same(q.exerciseRef, catalog.subject));
}
