import { CORE_STORE_NAMES, createMeta, emptySnapshot } from './model';
import type { LedgerEntry, Progress } from './model';
import { assertLegacySnapshot, type LegacyStorageSnapshot } from './v1-migration';
import {
  assertPublicRef,
  isPositiveInt,
  isSafeUint,
  isTimeZone,
  isUtcTime,
  isUuid,
  localDateAt,
  validationInternals,
} from './validation';
import type { StorageValidationCode } from './validation';

export class StorageMigrationError extends Error {
  readonly code = 'S_MIGRATION_UNSUPPORTED';
  constructor() {
    super('S_MIGRATION_UNSUPPORTED');
    this.name = 'StorageMigrationError';
  }
}

/**
 * Pure SAVE-MIGRATE-01 reference recipe, never a production import interface.
 * The predecessor is synthetic and was never shipped. The browser client may
 * exercise this recipe only against its explicitly isolated reference database.
 */
export function migrateLegacyReference(input: unknown): LegacyStorageSnapshot {
  const { row, list } = validationInternals;
  const requireRule: (condition: unknown, code?: StorageValidationCode) => asserts condition =
    validationInternals.requireRule;
  if (input === null || typeof input !== 'object') requireRule(false);
  const version = Object.getOwnPropertyDescriptor(input as object, 'schemaVersion');
  requireRule(version && 'value' in version);
  if (version.value !== '0.9.0') throw new StorageMigrationError();
  const legacy = row(input, [
    'schemaVersion',
    'generation',
    'timeZone',
    'createdAt',
    'packageRef',
    'theme',
    'confirmations',
    'passes',
    'rewards',
  ]);
  requireRule(isUuid(legacy.generation));
  requireRule(isTimeZone(legacy.timeZone) && isUtcTime(legacy.createdAt), 'S_DATE_INVALID');
  assertPublicRef(legacy.packageRef);
  requireRule(legacy.theme === 'system' || legacy.theme === 'light' || legacy.theme === 'dark');
  const snapshot = emptySnapshot(
    createMeta({
      generation: legacy.generation,
      timeZone: legacy.timeZone,
      createdAt: legacy.createdAt,
      activePackageRef: legacy.packageRef,
      revision: 1,
    }),
  );
  snapshot.settings.theme = legacy.theme;
  for (const [field, eventType, result] of [
    ['confirmations', 'lesson.study-confirmed', 'confirmed'],
    ['passes', 'exercise.passed', 'passed'],
  ] as const) {
    for (const candidate of list(legacy[field])) {
      const old = row(candidate, ['ref', 'learningRevision', 'at']);
      assertPublicRef(old.ref);
      requireRule(isPositiveInt(old.learningRevision));
      requireRule(isUtcTime(old.at), 'S_DATE_INVALID');
      snapshot.progress.push({
        eventType,
        result,
        subjectRef: { ...old.ref },
        packageRef: { ...legacy.packageRef },
        learningRevision: old.learningRevision,
        firstAt: old.at,
        lastAt: old.at,
      } as Progress);
    }
  }
  for (const candidate of list(legacy.rewards)) {
    const old = row(candidate, ['sourceId', 'subjectId', 'points', 'at']);
    requireRule(isSafeUint(old.points));
    requireRule(isUtcTime(old.at), 'S_DATE_INVALID');
    snapshot.ledger.push({
      sourceId: old.sourceId,
      subjectId: old.subjectId,
      points: old.points,
      occurredAt: old.at,
      localDate: localDateAt(old.at, legacy.timeZone),
      status: 'posted',
      policyRef: { id: 'legacy.fixture', version: '0.9.0' },
    } as LedgerEntry);
  }
  // Includes closed row shapes, chronology, canonical keys, dates and reward source kinds.
  // Nothing is committed, mutated, awarded, or inferred if any predecessor row is invalid.
  const core = Object.fromEntries(CORE_STORE_NAMES.map((name) => [name, snapshot[name]])) as Omit<
    LegacyStorageSnapshot,
    'meta'
  > & { meta: typeof snapshot.meta };
  const legacySnapshot: LegacyStorageSnapshot = {
    ...core,
    meta: { ...core.meta, dbVersion: 1, schemaVersion: '1.0.0' },
  };
  assertLegacySnapshot(legacySnapshot);
  return legacySnapshot;
}
