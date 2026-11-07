import {
  assertActiveCourseMeta as assertEarlier,
  assertCppMeta,
  type CppMeta,
} from './cpp-course-meta';
import type { C6ResetMeta } from './c6-reset';
import type { PythonMeta } from './python3-meta';
import type { JavaMeta } from './java-meta';
import { StorageError } from './errors';

export const RUST_DB_VERSION = 14;
export const RUST_STORES = ['rustActivities', 'rustDrafts'] as const;
const rustCatalogSet = { id: 'catalog-set.c-python-java-cpp-rust', version: '1.0.0' } as const;

export type RustMeta = Omit<CppMeta, 'schemaVersion' | 'dbVersion' | 'activeCatalogSetRef'> & {
  schemaVersion: '14.0.0';
  dbVersion: 14;
  activeCatalogSetRef: typeof rustCatalogSet;
};

export function toRustMeta(meta: CppMeta): RustMeta {
  assertCppMeta(meta);
  return {
    ...meta,
    schemaVersion: '14.0.0',
    dbVersion: RUST_DB_VERSION,
    activeCatalogSetRef: { ...rustCatalogSet },
  };
}

export function assertRustMeta(value: unknown): asserts value is RustMeta {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    throw new StorageError('S_RECORD_INVALID');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).length !== 8 ||
    Object.values(fields).some((field) => !('value' in field))
  )
    throw new StorageError('S_RECORD_INVALID');
  const meta = value as RustMeta;
  if (meta.dbVersion !== RUST_DB_VERSION || meta.schemaVersion !== '14.0.0')
    throw new StorageError('S_VERSION_UNKNOWN');
  const catalog = meta.activeCatalogSetRef;
  if (
    !catalog ||
    Object.getPrototypeOf(catalog) !== Object.prototype ||
    Reflect.ownKeys(catalog).length !== 2 ||
    Object.getOwnPropertyDescriptor(catalog, 'id')?.value !== rustCatalogSet.id ||
    Object.getOwnPropertyDescriptor(catalog, 'version')?.value !== rustCatalogSet.version
  )
    throw new StorageError('S_RECORD_INVALID');
  assertCppMeta({
    ...meta,
    dbVersion: 13,
    schemaVersion: '13.0.0',
    activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp', version: '1.0.0' },
  });
}

export function assertActiveCourseMeta(
  value: unknown,
): asserts value is C6ResetMeta | PythonMeta | JavaMeta | CppMeta | RustMeta {
  if (
    value &&
    typeof value === 'object' &&
    Object.getOwnPropertyDescriptor(value, 'dbVersion')?.value === RUST_DB_VERSION
  )
    assertRustMeta(value);
  else assertEarlier(value);
}

export function queueRustStores(db: IDBDatabase, tx: IDBTransaction, meta: CppMeta) {
  if (db.version !== RUST_DB_VERSION || tx.mode !== 'versionchange')
    throw new StorageError('S_MIGRATION_UNSUPPORTED');
  const next = toRustMeta(meta);
  for (const name of RUST_STORES) db.createObjectStore(name);
  tx.objectStore('meta').put(next, 'current');
}
