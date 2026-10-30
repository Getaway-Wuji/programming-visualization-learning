import { createLearningAuthority, type VerifiedFact } from '../learning/authority';
import { StorageError } from '../storage/errors';
import type { LearningCatalog } from '../learning/types';
import type { MemoryResult } from '../engine/memory-protocol';
import { memoryBugQuestion, hasMemoryBugLearningSupplement, memoryBugRegistry } from './content';
import { acceptedBugJudgement, acceptedBugBinding } from './protocol';

const facts = new WeakSet<object>();
export const isMemoryBugPassFact = (fact: VerifiedFact) => !!fact && facts.has(fact);
export function createMemoryBugPassAuthority(
  catalog: LearningCatalog,
  evidence: () => { exerciseId: string; results: readonly MemoryResult[]; current: boolean } | null,
) {
  const verified = () => {
    const e = evidence(),
      q = e && memoryBugQuestion(e.exerciseId);
    if (
      !e?.current ||
      !q ||
      catalog.purpose !== 'course-practice' ||
      catalog.packageRef.id !== memoryBugRegistry.packageRef.id ||
      catalog.packageRef.version !== memoryBugRegistry.packageRef.version ||
      !hasMemoryBugLearningSupplement(catalog.exercises) ||
      !Array.isArray(e.results) ||
      e.results.length !== 4
    )
      return null;
    const valid = e.results.every((result, i) => {
      const judgement = acceptedBugJudgement(result);
      const binding = acceptedBugBinding(result),
        first = acceptedBugBinding(e.results[0]);
      return (
        judgement?.status === 'met' &&
        judgement.exerciseRef.id === q.exerciseRef.id &&
        judgement.caseKey === q.tests[i].caseKey &&
        binding?.exerciseId === q.exerciseRef.id &&
        binding.caseKey === q.tests[i].caseKey &&
        binding.source === first?.source &&
        binding.sourceRevision === first?.sourceRevision
      );
    });
    return valid ? q : null;
  };
  return {
    issue(): VerifiedFact {
      const q = verified();
      if (!q) throw new StorageError('S_CONTENT_INCOMPATIBLE');
      const owner = createLearningAuthority(
        catalog,
        (event) => verified()?.exerciseRef.id === event.subjectRef.id,
        true,
      );
      const fact = owner.issue({
        eventContractVersion: '1.0.0',
        eventType: 'exercise.passed',
        result: 'passed',
        packageRef: { ...catalog.packageRef },
        subjectRef: { ...q.exerciseRef },
        learningRevision: 1,
      });
      facts.add(fact);
      return fact;
    },
  };
}
