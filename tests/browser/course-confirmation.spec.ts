import { expect, test } from '@playwright/test';
import { routeHistoricalApp } from './legacy-app';
import { currentSnapshot } from './current-practice-observation';
import { verifyCurrentResetAfterMigration } from './migration-current-reset';

test('retry preserves an initial confirmation when its separate start transaction fails', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    let armed = false;
    Object.assign(window, {
      armStartFailure: () => {
        armed = true;
      },
    });
    for (const name of ['add', 'put'] as const) {
      const original = IDBObjectStore.prototype[name];
      IDBObjectStore.prototype[name] = function (value, key) {
        if (
          armed &&
          this.name === 'progress' &&
          (value as { eventType?: string })?.eventType === 'lesson.started'
        ) {
          armed = false;
          throw new DOMException('Isolated first start transaction fault', 'QuotaExceededError');
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      };
    }
  });
  const read = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const q = indexedDB.open('c-viz-learning');
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      try {
        const tx = db.transaction(['progress', 'receipts', 'ledger', 'dailyFacts'], 'readonly');
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        const values = await Promise.all(
          ['progress', 'receipts', 'ledger', 'dailyFacts'].map(
            (name) =>
              new Promise<unknown[]>((resolve, reject) => {
                const q = tx.objectStore(name).getAll();
                q.onsuccess = () => resolve(q.result);
                q.onerror = () => reject(q.error);
              }),
          ),
        );
        await done;
        return {
          progress: values[0] as { eventType: string }[],
          receipts: values[1] as { eventId: string; eventType: string; occurredAt: string }[],
          ledger: values[2],
          dailyFacts: values[3],
        };
      } finally {
        db.close();
      }
    });
  testInfo.annotations.push({
    type: 'historical-confirmation-and-current-reset',
    description:
      'Original separate-start recovery runs on the actual pre-RESET app; the current app must then clear that history and persist genuine new-book learning.',
  });
  await routeHistoricalApp(page, new URL(String(testInfo.project.use.baseURL)).origin);
  await page.route('**/content/course/course-bundle-*.json', (r) =>
    r.fulfill({ status: 404, body: 'Original six-course fallback for genuine historical input' }),
  );
  await page.goto('/#/lessons/lesson.c.variables-output');
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  await page.evaluate(() => (window as unknown as { armStartFailure(): void }).armStartFailure());
  await page.getByRole('button', { name: '确认已学习', exact: true }).click();
  const status = page.getByTestId('learning-save-status');
  await expect(status).toHaveAttribute('data-save-status', 'unsaved');
  await expect(status).toContainText('未保存');
  await expect(page.getByTestId('lesson-progress')).toContainText('已确认学习');
  await expect(page.getByTestId('lesson-progress')).toContainText('尚未保存');
  const partial = await read();
  expect(partial.progress.map((row) => row.eventType)).toEqual(['lesson.study-confirmed']);
  expect(partial.receipts.map((row) => row.eventType)).toEqual(['lesson.study-confirmed']);
  await status.getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await expect(status).toHaveAttribute('data-save-status', 'ready');
  await expect(status.getByText('已保存', { exact: true })).toBeVisible();
  await expect(page.getByTestId('lesson-progress')).toContainText('已确认学习');
  await expect(page.getByTestId('lesson-progress')).not.toContainText('尚未保存');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const retried = await read();
  expect(retried.progress.map((row) => row.eventType).sort()).toEqual([
    'lesson.started',
    'lesson.study-confirmed',
  ]);
  expect(retried.receipts.map((row) => row.eventType).sort()).toEqual([
    'lesson.started',
    'lesson.study-confirmed',
  ]);
  expect(retried.receipts.find((row) => row.eventType === 'lesson.study-confirmed')).toEqual(
    partial.receipts[0],
  );
  expect(retried.ledger).toEqual([]);
  expect(retried.dailyFacts).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('lesson-progress')).toContainText('已确认学习');
  expect(await read()).toEqual(retried);
  await testInfo.attach('initial-confirmation-partial-save-recovery', {
    body: JSON.stringify({
      scope:
        'Only first native start write is faulted. Confirmation is a real user action; ordinary retry preserves both original facts, with no exercise judgement or reward.',
      partial,
      retried,
    }),
    contentType: 'application/json',
  });
  const historical = await currentSnapshot(page);
  await page.unrouteAll();
  const current = await verifyCurrentResetAfterMigration(page, historical);
  await testInfo.attach('actual-current-reset-and-fresh-learning', {
    body: JSON.stringify(current),
    contentType: 'application/json',
  });
});
