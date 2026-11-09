import {
  assertActiveCourseMeta as assertEarlier,
  assertJavaMeta,
  javaCatalogSet,
  type JavaMeta,
} from './java-meta';
import type { C6ResetMeta } from './c6-reset';
import type { PythonMeta } from './python3-meta';
import { StorageError } from './errors';

export const CPP_DB_VERSION = 13;
export const CPP_STORES = ['cppActivities', 'cppDrafts'] as const;
const cppCatalogSet = { id: 'catalog-set.c-python-java-cpp', version: '1.0.0' } as const;

export type CppMeta = Omit<JavaMeta, 'schemaVersion' | 'dbVersion' | 'activeCatalogSetRef'> & {
  schemaVersion: '13.0.0';
  dbVersion: 13;
  activeCatalogSetRef: typeof cppCatalogSet;
};

export function toCppMeta(meta: JavaMeta): CppMeta {
  assertJavaMeta(meta);
  return {
    ...meta,
    schemaVersion: '13.0.0',
    dbVersion: CPP_DB_VERSION,
    activeCatalogSetRef: { ...cppCatalogSet },
  };
}

export function assertCppMeta(value: unknown): asserts value is CppMeta {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    throw new StorageError('S_RECORD_INVALID');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).length !== 8 ||
    Object.values(fields).some((field) => !('value' in field))
  )
    throw new StorageError('S_RECORD_INVALID');
  const meta = value as CppMeta;
  if (meta.dbVersion !== CPP_DB_VERSION || meta.schemaVersion !== '13.0.0')
    throw new StorageError('S_VERSION_UNKNOWN');
  const catalog = meta.activeCatalogSetRef;
  if (
    !catalog ||
    Object.getPrototypeOf(catalog) !== Object.prototype ||
    Reflect.ownKeys(catalog).length !== 2 ||
    Object.getOwnPropertyDescriptor(catalog, 'id')?.value !== cppCatalogSet.id ||
    Object.getOwnPropertyDescriptor(catalog, 'version')?.value !== cppCatalogSet.version
  )
    throw new StorageError('S_RECORD_INVALID');
  assertJavaMeta({
    ...meta,
    dbVersion: 12,
    schemaVersion: '12.0.0',
    activeCatalogSetRef: { ...javaCatalogSet },
  });
}

export function assertActiveCourseMeta(
  value: unknown,
): asserts value is C6ResetMeta | PythonMeta | JavaMeta | CppMeta {
  if (
    value &&
    typeof value === 'object' &&
    Object.getOwnPropertyDescriptor(value, 'dbVersion')?.value === CPP_DB_VERSION
  )
    assertCppMeta(value);
  else assertEarlier(value);
}

export function queueCppStores(db: IDBDatabase, tx: IDBTransaction, meta: JavaMeta) {
  if (![CPP_DB_VERSION, 14, 15].includes(db.version) || tx.mode !== 'versionchange')
    throw new StorageError('S_MIGRATION_UNSUPPORTED');
  const next = toCppMeta(meta);
  for (const name of CPP_STORES) db.createObjectStore(name);
  tx.objectStore('meta').put(next, 'current');
  return next;
}
