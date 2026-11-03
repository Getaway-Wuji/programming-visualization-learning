import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { openCurrentAnswer, openIndependentRepair } from './current-course-helpers';
import { installC6Packets } from './c6-observation';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import {
  currentSnapshot as snapshot,
  currentLocalReady as localReady,
  assertCurrentJudge,
  assertNoExecutionPersistence,
  assertLearningEqual,
  currentJudgeCount,
  installCurrentRunGate,
  heldCurrentResult,
} from './current-practice-observation';

const oldIds = [
  'exercise.c.echo',
  'exercise.c.two-x-plus-three',
  'exercise.c.nonnegative',
  'exercise.c.two-loop-sums',
  'exercise.c.increment-at-index',
  'exercise.c.array-sum',
];
const exercises = (
  JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
    chapters: { exercises: C6CourseExercise[] }[];
  }
).chapters
  .flatMap((c) => c.exercises)
  .slice(0, 6);
const editor = (p: Page) => p.getByLabel('完整 C 源码 · main.c', { exact: true });
const panel = (p: Page) => p.getByTestId('practice-execution');
const action = (p: Page) => p.getByRole('button', { name: '判定全部四组', exact: true });
const exercise = exercises[0];
test.beforeEach(async ({ context }) => {
  await context.addInitScript(installC6Packets);
});
async function saved(page: Page) {
  await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
  await localReady(page);
}
async function submit(page: Page) {
  await action(page).click();
  await expect(page.getByRole('heading', { name: '四组全部通过', exact: true })).toBeVisible();
  await saved(page);
  return assertCurrentJudge(page, exercise, 'passed');
}

for (const [index, e] of exercises.entries()) {
  test(`${oldIds[index]}: real Rust rejects an incorrect answer and accepts all frozen tests with explanation and no learning writes`, async ({
    page,
  }, info) => {
    info.annotations.push({
      type: 'current-course-carrier',
      description: `Retired regression carrier ${oldIds[index]} now checks actual ${e.ref.id}; new C6 SAVE10 receipts are required, not the old temporary/no-write mode.`,
    });
    const requests: { url: string; method: string; body: string | null }[] = [];
    page.on('request', (r) =>
      requests.push({ url: r.url(), method: r.method(), body: r.postData() }),
    );
    await page.goto('/#/');
    await localReady(page);
    const before = await snapshot(page);
    await page.goto(`/#/practice/${e.ref.id}`);
    await expect(editor(page)).toHaveValue(e.starterSource);
    const wrong = e.referenceSource.replace('printf("', 'printf("wrong=');
    expect(wrong).not.toBe(e.referenceSource);
    await editor(page).fill(wrong);
    await action(page).click();
    await expect(page.getByRole('heading', { name: '本次尚未通过', exact: true })).toBeVisible();
    await saved(page);
    const failed = await assertCurrentJudge(page, e, 'failed', wrong);
    await expect(page.getByRole('button', { name: /第 1 组 · 待修正/ })).toBeVisible();
    await expect(page.locator('.c6-result-pane')).toContainText('输出：不符');
    const failedState = await snapshot(page);
    expect(failedState.ledger).toEqual(before.ledger);
    expect(failedState.dailyFacts).toEqual(before.dailyFacts);
    expect(
      failedState.progress.filter(
        (p) => p.eventType === 'exercise.passed' || p.eventType === 'lesson.completed',
      ),
    ).toEqual([]);
    expect(failedState.receipts).toHaveLength(1);
    expect(failedState.receipts[0]).toMatchObject({
      eventType: 'exercise.attempt-evaluated',
      subjectRef: e.ref,
      result: 'failed',
      failedCaseKey: 'case-1',
    });
    await editor(page).fill(e.referenceSource);
    await expect(page.locator('.c6-trace')).toHaveCount(0);
    await action(page).click();
    await expect(page.getByRole('heading', { name: '四组全部通过', exact: true })).toBeVisible();
    await saved(page);
    const passed = await assertCurrentJudge(page, e, 'passed');
    expect(passed.request.runId).not.toBe(failed.request.runId);
    expect(passed.request.sourceRevision).not.toBe(failed.request.sourceRevision);
    await page.getByRole('button', { name: '第 4 组 · 通过', exact: true }).click();
    await page.getByRole('button', { name: '到本次末尾', exact: true }).click();
    await expect(page.getByLabel('当前游标标准输出')).toHaveText(e.tests[3].expectedStdout);
    await expect(editor(page)).toHaveValue(passed.request.source);
    const after = await snapshot(page);
    expect(after.progress.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(1);
    expect(after.progress.filter((r) => r.eventType === 'lesson.completed')).toEqual([]);
    expect(after.ledger).toHaveLength(1);
    expect(after.ledger[0]).toMatchObject({
      sourceId: 'reward.exercise.first-pass',
      points: 10,
      status: 'posted',
    });
    assertNoExecutionPersistence(after, [wrong, e.referenceSource], exercises);
    expect(
      requests.some((r) => new URL(r.url).pathname.includes('/content/c/primer6-teaching/')),
    ).toBe(true);
    for (const r of requests) {
      const url = new URL(r.url);
      expect(url.origin).toBe(new URL(page.url()).origin);
      expect(url.search).toBe('');
      expect(r.method).toBe('GET');
      expect(r.body).toBeNull();
    }
  });
}

test('same exercise review and return preserve one accepted trace and cursor; edit, leaving and refresh destroy it', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await openIndependentRepair(page, 'exercise.c.bug-semicolon');
  const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  const source = await code.inputValue();
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  const raw = await observedCaseSetExecute(page),
    request = JSON.parse(Buffer.from(raw.requestBytes!).toString('utf8')) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(raw.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.judgeResult?.status).toBe('met');
  const count = await page.evaluate(
    () => window.__verticalObservation.workers.filter((w) => w.kind === 'execute').length,
  );
  expect(count).toBe(4);
  const controls = page.getByTestId('player-controls');
  await controls.getByRole('button', { name: '前进', exact: true }).click();
  const cursor = await controls.getAttribute('data-cursor');
  await panel(page).getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  await expect(page.getByTestId('trace-view')).toBeInViewport({ ratio: 0.75 });
  await expect(page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true })).toHaveValue(
    request.source.text,
  );
  await expect(
    page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }),
  ).toHaveAttribute('readonly', '');
  const saved = await snapshot(page);
  await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  expect(
    await page.evaluate(
      () => window.__verticalObservation.workers.filter((w) => w.kind === 'execute').length,
    ),
  ).toBe(count);
  await code.clear();
  await expect(code).toHaveValue('');
  await code.fill(source.replace('printf("%d', 'printf("wrong=%d'));
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await panel(page).getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await expect(page.getByText(/还没有可复盘的运行/)).toBeVisible();
  await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
  await openIndependentRepair(page, 'exercise.c.bug-semicolon');
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await page.goto('/#/courses');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('课程目录');
  await page.goto('/#/practice/exercise.c.bug-semicolon/review');
  await expect(page.getByText(/还没有可复盘的运行/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/还没有可复盘的运行/)).toBeVisible();
  await expect(page.getByTestId('trace-view')).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.ledger).toEqual(saved.ledger);
  expect(after.dailyFacts).toEqual(saved.dailyFacts);
});

test('another page clearing local data destroys the accepted practice session and never restores it passively', async ({
  page,
  context,
}) => {
  await openCurrentAnswer(page, exercise.ref.id);
  await submit(page);
  const before = await snapshot(page);
  const count = await currentJudgeCount(page);
  const settings = await context.newPage();
  await settings.goto('/#/settings?panel=data');
  await localReady(settings);
  await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await settings
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  const cleared = await snapshot(page);
  expect(cleared.meta.generation).not.toBe(before.meta.generation);
  for (const name of [
    'progress',
    'receipts',
    'ledger',
    'dailyFacts',
    'courseActivities',
    'courseDrafts',
  ] as const)
    expect(cleared[name]).toEqual([]);
  await page.waitForTimeout(250);
  expect(await currentJudgeCount(page)).toBe(count);
  expect(await snapshot(page)).toEqual(cleared);
  await settings.close();
});

test('cancel drops a held real result and a fresh visible submission recovers', async ({
  page,
}, testInfo) => {
  await installCurrentRunGate(page);
  await openCurrentAnswer(page, exercise.ref.id);
  const before = await snapshot(page);
  await page.evaluate(() => {
    window.currentRunGate.armed = true;
  });
  await action(page).click();
  await expect.poll(() => page.evaluate(() => window.currentRunGate.held)).toBe(1);
  await page.getByRole('button', { name: '取消本次操作', exact: true }).click();
  await expect(action(page)).toBeEnabled();
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  const held = await heldCurrentResult(page);
  expect(held.terminated).toBe(true);
  expect(held.request.source).toBe(exercise.referenceSource);
  if (!('cases' in held.result)) throw Error('Genuine held judge required');
  expect(held.result.status).toBe('passed');
  await page.evaluate(() => window.currentRunGate.release());
  await page.waitForTimeout(100);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  assertLearningEqual(before, await snapshot(page));
  const recovered = await submit(page);
  expect(recovered.request.runId).not.toBe(held.request.runId);
  expect((await snapshot(page)).ledger).toHaveLength(1);
  await testInfo.attach('cancel-fault-scope', {
    body: 'One unchanged real C6 Rust response was held before its production handler; public cancel terminated it, late delivery did not write, and a new real submission recovered.',
    contentType: 'text/plain',
  });
});

test('a withheld real result expires under the original submission deadline and retry receives a new identity', async ({
  page,
}, testInfo) => {
  await installCurrentRunGate(page);
  await openCurrentAnswer(page, exercise.ref.id);
  const before = await snapshot(page);
  await page.evaluate(() => {
    window.currentRunGate.armed = true;
  });
  await action(page).click();
  await expect.poll(() => page.evaluate(() => window.currentRunGate.held)).toBe(1);
  await expect(page.getByRole('alert')).toContainText('E_DEADLINE');
  await expect(action(page)).toBeEnabled();
  const held = await heldCurrentResult(page);
  expect(held.terminated).toBe(true);
  if (!('cases' in held.result)) throw Error('Genuine held judge required');
  expect(held.result.status).toBe('passed');
  await page.evaluate(() => window.currentRunGate.release());
  await page.waitForTimeout(100);
  await expect(page.getByRole('alert')).toContainText('E_DEADLINE');
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  assertLearningEqual(before, await snapshot(page));
  const recovered = await submit(page);
  expect(recovered.request.runId).not.toBe(held.request.runId);
  expect(recovered.request.sourceRevision).toBe(held.request.sourceRevision);
  await testInfo.attach('deadline-fault-scope', {
    body: 'The actual unchanged four-case response was withheld past the original 1000ms deadline. Terminated late delivery wrote no learning; retry used a new run identity.',
    contentType: 'text/plain',
  });
});

test('a missing practice release fails closed and its visible retry loads only the approved projection', async ({
  page,
}, testInfo) => {
  await page.goto('/#/');
  await localReady(page);
  await expect.poll(async () => (await snapshot(page)).settings.goalTemplate).not.toBeNull();
  const before = await snapshot(page);
  const resource = '**/content/c/primer6-teaching/manifest-2.0.0.json';
  await page.route(resource, (r) =>
    r.fulfill({ status: 404, body: 'Explicit current manifest missing' }),
  );
  await page.goto(`/#/practice/${exercise.ref.id}`);
  await page.reload();
  await expect(page.getByRole('heading', { name: '课程暂时无法读取', exact: true })).toBeVisible();
  await expect(action(page)).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await page.unroute(resource);
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await expect(editor(page)).toHaveValue(exercise.starterSource);
  assertLearningEqual(before, await snapshot(page));
  expect(await currentJudgeCount(page)).toBe(0);
  await testInfo.attach('projection-fault-scope', {
    body: 'Only the current manifest GET was HTTP404. Recovery loaded the original reviewed CONTENT3 bytes; no historical app or old ordinary exercise was substituted.',
    contentType: 'text/plain',
  });
});
