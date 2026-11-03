import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { StorageSnapshot } from '../../web/src/storage/model';
import type { C6TeachingNode } from '../../web/src/content/c6-teaching-types';

const source = JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
  chapters: { nodes: C6TeachingNode[] }[];
};
const nodes = source.chapters.flatMap((c) => c.nodes);
const first = 'lesson.c6.s2.1',
  second = 'lesson.c6.s3.2';
const path = (id: string) => '/#/lessons/' + id;
const snapshot = productionSnapshot;
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-reading-status', 'ready');
}
async function open(page: Page, id = first) {
  await page.goto(path(id));
  await expect(page.locator('.c6-teaching-reading')).toBeVisible();
  await localReady(page);
}
async function confirm(page: Page) {
  await page.getByRole('button', { name: '我已读完本节', exact: true }).click();
  await expect(page.getByRole('button', { name: '已确认阅读', exact: true })).toBeDisabled();
  await localReady(page);
}
function partialRead(s: StorageSnapshot, id: string) {
  expect(
    s.progress
      .filter((p) => p.subjectRef.id === id)
      .map((p) => p.eventType)
      .sort(),
  ).toEqual(['lesson.study-confirmed']);
  expect(
    s.progress.some((p) => p.eventType === 'exercise.passed' || p.eventType === 'lesson.completed'),
  ).toBe(false);
  expect(s.ledger).toEqual([]);
  expect(s.dailyFacts).toEqual([]);
}

test('the production reading release exposes three chapters and six complete reviewed lessons without recording passive browsing', async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/#/courses');
  await localReady(page);
  await expect(page.getByRole('region', { name: '正文章节' }).getByRole('link')).toHaveCount(17);
  await expect(page.getByRole('region', { name: '参考资料' }).getByRole('link')).toHaveCount(2);
  const before = await snapshot(page);
  let fences = 0;
  for (const id of ['c6.s2.1', 'c6.s14.3.1', 'c6.appB']) {
    const node = nodes.find((n) => n.sourceNodeId === id)!;
    await page.goto(id === 'c6.appB' ? '/#/courses/' + id : path('lesson.' + id));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(node.titleDisplay);
    const reading = page.locator('.c6-teaching-reading');
    await expect(reading).toBeVisible();
    const code = await reading.locator('pre code').allTextContents();
    for (const match of node.body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
      expect(code.some((s) => s.trim() === match[1].trim())).toBe(true);
      fences++;
    }
    await expect(reading.locator('textarea,[contenteditable="true"]')).toHaveCount(0);
    if (id === 'c6.appB')
      await expect(page.getByRole('button', { name: '我已读完本节', exact: true })).toHaveCount(0);
  }
  expect(fences).toBeGreaterThan(0);
  expect(await snapshot(page)).toEqual(before);
  expect(requests.some((u) => u.includes('/primer6-teaching/'))).toBe(true);
  expect(requests.some((u) => /\/content\/(reading|course|review)\//.test(u))).toBe(false);
  await info.attach('current-book-passive-reading', {
    body: JSON.stringify({ chapters: 17, lessons: 404, references: 2, fences, before, requests }),
    contentType: 'application/json',
  });
});

test('explicit start and study confirmation persist once through refresh and reopening, with no exercise pass or reward', async ({
  page,
  context,
}, info) => {
  await open(page);
  const before = await snapshot(page);
  expect(before.progress).toEqual([]);
  await confirm(page);
  const saved = await snapshot(page);
  partialRead(saved, first);
  expect(saved.receipts.filter((r) => r.eventType === 'lesson.study-confirmed')).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: '已确认阅读', exact: true })).toBeDisabled();
  await localReady(page);
  expect(await snapshot(page)).toEqual(saved);
  await page.close();
  const reopened = await context.newPage();
  await open(reopened);
  await expect(reopened.getByRole('button', { name: '已确认阅读', exact: true })).toBeDisabled();
  expect(await snapshot(reopened)).toEqual(saved);
  await expect(
    reopened.getByRole('link', { name: '完成配套执行练习', exact: true }),
  ).toHaveAttribute('href', '#/practice/exercise.c6.s2.1');
  await info.attach('actual-current-reading', {
    body: JSON.stringify({ before, saved }),
    contentType: 'application/json',
  });
});

test('confirming an untouched lesson creates only its start and study-confirmed facts', async ({
  page,
}) => {
  await open(page, 'lesson.c6.s1.1');
  await confirm(page);
  const saved = await snapshot(page);
  expect(saved.progress.map((p) => p.eventType).sort()).toEqual([
    'lesson.completed',
    'lesson.study-confirmed',
  ]);
  expect(
    saved.progress.every(
      (p) => p.subjectRef.id === 'lesson.c6.s1.1' && p.subjectRef.version === '2.0.0',
    ),
  ).toBe(true);
  expect(saved.progress.some((p) => p.eventType === 'exercise.passed')).toBe(false);
  expect(saved.ledger).toEqual([]);
  await expect(page.getByRole('heading', { name: '本节已完成', exact: true })).toBeVisible();
});

test('continue learning follows the most recent explicit lesson activity and keeps each lesson independent', async ({
  page,
}) => {
  await open(page);
  await confirm(page);
  const before = await snapshot(page);
  await open(page, second);
  expect(await snapshot(page)).toEqual(before);
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: '继续阅读', exact: true })).toHaveAttribute(
    'href',
    '#/lessons/' + first,
  );
  await open(page, second);
  await confirm(page);
  const after = await snapshot(page);
  expect(after.progress.filter((p) => p.subjectRef.id === first)).toEqual(before.progress);
  expect(
    after.progress
      .filter((p) => p.subjectRef.id === second)
      .map((p) => p.eventType)
      .sort(),
  ).toEqual(['lesson.study-confirmed']);
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: '继续阅读', exact: true })).toHaveAttribute(
    'href',
    '#/lessons/' + second,
  );
  await page.getByRole('link', { name: '继续阅读', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('#/lessons/' + second + '$'));
  expect((await snapshot(page)).ledger).toEqual([]);
});

test('a missing reading resource fails closed without learning writes and its visible retry recovers', async ({
  page,
}, info) => {
  await page.goto('/#/courses');
  await localReady(page);
  const before = await snapshot(page);
  const resource = '**/content/c/primer6-teaching/ch02-2.0.0.json';
  await page.route(resource, (r) =>
    r.fulfill({ status: 404, body: 'Isolated chapter unavailable' }),
  );
  await page.goto(path(first));
  await expect(page.getByRole('heading', { name: '本节内容读取失败', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '我已读完本节', exact: true })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await page.unroute(resource);
  await page.getByRole('button', { name: '重试本节', exact: true }).click();
  await expect(page.locator('.c6-teaching-reading')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await confirm(page);
  partialRead(await snapshot(page), first);
  await info.attach('chapter-failure-scope', {
    body: 'Only the real ch02 HTTP request failed. No execution, learning DTO or stored pass was supplied.',
    contentType: 'text/plain',
  });
});

test('clearing in another production page invalidates the open lesson without reviving old facts until a fresh action', async ({
  page,
  context,
}) => {
  await open(page);
  await confirm(page);
  const old = await snapshot(page);
  const peer = await context.newPage();
  await peer.goto('/#/settings?panel=data');
  await localReady(peer);
  await peer.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await peer.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).meta.generation)
    .not.toBe(old.meta.generation);
  await expect(page.getByRole('button', { name: '我已读完本节', exact: true })).toBeEnabled();
  const cleared = await snapshot(page);
  expect(cleared.progress).toEqual([]);
  expect(cleared.receipts).toEqual([]);
  expect(cleared.ledger).toEqual([]);
  await confirm(page);
  const fresh = await snapshot(page);
  partialRead(fresh, first);
  expect(fresh.meta.generation).toBe(cleared.meta.generation);
  expect(fresh.receipts.every((r) => !old.receipts.some((p) => p.eventId === r.eventId))).toBe(
    true,
  );
});

test('a native reading write failure is visibly unsaved and retry saves the same pending start once', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const control = { armed: false, ids: [] as string[] };
    Object.assign(window, { currentReadingQuota: control });
    for (const method of ['put', 'add'] as const) {
      const native = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (value, key) {
        const r = value as { eventId?: string; eventType?: string };
        if (this.name === 'receipts' && r.eventType === 'lesson.study-confirmed')
          control.ids.push(r.eventId!);
        if (control.armed && this.name === 'courseActivities') {
          control.armed = false;
          throw new DOMException('21.6 current reading activity quota', 'QuotaExceededError');
        }
        return key === undefined ? native.call(this, value) : native.call(this, value, key);
      };
    }
  });
  await open(page);
  const before = await snapshot(page);
  await page.evaluate(() => {
    (window as unknown as { currentReadingQuota: { armed: boolean } }).currentReadingQuota.armed =
      true;
  });
  await page.getByRole('button', { name: '我已读完本节', exact: true }).click();
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'unsaved',
  );
  const failed = await snapshot(page);
  expect(failed.progress).toEqual(before.progress);
  expect(failed.receipts).toEqual(before.receipts);
  expect(failed.ledger).toEqual(before.ledger);
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重试未保存操作', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '已确认阅读', exact: true })).toBeDisabled();
  await localReady(page);
  await expect(page.locator('.c6-reading-confirmation').getByRole('alert')).toHaveCount(0);
  const saved = await snapshot(page);
  partialRead(saved, first);
  const ids = await page.evaluate(
    () => (window as unknown as { currentReadingQuota: { ids: string[] } }).currentReadingQuota.ids,
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(1);
  expect(saved.receipts.filter((r) => r.eventId === ids[0])).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: '已确认阅读', exact: true })).toBeDisabled();
  expect((await snapshot(page)).progress).toEqual(saved.progress);
  await info.attach('native-current-reading-quota', {
    body: JSON.stringify({ before, failed, saved, ids }),
    contentType: 'application/json',
  });
});

test('explicitly seeded compatible historical passes are displayed as completed, while old versions remain unfinished and refresh creates no completion fact', async ({
  page,
}, info) => {
  await open(page);
  await confirm(page);
  const before = await snapshot(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['meta', 'progress'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        const r = tx.objectStore('meta').get('current');
        r.onsuccess = () => {
          const meta = r.result;
          const at = new Date().toISOString();
          tx.objectStore('progress').put(
            {
              eventType: 'exercise.passed',
              result: 'passed',
              subjectRef: { id: 'exercise.c.echo', version: '1.1.0' },
              packageRef: { id: 'content.c.p05', version: '1.0.0' },
              learningRevision: 1,
              firstAt: at,
              lastAt: at,
            },
            [meta.generation, 'exercise.passed', 'exercise.c.echo', '1.1.0', 1],
          );
          tx.objectStore('meta').put({ ...meta, revision: meta.revision + 1 }, 'current');
        };
      });
    } finally {
      db.close();
    }
  });
  const corrupted = await snapshot(page);
  await page.reload();
  await expect(page.getByRole('button', { name: '我已读完本节', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: '本节已完成', exact: true })).toHaveCount(0);
  expect((await snapshot(page)).progress).toEqual(corrupted.progress);
  expect((await snapshot(page)).ledger).toEqual(before.ledger);
  await page.goto('/#/settings?panel=data');
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).meta.generation)
    .not.toBe(before.meta.generation);
  await open(page);
  await expect(page.getByRole('button', { name: '我已读完本节', exact: true })).toBeEnabled();
  const recovered = await snapshot(page);
  expect(recovered.progress).toEqual([]);
  expect(recovered.ledger).toEqual([]);
  await info.attach('synthetic-corruption-not-real-pass', {
    body: JSON.stringify({
      scope: 'Isolated QA corruption only; never evidence of execution or historical migration',
      before,
      corrupted,
      recovered,
    }),
    contentType: 'application/json',
  });
});
