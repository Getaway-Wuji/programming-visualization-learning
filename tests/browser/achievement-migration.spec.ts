import {
  archivedMigrationSuccessor,
  verifyCurrentResetAfterMigration,
} from './migration-current-reset';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { native, openAnswer, submit, achievementReady } from './achievement-helpers';
import { ready } from './notebook-helpers';
import { memoryBugQuestions } from '../../web/src/memory-bugs/content';
const label = process.env.TASK_EVIDENCE_LABEL ?? 'local';
async function physical(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    try {
      const names = Array.from(db.objectStoreNames),
        tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      const request = (r: IDBRequest) =>
        new Promise<unknown>((resolve) => {
          r.onsuccess = () => resolve(r.result);
        });
      const entries = await Promise.all(
        names.map(async (name) => [
          name,
          {
            keys: await request(tx.objectStore(name).getAllKeys()),
            values: await request(tx.objectStore(name).getAll()),
          },
        ]),
      );
      await done;
      return { version: db.version, stores: Object.fromEntries(entries) };
    } finally {
      db.close();
    }
  });
}
test('15.4 actual29 DB5 genuine bubble and pointer passes, marks, review and history preserve all14 old partitions while backfilling', async ({
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
  await openAnswer(page, 'exercise.c.bubble-sort');
  await submit(page);
  const q = memoryBugQuestions[0];
  await page.goto(`/#/bugs/memory/${q.exerciseRef.id}`);
  await ready(page);
  const editor = page.getByRole('textbox', { name: '编辑关卡 C++ 代码', exact: true });
  await expect(editor).toBeEditable();
  await editor.fill(q.solutionSource);
  await page.getByRole('button', { name: '提交全部4组', exact: true }).click();
  await expect(page.getByTestId('memory-bug-session')).toHaveAttribute('data-save-state', 'saved');
  await page.goto('/#/reviews');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-review-storage-status', 'ready');
  await expect(page.getByTestId('review-counts')).toHaveText('到期 1 · 未到期 0 · 暂停 0');
  await page.locator('[data-review-rating="good"]').click();
  await expect(page.getByTestId('review-counts')).toHaveText('到期 0 · 未到期 1 · 暂停 0');
  const before = await native(page),
    physicalBefore = await physical(page);
  expect(physicalBefore.version).toBe(5);
  expect(Object.keys(physicalBefore.stores)).toHaveLength(14);
  expect(before.receipts.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(2);
  test.info().annotations.push({
    type: 'historical-intermediate-and-current-reset',
    description:
      'Original migration assertions run against existing .artifacts/16.1/legacy34-dist; then actual formal73 DB10 RESET and genuine fresh C6 learning are independently verified.',
  });
  const historicalSuccessor = await archivedMigrationSuccessor(
    page,
    '.artifacts/16.1/legacy34-dist',
  );
  await mkdir('.artifacts/15.4', { recursive: true });
  await writeFile(`.artifacts/15.4/migration-switch-${label}`, 'actual successor switch\n', {
    flag: 'wx',
  });
  await page.goto('/#/achievements');
  await page.reload();
  await achievementReady(page);
  const after = await native(page),
    physicalAfter = await physical(page);
  expect(physicalAfter.version).toBe(6);
  expect(Object.keys(physicalAfter.stores)).toHaveLength(15);
  expect(after.meta.generation).toBe(before.meta.generation);
  for (const key of Object.keys(before) as (keyof typeof before)[])
    if (key !== 'meta') expect(after[key]).toEqual(before[key]);
  for (const name of Object.keys(physicalBefore.stores))
    if (name !== 'meta') expect(physicalAfter.stores[name]).toEqual(physicalBefore.stores[name]);
  expect(after.achievements).toHaveLength(2);
  expect(after.achievements.find((r) => r.badgeRef.id === 'badge.c.bubble-pass')?.unlockedAt).toBe(
    '2026-10-31T04:00:00.000Z',
  );
  expect(
    after.achievements.find((r) => r.badgeRef.id === 'badge.cpp.pointer-repair')?.unlockedAt,
  ).toBeNull();
  await expect(page.getByTestId('achievement-total')).toHaveText('1 / 3');
  await writeFile(
    `.artifacts/15.4/migration-${label}.json`,
    JSON.stringify(
      {
        actualPredecessor: true,
        predecessor: '1.0.29',
        before,
        after,
        physicalBefore,
        physicalAfter,
      },
      null,
      2,
    ),
  );
  await page.reload();
  await achievementReady(page);
  expect((await native(page)).achievements).toEqual(after.achievements);
  await historicalSuccessor.dispose();
  const currentReset = await verifyCurrentResetAfterMigration(page, after);
  await writeFile(
    `.artifacts/21.6/migration-${label}-achievement.json`,
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
