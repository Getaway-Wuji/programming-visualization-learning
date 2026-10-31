import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
import {
  folder,
  native,
  status,
  achievementReady,
  badges,
  watch,
  pointerPass,
  capture,
  quota,
  arm,
  clear,
  sameLearning,
  openAnswer,
  submit,
  observeCaseSetExecution,
} from './achievement-helpers';
test.use({ timezoneId: 'Asia/Shanghai' });
test.beforeAll(() => mkdir(folder, { recursive: true }));
test('15.4 common empty or unreviewed achievements stay honest without learning facts', async ({
  page,
}) => {
  await page.goto('/#/achievements');
  await expect(
    page.getByRole('heading', { level: 1, name: '学习成就', exact: true }),
  ).toBeVisible();
  if (!p05CourseRelease.registered) {
    await expect(page.getByTestId('achievement-total')).toHaveText('待确认');
    await expect(page.locator('[data-unlocked="true"]')).toHaveCount(0);
    return;
  }
  await achievementReady(page);
  await expect(page.getByTestId('achievement-total')).toHaveText('0 / 3');
  const before = await native(page);
  await page.reload();
  await achievementReady(page);
  expect(await native(page)).toEqual(before);
  await page.goto('/#/');
  await achievementReady(page);
  await expect(page.getByTestId('achievement-summary')).toHaveCount(0);
  await page.getByRole('link', { name: '学习成就', exact: true }).click();
  await expect(page.getByTestId('achievement-total')).toHaveText('0 / 3');
});
test('15.4 common three widths expose fixed conditions and next actions', async ({ page }) => {
  await page.goto('/#/achievements');
  await expect(page.getByTestId('achievement-item')).toHaveCount(3);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${folder}/empty-${width}.png`, fullPage: true });
  }
});
test('15.4 formal genuine bubble pass unlocks once, refresh and repeat preserve original evidence and rewards', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await openAnswer(page, 'exercise.c.bubble-sort');
  await submit(page);
  await achievementReady(page);
  await capture(page, 'bubble-actual-pass');
  await badges(page);
  await expect(page.locator('[data-badge-id="badge.c.bubble-pass"]')).toHaveAttribute(
    'data-unlocked',
    'true',
  );
  const before = await native(page);
  expect(before.achievements).toHaveLength(1);
  expect(before.achievements[0].evidence[0].eventId).toBe(
    before.receipts.find(
      (r) => r.eventType === 'exercise.passed' && r.subjectRef.id === 'exercise.c.bubble-sort',
    )?.eventId,
  );
  await page.reload();
  await achievementReady(page);
  expect((await native(page)).achievements).toEqual(before.achievements);
  await openAnswer(page, 'exercise.c.bubble-sort');
  await submit(page);
  await achievementReady(page);
  const after = await native(page);
  expect(after.achievements).toEqual(before.achievements);
  expect(after.ledger).toEqual(before.ledger);
});
test('15.4 formal both pointer repairs require real full-group passes and show partial progress', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await pointerPass(page, 0);
  await badges(page);
  await expect(page.locator('[data-badge-id="badge.cpp.pointer-repair"]')).toHaveAttribute(
    'data-unlocked',
    'false',
  );
  await expect(page.locator('[data-badge-id="badge.cpp.pointer-repair"]')).toContainText(
    '1 / 2 项已完成',
  );
  await capture(page, 'pointer-one-actual');
  await pointerPass(page, 1);
  await badges(page);
  await expect(page.locator('[data-badge-id="badge.cpp.pointer-repair"]')).toHaveAttribute(
    'data-unlocked',
    'true',
  );
  await capture(page, 'pointer-both-actual');
  const rows = (await native(page)).achievements;
  expect(rows[0].evidence).toHaveLength(2);
  await page.reload();
  await achievementReady(page);
  expect((await native(page)).achievements).toEqual(rows);
});
test('15.4 formal two complete visible recursion observations require explicit confirmation and grant no points', async ({
  page,
}) => {
  test.setTimeout(150000);
  await observeCaseSetExecution(page);
  await badges(page);
  await openAnswer(page, 'exercise.c.bubble-sort');
  await submit(page);
  await capture(page, 'all-three-bubble');
  await pointerPass(page, 0);
  await capture(page, 'all-three-pointer-one');
  await pointerPass(page, 1);
  await capture(page, 'all-three-pointer-two');
  await badges(page);
  const before = await native(page);
  await watch(page, 'functions', false);
  expect((await native(page)).achievements).toEqual(before.achievements);
  await page.getByRole('button', { name: '确认本次递归观察', exact: true }).click();
  await achievementReady(page);
  await capture(page, 'functions-observed-actual');
  await badges(page);
  await expect(page.locator('[data-badge-id="badge.recursion.observer"]')).toContainText(
    '1 / 2 项已完成',
  );
  await watch(page, 'hanoi');
  await capture(page, 'hanoi-observed-actual');
  await badges(page);
  await expect(page.locator('[data-badge-id="badge.recursion.observer"]')).toHaveAttribute(
    'data-unlocked',
    'true',
  );
  const after = await native(page);
  sameLearning(before, after);
  expect(
    after.achievements.find((r) => r.badgeRef.id === 'badge.recursion.observer')?.evidence,
  ).toHaveLength(2);
  await expect(page.getByTestId('achievement-total')).toHaveText('3 / 3');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${folder}/actual-recursion-${width}.png`, fullPage: true });
  }
  await writeFile(`${folder}/actual-recursion.json`, JSON.stringify(after, null, 2));
  await page.reload();
  await achievementReady(page);
  expect((await native(page)).achievements).toEqual(after.achievements);
});
test('15.4 formal terminal seeking, wrong view and input changes never confirm an unobserved run', async ({
  page,
}) => {
  await page.goto('/#/memory?example=hanoi&view=stack');
  await achievementReady(page);
  await page.getByRole('spinbutton', { name: '汉诺塔盘数', exact: true }).fill('2');
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  const range = page.getByRole('slider', { name: '执行步骤', exact: true });
  await range.fill((await range.getAttribute('max')) ?? '0');
  await page.locator('.stack-current').scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '确认本次递归观察', exact: true })).toBeDisabled();
  await expect(page.getByTestId('observation-confirm')).toHaveAttribute('data-complete', 'false');
  await page.getByRole('button', { name: '基础视图', exact: true }).click();
  await range.fill('0');
  await range.press('ArrowRight');
  await expect(page.getByTestId('observation-confirm')).toHaveAttribute('data-complete', 'false');
  await page.getByRole('spinbutton', { name: '汉诺塔盘数', exact: true }).fill('3');
  await expect(page.getByTestId('observation-confirm')).toHaveAttribute('data-total', '0');
  expect((await native(page)).achievements).toEqual([]);
});
test('15.4 formal fewer than two disks is outside the fixed condition and limited recursion cannot mint a fact', async ({
  page,
}) => {
  await page.goto('/#/memory?example=hanoi&view=stack');
  await achievementReady(page);
  await page.getByRole('spinbutton', { name: '汉诺塔盘数', exact: true }).fill('1');
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('observation-confirm')).toHaveAttribute('data-total', '0');
  await page.getByRole('combobox', { name: '观察样例', exact: true }).selectOption('stack-limit');
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('observation-confirm')).toHaveCount(0);
  expect((await native(page)).achievements).toEqual([]);
});
test('15.4 formal observation quota preserves original confirmation payload on retry', async ({
  page,
}) => {
  test.setTimeout(100000);
  await quota(page);
  await watch(page, 'functions', false);
  const before = await native(page);
  await arm(page);
  await page.getByRole('button', { name: '确认本次递归观察', exact: true }).click();
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  expect((await native(page)).achievements).toEqual([]);
  sameLearning(before, await native(page));
  await arm(page, false);
  await page.getByRole('button', { name: '重试观察确认', exact: true }).click();
  await achievementReady(page);
  const attempts = await page.evaluate(
    () =>
      (window as unknown as { __achievementQuota: { attempts: string[] } }).__achievementQuota
        .attempts,
  );
  expect(attempts.length).toBeGreaterThanOrEqual(2);
  expect(new Set(attempts).size).toBe(1);
  expect((await native(page)).achievements[0].evidence).toHaveLength(1);
  await capture(page, 'quota-retry-original');
});
test('15.4 formal automatic badge quota cannot erase a saved practice pass', async ({ page }) => {
  await quota(page);
  await badges(page);
  await arm(page);
  await openAnswer(page, 'exercise.c.bubble-sort');
  await submit(page);
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-achievement-storage-status',
    'failed',
  );
  const before = await native(page);
  expect(before.achievements).toEqual([]);
  expect(
    before.receipts.some(
      (r) => r.eventType === 'exercise.passed' && r.subjectRef.id === 'exercise.c.bubble-sort',
    ),
  ).toBe(true);
  await page.goto('/#/achievements');
  await expect(page.getByTestId('achievement-total')).toHaveText('待确认');
  await arm(page, false);
  await page.getByRole('button', { name: '重新确认成就', exact: true }).click();
  await achievementReady(page);
  const after = await native(page);
  sameLearning(before, after);
  expect(after.achievements[0].unlockedAt).toBeTruthy();
});
test('15.4 formal clear from a peer removes a pending confirmation and every achievement', async ({
  page,
  context,
}) => {
  test.setTimeout(100000);
  await quota(page);
  await watch(page, 'functions', false);
  await arm(page);
  await page.getByRole('button', { name: '确认本次递归观察', exact: true }).click();
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  const generation = (await native(page)).meta.generation;
  const peer = await context.newPage();
  await clear(peer);
  await achievementReady(peer);
  await page.bringToFront();
  await expect.poll(async () => (await native(page)).meta.generation).not.toBe(generation);
  await badges(page);
  await expect(page.getByTestId('achievement-total')).toHaveText('0 / 3');
  await expect(page.getByRole('button', { name: '重试观察确认', exact: true })).toHaveCount(0);
  expect((await native(page)).achievements).toEqual([]);
});
test('15.4 formal unknown achievement row is preserved and displayed as uncertain', async ({
  page,
}) => {
  await badges(page);
  const future = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    const value = { achievementVersion: '9.0.0', future: 'preserve' };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('achievements', 'readwrite');
      tx.objectStore('achievements').put(value, ['future', 'badge.future']);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return value;
  });
  await page.reload();
  await expect(page.getByTestId('achievement-total')).toHaveText('待确认');
  await expect(page.locator('[data-unlocked="true"]')).toHaveCount(0);
  expect((await native(page)).achievements).toEqual([future]);
});

test('15.4 formal two pages merge different real observation sources without overwriting either', async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  await watch(page, 'functions', false);
  const peer = await context.newPage();
  await peer.bringToFront();
  await watch(peer, 'hanoi');
  await page.bringToFront();
  await achievementReady(page);
  await page.getByRole('button', { name: '确认本次递归观察', exact: true }).click();
  await achievementReady(page);
  await badges(peer);
  await expect(peer.locator('[data-badge-id="badge.recursion.observer"]')).toHaveAttribute(
    'data-unlocked',
    'true',
  );
  const a = (await native(page)).achievements,
    b = (await native(peer)).achievements;
  expect(a).toEqual(b);
  expect(a[0].evidence.map((e) => e.subjectRef.id)).toEqual([
    'observation.stack.functions',
    'observation.stack.hanoi',
  ]);
});

test('15.4 formal delayed real transaction completion cannot resurrect an achievement after peer clear', async ({
  page,
  context,
}) => {
  test.setTimeout(100000);
  await page.addInitScript(() => {
    const nativeTransaction = IDBDatabase.prototype.transaction;
    const put = IDBObjectStore.prototype.put;
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!;
    const targets = new WeakSet<IDBTransaction>();
    const control = { armed: false, held: false, release: null as (() => void) | null };
    Object.assign(window, { __achievementAck: control });
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const tx = nativeTransaction.call(this, names, mode, options);
      if (Array.from(tx.objectStoreNames).includes('achievements') && mode === 'readwrite')
        Object.defineProperty(tx, 'oncomplete', {
          configurable: true,
          get: () => descriptor.get!.call(tx),
          set: (callback: ((e: Event) => void) | null) =>
            descriptor.set!.call(
              tx,
              callback
                ? function (e: Event) {
                    if (control.armed && targets.has(tx)) {
                      control.armed = false;
                      control.held = true;
                      control.release = () => callback.call(tx, e);
                    } else callback.call(tx, e);
                  }
                : null,
            ),
        });
      return tx;
    };
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'achievements' && control.armed) targets.add(this.transaction);
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await watch(page, 'functions', false);
  const generation = (await native(page)).meta.generation;
  await page.evaluate(() => {
    (window as unknown as { __achievementAck: { armed: boolean } }).__achievementAck.armed = true;
  });
  await page.getByRole('button', { name: '确认本次递归观察', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __achievementAck: { held: boolean } }).__achievementAck.held,
      ),
    )
    .toBe(true);
  const peer = await context.newPage();
  await clear(peer);
  await achievementReady(peer);
  await page.evaluate(() => {
    (window as unknown as { __achievementAck: { release: () => void } }).__achievementAck.release();
  });
  await page.bringToFront();
  await badges(page);
  expect((await native(page)).meta.generation).not.toBe(generation);
  expect((await native(page)).achievements).toEqual([]);
  await expect(page.getByTestId('achievement-total')).toHaveText('0 / 3');
});
test('15.4 formal confirmed clear retains the reviewed course and usable empty achievements without reload', async ({
  page,
}) => {
  await badges(page);
  const before = await native(page);
  await clear(page);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  const after = await native(page);
  await writeFile(
    `${folder}/clear-current-course.json`,
    JSON.stringify({ before, after }, null, 2),
  );
  expect(after.meta.generation).not.toBe(before.meta.generation);
  expect(after.meta.activePackageRef).toEqual(before.meta.activePackageRef);
  await achievementReady(page);
  expect(after.achievements).toEqual([]);
});
