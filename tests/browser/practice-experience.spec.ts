import { currentProgramPath, discardCurrentDraft } from './current-c6-ui';
import { editorValue, expectEditorValue } from './editor-value';
import { expectCurrentSaved } from './current-c6-ui';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import type { Receipt } from '../../web/src/storage/model';
import { confirmCurrentLesson, openCurrentAnswer } from './current-course-helpers';
import { installC6Packets } from './c6-observation';
import { blockOptions, blockWorkspace, selectBlock } from './block-ui';
import {
  currentSnapshot as snapshot,
  currentLocalReady as localReady,
  assertCurrentJudge,
  assertCurrentRun,
  assertLearningEqual,
  currentJudgeCount,
  installCurrentReceiptFault,
  armCurrentReceiptFault,
  currentReceiptFault,
  installCurrentRunGate,
  heldCurrentResult,
} from './current-practice-observation';

const exercises = (
  JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
    chapters: { exercises: C6CourseExercise[] }[];
  }
).chapters
  .flatMap((c) => c.exercises)
  .slice(0, 6);
const e = exercises[0];
const editor = (p: Page) => p.getByLabel('完整 C 源码 · main.c', { exact: true });
const input = (p: Page) => p.getByLabel('本次试运行输入（ASCII，最多 256 字节）', { exact: true });
const saveStatus = (p: Page) => p.getByTestId('learning-save-status');
const judge = (p: Page) => p.getByRole('button', { name: '提交', exact: true });
const run = (p: Page) => p.getByRole('button', { name: '运行当前代码', exact: true });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(installC6Packets);
});
async function add(page: Page, kind: string) {
  const before = new Set(await blockOptions(page, /./));
  await blockWorkspace(page)
    .getByRole('combobox', { name: '添加积木类型', exact: true })
    .selectOption(kind);
  await blockWorkspace(page).getByRole('button', { name: '添加积木', exact: true }).click();
  await expect
    .poll(async () => (await blockOptions(page, /./)).filter((id) => !before.has(id)).length)
    .toBe(1);
  return (await blockOptions(page, /./)).find((id) => !before.has(id))!;
}
async function connect(page: Page, child: string, parent: string, slot: string) {
  await selectBlock(page, child);
  await blockWorkspace(page)
    .getByRole('combobox', { name: '连接到积木', exact: true })
    .selectOption(parent);
  await blockWorkspace(page)
    .getByRole('combobox', { name: '连接位置', exact: true })
    .selectOption(slot);
  await blockWorkspace(page).getByRole('button', { name: '连接选中积木', exact: true }).click();
  await expect(blockWorkspace(page).locator('.block-notice')).toHaveText('积木已连接。');
}
async function buildNativeOutput(page: Page) {
  await page.goto(currentProgramPath);
  await expect(editor(page)).toBeEditable();
  await input(page).fill('');
  const empty = '#include <stdio.h>\nint main(void){int probe=7;return 0;}';
  await editor(page).fill(empty);
  await page.getByRole('button', { name: '同步到积木', exact: true }).click();
  await expect(page.locator('.c6-block-pane')).toHaveAttribute('aria-busy', 'false');
  await expect(blockWorkspace(page)).toBeVisible();
  expect(await blockOptions(page, /^\d+\. 输出 ·/)).toEqual([]);
  const declared = await blockOptions(page, /^\d+\. 声明整数 · probe$/),
    returned = await blockOptions(page, /^\d+\. 返回$/);
  expect(declared).toHaveLength(1);
  expect(returned).toHaveLength(1);
  await selectBlock(page, returned[0]);
  await blockWorkspace(page).getByRole('button', { name: '断开选中积木', exact: true }).click();
  const print = await add(page, 'print');
  await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  await connect(page, print, declared[0], '$next');
  const read = await add(page, 'variable');
  await blockWorkspace(page).getByRole('textbox', { name: '变量名称', exact: true }).fill('probe');
  await connect(page, read, print, 'ARG0');
  await connect(page, returned[0], print, '$next');
  await expectEditorValue(editor(page), empty);
  await page.getByRole('button', { name: '应用生成代码', exact: true }).click();
  const text = await editorValue(editor(page));
  expect(text).toMatch(/printf\("%d\\n", probe\)/);
  return { text, empty, read, print };
}
async function saveDraft(page: Page) {
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('c6-draft-save-status')).toHaveText('草稿已保存');
  await localReady(page);
}

test('all six independent exercises start with only course inputs and reveal hints or correction drafts only by explicit choice', async ({
  page,
}, info) => {
  await page.goto('/#/');
  await localReady(page);
  const before = await snapshot(page),
    samples = [];
  for (const subject of exercises) {
    await page.goto(`/#/practice/${subject.ref.id}`);
    await expectEditorValue(editor(page), subject.starterSource);
    const empty = await editorValue(editor(page));
    const hints = page.locator('.c6-exercise-description details');
    await expect(hints).not.toHaveAttribute('open', '');
    await expect(hints.locator('ul')).not.toBeVisible();
    await hints.locator('summary').click();
    await expect(hints.locator('ul li')).toHaveCount(subject.hints.length);
    await expect(hints.locator('ul')).toBeVisible();
    for (const hint of subject.hints) await expect(hints).toContainText(hint);
    await expectEditorValue(editor(page), empty);
    await expect(page.locator('.c6-trace')).toHaveCount(0);
    expect(await currentJudgeCount(page)).toBe(0);
    assertLearningEqual(before, await snapshot(page));
    samples.push({ id: subject.ref.id, starter: empty, hints: subject.hints });
  }
  await info.attach('six-current-full-starters-and-active-help', {
    body: JSON.stringify(samples),
    contentType: 'application/json',
  });
});

test('an answer built from empty native blocks runs one group without saving and submits all real tests before the saved completion checklist advances', async ({
  page,
}, info) => {
  await confirmCurrentLesson(page, 'lesson.c6.s2.1');
  await confirmCurrentLesson(page, 'lesson.c6.s2.2.1');
  await page.goto(`/#/practice/${e.ref.id}`);
  await expectEditorValue(editor(page), e.starterSource);
  const draft = await buildNativeOutput(page),
    before = await snapshot(page);
  await run(page).click();
  await expect(page.locator('.c6-trace')).toBeVisible();
  await assertCurrentRun(page, draft.text, '');
  await page.getByRole('button', { name: '到本次末尾', exact: true }).click();
  await expect(page.getByLabel('当前游标标准输出')).toHaveText('7\n');
  assertLearningEqual(before, await snapshot(page));
  expect(before.progress.filter((r) => r.eventType === 'exercise.passed')).toEqual([]);
  expect(
    before.progress.filter(
      (r) => r.subjectRef.id === e.lessonRef.id && r.eventType === 'lesson.completed',
    ),
  ).toHaveLength(1);
  await discardCurrentDraft(page, `/#/practice/${e.ref.id}`);
  await editor(page).fill(e.referenceSource);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  await judge(page).click();
  await expect(page.getByTestId('oj-verdict').filter({ hasText: /^通过$/ })).toBeVisible();
  await expectCurrentSaved(page);
  await assertCurrentJudge(page, e, 'passed');
  const finished = await snapshot(page);
  expect(finished.progress.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(1);
  expect(finished.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(2);
  expect(finished.ledger.reduce((s, r) => s + (r.points ?? 0), 0)).toBe(35);
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.accept()),
    page.locator('.c6-workbench > a.text-link').click(),
  ]);
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read', 'true');
  await expect(page.getByRole('link', { name: /^下一小节：/ })).toBeVisible();
  await page.goto(`/#/practice/${e.ref.id}`);
  await page.reload();
  await expectEditorValue(editor(page), e.starterSource);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(finished);
  await info.attach('native-draft-run-and-real-four-case-completion', {
    body: JSON.stringify({ draft, before, finished }),
    contentType: 'application/json',
  });
});

test('a real pass remains visibly unsaved after a native receipt fault; explicit retry reuses that event and repeated submission cannot repeat awards', async ({
  page,
}, info) => {
  await installCurrentReceiptFault(page);
  await confirmCurrentLesson(page, 'lesson.c6.s2.1');
  await confirmCurrentLesson(page, 'lesson.c6.s2.2.1');
  await openCurrentAnswer(page, e.ref.id);
  const before = await snapshot(page);
  await armCurrentReceiptFault(page);
  await judge(page).click();
  await expect(page.getByTestId('oj-verdict').filter({ hasText: /^通过$/ })).toBeVisible();
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  await assertCurrentJudge(page, e, 'passed');
  assertLearningEqual(before, await snapshot(page));
  const original = (await currentReceiptFault(page)).attempted[0],
    workers = await currentJudgeCount(page);
  await saveStatus(page).getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await localReady(page);
  expect(await currentJudgeCount(page)).toBe(workers);
  const retried = await snapshot(page),
    receipt = retried.receipts.find((r) => r.eventType === 'exercise.passed')!;
  const a: Partial<Receipt> = { ...original },
    b: Partial<Receipt> = { ...receipt };
  delete a.committedRevision;
  delete b.committedRevision;
  expect(b).toEqual(a);
  expect(retried.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(2);
  await judge(page).click();
  await expectCurrentSaved(page);
  await assertCurrentJudge(page, e, 'passed');
  const repeated = await snapshot(page);
  expect(repeated.ledger).toEqual(retried.ledger);
  expect(repeated.dailyFacts).toEqual(retried.dailyFacts);
  expect(repeated.progress.map((r) => ({ ...r, lastAt: null }))).toEqual(
    retried.progress.map((r) => ({ ...r, lastAt: null })),
  );
  expect(repeated.receipts.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(2);
  await expect(page.getByRole('button', { name: '完成小节', exact: true })).toHaveCount(0);
  await info.attach('native-save-retry-and-repeat', {
    body: JSON.stringify({ before, original, retried, repeated }),
    contentType: 'application/json',
  });
});

test('independent and correction answers keep separate native drafts while invalid edits and switching modes withdraw the current run', async ({
  page,
}, info) => {
  await openCurrentAnswer(page, e.ref.id);
  const before = await snapshot(page),
    draft = await buildNativeOutput(page);
  await run(page).click();
  await expect(page.locator('.c6-trace')).toBeVisible();
  await assertCurrentRun(page, draft.text, '');
  await page.getByRole('button', { name: '撤销上次积木代码替换', exact: true }).click();
  await expectEditorValue(editor(page), draft.empty);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  await discardCurrentDraft(page, `/#/practice/${e.ref.id}`);
  const invalidA = 'int main( { current first raw draft\n';
  await editor(page).fill(invalidA);
  await saveDraft(page);
  const second = exercises[1],
    invalidB = 'int main( { current second raw draft\n';
  await page.goto(`/#/practice/${second.ref.id}`);
  await expectEditorValue(editor(page), second.starterSource);
  await editor(page).fill(invalidB);
  await saveDraft(page);
  await page.goto(`/#/practice/${e.ref.id}`);
  await expectEditorValue(editor(page), invalidA);
  await page.reload();
  await expectEditorValue(editor(page), invalidA);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  await page.goto(`/#/practice/${second.ref.id}`);
  await expectEditorValue(editor(page), invalidB);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  const after = await snapshot(page);
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(after[store]).toEqual(before[store]);
  expect(
    after.courseDrafts
      .map((r) => ({ id: r.documentId, source: r.source }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  ).toEqual(
    [
      { id: e.ref.id, source: invalidA },
      { id: second.ref.id, source: invalidB },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  );
  await info.attach('explicit-document-draft-isolation-and-invalidation', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
});

test('cancelling one held genuine run rejects its late result and a fresh one-group run recovers without learning effects', async ({
  page,
}, info) => {
  await installCurrentRunGate(page, 'run');
  await page.goto(currentProgramPath);
  await expect(editor(page)).toBeEditable();
  await editor(page).fill(e.referenceSource);
  await input(page).fill(e.tests[0].stdin);
  const before = await snapshot(page);
  await page.evaluate(() => {
    window.currentRunGate.armed = true;
  });
  await run(page).click();
  await expect.poll(() => page.evaluate(() => window.currentRunGate.held)).toBe(1);
  await page.getByRole('button', { name: '取消本次操作', exact: true }).click();
  await expect(run(page)).toBeEnabled();
  const held = await heldCurrentResult(page);
  expect(held.terminated).toBe(true);
  expect(held.request.source).toBe(e.referenceSource);
  await page.evaluate(() => window.currentRunGate.release());
  await page.waitForTimeout(100);
  await expect(page.locator('.c6-trace')).toHaveCount(0);
  assertLearningEqual(before, await snapshot(page));
  await run(page).click();
  await expect(page.locator('.c6-trace')).toBeVisible();
  const recovered = await assertCurrentRun(page, e.referenceSource, await editorValue(input(page)));
  expect(recovered.request.runId).not.toBe(held.request.runId);
  assertLearningEqual(before, await snapshot(page));
  expect((await snapshot(page)).progress.filter((r) => r.eventType === 'lesson.completed')).toEqual(
    [],
  );
  await info.attach('run-cancel-stale-recovery', {
    body: JSON.stringify({ held: held.request, recovered: recovered.request }),
    contentType: 'application/json',
  });
});
