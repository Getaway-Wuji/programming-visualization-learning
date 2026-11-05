import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
import {
  folder,
  status,
  native,
  reviewReady,
  reviews,
  markCurrent as mark,
  changePrint,
  fail,
  capture,
  sameLearning,
  quota,
  arm,
  clear,
  submit,
  ready,
  panel,
  observeCaseSetExecution,
} from './scheduler-helpers';
import { openIndependentRepair as openAnswer } from './current-course-helpers';
test.use({ timezoneId: 'Asia/Shanghai' });
test.beforeAll(() => mkdir(folder, { recursive: true }));
test('15.3 common empty or unreviewed queue states are honest and never create a learning fact', async ({
  page,
}) => {
  await reviews(page);
  await expect(
    page.getByRole('heading', { level: 1, name: '今日复习', exact: true }),
  ).toBeVisible();
  if (!p05CourseRelease.registered) {
    await expect(page.getByTestId('review-unknown')).toBeVisible();
    await expect(page.getByTestId('review-empty')).toHaveCount(0);
    return;
  }
  await reviewReady(page);
  await expect(page.getByTestId('review-empty')).toBeVisible();
  const before = await native(page);
  await page.reload();
  await reviewReady(page);
  expect(await native(page)).toEqual(before);
  await page.goto('/#/');
  await reviewReady(page);
  await page.goto('/#/reviews');
  await expect(page).toHaveURL(/#\/notebook$/);
  await expect(page.getByRole('heading', { name: '错题与陌生点', exact: true })).toBeVisible();
  expect((await native(page)).reviewCards).toEqual([]);
  await reviews(page);
  await expect(page.getByTestId('review-empty')).toBeVisible();
  sameLearning(before, await native(page));
});
test('15.3 common queue entry and three widths stay usable without fabricated cards', async ({
  page,
}) => {
  await reviews(page);
  await expect(
    page.getByRole('heading', { level: 1, name: '今日复习', exact: true }),
  ).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${folder}/empty-${width}.png`, fullPage: true });
  }
});
test('15.3 formal genuine manual source, duplicate evaluation, refresh and local midnight preserve an actual schedule', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-31T15:50:00.000Z'));
  await mark(page);
  const before = await native(page);
  await expect(page.getByTestId('review-counts')).toHaveText('到期 1 · 未到期 0 · 暂停 0');
  await page.locator('[data-review-rating="good"]').evaluate((b) => {
    (b as HTMLButtonElement).click();
    (b as HTMLButtonElement).click();
  });
  await reviewReady(page);
  const rated = await native(page);
  expect(rated.reviewCards[0]).toMatchObject({ level: 1, dueDate: '2026-11-01', reviewCount: 1 });
  sameLearning(before, rated);
  expect(rated.knowledgeMarks).toEqual(before.knowledgeMarks);
  await page.reload();
  await reviewReady(page);
  expect(await native(page)).toEqual(rated);
  await expect(page.getByTestId('review-not-due')).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-10-31T16:10:00.000Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('review-observed-date')).toContainText('2026-11-01');
  await expect(page.getByTestId('review-counts')).toHaveText('到期 1 · 未到期 0 · 暂停 0');
  expect((await native(page)).reviewCards).toEqual(rated.reviewCards);
  await page.locator('[data-review-rating="again"]').click();
  await reviewReady(page);
  expect((await native(page)).reviewCards[0]).toMatchObject({
    level: 0,
    dueDate: '2026-11-02',
    reviewCount: 2,
  });
  await page.screenshot({ path: `${folder}/actual-scheduled.png`, fullPage: true });
  await writeFile(`${folder}/actual-scheduled.json`, JSON.stringify(await native(page), null, 2));
});
test('15.3 formal correcting the last rating uses its original date and base, and explicit relearning resets only the plan', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-31T04:00:00.000Z'));
  await mark(page);
  const before = await native(page);
  await page.locator('[data-review-rating="good"]').click();
  await reviewReady(page);
  await page.clock.setFixedTime(new Date('2026-11-02T04:00:00.000Z'));
  await page.getByRole('combobox', { name: '修订评价', exact: true }).selectOption('easy');
  await page.getByRole('button', { name: '保存评价修订', exact: true }).click();
  await reviewReady(page);
  expect((await native(page)).reviewCards[0]).toMatchObject({
    level: 2,
    dueDate: '2026-11-03',
    reviewCount: 1,
    lastReview: { localDate: '2026-10-31' },
  });
  await page.getByRole('button', { name: '重新学习此卡（今天到期）', exact: true }).click();
  await reviewReady(page);
  expect((await native(page)).reviewCards[0]).toMatchObject({
    level: 0,
    dueDate: '2026-11-02',
    reviewCount: 1,
    lastReview: null,
  });
  sameLearning(before, await native(page));
});
test('15.3 formal real Rust failure creates one card, run-one does not, pass pauses and new failure reopens', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-31T04:00:00.000Z'));
  await observeCaseSetExecution(page);
  await openAnswer(page, 'exercise.c.bug-semicolon');
  await changePrint(page, '0');
  await panel(page).getByRole('button', { name: '运行本组', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  await reviewReady(page);
  expect((await native(page)).reviewCards).toEqual([]);
  await fail(page);
  await capture(page, 'actual-c-failure');
  await reviews(page);
  const before = await native(page);
  expect(before.reviewCards).toHaveLength(1);
  expect(before.reviewCards[0]).toMatchObject({
    kind: 'exercise',
    subjectRef: { id: 'exercise.c.bug-semicolon' },
    level: 0,
    state: 'active',
  });
  await page.locator('[data-review-rating="easy"]').click();
  await reviewReady(page);
  sameLearning(before, await native(page));
  await openAnswer(page, 'exercise.c.bug-semicolon');
  await submit(page);
  await capture(page, 'actual-c-pass');
  await reviews(page);
  await expect(page.getByTestId('review-counts')).toHaveText('到期 0 · 未到期 0 · 暂停 1');
  expect((await native(page)).reviewCards[0].state).toBe('repaired');
  await page.getByRole('button', { name: '重新学习此卡（今天到期）', exact: true }).click();
  await reviewReady(page);
  const restarted = await native(page);
  expect(restarted.reviewCards[0].state).toBe('active');
  await openAnswer(page, 'exercise.c.bug-semicolon');
  await changePrint(page, '0');
  await fail(page);
  await reviews(page);
  const after = await native(page);
  expect(after.reviewCards[0]).toMatchObject({
    level: 0,
    dueDate: '2026-10-31',
    state: 'active',
    lastReview: null,
  });
  expect(after.reviewCards[0].sourceVersion).toBeGreaterThan(
    restarted.reviewCards[0].sourceVersion,
  );
  expect(after.reviewCards).toHaveLength(1);
  await writeFile(`${folder}/actual-error-card.json`, JSON.stringify(after, null, 2));
});
test('15.3 formal familiar and re-marking pause then reopen the same card without copying learning facts', async ({
  page,
}) => {
  await mark(page);
  const before = await native(page),
    id = before.reviewCards[0].cardId;
  await page.getByRole('link', { name: '复习：2.1 简单的C程序示例', exact: true }).click();
  await ready(page);
  await page.locator('[data-knowledge-mark="knowledge.c6.s2.1"]').click();
  await reviews(page);
  expect((await native(page)).reviewCards[0]).toMatchObject({ cardId: id, state: 'familiar' });
  await page.getByRole('link', { name: '复习：2.1 简单的C程序示例', exact: true }).click();
  await ready(page);
  await page.locator('[data-knowledge-mark="knowledge.c6.s2.1"]').click();
  await reviews(page);
  const after = await native(page);
  expect(after.reviewCards).toHaveLength(1);
  expect(after.reviewCards[0]).toMatchObject({ cardId: id, state: 'active', level: 0 });
  sameLearning(before, after);
});
test('15.3 formal native quota rollback and original-command retry save exactly one evaluation', async ({
  page,
}) => {
  await quota(page);
  await mark(page);
  const before = await native(page);
  await arm(page);
  await page.locator('[data-review-rating="good"]').click();
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  expect(await native(page)).toEqual(before);
  await page.screenshot({ path: `${folder}/actual-unsaved.png`, fullPage: true });
  await page.getByRole('button', { name: '重试复习操作', exact: true }).click();
  await reviewReady(page);
  expect((await native(page)).reviewCards[0].reviewCount).toBe(1);
  const ids = await page.evaluate(
    () => (window as unknown as { __reviewQuota: { ids: string[] } }).__reviewQuota.ids,
  );
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(new Set(ids).size).toBe(1);
  sameLearning(before, await native(page));
});
test('15.3 formal stale peer retry cannot overwrite the newer evaluation, and re-reading exposes it', async ({
  page,
  context,
}) => {
  await quota(page);
  await mark(page);
  await arm(page);
  await page.locator('[data-review-rating="good"]').click();
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  const other = await context.newPage();
  await reviews(other);
  await other.locator('[data-review-rating="easy"]').click();
  await reviewReady(other);
  const saved = await native(other);
  await page.getByRole('button', { name: '重试复习操作', exact: true }).click();
  await expect(status(page)).toHaveAttribute('data-state', 'failed');
  await expect(status(page)).toContainText('S_REVISION_CONFLICT');
  expect((await native(page)).reviewCards).toEqual(saved.reviewCards);
  await page.getByRole('button', { name: '重新读取复习计划', exact: true }).click();
  await reviewReady(page);
  await expect(page.getByTestId('review-detail')).toHaveAttribute(
    'data-due-date',
    saved.reviewCards[0].dueDate,
  );
});
test('15.3 formal peer clear discards a pending review and never resurrects its source or schedule', async ({
  page,
  context,
}) => {
  await quota(page);
  await mark(page);
  const old = await native(page);
  await arm(page);
  await page.locator('[data-review-rating="good"]').click();
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  const other = await context.newPage();
  await clear(other);
  await expect(page.getByRole('button', { name: '重试复习操作', exact: true })).toHaveCount(0);
  await page.reload();
  await reviewReady(page);
  await expect(page.getByTestId('review-empty')).toBeVisible();
  const after = await native(page);
  expect(after.meta.generation).not.toBe(old.meta.generation);
  expect(after.reviewCards).toEqual([]);
  expect(after.knowledgeMarks).toEqual([]);
  expect(after.receipts).toEqual([]);
  expect(after.ledger).toEqual([]);
});
for (const partition of ['reviewCards', 'knowledgeMarks'] as const)
  test(`15.3 formal corrupt ${partition} preserves raw rows and shows unknown rather than an empty queue`, async ({
    page,
  }) => {
    await mark(page);
    await page.evaluate(async (name) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('c-viz-learning');
        r.onsuccess = () => resolve(r.result);
      });
      const tx = db.transaction(name, 'readwrite');
      const r = tx.objectStore(name).openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (c) c.update({ ...c.value, unexpected: 'controlled QA corruption' });
      };
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    }, partition);
    const raw = await native(page);
    await page.reload();
    await expect(status(page)).toHaveAttribute('data-state', 'failed');
    await expect(page.getByTestId('review-unknown')).toBeVisible();
    await expect(page.getByTestId('review-empty')).toHaveCount(0);
    expect((await native(page))[partition]).toEqual(raw[partition]);
    await clear(page);
    await page.reload();
    await reviews(page);
    await expect(page.getByTestId('review-empty')).toBeVisible();
    expect((await native(page))[partition]).toEqual([]);
  });
test('15.3 formal source details, keyboard actions and mobile list-detail navigation remain usable', async ({
  page,
}) => {
  await mark(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const select = page.locator('[data-review-card]').first();
    if (await select.isVisible()) {
      await select.focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.getByTestId('review-detail')).toBeVisible();
    if (width > 900)
      await expect(page.getByRole('button', { name: '返回卡片列表', exact: true })).toBeHidden();
    else
      await expect(page.getByRole('button', { name: '返回卡片列表', exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: '复习：2.1 简单的C程序示例', exact: true }),
    ).toHaveAttribute('href', '#/lessons/lesson.c6.s2.1');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${folder}/actual-due-${width}.png`, fullPage: true });
    if (width <= 900) {
      await page.getByRole('button', { name: '返回卡片列表', exact: true }).click();
      await expect(page.locator('[data-review-card]').first()).toBeVisible();
    }
  }
});
