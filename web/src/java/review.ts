import type { ReviewSource } from '../review-scheduler/model';
import type { KnowledgeMark } from '../storage/knowledge-marks';
import type { ContentReceipt, StorageSnapshot } from '../storage/model';
import { windowMs, type WeaknessRow } from '../weaknesses/model';
import {
  isJavaMark,
  isJavaProgress,
  javaExercises,
  javaPackageRef,
  javaTopicId,
} from './identities';

function topics(snapshot: StorageSnapshot, marks: readonly KnowledgeMark[]) {
  if (snapshot.meta.dbVersion !== 12) return [];
  return Object.entries(javaExercises).map(([id, exercise]) => {
    const events = snapshot.receipts
      .filter(
        (
          receipt,
        ): receipt is Extract<
          ContentReceipt,
          {
            eventType: 'exercise.passed' | 'exercise.attempt-evaluated';
          }
        > =>
          receipt.subjectRef.id === id &&
          isJavaProgress(receipt) &&
          (receipt.eventType === 'exercise.passed' ||
            receipt.eventType === 'exercise.attempt-evaluated'),
      )
      .toSorted((a, b) => a.committedRevision - b.committedRevision);
    const failures = events.filter(
      (r) =>
        r.eventType === 'exercise.attempt-evaluated' &&
        ['wrong-answer', 'teaching-goal-unmet', 'program-error'].includes(r.resultCategory),
    );
    const last = events.at(-1);
    const failure = failures.at(-1);
    const passed = events.findLast((r) => r.eventType === 'exercise.passed');
    const mark = marks.find((r) => r.knowledgeRef.id === javaTopicId(id) && isJavaMark(r));
    return {
      subjectRef: { id, version: '1.0.0' },
      lessonRef: { id: exercise.lessonId, version: '1.0.0' },
      knowledgeRef: { id: javaTopicId(id), version: '1.0.0' },
      failures,
      last,
      failure,
      passed,
      mark,
    };
  });
}

export function javaReviewSources(
  snapshot: StorageSnapshot,
  marks: readonly KnowledgeMark[],
): ReviewSource[] {
  const sources: ReviewSource[] = [];
  for (const topic of topics(snapshot, marks)) {
    const { subjectRef, lessonRef, knowledgeRef, last, failure, mark } = topic;
    const base = { packageRef: javaPackageRef, lessonRef, learningRevision: 1 };
    if (failure && last)
      sources.push({
        ...base,
        kind: 'exercise',
        subjectRef,
        sourceAt: last.occurredAt,
        sourceVersion: last.committedRevision,
        state: last.eventType === 'exercise.passed' ? 'repaired' : 'active',
      });
    if (mark)
      sources.push({
        ...base,
        kind: 'knowledge',
        subjectRef: knowledgeRef,
        sourceAt: mark.lastAt,
        sourceVersion: mark.revision,
        state: mark.marked ? 'active' : 'familiar',
      });
  }
  return sources;
}

export function javaWeaknessRows(
  snapshot: StorageSnapshot,
  marks: readonly KnowledgeMark[],
  at: string,
): WeaknessRow[] {
  const rows: WeaknessRow[] = [];
  for (const {
    subjectRef,
    knowledgeRef,
    lessonRef,
    failures,
    last,
    failure,
    passed,
    mark,
  } of topics(snapshot, marks)) {
    if (!failure && !mark) continue;
    const recent = failures.filter(
      (r) =>
        r.committedRevision > (passed?.committedRevision ?? 0) &&
        Date.parse(r.occurredAt) <= Date.parse(at) &&
        Date.parse(at) - Date.parse(r.occurredAt) <= windowMs,
    );
    const row: WeaknessRow = {
      knowledgeRef,
      lessonRef,
      exerciseFailures: failures.length,
      recentFailures: recent.length,
      activeExercises: Number(recent.length > 0),
      challengeMistakes: 0,
      challengeStalled: false,
      manual: !!mark?.marked,
      lastAt: [last?.occurredAt, mark?.lastAt]
        .filter((date): date is string => !!date)
        .sort()
        .at(-1)!,
      evidence: [],
    };
    if (failure?.eventType === 'exercise.attempt-evaluated')
      row.evidence.push({
        kind: 'exercise',
        sourceId: failure.eventId,
        sourceRef: subjectRef,
        at: failure.occurredAt,
        revision: failure.committedRevision,
        state:
          last?.eventType === 'exercise.passed' ? 'repaired' : recent.length ? 'active' : 'expired',
        category: failure.resultCategory as
          'wrong-answer' | 'teaching-goal-unmet' | 'program-error',
        mapping: 'exact',
      });
    if (mark)
      row.evidence.push({
        kind: 'manual',
        sourceId: mark.commandId,
        sourceRef: knowledgeRef,
        at: mark.lastAt,
        revision: mark.revision,
        state: mark.marked ? 'active' : 'familiar',
        category: 'self-assessment',
        mapping: 'exact',
      });
    rows.push(row);
  }
  return rows;
}
