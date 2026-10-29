import { describe, expect, it, vi } from 'vitest';
import {
  assertConfiguredTargets,
  decodeGoalConfiguration,
  loadGoalConfiguration,
} from '../../web/src/learning/goals';
import { LearningService } from '../../web/src/learning/service';
import { StorageError } from '../../web/src/storage/errors';
import type { StorageClient } from '../../web/src/storage/client';
import { assertSnapshot } from '../../web/src/storage/validation';
import {
  applyP05Operations,
  p05At,
  p05Catalog,
  p05Date,
  p05Empty,
  p05Package,
} from '../fixtures/p05-learning';

const expanded = await loadGoalConfiguration(p05Package);

function goalsService() {
  let data = p05Empty();
  data.meta.revision = 12;
  data.settings.goalTemplate = { revision: 3, targets: { exercise: 6, lesson: 6, case: 1 } };
  data.goals = [
    {
      localDate: p05Date,
      goalVersion: 3,
      targets: { exercise: 6, lesson: 6, case: 1 },
      achievedAt: null,
    },
  ];
  let at = p05At;
  const check = (generation: string, revision?: number) => {
    if (data.meta.generation !== generation) throw new StorageError('S_GENERATION_STALE');
    if (revision !== undefined && data.meta.revision !== revision)
      throw new StorageError('S_REVISION_CONFLICT');
  };
  // This model checks actual service recipes and their CAS/row scope. Browser
  // acceptance owns the independent native IndexedDB and real-fact evidence.
  const fake = {
    read: vi.fn(async () => structuredClone(data)),
    commit: vi.fn<StorageClient['commit']>(async (generation, recipe, revision) => {
      check(generation, revision);
      applyP05Operations(data, recipe(structuredClone(data)));
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    settleRewards: vi.fn<StorageClient['settleRewards']>(async (generation, recipe) => {
      check(generation);
      applyP05Operations(data, recipe(structuredClone(data)));
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    close: vi.fn(),
    timeZoneFallback: false,
  };
  const service = new LearningService({
    catalog: p05Catalog(),
    openStorage: async () => fake as unknown as StorageClient,
    loadGoalConfig: () => loadGoalConfiguration(p05Package),
    clock: () => at,
  });
  return {
    service,
    fake,
    get data() {
      return structuredClone(data);
    },
    setTime(value: string) {
      at = value;
    },
    replace(next: typeof data) {
      data = structuredClone(next);
    },
  };
}

describe('P0.5-09 new goal configuration with old saved dates', () => {
  it('uses exact package selection for the new 32/32/7 resource while retaining the old resource', async () => {
    expect(expanded).toEqual({
      configRef: { id: 'goal.config.p0', version: '1.1.0' },
      recommended: { exercise: 1, lesson: 1, case: 0 },
      limits: { exercise: 32, lesson: 32, case: 7 },
    });
    expect((await loadGoalConfiguration()).limits).toEqual({ exercise: 6, lesson: 6, case: 7 });
    expect(
      (await loadGoalConfiguration({ id: 'content.c.p0', version: '1.0.2' })).configRef.version,
    ).toBe('1.0.0');
    expect(
      (await loadGoalConfiguration({ ...p05Package, version: '1.0.1' })).configRef.version,
    ).toBe('1.0.0');
    expect(Object.isFrozen(expanded.limits)).toBe(true);
  });
  it('accepts every 0..32 lesson/exercise combination, retaining at least one positive target', () => {
    for (let exercise = 0; exercise <= 32; exercise++) {
      for (let lesson = 0; lesson <= 32; lesson++) {
        expect(() =>
          assertConfiguredTargets({ exercise, lesson, case: exercise || lesson ? 0 : 1 }, expanded),
        ).not.toThrow();
      }
    }
    expect(() =>
      assertConfiguredTargets({ exercise: 32, lesson: 32, case: 7 }, expanded),
    ).not.toThrow();
    expect(() =>
      assertConfiguredTargets({ exercise: 6, lesson: 6, case: 1 }, expanded),
    ).not.toThrow();
  });
  it.each([
    { exercise: 33, lesson: 0, case: 0 },
    { exercise: 0, lesson: 33, case: 0 },
    { exercise: 0, lesson: 0, case: 8 },
    { exercise: 0, lesson: 0, case: 0 },
    { exercise: -1, lesson: 1, case: 0 },
    { exercise: 1.5, lesson: 1, case: 0 },
  ])('rejects unavailable or malformed targets %j', (targets) => {
    expect(() => assertConfiguredTargets(targets, expanded)).toThrow();
  });
  it('rejects version/limit cross-wiring and extra fields', () => {
    expect(() =>
      decodeGoalConfiguration({
        ...expanded,
        configRef: { id: 'goal.config.p0', version: '1.0.0' },
      }),
    ).toThrow('GOAL_CONFIGURATION_INVALID');
    expect(() =>
      decodeGoalConfiguration({ ...expanded, limits: { exercise: 6, lesson: 6, case: 7 } }),
    ).toThrow('GOAL_CONFIGURATION_INVALID');
    expect(() =>
      decodeGoalConfiguration({
        ...expanded,
        configRef: { id: 'goal.config.p0', version: '1.2.0' },
      }),
    ).toThrow('GOAL_CONFIGURATION_INVALID');
    expect(() => decodeGoalConfiguration({ ...expanded, autoOpen: true })).toThrow(
      'GOAL_CONFIGURATION_INVALID',
    );
  });
  it('startup and configuration reload preserve the old 6/6/1 template and already opened day verbatim', async () => {
    const t = goalsService();
    const before = t.data;
    await t.service.start();
    await t.service.reloadGoalConfiguration();
    await t.service.refresh();
    expect(t.data).toEqual(before);
    expect(t.service.getState().goalConfiguration?.limits).toEqual({
      exercise: 32,
      lesson: 32,
      case: 7,
    });
    expect(t.fake.commit).not.toHaveBeenCalled();
    t.service.dispose();
  });
  it('a deliberate 32/32/7 template update changes only settings, preserving the opened old snapshot and all awards', async () => {
    const t = goalsService();
    await t.service.start();
    const before = t.data;
    await t.service.saveGoalTemplate({ exercise: 32, lesson: 32, case: 7 }, before.meta.revision);
    const after = t.data;
    expect(after).toEqual({
      ...before,
      meta: { ...before.meta, revision: before.meta.revision + 1 },
      settings: {
        ...before.settings,
        goalTemplate: { revision: 4, targets: { exercise: 32, lesson: 32, case: 7 } },
      },
    });
    expect(after.goals[0]).toEqual(before.goals[0]);
    expect(after.receipts).toEqual([]);
    expect(after.dailyFacts).toEqual([]);
    expect(after.ledger).toEqual([]);
    t.service.dispose();
  });
  it('rejects 33 before writing and preserves the original CAS revision on conflict', async () => {
    const t = goalsService();
    await t.service.start();
    const before = t.data;
    await t.service.saveGoalTemplate({ exercise: 33, lesson: 0, case: 0 }, before.meta.revision);
    expect(t.data).toEqual(before);
    expect(t.service.getState().lastSaved).toBe(false);
    const otherTab = t.data;
    otherTab.meta.revision++;
    t.replace(otherTab);
    await t.service.saveGoalTemplate({ exercise: 32, lesson: 32, case: 7 }, before.meta.revision);
    expect(t.service.getState().status).toBe('conflict');
    expect(t.data.settings).toEqual(before.settings);
    expect(t.data.goals).toEqual(before.goals);
    t.service.dispose();
  });
  it('does not open an unvisited date on refresh or configuration changes', async () => {
    const t = goalsService();
    await t.service.start();
    t.setTime('2026-10-28T02:00:00.000Z');
    await t.service.refresh();
    await t.service.reloadGoalConfiguration();
    expect(t.data.goals.map((goal) => goal.localDate)).toEqual([p05Date]);
    expect(t.data.dailyFacts).toEqual([]);
    expect(t.data.receipts).toEqual([]);
    expect(t.data.ledger).toEqual([]);
    assertSnapshot(t.data);
    t.service.dispose();
  });
});
