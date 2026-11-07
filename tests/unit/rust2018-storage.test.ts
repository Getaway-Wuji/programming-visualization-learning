import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createC6ResetMeta, queueC6ResetUpgrade } from '../../web/src/storage/c6-reset';
import { toPythonMeta } from '../../web/src/storage/python3-meta';
import { toJavaMeta } from '../../web/src/storage/java-meta';
import { toCppMeta } from '../../web/src/storage/cpp-course-meta';
import { assertRustMeta, toRustMeta } from '../../web/src/storage/rust2018-meta';
import { emptySnapshot, recordKey, type StorageSnapshot } from '../../web/src/storage/model';
import { assertSnapshot } from '../../web/src/storage/validation';
import { applyRustLearningEvent } from '../../web/src/learning/domain';
import type { LearningCommand } from '../../web/src/learning/types';
import {
  rustPackageRef,
  isRustProgress,
  isRustLesson,
  isRustDocument,
} from '../../web/src/rust2018-course/identities';
import {
  rust2018LessonIds,
  rust2018Profiles,
} from '../../web/src/rust2018-course/release.generated';
import { RustLearningSession } from '../../web/src/learning/rust2018-session';
import type { RustResponse } from '../../web/src/engine/rust2018-protocol';
import type { StorageClient, StorageMutation } from '../../web/src/storage/client';

const currentExecution = vi.hoisted(() => vi.fn());
vi.mock('../../web/src/engine/rust2018-client', () => ({ currentRustExecution: currentExecution }));
const generation = '00000000-0000-4000-8000-000000000042';
const at = '2026-11-07T02:00:00.000Z';
const lesson = rust2018LessonIds[0];
const exercise = Object.keys(rust2018Profiles)[0];
function snapshot() {
  return emptySnapshot(
    toRustMeta(toCppMeta(toJavaMeta(toPythonMeta(createC6ResetMeta(generation, 'UTC', at))))),
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
      packageRef: rustPackageRef,
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
  const operations = applyRustLearningEvent(state, input);
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

describe('Rust DB14 identities and relations', () => {
  it('admits a fresh DB14 activation through the historical C6 preference initializer', () => {
    // Only the upgrade recipe's target-version gate is simulated here. Native
    // IndexedDB commit/rollback and data preservation are browser checks.
    const names: string[] = [];
    const store = { clear: vi.fn(), add: vi.fn() };
    const db = {
      version: 14,
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
    const previous = toCppMeta(toJavaMeta(toPythonMeta(createC6ResetMeta(generation, 'UTC', at))));
    previous.revision = 127;
    const next = toRustMeta(previous);
    assertRustMeta(next);
    expect(next).toEqual({
      ...previous,
      dbVersion: 14,
      schemaVersion: '14.0.0',
      activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp-rust', version: '1.0.0' },
    });
    expect(previous.dbVersion).toBe(13);
    expect(() => assertRustMeta({ ...next, extra: true })).toThrow('S_RECORD_INVALID');
    expect(() =>
      assertRustMeta({
        ...next,
        activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp-rust', version: '9.0.0' },
      }),
    ).toThrow('S_RECORD_INVALID');
  });
  it('recognizes all 299 lessons and 12 exercise documents without admitting source or foreign identities', () => {
    const manifest = JSON.parse(
      readFileSync('content/rust2018/course/manifest-1.0.0.json', 'utf8'),
    );
    expect(rustPackageRef).toEqual(manifest.packageRef);
    expect(rust2018LessonIds).toHaveLength(299);
    expect(rust2018LessonIds.every(isRustLesson)).toBe(true);
    expect(Object.keys(rust2018Profiles).every(isRustDocument)).toBe(true);
    expect(isRustDocument('rust.document.free')).toBe(true);
    expect(isRustDocument('cpp.document.free')).toBe(false);
    expect(isRustLesson('rust.source.root01')).toBe(false);
  });
  it('records reading independently, counts reviews on later days, and issues only one first-reading reward', () => {
    const first = apply(snapshot(), command(lesson, 'lesson.study-confirmed'));
    expect(
      first.next.progress
        .filter(isRustProgress)
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
  it('keeps exercise passes separate from reading and rejects a Rust fact in a DB13 archive', () => {
    const passed = apply(snapshot(), command(exercise, 'exercise.passed')).next;
    expect(passed.progress.map((p) => p.eventType)).toEqual(['exercise.passed']);
    expect(passed.ledger.map((r) => r.sourceId)).toEqual(['reward.exercise.first-pass']);
    const old = snapshot();
    old.meta = toCppMeta(toJavaMeta(toPythonMeta(createC6ResetMeta(generation, 'UTC', at))));
    expect(() => apply(old, command(exercise, 'exercise.passed'))).toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
    expect(() => assertSnapshot({ ...passed, meta: old.meta })).toThrow();
    expect(() =>
      apply(snapshot(), command('cpp.book.part01.01', 'lesson.study-confirmed')),
    ).toThrow('S_CONTENT_INCOMPATIBLE');
  });
});

describe('Rust judge session authority', () => {
  function setup() {
    let state = {
      epoch: 3,
      snapshot: snapshot() as StorageSnapshot | null,
      writable: true,
      rollback: false,
    };
    const commit = vi.fn();
    const storage = {
      readRustCourse: vi.fn(),
      commitRustCourse: commit,
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
    const session = new RustLearningSession(hooks);
    const response = {
      identity: { runId: crypto.randomUUID(), sourceRevision: 'revision-1' },
      status: 'completed',
      judgement: {
        passed: true,
        reviewCase: 0,
        cases: Array.from({ length: 4 }, (_, index) => ({
          index,
          status: 'completed',
          passed: true,
          diagnostic: null,
        })),
      },
    } as RustResponse;
    const proof = {
      request: { operation: 'judge', profile: exercise, sourceRevision: 'revision-1' },
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
