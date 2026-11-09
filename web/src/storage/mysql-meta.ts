import {
  assertActiveCourseMeta as assertEarlier,
  assertRustMeta,
  type RustMeta,
} from './rust2018-meta';
import type { Meta } from './model';
import { StorageError } from './errors';

export const MYSQL_DB_VERSION = 15;
export const MYSQL_STORES = ['mysqlActivities', 'mysqlDrafts'] as const;
export const mysqlCatalogSet = {
  id: 'catalog-set.c-python-java-cpp-rust-mysql',
  version: '1.0.0',
} as const;
export type MysqlMeta = Omit<RustMeta, 'schemaVersion' | 'dbVersion' | 'activeCatalogSetRef'> & {
  schemaVersion: '15.0.0';
  dbVersion: 15;
  activeCatalogSetRef: typeof mysqlCatalogSet;
};
export function toMysqlMeta(meta: RustMeta): MysqlMeta {
  assertRustMeta(meta);
  return {
    ...meta,
    schemaVersion: '15.0.0',
    dbVersion: MYSQL_DB_VERSION,
    activeCatalogSetRef: { ...mysqlCatalogSet },
  };
}
export function assertMysqlMeta(value: unknown): asserts value is MysqlMeta {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    throw new StorageError('S_RECORD_INVALID');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== 8 || Object.values(fields).some((f) => !('value' in f)))
    throw new StorageError('S_RECORD_INVALID');
  const meta = value as MysqlMeta;
  if (meta.dbVersion !== MYSQL_DB_VERSION || meta.schemaVersion !== '15.0.0')
    throw new StorageError('S_VERSION_UNKNOWN');
  const catalog = meta.activeCatalogSetRef;
  if (
    !catalog ||
    Object.getPrototypeOf(catalog) !== Object.prototype ||
    Reflect.ownKeys(catalog).length !== 2 ||
    Object.getOwnPropertyDescriptor(catalog, 'id')?.value !== mysqlCatalogSet.id ||
    Object.getOwnPropertyDescriptor(catalog, 'version')?.value !== mysqlCatalogSet.version
  )
    throw new StorageError('S_RECORD_INVALID');
  assertRustMeta({
    ...meta,
    schemaVersion: '14.0.0',
    dbVersion: 14,
    activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp-rust', version: '1.0.0' },
  });
}
export function assertActiveCourseMeta(
  value: unknown,
): asserts value is Exclude<Meta, import('./model').LegacyMeta> {
  if (
    value &&
    typeof value === 'object' &&
    Object.getOwnPropertyDescriptor(value, 'dbVersion')?.value === MYSQL_DB_VERSION
  )
    assertMysqlMeta(value);
  else assertEarlier(value);
}
export function queueMysqlStores(db: IDBDatabase, tx: IDBTransaction, meta: RustMeta) {
  if (db.version !== MYSQL_DB_VERSION || tx.mode !== 'versionchange')
    throw new StorageError('S_MIGRATION_UNSUPPORTED');
  const next = toMysqlMeta(meta);
  for (const name of MYSQL_STORES) db.createObjectStore(name);
  tx.objectStore('meta').put(next, 'current');
  return next;
}
