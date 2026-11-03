import {
  archivedMigrationSuccessor,
  verifyCurrentResetAfterMigration,
} from './migration-current-reset';
import { writeFile, mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { archive, openAnswer, submit } from './notebook-helpers';
const label = process.env.TASK_EVIDENCE_LABEL ?? 'local';
test('15.2 actual25 DB3 genuine progress, rewards and history migrate intact into successor DB4 and empty marks', async ({
  page,
}) => {
  await page.goto('/#/lessons/lesson.c.variables-output');
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  await page.getByRole('button', { name: '开始本节学习', exact: true }).click();
  await page.getByRole('button', { name: '确认已学习', exact: true }).click();
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
  await openAnswer(page, 'exercise.c.echo');
  await submit(page);
  const before = await archive(page);
  const physicalBefore = await page.evaluate(async () => {
    const d = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    const out = { version: d.version, stores: Array.from(d.objectStoreNames) };
    d.close();
    return out;
  });
  expect(physicalBefore.version).toBe(3);
  expect(before.progress.some((r) => r.eventType === 'lesson.completed')).toBe(true);
  test.info().annotations.push({
    type: 'historical-intermediate-and-current-reset',
    description:
      'Original migration assertions run against existing .artifacts/15.3/legacy27-dist; then actual formal73 DB10 RESET and genuine fresh C6 learning are independently verified.',
  });
  const historicalSuccessor = await archivedMigrationSuccessor(
    page,
    '.artifacts/15.3/legacy27-dist',
  );
  await mkdir('.artifacts/15.2', { recursive: true });
  await writeFile(`.artifacts/15.2/migration-switch-${label}`, 'actual successor switch\n', {
    flag: 'wx',
  });
  await page.goto('/#/notebook');
  await page.reload();
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  await expect(page.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
  const after = await archive(page);
  expect(after.meta).toMatchObject({
    schemaVersion: '4.0.0',
    dbVersion: 4,
    generation: before.meta.generation,
  });
  for (const key of Object.keys(before) as (keyof typeof before)[])
    if (key !== 'meta') expect(after[key]).toEqual(before[key]);
  expect((after as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks).toEqual([]);
  await page.goto('/#/');
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('4 / 10 已点亮');
  await writeFile(
    `.artifacts/15.2/migration-${label}.json`,
    JSON.stringify({ actualPredecessor: true, physicalBefore, before, after }, null, 2),
  );
  await historicalSuccessor.dispose();
  const currentReset = await verifyCurrentResetAfterMigration(page, after);
  await writeFile(
    `.artifacts/21.6/migration-${label}-notebook.json`,
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
