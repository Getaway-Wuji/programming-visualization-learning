import { CORE_STORE_NAMES, DB_VERSION, SCHEMA_VERSION, defaultAppearance } from './model';
import type { Meta, StorageSnapshot } from './model';
import { assertSnapshot, validationInternals } from './validation';
import type { StorageValidationCode } from './validation';

const requireRule: (condition: unknown, code?: StorageValidationCode) => asserts condition =
  validationInternals.requireRule;

export type LegacyStorageSnapshot = Omit<
  StorageSnapshot,
  'meta' | 'appearance' | 'appearanceAssets'
> & {
  meta: Omit<Meta, 'schemaVersion' | 'dbVersion'> & { schemaVersion: '1.0.0'; dbVersion: 1 };
};
function currentProjection(value: LegacyStorageSnapshot): StorageSnapshot {
  return {
    ...value,
    meta: { ...value.meta, schemaVersion: SCHEMA_VERSION, dbVersion: DB_VERSION },
    appearance: defaultAppearance(),
    appearanceAssets: [],
  };
}
/** Strict known predecessor only; never repairs a missing field or unknown version. */
export function assertLegacySnapshot(value: unknown): asserts value is LegacyStorageSnapshot {
  const data = validationInternals.row(value, CORE_STORE_NAMES);
  const meta = validationInternals.row(data.meta, [
    'schemaVersion',
    'dbVersion',
    'generation',
    'revision',
    'timeZone',
    'createdAt',
    'activePackageRef',
  ]);
  requireRule(meta.schemaVersion === '1.0.0' && meta.dbVersion === 1, 'S_VERSION_UNKNOWN');
  assertSnapshot(currentProjection(value as LegacyStorageSnapshot));
}
/** Pure half of the native versionchange recipe. Old rows are not rewritten. */
export function upgradeV1Snapshot(value: unknown): StorageSnapshot {
  assertLegacySnapshot(value);
  requireRule(value.meta.revision < Number.MAX_SAFE_INTEGER);
  const result = structuredClone(currentProjection(value));
  result.meta.revision++;
  assertSnapshot(result);
  return result;
}
