import type { C6LearningCommand } from '../../web/src/c6-learning/model';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validateC6LearningIndex } from '../../web/src/c6-learning';
import { parseC6TeachingManifest } from '../../web/src/content/c6-teaching-validator.mjs';
import { c6TeachingRelease } from '../../web/src/content/c6-teaching-release.generated';
import { applyLearningEvent, projectC6Learning } from '../../web/src/learning/domain';
import type { LearningReceiptSummary } from '../../web/src/learning/types';
import type { LearningCatalog } from '../../web/src/learning/types';
import { c6LearningCatalog } from '../../web/src/c6-learning';
import { prepareC6Event } from '../../web/src/c6-learning/recipe';
import type { C6Attempt } from '../../web/src/c6-learning/model';
import { c6LearningRelease } from '../../web/src/c6-learning/release.generated';
import { createC6ResetMeta } from '../../web/src/storage/c6-reset';
import { emptySnapshot, recordKey } from '../../web/src/storage/model';
import { assertC6CourseState, type C6CourseState } from '../../web/src/storage/c6-course';
import {
  collectC6Mistakes,
  c6ReviewSources,
  deriveC6Weaknesses,
} from '../../web/src/c6-learning/review';
import { assertWeaknessSummary } from '../../web/src/weaknesses/model';

const manifest = await parseC6TeachingManifest(
  Uint8Array.from(
    readFileSync(new URL('../../content/c/primer6-teaching/manifest-2.0.0.json', import.meta.url)),
  ),
  c6TeachingRelease.manifestSha256,
);
const index = validateC6LearningIndex(
  JSON.parse(
    readFileSync(
      new URL('../../content/c/primer6-learning/index-1.0.0.json', import.meta.url),
      'utf8',
    ),
  ),
  manifest,
);
const generation = '00000000-0000-4000-8000-000000000021';
const at = '2026-11-03T00:00:00.000Z';
function fresh(): C6CourseState {
  const snapshot = emptySnapshot(createC6ResetMeta(generation, 'Asia/Shanghai', at));
  snapshot.goals.push({ localDate: '2026-11-03', goalVersion: 1, targets: null, achievedAt: null });
  return { snapshot, rows: { activities: [], drafts: [] } };
}
function command(
  subjectId: string,
  type:
    'lesson.started' | 'lesson.study-confirmed' | 'exercise.passed' | 'exercise.attempt-evaluated',
): C6LearningCommand {
  return {
    learnVersion: '2.0.0',
    generation,
    receipt: {
      eventId: crypto.randomUUID(),
      eventType: type,
      subjectRef: { id: subjectId, version: '2.0.0' },
      packageRef: { ...index.packageRef },
      learningRevision: 1,
      result:
        type === 'lesson.started'
          ? 'started'
          : type === 'lesson.study-confirmed'
            ? 'confirmed'
            : type === 'exercise.passed'
              ? 'passed'
              : 'failed',
      goalVersion: 1,
      occurredAt: at,
      localDate: '2026-11-03',
      ...(type === 'exercise.attempt-evaluated'
        ? { resultCategory: 'wrong-answer', failedCaseKey: 'case-1' }
        : {}),
    } as LearningReceiptSummary,
  };
}
// Domain-only fixture: these summaries are not accepted by the private production authority.
function fixtureAttempt(cmd: C6LearningCommand): C6Attempt {
  const exercise = index.exercises.find((e) => e[0] === cmd.receipt.subjectRef.id)!;
  return {
    eventId: cmd.receipt.eventId,
    at,
    sourceRevision: crypto.randomUUID(),
    sourceSha256: '1'.repeat(64),
    requestSha256: '2'.repeat(64),
    resultSha256: '3'.repeat(64),
    engineBuildSha256: c6LearningRelease.engineBuildSha256,
    profileRef: { id: exercise[3], version: '1.0.0' },
    status: cmd.receipt.eventType === 'exercise.passed' ? 'passed' : 'failed',
    caseKeys: ['case-1', 'case-2', 'case-3', 'case-4'],
    failedCaseKey: cmd.receipt.eventType === 'exercise.passed' ? null : 'case-1',
    failure: cmd.receipt.eventType === 'exercise.passed' ? null : 'wrong-answer',
  };
}
function commit(state: C6CourseState, cmd: C6LearningCommand): C6CourseState {
  const recipe = prepareC6Event(
    state,
    cmd,
    index,
    cmd.receipt.eventType.startsWith('exercise.') ? fixtureAttempt(cmd) : null,
  );
  const next = structuredClone(state);
  for (const op of recipe.operations) {
    const rows = next.snapshot[op.store] as unknown[];
    const key = JSON.stringify(recordKey(op.store, generation, op.value as never));
    const at = rows.findIndex(
      (r) => JSON.stringify(recordKey(op.store, generation, r as never)) === key,
    );
    if (at >= 0) rows[at] = op.value;
    else rows.push(op.value);
  }
  next.snapshot.meta.revision++;
  next.snapshot.receipts.push({ ...cmd.receipt, committedRevision: next.snapshot.meta.revision });
  for (const activity of recipe.activities ?? []) {
    const at = next.rows.activities.findIndex((a) => a.subjectRef.id === activity.subjectRef.id);
    if (at >= 0) next.rows.activities[at] = activity;
    else next.rows.activities.push(activity);
  }
  assertC6CourseState(next, index);
  return next;
}

for (const group of index.rewardGroups) {
  it(`preserves the registered reward keys and replay deduplication for ${group.id}`, () => {
    let state = fresh();
    for (const exercise of group.exerciseRefs)
      state = commit(state, command(exercise.id, 'exercise.passed'));
    for (const lesson of group.lessonRefs)
      state = commit(state, command(lesson.id, 'lesson.study-confirmed'));
    const expected = [
      ...(group.lessonRefs.length ? [group.lessonReward] : []),
      ...(group.exerciseRefs.length ? [group.exerciseReward] : []),
    ].map(({ sourceId, subjectId }) => ({ sourceId, subjectId }));
    expect(
      state.snapshot.ledger.map(({ sourceId, subjectId }) => ({ sourceId, subjectId })),
    ).toEqual(expect.arrayContaining(expected));
    expect(state.snapshot.ledger).toHaveLength(expected.length);
    const before = structuredClone(state.snapshot.ledger);
    if (group.exerciseRefs.length)
      state = commit(state, command(group.exerciseRefs[0].id, 'exercise.passed'));
    else if (group.lessonRefs.length)
      state = commit(state, command(group.lessonRefs[0].id, 'lesson.study-confirmed'));
    expect(state.snapshot.ledger).toEqual(before);
  });
}

it('completes a reading-only lesson only on explicit confirmation, with no invented exercise', () => {
  const lesson = index.lessons.find((l) => l[5].length === 0)!;
  let state = commit(fresh(), command(lesson[0], 'lesson.started'));
  expect(
    projectC6Learning(state.snapshot, index).lessons.find((l) => l.id === lesson[0])?.completed,
  ).toBe(false);
  state = commit(state, command(lesson[0], 'lesson.study-confirmed'));
  expect(
    projectC6Learning(state.snapshot, index).lessons.find((l) => l.id === lesson[0])?.completed,
  ).toBe(true);
  expect(state.snapshot.progress.some((p) => p.eventType.startsWith('exercise.'))).toBe(false);
  expect(() =>
    applyLearningEvent(
      fresh().snapshot,
      command(lesson[0], 'lesson.study-confirmed'),
      c6LearningCatalog(index) as unknown as LearningCatalog,
    ),
  ).toThrow();
});
it('requires both reading confirmation and the bound real-judge pass; later failures keep the first pass proof', () => {
  const lesson = index.lessons.find((l) => l[5].length === 1)!;
  let state = commit(fresh(), command(lesson[0], 'lesson.study-confirmed'));
  expect(
    projectC6Learning(state.snapshot, index).lessons.find((l) => l.id === lesson[0])?.completed,
  ).toBe(false);
  state = commit(state, command(lesson[5][0], 'exercise.passed'));
  expect(
    projectC6Learning(state.snapshot, index).lessons.find((l) => l.id === lesson[0])?.completed,
  ).toBe(true);
  const pass = state.rows.activities.find((a) => a.kind === 'exercise');
  state = commit(state, command(lesson[5][0], 'exercise.attempt-evaluated'));
  const exercise = state.rows.activities.find((a) => a.kind === 'exercise');
  expect(exercise?.kind === 'exercise' && exercise.firstPass).toEqual(
    pass?.kind === 'exercise' && pass.firstPass,
  );
  expect(exercise?.kind === 'exercise' && exercise.latestAttempt.status).toBe('failed');
});
it('awards the declared group once and grants no split-lesson reward or old progress', () => {
  const group = index.rewardGroups.find(
    (g) => g.lessonRefs.length > 2 && g.exerciseRefs.length === 0,
  )!;
  let state = fresh();
  for (const ref of group.lessonRefs.slice(0, -1))
    state = commit(state, command(ref.id, 'lesson.study-confirmed'));
  expect(state.snapshot.ledger).toHaveLength(0);
  state = commit(state, command(group.lessonRefs.at(-1)!.id, 'lesson.study-confirmed'));
  expect(state.snapshot.ledger.map((l) => [l.sourceId, l.subjectId])).toEqual([
    ['reward.lesson.first-completion', group.lessonReward.subjectId],
  ]);
  state = commit(state, command(group.lessonRefs[0].id, 'lesson.study-confirmed'));
  expect(state.snapshot.ledger).toHaveLength(1);
  expect(state.snapshot.progress.every((p) => p.subjectRef.version === '2.0.0')).toBe(true);
});
it('rejects detached course rights and malformed judge proof instead of projecting completion', () => {
  const lesson = index.lessons.find((l) => l[5].length === 1)!;
  const cmd = command(lesson[5][0], 'exercise.passed');
  const proof = fixtureAttempt(cmd);
  proof.caseKeys.pop();
  expect(() => prepareC6Event(fresh(), cmd, index, proof)).toThrow();
  const state = commit(fresh(), command(lesson[0], 'lesson.study-confirmed'));
  state.rows.activities = [];
  expect(() => assertC6CourseState(state, index)).toThrow();
});

it('derives current-source mistakes, repair and renewed failure from transaction order, without clearing the original pass', () => {
  const exercise = index.exercises[0];
  let state = commit(fresh(), command(exercise[0], 'exercise.attempt-evaluated'));
  expect(collectC6Mistakes(state.snapshot, index)[0]).toMatchObject({
    failures: 1,
    repaired: false,
  });
  state = commit(state, command(exercise[0], 'exercise.passed'));
  expect(collectC6Mistakes(state.snapshot, index)[0].repaired).toBe(true);
  state = commit(state, command(exercise[0], 'exercise.attempt-evaluated'));
  expect(collectC6Mistakes(state.snapshot, index)[0]).toMatchObject({
    failures: 2,
    repaired: false,
  });
  const sources = c6ReviewSources(state.snapshot, [], index);
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatchObject({
    subjectRef: { id: exercise[0], version: '2.0.0' },
    lessonRef: { id: exercise[2], version: '2.0.0' },
    state: 'active',
  });
  const summary = deriveC6Weaknesses(state.snapshot, [], index, at);
  assertWeaknessSummary(summary);
  expect(summary.rows[0]).toMatchObject({
    exerciseFailures: 2,
    recentFailures: 1,
    activeExercises: 1,
  });
  expect(summary.rows[0].evidence[0].mapping).toBe('exact');
  expect(state.rows.activities.some((a) => a.kind === 'exercise' && a.firstPass !== null)).toBe(
    true,
  );
});
