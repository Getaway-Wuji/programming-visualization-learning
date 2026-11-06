import { COLLECTION_STORES, SCHEMA_VERSION, STORE_NAMES, emptySnapshot, recordKey } from './model';
import type { StorageSnapshot, StoreName } from './model';
import { assertRecord, localDateAt, validateRecord, validateSnapshot } from './validation';

export type RecoveryErrorCode =
  'S_VERSION_UNKNOWN' | 'S_MIGRATION_UNSUPPORTED' | 'S_DATE_INVALID' | 'S_RECORD_INVALID';

export interface RecoveryRead {
  /** A recognized DB10 metadata envelope with unreadable C6 collection records. */
  courseReadOnly?: boolean;
  snapshot: StorageSnapshot | null;
  issues: { store: StoreName | 'layout' | 'course'; count: number }[];
  /** Opaque confirmation token. It and the raw records stay in private memory. */
  guard: string;
  canClear: boolean;
  resettable: ('settings' | 'avatar')[];
  ledgerUncertain: boolean;
  writable: boolean;
  errorCode: RecoveryErrorCode | null;
  appearanceReadOnly: boolean;
  appearanceCanReset: boolean;
}
export interface RawStoreRows {
  keys: IDBValidKey[];
  values: unknown[];
}
export type RawStorageRows = Record<StoreName, RawStoreRows>;
type KeyCompare = (first: IDBValidKey, second: IDBValidKey) => number;
// A candidate is already typed but may fail runtime relations. Do not narrow a
// rejected typed candidate to never: its valid rows still need isolation.
function consistent(snapshot: StorageSnapshot): boolean {
  return validateSnapshot(snapshot);
}

/** Queue every native request immediately; no asynchronous work inside callbacks. */
export function readRawTransaction(
  tx: IDBTransaction,
  ready: (raw: RawStorageRows) => void,
  fail: (error: unknown) => void,
): void {
  const raw = {} as RawStorageRows;
  let remaining = STORE_NAMES.length * 2;
  const finish = () => {
    if (--remaining === 0) {
      try {
        ready(raw);
      } catch (error) {
        fail(error);
      }
    }
  };
  for (const name of STORE_NAMES) {
    raw[name] = { keys: [], values: [] };
    const store = tx.objectStore(name);
    const values = store.getAll();
    const keys = store.getAllKeys();
    values.onsuccess = () => {
      raw[name].values = values.result;
      finish();
    };
    keys.onsuccess = () => {
      raw[name].keys = keys.result;
      finish();
    };
  }
}

/** Compare private confirmation snapshots, including cyclic structured-clone data. */
export function sameRecoveryValue(first: unknown, second: unknown): boolean {
  const paired = new Map<object, object>();
  const reverse = new Map<object, object>();
  const same = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (paired.has(a)) return paired.get(a) === b;
    if (reverse.has(b)) return false;
    paired.set(a, b);
    reverse.set(b, a);
    const tag = Object.prototype.toString.call(a);
    if (tag !== Object.prototype.toString.call(b)) return false;
    if (a instanceof Date && b instanceof Date) return Object.is(a.getTime(), b.getTime());
    if (a instanceof RegExp && b instanceof RegExp)
      return a.source === b.source && a.flags === b.flags;
    if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) {
      const left = new Uint8Array(a),
        right = new Uint8Array(b);
      return left.length === right.length && left.every((value, index) => value === right[index]);
    }
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      return (
        same(a.buffer, b.buffer) && a.byteOffset === b.byteOffset && a.byteLength === b.byteLength
      );
    }
    if (a instanceof Map && b instanceof Map) {
      return (
        a.size === b.size &&
        [...a.entries()].every(([key, value], index) => {
          const entry = [...b.entries()][index];
          return same(key, entry[0]) && same(value, entry[1]);
        })
      );
    }
    if (a instanceof Set && b instanceof Set) {
      const values = [...b.values()];
      return (
        a.size === b.size && [...a.values()].every((value, index) => same(value, values[index]))
      );
    }
    // Blob bodies and other opaque platform objects cannot be compared safely
    // synchronously in an IDB transaction. Never pretend that they are equal.
    if (tag !== '[object Object]' && tag !== '[object Array]') return false;
    const keys = Reflect.ownKeys(a),
      other = Reflect.ownKeys(b);
    return (
      keys.length === other.length &&
      keys.every((key) => {
        if (!Object.hasOwn(b, key)) return false;
        const left = Object.getOwnPropertyDescriptor(a, key)!;
        const right = Object.getOwnPropertyDescriptor(b, key)!;
        return 'value' in left && 'value' in right && same(left.value, right.value);
      })
    );
  };
  return same(first, second);
}

/** Recovery selects one exact current version; historical admitted shapes stay legacy-only. */
export function hasUnknownRecoveryVersion(
  raw: RawStorageRows,
  expectedSchemaVersion: '9.0.0' | '10.0.0' | '11.0.0' | '12.0.0' = SCHEMA_VERSION,
): boolean {
  return raw.meta.values.some((value) => {
    if (value === null || typeof value !== 'object') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    if (
      expectedSchemaVersion !== SCHEMA_VERSION &&
      descriptor &&
      'value' in descriptor &&
      descriptor.value === expectedSchemaVersion
    ) {
      for (const [field, expectedId, expectedVersion] of [
        ['activePackageRef', 'content.c.primer6', '2.0.0'],
        expectedSchemaVersion === '12.0.0'
          ? ['activeCatalogSetRef', 'catalog-set.c-python-java', '1.0.0']
          : expectedSchemaVersion === '11.0.0'
            ? ['activeCatalogSetRef', 'catalog-set.c-python', '1.0.0']
            : ['activeCatalogSetRef', 'catalog-set.c.primer6', '2.0.0'],
      ] as const) {
        const outer = Object.getOwnPropertyDescriptor(value, field);
        if (!outer || !('value' in outer) || !outer.value || typeof outer.value !== 'object')
          continue;
        const id = Object.getOwnPropertyDescriptor(outer.value, 'id'),
          version = Object.getOwnPropertyDescriptor(outer.value, 'version');
        if (
          id &&
          'value' in id &&
          typeof id.value === 'string' &&
          version &&
          'value' in version &&
          typeof version.value === 'string' &&
          (id.value !== expectedId || version.value !== expectedVersion)
        )
          return true;
      }
    }
    return (
      descriptor &&
      'value' in descriptor &&
      typeof descriptor.value === 'string' &&
      descriptor.value !== expectedSchemaVersion &&
      !(
        expectedSchemaVersion === SCHEMA_VERSION &&
        ['2.0.0', '3.0.0', '4.0.0', '5.0.0'].includes(descriptor.value)
      )
    );
  });
}
export function unknownRecoveryVersionCode(
  raw: RawStorageRows,
  expectedSchemaVersion: '9.0.0' | '10.0.0' | '11.0.0' | '12.0.0' = SCHEMA_VERSION,
): RecoveryErrorCode | null {
  if (!hasUnknownRecoveryVersion(raw, expectedSchemaVersion)) return null;
  const legacyOnly = raw.meta.values.every((value) => {
    if (!value || typeof value !== 'object') return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    return (
      !descriptor ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string' ||
      descriptor.value === expectedSchemaVersion ||
      descriptor.value === '0.9.0'
    );
  });
  return legacyOnly ? 'S_MIGRATION_UNSUPPORTED' : 'S_VERSION_UNKNOWN';
}

/**
 * A read-only subset for display, never a write recipe. Invalid rows and uncertain
 * dependants remain untouched in their original stores. Totals cannot be inferred
 * from this subset when ledgerUncertain is true.
 */
export function inspectRecoveryRows(
  raw: RawStorageRows,
  compare: KeyCompare,
  expectedSchemaVersion: '9.0.0' | '10.0.0' | '11.0.0' | '12.0.0' = SCHEMA_VERSION,
): Omit<RecoveryRead, 'guard'> {
  const issueCounts = new Map<StoreName | 'layout', number>();
  let errorCode = unknownRecoveryVersionCode(raw, expectedSchemaVersion);
  const issue = (
    store: StoreName | 'layout',
    count = 1,
    code: RecoveryErrorCode = 'S_RECORD_INVALID',
  ) => {
    if (count) issueCounts.set(store, (issueCounts.get(store) ?? 0) + count);
    if (
      count &&
      (errorCode === null || (errorCode === 'S_RECORD_INVALID' && code === 'S_DATE_INVALID'))
    )
      errorCode = code;
  };
  let ledgerUncertain = false;
  const issues = () => [...issueCounts].map(([store, count]) => ({ store, count }));
  const metaRows = raw.meta;
  const clearableMeta =
    !hasUnknownRecoveryVersion(raw, expectedSchemaVersion) &&
    sameRecoveryValue(metaRows, structuredClone(metaRows));
  const singleton = (name: 'meta' | 'settings' | 'avatar') => {
    const source = raw[name];
    if (
      source.keys.length === 1 &&
      source.keys[0] === 'current' &&
      source.values.length === 1 &&
      validateRecord(name, source.values[0])
    )
      return source.values[0];
    let code: RecoveryErrorCode = 'S_RECORD_INVALID';
    try {
      assertRecord(name, source.values[0]);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'S_DATE_INVALID')
        code = 'S_DATE_INVALID';
    }
    issue(name, Math.max(1, source.values.length, source.keys.length), code);
    return undefined;
  };
  const meta = singleton('meta');
  if (!validateRecord('meta', meta)) {
    return {
      snapshot: null,
      issues: issues(),
      canClear: clearableMeta,
      resettable: [],
      ledgerUncertain: true,
      writable: false,
      errorCode,
      appearanceReadOnly: true,
      appearanceCanReset: false,
    };
  }
  const snapshot = emptySnapshot(meta);
  const revisionExhausted = meta.revision === Number.MAX_SAFE_INTEGER;
  if (revisionExhausted) issue('meta');
  const resettable: ('settings' | 'avatar')[] = [];
  for (const name of ['settings', 'avatar'] as const) {
    const value = singleton(name);
    if (validateRecord(name, value)) Object.assign(snapshot, { [name]: structuredClone(value) });
    else if (!revisionExhausted && sameRecoveryValue(raw[name], structuredClone(raw[name])))
      resettable.push(name);
  }
  // Appearance faults never remove a learning fact or disable a valid core write.
  let appearanceReadOnly = false;
  try {
    const source = raw.appearance;
    if (source.keys.length !== 1 || source.keys[0] !== 'current' || source.values.length !== 1)
      throw new Error();
    assertRecord('appearance', source.values[0]);
    const assets = raw.appearanceAssets;
    if (assets.keys.length !== assets.values.length) throw new Error();
    for (let index = 0; index < assets.values.length; index++) {
      const asset = assets.values[index];
      assertRecord('appearanceAssets', asset);
      if (compare(recordKey('appearanceAssets', meta.generation, asset), assets.keys[index]) !== 0)
        throw new Error();
    }
    if (assets.values.length !== (source.values[0].background.assetId === null ? 0 : 1))
      throw new Error();
    snapshot.appearance = structuredClone(source.values[0]);
    snapshot.appearanceAssets = structuredClone(
      assets.values,
    ) as StorageSnapshot['appearanceAssets'];
  } catch {
    appearanceReadOnly = true;
  }
  const valid = {} as { [S in (typeof COLLECTION_STORES)[number]]: StorageSnapshot[S] };
  for (const name of COLLECTION_STORES) {
    const source = raw[name];
    const accepted: unknown[] = [];
    const keys = new Set<string>();
    source.values.forEach((value, index) => {
      try {
        assertRecord(name, value);
        const key = recordKey(name, meta.generation, value);
        const token = JSON.stringify(key);
        if (
          source.keys[index] === undefined ||
          compare(key, source.keys[index]) !== 0 ||
          keys.has(token)
        )
          throw new Error();
        keys.add(token);
        accepted.push(structuredClone(value));
      } catch (error) {
        issue(
          name,
          1,
          error && typeof error === 'object' && 'code' in error && error.code === 'S_DATE_INVALID'
            ? 'S_DATE_INVALID'
            : 'S_RECORD_INVALID',
        );
        if (name === 'ledger' || name === 'aliases') ledgerUncertain = true;
      }
    });
    if (source.keys.length > source.values.length)
      issue(name, source.keys.length - source.values.length);
    Object.assign(valid, { [name]: accepted });
  }
  const result = (projection: StorageSnapshot): Omit<RecoveryRead, 'guard'> => ({
    snapshot: projection,
    issues: [
      ...issues(),
      ...(appearanceReadOnly ? [{ store: 'appearance' as const, count: 1 }] : []),
    ],
    canClear: clearableMeta,
    resettable,
    ledgerUncertain,
    writable: issueCounts.size === 0 && !ledgerUncertain,
    errorCode,
    appearanceReadOnly,
    appearanceCanReset:
      !revisionExhausted &&
      validateRecord('settings', raw.settings.values[0]) &&
      raw.settings.keys.length === 1 &&
      raw.settings.keys[0] === 'current' &&
      raw.settings.values.length === 1 &&
      !hasUnknownRecoveryVersion(raw, expectedSchemaVersion),
  });
  // A healthy archive needs one complete relation check. Row shapes and native
  // keys have already been checked above; damaged archives still use the exact
  // isolation path below, without changing or deleting their stored records.
  if (issueCounts.size === 0 && !appearanceReadOnly && !ledgerUncertain) {
    const complete = { ...snapshot, ...valid };
    if (consistent(complete)) {
      const dailyLedger = valid.ledger.filter(
        (entry) => entry.sourceId === 'reward.daily-goal.once',
      );
      // Keep the established read projection order as well as every row. Native
      // key order can place daily awards before the exercise/lesson awards.
      return result({
        ...complete,
        dailyFacts: valid.goals.flatMap((goal) =>
          valid.dailyFacts.filter((fact) => fact.localDate === goal.localDate),
        ),
        ledger: [
          ...valid.ledger.filter((entry) => entry.sourceId !== 'reward.daily-goal.once'),
          ...valid.goals.flatMap((goal) =>
            dailyLedger.filter((entry) => entry.localDate === goal.localDate),
          ),
          ...dailyLedger.filter(
            (entry) => !valid.goals.some((goal) => goal.localDate === entry.localDate),
          ),
        ],
      });
    }
  }
  snapshot.progress = valid.progress;
  snapshot.aliases = valid.aliases;
  if (!consistent(snapshot)) {
    issue('aliases', snapshot.aliases.length);
    if (snapshot.aliases.length) ledgerUncertain = true;
    snapshot.aliases = [];
  }
  const canonical = (id: string) => {
    for (let count = 0; count < 32; count++) {
      const alias = snapshot.aliases.find((alias) => alias.toRef.id === id);
      if (!alias) return id;
      id = alias.fromRef.id;
    }
    return id;
  };
  const dateMatches = (at: string, day: string) => {
    try {
      return localDateAt(at, meta.timeZone) === day;
    } catch {
      return false;
    }
  };
  const facts = valid.dailyFacts.filter((fact) => {
    const dateValid = dateMatches(fact.occurredAt, fact.localDate);
    const accepted =
      dateValid &&
      canonical(fact.subjectRef.id) === fact.canonicalSubjectId &&
      snapshot.progress.some(
        (progress) =>
          progress.eventType === fact.eventType &&
          progress.subjectRef.id === fact.subjectRef.id &&
          progress.subjectRef.version === fact.subjectRef.version,
      );
    if (!accepted) issue('dailyFacts', 1, dateValid ? 'S_RECORD_INVALID' : 'S_DATE_INVALID');
    return accepted;
  });
  const dailyLedger = valid.ledger.filter((entry) => entry.sourceId === 'reward.daily-goal.once');
  for (const entry of valid.ledger.filter(
    (entry) =>
      entry.sourceId !== 'reward.daily-goal.once' &&
      entry.sourceId !== 'reward.challenge.first-answer',
  )) {
    snapshot.ledger.push(entry);
    if (!consistent(snapshot)) {
      snapshot.ledger.pop();
      issue('ledger');
      ledgerUncertain = true;
    }
  }
  const consumedFacts = new Set<unknown>();
  const consumedLedger = new Set<unknown>();
  for (const goal of valid.goals) {
    const dayFacts = facts.filter((fact) => fact.localDate === goal.localDate);
    const dayLedger = dailyLedger.filter((entry) => entry.localDate === goal.localDate);
    dayFacts.forEach((fact) => consumedFacts.add(fact));
    dayLedger.forEach((entry) => consumedLedger.add(entry));
    const candidate = {
      ...snapshot,
      goals: [...snapshot.goals, goal],
      dailyFacts: [...snapshot.dailyFacts, ...dayFacts],
      ledger: [...snapshot.ledger, ...dayLedger],
    };
    if (consistent(candidate)) {
      snapshot.goals = candidate.goals;
      snapshot.dailyFacts = candidate.dailyFacts;
      snapshot.ledger = candidate.ledger;
    } else {
      issue('goals');
      issue('dailyFacts', dayFacts.length);
      issue('ledger', dayLedger.length);
      if (dayLedger.length) ledgerUncertain = true;
    }
  }
  issue('dailyFacts', facts.filter((fact) => !consumedFacts.has(fact)).length);
  for (const entry of dailyLedger.filter((entry) => !consumedLedger.has(entry))) {
    snapshot.ledger.push(entry);
    if (!consistent(snapshot)) {
      snapshot.ledger.pop();
      issue('ledger');
      ledgerUncertain = true;
    }
  }
  for (const entry of valid.ledger.filter((e) => e.sourceId === 'reward.challenge.first-answer')) {
    const related = valid.receipts.filter(
      (r) => r.eventType === 'challenge.answered' && r.subjectRef.id === entry.subjectId,
    );
    const candidate = {
      ...snapshot,
      ledger: [...snapshot.ledger, entry],
      receipts: [...snapshot.receipts, ...related],
    };
    if (consistent(candidate)) {
      snapshot.ledger = candidate.ledger;
      snapshot.receipts = candidate.receipts;
    } else {
      issue('ledger');
      issue('receipts', related.length);
      ledgerUncertain = true;
    }
  }
  for (const receipt of valid.receipts.filter((r) => r.eventType !== 'challenge.answered')) {
    snapshot.receipts.push(receipt);
    if (!consistent(snapshot)) {
      snapshot.receipts.pop();
      issue('receipts');
    }
  }
  const orphanChallenges = valid.receipts.filter(
    (r) =>
      r.eventType === 'challenge.answered' &&
      !valid.ledger.some(
        (e) => e.sourceId === 'reward.challenge.first-answer' && e.subjectId === r.subjectRef.id,
      ),
  );
  if (orphanChallenges.length) {
    issue('receipts', orphanChallenges.length);
    ledgerUncertain = true;
  }
  // Invalid meta/relationships are never repaired by dropping data in the DB.
  return result(snapshot);
}
