import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageClient } from '../../web/src/storage/client';
import {
  DB_NAME,
  STORE_NAMES,
  defaultAppearance,
  defaultAvatar,
  defaultSettings,
  recordKey,
} from '../../web/src/storage/model';
import type { StorageSnapshot } from '../../web/src/storage/model';
import {
  inspectRecoveryRows,
  readRawTransaction,
  sameRecoveryValue,
} from '../../web/src/storage/recovery';
import type { RawStorageRows } from '../../web/src/storage/recovery';
import { assertSnapshot, validateSnapshot } from '../../web/src/storage/validation';
import { assertLegacySnapshot, upgradeV1Snapshot } from '../../web/src/storage/v1-migration';

const samples = JSON.parse(
  readFileSync(new URL('../../项目文档/契约/02.3-存档样例.json', import.meta.url), 'utf8'),
) as {
  snapshots: { snapshot: unknown }[];
};
function snapshot(index = 1): StorageSnapshot {
  const value = structuredClone(samples.snapshots[index].snapshot);
  assertLegacySnapshot(value);
  return upgradeV1Snapshot(value);
}
function rawSnapshot(value = snapshot()): RawStorageRows {
  const raw = {} as RawStorageRows;
  for (const store of STORE_NAMES) {
    const rows =
      store === 'meta' || store === 'settings' || store === 'avatar' || store === 'appearance'
        ? [value[store]]
        : value[store];
    raw[store] = {
      values: structuredClone(rows),
      keys: rows.map((row) => recordKey(store, value.meta.generation, row as never)),
    };
  }
  return raw;
}
function inspect(raw: RawStorageRows) {
  return inspectRecoveryRows(raw, (a, b) => (sameRecoveryValue(a, b) ? 0 : 1));
}
function expectLegalReadOnly(raw: RawStorageRows) {
  const before = structuredClone(raw);
  const result = inspect(raw);
  expect(result.writable).toBe(false);
  if (result.snapshot) expect(validateSnapshot(result.snapshot)).toBe(true);
  expect(raw).toEqual(before);
  return result;
}

describe('non-destructive SAVE recovery projection', () => {
  it('keeps an exhausted safe revision readable but pauses writes without wrapping it', () => {
    const value = snapshot();
    value.meta.revision = Number.MAX_SAFE_INTEGER;
    const result = expectLegalReadOnly(rawSnapshot(value));
    expect(result.snapshot?.meta.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.canClear).toBe(true);
    expect(result.resettable).toEqual([]);
    expect(result.appearanceCanReset).toBe(false);
  });
  it('returns both frozen lawful projections unchanged with no recovery issues', () => {
    for (const index of [0, 1]) {
      const value = snapshot(index);
      expect(inspect(rawSnapshot(value))).toEqual({
        snapshot: value,
        issues: [],
        canClear: true,
        resettable: [],
        ledgerUncertain: false,
        writable: true,
        errorCode: null,
        appearanceReadOnly: false,
        appearanceCanReset: true,
      });
    }
  });
  for (const store of ['settings', 'avatar'] as const) {
    it(`displays explicit defaults for corrupt ${store}, leaves every original row untouched`, () => {
      const raw = rawSnapshot();
      raw[store].values[0] = { private: 'invalid row retained only in its original DB' };
      const result = expectLegalReadOnly(raw);
      expect(result.snapshot?.[store]).toEqual(
        store === 'settings' ? defaultSettings() : defaultAvatar(),
      );
      expect(result.snapshot?.progress).toEqual(snapshot().progress);
      expect(result.snapshot?.ledger).toEqual(snapshot().ledger);
      expect(result.resettable).toEqual([store]);
      expect(result.issues).toEqual([{ store, count: 1 }]);
      expect(result.ledgerUncertain).toBe(false);
    });
    it(`does not silently accept a missing or physically displaced ${store} singleton`, () => {
      const raw = rawSnapshot();
      raw[store].keys = [];
      raw[store].values = [];
      expect(expectLegalReadOnly(raw).resettable).toContain(store);
      raw[store] = { keys: ['wrong-current'], values: [snapshot()[store]] };
      expect(expectLegalReadOnly(raw).resettable).toContain(store);
    });
  }
  it('isolates a bad receipt, preserving unrelated progress and rewards without writing replacements', () => {
    const raw = rawSnapshot();
    Object.assign(raw.receipts.values[0] as object, { source: 'forbidden body' });
    const result = expectLegalReadOnly(raw);
    expect(result.snapshot?.receipts).toHaveLength(1);
    expect(result.snapshot?.progress).toEqual(snapshot().progress);
    expect(result.issues).toContainEqual({ store: 'receipts', count: 1 });
  });
  it('keeps legal progress visible while isolating damaged progress and dependent facts/awards', () => {
    const raw = rawSnapshot();
    (raw.progress.values[1] as { result: string }).result = 'completed';
    const result = expectLegalReadOnly(raw);
    expect(result.snapshot?.progress).toHaveLength(2);
    expect(result.issues).toContainEqual({ store: 'progress', count: 1 });
    expect(result.ledgerUncertain).toBe(true);
    expect(result.canClear).toBe(true);
  });
  it('marks the ledger total unconfirmable instead of presenting the sum of remaining valid awards', () => {
    const raw = rawSnapshot();
    (raw.ledger.values[0] as { points: number }).points = -1;
    const result = expectLegalReadOnly(raw);
    expect(result.ledgerUncertain).toBe(true);
    expect(result.snapshot?.ledger).toHaveLength(2);
    expect(result.snapshot?.progress).toEqual(snapshot().progress);
    expect(result.issues).toContainEqual({ store: 'ledger', count: 1 });
  });
  it('does not trust a well-formed award that has an unknown progress relation', () => {
    const raw = rawSnapshot();
    (raw.ledger.values[0] as { subjectId: string }).subjectId = 'exercise.c.unrelated';
    raw.ledger.keys[0] = [
      snapshot().meta.generation,
      'reward.exercise.first-pass',
      'exercise.c.unrelated',
    ];
    const result = expectLegalReadOnly(raw);
    expect(result.ledgerUncertain).toBe(true);
    expect(
      result.snapshot?.ledger.some((entry) => entry.subjectId === 'exercise.c.unrelated'),
    ).toBe(false);
  });
  it('isolates a logical row under a foreign-generation or mismatching physical key', () => {
    const raw = rawSnapshot();
    raw.progress.keys[1] = [
      '22222222-2222-4222-8222-222222222222',
      'exercise.passed',
      'exercise.c.echo',
      '1.0.0',
      1,
    ];
    const result = expectLegalReadOnly(raw);
    expect(result.snapshot?.progress).toHaveLength(2);
    expect(result.issues).toContainEqual({ store: 'progress', count: 1 });
    expect(result.ledgerUncertain).toBe(true);
  });
  it('isolates alias cycles instead of assigning an unproven canonical reward identity', () => {
    const value = snapshot();
    const edge = {
      fromRef: { id: 'exercise.c.echo', version: '1.0.0' },
      toRef: { id: 'exercise.c.renamed', version: '1.0.0' },
      fromAcceptedPriorVersions: [],
      kind: 'exercise' as const,
      learningRevision: 1,
      manifestRef: { id: 'manifest.fixture.p0', version: '1.0.0' },
    };
    const raw = rawSnapshot(value);
    raw.aliases.values = [edge, { ...edge, fromRef: edge.toRef, toRef: edge.fromRef }];
    raw.aliases.keys = [
      [value.meta.generation, edge.fromRef.id],
      [value.meta.generation, edge.toRef.id],
    ];
    const result = expectLegalReadOnly(raw);
    expect(result.snapshot?.aliases).toEqual([]);
    expect(result.ledgerUncertain).toBe(true);
    expect(result.issues).toContainEqual({ store: 'aliases', count: 2 });
  });
  it('preserves historically declared legacy day awards without fabricating current goals', () => {
    const value = snapshot(0);
    value.ledger.push({
      sourceId: 'reward.daily-goal.once',
      subjectId: 'local-goal.2026-10-14',
      localDate: '2026-10-14',
      occurredAt: '2026-10-13T16:01:00.000Z',
      status: 'posted',
      points: 5,
      policyRef: { id: 'legacy.fixture', version: '0.9.0' },
    });
    const result = inspect(rawSnapshot(value));
    expect(result.writable).toBe(true);
    expect(result.snapshot).toEqual(value);
    expect(result.snapshot?.goals).toEqual([]);
  });
  for (const broken of [
    'missing',
    'no-schema',
    'numeric-schema',
    'bad-generation',
    'bad-timezone',
  ] as const) {
    it(`permits confirmed whole-data clearing for known physical2 layout with ${broken} meta only`, () => {
      const raw = rawSnapshot();
      if (broken === 'missing') raw.meta = { keys: [], values: [] };
      else {
        const meta = raw.meta.values[0] as Record<string, unknown>;
        if (broken === 'no-schema') delete meta.schemaVersion;
        if (broken === 'numeric-schema') meta.schemaVersion = 1;
        if (broken === 'bad-generation') meta.generation = '';
        if (broken === 'bad-timezone') meta.timeZone = 'Invalid/Zone';
      }
      const result = expectLegalReadOnly(raw);
      expect(result.snapshot).toBeNull();
      expect(result.canClear).toBe(true);
      expect(result.resettable).toEqual([]);
      expect(result.ledgerUncertain).toBe(true);
      expect(result.errorCode).toBe(
        broken === 'bad-timezone' ? 'S_DATE_INVALID' : 'S_RECORD_INVALID',
      );
    });
  }
  for (const version of ['1.0.0', '3.0.0', '0.9.0', '0.8.0', 'unrecognized', '']) {
    it(`never offers current-version clearing or partial reset for observed string version ${JSON.stringify(version)}`, () => {
      const raw = rawSnapshot();
      (raw.meta.values[0] as { schemaVersion: string }).schemaVersion = version;
      const result = expectLegalReadOnly(raw);
      expect(result.snapshot).toBeNull();
      expect(result.canClear).toBe(false);
      expect(result.resettable).toEqual([]);
      expect(result.appearanceCanReset).toBe(false);
      expect(result.errorCode).toBe(
        version === '0.9.0' ? 'S_MIGRATION_UNSUPPORTED' : 'S_VERSION_UNKNOWN',
      );
    });
  }
});

describe('appearance recovery is independent from lawful learning', () => {
  const corruptions: { name: string; corrupt: (raw: RawStorageRows) => void }[] = [
    {
      name: 'missing row',
      corrupt: (raw) => {
        raw.appearance = { keys: [], values: [] };
      },
    },
    {
      name: 'wrong singleton key',
      corrupt: (raw) => {
        raw.appearance.keys = ['wrong-current'];
      },
    },
    {
      name: 'second appearance row',
      corrupt: (raw) => {
        raw.appearance.keys.push('extra');
        raw.appearance.values.push(defaultAppearance());
      },
    },
    {
      name: 'old single-color shape',
      corrupt: (raw) => {
        raw.appearance.values = [{ preset: 'minimal', accentColor: '#AA00BB' }];
      },
    },
    {
      name: 'missing theme override',
      corrupt: (raw) => {
        const appearance = defaultAppearance();
        delete (appearance.themeOverrides as Partial<typeof appearance.themeOverrides>).glass;
        raw.appearance.values = [appearance];
      },
    },
    {
      name: 'lowercase theme color',
      corrupt: (raw) => {
        const appearance = defaultAppearance();
        appearance.themeOverrides.tech.accentColor = '#aabbcc';
        raw.appearance.values = [appearance];
      },
    },
    {
      name: 'missing background resource',
      corrupt: (raw) => {
        const appearance = defaultAppearance();
        appearance.background.assetId = 'background';
        appearance.background.visible = true;
        raw.appearance.values = [appearance];
      },
    },
    {
      name: 'orphan resource',
      corrupt: (raw) => {
        raw.appearanceAssets = {
          keys: [['foreign', 'background']],
          values: [{ opaque: new Blob(['invalid retained resource']) }],
        };
      },
    },
    {
      name: 'resource physical keys without values',
      corrupt: (raw) => {
        raw.appearanceAssets.keys = [[snapshot().meta.generation, 'background']];
      },
    },
  ];
  for (const { name, corrupt } of corruptions) {
    it(`retains ${name} in its original raw store while preserving a writable learning projection`, () => {
      const raw = rawSnapshot();
      corrupt(raw);
      const before = structuredClone(raw);
      const result = inspect(raw);
      expect(result.writable).toBe(true);
      expect(result.ledgerUncertain).toBe(false);
      expect(result.appearanceReadOnly).toBe(true);
      expect(result.appearanceCanReset).toBe(true);
      expect(result.canClear).toBe(true);
      expect(result.snapshot?.appearance).toEqual(defaultAppearance());
      expect(result.snapshot?.appearanceAssets).toEqual([]);
      expect(result.snapshot?.settings).toEqual(snapshot().settings);
      for (const store of [
        'progress',
        'dailyFacts',
        'goals',
        'ledger',
        'receipts',
        'aliases',
      ] as const)
        expect(result.snapshot?.[store]).toEqual(snapshot()[store]);
      expect(
        result.issues.some(
          (issue) => issue.store === 'appearance' || issue.store === 'appearanceAssets',
        ),
      ).toBe(true);
      assertSnapshot(result.snapshot);
      expect(raw).toEqual(before);
    });
  }
  it('retains a legitimate native Blob and checks its generation key without quarantining learning', () => {
    const value = snapshot();
    const blob = new Blob(['metadata-only fixture'], { type: 'image/png' });
    value.appearance.background.assetId = 'background';
    value.appearanceAssets = [
      {
        assetId: 'background',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        byteLength: blob.size,
        blob,
      },
    ];
    const raw = rawSnapshot(value);
    const before = structuredClone(raw);
    const valid = inspect(raw);
    expect(valid.writable).toBe(true);
    expect(valid.appearanceReadOnly).toBe(false);
    expect(valid.snapshot?.appearanceAssets[0].blob).toBeInstanceOf(Blob);
    expect(valid.snapshot?.appearanceAssets[0].byteLength).toBe(blob.size);
    raw.appearanceAssets.keys[0] = ['22222222-2222-4222-8222-222222222222', 'background'];
    const foreign = inspect(raw);
    expect(foreign.writable).toBe(true);
    expect(foreign.appearanceReadOnly).toBe(true);
    expect(foreign.snapshot?.appearanceAssets).toEqual([]);
    expect(raw.appearanceAssets.values).toEqual(before.appearanceAssets.values);
  });
  it('does not allow whole-appearance reset to bypass broken settings or exhausted meta revisions', () => {
    const raw = rawSnapshot();
    raw.appearance.values = [{ invalid: true }];
    raw.settings.values = [{ theme: 'invalid' }];
    const damagedSettings = inspect(raw);
    expect(damagedSettings.writable).toBe(false);
    expect(damagedSettings.appearanceReadOnly).toBe(true);
    expect(damagedSettings.appearanceCanReset).toBe(false);
    const exhausted = rawSnapshot();
    (exhausted.meta.values[0] as { revision: number }).revision = Number.MAX_SAFE_INTEGER;
    exhausted.appearance.values = [{ invalid: true }];
    expect(inspect(exhausted).appearanceCanReset).toBe(false);
  });
});

describe('private recovery confirmations and invalidation hints', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('compares corrupt private meta by value, detecting changes and handling cyclic clone data', () => {
    const value: Record<string, unknown> = {
      revision: 'invalid',
      extra: [1, new Date(0), new Uint8Array([2, 3])],
      map: new Map([['one', new Set([1, 2])]]),
    };
    value.self = value;
    const clone = structuredClone(value);
    expect(sameRecoveryValue(value, clone)).toBe(true);
    clone.revision = 'changed';
    expect(sameRecoveryValue(value, clone)).toBe(false);
    expect(sameRecoveryValue(new Date(1), new Date(2))).toBe(false);
    expect(sameRecoveryValue(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(sameRecoveryValue(new Blob(['one']), new Blob(['two']))).toBe(false);
  });
  it('queues all twenty-two raw key/value reads before returning a projection', () => {
    const source = rawSnapshot();
    const requests: { result: unknown; onsuccess: (() => void) | null }[] = [];
    const tx = {
      objectStore(name: keyof RawStorageRows) {
        const request = (result: unknown) => {
          const pending = { result, onsuccess: null as (() => void) | null };
          requests.push(pending);
          return pending;
        };
        return {
          getAll: () => request(source[name].values),
          getAllKeys: () => request(source[name].keys),
        };
      },
    } as unknown as IDBTransaction;
    const ready = vi.fn(),
      fail = vi.fn();
    readRawTransaction(tx, ready, fail);
    expect(requests).toHaveLength(22);
    expect(ready).not.toHaveBeenCalled();
    requests.slice(0, -1).forEach((request) => request.onsuccess!());
    expect(ready).not.toHaveBeenCalled();
    requests.at(-1)!.onsuccess!();
    expect(ready).toHaveBeenCalledWith(source);
    expect(fail).not.toHaveBeenCalled();
  });
  it('accepts only minimal valid BC hints; versionchange closes and notifies even without a hint', () => {
    class FakeChannel {
      static current: FakeChannel;
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      close = vi.fn();
      constructor() {
        FakeChannel.current = this;
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const close = vi.fn();
    const db = { name: DB_NAME, close } as unknown as IDBDatabase;
    const client = new StorageClient(db, false, {} as IDBFactory);
    const channel = FakeChannel.current;
    const listener = vi.fn();
    const unsubscribe = client.subscribeInvalidation(listener);
    for (const data of [
      null,
      {},
      { generation: snapshot().meta.generation, revision: -1 },
      { generation: 'invalid', revision: 1 },
      { generation: snapshot().meta.generation, revision: 1, progress: [] },
    ]) {
      channel.onmessage!({ data } as MessageEvent<unknown>);
    }
    expect(listener).not.toHaveBeenCalled();
    channel.onmessage!({
      data: { generation: snapshot().meta.generation, revision: 3 },
    } as MessageEvent<unknown>);
    expect(listener).toHaveBeenCalledOnce();
    db.onversionchange!.call(db, {} as IDBVersionChangeEvent);
    expect(close).toHaveBeenCalledOnce();
    expect(channel.close).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    client.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
