import { createLearningAuthority, type VerifiedFact } from './authority';
import type { LearningCatalog } from './types';
import type { ExecuteRequest, ExecuteResult } from '../engine/protocol';
import type { ExerciseCatalog } from '../content/practice';
import { sameRef } from './catalog';
import { StorageError } from '../storage/errors';
import type { ResultCategory } from '../storage/model';
import type { MemoryResult } from '../engine/memory-protocol';
import { acceptedBugJudgement, acceptedBugBinding } from '../memory-bugs/protocol';
import { memoryBugQuestion } from '../memory-bugs/content';
import { submissionMet, type CaseSummary } from '../practice/submission';

const facts = new WeakSet<object>();
export function assertAttemptFact(fact: VerifiedFact) {
  if (!fact || !facts.has(fact)) throw new StorageError('S_CONTENT_INCOMPATIBLE');
}
export function classifyAttempt(result: ExecuteResult): ResultCategory | null {
  if (result.terminal.status !== 'completed') {
    return ['program-error', 'rejected'].includes(result.terminal.status) ? 'program-error' : null;
  }
  if (!result.judgeResult || result.judgeResult.status !== 'unmet') return null;
  return result.judgeResult.checks.some(
    (check) => ['stdout-exact', 'exit-zero'].includes(check.key) && check.status === 'unmet',
  )
    ? 'wrong-answer'
    : 'teaching-goal-unmet';
}
export function createPracticeAttemptFact(
  catalog: LearningCatalog,
  selected: ExerciseCatalog,
  request: ExecuteRequest,
  result: ExecuteResult,
  current: () => boolean,
  summaries: readonly CaseSummary[] = [],
): VerifiedFact {
  const aggregateUnmet =
    result.terminal.status === 'completed' &&
    result.judgeResult?.status === 'met' &&
    summaries.length === selected.subject.tests.length &&
    summaries.every((summary) => summary.met) &&
    !submissionMet(selected, summaries);
  const category = classifyAttempt(result) ?? (aggregateUnmet ? 'teaching-goal-unmet' : null);
  const exercise = catalog.exercises.find((e) => sameRef(e.ref, selected.subject));
  const verify = () =>
    current() &&
    catalog.purpose === 'course-practice' &&
    sameRef(catalog.packageRef, selected.packageRef) &&
    !!exercise &&
    exercise.learningRevision === selected.subject.learningRevision &&
    !!category &&
    result.producer === 'rust' &&
    request.mode === 'exercise-test' &&
    !!request.identity.submissionId &&
    Object.entries(request.identity).every(
      ([key, value]) => result.identity[key as keyof typeof result.identity] === value,
    ) &&
    exercise.caseKeys.includes(request.identity.testCaseKey ?? '');
  if (!verify()) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  const fact = createLearningAuthority(catalog, verify, true).issue({
    eventContractVersion: '1.0.0',
    eventType: 'exercise.attempt-evaluated',
    result: 'failed',
    packageRef: { ...catalog.packageRef },
    subjectRef: { ...exercise!.ref },
    learningRevision: exercise!.learningRevision,
    resultCategory: category!,
    failedCaseKey: request.identity.testCaseKey!,
  });
  facts.add(fact);
  return fact;
}
export function createMemoryAttemptFact(
  catalog: LearningCatalog,
  exerciseId: string,
  result: MemoryResult,
  current: () => boolean,
): VerifiedFact | null {
  const verdict = acceptedBugJudgement(result),
    binding = acceptedBugBinding(result),
    q = memoryBugQuestion(exerciseId);
  if (!q || !verdict || !binding || verdict.status !== 'unmet') return null;
  const category: ResultCategory | null =
    result.terminal.status === 'completed'
      ? verdict.checks.some((c) => ['stdout-exact', 'exit-zero'].includes(c.id) && !c.met)
        ? 'wrong-answer'
        : 'teaching-goal-unmet'
      : result.terminal.status !== 'error' ||
          /^E_(?:DEADLINE|STEP_LIMIT|FUEL|MEMORY|OUTPUT|CANCEL|WORKER|PROTOCOL)/.test(
            result.terminal.code ?? '',
          )
        ? null
        : 'program-error';
  if (!category) return null;
  const verify = () =>
    current() &&
    binding.exerciseId === exerciseId &&
    q.tests.some((t) => t.caseKey === binding.caseKey) &&
    catalog.exercises.some((e) => sameRef(e.ref, q.exerciseRef) && e.learningRevision === 1);
  if (!verify()) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  const fact = createLearningAuthority(catalog, verify, true).issue({
    eventContractVersion: '1.0.0',
    eventType: 'exercise.attempt-evaluated',
    result: 'failed',
    packageRef: { ...catalog.packageRef },
    subjectRef: { ...q.exerciseRef },
    learningRevision: 1,
    resultCategory: category,
    failedCaseKey: binding.caseKey,
  });
  facts.add(fact);
  return fact;
}
