import { MysqlClient, currentMysqlExecution } from '../../../web/src/engine/mysql-client';
import {
  canonicalMysqlJson,
  defaultMysqlSession,
  mysqlProfile,
} from '../../../web/src/engine/mysql-data';
import { decodeMysqlResponse, mysqlRequest } from '../../../web/src/engine/mysql-protocol';
import { MysqlPlayer } from '../../../web/src/engine/mysql-player';
import type { MysqlResponse, MysqlSession } from '../../../web/src/engine/mysql-types';
import { mysqlBuild } from '../../../web/src/generated/mysql/engine-build';
import init, { execute_mysql } from '../../../web/src/generated/mysql/c_viz_mysql';

const client = new MysqlClient();
function inspect(response: MysqlResponse) {
  if (!response.replay)
    return {
      response,
      initial: null,
      end: null,
      rewound: null,
      receipt: currentMysqlExecution(response),
    };
  const player = new MysqlPlayer(response.replay);
  const initial = player.snapshot();
  for (let cursor = 1; cursor <= player.length; cursor++) player.seek(cursor);
  const end = player.snapshot();
  for (let cursor = player.length - 1; cursor >= 0; cursor--) player.seek(cursor);
  return {
    response,
    initial,
    end,
    rewound: player.snapshot(),
    receipt: currentMysqlExecution(response),
  };
}
function packet(response: MysqlResponse) {
  for (let count = 0; count < 8; count++) {
    const bytes = new TextEncoder().encode(canonicalMysqlJson(response));
    if (response.usage.resultBytes === bytes.byteLength) return bytes.buffer;
    response.usage.resultBytes = bytes.byteLength;
  }
  throw new Error('Nonconvergent packet size');
}
const harness = {
  profile: mysqlProfile,
  defaultSession: defaultMysqlSession,
  async run(source: string, session = defaultMysqlSession()) {
    return inspect(await client.run(source, session));
  },
  async judge(source: string, profile: string, reviewCase = 0) {
    return inspect(await client.judge(source, profile, reviewCase));
  },
  async cancel() {
    const seed = await client.run('SELECT 1 AS seed;', defaultMysqlSession(), 'seed');
    const pending = client.run('SELECT * FROM students;', defaultMysqlSession(), 'cancelled').then(
      () => 'completed',
      (error: Error) => error.message,
    );
    client.invalidate();
    return {
      outcome: await pending,
      stale: currentMysqlExecution(seed),
      recovered: inspect(
        await client.run("SELECT 'ready' AS state;", defaultMysqlSession(), 'recovered'),
      ),
    };
  },
  async transactions() {
    const session = defaultMysqlSession();
    const first = inspect(
      await client.run(
        'BEGIN; UPDATE students SET score=90 WHERE id=1;',
        session,
        'transaction-first',
      ),
    );
    if (!first.end) throw new Error('Missing transaction state');
    const active = first.end.session;
    const rolledBack = inspect(
      await client.run(
        'ROLLBACK; SELECT score FROM students WHERE id=1;',
        active,
        'transaction-rollback',
      ),
    );
    const again = inspect(
      await client.run(
        'BEGIN; UPDATE students SET score=91 WHERE id=1;',
        session,
        'transaction-again',
      ),
    );
    if (!again.end) throw new Error('Missing active transaction');
    const committed = inspect(
      await client.run(
        'COMMIT; SELECT score FROM students WHERE id=1;',
        again.end.session,
        'transaction-commit',
      ),
    );
    return { first, rolledBack, again, committed };
  },
  async forgedReverse() {
    const response = await client.run(
      'UPDATE students SET score=90 WHERE id=1;',
      defaultMysqlSession(),
    );
    const receipt = currentMysqlExecution(response);
    if (!receipt || !response.replay) throw new Error('Missing real MySQL receipt');
    const copied = structuredClone(response);
    const changed = copied
      .replay!.trace.steps.flatMap((step) => step.changes)
      .find((change) => change.component === 'session');
    if (!changed || changed.component !== 'session') throw new Error('Missing real session change');
    changed.before.database.nextRowId = 4097;
    try {
      await decodeMysqlResponse(packet(copied), receipt.request, mysqlBuild.wasmSha256, () => {});
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  async rawError(value: unknown) {
    await init();
    try {
      execute_mysql(
        new TextEncoder().encode(canonicalMysqlJson(value)),
        mysqlBuild.wasmSha256,
        1000,
      );
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  async rawBytes(bytes: number[]) {
    await init();
    try {
      execute_mysql(new Uint8Array(bytes), mysqlBuild.wasmSha256, 1000);
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  request: mysqlRequest,
  async budgetPrefix() {
    const session: MysqlSession = {
      database: {
        tables: [
          {
            name: 'bulk',
            columns: [
              {
                name: 'id',
                type: 'int',
                length: null,
                nullable: false,
                primaryKey: true,
                unique: true,
                defaultValue: null,
              },
            ],
            rows: Array.from({ length: 96 }, (_, index) => ({
              id: index + 1,
              values: [{ kind: 'int', value: index + 1 }],
            })),
          },
        ],
        nextRowId: 97,
      },
      transaction: { active: false, base: null },
    };
    const source = Array.from({ length: 32 }, () => 'SELECT id FROM bulk;').join('\n');
    const result = inspect(await client.run(source, session));
    return {
      result,
      recovered: inspect(await client.run('SELECT 42 AS recovered;', defaultMysqlSession())),
    };
  },
  async largeUtf8Join(order: boolean) {
    const session: MysqlSession = {
      database: {
        tables: [
          {
            name: 'large_text',
            columns: Array.from({ length: 8 }, (_, index) => ({
              name: `c${index}`,
              type: 'varchar',
              length: 256,
              nullable: false,
              primaryKey: false,
              unique: false,
              defaultValue: null,
            })),
            rows: Array.from({ length: 8 }, (_, index) => ({
              id: index + 1,
              values: Array.from({ length: 8 }, () => ({ kind: 'text', value: '🌱'.repeat(240) })),
            })),
          },
        ],
        nextRowId: 9,
      },
      transaction: { active: false, base: null },
    };
    const source = `SELECT * FROM large_text a CROSS JOIN large_text b CROSS JOIN large_text c CROSS JOIN large_text d ${order ? 'ORDER BY a.c0 LIMIT 1' : 'LIMIT 0'};`;
    return inspect(await client.run(source, session));
  },
  async largeDistinct() {
    const session: MysqlSession = {
      database: {
        tables: [
          {
            name: 't',
            columns: [
              {
                name: 'id',
                type: 'int',
                length: null,
                nullable: false,
                primaryKey: true,
                unique: true,
                defaultValue: null,
              },
              {
                name: 'payload',
                type: 'varchar',
                length: 256,
                nullable: false,
                primaryKey: false,
                unique: false,
                defaultValue: null,
              },
            ],
            rows: Array.from({ length: 16 }, (_, index) => ({
              id: index + 1,
              values: [
                { kind: 'int', value: index + 1 },
                { kind: 'text', value: '😀'.repeat(256) },
              ],
            })),
          },
        ],
        nextRowId: 17,
      },
      transaction: { active: false, base: null },
    };
    const source = `SELECT DISTINCT a.id,b.id,c.id,${Array.from({ length: 16 }, (_, index) => `a.payload AS p${index}`).join(',')} FROM t a CROSS JOIN t b CROSS JOIN t c LIMIT 1;`;
    return inspect(await client.run(source, session));
  },
};
declare global {
  interface Window {
    mysqlHarness: typeof harness;
  }
}
window.mysqlHarness = harness;
