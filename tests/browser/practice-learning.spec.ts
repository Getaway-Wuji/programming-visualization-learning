import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import type { Receipt } from '../../web/src/storage/model';
import { decodeC6Response, type C6RunRequest } from '../../web/src/engine/c6-protocol';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';
import { blockOptions, blockWorkspace, selectBlock } from './block-ui';
import { confirmCurrentLesson, openCurrentAnswer } from './current-course-helpers';
import { installC6Packets, observedC6Packet } from './c6-observation';
import {
  currentSnapshot as snapshot,
  currentLocalReady as localReady,
  assertCurrentJudge,
  assertNoExecutionPersistence,
  assertLearningEqual,
  currentJudgeCount,
  installCurrentReceiptFault,
  armCurrentReceiptFault,
  currentReceiptFault,
} from './current-practice-observation';

const exercises = (
  JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
    chapters: { exercises: C6CourseExercise[] }[];
  }
).chapters
  .flatMap((c) => c.exercises)
  .slice(0, 6);
const exercise = exercises[0];
const editor = (page: Page) => page.getByLabel('完整 C 源码 · main.c', { exact: true });
const saveStatus = (page: Page) => page.getByTestId('learning-save-status');
const wrongSource = exercise.referenceSource.replace('printf("n=%d', 'printf("wrong=%d');
if (wrongSource === exercise.referenceSource)
  throw Error('Exact current wrong-output fixture required');
test.beforeEach(async ({ context }) => {
  await context.addInitScript(installC6Packets);
});
async function submit(
  page: Page,
  status: 'passed' | 'failed' = 'passed',
  source = exercise.referenceSource,
  subject = exercise,
) {
  await page.getByRole('button', { name: '判定全部四组', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: status === 'passed' ? '四组全部通过' : '本次尚未通过',
      exact: true,
    }),
  ).toBeVisible();
  return assertCurrentJudge(page, subject, status, source);
}
async function savedPass(page: Page) {
  await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
  await localReady(page);
}
async function confirmGroup(page: Page) {
  await confirmCurrentLesson(page, 'lesson.c6.s2.1');
  await confirmCurrentLesson(page, 'lesson.c6.s2.2.1');
}
async function clear(page: Page) {
  await page.goto('/#/settings?panel=data');
  await localReady(page);
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(saveStatus(page)).toContainText('本地数据已清除');
}
async function evidence(info: TestInfo, label: string, value: unknown) {
  const dir = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '11.2',
    'regression',
    'practice-learning',
    process.env.TASK_EVIDENCE_LABEL ?? 'current',
    info.project.name,
    label,
  );
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'native-ui.json');
  await writeFile(path, JSON.stringify(value, null, 2));
  await info.attach(label, { path, contentType: 'application/json' });
}
/** Current full-source mapping is exercised with a supported integer draft.
 * Book stdin programs remain complete code-only documents; no scanf is erased. */
async function nativeDraft(page: Page) {
  const before = await snapshot(page);
  await editor(page).fill(
    '#include <stdio.h>\nint main(void){int probe=1;printf("%d\\n",probe);return 0;}',
  );
  await page.getByRole('button', { name: '同步到积木', exact: true }).click();
  await expect(blockWorkspace(page)).toBeVisible();
  const ids = await blockOptions(page, /^\d+\. 整数 · 1$/);
  expect(ids).toHaveLength(1);
  await selectBlock(page, ids[0]);
  await blockWorkspace(page).getByRole('textbox', { name: '整数值', exact: true }).fill('2');
  await expect(page.getByText('积木生成的完整程序预览', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '应用生成代码', exact: true }).click();
  const source = await editor(page).inputValue();
  expect(source).toMatch(/probe\s*=\s*2/);
  await page.getByRole('button', { name: '运行当前代码', exact: true }).click();
  await expect(page.locator('.c6-trace')).toBeVisible();
  const raw = await observedC6Packet(page);
  expect(raw).toMatchObject({ moduleSeen: true, terminated: true });
  const request = JSON.parse(Buffer.from(raw.request!, 'base64').toString('utf8')) as C6RunRequest;
  expect(request.source).toBe(source);
  const result = await decodeC6Response(
    Uint8Array.from(Buffer.from(raw.response!, 'base64')).buffer,
    request,
    engineBuild.wasmSha256,
  );
  if ('cases' in result || 'editVersion' in result) throw Error('Actual standalone run required');
  expect(result.terminal.status).toBe('completed');
  await page.getByRole('button', { name: '到本次末尾', exact: true }).click();
  await expect(page.getByLabel('当前游标标准输出')).toHaveText('2\n');
  assertLearningEqual(before, await snapshot(page));
}

test('a new local archive completes six lessons through native block edits, 24 real groups, review, course return and readonly refresh', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/#/');
  await localReady(page);
  const initial = await snapshot(page);
  expect(initial.progress).toEqual([]);
  expect(initial.receipts).toEqual([]);
  await confirmCurrentLesson(page, 'lesson.c6.s2.2.1');
  const states = [],
    runs = [];
  for (const [i, e] of exercises.entries()) {
    await confirmCurrentLesson(page, e.lessonRef.id);
    const link = page.getByRole('link', { name: '完成配套执行练习', exact: true });
    await expect(link).toHaveAttribute('href', `#/practice/${e.ref.id}`);
    await link.click();
    await expect(editor(page)).toHaveValue(e.starterSource);
    if (i === 0) await nativeDraft(page);
    await editor(page).fill(e.referenceSource);
    const run = await submit(page, 'passed', e.referenceSource, e);
    await savedPass(page);
    runs.push(run);
    const count = await currentJudgeCount(page),
      before = await snapshot(page);
    for (let n = 0; n < 4; n++) {
      await page.getByRole('button', { name: `第 ${n + 1} 组 · 通过`, exact: true }).click();
      const trace = page.getByRole('region', { name: '真实执行轨迹', exact: true });
      await expect(trace).toHaveAttribute('data-cursor', '0');
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await expect(trace).toHaveAttribute('data-cursor', '1');
      await page.getByRole('button', { name: '上一步', exact: true }).click();
      await expect(trace).toHaveAttribute('data-cursor', '0');
      await page.getByRole('button', { name: '到本次末尾', exact: true }).click();
      await expect(page.getByLabel('当前游标标准输出')).toHaveText(e.tests[n].expectedStdout);
    }
    expect(await currentJudgeCount(page)).toBe(count);
    expect(await snapshot(page)).toEqual(before);
    await page.locator('.c6-workbench > a.text-link').click();
    await expect(page.locator('.c6-reading-confirmation')).toContainText('本节已完成');
    const state = await snapshot(page);
    assertNoExecutionPersistence(
      state,
      exercises.map((e) => e.referenceSource),
      exercises,
    );
    states.push(state);
  }
  expect(runs.flatMap((r) => r.result.cases)).toHaveLength(24);
  const finished = await snapshot(page);
  expect(finished.progress.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(6);
  expect(finished.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(7);
  expect(finished.ledger).toHaveLength(6);
  expect(finished.ledger.reduce((s, r) => s + (r.points ?? 0), 0)).toBe(65);
  expect(finished.dailyFacts).toHaveLength(13);
  expect(new Set(finished.receipts.map((r) => r.eventId)).size).toBe(finished.receipts.length);
  await page.goto('/#/');
  await expect(page.getByText('7 / 404 个小节已完成', { exact: true })).toBeVisible();
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(finished);
  await page.goto(`/#/practice/${exercise.ref.id}`);
  await expect(editor(page)).toHaveValue(exercise.starterSource);
  await expect(
    page.getByText('已保存首次通过记录。当前代码的运行和判题结果显示在下方。', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(finished);
  await evidence(testInfo, 'six-current-lessons-24-groups', { initial, states, finished, runs });
});

test('passing before study confirmation stays incomplete; later failures preserve history and repeated real passes deduplicate rights', async ({
  page,
}, testInfo) => {
  await openCurrentAnswer(page, exercise.ref.id);
  await submit(page);
  await savedPass(page);
  const passed = await snapshot(page);
  expect(passed.progress.map((r) => r.eventType)).toEqual(['exercise.passed']);
  await confirmCurrentLesson(page, exercise.lessonRef.id);
  await expect(page.locator('.c6-reading-confirmation')).toContainText('本节已完成');
  await confirmCurrentLesson(page, 'lesson.c6.s2.2.1');
  const complete = await snapshot(page);
  await openCurrentAnswer(page, exercise.ref.id);
  await editor(page).fill(wrongSource);
  await submit(page, 'failed', wrongSource);
  await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
  const failed = await snapshot(page);
  expect(failed.ledger).toEqual(complete.ledger);
  expect(failed.dailyFacts).toEqual(complete.dailyFacts);
  expect(failed.progress.filter((r) => r.eventType !== 'exercise.attempt-evaluated')).toEqual(
    complete.progress,
  );
  expect(failed.progress.filter((r) => r.eventType === 'exercise.attempt-evaluated')).toEqual([
    expect.objectContaining({
      subjectRef: exercise.ref,
      result: 'failed',
      failedCaseKey: 'case-1',
      resultCategory: 'wrong-answer',
    }),
  ]);
  const first = complete.courseActivities.find((r) => r.kind === 'exercise')!;
  const after = failed.courseActivities.find((r) => r.kind === 'exercise')!;
  if (first.kind !== 'exercise' || after.kind !== 'exercise')
    throw Error('Actual exercise activities required');
  expect(after.firstPass).toEqual(first.firstPass);
  expect(after.latestAttempt.status).toBe('failed');
  await editor(page).fill(exercise.referenceSource);
  await submit(page);
  await savedPass(page);
  const repeated = await snapshot(page);
  expect(repeated.ledger).toEqual(complete.ledger);
  expect(repeated.dailyFacts).toEqual(complete.dailyFacts);
  expect(repeated.receipts.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(2);
  expect(
    repeated.receipts.filter((r) => r.eventType === 'exercise.attempt-evaluated'),
  ).toHaveLength(1);
  expect(repeated.progress.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(1);
  expect(repeated.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(2);
  assertNoExecutionPersistence(repeated, [exercise.referenceSource, wrongSource], exercises);
  await evidence(testInfo, 'pass-confirm-repeat', { passed, complete, failed, repeated });
});

test('a native quota abort saves no partial pass and retries the original accepted event after editing and leaving the workspace', async ({
  page,
}, testInfo) => {
  await installCurrentReceiptFault(page);
  await confirmGroup(page);
  await openCurrentAnswer(page, exercise.ref.id);
  const before = await snapshot(page);
  await armCurrentReceiptFault(page);
  await submit(page);
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  const failed = await snapshot(page);
  assertLearningEqual(before, failed);
  const original = (await currentReceiptFault(page)).attempted[0];
  expect(original.eventType).toBe('exercise.passed');
  const count = await currentJudgeCount(page);
  await editor(page).fill(wrongSource);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  await page.goto('/#/');
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  await saveStatus(page).getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await localReady(page);
  expect(await currentJudgeCount(page)).toBe(count);
  const retried = await snapshot(page);
  const received = retried.receipts.find((r) => r.eventType === 'exercise.passed')!;
  const a: Partial<Receipt> = { ...original },
    b: Partial<Receipt> = { ...received };
  delete a.committedRevision;
  delete b.committedRevision;
  expect(b).toEqual(a);
  expect(retried.ledger).toHaveLength(3);
  expect(retried.dailyFacts).toHaveLength(3);
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(retried);
  assertNoExecutionPersistence(retried, [exercise.referenceSource], exercises);
  await evidence(testInfo, 'native-quota-original-retry', { before, failed, original, retried });
});

test('cross-page clear removes real saved history and a pending accepted retry without revival', async ({
  page,
  context,
}, testInfo) => {
  await installCurrentReceiptFault(page);
  await confirmGroup(page);
  await openCurrentAnswer(page, exercise.ref.id);
  await submit(page);
  await savedPass(page);
  const saved = await snapshot(page);
  await armCurrentReceiptFault(page);
  await submit(page);
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  const settings = await context.newPage();
  await clear(settings);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  await expect(
    saveStatus(page).getByRole('button', { name: '重试未保存操作', exact: true }),
  ).toHaveCount(0);
  const cleared = await snapshot(page);
  expect(cleared.meta.generation).not.toBe(saved.meta.generation);
  for (const store of [
    'progress',
    'receipts',
    'ledger',
    'dailyFacts',
    'courseActivities',
    'courseDrafts',
  ] as const)
    expect(cleared[store]).toEqual([]);
  await page.reload();
  await expect(editor(page)).toHaveValue(exercise.starterSource);
  await localReady(page);
  expect(await snapshot(page)).toEqual(cleared);
  await evidence(testInfo, 'native-clear-real-history-and-pending', { saved, cleared });
  await settings.close();
});

test('missing practice learning authorization keeps successful judgement temporary and explicit recovery requires a fresh accepted submission', async ({
  page,
}, testInfo) => {
  const authorization = '**/content/c/primer6-teaching/manifest-2.0.0.json';
  await page.route(authorization, (r) =>
    r.fulfill({ status: 503, body: 'Explicit current manifest unavailable' }),
  );
  await page.goto(`/#/practice/${exercise.ref.id}`);
  await expect(page.getByRole('button', { name: '重试读取', exact: true })).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '判定全部四组', exact: true })).toHaveCount(0);
  expect(await currentJudgeCount(page)).toBe(0);
  // Activation fails before opening the learning archive. Inspect the database
  // inventory instead of creating an empty database with indexedDB.open.
  const before = await page.evaluate(() => indexedDB.databases());
  expect(before.some((db) => db.name === 'c-viz-learning')).toBe(false);
  await page.unroute(authorization);
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await expect(editor(page)).toHaveValue(exercise.starterSource);
  expect(await currentJudgeCount(page)).toBe(0);
  const ready = await snapshot(page);
  expect(ready.progress).toEqual([]);
  expect(ready.receipts).toEqual([]);
  expect(ready.ledger).toEqual([]);
  await editor(page).fill(exercise.referenceSource);
  await submit(page);
  await savedPass(page);
  const recovered = await snapshot(page);
  expect(recovered.progress.map((r) => r.eventType)).toEqual(['exercise.passed']);
  assertNoExecutionPersistence(recovered, [exercise.referenceSource], exercises);
  await evidence(testInfo, 'current-authorization-fail-closed-and-recovery', { before, recovered });
});

test('two production pages passing the same exercise merge their receipts and share one first right and daily fact', async ({
  page,
  context,
}, testInfo) => {
  const other = await context.newPage();
  await openCurrentAnswer(page, exercise.ref.id);
  await openCurrentAnswer(other, exercise.ref.id);
  await Promise.all(
    [page, other].map((p) => p.getByRole('button', { name: '判定全部四组', exact: true }).click()),
  );
  await savedPass(page);
  await savedPass(other);
  await assertCurrentJudge(page, exercise, 'passed');
  await assertCurrentJudge(other, exercise, 'passed');
  const merged = await snapshot(page);
  expect(merged.receipts).toHaveLength(2);
  expect(new Set(merged.receipts.map((r) => r.eventId)).size).toBe(2);
  expect(merged.progress).toHaveLength(1);
  expect(merged.dailyFacts).toHaveLength(1);
  expect(merged.ledger).toHaveLength(1);
  expect(merged.progress[0].eventType).toBe('exercise.passed');
  assertNoExecutionPersistence(merged, [exercise.referenceSource], exercises);
  await evidence(testInfo, 'native-concurrent-same-exercise', merged);
  await other.close();
});
