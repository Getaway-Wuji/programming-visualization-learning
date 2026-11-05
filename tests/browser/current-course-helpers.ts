import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';

const source = JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
  chapters: { exercises: C6CourseExercise[] }[];
};
const exercises = source.chapters.flatMap((chapter) => chapter.exercises);
const repairSources = new WeakMap<Page, Map<string, string>>();

export async function openCurrentAnswer(page: Page, id: string) {
  const exercise = exercises.find((item) => item.ref.id === id);
  if (!exercise) throw new Error(`Unknown current course exercise: ${id}`);
  await page.goto(`/#/practice/${id}`);
  const editor = page.getByLabel('完整 C 源码 · main.c', { exact: true });
  await expect(editor).toBeEditable();
  await editor.fill(exercise.referenceSource);
  return exercise;
}

export async function submitCurrent(page: Page) {
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveText('通过');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}

export async function completeCurrentFirstGroup(page: Page) {
  await confirmCurrentLesson(page, 'lesson.c6.s2.1');
  await confirmCurrentLesson(page, 'lesson.c6.s2.2.1');
  const exercise = await openCurrentAnswer(page, 'exercise.c6.s2.1');
  await submitCurrent(page);
  return exercise;
}

export async function confirmCurrentLesson(page: Page, id: string) {
  if (!id.startsWith('lesson.c6.')) throw new Error(`Not a current C6 lesson: ${id}`);
  await page.goto(`/#/lessons/${id}`);
  const end = page.getByTestId('reading-end');
  await expect(end).toBeAttached();
  await page.keyboard.press('End');
  await expect(end).toHaveAttribute('data-read', 'true');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}

export async function openIndependentEchoRepair(page: Page) {
  await openIndependentRepair(page, 'exercise.c.bug-semicolon');
}

/** Explicit retained repair identity; ordinary retired course IDs are rejected. */
export async function openIndependentRepair(page: Page, id: string) {
  const registry = JSON.parse(readFileSync('content/c/bugs/questions-1.0.0.json', 'utf8')) as {
    questions: { exerciseRef: { id: string }; brokenBody: string; solutionBody: string }[];
  };
  const question = registry.questions.find((q) => q.exerciseRef.id === id);
  if (!question) throw new Error(`Unknown independent C repair: ${id}`);
  await page.goto(`/#/practice/${question.exerciseRef.id}`);
  const editor = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  await expect(page.getByTestId('practice-execution')).toHaveAttribute(
    'data-state',
    /^(ready|passed|unmet)$/,
  );
  const expand = page.getByRole('button', { name: '编辑 C 并同步积木', exact: true });
  if (await expand.isVisible()) await expand.click();
  await expect(editor).toBeEditable();
  const saved = repairSources.get(page) ?? new Map<string, string>();
  if (!saved.has(id)) {
    await expect
      .poll(() =>
        page
          .locator('.code-editor .cm-line')
          .allTextContents()
          .then((lines) => lines.join('\n')),
      )
      .toContain(question.brokenBody);
    saved.set(
      id,
      (
        await page
          .locator('.code-editor .cm-line')
          .allTextContents()
          .then((lines) => lines.join('\n'))
      ).replace(question.brokenBody, question.solutionBody),
    );
    repairSources.set(page, saved);
  }
  // Re-entering the same route restores its real last draft. Reuse only the
  // authored source captured on this page's first visit, through the editor.
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute(
    'data-sync',
    /^(synced|invalid|unmapped)$/,
  );
  await editor.clear();
  await expect
    .poll(() =>
      page
        .locator('.code-editor .cm-line')
        .allTextContents()
        .then((lines) => lines.join('\n')),
    )
    .toBe('');
  await editor.fill(saved.get(id)!);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
}
