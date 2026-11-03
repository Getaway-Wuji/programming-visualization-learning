import {
  archivedMigrationSuccessor,
  verifyCurrentResetAfterMigration,
} from './migration-current-reset';
import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { native, openAnswer, submit, achievementReady } from './achievement-helpers';
import { mark } from './scheduler-helpers';
const label = process.env.TASK_EVIDENCE_LABEL ?? 'local';
async function physical(p: Page) {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => {
      const q = indexedDB.open('c-viz-learning');
      q.onsuccess = () => r(q.result);
    });
    try {
      const names = Array.from(db.objectStoreNames),
        tx = db.transaction(names, 'readonly'),
        done = new Promise<void>((r) => {
          tx.oncomplete = () => r();
        });
      const read = (q: IDBRequest) =>
        new Promise<unknown>((r) => {
          q.onsuccess = () => r(q.result);
        });
      const rows = await Promise.all(
        names.map(async (n) => [
          n,
          {
            keys: await read(tx.objectStore(n).getAllKeys()),
            values: await read(tx.objectStore(n).getAll()),
          },
        ]),
      );
      await done;
      return { version: db.version, stores: Object.fromEntries(rows) };
    } finally {
      db.close();
    }
  });
}
test('16.1 actual34 SAVE6 upgrades to7 without rewriting any of the15 old partitions', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-31T04:00:00.000Z'));
  await mark(page);
  await page.locator('[data-review-rating="good"]').click();
  await openAnswer(page, 'exercise.c.bubble-sort');
  await submit(page);
  await page.goto('/#/achievements');
  await achievementReady(page);
  await expect(page.getByTestId('achievement-total')).toHaveText('1 / 3');
  const before = await native(page),
    physicalBefore = await physical(page);
  expect(physicalBefore.version).toBe(6);
  expect(Object.keys(physicalBefore.stores)).toHaveLength(15);
  expect(before.ledger.length).toBeGreaterThan(0);
  expect(before.achievements).toHaveLength(1);
  expect(before.reviewCards).toHaveLength(1);
  expect(before.knowledgeMarks).toHaveLength(1);
  test.info().annotations.push({
    type: 'historical-intermediate-and-current-reset',
    description:
      'Original migration assertions run against existing .artifacts/16.10/delivery-workspace/web/dist; then actual formal73 DB10 RESET and genuine fresh C6 learning are independently verified.',
  });
  const historicalSuccessor = await archivedMigrationSuccessor(
    page,
    '.artifacts/16.10/delivery-workspace/web/dist',
  );
  await mkdir('.artifacts/16.1', { recursive: true });
  await writeFile(`.artifacts/16.1/migration-switch-${label}`, 'actual successor switch\n', {
    flag: 'wx',
  });
  await page.reload();
  await achievementReady(page);
  const after = await native(page),
    physicalAfter = await physical(page);
  expect(physicalAfter.version).toBe(7);
  expect(Object.keys(physicalAfter.stores)).toHaveLength(15);
  for (const name of Object.keys(physicalBefore.stores))
    if (name !== 'meta') expect(physicalAfter.stores[name]).toEqual(physicalBefore.stores[name]);
  expect(after.meta).toEqual({
    ...before.meta,
    schemaVersion: '7.0.0',
    dbVersion: 7,
    revision: before.meta.revision + 1,
  });
  await page.goto('/#/visualize/case.c.assignment');
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  await page.getByRole('button', { name: '预测挑战', exact: true }).click();
  await page
    .getByRole('group', { name: '本次挑战题目', exact: true })
    .getByRole('button')
    .first()
    .click();
  await page.locator('[data-answer-kind="value.initialize"]').click();
  await expect(page.getByTestId('challenge-feedback')).toContainText('本次答案已保存');
  const answered = await native(page);
  expect(answered.ledger).toHaveLength(before.ledger.length + 1);
  expect(answered.progress).toEqual(before.progress);
  expect(answered.dailyFacts).toEqual(before.dailyFacts);
  expect(answered.achievements).toEqual(before.achievements);
  await writeFile(
    `.artifacts/16.1/migration-${label}.json`,
    JSON.stringify(
      {
        actualPredecessor: true,
        predecessor: '1.0.34',
        before,
        after,
        answered,
        physicalBefore,
        physicalAfter,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  await historicalSuccessor.dispose();
  const currentReset = await verifyCurrentResetAfterMigration(page, after);
  await writeFile(
    `.artifacts/21.6/migration-${label}-challenge.json`,
    JSON.stringify(
      {
        historicalIntermediate: {
          directory: historicalSuccessor.directory,
          files: historicalSuccessor.files,
        },
        currentReset,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
});
