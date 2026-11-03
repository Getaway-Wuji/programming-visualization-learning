import type { ContentReceipt, StorageSnapshot } from '../storage/model';
import type { KnowledgeMark } from '../storage/knowledge-marks';
import type { ReviewSource } from '../review-scheduler/model';
import { mistakeLabels, type MistakeCategory } from '../review-notebook/model';
import { localDateAt } from '../storage/validation';
import {
  windowMs,
  weaknessRule,
  type WeaknessSummary,
  type WeaknessRow,
} from '../weaknesses/model';
import type { C6LearningIndex } from './index';
import {
  c6IndependentExercises,
  c6IndependentReference,
  isC6IndependentProgress,
} from './independent';
import { challengeQuestions, challengePackage } from '../challenges/content';
import { challengeKnowledge } from '../weaknesses/model';

function exerciseReference(index: C6LearningIndex, id: string) {
  const exercise = index.exercises.find((e) => e[0] === id);
  if (exercise)
    return {
      ref: { id, version: '2.0.0' },
      packageRef: index.packageRef,
      lessonRef: { id: exercise[2], version: '2.0.0' },
      mapping: 'exact' as const,
    };
  const independent = c6IndependentReference(id)!;
  return {
    ref: independent.question.exerciseRef,
    packageRef: independent.packageRef,
    lessonRef: independent.lessonRef,
    mapping: 'foundation' as const,
  };
}

export function isC6Mark(mark: KnowledgeMark, index: C6LearningIndex): boolean {
  return (
    mark.packageRef.id === index.packageRef.id &&
    mark.packageRef.version === '2.0.0' &&
    mark.lessonRef.version === '2.0.0' &&
    mark.knowledgeRef.version === '2.0.0' &&
    index.lessons.some((l) => l[0] === mark.lessonRef.id && l[3] === mark.knowledgeRef.id)
  );
}
export function c6ExerciseEvents(snapshot: StorageSnapshot, index: C6LearningIndex) {
  return snapshot.receipts
    .filter(
      (
        r,
      ): r is Extract<
        ContentReceipt,
        { eventType: 'exercise.passed' | 'exercise.attempt-evaluated' }
      > =>
        (r.eventType === 'exercise.passed' || r.eventType === 'exercise.attempt-evaluated') &&
        ((r.packageRef.id === index.packageRef.id &&
          r.packageRef.version === '2.0.0' &&
          r.subjectRef.version === '2.0.0' &&
          r.learningRevision === 1 &&
          index.exercises.some((e) => e[0] === r.subjectRef.id)) ||
          isC6IndependentProgress({ ...r, firstAt: r.occurredAt, lastAt: r.occurredAt })),
    )
    .toSorted((a, b) => a.committedRevision - b.committedRevision);
}
export function collectC6Mistakes(snapshot: StorageSnapshot, index: C6LearningIndex) {
  const events = c6ExerciseEvents(snapshot, index);
  return [...index.exercises, ...c6IndependentExercises.map((q) => [q.exerciseRef.id] as const)]
    .flatMap((exercise) => {
      const attempts = events.filter((r) => r.subjectRef.id === exercise[0]);
      const failures = attempts.filter(
        (r) =>
          r.eventType === 'exercise.attempt-evaluated' &&
          Object.hasOwn(mistakeLabels, r.resultCategory),
      );
      if (!failures.length) return [];
      const latest = attempts
        .filter(
          (r) =>
            r.eventType === 'exercise.passed' ||
            (r.eventType === 'exercise.attempt-evaluated' &&
              Object.hasOwn(mistakeLabels, r.resultCategory)),
        )
        .at(-1)!;
      const lastFailure = failures.at(-1)!;
      return [
        {
          id: exercise[0],
          currentId: exercise[0],
          failures: failures.length,
          categories: [
            ...new Set(
              failures.map((r) =>
                r.eventType === 'exercise.attempt-evaluated'
                  ? (r.resultCategory as MistakeCategory)
                  : 'program-error',
              ),
            ),
          ],
          lastCategory:
            lastFailure.eventType === 'exercise.attempt-evaluated'
              ? (lastFailure.resultCategory as MistakeCategory)
              : ('program-error' as const),
          failedCaseKey:
            lastFailure.eventType === 'exercise.attempt-evaluated'
              ? lastFailure.failedCaseKey
              : null,
          repaired: latest.eventType === 'exercise.passed',
          lastAt: latest.occurredAt,
          revision: latest.committedRevision,
        },
      ];
    })
    .sort((a, b) => b.revision - a.revision);
}
export function c6ReviewSources(
  snapshot: StorageSnapshot,
  marks: readonly KnowledgeMark[],
  index: C6LearningIndex,
): ReviewSource[] {
  return [
    ...collectC6Mistakes(snapshot, index).map((m): ReviewSource => {
      const exercise = exerciseReference(index, m.id);
      return {
        kind: 'exercise',
        packageRef: { ...exercise.packageRef },
        subjectRef: { ...exercise.ref },
        lessonRef: { ...exercise.lessonRef },
        learningRevision: 1,
        sourceVersion: m.revision,
        sourceAt: m.lastAt,
        state: m.repaired ? 'repaired' : 'active',
      };
    }),
    ...marks
      .filter((m) => isC6Mark(m, index))
      .map((m): ReviewSource => ({
        kind: 'knowledge',
        packageRef: { ...index.packageRef },
        subjectRef: { ...m.knowledgeRef },
        lessonRef: { ...m.lessonRef },
        learningRevision: 1,
        sourceVersion: m.revision,
        sourceAt: m.lastAt,
        state: m.marked ? 'active' : 'familiar',
      })),
  ];
}
export function deriveC6Weaknesses(
  snapshot: StorageSnapshot,
  marks: readonly KnowledgeMark[],
  index: C6LearningIndex,
  at: string,
): WeaknessSummary {
  const rows = new Map<string, WeaknessRow>();
  const get = (lessonId: string) => {
    const lesson = index.lessons.find((l) => l[0] === lessonId)!;
    let r = rows.get(lesson[3]);
    if (!r) {
      r = {
        knowledgeRef: { id: lesson[3], version: '2.0.0' },
        lessonRef: { id: lessonId, version: '2.0.0' },
        exerciseFailures: 0,
        recentFailures: 0,
        activeExercises: 0,
        challengeMistakes: 0,
        challengeStalled: false,
        manual: false,
        lastAt: at,
        evidence: [],
      };
      rows.set(lesson[3], r);
    }
    return r;
  };
  const events = c6ExerciseEvents(snapshot, index);
  for (const mistake of collectC6Mistakes(snapshot, index)) {
    const exercise = exerciseReference(index, mistake.id);
    const row = get(exercise.lessonRef.id);
    const receipts = events.filter((r) => r.subjectRef.id === exercise.ref.id);
    const lastPass = Math.max(
      0,
      ...receipts.filter((r) => r.eventType === 'exercise.passed').map((r) => r.committedRevision),
    );
    const failures = receipts.filter(
      (r) =>
        r.eventType === 'exercise.attempt-evaluated' &&
        Object.hasOwn(mistakeLabels, r.resultCategory),
    );
    const recent = failures.filter(
      (r) =>
        r.committedRevision > lastPass &&
        Date.parse(at) >= Date.parse(r.occurredAt) &&
        Date.parse(at) - Date.parse(r.occurredAt) <= windowMs,
    );
    const latest = failures.at(-1)!;
    row.exerciseFailures += failures.length;
    row.recentFailures += recent.length;
    row.activeExercises += Number(recent.length > 0);
    row.lastAt = mistake.lastAt;
    row.evidence.push({
      kind: 'exercise',
      sourceId: latest.eventId,
      sourceRef: { ...exercise.ref },
      at: latest.occurredAt,
      revision: latest.committedRevision,
      state: mistake.repaired ? 'repaired' : recent.length ? 'active' : 'expired',
      category: mistake.lastCategory,
      mapping: exercise.mapping,
    });
  }
  for (const mark of marks.filter((m) => isC6Mark(m, index))) {
    const row = get(mark.lessonRef.id);
    row.manual = mark.marked;
    row.lastAt = row.evidence.length && row.lastAt > mark.lastAt ? row.lastAt : mark.lastAt;
    row.evidence.push({
      kind: 'manual',
      sourceId: mark.commandId,
      sourceRef: { ...mark.knowledgeRef },
      at: mark.lastAt,
      revision: mark.revision,
      state: mark.marked ? 'active' : 'familiar',
      category: 'self-assessment',
      mapping: 'exact',
    });
  }
  const challengeSections: Record<string, string> = {
    'knowledge.c.output': '1.10.2',
    'knowledge.c.variables': '3.2',
    'knowledge.c.conditions': '7.1',
    'knowledge.c.loops': '6.2.1',
    'knowledge.c.arrays': '6.11.1',
    'knowledge.c.sorting': '6.11.1',
    'knowledge.c.binary-search': '10.1.4',
  };
  const latestChallenge = new Map<
    string,
    Extract<StorageSnapshot['receipts'][number], { eventType: 'challenge.answered' }>
  >();
  for (const r of snapshot.receipts)
    if (
      r.eventType === 'challenge.answered' &&
      r.packageRef.id === challengePackage.id &&
      r.packageRef.version === challengePackage.version &&
      r.learningRevision === 1 &&
      challengeQuestions.some(
        (q) => q.ref.id === r.subjectRef.id && q.ref.version === r.subjectRef.version,
      )
    ) {
      if ((latestChallenge.get(r.subjectRef.id)?.committedRevision ?? -1) < r.committedRevision)
        latestChallenge.set(r.subjectRef.id, r);
    }
  for (const r of latestChallenge.values()) {
    if (r.result === 'correct') continue;
    const section = challengeSections[challengeKnowledge(r.subjectRef.id) ?? ''];
    if (!section) continue;
    const row = get(`lesson.c6.s${section}`);
    const active =
      Date.parse(at) >= Date.parse(r.occurredAt) &&
      Date.parse(at) - Date.parse(r.occurredAt) <= windowMs;
    row.challengeMistakes += Number(active);
    row.evidence.push({
      kind: 'challenge',
      sourceId: r.eventId,
      sourceRef: { ...r.subjectRef },
      at: r.occurredAt,
      revision: r.committedRevision,
      state: active ? 'active' : 'expired',
      category: 'incorrect',
      mapping: 'foundation',
    });
  }
  for (const row of rows.values()) {
    row.challengeStalled = row.challengeMistakes >= 2;
    row.evidence = row.evidence
      .toSorted(
        (a, b) =>
          Date.parse(b.at) - Date.parse(a.at) ||
          b.revision - a.revision ||
          a.sourceId.localeCompare(b.sourceId),
      )
      .slice(0, 3);
    row.lastAt = row.evidence[0]?.at ?? row.lastAt;
  }
  return {
    weaknessVersion: '1.0.0',
    ruleVersion: weaknessRule,
    generation: snapshot.meta.generation,
    packageRef: { ...index.packageRef },
    observedDate: localDateAt(at, snapshot.meta.timeZone),
    sourceRevision: snapshot.meta.revision,
    rows: [...rows.values()].sort((a, b) => a.knowledgeRef.id.localeCompare(b.knowledgeRef.id)),
    unmapped: 0,
  };
}
