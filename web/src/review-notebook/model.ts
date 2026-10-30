import type { StorageSnapshot, ContentReceipt, Progress } from '../storage/model';
import type { LearningCatalog } from '../learning/types';
import { reviewedDurableSnapshot } from '../learning/reviewed-release';
import { canonicalLearningId, isCompatibleLearningHistory } from '../learning/domain';
export const mistakeLabels = {
  'wrong-answer': '答案不符',
  'teaching-goal-unmet': '教学目标未满足',
  'program-error': '程序错误',
} as const;
export type MistakeCategory = keyof typeof mistakeLabels;
export function collectMistakes(snapshot: StorageSnapshot, catalog: LearningCatalog) {
  const events = snapshot.receipts.filter(
    (
      r,
    ): r is Extract<
      ContentReceipt,
      { eventType: 'exercise.attempt-evaluated' | 'exercise.passed' }
    > => r.eventType === 'exercise.attempt-evaluated' || r.eventType === 'exercise.passed',
  );
  const progress = events.map(
    (r) => ({ ...r, firstAt: r.occurredAt, lastAt: r.occurredAt }) as Progress,
  );
  const approved = new Set(reviewedDurableSnapshot({ ...snapshot, progress }, catalog).progress);
  const grouped = new Map<
    string,
    {
      id: string;
      currentId: string | null;
      failures: number;
      categories: MistakeCategory[];
      lastCategory: MistakeCategory;
      failedCaseKey: string | null;
      repaired: boolean;
      lastAt: string;
      revision: number;
    }
  >();
  for (const [index, r] of events.entries()) {
    const current = approved.has(progress[index])
      ? catalog.exercises.find((e) =>
          isCompatibleLearningHistory(progress[index], e, 'exercise', snapshot.aliases),
        )
      : undefined;
    const key = current
      ? canonicalLearningId(snapshot.aliases, current.ref.id)
      : `${r.packageRef.id}@${r.packageRef.version}:${r.subjectRef.id}@${r.subjectRef.version}:${r.learningRevision}`;
    let item = grouped.get(key);
    if (
      r.eventType === 'exercise.attempt-evaluated' &&
      Object.hasOwn(mistakeLabels, r.resultCategory)
    ) {
      if (!item) {
        item = {
          id: r.subjectRef.id,
          currentId: current?.ref.id ?? null,
          failures: 0,
          categories: [],
          lastCategory: r.resultCategory as MistakeCategory,
          failedCaseKey: r.failedCaseKey,
          repaired: false,
          lastAt: r.occurredAt,
          revision: 0,
        };
        grouped.set(key, item);
      }
      item.failures++;
      if (!item.categories.includes(r.resultCategory as MistakeCategory))
        item.categories.push(r.resultCategory as MistakeCategory);
    }
  }
  // Re-evaluate temporal status in transaction order; a pass can occur before or after any failure.
  for (const [index, r] of events.entries()) {
    const current = approved.has(progress[index])
      ? catalog.exercises.find((e) =>
          isCompatibleLearningHistory(progress[index], e, 'exercise', snapshot.aliases),
        )
      : undefined;
    const key = current
      ? canonicalLearningId(snapshot.aliases, current.ref.id)
      : `${r.packageRef.id}@${r.packageRef.version}:${r.subjectRef.id}@${r.subjectRef.version}:${r.learningRevision}`;
    const item = grouped.get(key);
    if (!item || r.committedRevision < item.revision) continue;
    if (r.eventType === 'exercise.passed') {
      item.repaired = true;
      item.lastAt = r.occurredAt;
      item.revision = r.committedRevision;
    } else if (Object.hasOwn(mistakeLabels, r.resultCategory)) {
      item.repaired = false;
      item.lastCategory = r.resultCategory as MistakeCategory;
      item.failedCaseKey = r.failedCaseKey;
      item.lastAt = r.occurredAt;
      item.revision = r.committedRevision;
    }
  }
  return [...grouped.values()].sort((a, b) => b.revision - a.revision);
}
