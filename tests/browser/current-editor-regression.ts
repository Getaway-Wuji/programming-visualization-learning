import { readFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import { installC6Packets } from './c6-observation';
import { blockOptions, blockWorkspace, selectBlock } from './block-ui';
import {
  assertCompleteC6Replay,
  currentProgramPath,
  currentSource,
  currentSourceText,
  expectCurrentSource,
  submitCurrentVerdict,
} from './current-c6-ui';
import {
  assertCurrentJudge,
  assertCurrentRun,
  assertLearningEqual,
  currentLocalReady,
  currentSnapshot,
} from './current-practice-observation';

const exercises = (
  JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
    chapters: { exercises: C6CourseExercise[] }[];
  }
).chapters.flatMap((chapter) => chapter.exercises);

/** Original parameter identities remain visible; retired ordinary courses are
 * replaced explicitly by current full-source exercises, never revived. */
export async function currentEditorRegression(page: Page, info: TestInfo, index: number) {
  const exercise = exercises[index];
  if (!exercise) throw Error(`Missing reviewed current carrier ${index}`);
  info.annotations.push({
    type: 'current-course-carrier',
    description: `${info.title} is retained as a regression identity. Actual current carrier: ${exercise.ref.id}. Full book source is code-only; actual bidirectional mapping is checked separately on a temporary integer draft, before the complete four-case book judge.`,
  });
  await page.addInitScript(installC6Packets);
  await page.goto(currentProgramPath);
  const editor = currentSource(page);
  await expect(editor).toBeEditable();
  await currentLocalReady(page);
  await expect.poll(async () => (await currentSnapshot(page)).settings.goalTemplate).not.toBeNull();
  const before = await currentSnapshot(page);

  const draft = '#include <stdio.h>\nint main(void){int probe=1;printf("%d\\n",probe);return 0;}';
  await page.getByLabel('本次试运行输入（ASCII，最多 256 字节）', { exact: true }).fill('');
  await editor.fill(draft);
  await page.getByRole('button', { name: '同步到积木', exact: true }).click();
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  const integers = await blockOptions(page, /^\d+\. 整数 · 1$/);
  expect(integers).toHaveLength(1);
  await selectBlock(page, integers[0]);
  await blockWorkspace(page).getByRole('textbox', { name: '整数值', exact: true }).fill('2');
  await expect(page.getByText('积木生成的完整程序预览', { exact: true })).toBeVisible();
  await expectCurrentSource(page, draft);
  await page.getByRole('button', { name: '应用生成代码', exact: true }).click();
  const changed = await currentSourceText(page);
  expect(changed).toMatch(/probe\s*=\s*2/);
  await page.getByRole('button', { name: '运行当前代码', exact: true }).click();
  await expect(page.locator('.c6-trace')).toHaveAttribute('data-cursor', '0');
  const run = await assertCurrentRun(page, changed, '');
  expect(run.result.terminal.returnValue).toBe(0);
  await page.getByRole('button', { name: '到本次末尾', exact: true }).click();
  await expect(page.getByLabel('当前游标标准输出', { exact: true })).toHaveText('2');
  assertLearningEqual(before, await currentSnapshot(page));

  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('c6-draft-save-status')).toHaveText('草稿已保存');
  await page.goto(`/#/practice/${exercise.ref.id}`);
  await expectCurrentSource(page, exercise.starterSource);
  const beforeJudge = await currentSnapshot(page);
  await editor.fill(exercise.referenceSource);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  await page.getByRole('button', { name: '同步到积木', exact: true }).click();
  await expect(page.locator('.c6-block-pane')).toContainText('当前代码暂不能完整转为积木');
  await expect(blockWorkspace(page)).toBeVisible();
  await expectCurrentSource(page, exercise.referenceSource);
  assertLearningEqual(beforeJudge, await currentSnapshot(page));
  await submitCurrentVerdict(page);
  const judge = await assertCurrentJudge(page, exercise, 'passed');
  for (const [i, actual] of judge.result.cases.entries()) {
    assertCompleteC6Replay(actual.packet, exercise.tests[i].expectedStdout);
  }
  const saved = await currentSnapshot(page);
  expect(saved.receipts.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(1);
  expect(
    saved.progress.filter((p) => p.eventType === 'exercise.passed').map((p) => p.subjectRef),
  ).toEqual([exercise.ref]);
  await expectCurrentSource(page, exercise.referenceSource);
  await info.attach('original-identity-current-native-carrier', {
    body: JSON.stringify({
      originalTitle: info.title,
      currentExercise: exercise.ref,
      before,
      saved,
    }),
    contentType: 'application/json',
  });
}
