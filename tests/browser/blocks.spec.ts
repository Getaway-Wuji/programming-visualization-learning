import { learnBlockPrerequisites } from './learn-block-prerequisites';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import {
  blockOptions,
  blockWorkspace,
  correctStarter,
  selectBlock,
  openBlockKeyboardEditor,
  showPracticeBlocks,
} from './block-ui';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

test.beforeEach(async ({ page }, info) => {
  if (/native flyout drag creates|type rejection|a new arithmetic/.test(info.title)) {
    test.setTimeout(Math.max(info.timeout, 90000));
    await learnBlockPrerequisites(page);
  }
});

const panel = (page: Page) => page.getByTestId('practice-execution');
const submit = (page: Page) => panel(page).getByRole('button', { name: '提交练习', exact: true });
const echo = 'exercise.c.echo';
async function open(page: Page) {
  await page.goto(`/#/practice/${echo}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await showPracticeBlocks(page);
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  await openBlockKeyboardEditor(page);
}
test.beforeEach(async ({ page }) => {
  // The 10.1/10.3 integration gate cannot grant learning-write authority.
  await page.route('**/content/learning/course-learning-*.json', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
});
async function allIds(page: Page) {
  return blockOptions(page, /./);
}
async function unique(page: Page, expression: RegExp): Promise<string> {
  const ids = await blockOptions(page, expression);
  expect(ids).toHaveLength(1);
  return ids[0];
}
async function add(page: Page, kind: string): Promise<string> {
  const before = new Set(await allIds(page));
  await blockWorkspace(page)
    .getByRole('combobox', { name: '添加积木类型', exact: true })
    .selectOption(kind);
  await blockWorkspace(page).getByRole('button', { name: '添加积木', exact: true }).click();
  await expect
    .poll(async () => (await allIds(page)).filter((id) => !before.has(id)).length)
    .toBe(1);
  return (await allIds(page)).find((id) => !before.has(id))!;
}
async function connect(page: Page, child: string, parent: string, slot: string) {
  await selectBlock(page, child);
  await blockWorkspace(page)
    .getByRole('combobox', { name: '连接到积木', exact: true })
    .selectOption(parent);
  await blockWorkspace(page)
    .getByRole('combobox', { name: '连接位置', exact: true })
    .selectOption(slot);
  await expect(
    blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true }),
  ).toHaveValue(child);
  await expect(
    blockWorkspace(page).getByRole('combobox', { name: '连接到积木', exact: true }),
  ).toHaveValue(parent);
  await expect(
    blockWorkspace(page).getByRole('combobox', { name: '连接位置', exact: true }),
  ).toHaveValue(slot);
  await blockWorkspace(page).getByRole('button', { name: '连接选中积木', exact: true }).click();
}
async function remove(page: Page, id: string) {
  await selectBlock(page, id);
  await blockWorkspace(page).getByRole('button', { name: '删除选中积木', exact: true }).click();
  await expect.poll(async () => (await allIds(page)).includes(id)).toBe(false);
}
async function executeCount(page: Page) {
  return page.evaluate(
    () => window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
  );
}
async function prepare(page: Page) {
  await panel(page).getByRole('button', { name: '准备代码', exact: true }).click();
  await expect(submit(page)).toBeEnabled();
  await expect(
    page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }),
  ).not.toHaveValue('');
}
function protocolId(nativeId: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(nativeId)
    ? nativeId
    : `block.native.${Buffer.from(nativeId, 'utf8').toString('hex')}`;
}
async function capture(page: Page, info: TestInfo, label: string, nativeIds: string[] = []) {
  const worker = await observedCaseSetExecute(page);
  const request = JSON.parse(Buffer.from(worker.requestBytes!).toString('utf8')) as ExecuteRequest;
  const bytes = Uint8Array.from(worker.responseBytes!);
  const result = await decodeResult(bytes.buffer, request);
  expect(worker.moduleSeen).toBe(true);
  expect(worker.operationId).toBe(worker.responseOperationId);
  expect(result.producer).toBe('rust');
  expect(request.remainingMs).toBeGreaterThan(0);
  expect(request.remainingMs).toBeLessThanOrEqual(1000);
  expect(
    request.source.blockMap.every((entry) =>
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(entry.blockId),
    ),
  ).toBe(true);
  for (const id of nativeIds)
    expect(request.source.blockMap.some((entry) => entry.blockId === protocolId(id))).toBe(true);
  await expect(page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true })).toHaveValue(
    request.source.text,
  );
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '10.3',
    'browser-blocks',
    info.project.name,
    label,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'request.json'), Buffer.from(worker.requestBytes!));
  await writeFile(join(directory, 'result.json'), Buffer.from(worker.responseBytes!));
  await writeFile(join(directory, 'catalog.json'), worker.catalogJson!);
  await writeFile(
    join(directory, 'ui.json'),
    JSON.stringify(
      {
        nativeIds,
        protocolIds: nativeIds.map(protocolId),
        state: await panel(page).getAttribute('data-state'),
        source: request.source.text,
        feedback: await page.getByTestId('practice-feedback').innerText(),
        timing: worker.timing,
        project: info.project.name,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: join(directory, 'screen.png'), fullPage: true });
  await info.attach(label, { path: join(directory, 'ui.json'), contentType: 'application/json' });
  return { request, result };
}

test('the actual toolbox exposes all twenty supported kinds and the generated C remains read-only', async ({
  page,
}, info) => {
  const styleErrors: string[] = [];
  page.on('console', (message) => {
    if (/inline style.*Content Security Policy|style-src.*blocked/i.test(message.text()))
      styleErrors.push(message.text());
  });
  await open(page);
  const categories: [string, number][] = [
    ['程序与作用域', 3],
    ['整数与变量', 4],
    ['运算与判断', 4],
    ['条件与循环', 5],
    ['数组与输出', 4],
  ];
  for (const [name, count] of categories) {
    await blockWorkspace(page).getByRole('treeitem', { name, exact: true }).click();
    await expect(
      blockWorkspace(page).locator('.blocklyFlyout .blocklyBlockCanvas > .blocklyDraggable'),
    ).toHaveCount(count);
  }
  await expect(
    blockWorkspace(page)
      .getByRole('combobox', { name: '添加积木类型', exact: true })
      .locator('option'),
  ).toHaveCount(20);
  await expect(panel(page).getByRole('button', { name: /导入|解析源码|反推/ })).toHaveCount(0);
  await expect(panel(page).locator('input[type="file"], [contenteditable="true"]')).toHaveCount(0);
  await correctStarter(page, echo);
  await prepare(page);
  await expect(
    page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }),
  ).toHaveAttribute('readonly', '');
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '10.1',
    'browser-blocks',
    info.project.name,
  );
  await mkdir(directory, { recursive: true });
  await blockWorkspace(page).screenshot({ path: join(directory, 'toolbox.png') });
  expect(styleErrors).toEqual([]);
});

test('native flyout drag creates a new block, keyboard controls nest native-id blocks, and real Rust runs that same source', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await open(page);
  await correctStarter(page, echo);
  const print = await unique(page, /^\d+\. 输出 ·/);
  const before = new Set(await allIds(page));
  await blockWorkspace(page).getByRole('treeitem', { name: '程序与作用域', exact: true }).click();
  await expect(
    blockWorkspace(page).locator('.blocklyFlyout .blocklyBlockCanvas > .blocklyDraggable'),
  ).toHaveCount(3);
  const scopeBlock = blockWorkspace(page)
    .locator('.blocklyFlyout .blocklyBlockCanvas > .blocklyDraggable')
    .nth(1);
  await scopeBlock.scrollIntoViewIfNeeded();
  const start = await scopeBlock.boundingBox();
  const canvas = await blockWorkspace(page).locator('.block-canvas').boundingBox();
  expect(start).not.toBeNull();
  expect(canvas).not.toBeNull();
  await page.mouse.move(start!.x + 35, start!.y + 15);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + canvas!.width - 90, canvas!.y + canvas!.height * 0.65, {
    steps: 20,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await allIds(page)).filter((id) => !before.has(id)).length)
    .toBe(1);
  const scope = (await allIds(page)).find((id) => !before.has(id))!;
  await expect(page.getByTestId('block-issues')).toContainText('还未连接');
  const selected = blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true });
  await connect(page, scope, print, '$next');
  await expect(blockWorkspace(page).locator('.block-notice')).toHaveText('积木已连接。');
  await expect(selected).toHaveValue(scope);
  await selected.selectOption('');
  await expect(selected).toHaveValue('');
  await expect(
    blockWorkspace(page).getByRole('button', { name: '连接选中积木', exact: true }),
  ).toBeDisabled();
  await expect(
    blockWorkspace(page).getByRole('combobox', { name: '连接到积木', exact: true }),
  ).toBeDisabled();
  const returned = await add(page, 'return');
  await connect(page, returned, scope, 'BODY');
  await expect(blockWorkspace(page).locator('.block-notice')).toHaveText('积木已连接。');
  await expect(selected).toHaveValue(returned);
  const number = await add(page, 'integer');
  await connect(page, number, returned, 'VALUE');
  await expect(blockWorkspace(page).locator('.block-notice')).toHaveText('积木已连接。');
  await expect(selected).toHaveValue(number);
  await expect(page.getByTestId('block-issues')).toHaveCount(0);
  await prepare(page);
  await submit(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  const run = await capture(page, info, 'native-drag-nested', [scope, returned, number]);
  expect(run.result.terminal.status).toBe('completed');
  expect(run.result.judgeResult?.status).toBe('met');
  expect(run.request.source.text).toMatch(/\{\n\s+return 0;\n\s+\}/);
  expect(await executeCount(page)).toBe(3);
  for (const url of urls) expect(new URL(url).origin).toBe('http://127.0.0.1:4178');
  const controls = page.getByTestId('player-controls');
  await controls.getByRole('button', { name: '前进', exact: true }).click();
  const cursor = await controls.getAttribute('data-cursor');
  await panel(page).getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await expect(blockWorkspace(page)).toHaveCount(0);
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
  await expect.poll(async () => (await allIds(page)).includes(scope)).toBe(true);
  expect(await executeCount(page)).toBe(3);
  await remove(page, scope);
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await expect(page.getByTestId('source-step-highlight')).toHaveCount(0);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
});

test('type rejection, missing-slot drafts and deleted input sources visibly refuse execution and survive review navigation', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await open(page);
  await correctStarter(page, echo);
  const print = await unique(page, /^\d+\. 输出 ·/);
  const input = await unique(page, /^\d+\. 声明整数 · x$/);
  const scope = await add(page, 'scope');
  await connect(page, scope, print, '$next');
  const integer = await add(page, 'integer');
  await connect(page, integer, scope, 'BODY');
  await expect(blockWorkspace(page).locator('.block-notice')).toContainText('不能这样连接');
  await expect(page.getByTestId('block-issues')).toContainText('还未连接');
  await expect(submit(page)).toBeDisabled();
  await remove(page, integer);
  const returned = await add(page, 'return');
  await connect(page, returned, scope, 'BODY');
  await expect(page.getByTestId('block-issues')).toContainText('表达式槽');
  await expect(submit(page)).toBeDisabled();
  await panel(page).getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await expect(blockWorkspace(page)).toHaveCount(0);
  await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
  await expect.poll(async () => (await allIds(page)).includes(returned)).toBe(true);
  await expect(blockWorkspace(page).getByRole('alert')).toContainText('表达式槽');
  await expect(submit(page)).toBeDisabled();
  expect(await executeCount(page)).toBe(0);
  await remove(page, scope);
  await selectBlock(page, input);
  await expect(
    blockWorkspace(page).getByRole('textbox', { name: '变量名称', exact: true }),
  ).toBeDisabled();
  await remove(page, input);
  await expect(page.getByTestId('block-issues')).toContainText('课程输入');
  await expect(page.getByTestId('block-issues')).toContainText('删除');
  await expect(submit(page)).toBeDisabled();
  expect(await executeCount(page)).toBe(0);
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '10.1',
    'browser-blocks',
    info.project.name,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, 'input-binding-rejection.png'), fullPage: true });
});

test('a new arithmetic block produces a real located Rust diagnostic and an edit immediately withdraws that run', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await open(page);
  await correctStarter(page, echo);
  const print = await unique(page, /^\d+\. 输出 ·/);
  const originalRead = await unique(page, /^\d+\. 读取变量 · x$/);
  await selectBlock(page, originalRead);
  await blockWorkspace(page).getByRole('button', { name: '断开选中积木', exact: true }).click();
  await remove(page, originalRead);
  const division = await add(page, 'arithmetic');
  await blockWorkspace(page)
    .getByRole('combobox', { name: '运算符', exact: true })
    .selectOption('/');
  await connect(page, division, print, 'ARG0');
  const read = await add(page, 'variable');
  await connect(page, read, division, 'LEFT');
  const zero = await add(page, 'integer');
  await connect(page, zero, division, 'RIGHT');
  await prepare(page);
  await submit(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  await expect(page.getByTestId('practice-feedback')).toContainText('E_DIV_ZERO');
  const controls = page.getByTestId('player-controls');
  const total = Number(await controls.getAttribute('data-length'));
  expect(total).toBeGreaterThan(0);
  for (let index = 0; index < total; index++)
    await page.getByRole('button', { name: '前进', exact: true }).click();
  await expect(controls).toHaveAttribute('data-cursor', String(total));
  await expect(page.getByTestId('source-terminal-location')).toBeVisible();
  await expect(page.getByTestId('practice-block-location')).toContainText(protocolId(division));
  const run = await capture(page, info, 'native-division-diagnostic', [division, read, zero]);
  expect(run.result.terminal.status).toBe('program-error');
  expect(
    run.result.terminal.diagnostics.some((diagnostic) => diagnostic.code === 'E_DIV_ZERO'),
  ).toBe(true);
  expect(await executeCount(page)).toBe(1);
  await selectBlock(page, zero);
  await blockWorkspace(page).getByRole('textbox', { name: '整数值', exact: true }).fill('1');
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await expect(page.getByTestId('source-terminal-location')).toHaveCount(0);
  await expect(page.getByTestId('practice-feedback')).not.toContainText('E_DIV_ZERO');
  expect(await executeCount(page)).toBe(1);
});
