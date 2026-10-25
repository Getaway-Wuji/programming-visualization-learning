import { describe, expect, it, vi } from 'vitest';
import { LearningService } from '../../web/src/learning/service';
import { createLearningAuthority } from '../../web/src/learning/authority';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { createMeta, emptySnapshot } from '../../web/src/storage/model';
import type { StorageSnapshot } from '../../web/src/storage/model';
import type { StorageClient } from '../../web/src/storage/client';
import type { RecoveryRead } from '../../web/src/storage/recovery';
import { StorageError } from '../../web/src/storage/errors';

const packageRef = { id: 'content.synthetic.recovery', version: '1.0.0' };
const ref = { id: 'exercise.synthetic.recovery', version: '1.0.0' };
const lessonRef = { id: 'lesson.synthetic.recovery', version: '1.0.0' };
const catalog = createLearningCatalog({
  purpose: 'publishable',
  packageRef,
  lessons: [
    { ref: lessonRef, learningRevision: 1, acceptedPriorVersions: [], requiredExerciseRefs: [ref] },
  ],
  exercises: [
    { ref, learningRevision: 1, acceptedPriorVersions: [], lessonRef, caseKeys: ['normal'] },
  ],
  cases: [],
});
function archive(generation = '12345678-1234-4234-8234-123456789abc') {
  return emptySnapshot(
    createMeta({
      generation,
      activePackageRef: packageRef,
      timeZone: 'Asia/Shanghai',
      createdAt: '2026-10-15T02:00:00.000Z',
    }),
  );
}
function read(snapshot: StorageSnapshot, writable = true): RecoveryRead {
  return {
    snapshot: structuredClone(snapshot),
    guard: 'private-test-guard',
    writable,
    issues: writable ? [] : [{ store: 'progress', count: 1 }],
    canClear: true,
    resettable: [],
    ledgerUncertain: !writable,
    errorCode: writable ? null : 'S_RECORD_INVALID',
    appearanceReadOnly: false,
    appearanceCanReset: true,
  };
}
function fact() {
  return createLearningAuthority(catalog, () => true).issue({
    eventContractVersion: '1.0.0',
    eventType: 'exercise.passed',
    subjectRef: ref,
    packageRef,
    learningRevision: 1,
    result: 'passed',
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function clientDouble() {
  const data = archive();
  const fake = {
    read: vi.fn(async () => structuredClone(data)),
    readRecovery: vi.fn(async () => read(data)),
    commit: vi.fn(async () => ({ saved: true as const, revision: 1, replayed: false })),
    commitOnce: vi.fn<StorageClient['commitOnce']>(async () => ({
      saved: true as const,
      revision: 1,
      replayed: false,
    })),
    clear: vi.fn(async () => archive('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
    resetSingleton: vi.fn(async () => read(data)),
    close: vi.fn(),
    timeZoneFallback: false,
  };
  return { data, fake, client: fake as unknown as StorageClient };
}

// These are lifecycle/interleaving dependency-injection checks. Native commit,
// rollback and inter-tab guarantees are established by the browser scenarios.
describe('recovery service boundaries', () => {
  it('an expired memory-only command cannot discard newer valid pending work after storage returns', async () => {
    const { fake, client, data } = clientDouble();
    data.goals.push({ localDate: '2026-10-15', goalVersion: 1, targets: null, achievedAt: null });
    const open = vi
      .fn<() => Promise<StorageClient>>()
      .mockRejectedValueOnce(new StorageError('S_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(client);
    const service = new LearningService({
      catalog,
      openStorage: open,
      clock: () => '2026-10-15T02:00:00.000Z',
    });
    await service.start();
    const oldCommand = await service.capture(fact());
    await expect(service.commitCommand(oldCommand)).rejects.toMatchObject({
      code: 'S_STORAGE_UNAVAILABLE',
    });
    await service.refresh();
    const currentCommand = await service.capture(fact());
    fake.commitOnce.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    await expect(service.commitCommand(currentCommand)).rejects.toMatchObject({ code: 'S_QUOTA' });
    const current = service.getState();
    expect(current.pendingCount).toBe(1);
    await expect(service.commitCommand(oldCommand)).rejects.toMatchObject({
      code: 'S_GENERATION_STALE',
    });
    expect(service.getState()).toEqual(current);
    service.dispose();
  });
  it('immediately withdraws cached ledger confirmation when a strict write is the first operation to discover damage', async () => {
    const { fake, client, data } = clientDouble();
    const service = new LearningService({ catalog, openStorage: async () => client });
    await service.start();
    const reading = deferred<RecoveryRead>();
    fake.readRecovery.mockReturnValueOnce(reading.promise);
    fake.commit.mockRejectedValueOnce(new StorageError('S_RECORD_INVALID'));
    await service.saveDisplay({ theme: 'dark', reducedMotion: 'on', playbackRate: 2 }, 0);
    expect(service.getState()).toMatchObject({
      status: 'readonly',
      lastSaved: false,
      recovery: { writable: false, ledgerUncertain: true },
    });
    reading.resolve(read(data, false));
    await service.refresh();
    service.dispose();
  });
  it.each(['saved', 'unsaved'] as const)(
    'a newly detected damaged row outranks a prior %s outcome during focus refresh',
    async (outcome) => {
      const { fake, client, data } = clientDouble();
      const service = new LearningService({ catalog, openStorage: async () => client });
      await service.start();
      if (outcome === 'unsaved') fake.commit.mockRejectedValueOnce(new StorageError('S_QUOTA'));
      await service.saveDisplay({ theme: 'dark', reducedMotion: 'on', playbackRate: 2 }, 0);
      expect(service.getState().lastSaved).toBe(outcome === 'saved');
      fake.readRecovery.mockResolvedValueOnce(read(data, false));
      await service.refresh({ preserveOutcome: true });
      expect(service.getState()).toMatchObject({
        status: 'readonly',
        lastSaved: false,
        recovery: { writable: false, ledgerUncertain: true },
      });
      service.dispose();
    },
  );

  it('clear invalidates synchronously, suppresses an old acknowledgment and cancels queued edits even if clear fails', async () => {
    const { fake, client } = clientDouble();
    const service = new LearningService({ catalog, openStorage: async () => client });
    await service.start();
    const pending = deferred<{ saved: true; revision: number; replayed: boolean }>();
    fake.commit.mockReturnValueOnce(pending.promise);
    fake.clear.mockRejectedValueOnce(new StorageError('S_ABORTED'));
    const invalidated = vi.fn();
    service.subscribeSessionInvalidation(invalidated);
    const first = service.saveDisplay({ theme: 'dark', reducedMotion: 'on', playbackRate: 2 }, 0);
    await vi.waitFor(() => expect(fake.commit).toHaveBeenCalledTimes(1));
    const queued = service.saveDisplay(
      { theme: 'light', reducedMotion: 'off', playbackRate: 1 },
      0,
    );
    const clearing = service.clearLocalData();
    expect(invalidated).toHaveBeenCalledOnce();
    expect(service.getState().sessionEpoch).toBe(1);
    expect(fake.clear).not.toHaveBeenCalled();
    pending.resolve({ saved: true, revision: 1, replayed: false });
    await Promise.all([first, queued, clearing]);
    expect(fake.commit).toHaveBeenCalledTimes(1);
    expect(service.getState()).toMatchObject({
      cleared: false,
      lastSaved: false,
      pendingCount: 0,
      projection: { settings: { theme: 'light' } },
    });
    service.dispose();
  });

  it('facts learned without an open archive stay temporary and cannot be rebound to the later archive', async () => {
    const { fake, client } = clientDouble();
    const open = vi
      .fn<() => Promise<StorageClient>>()
      .mockRejectedValueOnce(new StorageError('S_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(client);
    const service = new LearningService({ catalog, openStorage: open });
    await service.start();
    const token = fact();
    const command = await service.capture(token);
    await expect(service.commitCommand(command)).rejects.toMatchObject({
      code: 'S_STORAGE_UNAVAILABLE',
    });
    expect(service.getState()).toMatchObject({
      lastSaved: false,
      temporary: true,
      pendingCount: 0,
      snapshot: null,
    });
    expect(service.getState().projection!.exercises[0]!.passed).toBe(true);
    await service.refresh();
    expect(service.getState()).toMatchObject({
      status: 'ready',
      temporary: false,
      pendingCount: 0,
    });
    expect(service.getState().projection!.exercises[0]!.passed).toBe(false);
    await expect(service.commitCommand(command)).rejects.toMatchObject({
      code: 'S_GENERATION_STALE',
    });
    await expect(service.capture(token)).rejects.toMatchObject({ code: 'S_GENERATION_STALE' });
    expect(fake.commitOnce).not.toHaveBeenCalled();
    service.dispose();
  });

  it('failed day opening reports unsaved and retries the original occurrence after midnight without guessing a persisted target', async () => {
    const { fake, client, data } = clientDouble();
    let at = '2026-10-15T15:59:59.000Z';
    const id = vi.fn(() => '12345678-1234-4234-8234-123456789abd');
    const service = new LearningService({
      catalog,
      openStorage: async () => client,
      clock: () => at,
      id,
    });
    await service.start();
    fake.commit.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    await expect(service.capture(fact())).rejects.toMatchObject({ code: 'S_QUOTA' });
    expect(service.getState()).toMatchObject({
      status: 'unsaved',
      temporary: true,
      pendingCount: 1,
      lastSaved: false,
    });
    expect(data.goals).toEqual([]);
    at = '2026-10-15T16:00:01.000Z';
    data.goals.push({ localDate: '2026-10-15', goalVersion: 7, targets: null, achievedAt: null });
    await service.retryPending();
    expect(id).toHaveBeenCalledOnce();
    expect(fake.commitOnce).toHaveBeenCalledOnce();
    expect(fake.commitOnce.mock.calls[0]![0]).toMatchObject({
      generation: data.meta.generation,
      receipt: { occurredAt: '2026-10-15T15:59:59.000Z', localDate: '2026-10-15', goalVersion: 7 },
    });
    expect(service.getState()).toMatchObject({
      pendingCount: 0,
      temporary: false,
      lastSaved: true,
    });
    service.dispose();
  });

  it('a pending temporary fact is replayed onto newly read peer rewards instead of hiding them with an old snapshot', async () => {
    const { fake, client, data } = clientDouble();
    data.goals.push({ localDate: '2026-10-15', goalVersion: 1, targets: null, achievedAt: null });
    const service = new LearningService({
      catalog,
      openStorage: async () => client,
      clock: () => '2026-10-15T02:00:00.000Z',
    });
    await service.start();
    const command = await service.capture(fact());
    fake.commitOnce.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    await expect(service.commitCommand(command)).rejects.toMatchObject({ code: 'S_QUOTA' });
    data.ledger.push({
      sourceId: 'reward.case.first-view',
      subjectId: 'case.synthetic.peer',
      localDate: '2026-10-15',
      occurredAt: '2026-10-15T02:01:00.000Z',
      status: 'posted',
      points: 37,
      policyRef: { id: 'legacy.fixture', version: '0.9.0' },
    });
    await service.refresh({ preserveOutcome: true });
    expect(service.getState().projection!.ledger.totalPoints).toBe('37');
    expect(service.getState().projection!.exercises[0]!.passed).toBe(true);
    expect(service.getState().snapshot!.progress).toEqual([]);
    expect(service.getState()).toMatchObject({
      temporary: true,
      pendingCount: 1,
      lastSaved: false,
    });
    service.dispose();
  });

  it('clear removes an invalidated provisional view immediately and cannot revive it when its transaction fails', async () => {
    const { fake, client, data } = clientDouble();
    data.goals.push({ localDate: '2026-10-15', goalVersion: 1, targets: null, achievedAt: null });
    const service = new LearningService({
      catalog,
      openStorage: async () => client,
      clock: () => '2026-10-15T02:00:00.000Z',
    });
    await service.start();
    const command = await service.capture(fact());
    fake.commitOnce.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    await expect(service.commitCommand(command)).rejects.toMatchObject({ code: 'S_QUOTA' });
    expect(service.getState().projection!.exercises[0]!.passed).toBe(true);
    fake.clear.mockRejectedValueOnce(new StorageError('S_ABORTED'));
    const clearing = service.clearLocalData();
    expect(service.getState().projection!.exercises[0]!.passed).toBe(false);
    await clearing;
    expect(service.getState().projection!.exercises[0]!.passed).toBe(false);
    expect(service.getState()).toMatchObject({ cleared: false, pendingCount: 0, lastSaved: false });
    service.dispose();
  });

  it('reset never acknowledges a different generation cleared between the repair and its final read', async () => {
    const { fake, client, data } = clientDouble();
    const damaged = read(data, false);
    damaged.resettable = ['settings'];
    fake.readRecovery.mockResolvedValueOnce(damaged);
    const service = new LearningService({ catalog, openStorage: async () => client });
    await service.start();
    fake.readRecovery.mockResolvedValueOnce(read(archive('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')));
    await service.resetLocalPreference('settings');
    expect(fake.resetSingleton).toHaveBeenCalledOnce();
    expect(service.getState()).toMatchObject({ lastSaved: false, errorCode: 'S_GENERATION_STALE' });
    service.dispose();
  });

  it('a capture whose read was pending before clear cannot subsequently open its old day', async () => {
    const { fake, client, data } = clientDouble();
    const service = new LearningService({ catalog, openStorage: async () => client });
    await service.start();
    const reading = deferred<StorageSnapshot>();
    fake.read.mockReturnValueOnce(reading.promise);
    const capturing = service.capture(fact());
    const rejected = expect(capturing).rejects.toMatchObject({ code: 'S_GENERATION_STALE' });
    await vi.waitFor(() => expect(fake.read).toHaveBeenCalledOnce());
    const cleared = archive('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    fake.readRecovery.mockResolvedValueOnce(read(cleared));
    await service.clearLocalData();
    reading.resolve(data);
    await rejected;
    expect(fake.commit).not.toHaveBeenCalled();
    service.dispose();
  });

  it('temporary facts after a closed connection use an isolated session and become stale when the same archive is reopened', async () => {
    const { fake, client } = clientDouble();
    const service = new LearningService({ catalog, openStorage: async () => client });
    await service.start();
    fake.readRecovery.mockRejectedValueOnce(new StorageError('S_STORAGE_UNAVAILABLE'));
    await service.refresh();
    const token = fact();
    const command = await service.capture(token);
    await expect(service.commitCommand(command)).rejects.toMatchObject({
      code: 'S_STORAGE_UNAVAILABLE',
    });
    expect(service.getState().projection!.exercises[0]!.passed).toBe(true);
    await service.refresh();
    expect(service.getState().projection!.exercises[0]!.passed).toBe(false);
    await expect(service.capture(token)).rejects.toMatchObject({ code: 'S_GENERATION_STALE' });
    await expect(service.commitCommand(command)).rejects.toMatchObject({
      code: 'S_GENERATION_STALE',
    });
    expect(fake.commitOnce).not.toHaveBeenCalled();
    service.dispose();
  });
});
