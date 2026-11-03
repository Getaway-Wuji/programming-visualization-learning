import cBugs from '../../../content/c/bugs/questions-1.0.0.json' with { type: 'json' };
import cppBugs from '../../../content/cpp/bugs/questions-1.0.0.json' with { type: 'json' };
import type { Progress } from '../storage/model';

export const c6IndependentExercises = [...cBugs.questions, ...cppBugs.questions];
const foundations: Record<string, string> = {
  'exercise.c.bug-semicolon': '2.2.2',
  'exercise.c.bug-parenthesis': '2.2.2',
  'exercise.c.bug-zero-branch': '7.1',
  'exercise.c.bug-sum-initial': '6.11.1',
  'exercise.cpp.bug-uninitialized-pointer': '9.7.2',
  'exercise.cpp.bug-dangling-pointer': '12.1.4',
  'exercise.cpp.bug-missing-update': '6.2.1',
  'exercise.cpp.bug-wrong-direction': '6.2.1',
};
export function c6IndependentReference(id: string) {
  const question = c6IndependentExercises.find((q) => q.exerciseRef.id === id);
  return question
    ? {
        question,
        packageRef: cBugs.packageRef,
        lessonRef: { id: `lesson.c6.s${foundations[id]}`, version: '2.0.0' },
      }
    : null;
}
export function c6IndependentHref(id: string) {
  return id.startsWith('exercise.cpp.') ? `/bugs/memory/${id}` : `/practice/${id}`;
}
export function c6GeneratedFoundation(id: string): string | null {
  if (id === 'knowledge.c6.s2.1' || id === 'knowledge.c6.s1.10.2') return 'knowledge.c.output';
  if (id === 'knowledge.c6.s3.2' || id === 'knowledge.c6.s2.2.2') return 'knowledge.c.variables';
  if (id.startsWith('knowledge.c6.s5.2.')) return 'knowledge.c.expressions';
  if (id.startsWith('knowledge.c6.s6.')) return 'knowledge.c.loops';
  if (id.startsWith('knowledge.c6.s7.')) return 'knowledge.c.conditions';
  if (id === 'knowledge.c6.s8.6.2') return 'knowledge.c.input';
  return null;
}
export function isC6IndependentProgress(p: Progress): boolean {
  const question = c6IndependentExercises.find(
    (q) => q.exerciseRef.id === p.subjectRef.id && q.exerciseRef.version === p.subjectRef.version,
  );
  return (
    !!question &&
    p.learningRevision === 1 &&
    p.packageRef.id === cBugs.packageRef.id &&
    p.packageRef.version === cBugs.packageRef.version &&
    (p.eventType === 'exercise.passed' ||
      (p.eventType === 'exercise.attempt-evaluated' &&
        (p.failedCaseKey === null || question.tests.some((t) => t.caseKey === p.failedCaseKey))))
  );
}
