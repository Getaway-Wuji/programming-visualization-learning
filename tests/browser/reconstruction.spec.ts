import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { reconstructionQuestions } from '../../web/src/practice/reconstruction';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
import { blockOptions, blockWorkspace, selectBlock } from './block-ui';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import type { EditorSnapshot } from '../../web/src/storage/editor-history';
import type { LedgerEntry, Progress } from '../../web/src/storage/model';

const panel = (page: Page) => page.getByTestId('practice-execution');
const source = (page: Page) =>
  page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
const action = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
const history = (page: Page) => page.getByTestId('editor-history');
const saved = p05CourseRelease.registered ? 'saved' : 'unavailable';
async function open(page: Page, id = 'exercise.c.echo') {
  await page.goto(`/#/practice/${id}?mode=reconstruction`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('button', { name: '拆积木练习', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  await expect(action(page, '提交练习')).toBeEnabled();
  await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
}
async function archive(page: Page) {
  await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = ['editHistory', 'progress', 'ledger'];
      const tx = db.transaction(names);
      return Object.fromEntries(
        await Promise.all(
          names.map(async (name) => [
            name,
            await new Promise((resolve, reject) => {
              const r = tx.objectStore(name).getAll();
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            }),
          ]),
        ),
      ) as { editHistory: EditorSnapshot[]; progress: Progress[]; ledger: LedgerEntry[] };
    } finally {
      db.close();
    }
  });
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
  expect(await blockOptions(page, /^\d+\. 输出 ·/)).toEqual([]);
  const inputs = await blockOptions(page, /^\d+\. 声明整数 · x$/);
  expect(inputs).toHaveLength(1);
  const print = await add(page, 'print');
  await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  await connect(page, print, inputs[0], '$next');
  const variable = await add(page, 'variable');
  await blockWorkspace(page).getByRole('textbox', { name: '变量名称', exact: true }).fill('x');
  await connect(page, variable, print, 'ARG0');
  await expect(source(page)).toHaveValue(/printf\("%d\\n", x\)/);
  await expect(action(page, '提交练习')).toBeEnabled();
  return print;
}
async function restore(page: Page, id: string) {
  const details = history(page);
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await page.getByRole('combobox', { name: '历史版本', exact: true }).selectOption(id);
  await details.getByRole('button', { name: '恢复所选版本', exact: true }).click();
  await expect
    .poll(async () =>
      (await archive(page)).editHistory.some(
        (row) => row.reason === 'restore' && row.restoredFrom === id && row.state === 'synced',
      ),
    )
    .toBe(true);
}

test('13.5 six configured references, exact native start, permissions and representative layout', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto('/#/courses');
  const library = page.getByTestId('reconstruction-catalog');
  await library.locator('summary').click();
  await expect(library.getByRole('link')).toHaveCount(6);
  for (const question of reconstructionQuestions) {
    await open(page, question.exerciseRef.id);
    await expect(page.getByTestId('reconstruction-reference')).toContainText(question.hint);
    await expect(page.getByLabel('只读参考 C 代码', { exact: true })).toContainText('printf');
    await expect(source(page)).not.toHaveValue(/printf/);
    await expect(page.getByRole('textbox', { name: '编辑 C 代码', exact: true })).toHaveCount(0);
    await expect(action(page, '编辑 C 并同步积木')).toHaveCount(0);
    await expect(action(page, '收起代码编辑')).toHaveCount(0);
    expect((await archive(page)).progress).toEqual([]);
  }
  await open(page);
  await blockOptions(page, /./);
  await expect(
    blockWorkspace(page)
      .getByRole('combobox', { name: '添加积木类型', exact: true })
      .locator('option[value="while"]'),
  ).toHaveAttribute('disabled', '');
  const folder = `.artifacts/13.5/visual/${process.env.TASK_EVIDENCE_LABEL ?? 'initial'}`;
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('reconstruction-reference').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${folder}/${width}.png`, fullPage: true });
  }
  await info.attach('configured-references', {
    body: JSON.stringify({
      questions: reconstructionQuestions.map((q) => q.exerciseRef),
      archive: await archive(page),
    }),
    contentType: 'application/json',
  });
});

test('13.5 native reconstruction: wrong answer, real pass, quota retry and shared first reward', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  await page.addInitScript(() => {
    const fault = { armed: false, hits: 0 };
    Object.assign(window, { __reconstructionFault: fault });
    // Instance prototype operation: real transaction abort, never fabricate a receipt.
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      if (
        fault.armed &&
        this.name === 'receipts' &&
        (value as { eventType?: string })?.eventType === 'exercise.passed'
      ) {
        fault.hits++;
        throw new DOMException('13.5 isolated quota', 'QuotaExceededError');
      }
      return key === undefined ? add.call(this, value) : add.call(this, value, key);
    };
  });
  await open(page);
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  expect((await archive(page)).progress).toEqual([]);
  const print = await buildEcho(page);
  await selectBlock(page, print);
  await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d');
  await expect(action(page, '提交练习')).toBeEnabled();
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  expect((await archive(page)).ledger).toEqual([]);
  await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  await expect(action(page, '提交练习')).toBeEnabled();
  if (p05CourseRelease.registered)
    await page.evaluate(() => {
      (
        window as unknown as { __reconstructionFault: { armed: boolean } }
      ).__reconstructionFault.armed = true;
    });
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
    'data-save-state',
    p05CourseRelease.registered ? 'unsaved' : saved,
  );
  if (p05CourseRelease.registered) {
    expect((await archive(page)).progress).toEqual([]);
    await page.evaluate(() => {
      (
        window as unknown as { __reconstructionFault: { armed: boolean } }
      ).__reconstructionFault.armed = false;
    });
    await page.getByRole('button', { name: '重试未保存操作', exact: true }).click();
    await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
      'data-save-status',
      'ready',
    );
  }
  const first = await archive(page);
  const awards = first.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass');
  expect(awards).toHaveLength(p05CourseRelease.registered ? 1 : 0);
  if (awards.length) expect(awards[0].points).toBe(10);
  await action(page, '提交练习').click();
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
  expect((await archive(page)).ledger).toEqual(first.ledger);
  const worker = await observedCaseSetExecute(page);
  const request = JSON.parse(Buffer.from(worker.requestBytes!).toString()) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(worker.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.judgeResult?.status).toBe('met');
  expect(request.remainingMs).toBeLessThanOrEqual(1000);
  // The ordinary code mode shares the same genuine exercise entitlement.
  const text = (await archive(page)).editHistory
    .filter(
      (row) =>
        row.scope.mode === 'reconstruction' &&
        row.state === 'synced' &&
        row.codeText.includes('printf'),
    )
    .sort((a, b) => b.sequence - a.sequence)[0].codeText;
  await page.getByRole('button', { name: '独立练习', exact: true }).click();
  await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
  const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  await code.fill(text);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await action(page, '提交练习').click();
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
  expect((await archive(page)).ledger).toEqual(first.ledger);
  await info.attach('real-rust-and-rewards', {
    body: JSON.stringify({ request, result, first, repeat: await archive(page) }),
    contentType: 'application/json',
  });
});

test('13.5 isolated drafts and native history survive refresh while display preference and old execution stay correct', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/#/practice/exercise.c.echo');
  await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
  const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  await expect(code).toBeEditable();
  const invalid = (await code.inputValue()) + '\nint';
  await code.fill(invalid);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'invalid');
  await page.getByRole('button', { name: '拆积木练习', exact: true }).click();
  await buildEcho(page);
  await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  const version = (await archive(page)).editHistory
    .filter(
      (r) =>
        r.scope.mode === 'reconstruction' && r.state === 'synced' && r.codeText.includes('printf'),
    )
    .sort((a, b) => b.sequence - a.sequence)[0];
  expect(version.historyVersion).toBe('1.1.0');
  await action(page, '运行本组').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  await page.getByRole('button', { name: '独立练习', exact: true }).click();
  await expect(code).toHaveValue(invalid);
  await expect(page.getByRole('combobox', { name: '积木显示', exact: true })).toHaveValue('hide');
  await open(page);
  await restore(page, version.entryId);
  await expect(source(page)).toHaveValue(version.codeText);
  await action(page, '运行本组').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  await restore(page, version.entryId);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-player-status', 'idle');
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await expect(
    page.getByTestId('player-controls').getByRole('button', { name: '播放', exact: true }),
  ).toBeDisabled();
  const options = await page
    .getByRole('combobox', { name: '历史版本', exact: true })
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const rows = (await archive(page)).editHistory;
  expect(options.length).toBeGreaterThan(0);
  expect(
    options.every((id) => rows.find((row) => row.entryId === id)?.scope.mode === 'reconstruction'),
  ).toBe(true);
  await page.reload();
  await expect(action(page, '提交练习')).toBeEnabled();
  await expect(source(page)).not.toHaveValue(/printf/);
  await restore(page, version.entryId);
  await expect(source(page)).toHaveValue(version.codeText);
  await action(page, '提交练习').click();
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
});
