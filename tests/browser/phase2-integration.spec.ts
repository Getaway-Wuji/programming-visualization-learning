import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { code, panel, submit } from './notebook-helpers';
import { openIndependentEchoRepair, completeCurrentFirstGroup } from './current-course-helpers';
import { assertCurrentJudge } from './current-practice-observation';
import { installC6Packets } from './c6-observation';
import { native } from './achievement-helpers';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { waitForPhase2Archive } from './phase2-ready';
import type { SnapshotDocument } from '../../web/src/snapshot-export/types';

const directory = `.artifacts/16.10/combined/${process.env.TASK_EVIDENCE_LABEL}`;
const questions = JSON.parse(readFileSync('content/challenges/cases-1.0.0.json', 'utf8'))
  .questions as { ref: { id: string }; anchorKind: string }[];
test('one native archive connects real failure, review, completion, challenge, both execution families and downloaded current state', async ({
  page: p,
}) => {
  test.setTimeout(90000);
  await mkdir(directory, { recursive: true });
  await observeCaseSetExecution(p);
  await p.addInitScript(installC6Packets);
  await openIndependentEchoRepair(p);
  await waitForPhase2Archive(p);
  const solution = await code(p).inputValue(),
    wrong = solution.replace(/\bx\);/, '0);');
  expect(wrong).not.toBe(solution);
  await code(p).clear();
  await expect(code(p)).toHaveValue('');
  await code(p).fill(wrong);
  await expect(code(p)).toHaveValue(wrong);
  await expect(p.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await panel(p).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(p)).toHaveAttribute('data-state', 'unmet');
  await expect(p.getByTestId('practice-attempt-save')).toHaveAttribute('data-save-state', 'saved');
  await writeFile(
    `${directory}/wrong-worker.json.gz`,
    gzipSync(JSON.stringify(await observedCaseSetExecute(p))),
    { flag: 'wx' },
  );
  await p.goto('/#/notebook');
  await expect(
    p
      .locator('.c6-mistake-list > li')
      .filter({ has: p.locator('a[href="#/practice/exercise.c.bug-semicolon"]') }),
  ).toHaveCount(1);
  await p.goto('/#/reviews');
  await expect(p.getByTestId('review-detail')).toBeVisible();
  const rating = p.locator('[data-review-rating="good"]');
  await expect(rating).toBeEnabled();
  await rating.click();
  await expect.poll(async () => (await native(p)).reviewCards[0]?.reviewCount).toBe(1);
  await openIndependentEchoRepair(p);
  await submit(p);
  const currentExercise = await completeCurrentFirstGroup(p);
  await assertCurrentJudge(p, currentExercise, 'passed');
  const completed = await native(p);
  expect(completed.progress.some((r) => r.eventType === 'lesson.completed')).toBe(true);
  expect(completed.progress.some((r) => r.eventType === 'exercise.passed')).toBe(true);
  await p.goto('/#/visualize/case.c.assignment');
  await waitForPhase2Archive(p);
  await p.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(p.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  await p.getByRole('button', { name: '预测挑战', exact: true }).click();
  await p
    .getByRole('group', { name: '本次挑战题目', exact: true })
    .getByRole('button')
    .first()
    .click();
  const id = await p.getByTestId('challenge-question').getAttribute('data-question-id'),
    question = questions.find((q) => q.ref.id === id)!;
  await p.locator(`[data-answer-kind="${question.anchorKind}"]`).click();
  await expect(p.getByTestId('challenge-feedback')).toContainText('本次答案已保存');
  const answered = await native(p);
  expect(answered.progress).toEqual(completed.progress);
  expect(answered.dailyFacts).toEqual(completed.dailyFacts);
  expect(
    answered.ledger.filter((r) => r.sourceId === 'reward.challenge.first-answer'),
  ).toHaveLength(1);
  await p.goto('/#/compare?pair=cpp-recursive');
  await waitForPhase2Archive(p);
  await p.getByTestId('pair-input').fill('7 -3 0 5 -3 2 9');
  await p.getByRole('button', { name: '应用共同输入', exact: true }).click();
  await p.getByRole('button', { name: '运行两份C++', exact: true }).click();
  await expect(p.getByTestId('recursive-comparison')).toHaveAttribute('data-phase', 'settled');
  for (const index of [0, 1])
    await expect(p.getByTestId(`pair-lane-${index}`)).toHaveAttribute('data-phase', 'accepted');
  await p.getByRole('slider', { name: 'C++对比统一步骤', exact: true }).fill('10');
  await expect(p.getByTestId('pair-lane-0')).toHaveAttribute('data-cursor', '10');
  await expect(p.getByTestId('pair-lane-1')).toHaveAttribute('data-cursor', '10');
  expect(await native(p)).toEqual(answered);
  await p.goto('/#/memory?example=nodes&view=memory');
  await waitForPhase2Archive(p);
  await p.getByRole('button', { name: '运行样例', exact: true }).click();
  const memory = p.getByTestId('memory-workspace');
  await expect(memory).toHaveAttribute('data-state', 'ready');
  const run = await memory.getAttribute('data-run-id'),
    slider = p.getByRole('slider', { name: '执行步骤', exact: true }),
    length = Number(await slider.getAttribute('max')),
    cursor = Math.floor(length / 2);
  expect(cursor).toBeGreaterThan(0);
  await slider.fill(String(cursor));
  await p.getByRole('button', { name: '调用栈视图', exact: true }).click();
  await expect(memory).toHaveAttribute('data-cursor', String(cursor));
  await expect(memory).toHaveAttribute('data-run-id', run!);
  await p.getByRole('button', { name: '内存视图', exact: true }).click();
  const download = p.waitForEvent('download');
  await p.getByRole('button', { name: '下载状态文件（JSON）', exact: true }).click();
  const file = await download;
  await file.saveAs(`${directory}/current-state.json`);
  const document = JSON.parse(
    readFileSync(`${directory}/current-state.json`, 'utf8'),
  ) as SnapshotDocument;
  expect(document.position.cursor).toBe(cursor);
  expect(document.currentState).toBeTruthy();
  await writeFile(
    `${directory}/memory-worker.json.gz`,
    gzipSync(JSON.stringify(await observedCaseSetExecute(p))),
    { flag: 'wx' },
  );
  expect(await native(p)).toEqual(answered);
  await p.goto('/#/');
  await p.reload();
  await waitForPhase2Archive(p);
  const restored = await native(p);
  expect(restored.progress).toEqual(answered.progress);
  expect(restored.ledger).toEqual(answered.ledger);
  expect(restored.reviewCards).toEqual(answered.reviewCards);
  expect(restored.meta.generation).toBe(answered.meta.generation);
  await writeFile(
    `${directory}/native-states.json`,
    JSON.stringify(
      { task: '16.10', completed, answered, restored, exportCursor: cursor, run },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  await p.screenshot({ path: `${directory}/restored-home.png`, fullPage: true });
});
