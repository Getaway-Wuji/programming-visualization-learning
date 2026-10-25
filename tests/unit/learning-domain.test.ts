import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ContentPackage } from '../../web/src/content/types';
import { catalogFromContent, createLearningCatalog } from '../../web/src/learning/catalog';
import {
  applyLearningEvent,
  canonicalLearningId,
  isCompatibleLearningHistory,
  projectLearning,
} from '../../web/src/learning/domain';
import type {
  LearningCatalog,
  LearningCommand,
  LearningInputEventType,
  LearningReceiptSummary,
} from '../../web/src/learning/types';
import { createMeta, emptySnapshot, recordKey } from '../../web/src/storage/model';
import type {
  Alias,
  GoalTargets,
  Progress,
  Ref,
  ResultCategory,
  StorageSnapshot,
} from '../../web/src/storage/model';
import { assertSnapshot } from '../../web/src/storage/validation';

const generation = '00000000-0000-4000-8000-000000000042';
const at = '2026-10-14T02:00:00.000Z';
const date = '2026-10-14';
const packageRef = { id: 'content.c.p0', version: '1.0.0' };
const lessonRef = { id: 'lesson.c.variables-output', version: '1.0.0' };
const exerciseRef = { id: 'exercise.c.echo', version: '1.0.0' };
const secondLessonRef = { id: 'lesson.c.expressions', version: '1.0.0' };
const secondExerciseRef = { id: 'exercise.c.two-x-plus-three', version: '1.0.0' };
const caseRef = { id: 'case.c.assignment', version: '1.0.0' };

function catalog(): LearningCatalog {
  const base = (ref: Ref) => ({ ref, learningRevision: 1, acceptedPriorVersions: [] });
  return createLearningCatalog({
    purpose: 'contract-fixture',
    packageRef,
    lessons: [
      { ...base(lessonRef), requiredExerciseRefs: [exerciseRef] },
      { ...base(secondLessonRef), requiredExerciseRefs: [secondExerciseRef] },
    ],
    exercises: [
      { ...base(exerciseRef), lessonRef, caseKeys: ['zero', 'negative'] },
      { ...base(secondExerciseRef), lessonRef: secondLessonRef, caseKeys: ['positive'] },
    ],
    cases: [base(caseRef)],
  });
}
function snapshot(targets: GoalTargets | null = { exercise: 1, lesson: 1, case: 0 }) {
  const value = emptySnapshot(
    createMeta({
      generation,
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: packageRef,
    }),
  );
  value.goals.push({ localDate: date, goalVersion: 1, targets, achievedAt: null });
  return value;
}
let sequence = 0;
function command(
  eventType: LearningInputEventType,
  subjectRef?: Ref,
  options: {
    occurredAt?: string;
    localDate?: string;
    resultCategory?: ResultCategory;
    failedCaseKey?: string | null;
  } = {},
): LearningCommand {
  sequence += 1;
  const results = {
    'lesson.started': 'started',
    'lesson.study-confirmed': 'confirmed',
    'exercise.attempt-evaluated': 'failed',
    'exercise.passed': 'passed',
    'case.view-confirmed': 'confirmed',
  } as const;
  return {
    generation,
    receipt: {
      eventId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      eventType,
      subjectRef: {
        ...(subjectRef ??
          (eventType.startsWith('lesson.')
            ? lessonRef
            : eventType.startsWith('exercise.')
              ? exerciseRef
              : caseRef)),
      },
      packageRef: { ...packageRef },
      learningRevision: 1,
      result: results[eventType],
      goalVersion: 1,
      occurredAt: options.occurredAt ?? at,
      localDate: options.localDate ?? date,
      ...(eventType === 'exercise.attempt-evaluated'
        ? {
            resultCategory: options.resultCategory ?? 'wrong-answer',
            failedCaseKey: options.failedCaseKey ?? null,
          }
        : {}),
    } as LearningReceiptSummary,
  };
}
// This helper only applies row deltas and the client's atomic root receipt. All
// expected learning outcomes below are explicit golden assertions, not a second model.
function commit(value: StorageSnapshot, event: LearningCommand, content = catalog()) {
  const delta = applyLearningEvent(value, event, content);
  const next = structuredClone(value);
  for (const operation of delta) {
    const rows = next[operation.store] as unknown[];
    const key = JSON.stringify(recordKey(operation.store, generation, operation.value as never));
    const index = rows.findIndex(
      (row) => JSON.stringify(recordKey(operation.store, generation, row as never)) === key,
    );
    if (index >= 0) rows[index] = structuredClone(operation.value);
    else rows.push(structuredClone(operation.value));
  }
  next.meta.revision += 1;
  next.receipts.push({ ...structuredClone(event.receipt), committedRevision: next.meta.revision });
  assertSnapshot(next);
  return next;
}
function progress(
  eventType: 'exercise.passed' | 'lesson.study-confirmed' | 'lesson.completed',
  subjectRef: Ref,
  learningRevision = 1,
): Progress {
  return {
    eventType,
    result:
      eventType === 'exercise.passed'
        ? 'passed'
        : eventType === 'lesson.study-confirmed'
          ? 'confirmed'
          : 'completed',
    subjectRef,
    packageRef,
    learningRevision,
    firstAt: at,
    lastAt: at,
  } as Progress;
}

describe('small validated learning catalog', () => {
  it('retains the shared fixture provenance and the exact six lessons/tests/seven cases', () => {
    const source = JSON.parse(
      readFileSync('项目文档/契约/02.1-内容样例.json', 'utf8'),
    ) as ContentPackage;
    const result = catalogFromContent(source);
    expect(result.purpose).toBe('contract-fixture');
    expect(result.packageRef).toEqual(packageRef);
    expect(result.lessons).toHaveLength(6);
    expect(result.exercises).toHaveLength(6);
    expect(result.cases).toHaveLength(7);
    expect(result.exercises[0].caseKeys).toEqual(
      source.exercises[0].tests.map((value) => value.caseKey),
    );
    expect(result.lessons[0].requiredExerciseRefs).toEqual(source.lessons[0].requiredExerciseRefs);
    expect(Object.isFrozen(result.lessons[0].requiredExerciseRefs[0])).toBe(true);
  });
  it('freezes an independent copy without freezing or changing the supplied public projection', () => {
    const source = structuredClone(catalog());
    const frozen = createLearningCatalog(source);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.exercises[0].caseKeys)).toBe(true);
    source.packageRef.version = '1.0.1';
    expect(frozen.packageRef.version).toBe('1.0.0');
  });
  it('permits an unavailable empty catalog for historical read projections', () => {
    const empty = createLearningCatalog({ ...catalog(), lessons: [], exercises: [], cases: [] });
    const value = snapshot();
    value.progress.push(progress('exercise.passed', exerciseRef));
    expect(projectLearning(value, empty).history).toEqual(value.progress);
    expect(projectLearning(value, empty).lessons).toEqual([]);
  });
  for (const mutation of [
    'empty-required',
    'wrong-exercise-version',
    'wrong-parent',
    'duplicate-id',
    'unknown-field',
  ] as const) {
    it(`rejects a malformed catalog: ${mutation}`, () => {
      const value = structuredClone(catalog()) as unknown as {
        lessons: { requiredExerciseRefs: Ref[] }[];
        exercises: { ref: Ref; lessonRef: Ref }[];
        cases: { ref: Ref }[];
      };
      if (mutation === 'empty-required') value.lessons[0].requiredExerciseRefs = [];
      if (mutation === 'wrong-exercise-version')
        value.lessons[0].requiredExerciseRefs[0] = { ...exerciseRef, version: '2.0.0' };
      if (mutation === 'wrong-parent') value.exercises[0].lessonRef = secondLessonRef;
      if (mutation === 'duplicate-id') value.cases.push(value.cases[0]);
      if (mutation === 'unknown-field') Object.assign(value, { input: 'private' });
      expect(() => createLearningCatalog(value as unknown as LearningCatalog)).toThrow(
        expect.objectContaining({ code: 'S_RECORD_INVALID' }),
      );
    });
  }
});

describe('closed learning transaction recipes with hand-written golden outcomes', () => {
  it('records started and explicit confirmation without granting completion or rewards', () => {
    const started = commit(snapshot(), command('lesson.started'));
    const confirmed = commit(started, command('lesson.study-confirmed'));
    expect(confirmed.progress.map((value) => value.eventType)).toEqual([
      'lesson.started',
      'lesson.study-confirmed',
    ]);
    expect(confirmed.dailyFacts).toEqual([]);
    expect(confirmed.ledger).toEqual([]);
    expect(projectLearning(confirmed, catalog()).lessons[0]).toMatchObject({
      started: true,
      studyConfirmed: true,
      completed: false,
    });
  });
  for (const confirmFirst of [true, false]) {
    it(`derives one complete lesson and three pending rights with confirmation ${confirmFirst ? 'before' : 'after'} pass`, () => {
      let value = snapshot();
      value = commit(value, command(confirmFirst ? 'lesson.study-confirmed' : 'exercise.passed'));
      const finalAt = '2026-10-14T02:01:00.000Z';
      const root = command(confirmFirst ? 'exercise.passed' : 'lesson.study-confirmed', undefined, {
        occurredAt: finalAt,
      });
      const delta = applyLearningEvent(value, root, catalog());
      expect(
        delta.every(
          (row) => !['meta', 'receipts', 'aliases', 'settings', 'avatar'].includes(row.store),
        ),
      ).toBe(true);
      expect(
        new Set(
          delta.map((row) =>
            JSON.stringify([row.store, recordKey(row.store, generation, row.value as never)]),
          ),
        ).size,
      ).toBe(delta.length);
      value = commit(value, root);
      expect(value.progress).toHaveLength(3);
      expect(value.progress.find((row) => row.eventType === 'lesson.completed')).toMatchObject({
        subjectRef: lessonRef,
        learningRevision: 1,
        firstAt: finalAt,
        lastAt: finalAt,
      });
      expect(value.dailyFacts.map((row) => row.eventType).sort()).toEqual([
        'exercise.passed',
        'lesson.completed',
      ]);
      expect(value.ledger.map((row) => row.sourceId).sort()).toEqual([
        'reward.daily-goal.once',
        'reward.exercise.first-pass',
        'reward.lesson.first-completion',
      ]);
      expect(
        value.ledger.every(
          (row) => row.status === 'pending' && row.points === null && row.policyRef === null,
        ),
      ).toBe(true);
      expect(value.goals[0].achievedAt).toBe(finalAt);
      expect(value.receipts).toHaveLength(2);
      expect(
        value.receipts.every(
          (row) => !['lesson.completed', 'daily-goal.achieved'].includes(row.eventType),
        ),
      ).toBe(true);
      expect(projectLearning(value, catalog()).ledger.totalPoints).toBe('0');
    });
  }
  it('requires all mandatory exercises, while an unlisted optional exercise cannot substitute', () => {
    const content = structuredClone(catalog());
    const third = { id: 'exercise.c.additional', version: '1.0.0' };
    const optional = { id: 'exercise.c.optional', version: '1.0.0' };
    const expanded = createLearningCatalog({
      ...content,
      lessons: content.lessons.map((row, index) =>
        index === 0 ? { ...row, requiredExerciseRefs: [exerciseRef, third] } : row,
      ),
      exercises: [
        ...content.exercises,
        ...[third, optional].map((ref) => ({
          ref,
          learningRevision: 1,
          acceptedPriorVersions: [],
          lessonRef,
          caseKeys: ['zero'],
        })),
      ],
    });
    let value = commit(snapshot(), command('lesson.study-confirmed'), expanded);
    value = commit(value, command('exercise.passed'), expanded);
    value = commit(value, command('exercise.passed', optional), expanded);
    expect(projectLearning(value, expanded).lessons[0].completed).toBe(false);
    value = commit(value, command('exercise.passed', third), expanded);
    expect(projectLearning(value, expanded).lessons[0].completed).toBe(true);
  });
  it('deduplicates first rights and same-day facts across independent root event IDs', () => {
    let value = commit(snapshot(null), command('exercise.passed'));
    value = commit(
      value,
      command('exercise.passed', undefined, { occurredAt: '2026-10-14T03:00:00.000Z' }),
    );
    value = commit(
      value,
      command('exercise.passed', undefined, { occurredAt: '2026-10-14T01:00:00.000Z' }),
    );
    expect(value.progress).toHaveLength(1);
    expect(value.progress[0]).toMatchObject({
      firstAt: '2026-10-14T01:00:00.000Z',
      lastAt: '2026-10-14T03:00:00.000Z',
    });
    expect(value.dailyFacts).toHaveLength(1);
    expect(value.ledger).toHaveLength(1);
    expect(value.receipts).toHaveLength(3);
    expect(value.goals[0].achievedAt).toBeNull();
  });
  it('uses new valid next-day facts for review without issuing another content first right', () => {
    let value = commit(snapshot(), command('lesson.study-confirmed'));
    value = commit(value, command('exercise.passed'));
    value.goals.push({
      localDate: '2026-10-15',
      goalVersion: 1,
      targets: { exercise: 0, lesson: 1, case: 0 },
      achievedAt: null,
    });
    value = commit(
      value,
      command('lesson.study-confirmed', undefined, {
        occurredAt: '2026-10-14T16:00:00.000Z',
        localDate: '2026-10-15',
      }),
    );
    expect(value.dailyFacts).toHaveLength(3);
    expect(value.dailyFacts[2]).toMatchObject({
      eventType: 'lesson.completed',
      localDate: '2026-10-15',
    });
    expect(value.ledger).toHaveLength(4);
    expect(
      value.ledger.filter((row) => row.sourceId === 'reward.lesson.first-completion'),
    ).toHaveLength(1);
    expect(value.goals[1].achievedAt).toBe('2026-10-14T16:00:00.000Z');
  });
  it('retains positive historical pass after a failed attempt, with only latest failure details', () => {
    let value = commit(snapshot(null), command('exercise.passed'));
    value = commit(
      value,
      command('exercise.attempt-evaluated', undefined, {
        occurredAt: '2026-10-14T04:00:00.000Z',
        resultCategory: 'resource-limit',
        failedCaseKey: 'negative',
      }),
    );
    value = commit(
      value,
      command('exercise.attempt-evaluated', undefined, {
        occurredAt: '2026-10-14T03:00:00.000Z',
        resultCategory: 'program-error',
        failedCaseKey: 'zero',
      }),
    );
    const projection = projectLearning(value, catalog());
    expect(projection.exercises[0].passed).toBe(true);
    expect(projection.exercises[0].latestAttempt).toMatchObject({
      firstAt: '2026-10-14T03:00:00.000Z',
      lastAt: '2026-10-14T04:00:00.000Z',
      resultCategory: 'resource-limit',
      failedCaseKey: 'negative',
    });
    expect(value.progress).toHaveLength(2);
    expect(value.dailyFacts).toHaveLength(1);
    expect(value.ledger).toHaveLength(1);
    expect(value.receipts).toHaveLength(3);
  });
  it('updates the latest failure when a newer attempt arrives and keeps only public result summaries', () => {
    let value = commit(snapshot(null), command('exercise.attempt-evaluated'));
    value = commit(
      value,
      command('exercise.attempt-evaluated', undefined, {
        occurredAt: '2026-10-14T05:00:00.000Z',
        resultCategory: 'cancelled',
      }),
    );
    expect(value.progress).toHaveLength(1);
    expect(value.progress[0]).toMatchObject({
      resultCategory: 'cancelled',
      failedCaseKey: null,
      lastAt: '2026-10-14T05:00:00.000Z',
    });
    expect(value.dailyFacts).toEqual([]);
    expect(value.ledger).toEqual([]);
    expect(Object.keys(value.progress[0]).sort()).toEqual([
      'eventType',
      'failedCaseKey',
      'firstAt',
      'lastAt',
      'learningRevision',
      'packageRef',
      'result',
      'resultCategory',
      'subjectRef',
    ]);
  });
  it('counts a confirmed case independently without completing its related lesson', () => {
    const value = commit(
      snapshot({ exercise: 0, lesson: 0, case: 1 }),
      command('case.view-confirmed'),
    );
    expect(value.progress).toHaveLength(1);
    expect(value.dailyFacts).toHaveLength(1);
    expect(value.ledger.map((row) => row.sourceId)).toEqual([
      'reward.case.first-view',
      'reward.daily-goal.once',
    ]);
    expect(projectLearning(value, catalog()).cases[0].viewConfirmed).toBe(true);
    expect(projectLearning(value, catalog()).lessons[0].completed).toBe(false);
  });
  it('sets achievement to the triggering late fact time and never revises an already achieved day', () => {
    let value = commit(
      snapshot({ exercise: 2, lesson: 0, case: 0 }),
      command('exercise.passed', undefined, { occurredAt: '2026-10-14T04:00:00.000Z' }),
    );
    expect(value.goals[0].achievedAt).toBeNull();
    value = commit(
      value,
      command('exercise.passed', secondExerciseRef, { occurredAt: '2026-10-14T03:00:00.000Z' }),
    );
    expect(value.goals[0].achievedAt).toBe('2026-10-14T03:00:00.000Z');
    value = commit(
      value,
      command('case.view-confirmed', undefined, { occurredAt: '2026-10-14T02:00:00.000Z' }),
    );
    expect(value.goals[0].achievedAt).toBe('2026-10-14T03:00:00.000Z');
    expect(value.ledger.filter((row) => row.sourceId === 'reward.daily-goal.once')).toHaveLength(1);
  });
  it('leaves the supplied snapshot and fixed command untouched', () => {
    const value = snapshot();
    const event = command('exercise.passed');
    const before = structuredClone({ value, event });
    applyLearningEvent(value, event, catalog());
    expect({ value, event }).toEqual(before);
  });
  it('rejects accessor receipts without running an accessor during a storage recipe', () => {
    const event = command('exercise.passed');
    let called = false;
    Object.defineProperty(event.receipt, 'subjectRef', {
      enumerable: true,
      get() {
        called = true;
        return exerciseRef;
      },
    });
    expect(() => applyLearningEvent(snapshot(), event, catalog())).toThrow(
      expect.objectContaining({ code: 'S_RECORD_INVALID' }),
    );
    expect(called).toBe(false);
  });
  it('preserves old package provenance in a shared row while accepting a new exact current package receipt', () => {
    let value = commit(snapshot(null), command('exercise.passed'));
    const current = createLearningCatalog({
      ...catalog(),
      packageRef: { ...packageRef, version: '1.0.1' },
    });
    const event = command('exercise.passed', undefined, { occurredAt: '2026-10-14T03:00:00.000Z' });
    event.receipt.packageRef.version = '1.0.1';
    value = commit(value, event, current);
    expect(value.progress[0].packageRef.version).toBe('1.0.0');
    expect(value.receipts[1].packageRef?.version).toBe('1.0.1');
    expect(value.ledger).toHaveLength(1);
  });
  for (const defect of [
    'missing-goal',
    'goal-version',
    'date',
    'generation',
    'content-version',
    'content-revision',
    'package',
    'case-key',
    'extra-command',
    'extra-evidence',
    'derived-completion',
    'derived-day',
  ] as const) {
    it(`rejects a command with ${defect} before producing any writes`, () => {
      const value = snapshot();
      const event = command(
        defect === 'case-key' ? 'exercise.attempt-evaluated' : 'exercise.passed',
      );
      if (defect === 'missing-goal') value.goals = [];
      if (defect === 'goal-version') event.receipt.goalVersion = 2;
      if (defect === 'date') event.receipt.localDate = '2026-10-15';
      if (defect === 'generation')
        (event as { generation: string }).generation = '00000000-0000-4000-8000-000000000099';
      if (defect === 'content-version') event.receipt.subjectRef.version = '1.0.1';
      if (defect === 'content-revision') event.receipt.learningRevision = 2;
      if (defect === 'package') event.receipt.packageRef.version = '1.0.1';
      if (defect === 'case-key') Object.assign(event.receipt, { failedCaseKey: 'not-public' });
      if (defect === 'extra-command') Object.assign(event, { validated: true });
      if (defect === 'extra-evidence') Object.assign(event.receipt, { source: 'int main(){}' });
      if (defect === 'derived-completion')
        Object.assign(event.receipt, {
          eventType: 'lesson.completed',
          subjectRef: lessonRef,
          result: 'completed',
        });
      if (defect === 'derived-day')
        Object.assign(event.receipt, {
          eventType: 'daily-goal.achieved',
          subjectRef: { id: `local-goal.${date}`, version: '1' },
          packageRef: null,
          learningRevision: null,
          result: 'achieved',
        });
      const before = structuredClone(value);
      expect(() => applyLearningEvent(value, event, catalog())).toThrow();
      expect(value).toEqual(before);
    });
  }
});

describe('current compatibility and historical projection', () => {
  it('accepts explicit prior versions but keeps changed revisions and unlisted versions historical', () => {
    const current = structuredClone(catalog());
    const changed = createLearningCatalog({
      ...current,
      exercises: current.exercises.map((row, index) =>
        index === 0
          ? { ...row, ref: { ...row.ref, version: '1.0.1' }, acceptedPriorVersions: ['1.0.0'] }
          : row,
      ),
      lessons: current.lessons.map((row, index) =>
        index === 0
          ? { ...row, requiredExerciseRefs: [{ ...exerciseRef, version: '1.0.1' }] }
          : row,
      ),
    });
    const value = snapshot();
    value.progress.push(
      progress('exercise.passed', exerciseRef),
      progress('lesson.study-confirmed', lessonRef),
    );
    expect(projectLearning(value, changed).lessons[0].completed).toBe(true);
    const revision = createLearningCatalog({
      ...changed,
      exercises: changed.exercises.map((row, index) =>
        index === 0 ? { ...row, learningRevision: 2 } : row,
      ),
    });
    expect(projectLearning(value, revision).exercises[0]).toMatchObject({
      passed: false,
      history: [value.progress[0]],
    });
    expect(projectLearning(value, revision).lessons[0].completed).toBe(false);
    value.progress[0].subjectRef.version = '0.9.9';
    expect(projectLearning(value, changed).exercises[0].passed).toBe(false);
    expect(projectLearning(value, changed).history).toHaveLength(2);
  });
  it('does not let a historical completed row replace the current confirmation/required-pass predicate', () => {
    const value = snapshot();
    value.progress.push(progress('lesson.completed', lessonRef));
    const before = structuredClone(value);
    expect(projectLearning(value, catalog()).lessons[0]).toMatchObject({
      completed: false,
      studyConfirmed: false,
    });
    expect(value).toEqual(before);
    expect(value.dailyFacts).toEqual([]);
    expect(value.ledger).toEqual([]);
  });
  it('retains deleted subject history and pending/posted ledger rows without inventing rewards', () => {
    const value = snapshot();
    value.progress.push(
      progress('exercise.passed', { id: 'exercise.c.deleted', version: '1.0.0' }),
    );
    value.ledger.push({
      sourceId: 'reward.exercise.first-pass',
      subjectId: 'exercise.c.deleted',
      localDate: date,
      occurredAt: at,
      status: 'pending',
      points: null,
      policyRef: null,
    });
    const projection = projectLearning(value, catalog());
    expect(projection.history).toEqual(value.progress);
    expect(projection.ledger.history).toEqual(value.ledger);
    expect(projection.exercises.every((row) => !row.passed)).toBe(true);
  });
  it('sums individually safe posted numbers with exact BigInt precision, excluding pending', () => {
    const value = snapshot();
    value.progress.push(
      progress('exercise.passed', exerciseRef),
      progress('exercise.passed', secondExerciseRef),
      progress('lesson.completed', lessonRef),
    );
    for (const ref of [exerciseRef, secondExerciseRef])
      value.ledger.push({
        sourceId: 'reward.exercise.first-pass',
        subjectId: ref.id,
        localDate: date,
        occurredAt: at,
        status: 'posted',
        points: Number.MAX_SAFE_INTEGER,
        policyRef: { id: 'policy.fixture.p0', version: '1.0.0' },
      });
    value.ledger.push({
      sourceId: 'reward.lesson.first-completion',
      subjectId: lessonRef.id,
      localDate: date,
      occurredAt: at,
      status: 'pending',
      points: null,
      policyRef: null,
    });
    const projection = projectLearning(value, catalog());
    expect(projection.ledger.totalPoints).toBe('18014398509481982');
    expect(projection.ledger.pending).toHaveLength(1);
    expect(projection.ledger.history).toHaveLength(3);
    projection.avatar.accentColor = '#123456';
    projection.ledger.history[0].subjectId = 'exercise.c.changed';
    expect(value.avatar.accentColor).toBe('#168A72');
    expect(value.ledger[0].subjectId).toBe(exerciseRef.id);
  });
  it('reports counts, remaining target and current content reachability without rewriting a frozen goal', () => {
    const value = commit(snapshot({ exercise: 3, lesson: 0, case: 1 }), command('exercise.passed'));
    const projection = projectLearning(value, catalog());
    expect(projection.goals[0]).toMatchObject({
      counts: { exercise: 1, lesson: 0, case: 0 },
      remaining: { exercise: 2, lesson: 0, case: 1 },
      reachable: false,
      achievedAt: null,
    });
    expect(value.goals[0].targets).toEqual({ exercise: 3, lesson: 0, case: 1 });
  });
  it('preserves a deleted subject day fact toward an already frozen target reachability', () => {
    let value = snapshot({ exercise: 3, lesson: 0, case: 0 });
    const removedRef = { id: 'exercise.c.deleted', version: '1.0.0' };
    value.progress.push(progress('exercise.passed', removedRef));
    value.dailyFacts.push({
      eventType: 'exercise.passed',
      subjectRef: removedRef,
      canonicalSubjectId: removedRef.id,
      occurredAt: at,
      localDate: date,
    });
    expect(projectLearning(value, catalog()).goals[0]).toMatchObject({
      counts: { exercise: 1, lesson: 0, case: 0 },
      reachable: true,
      achievedAt: null,
    });
    value = commit(value, command('exercise.passed'));
    value = commit(value, command('exercise.passed', secondExerciseRef));
    expect(projectLearning(value, catalog()).goals[0]).toMatchObject({
      counts: { exercise: 3, lesson: 0, case: 0 },
      reachable: true,
      achievedAt: at,
    });
  });
  it('checks every exact alias edge while canonical keys retain the earliest identity', () => {
    const aliases: Alias[] = [
      {
        fromRef: exerciseRef,
        toRef: { id: 'exercise.c.rename-one', version: '1.0.1' },
        fromAcceptedPriorVersions: ['0.9.0'],
        kind: 'exercise',
        learningRevision: 1,
        manifestRef: { id: 'manifest.fixture.one', version: '1.0.0' },
      },
      {
        fromRef: { id: 'exercise.c.rename-one', version: '1.1.0' },
        toRef: { id: 'exercise.c.rename-two', version: '1.0.0' },
        fromAcceptedPriorVersions: ['1.0.1'],
        kind: 'exercise',
        learningRevision: 1,
        manifestRef: { id: 'manifest.fixture.two', version: '1.0.0' },
      },
    ];
    const entity = {
      ref: { id: 'exercise.c.rename-two', version: '1.0.1' },
      learningRevision: 1,
      acceptedPriorVersions: ['1.0.0'],
    };
    expect(canonicalLearningId(aliases, entity.ref.id)).toBe(exerciseRef.id);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', exerciseRef),
        entity,
        'exercise',
        aliases,
      ),
    ).toBe(true);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', { ...exerciseRef, version: '0.9.0' }),
        entity,
        'exercise',
        aliases,
      ),
    ).toBe(true);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', { ...exerciseRef, version: '0.9.1' }),
        entity,
        'exercise',
        aliases,
      ),
    ).toBe(false);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', { id: 'exercise.c.rename-one', version: '0.8.0' }),
        entity,
        'exercise',
        aliases,
      ),
    ).toBe(false);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', exerciseRef, 2),
        entity,
        'exercise',
        aliases,
      ),
    ).toBe(false);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', { id: 'exercise.c.rename-two', version: '0.9.9' }),
        entity,
        'exercise',
        aliases,
      ),
    ).toBe(false);
    const undeclared = structuredClone(aliases);
    undeclared[1].fromAcceptedPriorVersions = [];
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', exerciseRef),
        entity,
        'exercise',
        undeclared,
      ),
    ).toBe(false);
  });
  it('keeps exact and explicitly compatible current source or intermediate refs valid before later aliases', () => {
    const middle = { id: 'exercise.c.middle', version: '1.0.0' };
    const final = { id: 'exercise.c.final', version: '1.0.0' };
    const aliases: Alias[] = [
      {
        fromRef: exerciseRef,
        toRef: middle,
        fromAcceptedPriorVersions: [],
        kind: 'exercise',
        learningRevision: 1,
        manifestRef: { id: 'manifest.fixture.middle', version: '1.0.0' },
      },
      {
        fromRef: middle,
        toRef: final,
        fromAcceptedPriorVersions: [],
        kind: 'exercise',
        learningRevision: 1,
        manifestRef: { id: 'manifest.fixture.final', version: '1.0.0' },
      },
    ];
    const sourceEntity = { ref: exerciseRef, learningRevision: 1, acceptedPriorVersions: [] };
    const middleEntity = { ref: middle, learningRevision: 1, acceptedPriorVersions: [] };
    const middlePatch = {
      ref: { ...middle, version: '1.0.1' },
      learningRevision: 1,
      acceptedPriorVersions: ['1.0.0', '0.9.0'],
    };
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', exerciseRef),
        sourceEntity,
        'exercise',
        aliases,
      ),
    ).toBe(true);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', exerciseRef),
        middleEntity,
        'exercise',
        aliases,
      ),
    ).toBe(true);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', exerciseRef),
        middlePatch,
        'exercise',
        aliases,
      ),
    ).toBe(true);
    // The active entity explicitly accepts this patch even though the future alias
    // does not: no future edge is needed once the active current ref is reached.
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', { ...middle, version: '0.9.0' }),
        middlePatch,
        'exercise',
        aliases,
      ),
    ).toBe(true);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', { ...middle, version: '0.9.1' }),
        middlePatch,
        'exercise',
        aliases,
      ),
    ).toBe(false);
    expect(
      isCompatibleLearningHistory(
        progress('exercise.passed', exerciseRef, 2),
        middleEntity,
        'exercise',
        aliases,
      ),
    ).toBe(false);
    const value = snapshot(null);
    value.progress.push(progress('exercise.passed', exerciseRef));
    value.aliases = aliases;
    const current = catalog();
    const activeMiddle = createLearningCatalog({
      ...current,
      exercises: current.exercises.map((entry, index) =>
        index === 0 ? { ...entry, ref: middle } : entry,
      ),
      lessons: current.lessons.map((entry, index) =>
        index === 0 ? { ...entry, requiredExerciseRefs: [middle] } : entry,
      ),
    });
    expect(projectLearning(value, activeMiddle).exercises[0].passed).toBe(true);
    expect(projectLearning(value, current).exercises[0].passed).toBe(true);
    expect(value.progress[0].subjectRef).toEqual(exerciseRef);
    expect(value.ledger).toEqual([]);
    expect(value.dailyFacts).toEqual([]);
  });
  it('uses old canonical identity for new renamed facts and retains old history without repeating first awards', () => {
    const value = snapshot(null);
    value.progress.push(progress('exercise.passed', exerciseRef));
    value.ledger.push({
      sourceId: 'reward.exercise.first-pass',
      subjectId: exerciseRef.id,
      localDate: date,
      occurredAt: at,
      status: 'pending',
      points: null,
      policyRef: null,
    });
    const renamed = { id: 'exercise.c.renamed', version: '1.0.0' };
    value.aliases.push({
      fromRef: exerciseRef,
      toRef: renamed,
      fromAcceptedPriorVersions: [],
      kind: 'exercise',
      learningRevision: 1,
      manifestRef: { id: 'manifest.fixture.rename', version: '1.0.0' },
    });
    const content = catalog();
    const current = createLearningCatalog({
      ...content,
      exercises: content.exercises.map((row, index) =>
        index === 0 ? { ...row, ref: renamed } : row,
      ),
      lessons: content.lessons.map((row, index) =>
        index === 0 ? { ...row, requiredExerciseRefs: [renamed] } : row,
      ),
    });
    const next = commit(value, command('exercise.passed', renamed), current);
    expect(next.progress).toHaveLength(2);
    expect(next.progress[0].subjectRef).toEqual(exerciseRef);
    expect(next.dailyFacts[0]).toMatchObject({
      subjectRef: renamed,
      canonicalSubjectId: exerciseRef.id,
    });
    expect(next.ledger).toHaveLength(1);
    expect(projectLearning(next, current).exercises[0].history).toHaveLength(2);
  });
});
