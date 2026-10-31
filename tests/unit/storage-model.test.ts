import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  SCHEMA_VERSION,
  CORE_STORE_NAMES,
  STORE_NAMES,
  ALL_STORE_NAMES,
  THEME_IDS,
  createMeta,
  defaultAppearance,
  defaultAvatar,
  defaultSettings,
  emptySnapshot,
  recordKey,
} from '../../web/src/storage/model';
import type { Alias, AppearanceAsset, StorageSnapshot } from '../../web/src/storage/model';
import {
  StorageValidationError,
  assertRecord,
  assertSnapshot,
  isLocalDate,
  isTimeZone,
  isUtcTime,
  localDateAt,
  validateRecord,
  validateSnapshot,
} from '../../web/src/storage/validation';
import { migrateLegacyReference } from '../../web/src/storage/migrations';
import { assertLegacySnapshot, upgradeV1Snapshot } from '../../web/src/storage/v1-migration';

function frozenFile(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../项目文档/契约/${name}`, import.meta.url), 'utf8'));
}
const sample = frozenFile('02.3-存档样例.json') as {
  snapshots: { id: string; snapshot: unknown }[];
};
const scenarios = frozenFile('02.3-迁移与并发场景.json') as {
  legacyFixture: unknown;
  dateVectors: { timeZone: string; at: string; date: string }[];
  invalidSnapshots: {
    id: string;
    path?: string;
    value?: unknown;
    appendTo?: string;
    copyFrom?: string;
    code: string;
  }[];
};
function snapshot(index = 1): StorageSnapshot {
  const value = structuredClone(sample.snapshots[index].snapshot);
  assertLegacySnapshot(value);
  return upgradeV1Snapshot(value);
}
// This fixture exercises native Blob/metadata shape only, never browser decoding.
function backgroundAsset(): AppearanceAsset {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVRsAAAAASUVORK5CYII=',
    'base64',
  );
  const blob = new Blob([bytes], { type: 'image/png' });
  return {
    assetId: 'background',
    mimeType: 'image/png',
    byteLength: blob.size,
    width: 1,
    height: 1,
    blob,
  };
}
function pointer(value: unknown, path: string): { parent: Record<string, unknown>; key: string } {
  const parts = path.slice(1).split('/');
  const key = parts.pop()!;
  let parent = value as Record<string, unknown>;
  for (const part of parts) parent = parent[part] as Record<string, unknown>;
  return { parent, key };
}
function set(value: unknown, path: string, changed: unknown) {
  const target = pointer(value, path);
  target.parent[target.key] = changed;
}
const renamed: Alias = {
  fromRef: { id: 'exercise.c.echo', version: '1.0.0' },
  toRef: { id: 'exercise.c.echo-renamed', version: '1.0.0' },
  fromAcceptedPriorVersions: [],
  kind: 'exercise',
  learningRevision: 1,
  manifestRef: { id: 'identity.fixture.p0', version: '1.0.0' },
};

describe('SAVE-01 model and store keys', () => {
  it('fixes eleven projected stores and four separate physical auxiliary stores with independent defaults', () => {
    expect(ALL_STORE_NAMES).toEqual([
      ...STORE_NAMES,
      'editHistory',
      'knowledgeMarks',
      'reviewCards',
      'achievements',
      'customDrafts',
    ]);
    expect([DB_NAME, DB_VERSION, SCHEMA_VERSION]).toEqual(['c-viz-learning', 8, '8.0.0']);
    expect(STORE_NAMES).toEqual([
      'meta',
      'settings',
      'avatar',
      'progress',
      'dailyFacts',
      'goals',
      'ledger',
      'receipts',
      'aliases',
      'appearance',
      'appearanceAssets',
    ]);
    expect(CORE_STORE_NAMES).toEqual(STORE_NAMES.slice(0, 9));
    expect(defaultSettings()).toEqual({ ...snapshot(0).settings, theme: 'light' });
    expect(defaultAvatar()).toEqual(snapshot(0).avatar);
    const first = defaultSettings();
    first.theme = 'dark';
    expect(defaultSettings().theme).toBe('light');
    const firstAvatar = defaultAvatar();
    firstAvatar.accentColor = '#CC3366';
    expect(defaultAvatar().accentColor).toBe('#168A72');
    const initial = snapshot(0);
    initial.settings = defaultSettings();
    expect(emptySnapshot(createMeta(initial.meta))).toEqual(initial);
    const fresh = emptySnapshot(initial.meta);
    fresh.meta.activePackageRef.id = 'content.changed';
    expect(initial.meta.activePackageRef.id).toBe('content.c.p0');
    const appearance = defaultAppearance();
    appearance.themeOverrides.cute.accentColor = '#CC3366';
    appearance.layout.splitRatios.practice = 60;
    expect(defaultAppearance().themeOverrides.cute.accentColor).toBeNull();
    expect(defaultAppearance().layout.splitRatios.practice).toBe(50);
  });
  it('uses native compound arrays and stable reward identity across content versions', () => {
    const value = snapshot();
    const generation = value.meta.generation;
    expect(recordKey('meta', generation, value.meta)).toBe('current');
    expect(recordKey('settings', generation, value.settings)).toBe('current');
    expect(recordKey('avatar', generation, value.avatar)).toBe('current');
    expect(recordKey('appearance', generation, value.appearance)).toBe('current');
    expect(recordKey('appearanceAssets', generation, backgroundAsset())).toEqual([
      generation,
      'background',
    ]);
    expect(recordKey('progress', generation, value.progress[1])).toEqual([
      generation,
      'exercise.passed',
      'exercise.c.echo',
      '1.0.0',
      1,
    ]);
    expect(recordKey('dailyFacts', generation, value.dailyFacts[0])).toEqual([
      generation,
      '2026-10-14',
      'exercise.passed',
      'exercise.c.echo',
    ]);
    expect(recordKey('goals', generation, value.goals[0])).toEqual([generation, '2026-10-14']);
    expect(recordKey('ledger', generation, value.ledger[0])).toEqual([
      generation,
      'reward.exercise.first-pass',
      'exercise.c.echo',
    ]);
    expect(recordKey('ledger', generation, value.ledger[2])).toEqual([
      generation,
      'reward.daily-goal.once',
      '2026-10-14',
    ]);
    expect(recordKey('receipts', generation, value.receipts[0])).toEqual([
      generation,
      value.receipts[0].eventId,
    ]);
    expect(recordKey('aliases', generation, renamed)).toEqual([generation, 'exercise.c.echo']);
    expect(
      recordKey('ledger', '22222222-2222-4222-8222-222222222222', value.ledger[0]),
    ).not.toEqual(recordKey('ledger', generation, value.ledger[0]));
  });
});

describe('closed storage validation', () => {
  for (const example of sample.snapshots) {
    it(`validates frozen V1 projection ${example.id} and an independent upgraded V3 copy`, () => {
      const before = structuredClone(example.snapshot);
      expect(() => assertLegacySnapshot(example.snapshot)).not.toThrow();
      expect(validateSnapshot(example.snapshot)).toBe(false);
      const upgraded = upgradeV1Snapshot(example.snapshot);
      expect(validateSnapshot(upgraded)).toBe(true);
      expect(upgraded.appearance).toEqual(defaultAppearance());
      expect(upgraded.appearanceAssets).toEqual([]);
      assertLegacySnapshot(before);
      expect(upgraded.meta).toEqual({
        ...before.meta,
        dbVersion: 8,
        schemaVersion: '8.0.0',
        revision: before.meta.revision + 1,
      });
      for (const store of CORE_STORE_NAMES)
        if (store !== 'meta') expect(upgraded[store]).toEqual(before[store]);
      expect(example.snapshot).toEqual(before);
    });
  }
  it('rejects every frozen invalid V1 projection without modifying the historical input', () => {
    for (const scenario of scenarios.invalidSnapshots) {
      const value = structuredClone(sample.snapshots[1].snapshot);
      if (scenario.path) set(value, scenario.path, scenario.value);
      else {
        const target = pointer(value, scenario.appendTo!);
        const source = pointer(value, scenario.copyFrom!);
        (target.parent[target.key] as unknown[]).push(structuredClone(source.parent[source.key]));
      }
      const before = structuredClone(value);
      expect(() => assertLegacySnapshot(value)).toThrow(
        expect.objectContaining({ code: scenario.code }),
      );
      expect(value).toEqual(before);
    }
  });
  for (const scenario of scenarios.invalidSnapshots) {
    it(`rejects frozen invalid snapshot ${scenario.id} with its dedicated code`, () => {
      const value: unknown = snapshot();
      if (scenario.path)
        set(value, scenario.path, scenario.id === 'unknown-version' ? '9.0.0' : scenario.value);
      else {
        const target = pointer(value, scenario.appendTo!);
        const source = pointer(value, scenario.copyFrom!);
        (target.parent[target.key] as unknown[]).push(structuredClone(source.parent[source.key]));
      }
      expect(validateSnapshot(value)).toBe(false);
      expect(() => assertSnapshot(value)).toThrow(expect.objectContaining({ code: scenario.code }));
    });
  }
  it('rejects unknown fields in every store, including nested refs and conditional attempt details', () => {
    const value = snapshot();
    const rows = {
      meta: value.meta,
      settings: value.settings,
      avatar: value.avatar,
      progress: value.progress[0],
      dailyFacts: value.dailyFacts[0],
      goals: value.goals[0],
      ledger: value.ledger[0],
      receipts: value.receipts[0],
      aliases: renamed,
      appearance: value.appearance,
      appearanceAssets: backgroundAsset(),
    };
    for (const store of STORE_NAMES) {
      expect(validateRecord(store, rows[store])).toBe(true);
      expect(validateRecord(store, { ...rows[store], input: { private: 7 } })).toBe(false);
    }
    expect(
      validateRecord('progress', {
        ...value.progress[1],
        subjectRef: { ...value.progress[1].subjectRef, sourceRevision: 1 },
      }),
    ).toBe(false);
    expect(
      validateRecord('progress', {
        ...value.progress[1],
        resultCategory: 'wrong-answer',
        failedCaseKey: null,
      }),
    ).toBe(false);
    const attempt = {
      ...value.progress[1],
      eventType: 'exercise.attempt-evaluated',
      result: 'failed',
      resultCategory: 'program-error',
      failedCaseKey: 'negative',
    };
    expect(validateRecord('progress', attempt)).toBe(true);
    const noDetails = {
      ...value.progress[1],
      eventType: 'exercise.attempt-evaluated',
      result: 'failed',
    };
    expect(validateRecord('progress', noDetails)).toBe(false);
    expect(validateRecord('progress', { ...attempt, resultCategory: 'anything' })).toBe(false);
    expect(validateRecord('progress', { ...attempt, failedCaseKey: 'private body' })).toBe(false);
  });
  it('rejects type/source/result mismatches, unsafe numbers, false goals and noncanonical colors', () => {
    const value = snapshot();
    expect(validateRecord('progress', { ...value.progress[1], result: 'completed' })).toBe(false);
    expect(
      validateRecord('progress', {
        ...value.progress[1],
        subjectRef: value.progress[0].subjectRef,
      }),
    ).toBe(false);
    expect(
      validateRecord('ledger', { ...value.ledger[0], subjectId: 'lesson.c.variables-output' }),
    ).toBe(false);
    expect(validateRecord('ledger', { ...value.ledger[0], status: 'pending' })).toBe(false);
    expect(validateRecord('avatar', { ...value.avatar, accentColor: '#168a72' })).toBe(false);
    expect(
      validateRecord('avatar', { ...value.avatar, presetId: 'https://example.test/avatar.png' }),
    ).toBe(false);
    expect(validateRecord('goals', { ...value.goals[0], targets: null })).toBe(false);
    for (const number of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateRecord('meta', { ...value.meta, revision: number })).toBe(false);
      expect(validateRecord('ledger', { ...value.ledger[0], points: number })).toBe(false);
    }
    expect(validateRecord('ledger', { ...value.ledger[0], points: Number.MAX_SAFE_INTEGER })).toBe(
      true,
    );
    expect(validateRecord('settings', { ...value.settings, playbackRate: 3 })).toBe(false);
    expect(
      validateRecord('settings', {
        ...value.settings,
        goalTemplate: { revision: 1, targets: { exercise: 0, lesson: 0, case: 0 } },
      }),
    ).toBe(false);
  });
  it('checks uniqueness by compound key even when conflicting rows have different values', () => {
    for (const store of ['progress', 'dailyFacts', 'goals', 'ledger', 'receipts'] as const) {
      const value = snapshot();
      const rows = value[store] as unknown[];
      rows.push(structuredClone(rows[0]));
      expect(validateSnapshot(value)).toBe(false);
    }
    const value = snapshot();
    value.ledger.push({ ...value.ledger[0], status: 'pending', points: null, policyRef: null });
    expect(validateSnapshot(value)).toBe(false);
  });
  it('checks receipt revision/goal relations and stable canonical identities', () => {
    const value = snapshot();
    value.aliases.push(structuredClone(renamed));
    expect(validateSnapshot(value)).toBe(true);
    const orphan = snapshot();
    orphan.progress.splice(1, 1);
    expect(validateSnapshot(orphan)).toBe(false);
    const missingGoal = snapshot();
    missingGoal.goals.length = 0;
    expect(validateSnapshot(missingGoal)).toBe(false);
    const wrongVersion = snapshot();
    wrongVersion.receipts[0].goalVersion = 2;
    expect(validateSnapshot(wrongVersion)).toBe(false);
    const wrongCanonical = snapshot();
    wrongCanonical.aliases.push(structuredClone(renamed));
    wrongCanonical.ledger[0].subjectId = renamed.toRef.id;
    expect(validateSnapshot(wrongCanonical)).toBe(false);
    const unachieved = snapshot();
    unachieved.dailyFacts.pop();
    expect(validateSnapshot(unachieved)).toBe(false);
  });
  it('checks daily-goal refs against date/version and disallows content-only fields', () => {
    const value = snapshot();
    const receipt = {
      ...value.receipts[1],
      eventType: 'daily-goal.achieved',
      result: 'achieved',
      subjectRef: { id: 'local-goal.2026-10-14', version: '1' },
      packageRef: null,
      learningRevision: null,
    };
    expect(validateRecord('receipts', receipt)).toBe(true);
    expect(
      validateRecord('receipts', {
        ...receipt,
        subjectRef: { ...receipt.subjectRef, version: '2' },
      }),
    ).toBe(false);
    expect(
      validateRecord('receipts', { ...receipt, packageRef: value.meta.activePackageRef }),
    ).toBe(false);
    expect(
      validateRecord('receipts', {
        ...receipt,
        subjectRef: { ...receipt.subjectRef, id: 'local-goal.2026-10-15' },
      }),
    ).toBe(false);
  });
  it('rejects alias forks, cycles, changed learning revisions, undeclared link versions and chains over 32', () => {
    const value = snapshot();
    value.aliases.push(structuredClone(renamed));
    value.aliases.push({ ...renamed, fromRef: renamed.toRef, toRef: renamed.fromRef });
    expect(validateSnapshot(value)).toBe(false);
    const fork = snapshot();
    fork.aliases.push(renamed, {
      ...renamed,
      fromRef: { id: 'exercise.c.other', version: '1.0.0' },
    });
    expect(validateSnapshot(fork)).toBe(false);
    for (const changed of [
      { learningRevision: 2 },
      { fromRef: { id: renamed.toRef.id, version: '2.0.0' } },
    ]) {
      const chain = snapshot();
      chain.aliases.push(renamed, {
        ...renamed,
        fromRef: renamed.toRef,
        toRef: { id: 'exercise.c.final', version: '1.0.0' },
        ...changed,
      });
      expect(validateSnapshot(chain)).toBe(false);
    }
    const chain = snapshot(0);
    for (let index = 0; index < 33; index++)
      chain.aliases.push({
        ...renamed,
        fromRef: { id: `exercise.chain.n${index}`, version: '1.0.0' },
        toRef: { id: `exercise.chain.n${index + 1}`, version: '1.0.0' },
      });
    expect(validateSnapshot(chain)).toBe(false);
    chain.aliases.pop();
    expect(validateSnapshot(chain)).toBe(true);
  });
  it('rejects accessors, arbitrary prototypes, sparse arrays and unpaired Unicode as row data', () => {
    const value = snapshot();
    let called = false;
    const settings = {
      ...value.settings,
      get theme() {
        called = true;
        return 'dark';
      },
    };
    expect(validateRecord('settings', settings)).toBe(false);
    expect(called).toBe(false);
    expect(validateRecord('avatar', Object.assign(new Date(), value.avatar))).toBe(false);
    expect(validateRecord('avatar', { ...value.avatar, presetId: '\ud800' })).toBe(false);
    const sparse = snapshot(0);
    sparse.progress = Array(1);
    expect(validateSnapshot(sparse)).toBe(false);
    expect(() => assertRecord('settings', settings)).toThrow(StorageValidationError);
  });
});

describe('SAVE2 closed six-theme appearance and resource relations', () => {
  it('requires six independent overrides and accepts every stable preset with its own color', () => {
    const value = snapshot();
    expect(Object.keys(value.appearance.themeOverrides)).toEqual(THEME_IDS);
    for (const [index, preset] of THEME_IDS.entries()) {
      value.appearance.themeOverrides[preset].accentColor =
        `#AA00${String(index).padStart(2, '0')}`;
      value.appearance.preset = preset;
      expect(validateSnapshot(value)).toBe(true);
    }
    expect(
      new Set(Object.values(value.appearance.themeOverrides).map((row) => row.accentColor)).size,
    ).toBe(6);
    expect(value.settings.theme).toBe('system');
    expect(value.avatar.accentColor).toBe('#168A72');
  });
  for (const [path, changed] of [
    ['/preset', 'unknown'],
    ['/accentColor', '#AABBCC'],
    ['/themeOverrides/minimal/accentColor', '#aabbcc'],
    ['/themeOverrides/minimal/accentColor', '#ABC'],
    ['/themeOverrides/minimal/accentColor', 'var(--accent)'],
    ['/themeOverrides/minimal/accentColor', 123],
    ['/themeOverrides/minimal/extra', true],
    ['/themeOverrides/unknown', { accentColor: null }],
    ['/blockWorkspace', 'unlocked'],
    ['/layout/sidebar', 'hidden'],
    ['/layout/workbenchMode', 'fullscreen'],
    ['/layout/profile', 'paper'],
    ['/background/assetId', 'https://example.test/background.png'],
    ['/background/fit', 'stretch'],
    ['/background/position', 'left'],
    ['/background/fileName', 'private.png'],
  ] as const) {
    it(`rejects unsupported appearance value at ${path}: ${JSON.stringify(changed)}`, () => {
      const appearance = defaultAppearance();
      set(appearance, path, changed);
      expect(validateRecord('appearance', appearance)).toBe(false);
    });
  }
  it('rejects missing overrides and old four-theme/single-color designs instead of guessing migrations', () => {
    for (const theme of THEME_IDS) {
      const appearance = defaultAppearance();
      delete (appearance.themeOverrides as Partial<typeof appearance.themeOverrides>)[theme];
      expect(validateRecord('appearance', appearance)).toBe(false);
    }
    const oldSingleColor: Record<string, unknown> = { ...defaultAppearance() };
    delete oldSingleColor.themeOverrides;
    expect(validateRecord('appearance', { ...oldSingleColor, accentColor: '#AABBCC' })).toBe(false);
    const fourThemes = defaultAppearance();
    delete (fourThemes.themeOverrides as Partial<typeof fourThemes.themeOverrides>).glass;
    delete (fourThemes.themeOverrides as Partial<typeof fourThemes.themeOverrides>).soft;
    expect(validateRecord('appearance', fourThemes)).toBe(false);
  });
  it('checks each split ratio and overlay boundary as finite safe integers', () => {
    for (const name of ['practice', 'visualize', 'review'] as const) {
      for (const ratio of [30, 70, 29, 71, 50.5, NaN, Infinity]) {
        const appearance = defaultAppearance();
        appearance.layout.splitRatios[name] = ratio;
        expect(validateRecord('appearance', appearance)).toBe(ratio === 30 || ratio === 70);
      }
    }
    for (const opacity of [0, 90, -1, 91, 75.5, NaN, Infinity]) {
      const appearance = defaultAppearance();
      appearance.background.overlayOpacity = opacity;
      expect(validateRecord('appearance', appearance)).toBe(opacity === 0 || opacity === 90);
    }
  });
  it('requires the native Blob type, matching metadata and an internal background slot', () => {
    const asset = backgroundAsset();
    expect(validateRecord('appearanceAssets', asset)).toBe(true);
    for (const patch of [
      { assetId: 'other' },
      { mimeType: 'image/svg+xml' },
      { byteLength: 0 },
      { byteLength: asset.byteLength + 1 },
      { byteLength: 5_242_881 },
      { width: 0 },
      { width: 4097 },
      { height: 1.5 },
      { height: 4097 },
      { blob: { size: asset.byteLength, type: asset.mimeType } },
      { blob: new Blob(['different'], { type: 'image/jpeg' }) },
      { fileName: 'private.png' },
    ])
      expect(validateRecord('appearanceAssets', { ...asset, ...patch })).toBe(false);
  });
  it('requires exactly one referenced asset and rejects missing, orphaned or duplicate resources', () => {
    const value = snapshot();
    value.appearance.background.visible = true;
    expect(validateSnapshot(value)).toBe(false);
    value.appearance.background.assetId = 'background';
    expect(validateSnapshot(value)).toBe(false);
    value.appearanceAssets = [backgroundAsset()];
    expect(validateSnapshot(value)).toBe(true);
    value.appearance.background.visible = false;
    expect(validateSnapshot(value)).toBe(true);
    value.appearanceAssets.push(backgroundAsset());
    expect(validateSnapshot(value)).toBe(false);
    value.appearanceAssets.pop();
    value.appearance.background.assetId = null;
    expect(validateSnapshot(value)).toBe(false);
  });
});

describe('strict production SAVE1 to SAVE3 recipe', () => {
  it('preserves each prior display mode and all old rows while adding only defaults and one revision', () => {
    for (const theme of ['system', 'dark', 'light'] as const) {
      const legacy = structuredClone(sample.snapshots[1].snapshot);
      assertLegacySnapshot(legacy);
      legacy.settings.theme = theme;
      const before = structuredClone(legacy);
      const next = upgradeV1Snapshot(legacy);
      expect(next.settings.theme).toBe(theme);
      expect(next.meta).toEqual({
        ...before.meta,
        schemaVersion: '8.0.0',
        dbVersion: 8,
        revision: before.meta.revision + 1,
      });
      for (const store of CORE_STORE_NAMES)
        if (store !== 'meta') expect(next[store]).toEqual(before[store]);
      expect(next.appearance).toEqual(defaultAppearance());
      expect(next.appearanceAssets).toEqual([]);
      expect(legacy).toEqual(before);
    }
  });
  it('rejects exhausted revisions, unknown predecessors and already-upgraded input without changing them', () => {
    const legacy = structuredClone(sample.snapshots[0].snapshot);
    assertLegacySnapshot(legacy);
    legacy.meta.revision = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(legacy);
    expect(() => upgradeV1Snapshot(legacy)).toThrow(
      expect.objectContaining({ code: 'S_RECORD_INVALID' }),
    );
    expect(legacy).toEqual(before);
    for (const version of ['0.9.0', '2.0.0', '3.0.0', 'unrecognized']) {
      const candidate = {
        ...before,
        meta: { ...before.meta, schemaVersion: version, revision: 0 },
      };
      const original = structuredClone(candidate);
      expect(() => upgradeV1Snapshot(candidate)).toThrow(
        expect.objectContaining({ code: 'S_VERSION_UNKNOWN' }),
      );
      expect(candidate).toEqual(original);
    }
    expect(() => upgradeV1Snapshot(snapshot(0))).toThrow();
  });
});

describe('Gregorian dates and generation time zones', () => {
  for (const vector of scenarios.dateVectors) {
    it(`uses frozen local day ${vector.timeZone} ${vector.at}`, () => {
      expect(localDateAt(vector.at, vector.timeZone)).toBe(vector.date);
    });
  }
  it('rejects calendar normalization and UTC encodings outside the exact contract', () => {
    expect(isLocalDate('2024-02-29')).toBe(true);
    for (const date of [
      '2026-02-29',
      '2026-02-30',
      '2026-04-31',
      '2026-13-01',
      '2026-01-00',
      '2026-1-01',
    ])
      expect(isLocalDate(date)).toBe(false);
    for (const at of [
      '2026-02-30T00:00:00.000Z',
      '2026-10-14T24:00:00.000Z',
      '2026-10-14T00:00:00Z',
      '2026-10-14T00:00:00.000+00:00',
    ])
      expect(isUtcTime(at)).toBe(false);
    for (const zone of ['Invalid/Zone', '+08:00', '', '\ud800'])
      expect(isTimeZone(zone)).toBe(false);
    expect(isTimeZone('Asia/Shanghai')).toBe(true);
    expect(() => localDateAt('2026-10-14T00:00:00.000Z', 'Invalid/Zone')).toThrow(
      expect.objectContaining({ code: 'S_DATE_INVALID' }),
    );
  });
  it('retains the original day on midnight retry and detects a changed date bucket', () => {
    const value = snapshot();
    value.dailyFacts[0].localDate = '2026-10-15';
    expect(() => assertSnapshot(value)).toThrow(
      expect.objectContaining({ code: 'S_DATE_INVALID' }),
    );
    expect(localDateAt('2026-10-14T15:59:59.999Z', 'Asia/Shanghai')).toBe('2026-10-14');
    expect(localDateAt('2026-10-14T16:00:00.000Z', 'Asia/Shanghai')).toBe('2026-10-15');
  });
});

describe('isolated SAVE-MIGRATE-01 synthetic reference recipe', () => {
  it('preserves the predecessor without adding facts, goals, receipts or completion/rewards', () => {
    const original = structuredClone(scenarios.legacyFixture);
    const migrated = migrateLegacyReference(scenarios.legacyFixture);
    const expected = structuredClone(sample.snapshots[0].snapshot);
    assertLegacySnapshot(expected);
    expected.meta.revision = 1;
    expected.settings.theme = 'dark';
    expected.progress = [
      {
        eventType: 'lesson.study-confirmed',
        result: 'confirmed',
        subjectRef: { id: 'lesson.c.variables-output', version: '1.0.0' },
        packageRef: { id: 'content.c.p0', version: '1.0.0' },
        learningRevision: 1,
        firstAt: '2026-10-13T16:00:00.000Z',
        lastAt: '2026-10-13T16:00:00.000Z',
      },
      {
        eventType: 'exercise.passed',
        result: 'passed',
        subjectRef: { id: 'exercise.c.echo', version: '1.0.0' },
        packageRef: { id: 'content.c.p0', version: '1.0.0' },
        learningRevision: 1,
        firstAt: '2026-10-13T16:01:00.000Z',
        lastAt: '2026-10-13T16:01:00.000Z',
      },
    ];
    expected.ledger = [
      {
        sourceId: 'reward.exercise.first-pass',
        subjectId: 'exercise.c.echo',
        points: 12,
        occurredAt: '2026-10-13T16:01:00.000Z',
        localDate: '2026-10-14',
        status: 'posted',
        policyRef: { id: 'legacy.fixture', version: '0.9.0' },
      },
    ];
    expect(migrated).toEqual(expected);
    expect(scenarios.legacyFixture).toEqual(original);
    expect(() => assertLegacySnapshot(migrated)).not.toThrow();
    expect(validateSnapshot(migrated)).toBe(false);
    migrated.progress[0].subjectRef.id = 'lesson.changed';
    expect(scenarios.legacyFixture).toEqual(original);
  });
  it('preserves declared legacy day awards without inventing a day goal or fact', () => {
    const legacy = structuredClone(scenarios.legacyFixture) as Record<string, unknown[]>;
    legacy.rewards.push({
      sourceId: 'reward.daily-goal.once',
      subjectId: 'local-goal.2026-10-14',
      points: 5,
      at: '2026-10-13T16:01:00.000Z',
    });
    const migrated = migrateLegacyReference(legacy);
    expect(migrated.ledger[1]).toEqual({
      sourceId: 'reward.daily-goal.once',
      subjectId: 'local-goal.2026-10-14',
      points: 5,
      occurredAt: '2026-10-13T16:01:00.000Z',
      localDate: '2026-10-14',
      status: 'posted',
      policyRef: { id: 'legacy.fixture', version: '0.9.0' },
    });
    expect(migrated.goals).toEqual([]);
    expect(migrated.dailyFacts).toEqual([]);
    expect(migrated.receipts).toEqual([]);
    expect(() => assertLegacySnapshot(migrated)).not.toThrow();
    expect(validateSnapshot(migrated)).toBe(false);
    set(legacy, '/rewards/1/subjectId', 'local-goal.2026-10-15');
    expect(() => migrateLegacyReference(legacy)).toThrow(
      expect.objectContaining({ code: 'S_RECORD_INVALID' }),
    );
  });
  it('still requires a real goal relation for pending or current-policy daily awards', () => {
    const value = snapshot(0);
    value.ledger.push({
      sourceId: 'reward.daily-goal.once',
      subjectId: 'local-goal.2026-10-14',
      points: null,
      occurredAt: '2026-10-13T16:01:00.000Z',
      localDate: '2026-10-14',
      status: 'pending',
      policyRef: null,
    });
    expect(validateSnapshot(value)).toBe(false);
    value.ledger[0] = {
      ...value.ledger[0],
      status: 'posted',
      points: 5,
      policyRef: { id: 'policy.fixture.p0', version: '1.0.0' },
    };
    expect(validateSnapshot(value)).toBe(false);
  });
  const invalidChanges: [string, string, unknown, string][] = [
    ['unknown predecessor', '/schemaVersion', '0.8.0', 'S_MIGRATION_UNSUPPORTED'],
    ['future predecessor', '/schemaVersion', '2.0.0', 'S_MIGRATION_UNSUPPORTED'],
    ['unknown root field', '/source', 'private', 'S_RECORD_INVALID'],
    ['unknown old pass field', '/passes/0/input', { x: 7 }, 'S_RECORD_INVALID'],
    ['invalid generation', '/generation', '', 'S_RECORD_INVALID'],
    ['invalid time zone', '/timeZone', 'Invalid/Zone', 'S_DATE_INVALID'],
    ['invalid old time', '/passes/0/at', '2026-02-30T00:00:00.000Z', 'S_DATE_INVALID'],
    ['invalid old ref', '/passes/0/ref/id', 'private-code', 'S_RECORD_INVALID'],
    ['wrong old subject kind', '/passes/0/ref/id', 'lesson.c.variables-output', 'S_RECORD_INVALID'],
    ['negative original points', '/rewards/0/points', -1, 'S_RECORD_INVALID'],
    [
      'unsafe original points',
      '/rewards/0/points',
      Number.MAX_SAFE_INTEGER + 1,
      'S_RECORD_INVALID',
    ],
    ['unrecognized original source', '/rewards/0/sourceId', 'reward.anything', 'S_RECORD_INVALID'],
  ];
  for (const [name, path, changed, code] of invalidChanges) {
    it(`rejects ${name} and retains the entire predecessor`, () => {
      const value = structuredClone(scenarios.legacyFixture);
      set(value, path, changed);
      const before = structuredClone(value);
      expect(() => migrateLegacyReference(value)).toThrow(expect.objectContaining({ code }));
      expect(value).toEqual(before);
    });
  }
  for (const field of ['confirmations', 'passes', 'rewards']) {
    it(`rejects duplicate old ${field} keys rather than silently merging them`, () => {
      const value = structuredClone(scenarios.legacyFixture) as Record<string, unknown[]>;
      value[field].push(structuredClone(value[field][0]));
      const before = structuredClone(value);
      expect(() => migrateLegacyReference(value)).toThrow(
        expect.objectContaining({ code: 'S_RECORD_INVALID' }),
      );
      expect(value).toEqual(before);
    });
  }
});
