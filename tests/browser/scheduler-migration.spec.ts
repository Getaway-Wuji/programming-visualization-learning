import {
  archivedMigrationSuccessor,
  verifyCurrentResetAfterMigration,
} from './migration-current-reset';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  native,
  openAnswer,
  submit,
  changePrint,
  panel,
  ready,
  reviewReady,
} from './scheduler-helpers';
const label = process.env.TASK_EVIDENCE_LABEL ?? 'local';
async function physical(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    const stores = Array.from(db.objectStoreNames),
      tx = db.transaction(stores, 'readonly');
    const done = new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    const request = (r: IDBRequest) =>
      new Promise<unknown>((resolve) => {
        r.onsuccess = () => resolve(r.result);
      });
    const rows = await Promise.all(
      stores.map(async (name) => [
        name,
        {
          keys: await request(tx.objectStore(name).getAllKeys()),
          values: await request(tx.objectStore(name).getAll()),
        },
      ]),
    );
    await done;
    const out = { version: db.version, stores: Object.fromEntries(rows) };
    db.close();
    return out;
  });
}
test('15.3 actual27 DB4 real pass, wrong submission, knowledge mark and history upgrade with all13 old physical partitions intact', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-31T04:00:00.000Z'));
  await page.goto('/#/lessons/lesson.c.variables-output');
  await ready(page);
  await expect(page.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: '开始本节学习', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: '确认已学习', exact: true }).click();
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
  await page.locator('[data-knowledge-mark="knowledge.c.variables"]').click();
  await expect(page.locator('[data-knowledge-mark="knowledge.c.variables"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await openAnswer(page, 'exercise.c.echo');
  await submit(page);
  // Leave the completed workspace before opening a new attempt of the same exercise.
  await page.goto('/#/notebook');
  await ready(page);
  await openAnswer(page, 'exercise.c.echo');
  await changePrint(page, '0');
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(page.getByTestId('practice-attempt-save')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  const before = await native(page),
    physicalBefore = await physical(page);
  expect(physicalBefore.version).toBe(4);
  expect(Object.keys(physicalBefore.stores)).toHaveLength(13);
  expect(before.knowledgeMarks).toHaveLength(1);
  expect(before.receipts.some((r) => r.eventType === 'exercise.attempt-evaluated')).toBe(true);
  expect(before.receipts.some((r) => r.eventType === 'exercise.passed')).toBe(true);
  test.info().annotations.push({
    type: 'historical-intermediate-and-current-reset',
    description:
      'Original migration assertions run against existing .artifacts/15.4/legacy29-dist; then actual formal73 DB10 RESET and genuine fresh C6 learning are independently verified.',
  });
  const historicalSuccessor = await archivedMigrationSuccessor(
    page,
    '.artifacts/15.4/legacy29-dist',
  );
  await mkdir('.artifacts/15.3', { recursive: true });
  await writeFile(`.artifacts/15.3/migration-switch-${label}`, 'actual successor switch\n', {
    flag: 'wx',
  });
  await page.goto('/#/reviews');
  await page.reload();
  await reviewReady(page);
  const after = await native(page),
    physicalAfter = await physical(page);
  expect(physicalAfter.version).toBe(5);
  expect(Object.keys(physicalAfter.stores)).toHaveLength(14);
  expect(after.meta.generation).toBe(before.meta.generation);
  for (const key of Object.keys(before) as (keyof typeof before)[])
    if (key !== 'meta') expect(after[key]).toEqual(before[key]);
  for (const name of Object.keys(physicalBefore.stores))
    if (name !== 'meta') expect(physicalAfter.stores[name]).toEqual(physicalBefore.stores[name]);
  expect(after.reviewCards).toHaveLength(2);
  expect(after.reviewCards.every((c) => c.state === 'active' && c.dueDate === '2026-10-31')).toBe(
    true,
  );
  await expect(page.getByTestId('review-counts')).toHaveText('到期 2 · 未到期 0 · 暂停 0');
  await writeFile(
    `.artifacts/15.3/migration-${label}.json`,
    JSON.stringify(
      {
        actualPredecessor: true,
        predecessor: '1.0.27',
        before,
        after,
        physicalBefore,
        physicalAfter,
      },
      null,
      2,
    ),
  );
  await historicalSuccessor.dispose();
  const currentReset = await verifyCurrentResetAfterMigration(page, after);
  await writeFile(
    `.artifacts/21.6/migration-${label}-scheduler.json`,
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
