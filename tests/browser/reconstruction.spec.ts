import { editorValue, expectEditorValue } from './editor-value';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import type { C6TeachingNode } from '../../web/src/content/c6-teaching-types';
import type { EditorSnapshot } from '../../web/src/storage/editor-history';
import type { Receipt } from '../../web/src/storage/model';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import {
  blockOptions,
  blockWorkspace,
  selectBlock,
  showPracticeBlocks,
  setBlockPreference,
} from './block-ui';
import { openIndependentRepair } from './current-course-helpers';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import {
  currentSnapshot as snapshot,
  currentLocalReady as localReady,
  assertLearningEqual,
  installCurrentReceiptFault,
  armCurrentReceiptFault,
  currentReceiptFault,
} from './current-practice-observation';

const book = JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
  chapters: { nodes: C6TeachingNode[]; exercises: C6CourseExercise[] }[];
};
const exercises = book.chapters.flatMap((c) => c.exercises).slice(0, 6),
  nodes = book.chapters.flatMap((c) => c.nodes);
const panel = (p: Page) => p.getByTestId('practice-execution');
const code = (p: Page) => p.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const history = (p: Page) => p.getByTestId('editor-history');
const action = (p: Page, name: string) => panel(p).getByRole('button', { name, exact: true });
async function rows(page: Page) {
  await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  return (await snapshot(page)).editHistory as EditorSnapshot[];
}
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
async function buildEcho(page: Page) {
  const original = await editorValue(code(page)),
    empty = original.replace(/\s*printf\("%d\\n", x\);/, '');
  expect(empty).not.toBe(original);
  await code(page).clear();
  await expectEditorValue(code(page), '');
  await code(page).fill(empty);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await showPracticeBlocks(page, { readOnly: false });
  expect(await blockOptions(page, /^\d+\. 输出 ·/)).toEqual([]);
  const input = await blockOptions(page, /^\d+\. 声明整数 · x$/),
    returned = await blockOptions(page, /^\d+\. 返回$/);
  expect(input).toHaveLength(1);
  expect(returned).toHaveLength(1);
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  await selectBlock(page, returned[0]);
  await blockWorkspace(page).getByRole('button', { name: '断开选中积木', exact: true }).click();
  const print = await add(page, 'print');
  await blockWorkspace(page)
    .getByRole('textbox', { name: '输出格式', exact: true })
    .fill('wrong=%d');
  await connect(page, print, input[0], '$next');
  const read = await add(page, 'variable');
  await blockWorkspace(page).getByRole('textbox', { name: '变量名称', exact: true }).fill('x');
  await connect(page, read, print, 'ARG0');
  await connect(page, returned[0], print, '$next');
  return { print, read, empty };
}
async function restore(page: Page, row: EditorSnapshot) {
  if ((await history(page).getAttribute('open')) === null)
    await history(page).locator('summary').click();
  await page.getByRole('combobox', { name: '历史版本', exact: true }).selectOption(row.entryId);
  await history(page).getByRole('button', { name: '恢复所选版本', exact: true }).click();
  await expectEditorValue(code(page), row.codeText);
  await expect
    .poll(async () =>
      (await rows(page)).some(
        (r) => r.reason === 'restore' && r.restoredFrom === row.entryId && r.state === row.state,
      ),
    )
    .toBe(true);
}

test('13.5 six configured references, exact native start, permissions and representative layout', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  await page.goto('/#/');
  await localReady(page);
  await expect.poll(async () => (await snapshot(page)).settings.goalTemplate).not.toBeNull();
  const before = await snapshot(page);
  for (const e of exercises) {
    await page.goto(`/#/lessons/${e.lessonRef.id}`);
    const node = nodes.find((n) => n.ref.id === e.sourceNodeRef.id)!;
    const expected = [...node.body.matchAll(/```c\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(expected.length).toBeGreaterThan(0);
    await expect(page.locator('.c6-teaching-reading')).toBeVisible();
    expect(
      await page.locator('.c6-teaching-reading code[data-language="c"]').allTextContents(),
    ).toEqual(expected);
    await expect(
      page.locator('.c6-teaching-reading textarea,.c6-teaching-reading [contenteditable="true"]'),
    ).toHaveCount(0);
    expect(await page.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
    expect(await snapshot(page)).toEqual(before);
  }
  await openIndependentRepair(page, 'exercise.c.bug-semicolon');
  await showPracticeBlocks(page, { readOnly: false });
  await blockOptions(page, /./);
  await expect(
    blockWorkspace(page)
      .getByRole('combobox', { name: '添加积木类型', exact: true })
      .locator('option[value="while"]'),
  ).toHaveAttribute('disabled', '');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await blockWorkspace(page).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`reference-${width}.png`), fullPage: true });
  }
  expect((await snapshot(page)).progress).toEqual([]);
});

test('13.5 native reconstruction: wrong answer, real pass, quota retry and shared first reward', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  await installCurrentReceiptFault(page);
  await openIndependentRepair(page, 'exercise.c.bug-semicolon');
  const built = await buildEcho(page);
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  expect((await snapshot(page)).ledger).toEqual([]);
  await selectBlock(page, built.print);
  await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  const before = await snapshot(page);
  await armCurrentReceiptFault(page);
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
    'data-save-state',
    'unsaved',
  );
  assertLearningEqual(before, await snapshot(page));
  const original = (await currentReceiptFault(page)).attempted.find(
    (r) => r.eventType === 'exercise.passed',
  )!;
  await page.getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await localReady(page);
  const first = await snapshot(page),
    receipt = first.receipts.find((r) => r.eventType === 'exercise.passed')!;
  const a: Partial<Receipt> = { ...original },
    b: Partial<Receipt> = { ...receipt };
  delete a.committedRevision;
  delete b.committedRevision;
  expect(b).toEqual(a);
  expect(first.ledger).toHaveLength(1);
  expect(first.ledger[0]).toMatchObject({ sourceId: 'reward.exercise.first-pass', points: 10 });
  expect(first.progress.filter((r) => r.eventType === 'lesson.completed')).toEqual([]);
  await action(page, '提交练习').click();
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  const raw = await observedCaseSetExecute(page),
    request = JSON.parse(Buffer.from(raw.requestBytes!).toString('utf8')) as ExecuteRequest,
    result = await decodeResult(Uint8Array.from(raw.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.judgeResult?.status).toBe('met');
  expect(request.remainingMs).toBeGreaterThan(0);
  expect(request.remainingMs).toBeLessThanOrEqual(1000);
  for (const id of [built.print, built.read]) {
    // Blockly can generate IDs that already satisfy the wire grammar.
    const expected = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(id)
      ? id
      : `block.native.${Buffer.from(id, 'utf8').toString('hex')}`;
    expect(request.source.blockMap.map((m) => m.blockId)).toContain(expected);
  }
  const full = await editorValue(code(page));
  await setBlockPreference(page, 'hide');
  await code(page).clear();
  await expectEditorValue(code(page), '');
  await code(page).fill(full);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await action(page, '提交练习').click();
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  expect((await snapshot(page)).ledger).toEqual(first.ledger);
  await info.attach('actual-native-reconstruction-and-shared-right', {
    body: JSON.stringify({ request, result, built, first, repeat: await snapshot(page) }),
    contentType: 'application/json',
  });
});

test('13.5 isolated drafts and native history survive refresh while display preference and old execution stay correct', async ({
  page,
}) => {
  test.setTimeout(60000);
  await observeCaseSetExecution(page);
  await openIndependentRepair(page, 'exercise.c.bug-semicolon');
  await setBlockPreference(page, 'hide');
  expect((await snapshot(page)).appearance.blockWorkspace).toBe('hide');
  const full = await editorValue(code(page));
  const valid = (await rows(page))
    .filter((r) => r.codeText === full && r.state === 'synced')
    .sort((a, b) => b.sequence - a.sequence)[0];
  expect(valid).toBeDefined();
  const invalid = full + '\nint';
  await code(page).fill(invalid);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'invalid');
  const invalidRow = (await rows(page)).find(
    (r) => r.codeText === invalid && r.state === 'invalid',
  )!;
  expect(invalidRow).toBeDefined();
  await openIndependentRepair(page, 'exercise.c.bug-parenthesis', { blocks: false });
  await expect
    .poll(
      async () =>
        (await rows(page)).filter((r) => r.scope.exerciseRef.id === 'exercise.c.bug-parenthesis')
          .length,
    )
    .toBeGreaterThan(0);
  const otherRows = await rows(page);
  expect(otherRows.some((r) => r.scope.exerciseRef.id === 'exercise.c.bug-semicolon')).toBe(true);
  await history(page).locator('summary').click();
  await expect(page.getByRole('combobox', { name: '历史版本', exact: true })).toBeVisible();
  const options = await page
    .getByRole('combobox', { name: '历史版本', exact: true })
    .locator('option')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  expect(options.length).toBeGreaterThan(0);
  expect(
    options.every(
      (id) =>
        otherRows.find((r) => r.entryId === id)?.scope.exerciseRef.id ===
        'exercise.c.bug-parenthesis',
    ),
  ).toBe(true);
  await page.goto('/#/practice/exercise.c.bug-semicolon');
  await expect(code(page)).toBeEditable();
  expect((await snapshot(page)).appearance.blockWorkspace).toBe('hide');
  await showPracticeBlocks(page, { readOnly: false });
  await restore(page, valid);
  await action(page, '运行本组').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  await restore(page, invalidRow);
  await expect(page.getByTestId('player-controls')).toHaveCount(0);
  await expect(action(page, '运行本组')).toBeDisabled();
  await setBlockPreference(page, 'hide');
  await page.reload();
  await expectEditorValue(code(page), full, { not: true });
  expect((await snapshot(page)).appearance.blockWorkspace).toBe('hide');
  await restore(page, invalidRow);
  await expectEditorValue(code(page), invalid);
  await restore(page, valid);
  await showPracticeBlocks(page, { readOnly: false });
  await action(page, '提交练习').click();
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  expect((await snapshot(page)).ledger.reduce((n, r) => n + (r.points ?? 0), 0)).toBe(10);
});
