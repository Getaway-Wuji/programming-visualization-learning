import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { execute_mysql, initSync } from '../../web/src/generated/mysql/c_viz_mysql';
import { mysqlBuild } from '../../web/src/generated/mysql/engine-build';
import {
  canonicalMysqlJson,
  defaultMysqlSession,
  mysqlProfile,
  mysqlProfileIds,
} from '../../web/src/engine/mysql-data';
import {
  decodeMysqlResponse,
  encodeMysqlRequest,
  mysqlPositions,
  mysqlRequest,
} from '../../web/src/engine/mysql-protocol';
import type { MysqlResponse, MysqlSession } from '../../web/src/engine/mysql-types';
import { MysqlPlayer, verifyMysqlTrace } from '../../web/src/engine/mysql-player';

beforeAll(() => {
  initSync({ module: new Uint8Array(readFileSync('web/src/generated/mysql/c_viz_mysql_bg.wasm')) });
});
function packet(response: MysqlResponse) {
  for (let count = 0; count < 8; count++) {
    const bytes = new TextEncoder().encode(canonicalMysqlJson(response));
    if (response.usage.resultBytes === bytes.byteLength) return bytes.buffer;
    response.usage.resultBytes = bytes.byteLength;
  }
  throw new Error('Result length did not converge');
}
async function nativeRun(source: string, session = defaultMysqlSession()) {
  const input = mysqlRequest(source, { operation: 'execute', session });
  return decodeMysqlResponse(
    execute_mysql(input.bytes, mysqlBuild.wasmSha256, 1000).slice().buffer,
    input.request,
    mysqlBuild.wasmSha256,
    () => {},
  );
}
function terminal(response: MysqlResponse) {
  if (!response.replay) throw new Error('Expected real replay');
  const player = new MysqlPlayer(response.replay);
  return player.seek(player.length);
}
function traceEvidence(response: MysqlResponse, session: MysqlSession) {
  if (!response.replay) throw new Error('Expected real replay');
  const verification = verifyMysqlTrace(
    response.replay.trace,
    new Map(response.nodeMap.map((node) => [node.id, node])),
    session,
    response.replay.features,
  );
  while (true) {
    const next = verification.next();
    if (next.done) return next.value.evidence;
  }
}
test('actual MySQL WASM examples and all selected judge groups pass the strict SQL protocol', async () => {
  for (const id of mysqlProfileIds) {
    const profile = mysqlProfile(id)!;
    for (const group of profile.cases) {
      const execution = mysqlRequest(
        profile.referenceSource,
        { operation: 'execute', session: group.session },
        'protocol-examples',
      );
      const raw = execute_mysql(execution.bytes, mysqlBuild.wasmSha256, 1000).slice().buffer;
      const response = await decodeMysqlResponse(
        raw,
        execution.request,
        mysqlBuild.wasmSha256,
        () => {},
      );
      expect(response.status, id + ':' + group.index).toBe('completed');
      expect(canonicalMysqlJson(response)).toBe(new TextDecoder().decode(raw));
      const judgement = mysqlRequest(
        profile.referenceSource,
        { operation: 'judge', profile: id, reviewCase: group.index },
        'protocol-judge',
      );
      const judged = await decodeMysqlResponse(
        execute_mysql(judgement.bytes, mysqlBuild.wasmSha256, 1000).slice().buffer,
        judgement.request,
        mysqlBuild.wasmSha256,
        () => {},
      );
      expect(judged.judgement, id + ':' + group.index).toMatchObject({
        complete: true,
        passed: true,
        cases: [
          { index: 0, passed: true },
          { index: 1, passed: true },
          { index: 2, passed: true },
          { index: 3, passed: true },
        ],
      });
    }
  }
}, 20000);
test('response validation rejects forged requests, checkpoints, terminal, bytes, source positions and graph changes', async () => {
  const input = mysqlRequest(
    'SELECT name FROM students WHERE score >= 60 ORDER BY id;',
    { operation: 'execute', session: defaultMysqlSession() },
    'corruption',
  );
  const original = await decodeMysqlResponse(
    execute_mysql(input.bytes, mysqlBuild.wasmSha256, 1000).slice().buffer,
    input.request,
    mysqlBuild.wasmSha256,
    () => {},
  );
  const corruptions: ((r: MysqlResponse) => void)[] = [
    (r) => {
      r.identity.sourceRevision = 'foreign';
    },
    (r) => {
      r.buildId = '0'.repeat(64);
    },
    (r) => {
      r.nodeMap[0].byteRange.end = 32768;
    },
    (r) => {
      r.replay!.trace.checkpoints[0].state.session.database.nextRowId = 4097;
    },
    (r) => {
      r.replay!.terminal.cursor++;
    },
    (r) => {
      r.replay!.features.push('transaction-write');
    },
    (r) => {
      r.replay!.trace.steps[0].changes.push(structuredClone(r.replay!.trace.steps[0].changes[0]));
    },
    (r) => {
      r.usage.steps++;
    },
    (r) => {
      r.replay!.trace.initialState.session.database.tables[0].rows[0].values[0] = {
        kind: 'int',
        value: 9007199254740991,
      };
    },
  ];
  for (const mutate of corruptions) {
    const response = structuredClone(original);
    mutate(response);
    await expect(
      decodeMysqlResponse(packet(response), input.request, mysqlBuild.wasmSha256, () => {}),
    ).rejects.toThrow('E_PROTOCOL_INVALID');
  }
  const wrongLength = structuredClone(original);
  wrongLength.usage.resultBytes = 1;
  await expect(
    decodeMysqlResponse(
      new TextEncoder().encode(canonicalMysqlJson(wrongLength)).buffer,
      input.request,
      mysqlBuild.wasmSha256,
      () => {},
    ),
  ).rejects.toThrow('E_PROTOCOL_INVALID');
  const duplicate = new TextEncoder().encode('{"version":"1.0.0","version":"1.0.0"}').buffer;
  await expect(
    decodeMysqlResponse(duplicate, input.request, mysqlBuild.wasmSha256, () => {}),
  ).rejects.toThrow('E_PROTOCOL_INVALID');
  await expect(
    decodeMysqlResponse(
      new Uint8Array([0xff]).buffer,
      input.request,
      mysqlBuild.wasmSha256,
      () => {},
    ),
  ).rejects.toThrow('E_PROTOCOL_INVALID');
});
test('UTF-8 ranges distinguish byte offsets and UTF-16 offsets and reject malformed input graphs', () => {
  const positions = mysqlPositions("SELECT '叶😀';\n");
  expect(positions.get(15)?.utf16Offset).toBe(11);
  expect(positions.has(10)).toBe(false);
  const input = mysqlRequest('SELECT 1;', { operation: 'execute', session: defaultMysqlSession() });
  const broken = structuredClone(input.request);
  if (broken.operation !== 'execute') throw new Error('Expected execute');
  broken.session.database.tables[0].rows[0].id = broken.session.database.tables[1].rows[0].id;
  expect(() => encodeMysqlRequest(broken)).toThrow('E_SESSION_INVALID');
  expect(() =>
    mysqlRequest('x'.repeat(32769), { operation: 'execute', session: defaultMysqlSession() }),
  ).toThrow('E_SOURCE_LIMIT');
  expect(() =>
    mysqlRequest("SELECT '\ud800';", { operation: 'execute', session: defaultMysqlSession() }),
  ).toThrow('E_REQUEST_INVALID');
});

test('separate real requests preserve active transactions and failed writes, then reverse DDL and row deletion', async () => {
  const original = defaultMysqlSession();
  const run = async (source: string, session = original) => {
    const input = mysqlRequest(source, { operation: 'execute', session });
    return decodeMysqlResponse(
      execute_mysql(input.bytes, mysqlBuild.wasmSha256, 1000).slice().buffer,
      input.request,
      mysqlBuild.wasmSha256,
      () => {},
    );
  };
  const changed = await run('BEGIN; UPDATE students SET score = 0 WHERE id = 1;');
  const activePlayer = new MysqlPlayer(changed.replay!);
  const active = activePlayer.seek(activePlayer.length).session;
  expect(active.transaction.active).toBe(true);
  expect(changed.replay!.features).toContain('transaction-write');
  const rolledBack = await run('ROLLBACK;', active);
  expect(rolledBack.replay!.features).not.toContain('transaction-write');
  const rollbackPlayer = new MysqlPlayer(rolledBack.replay!);
  expect(rollbackPlayer.seek(rollbackPlayer.length).session).toEqual(original);
  const failed = await run('UPDATE students SET id = 1;');
  expect(failed.diagnostic?.code).toBe('E_CONSTRAINT');
  const failedPlayer = new MysqlPlayer(failed.replay!);
  expect(failedPlayer.seek(failedPlayer.length).session).toEqual(original);
  const ddl = await run(
    'CREATE TABLE tmp (id INT PRIMARY KEY); INSERT INTO tmp VALUES (1),(2); DELETE FROM tmp; TRUNCATE TABLE tmp; DROP TABLE tmp;',
  );
  expect(ddl.status).toBe('completed');
  const ddlPlayer = new MysqlPlayer(ddl.replay!);
  const final = ddlPlayer.seek(ddlPlayer.length);
  expect(final.session.database.tables.some((table) => table.name === 'tmp')).toBe(false);
  expect(final.control.table).toBeNull();
  expect(final.control.rowIds).toEqual([]);
  expect(ddlPlayer.seek(0).session).toEqual(original);
});

test('grouped source names take precedence in HAVING while AVG aliases keep the frozen expression boundary', async () => {
  const ordinary = await nativeRun(
    'SELECT 1 AS id FROM students GROUP BY id HAVING id>2 ORDER BY id;',
  );
  expect(terminal(ordinary).result.rows).toEqual([
    [{ kind: 'int', value: 1 }],
    [{ kind: 'int', value: 1 }],
  ]);
  const average = await nativeRun('SELECT AVG(score) AS id FROM students GROUP BY id HAVING id>2;');
  expect(terminal(average).result.rows).toEqual([
    [{ kind: 'null' }],
    [{ kind: 'decimal', value: '59.0000' }],
  ]);
  for (const source of [
    'SELECT AVG(score) AS id FROM students GROUP BY id HAVING id>2 ORDER BY id;',
    'SELECT AVG(score) AS x FROM students GROUP BY id HAVING x>2;',
  ])
    expect((await nativeRun(source)).diagnostic?.code).toBe('E_UNSUPPORTED');
});
test('repeated primary-key declarations are rejected before any table is published', async () => {
  for (const source of [
    'CREATE TABLE t(x INT PRIMARY KEY, PRIMARY KEY(x));',
    'CREATE TABLE t(x INT PRIMARY KEY PRIMARY KEY);',
    'CREATE TABLE t(x INT, PRIMARY KEY(x), PRIMARY KEY(x));',
    'CREATE TABLE t(x INT PRIMARY KEY,y INT PRIMARY KEY);',
  ]) {
    const response = await nativeRun(source);
    expect(response.status).toBe('error');
    expect(response.diagnostic?.code).toBe('E_CONSTRAINT');
    expect(response.replay).toBeNull();
  }
  expect((await nativeRun('CREATE TABLE t(x INT, PRIMARY KEY(x));')).status).toBe('completed');
});
test('unused conditional branches skip runtime overflow while all names and types remain statically validated', async () => {
  for (const [source, value] of [
    ['SELECT IFNULL(1,9007199254740991+1);', 1],
    ['SELECT COALESCE(1,9007199254740991+1);', 1],
    ['SELECT COALESCE(NULL,NULL,7,9007199254740991+1);', 7],
    ['SELECT 0 AND (9007199254740991+1);', 0],
    ['SELECT 1 OR (9007199254740991+1);', 1],
  ] as const)
    expect(terminal(await nativeRun(source)).result.rows).toEqual([[{ kind: 'int', value }]]);
  for (const [source, code] of [
    ['SELECT IFNULL(NULL,9007199254740991+1);', 'E_OVERFLOW'],
    ['SELECT 0 OR (9007199254740991+1);', 'E_OVERFLOW'],
    ['SELECT 1 AND (9007199254740991+1);', 'E_OVERFLOW'],
    ['SELECT NULL AND (9007199254740991+1);', 'E_OVERFLOW'],
    ["SELECT IFNULL(1,'text');", 'E_TYPE'],
    ['SELECT COALESCE(1,missing) FROM students;', 'E_NAME'],
    ['SELECT 0 AND missing FROM students;', 'E_NAME'],
  ] as const)
    expect((await nativeRun(source)).diagnostic?.code).toBe(code);
});
test('transaction judge derives a real write and rollback from the same episode rather than concatenated feature tokens', async () => {
  const prefix =
    'START TRANSACTION;UPDATE students SET score=score+5 WHERE score>=70;UPDATE students SET score=score-5 WHERE score>=75;';
  for (const ending of ['COMMIT;ROLLBACK;', 'COMMIT;BEGIN;ROLLBACK;', 'ROLLBACK;']) {
    for (let reviewCase = 0; reviewCase < 4; reviewCase++) {
      const source = `${prefix}${ending}SELECT id,score FROM students ORDER BY id;`;
      const input = mysqlRequest(source, {
        operation: 'judge',
        profile: 'mysql.exercise.transaction',
        reviewCase,
      });
      const response = await decodeMysqlResponse(
        execute_mysql(input.bytes, mysqlBuild.wasmSha256, 1000).slice().buffer,
        input.request,
        mysqlBuild.wasmSha256,
        () => {},
      );
      const valid = ending === 'ROLLBACK;';
      expect(response.judgement?.passed).toBe(valid);
      expect(response.judgement?.cases[2].passed).toBe(true);
      for (const index of [0, 1, 3])
        expect(response.judgement?.cases[index].reason).toBe(valid ? 'passed' : 'goal-unmet');
      expect(
        traceEvidence(
          response,
          mysqlProfile('mysql.exercise.transaction')!.cases[reviewCase].session,
        ).rolledBackWrite,
      ).toBe(valid && reviewCase !== 2);
      if (!valid && reviewCase !== 2) {
        const forged = structuredClone(response);
        for (const item of forged.judgement!.cases) {
          item.passed = true;
          item.reason = 'passed';
        }
        forged.judgement!.passed = true;
        await expect(
          decodeMysqlResponse(packet(forged), input.request, mysqlBuild.wasmSha256, () => {}),
        ).rejects.toThrow('E_PROTOCOL_INVALID');
      }
    }
  }
});
test('large DISTINCT reuses the admitted projected payload and completes without a memory trap', async () => {
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
  const response = await nativeRun(source, session);
  expect(response.status).toBe('completed');
  const end = terminal(response);
  expect(end.session).toEqual(session);
  expect(end.result.columns).toHaveLength(19);
  expect(end.result.rows).toHaveLength(1);
  expect(end.result.rows[0].slice(0, 3)).toEqual([
    { kind: 'int', value: 1 },
    { kind: 'int', value: 1 },
    { kind: 'int', value: 1 },
  ]);
}, 20000);

test('duplicate result names resolve identical expressions and reject different expressions', async () => {
  for (const source of [
    'SELECT id,id FROM students ORDER BY id;',
    'SELECT id AS x,id AS x FROM students ORDER BY x;',
  ]) {
    const response = await nativeRun(source);
    expect(response.status).toBe('completed');
    expect(terminal(response).result.rows).toEqual(
      [1, 2, 3, 4].map((value) => [
        { kind: 'int', value },
        { kind: 'int', value },
      ]),
    );
  }
  for (const source of [
    'SELECT id AS x,score AS x FROM students ORDER BY x;',
    'SELECT id AS x,score AS x FROM students GROUP BY x;',
    'SELECT id AS x,score AS x FROM students HAVING x>1;',
  ])
    expect((await nativeRun(source)).diagnostic?.code).toBe('E_NAME');
});
