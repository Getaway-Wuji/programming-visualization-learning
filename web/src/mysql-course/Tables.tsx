import { useState } from 'react';
import type { MysqlCell, MysqlResult, MysqlState } from '../engine/mysql-types';

const quotedText = (text: string) =>
  text === '' ||
  text.trim() !== text ||
  [...text].some((scalar) => scalar.charCodeAt(0) < 32 || scalar.charCodeAt(0) === 127);
export const showMysqlCell = (cell: MysqlCell) =>
  cell.kind === 'null'
    ? 'NULL'
    : cell.kind === 'text' && quotedText(cell.value)
      ? JSON.stringify(cell.value)
      : String(cell.value);
const numeric = (cell: MysqlCell) => cell.kind === 'int' || cell.kind === 'decimal';
function Cell({ cell }: { cell: MysqlCell }) {
  return (
    <td className={numeric(cell) ? 'mysql-num' : undefined} data-kind={cell.kind}>
      {cell.kind === 'null' ? (
        <span className="mysql-null">NULL</span>
      ) : cell.kind === 'text' && quotedText(cell.value) ? (
        <span
          title={
            cell.value === '' ? '空字符串' : '文本以 JSON 引号和转义显示，保留首尾空白及控制字符'
          }
        >
          {showMysqlCell(cell)}
        </span>
      ) : (
        showMysqlCell(cell)
      )}
    </td>
  );
}
export function MysqlResultTable({ result }: { result: MysqlResult }) {
  return (
    <section className="mysql-sheet mysql-query" aria-label="查询结果" data-testid="mysql-result">
      <div className="mysql-title">
        <h2>查询与执行结果</h2>
        {result.kind === 'query' && <span>{result.rows.length} 行</span>}
      </div>
      {result.kind === 'query' ? (
        <div className="mysql-table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {result.columns.map((name, at) => (
                  <th
                    key={at}
                    className={
                      result.rows.some((row) => numeric(row[at])) ? 'mysql-num' : undefined
                    }
                  >
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, col) => (
                    <Cell key={col} cell={cell} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length === 0 && <p className="mysql-muted">查询返回 0 行。</p>}
        </div>
      ) : result.kind === 'none' ? (
        <p className="mysql-muted">运行 SQL 后显示此步骤的真实结果。</p>
      ) : result.kind === 'mutation' ? (
        <p>
          实际改变 {result.affectedRows} 行 · 匹配 {result.matchedRows} 行
        </p>
      ) : result.kind === 'ddl' ? (
        <p>表结构操作已完成。</p>
      ) : (
        <p>事务操作已完成。</p>
      )}
    </section>
  );
}
export function MysqlDatabaseTables({
  state,
  historical,
}: {
  state: MysqlState;
  historical: boolean;
}) {
  const [selected, setSelected] = useState('');
  const tables = state.session.database.tables;
  const table = tables.find((table) => table.name === selected) ?? tables[0];
  return (
    <section
      className="mysql-sheet mysql-database"
      aria-label="教学数据库"
      data-testid="mysql-database"
    >
      <div className="mysql-title">
        <h2>数据库表格</h2>
        <span className="mysql-muted">
          {historical ? '回放步骤' : '当前数据库'} · {tables.length} 张表
        </span>
      </div>
      <p className="mysql-transaction" data-testid="mysql-transaction">
        {state.session.transaction.active
          ? '事务进行中 · 可继续写入、提交或回滚'
          : '当前无活动事务'}
      </p>
      {tables.length ? (
        <>
          <label className="mysql-table-select">
            数据表
            <select
              aria-label="数据表"
              value={table.name}
              onChange={(event) => setSelected(event.target.value)}
            >
              {tables.map((table) => (
                <option key={table.name} value={table.name}>
                  {table.name} · {table.rows.length} 行
                </option>
              ))}
            </select>
          </label>
          <div className="mysql-table-layout">
            <div
              className="mysql-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={table.name + ' 数据'}
            >
              <table>
                <thead>
                  <tr>
                    {table.columns.map((col) => (
                      <th key={col.name} className={col.type === 'int' ? 'mysql-num' : undefined}>
                        {col.name}
                        <small>
                          {col.type === 'int' ? 'INT' : `VARCHAR(${col.length})`}
                          {col.primaryKey ? ' · PK' : ''}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr
                      key={row.id}
                      data-active={
                        state.control.table?.toLowerCase() === table.name.toLowerCase() &&
                        state.control.rowIds.includes(row.id)
                          ? 'true'
                          : undefined
                      }
                    >
                      {row.values.map((cell, at) => (
                        <Cell key={at} cell={cell} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {table.rows.length === 0 && (
                <p className="mysql-muted">{table.name} 当前为 0 行，表结构仍然存在。</p>
              )}
            </div>
            <section className="mysql-schema" aria-label="字段类型与约束">
              <h3>字段与约束</h3>
              <dl>
                {table.columns.map((col) => (
                  <div key={col.name}>
                    <dt>
                      {col.name}{' '}
                      <span>{col.type === 'int' ? 'INT' : `VARCHAR(${col.length})`}</span>
                    </dt>
                    <dd>
                      {[
                        col.primaryKey ? 'PRIMARY KEY' : '',
                        col.unique && !col.primaryKey ? 'UNIQUE' : '',
                        col.nullable ? '允许 NULL' : 'NOT NULL',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      <br />
                      默认值：
                      {col.defaultValue === null ? '未定义' : showMysqlCell(col.defaultValue)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </>
      ) : (
        <p className="mysql-muted">当前数据库没有表，可用 CREATE TABLE 建表。</p>
      )}
    </section>
  );
}
