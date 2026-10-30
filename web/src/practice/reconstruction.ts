import data from '../../../content/c/reconstruction/questions-1.0.0.json' with { type: 'json' };
import type { ExerciseCatalog } from '../content/practice';
import type { PreparedSource } from '../engine/execution-client';
import { generateAnswer } from './answer';

export interface ReconstructionQuestion {
  readonly exerciseRef: { readonly id: string; readonly version: string };
  readonly title: string;
  readonly hint: string;
  readonly referenceAnswer: Readonly<Record<string, string>>;
}
// Configuration is bundled with, and hash-bound to, the reviewed editor release.
export const reconstructionQuestions: readonly ReconstructionQuestion[] = Object.freeze(
  data.questions.map((question) =>
    Object.freeze({
      ...question,
      exerciseRef: Object.freeze(question.exerciseRef),
      referenceAnswer: Object.freeze(Object.fromEntries(Object.entries(question.referenceAnswer))),
    }),
  ),
);
export function reconstructionQuestion(catalog: ExerciseCatalog) {
  if (
    catalog.packageRef.id !== data.packageRef.id ||
    catalog.packageRef.version !== data.packageRef.version
  )
    return undefined;
  return reconstructionQuestions.find(
    (question) =>
      question.exerciseRef.id === catalog.subject.id &&
      question.exerciseRef.version === catalog.subject.version,
  );
}
export function reconstructionReference(catalog: ExerciseCatalog, prepared: PreparedSource) {
  const question = reconstructionQuestion(catalog);
  if (!question) throw new Error('RECONSTRUCTION_UNAVAILABLE');
  return generateAnswer(catalog.subject.id, prepared, question.referenceAnswer);
}
