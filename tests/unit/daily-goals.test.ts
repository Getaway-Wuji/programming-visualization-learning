import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CourseReading } from '../../web/src/content/reading';
import { createLearningAuthority } from '../../web/src/learning/authority';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { LearningService } from '../../web/src/learning/service';
import {
  assertConfiguredTargets,
  decodeDailyGoalRewardPolicy,
  decodeGoalConfiguration,
  loadDailyGoalRewardPolicy,
  loadGoalConfiguration,
  postNewDailyGoalRewards,
  prepareDailyGoalRewardSettlement,
} from '../../web/src/learning/goals';
import { loadRewardPolicy } from '../../web/src/learning/rewards';
import type { StorageClient, StorageMutation } from '../../web/src/storage/client';
import { assertRewardSettlement } from '../../web/src/storage/client';
import { StorageError } from '../../web/src/storage/errors';
import {
  createMeta,
  emptySnapshot,
  recordKey,
  type StorageSnapshot,
} from '../../web/src/storage/model';
import { assertSnapshot } from '../../web/src/storage/validation';

const config = await loadGoalConfiguration();
const policy = await loadDailyGoalRewardPolicy();
const reading = JSON.parse(
  readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
) as CourseReading;
const catalog = createLearningCatalog({ ...reading.catalog, purpose: 'course-practice' });
const generation = '11200000-0000-4000-8000-000000000001';
const first = '2026-10-20T02:00:00.000Z';
function empty(timeZone = 'Asia/Shanghai') {
  return emptySnapshot(
    createMeta({ generation, timeZone, createdAt: first, activePackageRef: catalog.packageRef }),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Strict transaction-recipe/lifecycle model. Native persistence is verified separately in browsers. */
function model(initial = empty()) {
  let data = structuredClone(initial);
  const apply = (expected: string, operations: StorageMutation[], revision?: number) => {
    if (data.meta.generation !== expected) throw new StorageError('S_GENERATION_STALE');
    if (revision !== undefined && data.meta.revision !== revision)
      throw new StorageError('S_REVISION_CONFLICT');
    if (!operations.length) return;
    const next = structuredClone(data);
    for (const operation of operations) {
      if (operation.store === 'settings' || operation.store === 'avatar') {
        if (revision === undefined) throw new StorageError('S_REVISION_CONFLICT');
        Object.assign(next, { [operation.store]: structuredClone(operation.value) });
        continue;
      }
      const rows = next[operation.store] as unknown[];
      const key = JSON.stringify(recordKey(operation.store, expected, operation.value as never));
      const index = rows.findIndex(
        (row) => JSON.stringify(recordKey(operation.store, expected, row as never)) === key,
      );
      if (index >= 0 && operation.mode === 'add') throw new StorageError('S_RECORD_INVALID');
      if (index < 0) rows.push(structuredClone(operation.value));
      else rows[index] = structuredClone(operation.value);
    }
    next.meta.revision++;
    data = next;
  };
  const fake = {
    read: vi.fn(async () => structuredClone(data)),
    readRecovery: vi.fn(async () => ({
      snapshot: structuredClone(data),
      guard: 'daily-model',
      writable: true,
      issues: [],
      canClear: true,
      resettable: [],
      ledgerUncertain: false,
      errorCode: null,
    })),
    commit: vi.fn<StorageClient['commit']>(async (expected, prepare, revision) => {
      apply(expected, prepare(structuredClone(data)), revision);
      assertSnapshot(data);
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    switchReviewedCaseRelease: vi.fn<StorageClient['switchReviewedCaseRelease']>(
      async (expectedGeneration, expectedRevision) => {
        if (expectedGeneration !== data.meta.generation)
          throw new StorageError('S_GENERATION_STALE');
        if (expectedRevision !== data.meta.revision) throw new StorageError('S_REVISION_CONFLICT');
        if (
          data.meta.activePackageRef.id !== 'content.c.p0' ||
          !['1.0.0', '1.0.1', '1.0.2'].includes(data.meta.activePackageRef.version)
        )
          throw new StorageError('S_CONTENT_INCOMPATIBLE');
        if (data.meta.activePackageRef.version !== '1.0.2') {
          data.meta.activePackageRef = { id: 'content.c.p0', version: '1.0.2' };
          data.meta.revision++;
        }
        assertSnapshot(data);
        return { saved: true, revision: data.meta.revision, replayed: false };
      },
    ),
    commitOnce: vi.fn<StorageClient['commitOnce']>(async (command, prepare) => {
      if (command.generation !== data.meta.generation) throw new StorageError('S_GENERATION_STALE');
      const previous = data.receipts.find((row) => row.eventId === command.receipt.eventId);
      if (previous) {
        const { committedRevision, ...summary } = previous;
        if (JSON.stringify(summary) !== JSON.stringify(command.receipt))
          throw new StorageError('S_EVENT_ID_REUSED');
        return { saved: true, revision: committedRevision, replayed: true };
      }
      const before = data.meta.revision;
      apply(command.generation, prepare(structuredClone(data)));
      if (before === data.meta.revision) data.meta.revision++;
      data.receipts.push({ ...command.receipt, committedRevision: data.meta.revision });
      assertSnapshot(data);
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    settleRewards: vi.fn<StorageClient['settleRewards']>(async (expected, prepare) => {
      const operations = prepare(structuredClone(data));
      for (const op of operations) {
        if (op.store !== 'ledger' || op.mode !== 'put') throw new StorageError('S_RECORD_INVALID');
        assertRewardSettlement(
          data.ledger.find(
            (entry) =>
              JSON.stringify(recordKey('ledger', expected, entry)) ===
              JSON.stringify(recordKey('ledger', expected, op.value)),
          ),
          op.value,
        );
      }
      apply(expected, operations);
      assertSnapshot(data);
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    clear: vi.fn(async () => {
      data = empty();
      data.meta.generation = '11200000-0000-4000-8000-000000000002';
      return structuredClone(data);
    }),
    close: vi.fn(),
    timeZoneFallback: false,
  };
  return {
    fake,
    client: fake as unknown as StorageClient,
    get data() {
      return data;
    },
    replace(value: StorageSnapshot) {
      assertSnapshot(value);
      data = structuredClone(value);
    },
  };
}
function setup(
  source = model(),
  options: Partial<ConstructorParameters<typeof LearningService>[0]> = {},
) {
  let at = first;
  const service = new LearningService({
    catalog,
    openStorage: async () => source.client,
    loadGoalConfig: loadGoalConfiguration,
    loadRewardPolicy,
    loadReading: async () => reading,
    loadPractice: async () => catalog,
    clock: () => at,
    ...options,
  });
  const authority = createLearningAuthority(catalog, () => true);
  const fact = (
    eventType: 'exercise.passed' | 'lesson.study-confirmed' = 'exercise.passed',
    index = 0,
  ) =>
    authority.issue({
      eventContractVersion: '1.0.0',
      eventType,
      result: eventType === 'exercise.passed' ? 'passed' : 'confirmed',
      subjectRef:
        eventType === 'exercise.passed' ? catalog.exercises[index].ref : catalog.lessons[index].ref,
      packageRef: catalog.packageRef,
      learningRevision: 1,
    } as Parameters<typeof authority.issue>[0]);
  const save = async (
    eventType: 'exercise.passed' | 'lesson.study-confirmed' = 'exercise.passed',
    index = 0,
  ) => {
    const command = await service.capture(fact(eventType, index));
    await service.commitCommand(command);
    return command;
  };
  return {
    source,
    service,
    fact,
    save,
    setTime(value: string) {
      at = value;
    },
  };
}

describe('11.2 narrow goal configuration and daily policy', () => {
  it('freezes the reviewed reachable recommendation and independent daily reward', () => {
    expect(config).toEqual({
      configRef: { id: 'goal.config.p0', version: '1.0.0' },
      recommended: { exercise: 1, lesson: 1, case: 0 },
      limits: { exercise: 6, lesson: 6, case: 7 },
    });
    expect(policy).toEqual({
      policyRef: { id: 'reward.policy.daily-goal.p0', version: '1.0.0' },
      sourceId: 'reward.daily-goal.once',
      points: 5,
    });
    expect(Object.isFrozen(config.recommended)).toBe(true);
    expect(Object.isFrozen(policy.policyRef)).toBe(true);
  });
  it.each([
    { exercise: 7, lesson: 0, case: 0 },
    { exercise: 0, lesson: 7, case: 0 },
    { exercise: 0, lesson: 0, case: 8 },
    { exercise: 0, lesson: 0, case: 0 },
    { exercise: -1, lesson: 1, case: 0 },
    { exercise: 0.5, lesson: 1, case: 0 },
  ])('rejects unavailable, empty or fractional custom targets %j', (targets) => {
    expect(() => assertConfiguredTargets(targets, config)).toThrow();
  });
  it('accepts the actual upper boundary and rejects extra/prototype/version changes', () => {
    expect(() =>
      assertConfiguredTargets({ exercise: 6, lesson: 6, case: 7 }, config),
    ).not.toThrow();
    expect(() =>
      decodeGoalConfiguration({ ...config, capabilities: ['exercise.passed'] }),
    ).toThrow();
    expect(() =>
      decodeGoalConfiguration({ ...config, configRef: { id: 'goal.config.p0', version: '1.0.1' } }),
    ).toThrow();
    expect(() =>
      decodeGoalConfiguration(Object.assign(Object.create({ extra: true }), config)),
    ).toThrow();
    expect(() =>
      decodeGoalConfiguration({ ...config, recommended: { exercise: 6, lesson: 6, case: 7 } }),
    ).toThrow();
    expect(() => decodeDailyGoalRewardPolicy({ ...policy, points: 500 })).toThrow();
  });
  it('cannot create a right, post another source or revalue posted history', () => {
    expect(prepareDailyGoalRewardSettlement(empty(), policy)).toEqual([]);
    const entry = {
      sourceId: 'reward.daily-goal.once' as const,
      subjectId: 'local-goal.2026-10-20',
      localDate: '2026-10-20',
      occurredAt: first,
      status: 'posted' as const,
      points: 99,
      policyRef: { id: 'reward.policy.old', version: '1.0.0' },
    };
    const op: StorageMutation = { store: 'ledger', mode: 'add', value: entry };
    expect(postNewDailyGoalRewards([op], policy)).toEqual([op]);
    const other: StorageMutation = {
      ...op,
      value: {
        ...entry,
        sourceId: 'reward.exercise.first-pass',
        status: 'pending',
        points: null,
        policyRef: null,
      },
    };
    expect(postNewDailyGoalRewards([other], policy)).toEqual([other]);
  });
});

describe('11.2 goal templates and real-fact transaction recipes', () => {
  it('initializes only a valid template at startup; refresh never opens/checks in a date', async () => {
    const t = setup();
    await t.service.start();
    expect(t.source.data.settings.goalTemplate).toEqual({
      revision: 1,
      targets: config.recommended,
    });
    expect(t.service.getState()).toMatchObject({
      goalStatus: 'ready',
      goalError: null,
      capabilities: { goalsConfigurable: true },
      goalConfiguration: config,
    });
    const before = structuredClone(t.source.data);
    await t.service.refresh();
    await t.service.refresh();
    expect(t.source.data).toEqual(before);
    expect(
      [before.goals, before.progress, before.receipts, before.dailyFacts, before.ledger].every(
        (rows) => !rows.length,
      ),
    ).toBe(true);
    t.service.dispose();
  });
  it('keeps synthetic callers disabled unless explicitly supplied the narrow capability', async () => {
    const source = model();
    const service = new LearningService({ catalog, openStorage: async () => source.client });
    await service.start();
    expect(service.getState().goalStatus).toBe('disabled');
    expect(source.data.settings.goalTemplate).toBeNull();
    service.dispose();
  });
  it('configuration failure does not freeze a null day; retry preserves the original pre-midnight fact', async () => {
    const loader = vi
      .fn(loadGoalConfiguration)
      .mockRejectedValueOnce(new Error('missing'))
      .mockRejectedValueOnce(new Error('missing'));
    const t = setup(model(), { loadGoalConfig: loader });
    await t.service.start();
    expect(t.service.getState()).toMatchObject({
      goalStatus: 'failed',
      goalError: 'GOAL_CONFIGURATION_UNAVAILABLE',
    });
    t.setTime('2026-10-20T15:59:00.000Z');
    const token = t.fact();
    await expect(t.service.capture(token)).rejects.toThrow('S_STORAGE_UNAVAILABLE');
    expect(t.source.data.goals).toEqual([]);
    expect(t.source.data.settings.goalTemplate).toBeNull();
    expect(t.service.getState().pendingCount).toBe(1);
    t.setTime('2026-10-20T16:01:00.000Z');
    await t.service.reloadGoalConfiguration();
    await t.service.retryPending();
    expect(t.source.data.receipts[0]).toMatchObject({
      localDate: '2026-10-20',
      occurredAt: '2026-10-20T15:59:00.000Z',
      goalVersion: 1,
    });
    expect(t.source.data.goals).toHaveLength(1);
    expect(t.source.data.goals[0].targets).toEqual(config.recommended);
    t.service.dispose();
  });
  it('initial-template quota failure preserves the archive and an explicit retry cannot create a day', async () => {
    const source = model();
    const before = structuredClone(source.data);
    source.fake.commit.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    const t = setup(source);
    await t.service.start();
    expect(source.data).toEqual(before);
    expect(t.service.getState()).toMatchObject({
      status: 'unsaved',
      goalStatus: 'failed',
      goalError: 'S_QUOTA',
      lastSaved: false,
    });
    await t.service.reloadGoalConfiguration();
    expect(source.data.settings.goalTemplate).toEqual({ revision: 1, targets: config.recommended });
    expect(source.data.goals).toEqual([]);
    expect(source.data.dailyFacts).toEqual([]);
    expect(t.service.getState().goalStatus).toBe('ready');
    t.service.dispose();
  });
  it('does not initialize a template in a recovered read-only archive', async () => {
    const source = model();
    const before = structuredClone(source.data);
    const recovery = await source.fake.readRecovery();
    source.fake.readRecovery.mockResolvedValue({
      ...recovery,
      writable: false,
      ledgerUncertain: true,
    });
    const t = setup(source);
    await t.service.start();
    expect(source.fake.commit).not.toHaveBeenCalled();
    expect(source.data).toEqual(before);
    expect(t.service.getState()).toMatchObject({
      status: 'readonly',
      capabilities: { goalsConfigurable: false },
    });
    t.service.dispose();
  });
  it('an out-of-range settings action changes no goal, facts or award', async () => {
    const t = setup();
    await t.service.start();
    const before = structuredClone(t.source.data);
    await t.service.saveGoalTemplate({ exercise: 7, lesson: 0, case: 0 }, before.meta.revision);
    expect(t.source.data).toEqual(before);
    expect(t.service.getState()).toMatchObject({ errorCode: 'S_RECORD_INVALID', lastSaved: false });
    t.service.dispose();
  });
  it('preserves an old null daily snapshot and existing customized template', async () => {
    const initial = empty();
    initial.settings.goalTemplate = { revision: 4, targets: { exercise: 2, lesson: 0, case: 0 } };
    initial.goals = [{ localDate: '2026-10-20', goalVersion: 1, targets: null, achievedAt: null }];
    const t = setup(model(initial));
    await t.service.start();
    await t.save();
    await t.save('lesson.study-confirmed');
    expect(t.source.data.goals[0]).toEqual(initial.goals[0]);
    expect(t.source.data.settings.goalTemplate).toEqual(initial.settings.goalTemplate);
    expect(t.source.data.ledger.some((row) => row.sourceId === 'reward.daily-goal.once')).toBe(
      false,
    );
    t.service.dispose();
  });
  it('freezes the first opened date, applies edits to unopened dates and rejects stale CAS', async () => {
    const t = setup();
    await t.service.start();
    await t.save();
    const original = structuredClone(t.source.data.goals[0]);
    const staleRevision = t.source.data.meta.revision;
    await t.service.saveGoalTemplate({ exercise: 2, lesson: 0, case: 0 }, staleRevision);
    await t.service.saveGoalTemplate({ exercise: 3, lesson: 0, case: 0 }, staleRevision);
    expect(t.service.getState().status).toBe('conflict');
    expect(t.source.data.settings.goalTemplate).toEqual({
      revision: 2,
      targets: { exercise: 2, lesson: 0, case: 0 },
    });
    expect(t.source.data.goals[0]).toEqual(original);
    t.setTime('2026-10-20T16:01:00.000Z');
    await t.save();
    expect(t.source.data.goals[1]).toMatchObject({
      localDate: '2026-10-21',
      goalVersion: 2,
      targets: { exercise: 2, lesson: 0, case: 0 },
      achievedAt: null,
    });
    t.service.dispose();
  });
  it('achieves only on the triggering valid fact and posts exactly one five-point daily right', async () => {
    const t = setup();
    await t.service.start();
    await t.save();
    expect(t.source.data.goals[0].achievedAt).toBeNull();
    t.setTime('2026-10-20T02:20:00.000Z');
    const confirmed = await t.save('lesson.study-confirmed');
    expect(t.source.data.goals[0].achievedAt).toBe('2026-10-20T02:20:00.000Z');
    const daily = t.source.data.ledger.find((row) => row.sourceId === 'reward.daily-goal.once');
    expect(daily).toMatchObject({ status: 'posted', points: 5, policyRef: policy.policyRef });
    expect(t.service.getState().projection!.ledger.totalPoints).toBe('35');
    const before = structuredClone(t.source.data);
    await t.service.commitCommand(confirmed);
    expect(t.source.data).toEqual(before);
    await t.save();
    await t.service.saveGoalTemplate(
      { exercise: 1, lesson: 0, case: 0 },
      t.source.data.meta.revision,
    );
    await t.save('lesson.study-confirmed');
    expect(t.source.data.ledger.filter((row) => row.sourceId === 'reward.daily-goal.once')).toEqual(
      [daily],
    );
    expect(t.source.data.dailyFacts).toHaveLength(2);
    expect(t.source.data.goals[0].achievedAt).toBe(before.goals[0].achievedAt);
    t.service.dispose();
  });
  it('next date needs new facts; first lifetime rewards never recur for active review', async () => {
    const t = setup();
    await t.service.start();
    await t.save();
    await t.save('lesson.study-confirmed');
    t.setTime('2026-10-21T02:00:00.000Z');
    const before = structuredClone(t.source.data);
    await t.service.refresh();
    expect(t.source.data).toEqual(before);
    await t.save('lesson.study-confirmed');
    expect(t.source.data.goals[1].achievedAt).toBeNull();
    await t.save();
    expect(t.source.data.dailyFacts).toHaveLength(4);
    expect(
      t.source.data.ledger.filter((row) => row.sourceId === 'reward.daily-goal.once'),
    ).toHaveLength(2);
    expect(t.service.getState().projection!.ledger.totalPoints).toBe('40');
    t.service.dispose();
  });
  it('the public lesson action permits active next-day review but suppresses same-day reconfirmation', async () => {
    const t = setup();
    await t.service.start();
    await t.service.reloadReading();
    await t.save();
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    const before = structuredClone(t.source.data);
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    expect(t.source.data).toEqual(before);
    t.setTime('2026-10-21T02:00:00.000Z');
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    expect(
      t.source.data.dailyFacts.filter((row) => row.eventType === 'lesson.completed'),
    ).toHaveLength(2);
    const afterReview = structuredClone(t.source.data);
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    expect(t.source.data).toEqual(afterReview);
    t.service.dispose();
  });
  it('does not repeat a same-day confirmation even before the required exercise was passed', async () => {
    const t = setup();
    await t.service.start();
    await t.service.reloadReading();
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    const before = structuredClone(t.source.data);
    expect(before.dailyFacts).toEqual([]);
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    expect(t.source.data).toEqual(before);
    t.service.dispose();
  });
  it('does not let incompatible same-day history suppress a current lesson review', async () => {
    // Explicit mixed-revision archive model: this is not an actual content
    // migration or a claim that these incompatible releases were published.
    const initial = empty();
    initial.meta.revision = 2;
    initial.settings.goalTemplate = { revision: 1, targets: { ...config.recommended } };
    initial.goals.push({
      localDate: '2026-10-20',
      goalVersion: 1,
      targets: { ...config.recommended },
      achievedAt: null,
    });
    const compatible = {
      eventType: 'lesson.study-confirmed' as const,
      result: 'confirmed' as const,
      subjectRef: { ...catalog.lessons[0].ref },
      packageRef: { ...catalog.packageRef },
      learningRevision: 1,
      firstAt: '2026-10-19T02:00:00.000Z',
      lastAt: '2026-10-19T02:00:00.000Z',
    };
    const incompatible = [
      {
        ...compatible,
        subjectRef: { ...compatible.subjectRef, version: '1.0.0' },
        firstAt: first,
        lastAt: first,
      },
      { ...compatible, learningRevision: 2, firstAt: first, lastAt: first },
    ];
    initial.progress.push(compatible, ...incompatible);
    initial.receipts.push(
      ...incompatible.map((row, index) => ({
        eventType: row.eventType,
        result: row.result,
        subjectRef: { ...row.subjectRef },
        packageRef: { ...row.packageRef },
        learningRevision: row.learningRevision,
        eventId: `11200000-0000-4000-8000-00000000001${index}`,
        goalVersion: 1,
        occurredAt: first,
        localDate: '2026-10-20',
        committedRevision: index + 1,
      })),
    );
    const t = setup(model(initial));
    await t.service.start();
    await t.service.reloadReading();
    expect(t.service.getState().projection!.lessons[0]).toMatchObject({ studyConfirmed: true });
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    expect(t.source.data.receipts).toHaveLength(3);
    expect(t.source.data.receipts[2]).toMatchObject({
      eventType: 'lesson.study-confirmed',
      subjectRef: catalog.lessons[0].ref,
      learningRevision: 1,
      occurredAt: first,
      localDate: '2026-10-20',
    });
    expect(
      t.source.data.progress.find(
        (row) =>
          row.subjectRef.version === catalog.lessons[0].ref.version && row.learningRevision === 1,
      )!.lastAt,
    ).toBe(first);
    expect(
      t.source.data.progress.filter(
        (row) => row.subjectRef.version === '1.0.0' || row.learningRevision === 2,
      ),
    ).toEqual(incompatible);
    const saved = structuredClone(t.source.data);
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    expect(t.source.data).toEqual(saved);
    t.service.dispose();
  });
  it('retains pending daily rights when policy loading fails; settlement creates no facts', async () => {
    const loader = vi.fn(loadDailyGoalRewardPolicy).mockRejectedValueOnce(new Error('missing'));
    const t = setup(model(), { loadDailyGoalPolicy: loader });
    await t.service.start();
    await t.save();
    await t.save('lesson.study-confirmed');
    expect(
      t.source.data.ledger.find((row) => row.sourceId === 'reward.daily-goal.once')!.status,
    ).toBe('pending');
    const before = structuredClone(t.source.data);
    await t.service.settleRewards();
    expect(t.source.fake.settleRewards).toHaveBeenCalledOnce();
    expect(
      t.source.data.ledger.find((row) => row.sourceId === 'reward.daily-goal.once'),
    ).toMatchObject({ status: 'posted', points: 5 });
    expect(t.source.data.dailyFacts).toEqual(before.dailyFacts);
    expect(t.source.data.receipts).toEqual(before.receipts);
    expect(t.source.data.goals).toEqual(before.goals);
    t.service.dispose();
  });
  it('settles old content and daily pending rights together, preserving all already posted entries', async () => {
    const t = setup();
    await t.service.start();
    await t.save();
    await t.save('lesson.study-confirmed');
    const initial = structuredClone(t.source.data);
    initial.ledger = initial.ledger.map((row, index) =>
      index === 1 ? row : { ...row, status: 'pending', points: null, policyRef: null },
    );
    t.service.dispose();
    const source = model(initial);
    const second = setup(source);
    await second.service.start();
    expect(source.fake.settleRewards).toHaveBeenCalledOnce();
    expect(source.data.meta.revision).toBe(initial.meta.revision + 1);
    expect(source.data.ledger[1]).toEqual(initial.ledger[1]);
    expect(source.data.dailyFacts).toEqual(initial.dailyFacts);
    expect(source.data.receipts).toEqual(initial.receipts);
    expect(source.data.ledger.every((row) => row.status === 'posted')).toBe(true);
    second.service.dispose();
  });
  it('a failed day transaction leaves no day and retry uses the captured occurrence', async () => {
    const t = setup();
    await t.service.start();
    const token = t.fact();
    t.source.fake.commit.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    await expect(t.service.capture(token)).rejects.toThrow('S_QUOTA');
    expect(t.source.data.goals).toEqual([]);
    t.setTime('2026-10-21T02:00:00.000Z');
    await t.service.retryPending();
    expect(t.source.data.receipts[0].occurredAt).toBe(first);
    expect(t.source.data.goals[0].localDate).toBe('2026-10-20');
    t.service.dispose();
  });
  it('keeps a concurrent custom template when another tab wins initialization CAS', async () => {
    const source = model();
    const original = source.fake.commit.getMockImplementation()!;
    source.fake.commit
      .mockImplementationOnce(async () => {
        const concurrent = structuredClone(source.data);
        concurrent.settings.goalTemplate = {
          revision: 1,
          targets: { exercise: 0, lesson: 0, case: 1 },
        };
        concurrent.settings.theme = 'dark';
        concurrent.meta.revision++;
        source.replace(concurrent);
        throw new StorageError('S_REVISION_CONFLICT');
      })
      .mockImplementation(original);
    const t = setup(source);
    await t.service.start();
    expect(source.data.settings).toMatchObject({
      theme: 'dark',
      goalTemplate: { revision: 1, targets: { exercise: 0, lesson: 0, case: 1 } },
    });
    expect(t.service.getState().snapshot!.settings).toEqual(source.data.settings);
    expect(source.data.goals).toEqual([]);
    t.service.dispose();
  });
  it('clear installs a fresh recommended template and rejects the old captured command', async () => {
    const t = setup();
    await t.service.start();
    const old = await t.service.capture(t.fact());
    await t.service.saveGoalTemplate(
      { exercise: 3, lesson: 0, case: 0 },
      t.source.data.meta.revision,
    );
    await t.service.clearLocalData();
    expect(t.source.data.settings.goalTemplate).toEqual({
      revision: 1,
      targets: config.recommended,
    });
    expect(t.source.data.goals).toEqual([]);
    expect(t.source.data.ledger).toEqual([]);
    await expect(t.service.commitCommand(old)).rejects.toThrow('S_GENERATION_STALE');
    t.service.dispose();
  });
  it('a configuration request delayed across clear cannot open the old generation', async () => {
    const pending = deferred<typeof config>();
    const t = setup(model(), { loadGoalConfig: () => pending.promise });
    const starting = t.service.start();
    await vi.waitFor(() => expect(t.service.getState().snapshot).not.toBeNull());
    const clearing = t.service.clearLocalData();
    pending.resolve(config);
    await Promise.all([starting, clearing]);
    expect(t.source.data.meta.generation).not.toBe(generation);
    expect(t.source.data.settings.goalTemplate).toEqual({
      revision: 1,
      targets: config.recommended,
    });
    expect(t.source.data.goals).toEqual([]);
    t.service.dispose();
  });
  it('reports obvious clock rollback without changing date history and clears the warning after correction', async () => {
    const t = setup();
    await t.service.start();
    await t.save();
    const before = structuredClone(t.source.data);
    t.setTime('2026-10-19T02:00:00.000Z');
    await t.service.refresh();
    expect(t.service.getState().clockStatus).toBe('rollback');
    expect(t.source.data).toEqual(before);
    t.setTime(first);
    await t.service.refresh();
    expect(t.service.getState().clockStatus).toBe('normal');
    expect(t.source.data).toEqual(before);
    t.service.dispose();
  });
  it('uses original confirmation receipts to deduplicate a backdated incomplete lesson', async () => {
    const t = setup();
    await t.service.start();
    await t.service.reloadReading();
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    t.setTime('2026-10-19T02:00:00.000Z');
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    const before = structuredClone(t.source.data);
    await t.service.recordLesson(reading.lessons[0].id, true, t.service.getState().sessionEpoch);
    expect(t.source.data).toEqual(before);
    expect(
      before.receipts.filter((row) => row.eventType === 'lesson.study-confirmed'),
    ).toHaveLength(2);
    expect(before.dailyFacts).toEqual([]);
    t.service.dispose();
  });
  it('keeps independent case goals reachable when the reading resource is unavailable', async () => {
    const initial = empty();
    initial.settings.goalTemplate = { revision: 1, targets: { exercise: 0, lesson: 0, case: 7 } };
    initial.goals.push({
      localDate: '2026-10-20',
      goalVersion: 1,
      targets: initial.settings.goalTemplate.targets,
      achievedAt: null,
    });
    const t = setup(model(initial), {
      catalog: undefined,
      loadReading: async () => {
        throw new Error('reading unavailable');
      },
    });
    await t.service.start();
    await vi.waitFor(() => expect(t.service.getState().readingStatus).toBe('failed'));
    expect(t.service.getState().projection!.goals[0].reachable).toBe(true);
    expect(t.service.getState().capabilities.goalsConfigurable).toBe(true);
    expect(t.service.getState().projection!.cases).toHaveLength(7);
    t.service.dispose();
  });
  it('recovers storage initialization when reading failure invalidates an in-flight first read', async () => {
    const source = model();
    const originalRead = await source.fake.readRecovery();
    source.fake.readRecovery.mockClear();
    const firstRead = deferred<typeof originalRead>();
    const readingRequest = deferred<CourseReading>();
    source.fake.readRecovery.mockReturnValueOnce(firstRead.promise);
    const t = setup(source, { catalog: undefined, loadReading: () => readingRequest.promise });
    try {
      const starting = t.service.start();
      await vi.waitFor(() => expect(source.fake.readRecovery).toHaveBeenCalledOnce());
      expect(t.service.getState().status).toBe('loading');
      expect(t.service.getState().sessionEpoch).toBe(0);
      readingRequest.reject(new Error('reading404'));
      await vi.waitFor(() => {
        expect(t.service.getState().readingStatus).toBe('failed');
        expect(t.service.getState().sessionEpoch).toBe(1);
      });
      // The first read belongs to the old epoch. The reading failure must
      // arrange another independent storage read after this stale one ends.
      firstRead.resolve(originalRead);
      await starting;
      await vi.waitFor(() =>
        expect(t.service.getState()).toMatchObject({
          status: 'ready',
          readingStatus: 'failed',
          readingError: 'reading404',
          goalStatus: 'ready',
          snapshot: { settings: { goalTemplate: { revision: 1, targets: config.recommended } } },
        }),
      );
      expect(source.data.settings.goalTemplate).toEqual({
        revision: 1,
        targets: config.recommended,
      });
      expect(source.data.goals).toEqual([]);
      expect(source.data.progress).toEqual([]);
      expect(source.data.dailyFacts).toEqual([]);
      expect(source.data.receipts).toEqual([]);
      expect(source.data.ledger).toEqual([]);
    } finally {
      t.service.dispose();
    }
  });
  it('marks course goals unavailable in reading-only mode unless compatible prior passes allow completion', async () => {
    const initial = empty();
    initial.settings.goalTemplate = { revision: 1, targets: { exercise: 0, lesson: 1, case: 0 } };
    initial.goals.push({
      localDate: '2026-10-20',
      goalVersion: 1,
      targets: initial.settings.goalTemplate.targets,
      achievedAt: null,
    });
    const t = setup(model(initial), {
      catalog: undefined,
      loadPractice: async () => {
        throw new Error('practice unavailable');
      },
    });
    await t.service.start();
    await vi.waitFor(() => expect(t.service.getState().practiceStatus).toBe('failed'));
    expect(t.service.getState().projection!.goals[0].reachable).toBe(false);
    t.service.dispose();

    const passed = structuredClone(initial);
    passed.progress.push({
      eventType: 'exercise.passed',
      result: 'passed',
      subjectRef: catalog.exercises[0].ref,
      packageRef: catalog.packageRef,
      learningRevision: 1,
      firstAt: first,
      lastAt: first,
    });
    const second = setup(model(passed), {
      catalog: undefined,
      loadPractice: async () => {
        throw new Error('practice unavailable');
      },
    });
    await second.service.start();
    await vi.waitFor(() => expect(second.service.getState().practiceStatus).toBe('failed'));
    expect(second.service.getState().projection!.goals[0].reachable).toBe(true);
    expect(second.source.data.dailyFacts).toEqual([]);
    expect(second.source.data.ledger).toEqual([]);
    second.service.dispose();
  });
  it('uses the stored IANA zone across DST rather than advancing dates by 24 hours', async () => {
    const t = setup(model(empty('America/New_York')));
    await t.service.start();
    t.setTime('2026-11-01T03:59:00.000Z');
    await t.save();
    t.setTime('2026-11-01T04:01:00.000Z');
    await t.save();
    t.setTime('2026-11-02T04:30:00.000Z');
    await t.save();
    expect(t.source.data.goals.map((row) => row.localDate)).toEqual(['2026-10-31', '2026-11-01']);
    expect(t.source.data.dailyFacts).toHaveLength(2);
    expect(t.source.data.meta.timeZone).toBe('America/New_York');
    t.service.dispose();
  });
});
