import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createC6ResetMeta, queueC6ResetUpgrade } from '../../web/src/storage/c6-reset';
import { toPythonMeta } from '../../web/src/storage/python3-meta';
import { toJavaMeta } from '../../web/src/storage/java-meta';
import { toCppMeta } from '../../web/src/storage/cpp-course-meta';
import { assertMysqlMeta, toMysqlMeta } from '../../web/src/storage/mysql-meta';
import { toRustMeta } from '../../web/src/storage/rust2018-meta';
import { emptySnapshot, recordKey, type StorageSnapshot } from '../../web/src/storage/model';
import { assertSnapshot } from '../../web/src/storage/validation';
import { applyMysqlLearningEvent } from '../../web/src/learning/domain';
import type { LearningCommand } from '../../web/src/learning/types';
import {
  mysqlPackageRef,
  isMysqlProgress,
  isMysqlLesson,
  isMysqlDocument,
} from '../../web/src/mysql-course/identities';
import { mysqlLessonIds, mysqlProfiles } from '../../web/src/mysql-course/release.generated';
import { MysqlLearningSession } from '../../web/src/learning/mysql-session';
import type { MysqlResponse } from '../../web/src/engine/mysql-types';
import type { StorageClient, StorageMutation } from '../../web/src/storage/client';

const currentExecution = vi.hoisted(() => vi.fn());
vi.mock('../../web/src/engine/mysql-client', () => ({ currentMysqlExecution: currentExecution }));
const generation = '00000000-0000-4000-8000-000000000042';
const at = '2026-11-07T02:00:00.000Z';
const lesson = mysqlLessonIds[0];
const exercise = Object.keys(mysqlProfiles)[0];
function snapshot() {
  return emptySnapshot(
    toMysqlMeta(
      toRustMeta(toCppMeta(toJavaMeta(toPythonMeta(createC6ResetMeta(generation, 'UTC', at))))),
    ),
  );
}
let event = 0;
function command(
  id: string,
  type: 'lesson.study-confirmed' | 'exercise.passed',
  date = '2026-11-07',
): LearningCommand {
  return {
    generation,
    receipt: {
      eventId: `00000000-0000-4000-8000-${String(++event).padStart(12, '0')}`,
      eventType: type,
      result: type === 'exercise.passed' ? 'passed' : 'confirmed',
      subjectRef: { id, version: '1.0.0' },
      packageRef: mysqlPackageRef,
      learningRevision: 1,
      occurredAt: `${date}T02:00:00.000Z`,
      localDate: date,
      goalVersion: 1,
    },
  } as LearningCommand;
}
function apply(state: StorageSnapshot, input: LearningCommand) {
  if (!state.goals.some((g) => g.localDate === input.receipt.localDate))
    state.goals.push({
      localDate: input.receipt.localDate,
      goalVersion: 1,
      targets: null,
      achievedAt: null,
    });
  const operations = applyMysqlLearningEvent(state, input);
  const next = structuredClone(state);
  for (const op of operations) {
    const values = next[op.store] as unknown[];
    const key = JSON.stringify(recordKey(op.store, generation, op.value as never));
    const index = values.findIndex(
      (value) => JSON.stringify(recordKey(op.store, generation, value as never)) === key,
    );
    if (index < 0) values.push(op.value);
    else values[index] = op.value;
  }
  next.meta.revision++;
  next.receipts.push({ ...input.receipt, committedRevision: next.meta.revision });
  assertSnapshot(next);
  return { next, operations };
}
afterEach(() => {
  currentExecution.mockReset();
});

describe('MySQL DB15 identities and relations', () => {
  it('admits a fresh DB15 activation through the historical C6 preference initializer', () => {
    // Only the upgrade recipe's target-version gate is simulated here. Native
    // IndexedDB commit/rollback and data preservation are browser checks.
    const names: string[] = [];
    const store = { clear: vi.fn(), add: vi.fn() };
    const db = {
      version: 15,
      objectStoreNames: {
        get length() {
          return names.length;
        },
        contains: (name: string) => names.includes(name),
      },
      createObjectStore: (name: string) => {
        names.push(name);
        return store;
      },
    } as unknown as IDBDatabase;
    const tx = {
      mode: 'versionchange',
      objectStore: () => store,
      abort: vi.fn(),
    } as unknown as IDBTransaction;
    const fail = vi.fn();
    const afterReset = vi.fn();
    const meta = createC6ResetMeta(generation, 'UTC', at);
    queueC6ResetUpgrade(db, tx, 0, meta, fail, afterReset);
    expect(fail).not.toHaveBeenCalled();
    expect(tx.abort).not.toHaveBeenCalled();
    expect(afterReset).toHaveBeenCalledExactlyOnceWith(meta);
    expect(names).toContain('courseActivities');
    expect(names).toContain('appearanceAssets');
  });
  it('changes only the metadata version and catalog identity while preserving the generation and revision', () => {
    const previous = toRustMeta(
      toCppMeta(toJavaMeta(toPythonMeta(createC6ResetMeta(generation, 'UTC', at)))),
    );
    previous.revision = 127;
    const next = toMysqlMeta(previous);
    assertMysqlMeta(next);
    expect(next).toEqual({
      ...previous,
      dbVersion: 15,
      schemaVersion: '15.0.0',
      activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp-rust-mysql', version: '1.0.0' },
    });
    expect(previous.dbVersion).toBe(14);
    expect(() => assertMysqlMeta({ ...next, extra: true })).toThrow('S_RECORD_INVALID');
    expect(() =>
      assertMysqlMeta({
        ...next,
        activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp-rust-mysql', version: '9.0.0' },
      }),
    ).toThrow('S_RECORD_INVALID');
  });
  it('recognizes all 300 lessons and 12 exercise documents without admitting source or foreign identities', () => {
    const manifest = JSON.parse(readFileSync('content/mysql/course/manifest-1.0.0.json', 'utf8'));
    expect(mysqlPackageRef).toEqual(manifest.packageRef);
    expect(mysqlLessonIds).toHaveLength(300);
    expect(mysqlLessonIds.every(isMysqlLesson)).toBe(true);
    expect(Object.keys(mysqlProfiles).every(isMysqlDocument)).toBe(true);
    expect(isMysqlDocument('mysql.document.free')).toBe(true);
    expect(isMysqlDocument('cpp.document.free')).toBe(false);
    expect(isMysqlLesson('mysql.source.root01')).toBe(false);
  });
  it('records reading independently, counts reviews on later days, and issues only one first-reading reward', () => {
    const first = apply(snapshot(), command(lesson, 'lesson.study-confirmed'));
    expect(
      first.next.progress
        .filter(isMysqlProgress)
        .map((p) => p.eventType)
        .sort(),
    ).toEqual(['lesson.completed', 'lesson.study-confirmed']);
    expect(first.next.progress.some((p) => p.eventType === 'exercise.passed')).toBe(false);
    const repeated = apply(first.next, command(lesson, 'lesson.study-confirmed'));
    expect(repeated.next.dailyFacts).toHaveLength(1);
    expect(repeated.next.ledger).toHaveLength(1);
    const reviewed = apply(repeated.next, command(lesson, 'lesson.study-confirmed', '2026-11-08'));
    expect(reviewed.next.dailyFacts).toHaveLength(2);
    expect(reviewed.next.ledger).toHaveLength(1);
  });
  it('keeps exercise passes separate from reading and rejects a Mysql fact in a DB14 archive', () => {
    const passed = apply(snapshot(), command(exercise, 'exercise.passed')).next;
    expect(passed.progress.map((p) => p.eventType)).toEqual(['exercise.passed']);
    expect(passed.ledger.map((r) => r.sourceId)).toEqual(['reward.exercise.first-pass']);
    const old = snapshot();
    old.meta = toRustMeta(
      toCppMeta(toJavaMeta(toPythonMeta(createC6ResetMeta(generation, 'UTC', at)))),
    );
    expect(() => apply(old, command(exercise, 'exercise.passed'))).toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
    expect(() => assertSnapshot({ ...passed, meta: old.meta })).toThrow();
    expect(() =>
      apply(snapshot(), command('cpp.book.part01.01', 'lesson.study-confirmed')),
    ).toThrow('S_CONTENT_INCOMPATIBLE');
  });
});

describe('Mysql judge session authority', () => {
  function setup() {
    let state = {
      epoch: 3,
      snapshot: snapshot() as StorageSnapshot | null,
      writable: true,
      rollback: false,
    };
    const commit = vi.fn();
    const storage = {
      readMysqlCourse: vi.fn(),
      commitMysqlCourse: commit,
    } as unknown as StorageClient;
    let queued: (() => Promise<unknown>) | undefined;
    const hooks = {
      current: () => state,
      storage: () => storage,
      run: <T>(action: () => Promise<T>): Promise<T> => {
        queued = action;
        return Promise.resolve(undefined as T);
      },
      openDay: vi.fn(),
      saved: vi.fn(),
      rewards: (operations: StorageMutation[]) => operations,
      clock: () => at,
    };
    const session = new MysqlLearningSession(hooks);
    const response = {
      operation: 'judge',
      identity: { runId: crypto.randomUUID(), sourceRevision: 'revision-1' },
      status: 'completed',
      judgement: {
        passed: true,
        complete: true,
        reviewCase: 0,
        cases: Array.from({ length: 4 }, (_, index) => ({
          index,
          status: 'completed',
          passed: true,
          reason: 'passed',
          diagnostic: null,
        })),
      },
    } as MysqlResponse;
    const proof = {
      request: {
        operation: 'judge',
        profile: exercise,
        sourceRevision: 'revision-1',
        runId: response.identity.runId,
      },
    };
    return {
      session,
      response,
      proof,
      commit,
      advance: () => {
        state = { ...state, epoch: 4 };
      },
      invokeQueued: () => queued!(),
    };
  }
  it('rejects a fabricated verdict, foreign profile, changed source revision, and stale epoch before persistence', async () => {
    const { session, response, proof, commit } = setup();
    currentExecution.mockReturnValue(null);
    await expect(session.recordJudge(exercise, response, 3, 'revision-1')).rejects.toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
    currentExecution.mockReturnValue({ request: { ...proof.request, profile: 'foreign' } });
    await expect(session.recordJudge(exercise, response, 3, 'revision-1')).rejects.toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
    currentExecution.mockReturnValue(proof);
    await expect(session.recordJudge(exercise, response, 3, 'revision-2')).rejects.toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
    await expect(session.recordJudge(exercise, response, 2, 'revision-1')).rejects.toThrow(
      'S_GENERATION_STALE',
    );
    expect(commit).not.toHaveBeenCalled();
  });
  it('rechecks engine authority and learning epoch after a queued delay', async () => {
    const staleEngine = setup();
    currentExecution.mockReturnValue(staleEngine.proof);
    await staleEngine.session.recordJudge(exercise, staleEngine.response, 3, 'revision-1');
    currentExecution.mockReturnValue(null);
    await expect(staleEngine.invokeQueued()).rejects.toThrow('S_CONTENT_INCOMPATIBLE');
    const staleEpoch = setup();
    currentExecution.mockReturnValue(staleEpoch.proof);
    await staleEpoch.session.recordJudge(exercise, staleEpoch.response, 3, 'revision-1');
    staleEpoch.advance();
    await expect(staleEpoch.invokeQueued()).rejects.toThrow('S_GENERATION_STALE');
    expect(staleEngine.commit).not.toHaveBeenCalled();
    expect(staleEpoch.commit).not.toHaveBeenCalled();
  });
  it('ignores limited or partial judge groups without granting a learning fact', async () => {
    const { session, response, proof, commit } = setup();
    currentExecution.mockReturnValue(proof);
    response.status = 'limited';
    expect(await session.recordJudge(exercise, response, 3, 'revision-1')).toBeNull();
    response.status = 'completed';
    response.judgement!.cases.pop();
    expect(await session.recordJudge(exercise, response, 3, 'revision-1')).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('MySQL four-group completeness and delayed authority', () => {
  function fixture() {
    const state = { epoch: 3, snapshot: snapshot(), writable: true, rollback: false };
    state.snapshot.goals.push({
      localDate: '2026-11-07',
      goalVersion: 1,
      targets: null,
      achievedAt: null,
    });
    const response = {
      operation: 'judge',
      identity: { runId: crypto.randomUUID(), sourceRevision: 'r1' },
      status: 'completed',
      judgement: {
        passed: true,
        complete: true,
        reviewCase: 0,
        cases: Array.from({ length: 4 }, (_, index) => ({
          index,
          status: 'completed',
          passed: true,
          reason: 'passed',
          diagnostic: null,
        })),
      },
    } as MysqlResponse;
    const proof = {
      request: {
        operation: 'judge',
        profile: exercise,
        sourceRevision: 'r1',
        runId: response.identity.runId,
      },
    };
    currentExecution.mockReturnValue(proof);
    let stage = '';
    let recipe: import('../../web/src/storage/mysql-course').MysqlCourseRecipe | undefined;
    const read = vi.fn(async () => {
      if (stage === 'read') currentExecution.mockReturnValue(null);
      return { snapshot: structuredClone(state.snapshot), rows: { activities: [], drafts: [] } };
    });
    const commit = vi.fn(async (_generation, _revision, prepare) => {
      if (stage === 'prepare') currentExecution.mockReturnValue(null);
      recipe = prepare({
        snapshot: structuredClone(state.snapshot),
        rows: { activities: [], drafts: [] },
      });
      if (stage === 'failure') throw new Error('S_QUOTA');
      return { saved: true as const, revision: 1, replayed: false };
    });
    let now = at;
    const session = new MysqlLearningSession({
      current: () => state,
      storage: () =>
        ({ readMysqlCourse: read, commitMysqlCourse: commit }) as unknown as StorageClient,
      run: (action) => action(),
      openDay: async () => {
        if (stage === 'openDay') currentExecution.mockReturnValue(null);
      },
      saved: async (result) => result,
      clock: () => now,
      rewards: (ops) => ops,
    });
    return {
      session,
      response,
      proof,
      read,
      commit,
      recipe: () => recipe!,
      stage: (next: string) => {
        stage = next;
      },
      now: (next: string) => {
        now = next;
      },
    };
  }
  it.each(['incomplete', 'missing', 'duplicate', 'out-of-range', 'group-limited', 'outer-limited'])(
    'does not persist %s judgement',
    async (mode) => {
      const f = fixture();
      const result = f.response.judgement!;
      if (mode === 'incomplete') result.complete = false;
      if (mode === 'missing') result.cases.pop();
      if (mode === 'duplicate') result.cases[3].index = 0;
      if (mode === 'out-of-range') result.cases[3].index = 4;
      if (mode === 'group-limited') result.cases[3].status = 'limited';
      if (mode === 'outer-limited') f.response.status = 'limited';
      expect(await f.session.recordJudge(exercise, f.response, 3, 'r1')).toBeNull();
      expect(f.commit).not.toHaveBeenCalled();
    },
  );
  it.each(['openDay', 'read', 'prepare'])('rechecks private proof after %s', async (stage) => {
    const f = fixture();
    f.stage(stage);
    await expect(f.session.recordJudge(exercise, f.response, 3, 'r1')).rejects.toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
    expect(() => f.recipe().receipt).toThrow();
  });
  it.each(['wrong-result', 'wrong-database', 'goal-unmet', 'program-error'] as const)(
    'normalizes a complete actual failure: %s',
    async (reason) => {
      const f = fixture();
      const result = f.response.judgement!;
      result.passed = false;
      Object.assign(result.cases[2], {
        passed: false,
        reason,
        status: reason === 'program-error' ? 'error' : 'completed',
      });
      await f.session.recordJudge(exercise, f.response, 3, 'r1');
      const saved = f.recipe().activities![0];
      if (saved.kind !== 'exercise') throw new Error('Expected exercise');
      expect(saved.latestAttempt).toMatchObject({
        reason,
        category:
          reason === 'goal-unmet'
            ? 'teaching-goal-unmet'
            : reason === 'program-error'
              ? 'program-error'
              : 'wrong-answer',
        failedCaseKey: 'case-3',
        caseCount: 4,
      });
      expect(
        f
          .recipe()
          .operations.some(
            (op) => op.store === 'progress' && op.value.eventType === 'lesson.completed',
          ),
      ).toBe(false);
    },
  );
  it('keeps the original occurrence day and event identity on a failed-save retry', async () => {
    const f = fixture();
    f.stage('failure');
    await expect(f.session.recordJudge(exercise, f.response, 3, 'r1')).rejects.toThrow('S_QUOTA');
    const first = f.recipe().receipt!;
    f.now('2026-11-08T03:00:00.000Z');
    f.stage('');
    await f.session.recordJudge(exercise, f.response, 3, 'r1');
    expect(f.recipe().receipt).toEqual(first);
  });
});
