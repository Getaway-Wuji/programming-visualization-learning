import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { native as archive } from './scheduler-helpers';
import { waitForPhase2Archive } from './phase2-ready';
import { confirmCurrentLesson, openCurrentAnswer, submitCurrent } from './current-course-helpers';

const preparations: Record<string, readonly string[]> = {
  'lesson.c.logical-length-guards': ['10.1.4', '6.11.1'],
  'lesson.c.adjacent-order': ['6.3.5', '6.11.1'],
  'lesson.c.array-extrema': ['6.11.1', '7.3.4'],
  'lesson.c.nested-loops': ['6.10.1', '6.10.2'],
};
const course = JSON.parse(readFileSync('content/advanced/course-1.0.0.json', 'utf8')) as {
  lessons: { lessonRef: { id: string } }[];
};
const current = JSON.parse(readFileSync('content/c/primer6-learning/index-1.0.0.json', 'utf8')) as {
  lessons: [string, string, string, string, number, string[]][];
};
const foundation = (page: Page) => page.getByTestId('c6-foundation');
test.beforeEach(async ({ page }) => page.clock.setFixedTime(new Date('2026-11-01T04:00:00.000Z')));

test('current book prerequisites complete shared advanced preparation without second progress or reward', async ({
  page,
}, info) => {
  for (const entry of course.lessons) {
    const sections = preparations[entry.lessonRef.id];
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      const id = `lesson.c6.s${section}`;
      await confirmCurrentLesson(page, id);
      for (const exercise of current.lessons.find((l) => l[0] === id)![5]) {
        await openCurrentAnswer(page, exercise);
        await submitCurrent(page);
      }
    }
    await page.goto(`/#/advanced/${entry.lessonRef.id}`);
    await waitForPhase2Archive(page);
    await expect(foundation(page).locator('p')).toContainText('基础准备完成');
    expect(
      await foundation(page)
        .getByRole('link')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
    ).toEqual(sections.map((section) => `#/lessons/lesson.c6.s${section}`));
  }
  await page.goto('/#/advanced');
  await expect(
    page.locator('.advanced-lesson-list:has(a[href^="#/advanced/lesson.c."]) li p'),
  ).toHaveText(Array(4).fill('基础准备完成'));
  const before = await archive(page);
  const ids = [...new Set(Object.values(preparations).flat())].map((s) => `lesson.c6.s${s}`);
  expect(
    before.progress
      .filter((p) => p.eventType === 'lesson.completed')
      .map((p) => p.subjectRef.id)
      .sort(),
  ).toEqual(ids.sort());
  expect(
    before.progress.every(
      (p) => p.packageRef.id === 'content.c.primer6' && p.subjectRef.version === '2.0.0',
    ),
  ).toBe(true);
  await confirmCurrentLesson(page, ids[0]);
  await page.goto('/#/advanced');
  await page.reload();
  await waitForPhase2Archive(page);
  const after = await archive(page);
  expect(after.progress).toEqual(before.progress);
  expect(after.ledger).toEqual(before.ledger);
  await info.attach('current-shared-preparation', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
});

test('a failed native current confirmation stays incomplete until the same pending receipt is retried', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const control = { armed: false, ids: [] as string[] };
    Object.assign(window, { currentFoundationQuota: control });
    for (const name of ['put', 'add'] as const) {
      const original = IDBObjectStore.prototype[name];
      IDBObjectStore.prototype[name] = function (value, key) {
        const row = value as { eventId?: string; eventType?: string; subjectRef?: { id: string } };
        if (
          this.name === 'receipts' &&
          row.eventType === 'lesson.study-confirmed' &&
          row.subjectRef?.id === 'lesson.c6.s6.11.1'
        ) {
          control.ids.push(row.eventId!);
          if (control.armed) {
            control.armed = false;
            throw new DOMException('21.6 native current confirmation quota', 'QuotaExceededError');
          }
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      };
    }
  });
  await confirmCurrentLesson(page, 'lesson.c6.s10.1.4');
  for (const exercise of current.lessons.find((l) => l[0] === 'lesson.c6.s10.1.4')![5]) {
    await openCurrentAnswer(page, exercise);
    await submitCurrent(page);
  }
  await page.goto('/#/lessons/lesson.c6.s6.11.1');
  const confirmation = page.getByTestId('reading-end');
  await expect(confirmation).toHaveAttribute('data-read', 'false');
  await page.evaluate(() => {
    (
      window as unknown as { currentFoundationQuota: { armed: boolean } }
    ).currentFoundationQuota.armed = true;
  });
  await page.keyboard.press('End');
  await expect(confirmation.getByRole('alert')).toContainText('阅读进度未保存');
  await expect(page.getByTestId('learning-save-status').getByRole('alert')).toContainText(
    '这次更改未保存',
  );
  const failed = await archive(page);
  expect(failed.progress.some((p) => p.subjectRef.id === 'lesson.c6.s6.11.1')).toBe(false);
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重试未保存操作', exact: true })
    .click();
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read', 'true');
  const ids = await page.evaluate(
    () =>
      (window as unknown as { currentFoundationQuota: { ids: string[] } }).currentFoundationQuota
        .ids,
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(1);
  await page.goto('/#/advanced/lesson.c.logical-length-guards');
  await waitForPhase2Archive(page);
  await expect(foundation(page).locator('p')).toContainText('基础准备完成');
  const saved = await archive(page);
  expect(saved.receipts.filter((r) => r.eventId === ids[0])).toHaveLength(1);
  await page.reload();
  await expect(foundation(page).locator('p')).toContainText('基础准备完成');
  expect((await archive(page)).ledger).toEqual(saved.ledger);
  await info.attach('native-current-confirmation-recovery', {
    body: JSON.stringify({ failed, saved, ids }),
    contentType: 'application/json',
  });
});

test('current knowledge marks preserve their new book identity in the existing review queue', async ({
  page,
}, info) => {
  await page.goto('/#/advanced/lesson.c.logical-length-guards');
  await waitForPhase2Archive(page);
  const mark = page.locator('[data-knowledge-mark="knowledge.c6.s10.1.4"]');
  await expect(mark).toBeEnabled();
  await mark.click();
  await expect(mark).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '错题与陌生点', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '错题与陌生点', exact: true, level: 1 }),
  ).toBeVisible();
  await expect.poll(async () => (await archive(page)).knowledgeMarks?.length).toBe(1);
  const snapshot = await archive(page);
  expect(snapshot.knowledgeMarks[0].lessonRef).toEqual({
    id: 'lesson.c6.s10.1.4',
    version: '2.0.0',
  });
  expect(snapshot.knowledgeMarks[0].knowledgeRef).toEqual({
    id: 'knowledge.c6.s10.1.4',
    version: '2.0.0',
  });
  expect(snapshot.ledger).toEqual([]);
  await info.attach('current-knowledge-identity', {
    body: JSON.stringify(snapshot),
    contentType: 'application/json',
  });
});
