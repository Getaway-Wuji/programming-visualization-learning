import type { C6ResetMeta } from './c6-reset';
import { StorageError } from './errors';
import {
  assertActiveCourseMeta as assertEarlierMeta,
  assertPythonMeta,
  pythonCatalogSet,
  type PythonMeta,
} from './python3-meta';

export const JAVA_DB_VERSION = 12;
export const JAVA_STORES = ['javaActivities', 'javaDrafts'] as const;
export const javaCatalogSet = { id: 'catalog-set.c-python-java', version: '1.0.0' } as const;

export type JavaMeta = Omit<PythonMeta, 'schemaVersion' | 'dbVersion' | 'activeCatalogSetRef'> & {
  schemaVersion: '12.0.0';
  dbVersion: 12;
  activeCatalogSetRef: typeof javaCatalogSet;
};

export function toJavaMeta(meta: PythonMeta): JavaMeta {
  assertPythonMeta(meta);
  return {
    ...meta,
    schemaVersion: '12.0.0',
    dbVersion: JAVA_DB_VERSION,
    activeCatalogSetRef: { ...javaCatalogSet },
  };
}

export function assertJavaMeta(value: unknown): asserts value is JavaMeta {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new StorageError('S_RECORD_INVALID');
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).length !== 8 ||
    Object.values(fields).some((field) => !('value' in field))
  ) {
    throw new StorageError('S_RECORD_INVALID');
  }
  if (fields.dbVersion?.value !== JAVA_DB_VERSION) throw new StorageError('S_VERSION_UNKNOWN');
  const meta = value as JavaMeta;
  const catalog = meta.activeCatalogSetRef;
  if (
    meta.schemaVersion !== '12.0.0' ||
    !catalog ||
    Object.getPrototypeOf(catalog) !== Object.prototype ||
    Reflect.ownKeys(catalog).length !== 2 ||
    Object.getOwnPropertyDescriptor(catalog, 'id')?.value !== javaCatalogSet.id ||
    Object.getOwnPropertyDescriptor(catalog, 'version')?.value !== javaCatalogSet.version
  )
    throw new StorageError('S_RECORD_INVALID');
  assertPythonMeta({
    ...meta,
    dbVersion: 11,
    schemaVersion: '11.0.0',
    activeCatalogSetRef: { ...pythonCatalogSet },
  });
}

export function assertActiveCourseMeta(
  value: unknown,
): asserts value is C6ResetMeta | PythonMeta | JavaMeta {
  if (
    value &&
    typeof value === 'object' &&
    Object.getOwnPropertyDescriptor(value, 'dbVersion')?.value === JAVA_DB_VERSION
  ) {
    assertJavaMeta(value);
  } else {
    assertEarlierMeta(value);
  }
}

export function queueJavaStores(db: IDBDatabase, tx: IDBTransaction, meta: PythonMeta) {
  if (db.version !== JAVA_DB_VERSION || tx.mode !== 'versionchange') {
    throw new StorageError('S_MIGRATION_UNSUPPORTED');
  }
  const next = toJavaMeta(meta);
  for (const name of JAVA_STORES) db.createObjectStore(name);
  tx.objectStore('meta').put(next, 'current');
}
