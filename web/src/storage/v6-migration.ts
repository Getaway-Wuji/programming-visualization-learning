import { DB_VERSION, SCHEMA_VERSION, type Meta } from './model';
import { assertRecord } from './validation';
import { StorageError } from './errors';
/** Only meta changes; every old learning, ledger and independent partition remains untouched. */
export function upgradeV6Meta(value: unknown): Meta | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.schemaVersion === 'string' && data.schemaVersion !== '6.0.0')
    throw new StorageError('S_VERSION_UNKNOWN');
  if (
    data.schemaVersion !== '6.0.0' ||
    data.dbVersion !== 6 ||
    !Number.isSafeInteger(data.revision) ||
    (data.revision as number) < 0 ||
    (data.revision as number) >= Number.MAX_SAFE_INTEGER
  )
    return null;
  const next = {
    ...data,
    schemaVersion: SCHEMA_VERSION,
    dbVersion: DB_VERSION,
    revision: (data.revision as number) + 1,
  };
  try {
    assertRecord('meta', next);
    return next;
  } catch {
    return null;
  }
}
