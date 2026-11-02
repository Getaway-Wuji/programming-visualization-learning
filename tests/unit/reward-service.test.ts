import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createLearningAuthority } from '../../web/src/learning/authority';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { LearningService } from '../../web/src/learning/service';
import { loadRewardPolicy } from '../../web/src/learning/rewards';
import { StorageError } from '../../web/src/storage/errors';
import type { StorageClient, StorageMutation } from '../../web/src/storage/client';
import { recordKey, type StorageSnapshot } from '../../web/src/storage/model';
import { assertSnapshot } from '../../web/src/storage/validation';
import { upgradeV1Snapshot } from '../../web/src/storage/v1-migration';

const examples = JSON.parse(readFileSync('shared/contracts/02.3-存档样例.json', 'utf8'));
const catalog = createLearningCatalog({
  purpose: 'publishable',
  packageRef: { id: 'content.c.p0', version: '1.0.0' },
  lessons: [
    {
      ref: { id: 'lesson.c.variables-output', version: '1.0.0' },
      learningRevision: 1,
      acceptedPriorVersions: [],
      requiredExerciseRefs: [{ id: 'exercise.c.echo', version: '1.0.0' }],
    },
  ],
  exercises: [
    {
      ref: { id: 'exercise.c.echo', version: '1.0.0' },
      learningRevision: 1,
      acceptedPriorVersions: [],
      lessonRef: { id: 'lesson.c.variables-output', version: '1.0.0' },
      caseKeys: ['normal'],
    },
  ],
  cases: [],
});
function archive(pending = true): StorageSnapshot {
  const value = upgradeV1Snapshot(examples.snapshots[pending ? 1 : 0].snapshot);
  if (pending)
    value.ledger = value.ledger.map((entry) => ({
      ...entry,
      status: 'pending',
      points: null,
      policyRef: null,
    }));
  assertSnapshot(value);
  return value;
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

/** Recipe/lifecycle model only; actual IDB atomicity and tab behavior use browser tests. */
function model(initial = archive()) {
  let data = initial;
  const apply = (generation: string, operations: StorageMutation[]) => {
    if (generation !== data.meta.generation) throw new StorageError('S_GENERATION_STALE');
    if (!operations.length) return;
    const next = structuredClone(data);
    for (const op of operations) {
      if (op.store === 'settings' || op.store === 'avatar') continue;
      const rows = next[op.store] as unknown[];
      const key = JSON.stringify(recordKey(op.store, generation, op.value as never));
      const index = rows.findIndex(
        (row) => JSON.stringify(recordKey(op.store, generation, row as never)) === key,
      );
      if (index < 0) rows.push(structuredClone(op.value));
      else rows[index] = structuredClone(op.value);
    }
    next.meta.revision++;
    data = next;
  };
  const fake = {
    read: vi.fn(async () => structuredClone(data)),
    readRecovery: vi.fn(async () => ({
      snapshot: structuredClone(data),
      guard: 'test-guard',
      writable: true,
      issues: [],
      canClear: true,
      resettable: [],
      ledgerUncertain: false,
      errorCode: null,
      appearanceReadOnly: false,
      appearanceCanReset: true,
    })),
    commit: vi.fn<StorageClient['commit']>(async (generation, prepare) => {
      apply(generation, prepare(structuredClone(data)));
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    settleRewards: vi.fn<StorageClient['settleRewards']>(async (generation, prepare) => {
      apply(generation, prepare(structuredClone(data)));
      assertSnapshot(data);
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    commitOnce: vi.fn<StorageClient['commitOnce']>(async (command, prepare) => {
      if (command.generation !== data.meta.generation) throw new StorageError('S_GENERATION_STALE');
      const prior = data.receipts.find((entry) => entry.eventId === command.receipt.eventId);
      if (prior) return { saved: true, revision: prior.committedRevision, replayed: true };
      const before = data.meta.revision;
      apply(command.generation, prepare(structuredClone(data)));
      if (data.meta.revision === before) data.meta.revision++;
      data.receipts.push({ ...command.receipt, committedRevision: data.meta.revision });
      assertSnapshot(data);
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    clear: vi.fn(async () => {
      data = archive(false);
      data.meta.generation = '22222222-2222-4222-8222-222222222222';
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
  };
}
function serviceFor(source = model(), loader = loadRewardPolicy) {
  const service = new LearningService({
    catalog,
    openStorage: async () => source.client,
    loadRewardPolicy: loader,
    clock: () => '2026-10-13T16:02:00.000Z',
  });
  return { source, service };
}
function pass(service: LearningService) {
  const fact = createLearningAuthority(catalog, () => true).issue({
    eventContractVersion: '1.0.0',
    eventType: 'exercise.passed',
    result: 'passed',
    subjectRef: catalog.exercises[0].ref,
    packageRef: catalog.packageRef,
    learningRevision: 1,
  });
  return service.capture(fact);
}

describe('11.1 reward settlement service lifecycle', () => {
  it('settles historical pending rights at startup and never creates receipts, day facts or rights on refresh', async () => {
    const { source, service } = serviceFor();
    const before = structuredClone(source.data);
    await service.start();
    expect(service.getState()).toMatchObject({
      rewardStatus: 'ready',
      rewardError: null,
      lastSaved: true,
    });
    expect(service.getState().projection!.ledger.totalPoints).toBe('30');
    expect(source.data.ledger).toHaveLength(3);
    for (const key of ['progress', 'dailyFacts', 'goals', 'receipts'] as const)
      expect(source.data[key]).toEqual(before[key]);
    expect(source.data.meta.revision).toBe(before.meta.revision + 1);
    await service.refresh();
    await service.settleRewards();
    expect(source.fake.settleRewards).toHaveBeenCalledOnce();
    expect(source.data.meta.revision).toBe(before.meta.revision + 1);
    expect(source.data.ledger[2]).toMatchObject({
      sourceId: 'reward.daily-goal.once',
      status: 'pending',
    });
    service.dispose();
  });
  it('keeps synthetic catalog tests disabled unless their policy loader is explicit', async () => {
    const source = model();
    const service = new LearningService({ catalog, openStorage: async () => source.client });
    await service.start();
    expect(service.getState().rewardStatus).toBe('disabled');
    expect(source.fake.settleRewards).not.toHaveBeenCalled();
    expect(source.data.ledger.every((entry) => entry.status === 'pending')).toBe(true);
    service.dispose();
  });
  it('records pending rights when policy loading fails, then settles them once through an explicit retry', async () => {
    const loader = vi.fn(loadRewardPolicy).mockRejectedValueOnce(new Error('unavailable'));
    const { source, service } = serviceFor(model(archive(false)), loader);
    await service.start();
    expect(service.getState()).toMatchObject({
      rewardStatus: 'failed',
      rewardError: 'REWARD_POLICY_UNAVAILABLE',
    });
    const command = await pass(service);
    await service.commitCommand(command);
    expect(source.data.ledger[0]).toMatchObject({ status: 'pending', points: null });
    expect(service.getState().projection!.ledger.totalPoints).toBe('0');
    await service.settleRewards();
    expect(source.data.ledger[0]).toMatchObject({ status: 'posted', points: 10 });
    expect(source.data.receipts).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(service.getState().rewardStatus).toBe('ready');
    service.dispose();
  });
  it('posts a fresh accepted pass in its one receipt transaction and receipt replay adds no revision', async () => {
    const { source, service } = serviceFor(model(archive(false)));
    await service.start();
    const command = await pass(service);
    await service.commitCommand(command);
    expect(source.fake.settleRewards).not.toHaveBeenCalled();
    expect(source.data.ledger[0]).toMatchObject({ status: 'posted', points: 10 });
    const revision = source.data.meta.revision;
    await expect(service.commitCommand(command)).resolves.toMatchObject({ replayed: true });
    expect(source.data.meta.revision).toBe(revision);
    expect(source.data.ledger).toHaveLength(1);
    service.dispose();
  });
  it('keeps pending rows and exposes quota failure, then safely retries without creating learning facts', async () => {
    const source = model();
    source.fake.settleRewards.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    const { service } = serviceFor(source);
    const before = structuredClone(source.data);
    await service.start();
    expect(service.getState()).toMatchObject({
      status: 'unsaved',
      lastSaved: false,
      rewardStatus: 'failed',
      rewardError: 'S_QUOTA',
    });
    expect(source.data).toEqual(before);
    await service.settleRewards();
    expect(service.getState()).toMatchObject({ rewardStatus: 'ready', lastSaved: true });
    expect(source.data.receipts).toEqual(before.receipts);
    expect(source.data.meta.revision).toBe(before.meta.revision + 1);
    service.dispose();
  });
  it('does not acknowledge saved before settlement commit completes or if the verification read fails', async () => {
    const source = model();
    const completing = deferred<Awaited<ReturnType<StorageClient['settleRewards']>>>();
    source.fake.settleRewards.mockReturnValueOnce(completing.promise);
    const { service } = serviceFor(source);
    const starting = service.start();
    await vi.waitFor(() => expect(source.fake.settleRewards).toHaveBeenCalledOnce());
    expect(service.getState().lastSaved).toBe(false);
    source.fake.readRecovery.mockRejectedValueOnce(new StorageError('S_STORAGE_UNAVAILABLE'));
    completing.resolve({ saved: true, revision: 4, replayed: false });
    await starting;
    expect(service.getState()).toMatchObject({ lastSaved: false, rewardStatus: 'failed' });
    service.dispose();
  });
  it('does not settle a recovered read-only archive', async () => {
    const source = model();
    const reading = await source.fake.readRecovery();
    source.fake.readRecovery.mockResolvedValue({
      ...reading,
      writable: false,
      ledgerUncertain: true,
    });
    const { service } = serviceFor(source);
    await service.start();
    expect(source.fake.settleRewards).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ status: 'readonly', lastSaved: false });
    service.dispose();
  });
  it('rejects a policy load delayed across local clear without resurrecting or settling old rights', async () => {
    const loading = deferred<Awaited<ReturnType<typeof loadRewardPolicy>>>();
    const { source, service } = serviceFor(model(), () => loading.promise);
    const starting = service.start();
    await vi.waitFor(() => expect(service.getState().snapshot).not.toBeNull());
    const clearing = service.clearLocalData();
    loading.resolve(await loadRewardPolicy());
    await Promise.all([starting, clearing]);
    expect(source.fake.settleRewards).not.toHaveBeenCalled();
    expect(source.data.ledger).toEqual([]);
    expect(service.getState()).toMatchObject({ cleared: true, lastSaved: false });
    service.dispose();
  });
});
