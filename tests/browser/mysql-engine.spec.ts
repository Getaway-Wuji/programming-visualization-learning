import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type {} from './harness/mysql';
import type {
  MysqlCell,
  MysqlColumn,
  MysqlDatabase,
  MysqlProfile,
  MysqlResult,
  MysqlSession,
} from '../../web/src/engine/mysql-types';

const bundle = JSON.parse(readFileSync('shared/contracts/mysql-profiles-1.0.0.json', 'utf8')) as {
  defaultSession: MysqlSession;
  profiles: MysqlProfile[];
};
interface Vector {
  id: string;
  topic: string;
  source: string;
  seed: number;
  expectedStatus: 'completed' | 'error' | 'limited' | 'rejected';
  expectedCode: string | null;
  expectedRows?: MysqlCell[][];
  ordered?: boolean;
  sessionOverride?: MysqlSession;
  unchangedDatabase?: boolean;
  changesDatabase?: boolean;
  expectedAffectedRows?: number;
  expectedMatchedRows?: number;
  expectedScoreById?: Record<string, number>;
  expectedTransactionActive?: boolean;
  requestMutation?:
    'add-unknown-top-level-field' | 'duplicate-logical-row-id' | 'unknown-judge-profile';
}
const vectors = (
  JSON.parse(readFileSync('tests/fixtures/mysql-semantic-1.0.0.json', 'utf8')) as {
    vectors: Vector[];
  }
).vectors;
const bag = (rows: MysqlCell[][]) => rows.map((row) => JSON.stringify(row)).sort();
function databaseContent(
  database:
    MysqlDatabase | { tables: { name: string; columns: MysqlColumn[]; rows: MysqlCell[][] }[] },
) {
  return database.tables
    .map((table) => ({
      name: table.name.toLowerCase(),
      columns: table.columns.map((column) => ({ ...column, name: column.name.toLowerCase() })),
      rows: bag(table.rows.map((row) => (Array.isArray(row) ? row : row.values))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function expectResult(
  actual: MysqlResult | undefined,
  expected: MysqlResult,
  ordered: boolean,
  names: boolean,
) {
  expect(actual).toBeDefined();
  expect(actual!.kind).toBe(expected.kind);
  expect(actual!.affectedRows).toBe(expected.affectedRows);
  expect(actual!.matchedRows).toBe(expected.matchedRows);
  expect(actual!.columns).toHaveLength(expected.columns.length);
  if (names) expect(actual!.columns).toEqual(expected.columns);
  expect(ordered ? actual!.rows : bag(actual!.rows)).toEqual(
    ordered ? expected.rows : bag(expected.rows),
  );
}
test.beforeEach(async ({ page }) => {
  await page.goto('/checks/mysql.html');
  await page.waitForFunction(() => Boolean(window.mysqlHarness));
});

for (const vector of vectors) {
  test(`MySQL frozen semantics and reverse / ${vector.id} ${vector.topic}`, async ({ page }) => {
    const session = structuredClone(
      vector.sessionOverride ?? bundle.profiles[0].cases[vector.seed].session,
    );
    if (vector.expectedStatus === 'rejected') {
      const request: Record<string, unknown> = {
        version: '1.0.0',
        language: 'mysql',
        dialect: '8.0',
        operation: 'execute',
        runId: 'semantic-native',
        sourceRevision: vector.id,
        source: vector.source,
        session,
      };
      if (vector.requestMutation === 'add-unknown-top-level-field') request.extra = true;
      if (vector.requestMutation === 'duplicate-logical-row-id')
        session.database.tables[0].rows[1].id = session.database.tables[0].rows[0].id;
      if (vector.requestMutation === 'unknown-judge-profile') {
        delete request.session;
        Object.assign(request, { operation: 'judge', profile: 'mysql.unknown', reviewCase: 0 });
      }
      expect(await page.evaluate((value) => window.mysqlHarness.rawError(value), request)).toBe(
        vector.expectedCode,
      );
      return;
    }
    const result = await page.evaluate(
      ({ source, session }) => window.mysqlHarness.run(source, session),
      { source: vector.source, session },
    );
    expect(result.response.status).toBe(vector.expectedStatus);
    expect(result.response.diagnostic?.code ?? null).toBe(vector.expectedCode);
    expect(result.receipt?.request.source).toBe(vector.source);
    expect(result.receipt?.request.operation).toBe('execute');
    expect(result.rewound).toEqual(result.initial);
    if (result.initial) expect(result.initial.session).toEqual(session);
    if (vector.expectedRows !== undefined)
      expect(
        vector.ordered === false ? bag(result.end!.result.rows) : result.end!.result.rows,
      ).toEqual(vector.ordered === false ? bag(vector.expectedRows) : vector.expectedRows);
    if (vector.expectedAffectedRows !== undefined)
      expect(result.end?.result.affectedRows).toBe(vector.expectedAffectedRows);
    if (vector.expectedMatchedRows !== undefined)
      expect(result.end?.result.matchedRows).toBe(vector.expectedMatchedRows);
    if (vector.expectedTransactionActive !== undefined)
      expect(result.end?.session.transaction.active).toBe(vector.expectedTransactionActive);
    if (vector.unchangedDatabase)
      expect(databaseContent(result.end?.session.database ?? session.database)).toEqual(
        databaseContent(session.database),
      );
    if (vector.changesDatabase)
      expect(databaseContent(result.end!.session.database)).not.toEqual(
        databaseContent(session.database),
      );
    if (vector.expectedScoreById) {
      const students = result.end!.session.database.tables.find(
        (table) => table.name === 'students',
      )!;
      const idIndex = students.columns.findIndex((column) => column.name === 'id'),
        scoreIndex = students.columns.findIndex((column) => column.name === 'score');
      for (const [id, score] of Object.entries(vector.expectedScoreById))
        expect(
          students.rows.find(
            (row) => row.values[idIndex].kind === 'int' && row.values[idIndex].value === Number(id),
          )?.values[scoreIndex],
        ).toEqual({ kind: 'int', value: score });
    }
    if (result.response.replay) {
      expect(result.response.replay.trace.completeness).toBe(
        vector.expectedStatus === 'completed' ? 'complete' : 'prefix',
      );
      expect(result.response.replay.terminal.cursor).toBe(
        result.response.replay.trace.steps.length,
      );
    } else expect(result.response.usage.steps).toBe(0);
  });
}

for (const profile of bundle.profiles) {
  test(`MySQL examples and current-source four-group judge / ${profile.id}`, async ({ page }) => {
    for (const group of profile.cases) {
      const example = await page.evaluate(
        ({ source, session }) => window.mysqlHarness.run(source, session),
        { source: profile.referenceSource, session: group.session },
      );
      expect(example.response.status).toBe('completed');
      expectResult(
        example.end?.result,
        group.expectedResult,
        group.ordered,
        group.checkColumnNames,
      );
      expect(databaseContent(example.end!.session.database)).toEqual(
        databaseContent(group.expectedDatabase),
      );
      expect(example.end?.session.transaction.active).toBe(group.expectedTransactionActive);
      expect(example.response.replay?.features).toEqual(
        expect.arrayContaining(group.requiredFeatures),
      );
      expect(example.rewound).toEqual(example.initial);
      const judged = await page.evaluate(
        ({ source, id, index }) => window.mysqlHarness.judge(source, id, index),
        { source: profile.referenceSource, id: profile.id, index: group.index },
      );
      expect(judged.response.judgement).toMatchObject({
        complete: true,
        passed: true,
        reviewCase: group.index,
        cases: [
          { index: 0, passed: true },
          { index: 1, passed: true },
          { index: 2, passed: true },
          { index: 3, passed: true },
        ],
      });
      expect(judged.receipt?.request).toMatchObject({
        operation: 'judge',
        source: profile.referenceSource,
        profile: profile.id,
        reviewCase: group.index,
      });
      expect(judged.initial?.session).toEqual(group.session);
      expectResult(judged.end?.result, group.expectedResult, group.ordered, group.checkColumnNames);
      expect(databaseContent(judged.end!.session.database)).toEqual(
        databaseContent(group.expectedDatabase),
      );
      expect(judged.rewound).toEqual(judged.initial);
    }
    const source = "SELECT 'current-source' AS wrong;";
    const edited = await page.evaluate(
      ({ source, id }) => window.mysqlHarness.judge(source, id, 0),
      { source, id: profile.id },
    );
    expect(edited.response.judgement?.complete).toBe(true);
    expect(edited.response.judgement?.passed).toBe(false);
    expect(edited.end?.result.rows).toEqual([[{ kind: 'text', value: 'current-source' }]]);
    expect(edited.receipt?.request.source).toBe(source);
  });
}

test('MySQL goal features require actual transactional writes and rollback', async ({ page }) => {
  const result = await page.evaluate(() =>
    window.mysqlHarness.judge(
      'SELECT id, score FROM students ORDER BY id;',
      'mysql.exercise.transaction',
      0,
    ),
  );
  expect(result.response.judgement?.passed).toBe(false);
  expect(result.response.judgement?.cases[0].reason).toBe('goal-unmet');
  expect(result.response.replay?.features).not.toContain('transaction-write');
  expect(result.rewound).toEqual(result.initial);
});
test('MySQL HAVING prefers the grouped source name while AVG expression restrictions remain enforced', async ({
  page,
}) => {
  const ordinary = await page.evaluate(() =>
    window.mysqlHarness.run('SELECT 1 AS id FROM students GROUP BY id HAVING id>2 ORDER BY id;'),
  );
  expect(ordinary.end?.result.rows).toEqual([
    [{ kind: 'int', value: 1 }],
    [{ kind: 'int', value: 1 }],
  ]);
  const average = await page.evaluate(() =>
    window.mysqlHarness.run('SELECT AVG(score) AS id FROM students GROUP BY id HAVING id>2;'),
  );
  expect(average.end?.result.rows).toEqual([
    [{ kind: 'null' }],
    [{ kind: 'decimal', value: '59.0000' }],
  ]);
  expect(ordinary.rewound).toEqual(ordinary.initial);
  expect(average.rewound).toEqual(average.initial);
  for (const source of [
    'SELECT AVG(score) AS id FROM students GROUP BY id HAVING id>2 ORDER BY id;',
    'SELECT AVG(score) AS x FROM students GROUP BY id HAVING x>2;',
  ])
    expect(
      (await page.evaluate((value) => window.mysqlHarness.run(value), source)).response.diagnostic
        ?.code,
    ).toBe('E_UNSUPPORTED');
});
test('MySQL duplicate result labels resolve the same source expression and reject conflicting aliases', async ({
  page,
}) => {
  for (const source of [
    'SELECT id,id FROM students ORDER BY id;',
    'SELECT id AS x,id AS x FROM students ORDER BY x;',
  ]) {
    const result = await page.evaluate((value) => window.mysqlHarness.run(value), source);
    expect(result.response.status).toBe('completed');
    expect(result.end?.result.rows).toEqual(
      [1, 2, 3, 4].map((value) => [
        { kind: 'int', value },
        { kind: 'int', value },
      ]),
    );
    expect(result.rewound).toEqual(result.initial);
  }
  for (const source of [
    'SELECT id AS x,score AS x FROM students ORDER BY x;',
    'SELECT id AS x,score AS x FROM students GROUP BY x;',
    'SELECT id AS x,score AS x FROM students HAVING x>1;',
  ])
    expect(
      (await page.evaluate((value) => window.mysqlHarness.run(value), source)).response.diagnostic
        ?.code,
    ).toBe('E_NAME');
});
test('MySQL repeated primary-key declarations reject the complete SQL before publishing a table', async ({
  page,
}) => {
  for (const source of [
    'CREATE TABLE t(x INT PRIMARY KEY, PRIMARY KEY(x));',
    'CREATE TABLE t(x INT PRIMARY KEY PRIMARY KEY);',
    'CREATE TABLE t(x INT, PRIMARY KEY(x), PRIMARY KEY(x));',
    'CREATE TABLE t(x INT PRIMARY KEY,y INT PRIMARY KEY);',
  ]) {
    const result = await page.evaluate((value) => window.mysqlHarness.run(value), source);
    expect(result.response.status).toBe('error');
    expect(result.response.diagnostic?.code).toBe('E_CONSTRAINT');
    expect(result.response.replay).toBeNull();
  }
  const valid = await page.evaluate(() =>
    window.mysqlHarness.run('CREATE TABLE t(x INT, PRIMARY KEY(x));'),
  );
  expect(valid.response.status).toBe('completed');
  expect(valid.rewound).toEqual(valid.initial);
});
test('MySQL short-circuit expressions skip unused runtime overflow while checking every static name and type', async ({
  page,
}) => {
  for (const [source, value] of [
    ['SELECT IFNULL(1,9007199254740991+1);', 1],
    ['SELECT COALESCE(1,9007199254740991+1);', 1],
    ['SELECT COALESCE(NULL,NULL,7,9007199254740991+1);', 7],
    ['SELECT 0 AND (9007199254740991+1);', 0],
    ['SELECT 1 OR (9007199254740991+1);', 1],
  ] as const) {
    const result = await page.evaluate((sql) => window.mysqlHarness.run(sql), source);
    expect(result.response.status).toBe('completed');
    expect(result.end?.result.rows).toEqual([[{ kind: 'int', value }]]);
    expect(result.rewound).toEqual(result.initial);
  }
  for (const [source, code] of [
    ['SELECT IFNULL(NULL,9007199254740991+1);', 'E_OVERFLOW'],
    ['SELECT 0 OR (9007199254740991+1);', 'E_OVERFLOW'],
    ['SELECT 1 AND (9007199254740991+1);', 'E_OVERFLOW'],
    ['SELECT NULL AND (9007199254740991+1);', 'E_OVERFLOW'],
    ["SELECT IFNULL(1,'text');", 'E_TYPE'],
    ['SELECT COALESCE(1,missing) FROM students;', 'E_NAME'],
    ['SELECT 0 AND missing FROM students;', 'E_NAME'],
  ] as const)
    expect(
      (await page.evaluate((value) => window.mysqlHarness.run(value), source)).response.diagnostic
        ?.code,
    ).toBe(code);
});
test('MySQL rollback teaching goal links the real write and rollback to one transaction episode', async ({
  page,
}) => {
  const prefix =
    'START TRANSACTION;UPDATE students SET score=score+5 WHERE score>=70;UPDATE students SET score=score-5 WHERE score>=75;';
  for (const ending of ['COMMIT;ROLLBACK;', 'COMMIT;BEGIN;ROLLBACK;', 'ROLLBACK;']) {
    for (let index = 0; index < 4; index++) {
      const source = `${prefix}${ending}SELECT id,score FROM students ORDER BY id;`;
      const result = await page.evaluate(
        ({ source, index }) =>
          window.mysqlHarness.judge(source, 'mysql.exercise.transaction', index),
        { source, index },
      );
      const valid = ending === 'ROLLBACK;';
      expect(result.response.judgement?.complete).toBe(true);
      expect(result.response.judgement?.passed).toBe(valid);
      expect(result.response.judgement?.cases[2].passed).toBe(true);
      for (const nonempty of [0, 1, 3])
        expect(result.response.judgement?.cases[nonempty].reason).toBe(
          valid ? 'passed' : 'goal-unmet',
        );
      expect(result.response.replay?.features).toEqual(
        expect.arrayContaining(['begin', 'update', 'rollback']),
      );
      if (index !== 2) expect(result.response.replay?.features).toContain('transaction-write');
      expect(result.rewound).toEqual(result.initial);
    }
  }
});
test('MySQL large DISTINCT retains one admitted text payload instead of trapping on a second copy', async ({
  page,
}) => {
  const result = await page.evaluate(() => window.mysqlHarness.largeDistinct());
  expect(result.response.status).toBe('completed');
  expect(result.response.replay?.features).toContain('distinct');
  expect(result.end?.result.columns).toHaveLength(19);
  expect(result.end?.result.rows).toHaveLength(1);
  expect(result.end?.result.rows[0].slice(0, 3)).toEqual([
    { kind: 'int', value: 1 },
    { kind: 'int', value: 1 },
    { kind: 'int', value: 1 },
  ]);
  expect(result.end?.result.rows[0].slice(3)).toEqual(
    Array.from({ length: 16 }, () => ({ kind: 'text', value: '😀'.repeat(256) })),
  );
  expect(result.end?.session).toEqual(result.initial?.session);
  expect(result.rewound).toEqual(result.initial);
});
test('MySQL active transactions continue across real requests and commit or roll back exactly', async ({
  page,
}) => {
  const result = await page.evaluate(() => window.mysqlHarness.transactions());
  expect(result.first.end?.session.transaction.active).toBe(true);
  expect(result.rolledBack.end?.result.rows).toEqual([[{ kind: 'int', value: 88 }]]);
  expect(result.rolledBack.end?.session.transaction.active).toBe(false);
  expect(result.rolledBack.response.replay?.features).not.toContain('transaction-write');
  expect(result.committed.end?.result.rows).toEqual([[{ kind: 'int', value: 91 }]]);
  expect(result.committed.end?.session.transaction.active).toBe(false);
  for (const item of [result.first, result.rolledBack, result.again, result.committed])
    expect(item.rewound).toEqual(item.initial);
});
test('MySQL cancellation invalidates old receipts and a fresh SQL run recovers', async ({
  page,
}) => {
  const result = await page.evaluate(() => window.mysqlHarness.cancel());
  expect(result.outcome).toBe('E_CANCELLED');
  expect(result.stale).toBeNull();
  expect(result.recovered.end?.result.rows).toEqual([[{ kind: 'text', value: 'ready' }]]);
});
test('MySQL real reverse changes reject forged before values', async ({ page }) => {
  expect(await page.evaluate(() => window.mysqlHarness.forgedReverse())).toBe('E_PROTOCOL_INVALID');
});
test('MySQL cumulative step budget preserves a complete reversible prefix and recovers', async ({
  page,
}) => {
  const { result, recovered } = await page.evaluate(() => window.mysqlHarness.budgetPrefix());
  expect(result.response.status).toBe('limited');
  expect(result.response.diagnostic?.code).toBe('E_STEP_LIMIT');
  expect(result.response.usage.steps).toBe(2048);
  expect(result.response.replay?.trace.steps).toHaveLength(2048);
  expect(result.response.replay?.trace.checkpoints.map((checkpoint) => checkpoint.cursor)).toEqual(
    Array.from({ length: 17 }, (_, index) => index * 128),
  );
  expect(result.rewound).toEqual(result.initial);
  expect(recovered.end?.result.rows).toEqual([[{ kind: 'int', value: 42 }]]);
});
test('MySQL UTF-8 source endpoints preserve original statements and exact decimal values', async ({
  page,
}) => {
  const source = "SELECT '叶😀' AS text; SELECT AVG(score) AS average FROM students;";
  const result = await page.evaluate((value) => window.mysqlHarness.run(value), source);
  const bytes = Buffer.from(source);
  expect(result.response.nodeMap).toHaveLength(2);
  expect(
    bytes
      .subarray(
        result.response.nodeMap[0].byteRange.start,
        result.response.nodeMap[0].byteRange.end,
      )
      .toString('utf8'),
  ).toContain("'叶😀'");
  expect(
    result.response.nodeMap.every(
      (node) =>
        !bytes
          .subarray(node.byteRange.start, node.byteRange.end)
          .toString('utf8')
          .includes('\uFFFD'),
    ),
  ).toBe(true);
  expect(result.end?.result.rows).toEqual([[{ kind: 'decimal', value: '73.0000' }]]);
  expect(result.rewound).toEqual(result.initial);
});
test('MySQL native WASM rejects bad versions, malformed UTF-8 and duplicate JSON keys', async ({
  page,
}) => {
  const request = {
    version: '1.0.0',
    language: 'mysql',
    dialect: '9.0',
    operation: 'execute',
    runId: 'raw-native',
    sourceRevision: 'raw-native',
    source: 'SELECT 1;',
    session: bundle.defaultSession,
  };
  expect(await page.evaluate((value) => window.mysqlHarness.rawError(value), request)).toBe(
    'E_VERSION_UNSUPPORTED',
  );
  expect(await page.evaluate(() => window.mysqlHarness.rawBytes([255]))).toBe('E_REQUEST_INVALID');
  const bytes = Array.from(Buffer.from('{"version":"1.0.0","version":"1.0.0"}'));
  expect(await page.evaluate((value) => window.mysqlHarness.rawBytes(value), bytes)).toBe(
    'E_REQUEST_INVALID',
  );
});
test('MySQL large UTF-8 self-join LIMIT zero avoids unnecessary materialization', async ({
  page,
}) => {
  const result = await page.evaluate(() => window.mysqlHarness.largeUtf8Join(false));
  expect(result.response.status).toBe('completed');
  expect(result.end?.result.columns).toHaveLength(32);
  expect(result.end?.result.rows).toEqual([]);
  expect(result.response.usage.databaseBytes).toBeLessThanOrEqual(65536);
  expect(result.rewound).toEqual(result.initial);
});
test('MySQL large UTF-8 self-join rejects excess live materialization before a memory trap', async ({
  page,
}) => {
  const result = await page.evaluate(() => window.mysqlHarness.largeUtf8Join(true));
  expect(result.response.status).toBe('limited');
  expect(result.response.diagnostic?.code).toBe('E_MEMORY_LIMIT');
  expect(result.rewound).toEqual(result.initial);
});
for (const depth of [24, 32, 48, 64]) {
  test(`MySQL nested expression depth ${depth} returns a diagnostic rather than trapping`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      (source) => window.mysqlHarness.run(source),
      `SELECT ${'('.repeat(depth)}1${')'.repeat(depth)};`,
    );
    if (result.response.status === 'completed')
      expect(result.end?.result.rows).toEqual([[{ kind: 'int', value: 1 }]]);
    else {
      expect(result.response.status).toBe('limited');
      expect(result.response.diagnostic?.code).toBe('E_DEPTH_LIMIT');
    }
    expect(result.rewound).toEqual(result.initial);
  });
}
test('MySQL one-second deadline rejects an actual delayed Worker result and ignores its late callback', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker,
      fault = { hold: true, captured: 0, delivered: 0 };
    Object.assign(window, { mysqlLateFault: fault });
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        let handler: Worker['onmessage'] = null;
        Object.defineProperty(this, 'onmessage', {
          get: () => handler,
          set: (value: Worker['onmessage']) => {
            handler = value;
          },
        });
        this.addEventListener('message', (event: MessageEvent) => {
          const callback = handler;
          if (fault.hold) {
            fault.captured++;
            setTimeout(() => {
              fault.delivered++;
              callback?.call(this, event);
            }, 1100);
          } else callback?.call(this, event);
        });
      }
    };
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.mysqlHarness));
  const result = await page.evaluate(async () => {
    try {
      await window.mysqlHarness.run('SELECT 1;');
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(result).toBe('E_DEADLINE');
  await page.evaluate(() => {
    (window as unknown as { mysqlLateFault: { hold: boolean } }).mysqlLateFault.hold = false;
  });
  const recovered = await page.evaluate(() => window.mysqlHarness.run('SELECT 7 AS recovered;'));
  expect(recovered.end?.result.rows).toEqual([[{ kind: 'int', value: 7 }]]);
  await page.waitForFunction(
    () =>
      (window as unknown as { mysqlLateFault: { captured: number; delivered: number } })
        .mysqlLateFault.captured > 0 &&
      (window as unknown as { mysqlLateFault: { delivered: number } }).mysqlLateFault.delivered > 0,
  );
  expect(recovered.receipt?.request.source).toBe('SELECT 7 AS recovered;');
});
