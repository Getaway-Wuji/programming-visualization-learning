import { describe, expect, it, vi } from 'vitest';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { projectLearning } from '../../web/src/learning/domain';
import {
  decodeProfileConfiguration,
  deriveLearningLevel,
  loadProfileConfiguration,
  type ProfileConfiguration,
} from '../../web/src/learning/profile';
import { LearningService } from '../../web/src/learning/service';
import type { StorageClient } from '../../web/src/storage/client';
import { StorageError } from '../../web/src/storage/errors';
import { createMeta, emptySnapshot, type StorageSnapshot } from '../../web/src/storage/model';
import { assertRecord, assertSnapshot } from '../../web/src/storage/validation';

const config = await loadProfileConfiguration();
const catalog = createLearningCatalog({
  purpose: 'contract-fixture',
  packageRef: { id: 'content.synthetic.profile', version: '1.0.0' },
  lessons: [],
  exercises: [],
  cases: [],
});
function empty() {
  return emptySnapshot(
    createMeta({
      generation: '11300000-0000-4000-8000-000000000001',
      timeZone: 'Asia/Shanghai',
      createdAt: '2026-10-20T02:00:00.000Z',
      activePackageRef: catalog.packageRef,
    }),
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
/** Strict lifecycle/transaction model; native durability is tested by browser tests. */
function model(initial = empty()) {
  let data = structuredClone(initial);
  let writable = true;
  const fake = {
    read: vi.fn(async () => structuredClone(data)),
    readRecovery: vi.fn(async () => ({
      snapshot: structuredClone(data),
      guard: 'profile-model',
      writable,
      issues: [],
      canClear: true,
      resettable: [],
      ledgerUncertain: !writable,
      errorCode: writable ? null : 'S_RECORD_INVALID',
    })),
    commit: vi.fn<StorageClient['commit']>(async (generation, prepare, revision) => {
      if (generation !== data.meta.generation) throw new StorageError('S_GENERATION_STALE');
      if (revision !== data.meta.revision) throw new StorageError('S_REVISION_CONFLICT');
      const operations = prepare(structuredClone(data));
      const next = structuredClone(data);
      for (const operation of operations) {
        if (operation.store !== 'avatar' || operation.mode !== 'put')
          throw new Error('UNEXPECTED_WRITE');
        assertRecord('avatar', operation.value);
        next.avatar = structuredClone(operation.value);
      }
      if (operations.length) next.meta.revision++;
      assertSnapshot(next);
      data = next;
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
    clear: vi.fn(async () => {
      data = empty();
      data.meta.generation = '11300000-0000-4000-8000-000000000002';
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
    set writable(value: boolean) {
      writable = value;
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
  const service = new LearningService({
    catalog,
    openStorage: async () => source.client,
    loadProfileConfig: loadProfileConfiguration,
    ...options,
  });
  return { source, service };
}
async function started(value = setup()) {
  await value.service.start();
  await vi.waitFor(() => expect(value.service.getState().profileStatus).not.toBe('loading'));
  return value;
}

describe('11.3 closed local profile configuration', () => {
  it('loads four reviewed static presets and five immutable levels', () => {
    expect(config.configRef).toEqual({ id: 'profile.config.p0', version: '1.0.0' });
    expect(config.avatars.map((avatar) => [avatar.presetId, avatar.label, avatar.shapeId])).toEqual(
      [
        ['avatar.basic.01', '嫩叶', 'leaf'],
        ['avatar.basic.02', '芽苗', 'sprout'],
        ['avatar.basic.03', '方块', 'block'],
        ['avatar.basic.04', '星光', 'star'],
      ],
    );
    expect(config.levels.map((level) => level.minimumPoints)).toEqual([
      '0',
      '30',
      '100',
      '200',
      '400',
    ]);
    expect(Object.isFrozen(config.avatars[0])).toBe(true);
    expect(Object.isFrozen(config.levels)).toBe(true);
  });
  it('rejects unknown versions, rights, URLs, changed thresholds and duplicate presets', () => {
    for (const value of [
      { ...config, configRef: { ...config.configRef, version: '1.0.1' } },
      { ...config, issuer: 'exercise.passed' },
      {
        ...config,
        avatars: [
          { ...config.avatars[0], url: 'https://example.com/a.svg' },
          ...config.avatars.slice(1),
        ],
      },
      { ...config, avatars: [config.avatars[0], config.avatars[0], ...config.avatars.slice(2)] },
      {
        ...config,
        levels: [
          config.levels[0],
          { ...config.levels[1], minimumPoints: '1' },
          ...config.levels.slice(2),
        ],
      },
      {
        ...config,
        levels: [...config.levels, { level: 6, title: 'extra', minimumPoints: '1000' }],
      },
    ])
      expect(() => decodeProfileConfiguration(value)).toThrow('PROFILE_CONFIGURATION_INVALID');
  });
  it('rejects inherited fields, accessors, sparse arrays and hidden data without invoking accessors', () => {
    const getter = vi.fn(() => config.avatars);
    const accessor = Object.defineProperty({ ...config }, 'avatars', {
      get: getter,
      enumerable: true,
    });
    const hidden = Object.defineProperty({ ...config }, 'secret', { value: true });
    const sparse = [...config.avatars];
    delete sparse[1];
    for (const value of [
      Object.assign(Object.create({ extra: true }), config),
      accessor,
      hidden,
      { ...config, avatars: sparse },
    ])
      expect(() => decodeProfileConfiguration(value)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('11.3 exact derived learning levels', () => {
  it.each([
    ['0', 1, '0', '30', '30', 0],
    ['29', 1, '0', '30', '1', 96],
    ['30', 2, '30', '100', '70', 0],
    ['99', 2, '30', '100', '1', 98],
    ['100', 3, '100', '200', '100', 0],
    ['199', 3, '100', '200', '1', 99],
    ['200', 4, '200', '400', '200', 0],
    ['399', 4, '200', '400', '1', 99],
    ['400', 5, '400', null, '0', 100],
  ])(
    'derives threshold %s without a stored level',
    (points, level, minimumPoints, nextThreshold, remainingPoints, progressPercent) => {
      expect(deriveLearningLevel(points, config)).toMatchObject({
        level,
        minimumPoints,
        nextThreshold,
        remainingPoints,
        progressPercent,
      });
    },
  );
  it('accepts precise totals beyond Number safe range and never converts them to Number', () => {
    expect(deriveLearningLevel('18014398509481982', config)).toEqual({
      level: 5,
      title: '学习同行',
      minimumPoints: '400',
      nextThreshold: null,
      remainingPoints: '0',
      progressPercent: 100,
    });
    expect(deriveLearningLevel('9'.repeat(400), config).level).toBe(5);
  });
  it.each(['', '-1', '1.0', '01', ' 30', '1e3', 'NaN', 'Infinity'])(
    'rejects noncanonical confirmed totals %j',
    (value) => {
      expect(() => deriveLearningLevel(value, config)).toThrow('PROFILE_POINTS_INVALID');
    },
  );
  it('uses the unified posted-only exact projection; pending rights cannot advance a level', () => {
    const snapshot = empty();
    snapshot.ledger.push({
      sourceId: 'reward.exercise.first-pass',
      subjectId: 'exercise.synthetic.posted',
      localDate: '2026-10-20',
      occurredAt: '2026-10-20T02:00:00.000Z',
      status: 'posted',
      points: 29,
      policyRef: { id: 'legacy.fixture', version: '0.9.0' },
    });
    snapshot.progress.push({
      eventType: 'exercise.passed',
      result: 'passed',
      subjectRef: { id: 'exercise.synthetic.pending', version: '1.0.0' },
      packageRef: catalog.packageRef,
      learningRevision: 1,
      firstAt: '2026-10-20T02:00:00.000Z',
      lastAt: '2026-10-20T02:00:00.000Z',
    });
    snapshot.ledger.push({
      sourceId: 'reward.exercise.first-pass',
      subjectId: 'exercise.synthetic.pending',
      localDate: '2026-10-20',
      occurredAt: '2026-10-20T02:00:00.000Z',
      status: 'pending',
      points: null,
      policyRef: null,
    });
    assertSnapshot(snapshot);
    const before = structuredClone(snapshot);
    const projection = projectLearning(snapshot, catalog);
    expect(projection.ledger.pending).toHaveLength(1);
    expect(deriveLearningLevel(projection.ledger.totalPoints, config).level).toBe(1);
    expect(snapshot).toEqual(before);
    snapshot.ledger[0] = {
      ...snapshot.ledger[0],
      status: 'posted',
      points: Number.MAX_SAFE_INTEGER,
      policyRef: { id: 'legacy.fixture', version: '0.9.0' },
    };
    snapshot.ledger.push({ ...snapshot.ledger[0], subjectId: 'exercise.synthetic.second' });
    assertSnapshot(snapshot);
    expect(projectLearning(snapshot, catalog).ledger.totalPoints).toBe('18014398509481982');
  });
});

describe('11.3 profile service settings and lifecycle', () => {
  it('keeps synthetic catalogs disabled unless the narrow loader is explicitly injected', async () => {
    const source = model();
    const service = new LearningService({ catalog, openStorage: async () => source.client });
    await service.start();
    expect(service.getState()).toMatchObject({
      profileStatus: 'disabled',
      profileConfiguration: null,
      capabilities: { avatarPresets: ['avatar.basic.01'] },
    });
    expect(source.fake.commit).not.toHaveBeenCalled();
    service.dispose();
  });
  it('loads profile configuration independently of unavailable storage', async () => {
    const { service } = await started(
      setup(model(), {
        openStorage: async () => {
          throw new StorageError('S_STORAGE_UNAVAILABLE');
        },
      }),
    );
    expect(service.getState()).toMatchObject({
      status: 'unsaved',
      errorCode: 'S_STORAGE_UNAVAILABLE',
      snapshot: null,
      profileStatus: 'ready',
      profileConfiguration: config,
    });
    service.dispose();
  });
  it('allows reviewed profile choices when reading is unavailable without publishing content', async () => {
    const initial = empty();
    initial.meta.activePackageRef = { id: 'content.c.p0', version: '1.0.0' };
    const source = model(initial);
    const service = new LearningService({
      openStorage: async () => source.client,
      loadProfileConfig: loadProfileConfiguration,
      loadReading: async () => {
        throw new Error('READING_UNAVAILABLE');
      },
      loadGoalConfig: async () => {
        throw new Error('GOAL_CONFIGURATION_UNAVAILABLE');
      },
    });
    await service.start();
    await vi.waitFor(() => {
      expect(service.getState()).toMatchObject({
        profileStatus: 'ready',
        readingStatus: 'failed',
        status: 'ready',
        capabilities: { learning: false },
      });
    });
    await service.saveAvatar(
      { presetId: 'avatar.basic.03', accentColor: '#168A72' },
      source.data.meta.revision,
    );
    expect(service.getState().lastSaved).toBe(true);
    expect(source.data.avatar.presetId).toBe('avatar.basic.03');
    expect(source.data).toMatchObject({ progress: [], ledger: [], receipts: [], goals: [] });
    service.dispose();
  });
  it('saves each controlled preset with revision CAS and changes no learning or reward records', async () => {
    const { service, source } = await started();
    expect(service.getState().capabilities.avatarPresets).toEqual(
      config.avatars.map((avatar) => avatar.presetId),
    );
    for (const preset of config.avatars) {
      await service.saveAvatar(
        { presetId: preset.presetId, accentColor: '#A32E5C' },
        source.data.meta.revision,
      );
      expect(service.getState()).toMatchObject({
        status: 'ready',
        lastSaved: true,
        snapshot: { avatar: { presetId: preset.presetId, accentColor: '#A32E5C' } },
      });
    }
    expect(source.data).toMatchObject({
      progress: [],
      ledger: [],
      receipts: [],
      goals: [],
      dailyFacts: [],
    });
    service.dispose();
  });
  it('preserves the prior saved avatar and reports conflict when another tab advanced the revision', async () => {
    const { service, source } = await started();
    const revised = structuredClone(source.data);
    revised.meta.revision++;
    revised.avatar = { presetId: 'avatar.basic.04', accentColor: '#5432AE' };
    source.replace(revised);
    await service.saveAvatar({ presetId: 'avatar.basic.02', accentColor: '#168A72' }, 0);
    expect(service.getState()).toMatchObject({
      status: 'conflict',
      errorCode: 'S_REVISION_CONFLICT',
      lastSaved: false,
    });
    expect(source.data.avatar).toEqual(revised.avatar);
    service.dispose();
  });
  it('never acknowledges a quota failure or failed verification read as saved', async () => {
    const { service, source } = await started();
    const before = structuredClone(source.data.avatar);
    source.fake.commit.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    await service.saveAvatar({ presetId: 'avatar.basic.03', accentColor: '#168A72' }, 0);
    expect(source.data.avatar).toEqual(before);
    expect(service.getState()).toMatchObject({
      status: 'unsaved',
      errorCode: 'S_QUOTA',
      lastSaved: false,
    });
    source.fake.readRecovery.mockRejectedValueOnce(new StorageError('S_STORAGE_UNAVAILABLE'));
    await service.saveAvatar({ presetId: 'avatar.basic.03', accentColor: '#168A72' }, 0);
    expect(source.data.avatar.presetId).toBe('avatar.basic.03');
    expect(service.getState()).toMatchObject({
      status: 'unsaved',
      lastSaved: false,
      snapshot: { avatar: before },
    });
    service.dispose();
  });
  it('does not write damaged/readonly recovery archives even with valid profile configuration', async () => {
    const source = model();
    source.writable = false;
    const { service } = await started(setup(source));
    await service.saveAvatar({ presetId: 'avatar.basic.02', accentColor: '#168A72' }, 0);
    expect(source.fake.commit).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ status: 'readonly', lastSaved: false });
    service.dispose();
  });
  it('rejects extra fields and noncanonical colors before persistence', async () => {
    for (const avatar of [
      { presetId: 'avatar.basic.01', accentColor: '#abcdef' },
      { presetId: 'avatar.basic.01', accentColor: '#ABCDEF', url: 'data:image/svg+xml,unsafe' },
      { presetId: 'avatar.basic.99', accentColor: '#ABCDEF' },
    ]) {
      const { service, source } = await started();
      await service.saveAvatar(avatar, 0);
      expect(source.data.avatar).toEqual(empty().avatar);
      expect(service.getState().lastSaved).toBe(false);
      service.dispose();
    }
  });
  it('provides only safe default color editing if configuration fails and can explicitly reload', async () => {
    const load = vi
      .fn<() => Promise<ProfileConfiguration>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(config);
    const { service, source } = await started(setup(model(), { loadProfileConfig: load }));
    expect(service.getState()).toMatchObject({
      profileStatus: 'failed',
      profileError: 'PROFILE_CONFIGURATION_UNAVAILABLE',
      capabilities: { avatarPresets: ['avatar.basic.01'] },
    });
    await service.saveAvatar({ presetId: 'avatar.basic.01', accentColor: '#ABCDEF' }, 0);
    expect(service.getState().lastSaved).toBe(true);
    await service.saveAvatar({ presetId: 'avatar.basic.03', accentColor: '#ABCDEF' }, 1);
    expect(source.data.avatar).toEqual({ presetId: 'avatar.basic.01', accentColor: '#ABCDEF' });
    expect(service.getState().lastSaved).toBe(false);
    await service.reloadProfileConfiguration();
    expect(service.getState().profileStatus).toBe('ready');
    await service.saveAvatar({ presetId: 'avatar.basic.03', accentColor: '#ABCDEF' }, 1);
    expect(source.data.avatar.presetId).toBe('avatar.basic.03');
    service.dispose();
  });
  it('retains an unavailable saved preset during failure rather than replacing or writing it', async () => {
    const saved = empty();
    saved.avatar = { presetId: 'avatar.future.shape', accentColor: '#ABCDEF' };
    const source = model(saved);
    const { service } = await started(
      setup(source, {
        loadProfileConfig: async () => {
          throw new Error('unavailable');
        },
      }),
    );
    expect(service.getState().snapshot!.avatar).toEqual(saved.avatar);
    expect(source.fake.commit).not.toHaveBeenCalled();
    await service.saveAvatar({ ...saved.avatar, accentColor: '#123456' }, 0);
    expect(source.data.avatar).toEqual(saved.avatar);
    expect(service.getState().lastSaved).toBe(false);
    service.dispose();
  });
  it('discards obsolete loader results and does not let configuration success change storage recovery state', async () => {
    const older = deferred<ProfileConfiguration>();
    const source = model();
    source.writable = false;
    const load = vi
      .fn<() => Promise<ProfileConfiguration>>()
      .mockImplementationOnce(() => older.promise)
      .mockRejectedValueOnce(new Error('newer-failure'));
    const { service } = setup(source, { loadProfileConfig: load });
    await service.start();
    await service.reloadProfileConfiguration();
    older.resolve(config);
    await vi.waitFor(() => expect(service.getState().profileStatus).toBe('failed'));
    expect(service.getState()).toMatchObject({
      status: 'readonly',
      recovery: { writable: false, ledgerUncertain: true },
      lastSaved: false,
      profileConfiguration: null,
    });
    expect(source.fake.commit).not.toHaveBeenCalled();
    service.dispose();
  });
  it('clears to the original default and rejects an avatar edit captured before the clear barrier', async () => {
    const saved = empty();
    saved.avatar = { presetId: 'avatar.basic.04', accentColor: '#ABCDEF' };
    const { service, source } = await started(setup(model(saved)));
    const pending = service.saveAvatar({ presetId: 'avatar.basic.02', accentColor: '#987654' }, 0);
    const clearing = service.clearLocalData();
    await Promise.all([pending, clearing]);
    expect(source.fake.commit).not.toHaveBeenCalled();
    expect(source.data.avatar).toEqual({ presetId: 'avatar.basic.01', accentColor: '#168A72' });
    expect(service.getState()).toMatchObject({
      cleared: true,
      snapshot: { meta: { generation: '11300000-0000-4000-8000-000000000002' } },
    });
    service.dispose();
  });
  it('rejects writes if another tab changed the generation without a delivered notification', async () => {
    const { service, source } = await started();
    const cleared = empty();
    cleared.meta.generation = '11300000-0000-4000-8000-000000000002';
    source.replace(cleared);
    await service.saveAvatar({ presetId: 'avatar.basic.04', accentColor: '#ABCDEF' }, 0);
    expect(source.data).toEqual(cleared);
    expect(service.getState()).toMatchObject({
      errorCode: 'S_GENERATION_STALE',
      lastSaved: false,
    });
    service.dispose();
  });
  it('a late configuration load after clear never recreates old avatar or learning data', async () => {
    const loading = deferred<ProfileConfiguration>();
    const saved = empty();
    saved.avatar.presetId = 'avatar.basic.03';
    const { service, source } = setup(model(saved), { loadProfileConfig: () => loading.promise });
    await service.start();
    await service.clearLocalData();
    const afterClear = structuredClone(source.data);
    loading.resolve(config);
    await vi.waitFor(() => expect(service.getState().profileStatus).toBe('ready'));
    expect(source.data).toEqual(afterClear);
    expect(service.getState()).toMatchObject({
      cleared: true,
      status: 'ready',
      snapshot: afterClear,
    });
    expect(source.fake.commit).not.toHaveBeenCalled();
    service.dispose();
  });
  it('does not publish a late configuration result after disposal', async () => {
    const loading = deferred<ProfileConfiguration>();
    const { service } = setup(model(), { loadProfileConfig: () => loading.promise });
    await service.start();
    const listener = vi.fn();
    service.subscribe(listener);
    service.dispose();
    loading.resolve(config);
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(service.getState().profileStatus).toBe('loading');
  });
});
