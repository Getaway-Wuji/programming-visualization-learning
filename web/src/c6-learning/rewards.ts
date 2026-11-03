import type { LedgerEntry, StorageSnapshot } from '../storage/model';
import { c6RewardGroups } from './rewards.generated';
import { isC6IndependentProgress } from './independent';

export function isC6TopicRewardSubject(sourceId: unknown, subjectId: unknown): boolean {
  if (typeof subjectId !== 'string' || !subjectId.startsWith('reward.c6.topic.')) return false;
  const key =
    sourceId === 'reward.lesson.first-completion'
      ? 'lessonSubjectId'
      : sourceId === 'reward.exercise.first-pass'
        ? 'exerciseSubjectId'
        : null;
  return (
    key !== null &&
    c6RewardGroups.some(
      (group) =>
        group[key] === subjectId &&
        (key === 'lessonSubjectId' ? group.lessonIds.length : group.exerciseIds.length) > 0,
    )
  );
}

/** A group award is supported by new course facts, never by its legacy award key. */
export function hasC6RewardEvidence(snapshot: StorageSnapshot, entry: LedgerEntry): boolean {
  const lesson = entry.sourceId === 'reward.lesson.first-completion';
  if (
    entry.sourceId === 'reward.exercise.first-pass' &&
    snapshot.progress.some(
      (p) =>
        p.eventType === 'exercise.passed' &&
        p.subjectRef.id === entry.subjectId &&
        p.firstAt <= entry.occurredAt &&
        isC6IndependentProgress(p),
    )
  )
    return true;
  if (!lesson && entry.sourceId !== 'reward.exercise.first-pass') return false;
  const group = c6RewardGroups.find(
    (g) => (lesson ? g.lessonSubjectId : g.exerciseSubjectId) === entry.subjectId,
  );
  if (!group) return false;
  const ids: readonly string[] = lesson ? group.lessonIds : group.exerciseIds;
  if (!ids.length) return false;
  const has = (id: string) =>
    snapshot.progress.some(
      (p) =>
        p.eventType === (lesson ? 'lesson.completed' : 'exercise.passed') &&
        p.packageRef.id === 'content.c.primer6' &&
        p.packageRef.version === '2.0.0' &&
        p.subjectRef.id === id &&
        p.subjectRef.version === '2.0.0' &&
        p.learningRevision === 1 &&
        p.firstAt <= entry.occurredAt,
    );
  return lesson ? ids.every(has) : ids.some(has);
}
