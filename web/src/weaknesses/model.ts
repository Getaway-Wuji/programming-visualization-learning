import type { Ref, StorageSnapshot, Progress, ContentReceipt, Receipt } from '../storage/model';
import type { KnowledgeMark } from '../storage/knowledge-marks';
import type { LearningCatalog } from '../learning/types';
import type { CourseReading } from '../content/reading';
import type { CoursePractice } from '../content/practice';
import { sameRef } from '../learning/catalog';
import { isCompatibleLearningHistory } from '../learning/domain';
import { reviewedDurableSnapshot } from '../learning/reviewed-release';
import { memoryBugQuestions } from '../memory-bugs/content';
import { challengePackage, challengeQuestions } from '../challenges/content';
import { mistakeLabels, type MistakeCategory } from '../review-notebook/model';
import { StorageError } from '../storage/errors';
import {
  assertPublicRef,
  isLocalDate,
  isPositiveInt,
  isSafeUint,
  isUtcTime,
  isUuid,
  localDateAt,
  validationInternals,
} from '../storage/validation';

export const weaknessRule = 'local-evidence-1' as const;
export const windowMs = 30 * 24 * 60 * 60 * 1000;
export interface WeaknessEvidence {
  kind: 'exercise' | 'challenge' | 'manual';
  sourceId: string;
  sourceRef: Ref;
  at: string;
  revision: number;
  state: 'active' | 'repaired' | 'expired' | 'familiar';
  category: MistakeCategory | 'incorrect' | 'self-assessment' | null;
  mapping: 'exact' | 'foundation';
}
export interface WeaknessRow {
  knowledgeRef: Ref;
  lessonRef: Ref;
  exerciseFailures: number;
  recentFailures: number;
  activeExercises: number;
  challengeMistakes: number;
  challengeStalled: boolean;
  manual: boolean;
  lastAt: string;
  evidence: WeaknessEvidence[];
}
export interface WeaknessSummary {
  weaknessVersion: '1.0.0';
  ruleVersion: typeof weaknessRule;
  generation: string;
  packageRef: Ref;
  observedDate: string;
  sourceRevision: number;
  rows: WeaknessRow[];
  unmapped: number;
}
// Authored relationships: exact stable case identities, never title matching.
const actionKnowledge: Readonly<Record<string, string>> = {
  'case.c.assignment': 'knowledge.c.variables',
  'case.c.branch': 'knowledge.c.conditions',
  'case.c.loops': 'knowledge.c.loops',
  'case.c.array-traversal': 'knowledge.c.arrays',
  'case.c.bubble-sort': 'knowledge.c.sorting',
  'case.c.selection-sort': 'knowledge.c.sorting',
  'case.c.binary-search-first': 'knowledge.c.binary-search',
};
export function challengeKnowledge(id: string) {
  const q = challengeQuestions.find((q) => q.ref.id === id);
  return q
    ? q.anchorKind === 'output.append'
      ? 'knowledge.c.output'
      : q.anchorKind === 'value.initialize'
        ? 'knowledge.c.variables'
        : actionKnowledge[q.caseId]
    : undefined;
}
export function weaknessReasons(row: WeaknessRow): string[] {
  return [
    row.manual ? '你仍将此知识标为陌生（手动自评）' : '',
    row.recentFailures >= 2
      ? `最近30天、最近通过后有${row.recentFailures}次真实失败，建议复习关联知识`
      : row.recentFailures
        ? '最近30天有尚未修复的真实练习错误'
        : '',
    row.challengeStalled
      ? `最近30天有${row.challengeMistakes}道不同挑战题仍误答，达到卡壳规则（至少2题）`
      : row.challengeMistakes
        ? '有1道挑战题仍误答，作为复习线索'
        : '',
  ].filter(Boolean);
}

export function deriveWeaknesses(
  snapshot: StorageSnapshot,
  marks: readonly KnowledgeMark[],
  catalog: LearningCatalog,
  reading: CourseReading,
  practice: CoursePractice,
  at: string,
): WeaknessSummary {
  if (
    !isUtcTime(at) ||
    !sameRef(practice.packageRef, catalog.packageRef) ||
    !sameRef(reading.packageRef, catalog.packageRef)
  )
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  const now = Date.parse(at),
    recent = (time: string) => now >= Date.parse(time) && now - Date.parse(time) <= windowMs;
  const rows = new Map<string, WeaknessRow>();
  let unmapped = 0;
  const rowFor = (knowledgeRef: Ref, lessonRef: Ref) => {
    if (
      !reading.knowledgePoints.some((k) => sameRef(k, knowledgeRef)) ||
      !reading.lessons.some(
        (l) => sameRef(l, lessonRef) && l.knowledgeRefs.some((k) => sameRef(k, knowledgeRef)),
      )
    )
      return null;
    let row = rows.get(knowledgeRef.id);
    if (!row) {
      row = {
        knowledgeRef: { id: knowledgeRef.id, version: knowledgeRef.version },
        lessonRef: { id: lessonRef.id, version: lessonRef.version },
        exerciseFailures: 0,
        recentFailures: 0,
        activeExercises: 0,
        challengeMistakes: 0,
        challengeStalled: false,
        manual: false,
        lastAt: at,
        evidence: [],
      };
      rows.set(knowledgeRef.id, row);
    }
    return row;
  };
  const add = (row: WeaknessRow, e: WeaknessEvidence) => {
    row.evidence.push(e);
    if (row.evidence.length === 1 || e.at > row.lastAt) row.lastAt = e.at;
  };
  const events = [...new Map(snapshot.receipts.map((r) => [r.eventId, r])).values()].filter(
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
  const groups = new Map<string, typeof events>();
  events.forEach((r, i) => {
    const e = approved.has(progress[i])
      ? catalog.exercises.find((e) =>
          isCompatibleLearningHistory(progress[i], e, 'exercise', snapshot.aliases),
        )
      : undefined;
    if (!e) {
      if (
        r.eventType === 'exercise.attempt-evaluated' &&
        Object.hasOwn(mistakeLabels, r.resultCategory)
      )
        unmapped++;
      return;
    }
    groups.set(e.ref.id, [...(groups.get(e.ref.id) ?? []), r]);
  });
  for (const [id, receipts] of groups) {
    const e = catalog.exercises.find((e) => e.ref.id === id)!;
    const published = practice.exercises.find(
      (p) => sameRef(p, e.ref) && p.learningRevision === e.learningRevision,
    );
    const memory = memoryBugQuestions.find(
      (q) => sameRef(q.exerciseRef, e.ref) && sameRef(q.lessonRef, e.lessonRef),
    );
    const lesson = reading.lessons.find((l) => sameRef(l, e.lessonRef));
    const knowledge = published?.knowledgeRefs ?? (memory ? lesson?.knowledgeRefs : undefined);
    const failures = receipts.filter(
      (r) =>
        r.eventType === 'exercise.attempt-evaluated' &&
        Object.hasOwn(mistakeLabels, r.resultCategory),
    );
    if (!failures.length) continue;
    const mapped = [...new Map((knowledge ?? []).map((k) => [k.id, k])).values()]
      .map((k) => rowFor(k, e.lessonRef))
      .filter((r): r is WeaknessRow => !!r);
    if (!mapped.length) {
      unmapped += failures.length;
      continue;
    }
    const pass = Math.max(
      0,
      ...receipts.filter((r) => r.eventType === 'exercise.passed').map((r) => r.committedRevision),
    );
    const active = failures.filter((r) => r.committedRevision > pass && recent(r.occurredAt));
    const latest = failures.toSorted((a, b) => b.committedRevision - a.committedRevision)[0];
    for (const row of mapped) {
      row.exerciseFailures += failures.length;
      row.recentFailures += active.length;
      row.activeExercises += Number(active.length > 0);
      add(row, {
        kind: 'exercise',
        sourceId: latest.eventId,
        sourceRef: { ...e.ref },
        at: latest.occurredAt,
        revision: latest.committedRevision,
        state: latest.committedRevision < pass ? 'repaired' : active.length ? 'active' : 'expired',
        category:
          latest.eventType === 'exercise.attempt-evaluated'
            ? (latest.resultCategory as MistakeCategory)
            : null,
        mapping: published ? 'exact' : 'foundation',
      });
    }
  }
  const challenge = new Map<string, Extract<Receipt, { eventType: 'challenge.answered' }>>();
  for (const r of snapshot.receipts)
    if (r.eventType === 'challenge.answered') {
      const q = challengeQuestions.find((q) => sameRef(q.ref, r.subjectRef));
      if (!sameRef(r.packageRef, challengePackage) || r.learningRevision !== 1 || !q) {
        unmapped++;
        continue;
      }
      const old = challenge.get(q.ref.id);
      if (!old || old.committedRevision < r.committedRevision) challenge.set(q.ref.id, r);
    }
  for (const r of challenge.values()) {
    const id = challengeKnowledge(r.subjectRef.id),
      k = reading.knowledgePoints.find((k) => k.id === id && k.version === '1.0.0');
    const lesson = k && reading.lessons.find((l) => l.knowledgeRefs.some((ref) => sameRef(ref, k)));
    const row = k && lesson ? rowFor(k, lesson) : null;
    if (!row) {
      unmapped++;
      continue;
    }
    // A correct-only question is not a weakness history.
    if (r.result === 'correct') continue;
    const active = recent(r.occurredAt);
    row.challengeMistakes += Number(active);
    add(row, {
      kind: 'challenge',
      sourceId: r.eventId,
      sourceRef: { ...r.subjectRef },
      at: r.occurredAt,
      revision: r.committedRevision,
      state: active ? 'active' : 'expired',
      category: 'incorrect',
      mapping: 'exact',
    });
  }
  for (const mark of marks) {
    const row = sameRef(mark.packageRef, reading.packageRef)
      ? rowFor(mark.knowledgeRef, mark.lessonRef)
      : null;
    if (!row) {
      unmapped++;
      continue;
    }
    row.manual = mark.marked;
    add(row, {
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
  }
  return {
    weaknessVersion: '1.0.0',
    ruleVersion: weaknessRule,
    generation: snapshot.meta.generation,
    packageRef: { ...catalog.packageRef },
    observedDate: localDateAt(at, snapshot.meta.timeZone),
    sourceRevision: snapshot.meta.revision,
    rows: [...rows.values()]
      .filter((r) => r.evidence.length)
      .sort((a, b) => a.knowledgeRef.id.localeCompare(b.knowledgeRef.id)),
    unmapped,
  };
}

const requireRule = (valid: unknown) => {
  if (!valid) throw new StorageError('S_RECORD_INVALID');
};
export function assertWeaknessSummary(value: unknown): asserts value is WeaknessSummary {
  const { row } = validationInternals;
  const s = row(value, [
    'weaknessVersion',
    'ruleVersion',
    'generation',
    'packageRef',
    'observedDate',
    'sourceRevision',
    'rows',
    'unmapped',
  ]);
  if (s.weaknessVersion !== '1.0.0' || s.ruleVersion !== weaknessRule)
    throw new StorageError('S_VERSION_UNKNOWN');
  requireRule(
    isUuid(s.generation) &&
      isLocalDate(s.observedDate) &&
      isSafeUint(s.sourceRevision) &&
      isSafeUint(s.unmapped),
  );
  assertPublicRef(s.packageRef);
  requireRule(Array.isArray(s.rows) && s.rows.length <= 1000);
  const ids = new Set<string>();
  for (const item of s.rows as unknown[]) {
    const r = row(item, [
      'knowledgeRef',
      'lessonRef',
      'exerciseFailures',
      'recentFailures',
      'activeExercises',
      'challengeMistakes',
      'challengeStalled',
      'manual',
      'lastAt',
      'evidence',
    ]);
    assertPublicRef(r.knowledgeRef);
    assertPublicRef(r.lessonRef);
    requireRule(!ids.has(r.knowledgeRef.id));
    ids.add(r.knowledgeRef.id);
    for (const key of [
      'exerciseFailures',
      'recentFailures',
      'activeExercises',
      'challengeMistakes',
    ])
      requireRule(isSafeUint(r[key]));
    requireRule(
      typeof r.manual === 'boolean' &&
        typeof r.challengeStalled === 'boolean' &&
        isUtcTime(r.lastAt) &&
        Array.isArray(r.evidence) &&
        r.evidence.length <= 3,
    );
    for (const item of r.evidence as unknown[]) {
      const e = row(item, [
        'kind',
        'sourceId',
        'sourceRef',
        'at',
        'revision',
        'state',
        'category',
        'mapping',
      ]);
      assertPublicRef(e.sourceRef);
      requireRule(
        ['exercise', 'challenge', 'manual'].includes(e.kind as string) &&
          isUuid(e.sourceId) &&
          isUtcTime(e.at) &&
          isPositiveInt(e.revision) &&
          ['active', 'repaired', 'expired', 'familiar'].includes(e.state as string) &&
          ['exact', 'foundation'].includes(e.mapping as string) &&
          (e.category === null ||
            [
              'wrong-answer',
              'teaching-goal-unmet',
              'program-error',
              'incorrect',
              'self-assessment',
            ].includes(e.category as string)),
      );
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 2097152)
    throw new StorageError('S_QUOTA');
}
