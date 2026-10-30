import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { collectMistakes } from '../../web/src/review-notebook/model';
import { assertKnowledgeMark } from '../../web/src/storage/knowledge-marks';
import { upgradeV3Meta } from '../../web/src/storage/v3-migration';
import { classifyAttempt, assertAttemptFact } from '../../web/src/learning/attempt-authority';
import type { ExecuteResult } from '../../web/src/engine/protocol';
import { createMeta, emptySnapshot, type ContentReceipt } from '../../web/src/storage/model';
import type { LearningCatalog } from '../../web/src/learning/types';
const course = JSON.parse(readFileSync('content/c/p05/course-1.0.0.json', 'utf8'));
const subject = course.exercises.find((e: { id: string }) => e.id === 'exercise.c.echo');
const packageRef = { id: course.packageId, version: course.packageVersion };
const catalog: LearningCatalog = {
  purpose: 'course-practice',
  packageRef,
  lessons: [],
  cases: [],
  exercises: course.exercises.map((e: typeof subject) => ({
    ref: { id: e.id, version: e.version },
    learningRevision: e.learningRevision,
    acceptedPriorVersions: e.acceptedPriorVersions,
    lessonRef: e.lessonRef,
    caseKeys: e.tests.map((t: { caseKey: string }) => t.caseKey),
  })),
};
const at = '2026-10-31T03:00:00.000Z';
const fresh = () =>
  emptySnapshot(
    createMeta({
      generation: crypto.randomUUID(),
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: packageRef,
    }),
  );
const receipt = (revision: number, kind = 'wrong-answer') =>
  ({
    eventId: crypto.randomUUID(),
    goalVersion: 1,
    occurredAt: at,
    localDate: '2026-10-31',
    committedRevision: revision,
    eventType: kind === 'pass' ? 'exercise.passed' : 'exercise.attempt-evaluated',
    result: kind === 'pass' ? 'passed' : 'failed',
    packageRef,
    subjectRef: { id: subject.id, version: subject.version },
    learningRevision: 1,
    ...(kind === 'pass' ? {} : { resultCategory: kind, failedCaseKey: subject.tests[0].caseKey }),
  }) as ContentReceipt;
describe('15.2 reviewed event collection and privacy', () => {
  it('keeps one exercise row, counts separate true failures, repairs and reopens in transaction order even with identical times', () => {
    const s = fresh();
    s.receipts.push(receipt(3), receipt(5, 'teaching-goal-unmet'), receipt(6, 'pass'));
    let rows = collectMistakes(s, catalog);
    expect(rows).toMatchObject([
      { failures: 2, repaired: true, categories: ['wrong-answer', 'teaching-goal-unmet'] },
    ]);
    s.receipts.unshift(receipt(7, 'program-error'));
    rows = collectMistakes(s, catalog);
    expect(rows).toMatchObject([{ failures: 3, repaired: false, lastCategory: 'program-error' }]);
  });
  it.each(['cancelled', 'resource-limit', 'infrastructure-failure'])(
    'never labels %s as a mistake',
    (kind) => {
      const s = fresh();
      s.receipts.push(receipt(2, kind));
      expect(collectMistakes(s, catalog)).toEqual([]);
    },
  );
  it('does not turn unrelated package history into a current exercise or change its saved rows', () => {
    const s = fresh();
    const r = receipt(2);
    r.packageRef = { id: 'content.c.foreign', version: '1.0.0' };
    s.receipts.push(r);
    const before = JSON.stringify(s);
    expect(collectMistakes(s, catalog)[0].currentId).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });
  it('recognizes the explicitly reviewed original echo history after the32-lesson upgrade', () => {
    const s = fresh(),
      r = receipt(2);
    r.packageRef = { id: 'content.c.p0', version: '1.0.1' };
    r.subjectRef.version = '1.0.1';
    s.receipts.push(r);
    expect(collectMistakes(s, catalog)[0].currentId).toBe('exercise.c.echo');
  });
  it.each(['resource-limit', 'cancelled', 'infrastructure-failure'])(
    'excludes final %s results from the issuer',
    (status) => {
      expect(classifyAttempt({ terminal: { status } } as ExecuteResult)).toBeNull();
    },
  );
  it.each(['program-error', 'rejected'])('retains final %s as program error', (status) => {
    expect(classifyAttempt({ terminal: { status } } as ExecuteResult)).toBe('program-error');
  });
  it('refuses a page-created opaque fact', () =>
    expect(() => assertAttemptFact({} as never)).toThrow('S_CONTENT_INCOMPATIBLE'));
});
describe('15.2 isolated mark record and migration', () => {
  const mark = () => ({
    markVersion: '1.0.0',
    generation: crypto.randomUUID(),
    revision: 1,
    commandId: crypto.randomUUID(),
    packageRef,
    knowledgeRef: { id: 'knowledge.c.variables', version: '1.0.0' },
    lessonRef: { id: 'lesson.c.variables-output', version: '1.1.0' },
    marked: true,
    firstAt: at,
    lastAt: at,
  });
  it('accepts only the closed minimum mark and supports a false tombstone', () => {
    const row = mark();
    expect(() => assertKnowledgeMark(row)).not.toThrow();
    row.marked = false;
    expect(() => assertKnowledgeMark(row)).not.toThrow();
  });
  it.each(['source', 'input', 'stdout', 'diagnostic', 'trace', 'hash'])(
    'rejects forbidden extra %s data',
    (key) => expect(() => assertKnowledgeMark({ ...mark(), [key]: 'private body' })).toThrow(),
  );
  it('upgrades only meta version/revision and rejects an unknown future meta without mutation', () => {
    const old = { ...fresh().meta, schemaVersion: '3.0.0', dbVersion: 3, revision: 8 };
    const before = structuredClone(old);
    expect(upgradeV3Meta(old)).toEqual({
      ...old,
      schemaVersion: '6.0.0',
      dbVersion: 6,
      revision: 9,
    });
    expect(old).toEqual(before);
    expect(() => upgradeV3Meta({ ...old, schemaVersion: '9.0.0' })).toThrow('S_VERSION_UNKNOWN');
  });
});
