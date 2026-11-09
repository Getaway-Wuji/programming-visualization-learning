import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type {} from './harness/mysql-content';
import type { MysqlManifest } from '../../web/src/mysql-course/repository';
import type { MysqlDatabase, MysqlProfileCase, MysqlState } from '../../web/src/engine/mysql-types';

const manifest = JSON.parse(
  readFileSync('content/mysql/course/manifest-1.0.0.json', 'utf8'),
) as MysqlManifest;
const bag = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).sort();
function db(database: MysqlDatabase | MysqlProfileCase['expectedDatabase']) {
  return database.tables
    .map((table) => ({
      name: table.name.toLowerCase(),
      columns: table.columns,
      rows: bag(table.rows.map((row) => (Array.isArray(row) ? row : row.values))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function stateMatches(actual: MysqlState, expected: MysqlProfileCase) {
  expect(actual.result.kind).toBe(expected.expectedResult.kind);
  expect(actual.result.affectedRows).toBe(expected.expectedResult.affectedRows);
  expect(actual.result.matchedRows).toBe(expected.expectedResult.matchedRows);
  expect(actual.result.columns).toHaveLength(expected.expectedResult.columns.length);
  if (expected.checkColumnNames)
    expect(actual.result.columns).toEqual(expected.expectedResult.columns);
  expect(expected.ordered ? actual.result.rows : bag(actual.result.rows)).toEqual(
    expected.ordered ? expected.expectedResult.rows : bag(expected.expectedResult.rows),
  );
  expect(db(actual.session.database)).toEqual(db(expected.expectedDatabase));
  expect(actual.session.transaction.active).toBe(expected.expectedTransactionActive);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/checks/mysql-content.html');
  await page.waitForFunction(() => Boolean(window.mysqlContentHarness));
});
test('MySQL published 20 assets match hashes and the strict lazy repository covers all 374 nodes', async ({
  page,
  request,
}) => {
  const response = await request.get('/content/mysql/course/manifest-1.0.0.json');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual(manifest);
  for (const asset of [...manifest.chunks, manifest.sourceFile, manifest.registryFile]) {
    const result = await request.get('/content/mysql/course/' + asset.file);
    expect(result.ok()).toBe(true);
    const bytes = await result.body();
    expect(bytes.length).toBe(asset.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
  }
  const loaded = await page.evaluate(() => window.mysqlContentHarness.content());
  expect(loaded.counts).toEqual(manifest.counts);
  expect(loaded.nodes.map((n) => n.id)).toEqual(manifest.catalog.map((n) => n.id));
  expect(
    loaded.nodes.filter((n) => n.mode === 'reading' && n.activity === 'self-check'),
  ).toHaveLength(288);
  expect(loaded.nodes.filter((n) => n.mode === 'wasm' && n.activity === 'judge')).toHaveLength(12);
  expect(
    loaded.nodes.filter((n) => n.coverage === 'toc-only' && n.physicalPage === null),
  ).toHaveLength(353);
  expect(loaded.coverage).toMatchObject({ physicalPages: 24, bodyNodes: 21, tocOnlyNodes: 353 });
  expect(loaded.profileIds).toHaveLength(12);
});
const registry = JSON.parse(readFileSync('content/mysql/course/exercises-1.0.0.json', 'utf8')) as {
  id: string;
}[];
for (const item of registry)
  test(`MySQL published SQL all four sessions and judge selections / ${item.id}`, async ({
    page,
  }) => {
    const profiles = await page.evaluate(() => window.mysqlContentHarness.exercises()),
      profile = profiles.find((p) => p.id === item.id)!;
    const { lesson } = await page.evaluate(
      (id) => window.mysqlContentHarness.lesson(id),
      profile.lessonId,
    );
    expect(lesson.example?.mode).toBe('wasm');
    expect(lesson.activity?.mode).toBe('judge');
    expect(lesson.example!.source).toBe(profile.referenceSource);
    for (const group of profile.cases) {
      const execution = await page.evaluate(
        ({ source, session }) => window.mysqlContentHarness.run(source, session),
        { source: lesson.example!.source, session: group.session },
      );
      expect(execution.response.status).toBe('completed');
      expect(execution.receipt?.request).toMatchObject({
        operation: 'execute',
        source: lesson.example!.source,
        session: group.session,
      });
      expect(execution.initial.session).toEqual(group.session);
      stateMatches(execution.end, group);
      expect(execution.rewound).toEqual(execution.initial);
      expect(execution.response.replay?.features).toEqual(
        expect.arrayContaining(group.requiredFeatures),
      );
      const judged = await page.evaluate(
        ({ source, profile, reviewCase }) =>
          window.mysqlContentHarness.judge(source, profile, reviewCase),
        { source: lesson.example!.source, profile: profile.id, reviewCase: group.index },
      );
      expect(judged.response.status).toBe('completed');
      expect(judged.response.judgement).toMatchObject({
        passed: true,
        complete: true,
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
        source: lesson.example!.source,
        profile: profile.id,
        reviewCase: group.index,
      });
      stateMatches(judged.end, group);
      expect(judged.rewound).toEqual(judged.initial);
    }
  });
test('MySQL changed published bytes are rejected and a clean retry recovers', async ({ page }) => {
  await page.route('**/content/mysql/course/unit-01-1.0.0.json', async (route) => {
    const response = await route.fetch(),
      bytes = await response.body();
    bytes[20] ^= 1;
    await route.fulfill({ response, body: bytes });
  });
  expect(
    await page.evaluate(() =>
      window.mysqlContentHarness.content().then(
        () => 'accepted',
        (error: Error) => error.message,
      ),
    ),
  ).toBe('E_MYSQL_CONTENT_HASH');
  await page.unroute('**/content/mysql/course/unit-01-1.0.0.json');
  expect((await page.evaluate(() => window.mysqlContentHarness.content())).nodes).toHaveLength(374);
});
