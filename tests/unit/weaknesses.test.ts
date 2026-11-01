import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deriveWeaknesses,
  assertWeaknessSummary,
  weaknessReasons,
  windowMs,
  challengeKnowledge,
} from '../../web/src/weaknesses/model';
import { upgradeV8Meta } from '../../web/src/storage/v8-migration';
import {
  createMeta,
  emptySnapshot,
  type ContentReceipt,
  type Receipt,
} from '../../web/src/storage/model';
import type { KnowledgeMark } from '../../web/src/storage/knowledge-marks';
import type { CourseReading } from '../../web/src/content/reading';
import type { CoursePractice } from '../../web/src/content/practice';
import type { LearningCatalog } from '../../web/src/learning/types';
import { challengePackage } from '../../web/src/challenges/content';
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const course = json('content/c/p05/course-1.0.0.json');
const packageRef = { id: course.packageId, version: course.packageVersion };
const reading = { ...course, packageRef } as CourseReading;
const practice = { ...course, packageRef } as CoursePractice;
const catalog: LearningCatalog = {
  purpose: 'course-practice',
  packageRef,
  lessons: [],
  cases: [],
  exercises: course.exercises.map(
    (e: {
      id: string;
      version: string;
      learningRevision: number;
      acceptedPriorVersions: string[];
      lessonRef: { id: string; version: string };
      tests: { caseKey: string }[];
    }) => ({
      ref: { id: e.id, version: e.version },
      learningRevision: e.learningRevision,
      acceptedPriorVersions: e.acceptedPriorVersions,
      lessonRef: e.lessonRef,
      caseKeys: e.tests.map((t) => t.caseKey),
    }),
  ),
};
const at = '2026-11-01T10:00:00.000Z';
const fresh = () =>
  emptySnapshot(
    createMeta({
      generation: crypto.randomUUID(),
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: packageRef,
    }),
  );
const receipt = (revision: number, category = 'wrong-answer', time = at): ContentReceipt =>
  ({
    eventId: crypto.randomUUID(),
    goalVersion: 1,
    occurredAt: time,
    localDate: '2026-11-01',
    committedRevision: revision,
    eventType: category === 'pass' ? 'exercise.passed' : 'exercise.attempt-evaluated',
    result: category === 'pass' ? 'passed' : 'failed',
    packageRef,
    subjectRef: { id: 'exercise.c.echo', version: '1.1.0' },
    learningRevision: 1,
    ...(category === 'pass' ? {} : { resultCategory: category, failedCaseKey: 'positive' }),
  }) as ContentReceipt;
// Use the published exercise's actual version and test identity.
function fail(rev: number, category = 'wrong-answer', time = at) {
  const r = receipt(rev, category, time);
  const e = practice.exercises.find((e) => e.id === r.subjectRef.id)!;
  r.subjectRef = { id: e.id, version: e.version };
  if (r.eventType === 'exercise.attempt-evaluated') r.failedCaseKey = e.tests[0].caseKey;
  return r;
}
const derive = (s = fresh(), marks: KnowledgeMark[] = []) => {
  const summary = deriveWeaknesses(s, marks, catalog, reading, practice, at);
  assertWeaknessSummary(summary);
  return summary;
};
const variable = (s: ReturnType<typeof derive>) =>
  s.rows.find((r) => r.knowledgeRef.id === 'knowledge.c.variables')!;
function mark(s: ReturnType<typeof fresh>, marked = true): KnowledgeMark {
  const lesson = reading.lessons.find((l) => l.id === 'lesson.c.variables-output')!;
  return {
    markVersion: '1.0.0',
    generation: s.meta.generation,
    revision: 1,
    commandId: crypto.randomUUID(),
    packageRef,
    knowledgeRef: { id: 'knowledge.c.variables', version: '1.0.0' },
    lessonRef: { id: lesson.id, version: lesson.version },
    marked,
    firstAt: at,
    lastAt: at,
  };
}
function challenge(
  rev: number,
  id: string,
  result = 'incorrect',
): Extract<Receipt, { eventType: 'challenge.answered' }> {
  return {
    eventContractVersion: '1.1.0',
    eventType: 'challenge.answered',
    eventId: crypto.randomUUID(),
    goalVersion: 1,
    occurredAt: at,
    localDate: '2026-11-01',
    committedRevision: rev,
    packageRef: challengePackage,
    subjectRef: { id, version: '1.0.0' },
    learningRevision: 1,
    result,
    answerKind: 'object.declare',
  } as Extract<Receipt, { eventType: 'challenge.answered' }>;
}
describe('19.1 local evidence, independent expectations', () => {
  it('empty history produces no invented weaknesses or side effects', () => {
    const s = fresh(),
      before = JSON.stringify(s);
    expect(derive(s)).toMatchObject({ rows: [], unmapped: 0 });
    expect(JSON.stringify(s)).toBe(before);
  });
  it('deduplicates event identity, counts true attempts, repairs and reopens in committed order', () => {
    const s = fresh(),
      a = fail(1);
    s.receipts = [a, a, fail(2)];
    expect(variable(derive(s))).toMatchObject({
      exerciseFailures: 2,
      recentFailures: 2,
      activeExercises: 1,
    });
    s.receipts.push(fail(3, 'pass'));
    expect(weaknessReasons(variable(derive(s)))).toEqual([]);
    s.receipts.unshift(fail(4));
    expect(variable(derive(s))).toMatchObject({ exerciseFailures: 3, recentFailures: 1 });
    expect(variable(derive(s)).evidence[0]).toMatchObject({ revision: 4, state: 'active' });
  });
  it.each(['cancelled', 'resource-limit', 'infrastructure-failure'])(
    'excludes %s without student inference',
    (category) => {
      const s = fresh();
      s.receipts.push(fail(1, category));
      expect(derive(s).rows).toEqual([]);
    },
  );
  it('uses a precise inclusive 30-day window, excludes future facts and retains expired history', () => {
    const s = fresh();
    s.receipts = [fail(1, 'wrong-answer', new Date(Date.parse(at) - windowMs).toISOString())];
    expect(variable(derive(s)).recentFailures).toBe(1);
    s.receipts = [fail(1, 'wrong-answer', new Date(Date.parse(at) - windowMs - 1).toISOString())];
    expect(variable(derive(s))).toMatchObject({
      exerciseFailures: 1,
      recentFailures: 0,
      evidence: [{ state: 'expired' }],
    });
    s.receipts = [fail(1, 'wrong-answer', '2026-11-02T00:00:00.000Z')];
    expect(variable(derive(s)).recentFailures).toBe(0);
  });
  it('preserves explicit legacy compatibility but never maps a foreign package by matching title or ID', () => {
    const s = fresh(),
      r = fail(1);
    r.packageRef = { id: 'content.c.p0', version: '1.0.1' };
    r.subjectRef.version = '1.0.1';
    s.receipts = [r];
    expect(variable(derive(s)).exerciseFailures).toBe(1);
    r.packageRef = { id: 'content.foreign', version: '1.0.0' };
    expect(derive(s)).toMatchObject({ rows: [], unmapped: 1 });
  });
  it('manual cancellation changes only self-assessment and cannot hide independent automatic errors', () => {
    const s = fresh();
    expect(variable(derive(s, [mark(s)]))).toMatchObject({ manual: true, exerciseFailures: 0 });
    expect(weaknessReasons(variable(derive(s, [mark(s, false)])))).toEqual([]);
    s.receipts = [fail(1)];
    expect(variable(derive(s, [mark(s, false)]))).toMatchObject({
      manual: false,
      recentFailures: 1,
    });
  });
  it('same challenge replay is one question, two distinct wrong questions stall, later correct repairs and wrong reopens', () => {
    const s = fresh(),
      id = 'challenge.c.assignment.initialize';
    s.receipts = [challenge(1, id), challenge(2, id), challenge(3, id)];
    expect(variable(derive(s))).toMatchObject({ challengeMistakes: 1, challengeStalled: false });
    s.receipts.push(challenge(4, 'challenge.c.branch.initialize'));
    expect(variable(derive(s))).toMatchObject({ challengeMistakes: 2, challengeStalled: true });
    s.receipts.push(challenge(5, id, 'correct'));
    expect(variable(derive(s))).toMatchObject({ challengeMistakes: 1, challengeStalled: false });
    s.receipts.push(challenge(6, id));
    expect(variable(derive(s)).challengeStalled).toBe(true);
  });
  it('mapping is explicit and unknown questions cannot become knowledge facts', () => {
    expect(challengeKnowledge('challenge.c.bubble-sort.action')).toBe('knowledge.c.sorting');
    expect(challengeKnowledge('challenge.c.loops.output')).toBe('knowledge.c.output');
    expect(challengeKnowledge('challenge.fake.title')).toBeUndefined();
    const s = fresh();
    s.receipts = [challenge(1, 'challenge.fake.title')];
    expect(derive(s)).toMatchObject({ rows: [], unmapped: 1 });
  });
  it('has bounded explanatory evidence and no raw source, input or trace', () => {
    const s = fresh();
    s.receipts = [...Array.from({ length: 80 }, (_, i) => fail(i + 1))];
    const summary = derive(s);
    expect(variable(summary).exerciseFailures).toBe(80);
    expect(variable(summary).evidence).toHaveLength(1);
    expect(() => assertWeaknessSummary(summary)).not.toThrow();
    for (const field of ['source', 'input', 'trace', 'diagnostic', 'hash'])
      expect(() => assertWeaknessSummary({ ...summary, [field]: 'private' })).toThrow();
    expect(() => assertWeaknessSummary({ ...summary, weaknessVersion: '2.0.0' })).toThrow(
      'S_VERSION_UNKNOWN',
    );
  });
  it('preserves old meta identity during DB8 upgrade and rejects future without mutation', () => {
    const old = { ...fresh().meta, schemaVersion: '8.0.0', dbVersion: 8, revision: 20 };
    const before = structuredClone(old);
    expect(upgradeV8Meta(old)).toEqual({
      ...old,
      schemaVersion: '9.0.0',
      dbVersion: 9,
      revision: 21,
    });
    expect(old).toEqual(before);
    expect(() => upgradeV8Meta({ ...old, schemaVersion: '10.0.0' })).toThrow('S_VERSION_UNKNOWN');
  });
});
