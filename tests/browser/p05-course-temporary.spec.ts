import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import { installC6Packets } from './c6-observation';
import { currentProgramPath } from './current-c6-ui';
import {
  currentSnapshot,
  currentLocalReady,
  assertCurrentRun,
  assertLearningEqual,
} from './current-practice-observation';
const exercises = (
  JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
    chapters: { exercises: C6CourseExercise[] }[];
  }
).chapters.flatMap((c) => c.exercises);
test('missing course authority fails closed; current 44 exercises and 176 real unscored runs grant no learning record', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  expect(info.retry).toBe(0);
  info.annotations.push({
    type: 'current-contract',
    description:
      'Scope49: old unregistered32 course retired; current authority fail-closed and 44x4 unscored native runs.',
  });
  await page.addInitScript(installC6Packets);
  const manifest = '**/content/c/primer6-teaching/manifest-2.0.0.json';
  await page.route(manifest, (r) =>
    r.fulfill({ status: 404, body: 'Explicit missing current authority' }),
  );
  await page.goto('/#/practice/exercise.c6.s2.1');
  await expect(page.getByRole('heading', { name: '课程暂时无法读取', exact: true })).toBeVisible();
  await expect(page.getByLabel('完整 C 源码 · main.c', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).filter((d) => d.name === 'c-viz-learning'),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => window.c6CurrentPackets)).toEqual([]);
  await page.unroute(manifest);
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await currentLocalReady(page);
  await page.goto('/#/');
  await currentLocalReady(page);
  await expect.poll(async () => (await currentSnapshot(page)).settings.goalTemplate).not.toBeNull();
  const before = await currentSnapshot(page);
  const runs = [];
  // Unscored execution now lives in the ordinary program workbench. Keep each
  // authored answer and all four real inputs; exercise submission stays scored.
  await page.goto(currentProgramPath);
  const editor = page.getByLabel('完整 C 源码 · main.c', { exact: true });
  await expect(editor).toBeEditable();
  for (const subject of exercises) {
    await editor.fill(subject.referenceSource);
    for (const group of subject.tests) {
      await page
        .getByLabel('本次试运行输入（ASCII，最多 256 字节）', { exact: true })
        .fill(group.stdin);
      await page.getByRole('button', { name: '运行当前代码', exact: true }).click();
      await expect(page.locator('.c6-trace')).toBeVisible();
      const actual = await assertCurrentRun(page, subject.referenceSource, group.stdin);
      expect(actual.result.terminal).toMatchObject({
        status: 'completed',
        returnValue: group.expectedReturnCode,
      });
      expect(actual.result.nodeMap.length).toBeGreaterThan(0);
      const output =
        actual.result.trace!.initialState.output +
        actual.result
          .trace!.steps.flatMap((s) =>
            s.changes.flatMap((c) => (c.op === 'output' ? [c.append] : [])),
          )
          .join('');
      expect(output).toBe(group.expectedStdout);
      await page.getByRole('button', { name: '到本次末尾', exact: true }).click();
      await expect(page.getByLabel('当前游标标准输出', { exact: true })).toHaveText(
        group.expectedStdout || '（暂无输出）',
      );
      runs.push({
        exercise: subject.ref,
        caseKey: group.caseKey,
        request: actual.request,
        steps: actual.result.trace!.steps.length,
        output,
      });
      assertLearningEqual(before, await currentSnapshot(page));
    }
  }
  expect(exercises).toHaveLength(44);
  expect(runs).toHaveLength(176);
  const after = await currentSnapshot(page);
  assertLearningEqual(before, after);
  for (const key of [
    'progress',
    'receipts',
    'ledger',
    'dailyFacts',
    'goals',
    'courseActivities',
    'courseDrafts',
  ] as const)
    expect(after[key]).toEqual([]);
  expect(after.meta.generation).toBe(before.meta.generation);
  await info.attach('current-44x4-real-unscored', {
    body: JSON.stringify({
      scope: 'Current unscored runs only; no temporary pass authority claimed',
      before,
      after,
      runs,
    }),
    contentType: 'application/json',
  });
});
