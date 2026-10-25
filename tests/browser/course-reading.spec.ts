import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { StorageSnapshot } from '../../web/src/storage/model';
import type { LessonEntity, ProgramEntity } from '../../web/src/content/types';

// These are independent expectations from the already reviewed 09.1 source.
// The production page must fetch only the separate approved reading release.
const reviewed = JSON.parse(
  readFileSync(new URL('../../content/c/p0/course-1.0.1.json', import.meta.url), 'utf8'),
) as {
  chapters: { id: string; title: string }[];
  lessons: LessonEntity[];
  programs: ProgramEntity[];
};
const first = reviewed.lessons[0];
const second = reviewed.lessons[1];
const resource = '**/content/reading/course-reading-1.0.0.json';
const lessonPath = (id: string) => `/#/lessons/${encodeURIComponent(id)}`;

/** Native, read-only inspection of the same origin's actual production archive. */
async function productionSnapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const transaction = db.transaction(names, 'readonly');
      const complete = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const data = Object.fromEntries(
        await Promise.all(
          names.map(async (name) => {
            const singleton = ['meta', 'settings', 'avatar', 'appearance'].includes(name);
            const result = await new Promise<unknown>((resolve, reject) => {
              const request = singleton
                ? transaction.objectStore(name).get('current')
                : transaction.objectStore(name).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return [name, result];
          }),
        ),
      );
      await complete;
      return data as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}

async function localReady(page: Page) {
  await expect(page.getByTestId('learning-save-status')).not.toHaveAttribute(
    'data-save-status',
    'loading',
  );
}

async function openLesson(page: Page, id = first.id) {
  await page.goto(lessonPath(id));
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await localReady(page);
}

async function saved(page: Page) {
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  await expect(
    page.getByTestId('learning-save-status').getByText('已保存', { exact: true }),
  ).toBeVisible();
}

async function start(page: Page) {
  await page.getByRole('button', { name: '开始本节学习', exact: true }).click();
  await expect(page.getByTestId('lesson-progress')).toContainText('已开始');
  await saved(page);
}

async function confirm(page: Page) {
  await page.getByRole('button', { name: '确认已学习', exact: true }).click();
  await expect(page.getByTestId('lesson-progress')).toContainText('已确认学习');
  await saved(page);
}

function readingOnly(snapshot: StorageSnapshot) {
  expect(
    snapshot.progress.every((row) =>
      ['lesson.started', 'lesson.study-confirmed'].includes(row.eventType),
    ),
  ).toBe(true);
  expect(
    snapshot.receipts.every((row) =>
      ['lesson.started', 'lesson.study-confirmed'].includes(row.eventType),
    ),
  ).toBe(true);
  expect(snapshot.ledger).toEqual([]);
  expect(snapshot.dailyFacts).toEqual([]);
}

test('the production reading release exposes three chapters and six complete reviewed lessons without recording passive browsing', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/#/courses');
  await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  const before = await productionSnapshot(page);
  await expect(page.locator('[data-course-lesson]')).toHaveCount(6);
  for (const chapter of reviewed.chapters) {
    await expect(page.getByRole('heading', { name: chapter.title, exact: true })).toBeVisible();
  }
  for (const lesson of reviewed.lessons) {
    await expect(page.locator(`[data-course-lesson="${lesson.id}"]`)).toContainText('未开始');
  }

  let checkedFences = 0;
  for (const lesson of reviewed.lessons) {
    await openLesson(page, lesson.id);
    const reading = page.getByTestId('lesson-reading');
    await expect(page.getByRole('heading', { name: lesson.title, exact: true })).toBeVisible();
    await expect(reading).toContainText(lesson.teaching.explanation.split('\n\n')[0]);
    for (const text of [
      ...lesson.teaching.objectives,
      ...lesson.teaching.commonMistakes,
      ...lesson.teaching.boundaryNotes,
    ]) {
      await expect(reading).toContainText(text);
    }
    const code = await reading.locator('pre').allTextContents();
    for (const match of lesson.teaching.explanation.matchAll(/```c\r?\n([\s\S]*?)```/g)) {
      expect(code.some((text) => text.trim() === match[1].trim())).toBe(true);
      checkedFences++;
    }
    for (const ref of lesson.teaching.exampleProgramRefs) {
      const program = reviewed.programs.find(
        (item) => item.id === ref.id && item.version === ref.version,
      )!;
      expect(code.some((text) => text.trim() === program.sourceExample.trim())).toBe(true);
    }
    await expect(reading.locator('textarea:not([readonly]), [contenteditable="true"]')).toHaveCount(
      0,
    );
    await expect(page.getByTestId('lesson-progress')).toContainText('未开始');
  }
  expect(checkedFences).toBe(11);
  expect(await productionSnapshot(page)).toEqual(before);
  expect(requests.some((url) => new URL(url).pathname.endsWith('/course-reading-1.0.0.json'))).toBe(
    true,
  );
  expect(requests.some((url) => new URL(url).pathname.endsWith('/course-1.0.1.json'))).toBe(false);
  await testInfo.attach('reviewed-reading-production-scope', {
    body: JSON.stringify({ chapters: 3, lessons: 6, originalCodeFences: checkedFences, requests }),
    contentType: 'application/json',
  });
});

test('explicit start and study confirmation persist once through refresh and reopening, with no exercise pass or reward', async ({
  page,
  context,
}, testInfo) => {
  await openLesson(page);
  await start(page);
  const started = await productionSnapshot(page);
  expect(started.progress).toHaveLength(1);
  expect(started.receipts).toHaveLength(1);
  expect(started.progress[0]).toMatchObject({
    eventType: 'lesson.started',
    subjectRef: { id: first.id, version: first.version },
  });
  await page.reload();
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('lesson-progress')).toContainText('已开始');
  await localReady(page);
  expect(await productionSnapshot(page)).toEqual(started);

  const startAgain = page.getByRole('button', { name: '开始本节学习', exact: true });
  if (await startAgain.isEnabled()) {
    await startAgain.click();
    await localReady(page);
    expect(await productionSnapshot(page)).toEqual(started);
  }
  await confirm(page);
  const confirmed = await productionSnapshot(page);
  expect(confirmed.progress).toHaveLength(2);
  expect(confirmed.receipts).toHaveLength(2);
  readingOnly(confirmed);
  await expect(page.getByRole('button', { name: '确认已学习', exact: true })).toBeDisabled();
  await expect(page.getByTestId('lesson-progress')).not.toContainText('小节已完成');
  await page.reload();
  await expect(page.getByTestId('lesson-progress')).toContainText('已确认学习');
  await localReady(page);
  expect(await productionSnapshot(page)).toEqual(confirmed);
  await page.close();
  const reopened = await context.newPage();
  await openLesson(reopened);
  await expect(reopened.getByTestId('lesson-progress')).toContainText('已确认学习');
  expect(await productionSnapshot(reopened)).toEqual(confirmed);
  await expect(reopened.getByRole('link', { name: /复习/ }).first()).toBeVisible();
  await testInfo.attach('real-reading-native-idb', {
    body: JSON.stringify({
      evidenceKind: 'actual production UI reading actions',
      started,
      confirmed,
    }),
    contentType: 'application/json',
  });
});

test('confirming an untouched lesson creates only its start and study-confirmed facts', async ({
  page,
}) => {
  await openLesson(page, second.id);
  await confirm(page);
  const snapshot = await productionSnapshot(page);
  expect(snapshot.progress).toHaveLength(2);
  expect(snapshot.receipts).toHaveLength(2);
  expect(snapshot.progress.map((row) => row.eventType).sort()).toEqual([
    'lesson.started',
    'lesson.study-confirmed',
  ]);
  expect(snapshot.progress.every((row) => row.subjectRef.id === second.id)).toBe(true);
  readingOnly(snapshot);
});

test('continue learning follows the most recent explicit lesson activity and keeps each lesson independent', async ({
  page,
}) => {
  await openLesson(page);
  await confirm(page);
  await openLesson(page, second.id);
  await expect(page.getByTestId('lesson-progress')).toContainText('未开始');
  const firstOnly = await productionSnapshot(page);
  await page.goto('/#/courses');
  await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  await expect(page.getByRole('link', { name: '继续学习', exact: true })).toHaveAttribute(
    'href',
    `#/lessons/${first.id}`,
  );
  await expect(page.locator(`[data-course-lesson="${first.id}"]`)).toContainText('已确认学习');
  await expect(page.locator(`[data-course-lesson="${second.id}"]`)).toContainText('未开始');
  expect(await productionSnapshot(page)).toEqual(firstOnly);

  await openLesson(page, second.id);
  await start(page);
  const both = await productionSnapshot(page);
  expect(both.progress.filter((row) => row.subjectRef.id === first.id)).toEqual(firstOnly.progress);
  expect(both.progress.filter((row) => row.subjectRef.id === second.id)).toHaveLength(1);
  readingOnly(both);
  for (const route of ['/#/courses', '/#/']) {
    await page.goto(route);
    await localReady(page);
    await expect(page.getByRole('link', { name: '继续学习', exact: true })).toHaveAttribute(
      'href',
      `#/lessons/${second.id}`,
    );
  }
  await page.getByRole('link', { name: '继续学习', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/lessons/${second.id}$`));
  await expect(page.getByTestId('lesson-progress')).toContainText('已开始');
  expect(await productionSnapshot(page)).toEqual(both);
});

test('a missing reading resource fails closed without learning writes and its visible retry recovers', async ({
  page,
}, testInfo) => {
  await page.goto('/#/settings?panel=display');
  await localReady(page);
  const before = await productionSnapshot(page);
  await page.route(resource, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"missing"}' }),
  );
  await page.goto(lessonPath(first.id));
  // Hash navigation keeps the already verified app resource in memory; reload exercises a fresh failed fetch.
  await page.reload();
  const reading = page.getByTestId('lesson-reading');
  await expect(reading).toHaveAttribute('data-state', 'failed');
  for (const name of ['开始本节学习', '确认已学习']) {
    const action = page.getByRole('button', { name, exact: true });
    if (await action.count()) await expect(action).toBeDisabled();
  }
  await localReady(page);
  expect(await productionSnapshot(page)).toEqual(before);
  await page.unroute(resource);
  await reading.getByRole('button', { name: /重试/ }).click();
  await expect(reading).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('lesson-progress')).toContainText('未开始');
  expect(await productionSnapshot(page)).toEqual(before);
  await start(page);
  readingOnly(await productionSnapshot(page));
  await testInfo.attach('missing-resource-fault-scope', {
    body: 'Only the approved reading JSON request received an isolated HTTP 404. Recovery used the normal production resource and visible retry; no teaching result or persisted learning record was injected.',
    contentType: 'text/plain',
  });
});

test('clearing in another production page invalidates the open lesson without reviving old facts until a fresh action', async ({
  page,
  context,
}) => {
  await openLesson(page);
  await confirm(page);
  const learned = await productionSnapshot(page);
  const settings = await context.newPage();
  await settings.goto('/#/settings?panel=data');
  await localReady(settings);
  await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await settings
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(settings.getByTestId('learning-save-status')).toContainText('本地数据已清除');
  await expect(page.getByTestId('lesson-progress')).toContainText('未开始');
  const cleared = await productionSnapshot(page);
  expect(cleared.meta.generation).not.toBe(learned.meta.generation);
  expect(cleared.progress).toEqual([]);
  expect(cleared.receipts).toEqual([]);
  readingOnly(cleared);
  await page.waitForTimeout(650);
  expect(await productionSnapshot(page)).toEqual(cleared);
  await page.reload();
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('lesson-progress')).toContainText('未开始');
  await localReady(page);
  expect(await productionSnapshot(page)).toEqual(cleared);
  await start(page);
  const restarted = await productionSnapshot(page);
  expect(restarted.meta.generation).toBe(cleared.meta.generation);
  expect(restarted.progress).toHaveLength(1);
  expect(restarted.receipts).toHaveLength(1);
  expect(restarted.receipts[0].eventId).not.toBe(learned.receipts[0].eventId);
  readingOnly(restarted);
});

test('a native reading write failure is visibly unsaved and retry saves the same pending start once', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    let fail = false;
    Object.assign(window, {
      failNextReadingSave: () => {
        fail = true;
      },
    });
    for (const method of ['add', 'put'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (value, key) {
        if (fail && this.name === 'progress') {
          fail = false;
          throw new DOMException('Isolated reading save fault', 'QuotaExceededError');
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      };
    }
  });
  await openLesson(page);
  const before = await productionSnapshot(page);
  await page.evaluate(() =>
    (window as unknown as { failNextReadingSave(): void }).failNextReadingSave(),
  );
  await page.getByRole('button', { name: '开始本节学习', exact: true }).click();
  const status = page.getByTestId('learning-save-status');
  await expect(status).toHaveAttribute('data-save-status', 'unsaved');
  await expect(status).toContainText('未保存');
  const failed = await productionSnapshot(page);
  expect(failed.progress).toEqual(before.progress);
  expect(failed.receipts).toEqual(before.receipts);
  expect(failed.ledger).toEqual(before.ledger);
  await status.getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await saved(page);
  await expect(page.getByTestId('lesson-progress')).toContainText('已开始');
  const retried = await productionSnapshot(page);
  expect(retried.progress).toHaveLength(1);
  expect(retried.receipts).toHaveLength(1);
  readingOnly(retried);
  await page.reload();
  await expect(page.getByTestId('lesson-progress')).toContainText('已开始');
  await localReady(page);
  expect(await productionSnapshot(page)).toEqual(retried);
  await testInfo.attach('native-reading-save-fault-scope', {
    body: 'QuotaExceededError was injected only at the next native progress add/put. This checks atomic rollback, the unsaved acknowledgment and the ordinary pending-event retry, not actual disk exhaustion or private-browser limits.',
    contentType: 'text/plain',
  });
});

test('explicitly seeded compatible historical passes are displayed as completed, while old versions remain unfinished and refresh creates no completion fact', async ({
  page,
}, testInfo) => {
  await openLesson(page);
  await confirm(page);
  const base = await productionSnapshot(page);
  const exerciseId = first.requiredExerciseRefs[0].id;
  const seedHistoricalPass = async (version: string) => {
    await page.evaluate(
      async ({ id, version, packageRef, at }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('c-viz-learning');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const tx = db.transaction(['meta', 'progress'], 'readwrite');
          const done = new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
          const meta = tx.objectStore('meta').get('current');
          meta.onsuccess = () => {
            const value = meta.result as StorageSnapshot['meta'];
            tx.objectStore('progress').put(
              {
                eventType: 'exercise.passed',
                result: 'passed',
                subjectRef: { id, version },
                packageRef,
                learningRevision: 1,
                firstAt: at,
                lastAt: at,
              },
              [value.generation, 'exercise.passed', id, version, 1],
            );
            tx.objectStore('meta').put({ ...value, revision: value.revision + 1 }, 'current');
          };
          await done;
        } finally {
          db.close();
        }
      },
      {
        id: exerciseId,
        version,
        packageRef: { id: 'content.c.p0', version: '1.0.1' },
        at: base.progress[0].firstAt,
      },
    );
  };
  await seedHistoricalPass('1.0.0');
  await page.reload();
  await expect(page.getByTestId('lesson-progress')).toContainText('已确认学习');
  await expect(page.getByTestId('lesson-progress')).not.toContainText('小节已完成');
  await seedHistoricalPass('1.0.1');
  const seeded = await productionSnapshot(page);
  await page.reload();
  await expect(page.getByTestId('lesson-progress')).toContainText('小节已完成');
  await expect(page.getByRole('link', { name: '复习本节', exact: true })).toBeVisible();
  expect(await productionSnapshot(page)).toEqual(seeded);
  expect(seeded.receipts.map((row) => row.eventType).sort()).toEqual([
    'lesson.started',
    'lesson.study-confirmed',
  ]);
  await page.getByRole('link', { name: '复习本节', exact: true }).click();
  expect(await productionSnapshot(page)).toEqual(seeded);
  await page.screenshot({
    path: testInfo.outputPath('completed-historical-reading.png'),
    fullPage: false,
  });
  await testInfo.attach('historical-projection-scope', {
    body: 'Only this isolated browser profile was explicitly seeded with old/current historical exercise.passed rows to exercise completion compatibility rendering. These rows are synthetic history, not evidence of real exercise judgement. Production generated only the two actual reading actions; reload and review generated no completion event or reward.',
    contentType: 'text/plain',
  });
});
