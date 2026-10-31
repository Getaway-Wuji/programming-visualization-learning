import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { confirm, openAnswer, submit, ready } from './notebook-helpers';
import { native as archive } from './scheduler-helpers';
import { waitForPhase2Archive } from './phase2-ready';
const course = JSON.parse(readFileSync('content/advanced/course-1.0.0.json', 'utf8')) as {
  lessons: { lessonRef: { id: string }; caseRef: { id: string } }[];
};
const base = JSON.parse(readFileSync('content/c/p05/course-1.0.0.json', 'utf8')) as {
  lessons: { id: string; requiredExerciseRefs: { id: string }[] }[];
};
const exercise = (id: string) =>
  base.lessons.find((item) => item.id === id)!.requiredExerciseRefs[0].id;

test.beforeEach(async ({ page }) => page.clock.setFixedTime(new Date('2026-11-01T04:00:00.000Z')));
test('four real original exercises complete shared chapters with no second progress or reward', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  for (const entry of course.lessons) {
    await confirm(page, entry.lessonRef.id);
    await openAnswer(page, exercise(entry.lessonRef.id));
    await submit(page);
    await page.goto(`/#/advanced/${entry.lessonRef.id}`);
    await waitForPhase2Archive(page);
    await expect(page.getByTestId('advanced-lesson-progress')).toContainText('基础准备完成');
  }
  await page.goto('/#/advanced');
  await expect(page.getByTestId('advanced-chapter-progress')).toHaveText([
    '2/2 基础准备完成',
    '2/2 基础准备完成',
  ]);
  const before = await archive(page);
  expect(before.progress.some((row) => row.subjectRef.id.includes('advanced'))).toBe(false);
  expect(before.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(4);
  await openAnswer(page, exercise(course.lessons[0].lessonRef.id));
  await submit(page);
  const after = await archive(page);
  expect(after.ledger).toEqual(before.ledger);
  await page.goto('/#/advanced');
  await page.reload();
  await expect(page.getByTestId('advanced-chapter-progress')).toHaveText([
    '2/2 基础准备完成',
    '2/2 基础准备完成',
  ]);
  expect((await archive(page)).ledger).toEqual(before.ledger);
  await info.attach('real-shared-completion-archive', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
});

test('failed native pass stays incomplete until original retry saves the same result', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    let armed = false;
    Object.assign(window, {
      armAdvancedQuota: () => {
        armed = true;
      },
    });
    for (const name of ['put', 'add'] as const) {
      const original = IDBObjectStore.prototype[name];
      IDBObjectStore.prototype[name] = function (value, key) {
        if (
          armed &&
          this.name === 'progress' &&
          (value as { eventType?: string })?.eventType === 'exercise.passed'
        ) {
          armed = false;
          throw new DOMException('Explicit 18.1 native quota fault', 'QuotaExceededError');
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      };
    }
  });
  const id = course.lessons[0].lessonRef.id;
  await confirm(page, id);
  await openAnswer(page, exercise(id));
  await page.evaluate(() => (window as unknown as { armAdvancedQuota(): void }).armAdvancedQuota());
  await submit(page, false);
  await page.goto(`/#/advanced/${id}`);
  await expect(page.getByTestId('advanced-lesson-progress')).toContainText('尚未完成');
  await expect(page.getByTestId('advanced-lesson-progress')).toContainText('尚未保存');
  const failed = await archive(page);
  expect(failed.progress.some((row) => row.eventType === 'exercise.passed')).toBe(false);
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重试未保存操作', exact: true })
    .click();
  await ready(page);
  await expect(page.getByTestId('advanced-lesson-progress')).toContainText('基础准备完成');
  const saved = await archive(page);
  expect(saved.progress.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('advanced-lesson-progress')).toContainText('基础准备完成');
  expect((await archive(page)).ledger).toEqual(saved.ledger);
  await info.attach('native-failure-recovery', {
    body: JSON.stringify({ failed, saved }),
    contentType: 'application/json',
  });
});

test('knowledge marks use the original identity and the existing review queue', async ({
  page,
}, info) => {
  const id = course.lessons[0].lessonRef.id;
  await page.goto(`/#/advanced/${id}`);
  await waitForPhase2Archive(page);
  const mark = page.locator('[data-knowledge-mark="knowledge.c.arrays"]');
  await expect(mark).toBeEnabled();
  await mark.click();
  await expect(mark).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: '今日复习', exact: true }).last().click();
  await expect(
    page.getByRole('heading', { name: '今日复习', exact: true, level: 1 }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const snapshot = await archive(page);
      return snapshot.knowledgeMarks?.length;
    })
    .toBe(1);
  const snapshot = await archive(page);
  expect(snapshot.knowledgeMarks[0].lessonRef.id).toBe(id);
  expect(snapshot.knowledgeMarks[0].knowledgeRef.id).toBe('knowledge.c.arrays');
  expect(snapshot.ledger).toEqual([]);
  await info.attach('original-knowledge-identity', {
    body: JSON.stringify(snapshot),
    contentType: 'application/json',
  });
});
