import { describe, expect, it, vi } from 'vitest';
import { LearningService } from '../../web/src/learning/service';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { createMeta, defaultAppearance, emptySnapshot } from '../../web/src/storage/model';
import type { StorageClient } from '../../web/src/storage/client';
import { StorageError } from '../../web/src/storage/errors';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function harness() {
  let data = emptySnapshot(
    createMeta({
      generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      timeZone: 'Asia/Shanghai',
      createdAt: '2026-10-24T00:00:00.000Z',
      activePackageRef: { id: 'content.synthetic.appearance', version: '1.0.0' },
    }),
  );
  let damaged = false;
  const recovery = () => ({
    snapshot: structuredClone(data),
    guard: 'private-guard',
    writable: true,
    issues: [],
    canClear: true,
    resettable: [],
    ledgerUncertain: false,
    errorCode: null,
    appearanceReadOnly: damaged,
    appearanceCanReset: true,
  });
  const fake = {
    read: vi.fn(async () => structuredClone(data)),
    readRecovery: vi.fn(async () => recovery()),
    close: vi.fn(),
    timeZoneFallback: false,
    commit: vi.fn<StorageClient['commit']>(async (generation, prepare, revision) => {
      if (generation !== data.meta.generation) throw new StorageError('S_GENERATION_STALE');
      if (revision !== data.meta.revision) throw new StorageError('S_REVISION_CONFLICT');
      const operations = prepare(structuredClone(data));
      for (const op of operations) Object.assign(data, { [op.store]: structuredClone(op.value) });
      if (operations.length) data.meta.revision++;
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    commitAppearance: vi.fn<StorageClient['commitAppearance']>(
      async (generation, prepare, revision): ReturnType<StorageClient['commitAppearance']> => {
        if (damaged) throw new StorageError('S_RECORD_INVALID');
        return fake.commit(generation, prepare, revision);
      },
    ),
    resetAppearance: vi.fn<StorageClient['resetAppearance']>(async (generation, revision) => {
      if (generation !== data.meta.generation) throw new StorageError('S_GENERATION_STALE');
      if (revision !== data.meta.revision) throw new StorageError('S_REVISION_CONFLICT');
      data.appearance = defaultAppearance();
      data.settings.theme = 'light';
      data.meta.revision++;
      damaged = false;
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    clear: vi.fn(async () => {
      data = emptySnapshot(
        createMeta({
          ...data.meta,
          generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          revision: 0,
        }),
      );
      return structuredClone(data);
    }),
  };
  const catalog = createLearningCatalog({
    purpose: 'contract-fixture',
    packageRef: data.meta.activePackageRef,
    lessons: [],
    exercises: [],
    cases: [],
  });
  const service = new LearningService({
    catalog,
    openStorage: async () => fake as unknown as StorageClient,
  });
  return {
    service,
    fake,
    current: () => data,
    damage: () => {
      damaged = true;
    },
  };
}

// Lifecycle/ACK tests only. Native transaction evidence is separate.
describe('appearance service acknowledgement and draft isolation', () => {
  it('captures the submitted draft and waits for ACK before claiming saved', async () => {
    const { service, fake, current } = harness();
    await service.start();
    const gate = deferred(),
      entered = deferred();
    const native = fake.commitAppearance.getMockImplementation()!;
    fake.commitAppearance.mockImplementationOnce(
      async (...args: Parameters<StorageClient['commitAppearance']>) => {
        entered.resolve();
        await gate.promise;
        return native(...args);
      },
    );
    const draft = defaultAppearance();
    draft.preset = 'cute';
    draft.themeOverrides.cute.accentColor = '#DB2777';
    const saving = service.saveAppearance(draft, 0);
    draft.themeOverrides.cute.accentColor = '#000000';
    await entered.promise;
    expect(service.getState()).toMatchObject({ status: 'saving', lastSaved: false });
    gate.resolve();
    await saving;
    expect(current().appearance.themeOverrides.cute.accentColor).toBe('#DB2777');
    expect(service.getState()).toMatchObject({ status: 'ready', lastSaved: true });
    service.dispose();
  });
  it('retains authoritative peer color and exposes conflict without poisoning learning capability', async () => {
    const { service, current } = harness();
    await service.start();
    current().appearance.themeOverrides.glass.accentColor = '#0E7490';
    current().meta.revision++;
    await service.saveAppearance(defaultAppearance(), 0);
    expect(current().appearance.themeOverrides.glass.accentColor).toBe('#0E7490');
    expect(service.getState()).toMatchObject({
      status: 'conflict',
      appearanceError: 'S_REVISION_CONFLICT',
      lastSaved: false,
      recovery: { writable: true, ledgerUncertain: false },
    });
    service.dispose();
  });
  it('isolates a damaged appearance error while ordinary core settings still save', async () => {
    const { service, damage } = harness();
    damage();
    await service.start();
    expect(service.getState()).toMatchObject({
      status: 'ready',
      appearanceReadOnly: true,
      recovery: { writable: true },
    });
    await service.saveAppearance(defaultAppearance(), 0);
    expect(service.getState()).toMatchObject({
      appearanceReadOnly: true,
      lastSaved: false,
      recovery: { writable: true, ledgerUncertain: false },
    });
    await service.saveDisplay({ theme: 'dark', reducedMotion: 'system', playbackRate: 1 }, 0);
    expect(service.getState()).toMatchObject({
      status: 'ready',
      lastSaved: true,
      snapshot: { settings: { theme: 'dark' } },
      appearanceReadOnly: true,
    });
    service.dispose();
  });
  it('resetting all appearance keeps the learning session epoch and other preferences', async () => {
    const { service, current } = harness();
    current().settings.playbackRate = 2;
    current().settings.theme = 'dark';
    current().appearance.themeOverrides.soft.accentColor = '#B45309';
    await service.start();
    const epoch = service.getState().sessionEpoch;
    await service.resetAppearance(0);
    expect(service.getState().sessionEpoch).toBe(epoch);
    expect(current().appearance).toEqual(defaultAppearance());
    expect(current().settings).toMatchObject({ theme: 'light', playbackRate: 2 });
    service.dispose();
  });
  it('does not publish an old appearance ACK across an immediate clear boundary', async () => {
    const { service, fake } = harness();
    await service.start();
    const entered = deferred(),
      gate = deferred();
    fake.commitAppearance.mockImplementationOnce(async () => {
      entered.resolve();
      await gate.promise;
      return { saved: true, revision: 1, replayed: false };
    });
    const saving = service.saveAppearance({ ...defaultAppearance(), preset: 'cool' }, 0);
    await entered.promise;
    const clearing = service.clearLocalData();
    expect(service.getState().sessionEpoch).toBe(1);
    gate.resolve();
    await saving;
    await clearing;
    expect(service.getState()).toMatchObject({
      snapshot: {
        meta: { generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        appearance: { preset: 'minimal' },
      },
      cleared: true,
      lastSaved: false,
    });
    service.dispose();
  });
});
