import type { ExerciseCatalog } from '../content/practice';
import { submissionMet, type CaseSummary } from '../practice/submission';
import { StorageError } from '../storage/errors';
import { createLearningAuthority, type VerifiedFact } from './authority';
import { sameRef } from './catalog';
import type { LearningCatalog } from './types';

export interface PracticePassEvidence {
  readonly catalog: ExerciseCatalog;
  readonly summaries: readonly CaseSummary[];
  /** Private submission owner checks this only after execute's final acceptance. */
  readonly current: boolean;
}
const practiceFacts = new WeakSet<object>();

/** Installed by the actual submission owner; never exposed as a page event issuer. */
export function createPracticePassAuthority(
  catalog: LearningCatalog,
  evidence: () => PracticePassEvidence | null,
) {
  const verified = () => {
    if (catalog.purpose !== 'course-practice') return null;
    const fact = evidence();
    if (!fact || fact.current !== true || !sameRef(fact.catalog.packageRef, catalog.packageRef))
      return null;
    const subject = fact.catalog.subject;
    const exercise = catalog.exercises.find((entry) =>
      sameRef(entry.ref, { id: subject.id, version: subject.version }),
    );
    if (
      !exercise ||
      exercise.learningRevision !== subject.learningRevision ||
      !sameRef(exercise.lessonRef, subject.lessonRef) ||
      exercise.caseKeys.length !== subject.tests.length ||
      exercise.caseKeys.some((key, index) => key !== subject.tests[index].caseKey) ||
      !submissionMet(fact.catalog, fact.summaries)
    )
      return null;
    const required = [
      'input-bindings',
      'stdout-exact',
      'exit-zero',
      'teaching-target',
      ...(fact.catalog.judgeProfile.rule === 'while-for-accumulations'
        ? ['while-accumulation', 'for-accumulation']
        : []),
    ];
    if (
      fact.summaries.some(
        (summary) =>
          summary.terminal !== 'completed' ||
          summary.checks.length !== required.length ||
          required.some(
            (key) =>
              summary.checks.filter(
                (check) =>
                  check.key === key && check.status === 'met' && check.diagnosticCodes.length === 0,
              ).length !== 1,
          ),
      )
    )
      return null;
    return exercise;
  };
  return {
    issue(): VerifiedFact {
      const exercise = verified();
      if (!exercise) throw new StorageError('S_CONTENT_INCOMPATIBLE');
      const authority = createLearningAuthority(
        catalog,
        (event) => {
          const current = verified();
          return (
            !!current &&
            sameRef(current.ref, event.subjectRef) &&
            current.learningRevision === event.learningRevision
          );
        },
        true,
      );
      const fact = authority.issue({
        eventContractVersion: '1.0.0',
        eventType: 'exercise.passed',
        result: 'passed',
        packageRef: { ...catalog.packageRef },
        subjectRef: { ...exercise.ref },
        learningRevision: exercise.learningRevision,
      });
      practiceFacts.add(fact);
      return fact;
    },
  };
}

/** The public service accepts only tokens minted by the actual practice adapter. */
export function assertPracticePassFact(fact: VerifiedFact): void {
  if (!fact || typeof fact !== 'object' || !practiceFacts.has(fact))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
}
