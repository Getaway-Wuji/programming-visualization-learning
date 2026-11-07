import {
  ALL_STORE_NAMES,
  createMeta,
  defaultAppearance,
  defaultAvatar,
  defaultSettings,
  emptySnapshot,
} from './model';
import type { Appearance, AppearanceAsset, Avatar, LegacyMeta, Settings } from './model';
import {
  assertRecord,
  assertSnapshot,
  isSafeUint,
  isTimeZone,
  isUtcTime,
  isUuid,
} from './validation';
import { StorageError } from './errors';

/** Fixed historical layouts: later additions must not change the meaning of DB1—DB9. */
export const C6_RESET_PRIOR_STORES = [
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
  'editHistory',
  'knowledgeMarks',
  'reviewCards',
  'achievements',
  'customDrafts',
  'weaknesses',
] as const;
export const C6_RESET_STORES = [
  ...C6_RESET_PRIOR_STORES,
  'courseActivities',
  'courseDrafts',
] as const;
export const C6_RESET_CLEAR_STORES = C6_RESET_STORES.filter(
  (store) => !['meta', 'settings', 'avatar', 'appearance', 'appearanceAssets'].includes(store),
);
export type C6ResetMeta = Omit<LegacyMeta, 'schemaVersion' | 'dbVersion' | 'activePackageRef'> & {
  schemaVersion: '10.0.0';
  dbVersion: 10;
  activePackageRef: { id: 'content.c.primer6'; version: '2.0.0' };
  activeCatalogSetRef: { id: 'catalog-set.c.primer6'; version: '2.0.0' };
};
export function createC6ResetMeta(generation: string, timeZone: string, at: string): C6ResetMeta {
  if (!isUuid(generation) || !isTimeZone(timeZone) || !isUtcTime(at))
    throw new StorageError('S_RECORD_INVALID');
  return {
    schemaVersion: '10.0.0',
    dbVersion: 10,
    generation,
    revision: 0,
    timeZone,
    createdAt: at,
    activePackageRef: { id: 'content.c.primer6', version: '2.0.0' },
    activeCatalogSetRef: { id: 'catalog-set.c.primer6', version: '2.0.0' },
  };
}
export function assertC6Meta(value: unknown): asserts value is C6ResetMeta {
  const meta = value as C6ResetMeta;
  const fields = [
    'schemaVersion',
    'dbVersion',
    'generation',
    'revision',
    'timeZone',
    'createdAt',
    'activePackageRef',
    'activeCatalogSetRef',
  ];
  if (
    !meta ||
    Object.getPrototypeOf(meta) !== Object.prototype ||
    Reflect.ownKeys(meta).length !== fields.length ||
    Reflect.ownKeys(meta).some((key) => typeof key !== 'string' || !fields.includes(key)) ||
    Object.values(Object.getOwnPropertyDescriptors(meta)).some((d) => !('value' in d)) ||
    meta.schemaVersion !== '10.0.0' ||
    meta.dbVersion !== 10 ||
    !isSafeUint(meta.revision) ||
    !isUuid(meta.generation) ||
    !isTimeZone(meta.timeZone) ||
    !isUtcTime(meta.createdAt)
  )
    throw new StorageError('S_RECORD_INVALID');
  for (const [ref, expected] of [
    [meta.activePackageRef, 'content.c.primer6'],
    [meta.activeCatalogSetRef, 'catalog-set.c.primer6'],
  ] as const) {
    if (
      !ref ||
      Object.getPrototypeOf(ref) !== Object.prototype ||
      Reflect.ownKeys(ref).length !== 2 ||
      !Object.keys(ref).every((key) => ['id', 'version'].includes(key)) ||
      Object.values(Object.getOwnPropertyDescriptors(ref)).some((d) => !('value' in d)) ||
      ref.id !== expected ||
      ref.version !== '2.0.0'
    )
      throw new StorageError('S_RECORD_INVALID');
  }
}

/** Queue synchronously inside versionchange. No await, network, or secondary DB is involved. */
export function queueC6ResetUpgrade(
  db: IDBDatabase,
  tx: IDBTransaction,
  oldVersion: number,
  meta: C6ResetMeta,
  onFailure: (error: unknown) => void,
  afterReset?: (meta: C6ResetMeta) => void,
): void {
  const fail = (error: unknown) => {
    onFailure(error);
    try {
      tx.abort();
    } catch {
      /* ended */
    }
  };
  try {
    assertC6Meta(meta);
    if (meta.revision !== 0) throw new StorageError('S_RECORD_INVALID');
    if (
      tx.mode !== 'versionchange' ||
      !(afterReset ? [11, 12, 13].includes(db.version) : db.version === 10) ||
      !Number.isInteger(oldVersion) ||
      oldVersion < 0 ||
      oldVersion > 9
    )
      throw new StorageError('S_MIGRATION_UNSUPPORTED');
    // Ensure this explicit reset cannot accidentally run after activation.
    const counts = [0, 9, 11, 12, 13, 14, 15, 15, 16, 17];
    const prior = C6_RESET_PRIOR_STORES.slice(0, counts[oldVersion]);
    if (
      db.objectStoreNames.length !== prior.length ||
      prior.some((name) => !db.objectStoreNames.contains(name))
    )
      throw new StorageError('S_MIGRATION_UNSUPPORTED');
    for (const name of prior) {
      const store = tx.objectStore(name);
      if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
        throw new StorageError('S_MIGRATION_UNSUPPORTED');
    }
    const prefs = ['settings', 'avatar', 'appearance', 'appearanceAssets'] as const;
    const values: Partial<Record<(typeof prefs)[number], unknown[]>> = {},
      keys: Partial<Record<(typeof prefs)[number], IDBValidKey[]>> = {};
    let previousMeta: unknown;
    let pending = 0;
    for (const name of prefs) if (db.objectStoreNames.contains(name)) pending += 2;
    if (db.objectStoreNames.contains('meta')) ++pending;
    const commitReset = () => {
      try {
        if (previousMeta && typeof previousMeta === 'object') {
          const old = previousMeta as Record<string, unknown>;
          if (old.generation === meta.generation) throw new StorageError('S_GENERATION_STALE');
          if (
            typeof old.schemaVersion === 'string' &&
            /^(?:[1-9][0-9]*)\.0\.0$/u.test(old.schemaVersion) &&
            Number(old.schemaVersion.split('.')[0]) > 9
          )
            throw new StorageError('S_VERSION_UNKNOWN');
        }
        const current = <T>(name: 'settings' | 'avatar' | 'appearance', fallback: T): T => {
          const rows = values[name] ?? [],
            rowKeys = keys[name] ?? [];
          if (rows.length === 0 && rowKeys.length === 0) return fallback;
          if (rows.length !== 1 || rowKeys.length !== 1 || rowKeys[0] !== 'current')
            throw new StorageError('S_RECORD_INVALID');
          return rows[0] as T;
        };
        const settings = {
          ...current<Settings>('settings', defaultSettings()),
          goalTemplate: null,
        };
        const avatar = current<Avatar>('avatar', defaultAvatar());
        const appearance = current<Appearance>('appearance', defaultAppearance());
        const assets = (values.appearanceAssets ?? []) as AppearanceAsset[];
        if (assets.length > 1 || assets.length !== (keys.appearanceAssets?.length ?? 0))
          throw new StorageError('S_RECORD_INVALID');
        assertRecord('settings', settings);
        assertRecord('avatar', avatar);
        assertRecord('appearance', appearance);
        for (const asset of assets) assertRecord('appearanceAssets', asset);
        // This empty snapshot is only a preference relationship check. No old learning rows enter it.
        const preferenceCheck = emptySnapshot(
          createMeta({
            generation: meta.generation,
            timeZone: meta.timeZone,
            createdAt: meta.createdAt,
            activePackageRef: meta.activePackageRef,
          }),
        );
        Object.assign(preferenceCheck, { settings, avatar, appearance, appearanceAssets: assets });
        assertSnapshot(preferenceCheck);
        for (const name of C6_RESET_STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          tx.objectStore(name).clear();
        }
        tx.objectStore('meta').add(meta, 'current');
        tx.objectStore('settings').add(settings, 'current');
        tx.objectStore('avatar').add(avatar, 'current');
        tx.objectStore('appearance').add(appearance, 'current');
        for (const asset of assets)
          tx.objectStore('appearanceAssets').add(asset, [meta.generation, asset.assetId]);
        afterReset?.(meta);
      } catch (error) {
        fail(error);
      }
    };
    if (!pending) {
      commitReset();
      return;
    }
    const ready = () => {
      if (--pending === 0) commitReset();
    };
    if (db.objectStoreNames.contains('meta')) {
      const previous = tx.objectStore('meta').get('current');
      previous.onsuccess = () => {
        previousMeta = previous.result;
        ready();
      };
      previous.onerror = () => fail(previous.error);
    }
    for (const name of prefs) {
      if (!db.objectStoreNames.contains(name)) continue;
      const rows = tx.objectStore(name).getAll(),
        rowKeys = tx.objectStore(name).getAllKeys();
      rows.onsuccess = () => {
        values[name] = rows.result;
        ready();
      };
      rowKeys.onsuccess = () => {
        keys[name] = rowKeys.result;
        ready();
      };
      rows.onerror = () => fail(rows.error);
      rowKeys.onerror = () => fail(rowKeys.error);
    }
  } catch (error) {
    fail(error);
  }
}

// Legacy model constants retain SAVE9 for frozen consumers. C6 activation owns DB10.
// Keep an accidental historical-layout edit visible to both callers.
export function assertC6ResetHistoricalLayout(): void {
  if (!C6_RESET_PRIOR_STORES.every((name) => (ALL_STORE_NAMES as readonly string[]).includes(name)))
    throw new StorageError('S_MIGRATION_UNSUPPORTED');
}
