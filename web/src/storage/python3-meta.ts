import type { C6ResetMeta } from './c6-reset';
import { assertC6Meta } from './c6-reset';
import { StorageError } from './errors';
import { SCHEMA_VERSION } from './model';

export const PYTHON_DB_VERSION = 11;
export const PYTHON_STORES = ['pythonActivities', 'pythonDrafts'] as const;
export const pythonCatalogSet = { id: 'catalog-set.c-python', version: '1.0.0' } as const;
export type PythonMeta = Omit<
  C6ResetMeta,
  'schemaVersion' | 'dbVersion' | 'activeCatalogSetRef'
> & {
  schemaVersion: '11.0.0';
  dbVersion: 11;
  activeCatalogSetRef: typeof pythonCatalogSet;
};

export function toPythonMeta(meta: C6ResetMeta): PythonMeta {
  assertC6Meta(meta);
  return {
    ...meta,
    schemaVersion: '11.0.0',
    dbVersion: PYTHON_DB_VERSION,
    activeCatalogSetRef: { ...pythonCatalogSet },
  };
}

export function assertPythonMeta(value: unknown): asserts value is PythonMeta {
  if (!value || typeof value !== 'object') throw new StorageError('S_RECORD_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    descriptors.dbVersion &&
    'value' in descriptors.dbVersion &&
    descriptors.dbVersion.value !== PYTHON_DB_VERSION
  )
    throw new StorageError('S_VERSION_UNKNOWN');
  const meta = value as PythonMeta;
  if (
    Object.getPrototypeOf(meta) !== Object.prototype ||
    Reflect.ownKeys(meta).length !== 8 ||
    Object.values(descriptors).some((d) => !('value' in d)) ||
    meta.schemaVersion !== '11.0.0' ||
    meta.dbVersion !== PYTHON_DB_VERSION
  )
    throw new StorageError('S_RECORD_INVALID');
  const catalog = meta.activeCatalogSetRef;
  if (
    !catalog ||
    Object.getPrototypeOf(catalog) !== Object.prototype ||
    Reflect.ownKeys(catalog).length !== 2 ||
    Object.values(Object.getOwnPropertyDescriptors(catalog)).some((d) => !('value' in d)) ||
    catalog.id !== pythonCatalogSet.id ||
    catalog.version !== pythonCatalogSet.version
  )
    throw new StorageError('S_RECORD_INVALID');
  assertC6Meta({
    ...meta,
    schemaVersion: '10.0.0',
    dbVersion: 10,
    activeCatalogSetRef: { id: 'catalog-set.c.primer6', version: '2.0.0' },
  });
}

export function assertActiveCourseMeta(value: unknown): asserts value is C6ResetMeta | PythonMeta {
  if (value && typeof value === 'object' && 'dbVersion' in value && value.dbVersion === 11)
    assertPythonMeta(value);
  else assertC6Meta(value);
}

export function physicalSchemaVersion(version: number) {
  return version === 14
    ? '14.0.0'
    : version === 13
      ? '13.0.0'
      : version === 12
        ? '12.0.0'
        : version === 11
          ? '11.0.0'
          : version === 10
            ? '10.0.0'
            : SCHEMA_VERSION;
}

export function queuePythonStores(db: IDBDatabase, tx: IDBTransaction, meta: C6ResetMeta) {
  if (![11, 12, 13, 14].includes(db.version) || tx.mode !== 'versionchange')
    throw new StorageError('S_MIGRATION_UNSUPPORTED');
  const next = toPythonMeta(meta);
  for (const name of PYTHON_STORES) db.createObjectStore(name);
  tx.objectStore('meta').put(next, 'current');
  return next;
}
