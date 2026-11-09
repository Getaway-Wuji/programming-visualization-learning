import profilesText from '../../../shared/contracts/mysql-profiles-1.0.0.json?raw';
import { mysqlProtocol } from '../../../shared/contracts/mysql-execution.mjs';
import type {
  MysqlCell,
  MysqlColumn,
  MysqlDatabase,
  MysqlProfile,
  MysqlProfileCase,
  MysqlResult,
  MysqlSession,
  MysqlState,
  MysqlTraceEvidence,
} from './mysql-types';

export type * from './mysql-types';
export function mysqlAssert(value: unknown): asserts value {
  if (!value) throw new Error('E_PROTOCOL_INVALID');
}
export function mysqlEqual(a: unknown, b: unknown): boolean {
  const pending: [unknown, unknown][] = [[a, b]];
  while (pending.length) {
    const [left, right] = pending.pop()!;
    if (left === right) continue;
    if (
      !left ||
      !right ||
      typeof left !== 'object' ||
      typeof right !== 'object' ||
      Array.isArray(left) !== Array.isArray(right)
    )
      return false;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(right, key)) return false;
      pending.push([
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ]);
    }
  }
  return true;
}
const encoder = new TextEncoder();
export const mysqlBytes = (text: string) => encoder.encode(text).byteLength;
export function canonicalMysqlJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    mysqlAssert(new TextDecoder().decode(encoder.encode(value)) === value);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    mysqlAssert(Number.isSafeInteger(value) && !Object.is(value, -0));
    return String(value);
  }
  mysqlAssert(typeof value === 'object');
  if (Array.isArray(value)) return `[${value.map(canonicalMysqlJson).join(',')}]`;
  return `{${Object.keys(value!)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalMysqlJson((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}
export const mysqlJsonBytes = (value: unknown) => mysqlBytes(canonicalMysqlJson(value));
function keys(value: object, names: string[]) {
  mysqlAssert(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      mysqlEqual(Object.keys(value).sort(), names.sort()),
  );
}
const integer = (value: number, min: number, max: number) =>
  mysqlAssert(Number.isSafeInteger(value) && value >= min && value <= max && !Object.is(value, -0));
const name = (value: string) =>
  mysqlAssert(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value));
export function validateMysqlCell(cell: MysqlCell, stored = false) {
  mysqlAssert(cell && typeof cell === 'object');
  keys(cell, cell.kind === 'null' ? ['kind'] : ['kind', 'value']);
  if (cell.kind === 'null') return;
  if (cell.kind === 'int') {
    integer(
      cell.value,
      stored ? -2147483648 : -Number.MAX_SAFE_INTEGER,
      stored ? 2147483647 : Number.MAX_SAFE_INTEGER,
    );
    return;
  }
  mysqlAssert(typeof cell.value === 'string');
  if (cell.kind === 'text') {
    mysqlAssert([...cell.value].length <= 256 && mysqlBytes(cell.value) <= 1024);
    mysqlAssert(new TextDecoder().decode(encoder.encode(cell.value)) === cell.value);
  } else
    mysqlAssert(
      !stored &&
        cell.kind === 'decimal' &&
        cell.value.length <= 24 &&
        /^(?!-0(?:\.0000)?$)-?(?:0|[1-9][0-9]*)(?:\.[0-9]{4})?$/.test(cell.value),
    );
}
function columnCell(cell: MysqlCell, column: MysqlColumn) {
  validateMysqlCell(cell, true);
  if (cell.kind === 'null') mysqlAssert(column.nullable);
  else if (column.type === 'int') mysqlAssert(cell.kind === 'int');
  else mysqlAssert(cell.kind === 'text' && [...cell.value].length <= column.length!);
}
export function validateMysqlDatabase(database: MysqlDatabase): number {
  keys(database, ['tables', 'nextRowId']);
  integer(database.nextRowId, 1, 4097);
  mysqlAssert(Array.isArray(database.tables) && database.tables.length <= 16);
  const names = new Set<string>(),
    ids = new Set<number>();
  for (const table of database.tables) {
    keys(table, ['name', 'columns', 'rows']);
    name(table.name);
    mysqlAssert(!names.has(table.name.toLowerCase()));
    names.add(table.name.toLowerCase());
    mysqlAssert(
      Array.isArray(table.columns) &&
        table.columns.length >= 1 &&
        table.columns.length <= 16 &&
        Array.isArray(table.rows),
    );
    const columns = new Set<string>();
    let primary = 0;
    for (const column of table.columns) {
      keys(column, ['name', 'type', 'length', 'nullable', 'primaryKey', 'unique', 'defaultValue']);
      name(column.name);
      mysqlAssert(!columns.has(column.name.toLowerCase()));
      columns.add(column.name.toLowerCase());
      mysqlAssert(
        [column.nullable, column.primaryKey, column.unique].every(
          (value) => typeof value === 'boolean',
        ),
      );
      mysqlAssert(
        column.type === 'int'
          ? column.length === null
          : column.type === 'varchar' &&
              Number.isInteger(column.length) &&
              column.length! >= 1 &&
              column.length! <= 256,
      );
      if (column.primaryKey) {
        primary++;
        mysqlAssert(!column.nullable && column.unique);
      }
      if (column.defaultValue !== null) columnCell(column.defaultValue, column);
    }
    mysqlAssert(primary <= 1);
    const unique = table.columns.map(() => new Set<string>());
    for (const row of table.rows) {
      keys(row, ['id', 'values']);
      integer(row.id, 1, 4096);
      mysqlAssert(row.id < database.nextRowId && !ids.has(row.id));
      ids.add(row.id);
      mysqlAssert(Array.isArray(row.values) && row.values.length === table.columns.length);
      row.values.forEach((cell, index) => {
        const column = table.columns[index];
        columnCell(cell, column);
        if (column.unique && cell.kind !== 'null') {
          const key = canonicalMysqlJson(cell);
          mysqlAssert(!unique[index].has(key));
          unique[index].add(key);
        }
      });
    }
  }
  mysqlAssert(ids.size <= 256);
  const size = mysqlJsonBytes(database);
  mysqlAssert(size <= mysqlProtocol.databaseBytes);
  return size;
}
const schema = (database: MysqlDatabase) =>
  database.tables.map((table) => ({ name: table.name, columns: table.columns }));
export function validateMysqlSession(session: MysqlSession): number {
  keys(session, ['database', 'transaction']);
  keys(session.transaction, ['active', 'base']);
  let peak = validateMysqlDatabase(session.database);
  if (session.transaction.active === true) {
    mysqlAssert(session.transaction.base !== null);
    peak = Math.max(peak, validateMysqlDatabase(session.transaction.base));
    mysqlAssert(mysqlEqual(schema(session.database), schema(session.transaction.base)));
    mysqlAssert(session.database.nextRowId >= session.transaction.base.nextRowId);
  } else mysqlAssert(session.transaction.active === false && session.transaction.base === null);
  return peak;
}
export function validateMysqlResult(result: MysqlResult) {
  keys(result, ['kind', 'columns', 'rows', 'affectedRows', 'matchedRows']);
  mysqlAssert(['none', 'query', 'mutation', 'ddl', 'transaction'].includes(result.kind));
  integer(result.affectedRows, 0, 256);
  integer(result.matchedRows, 0, 256);
  mysqlAssert(
    Array.isArray(result.columns) &&
      result.columns.length <= 32 &&
      Array.isArray(result.rows) &&
      result.rows.length <= 256,
  );
  mysqlAssert(
    result.columns.every((label) => typeof label === 'string' && [...label].length <= 256),
  );
  for (const row of result.rows) {
    mysqlAssert(Array.isArray(row) && row.length === result.columns.length);
    row.forEach((cell) => validateMysqlCell(cell));
  }
  if (result.kind === 'query') mysqlAssert(result.affectedRows === 0 && result.matchedRows === 0);
  else {
    mysqlAssert(!result.columns.length && !result.rows.length);
    if (result.kind !== 'mutation')
      mysqlAssert(result.affectedRows === 0 && result.matchedRows === 0);
  }
}
export function validateMysqlState(state: MysqlState, nodeIds?: ReadonlySet<number>): number {
  return validateStateComponents(state, nodeIds, validateMysqlSession, validateMysqlResult);
}
function validateStateComponents(
  state: MysqlState,
  nodeIds: ReadonlySet<number> | undefined,
  session: (value: MysqlSession) => number,
  result: (value: MysqlResult) => void,
): number {
  keys(state, ['session', 'result', 'control']);
  const peak = session(state.session);
  result(state.result);
  const control = state.control;
  keys(control, ['statement', 'phase', 'table', 'rowIds']);
  mysqlAssert(
    [
      'ready',
      'statement',
      'scan',
      'filter',
      'join',
      'group',
      'project',
      'distinct',
      'order',
      'limit',
      'write',
      'transaction',
      'done',
    ].includes(control.phase),
  );
  mysqlAssert(
    control.statement === null ||
      (Number.isInteger(control.statement) &&
        control.statement >= 1 &&
        control.statement <= 32 &&
        (!nodeIds || nodeIds.has(control.statement))),
  );
  mysqlAssert((control.phase === 'ready') === (control.statement === null));
  mysqlAssert(
    Array.isArray(control.rowIds) &&
      control.rowIds.length <= 256 &&
      new Set(control.rowIds).size === control.rowIds.length,
  );
  if (control.table === null) mysqlAssert(control.rowIds.length === 0);
  else {
    name(control.table);
    const table = state.session.database.tables.find(
      (table) => table.name.toLowerCase() === control.table!.toLowerCase(),
    );
    mysqlAssert(table);
    for (const id of control.rowIds) mysqlAssert(table.rows.some((row) => row.id === id));
  }
  if (control.phase === 'ready') mysqlAssert(control.table === null && !control.rowIds.length);
  return peak;
}
/** A trace-local cache only admits fully validated, recursively immutable components. */
export function createMysqlStateValidator(nodeIds: ReadonlySet<number>) {
  const sessions = new WeakMap<MysqlSession, number>(),
    results = new WeakSet<MysqlResult>(),
    sealed = new WeakSet<object>();
  const seal = (value: object) => {
    const pending = [value];
    while (pending.length) {
      const item = pending.pop()!;
      if (sealed.has(item)) continue;
      Object.freeze(item);
      sealed.add(item);
      for (const child of Object.values(item))
        if (child !== null && typeof child === 'object') pending.push(child);
    }
  };
  const session = (value: MysqlSession) => {
    const known = sessions.get(value);
    if (known !== undefined) return known;
    const peak = validateMysqlSession(value);
    seal(value);
    sessions.set(value, peak);
    return peak;
  };
  const result = (value: MysqlResult) => {
    if (results.has(value)) return;
    validateMysqlResult(value);
    seal(value);
    results.add(value);
  };
  return (state: MysqlState) => validateStateComponents(state, nodeIds, session, result);
}
export function initialMysqlState(session: MysqlSession): MysqlState {
  validateMysqlSession(session);
  return {
    session: structuredClone(session),
    result: { kind: 'none', columns: [], rows: [], affectedRows: 0, matchedRows: 0 },
    control: { statement: null, phase: 'ready', table: null, rowIds: [] },
  };
}
const bundle = JSON.parse(profilesText) as {
  defaultSession: MysqlSession;
  profiles: MysqlProfile[];
};
const profiles = new Map(bundle.profiles.map((profile) => [profile.id, profile]));
export const mysqlProfileIds = Object.freeze([...profiles.keys()]);
export const defaultMysqlSession = () => structuredClone(bundle.defaultSession);
export const mysqlProfile = (id: string) => {
  const profile = profiles.get(id);
  return profile ? structuredClone(profile) : undefined;
};
export const mysqlJudgeSession = (id: string, index: number) => {
  const session = profiles.get(id)?.cases[index]?.session;
  return session ? structuredClone(session) : undefined;
};
function multiset(rows: MysqlCell[][]) {
  return rows.map(canonicalMysqlJson).sort();
}
export function mysqlCaseReason(
  state: MysqlState,
  features: readonly string[],
  expected: MysqlProfileCase,
  evidence?: MysqlTraceEvidence,
): 'passed' | 'wrong-result' | 'wrong-database' | 'goal-unmet' {
  const actual = state.result,
    wanted = expected.expectedResult;
  if (
    actual.kind !== wanted.kind ||
    actual.affectedRows !== wanted.affectedRows ||
    actual.matchedRows !== wanted.matchedRows ||
    actual.columns.length !== wanted.columns.length ||
    (expected.checkColumnNames && !mysqlEqual(actual.columns, wanted.columns)) ||
    !mysqlEqual(
      expected.ordered ? actual.rows : multiset(actual.rows),
      expected.ordered ? wanted.rows : multiset(wanted.rows),
    )
  )
    return 'wrong-result';
  const tables = state.session.database.tables;
  const comparableColumns = (columns: MysqlColumn[]) =>
    columns.map((column) => ({ ...column, name: column.name.toLowerCase() }));
  if (
    state.session.transaction.active !== expected.expectedTransactionActive ||
    tables.length !== expected.expectedDatabase.tables.length ||
    expected.expectedDatabase.tables.some((wanted) => {
      const actual = tables.find((table) => table.name.toLowerCase() === wanted.name.toLowerCase());
      return (
        !actual ||
        !mysqlEqual(comparableColumns(actual.columns), comparableColumns(wanted.columns)) ||
        !mysqlEqual(multiset(actual.rows.map((row) => row.values)), multiset(wanted.rows))
      );
    })
  )
    return 'wrong-database';
  if (
    expected.requiredFeatures.some((feature) => !features.includes(feature)) ||
    (expected.requiredFeatures.includes('transaction-write') &&
      expected.requiredFeatures.includes('rollback') &&
      evidence?.rolledBackWrite !== true)
  )
    return 'goal-unmet';
  return 'passed';
}
