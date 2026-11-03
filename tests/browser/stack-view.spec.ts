import { expect, test, type Page } from '@playwright/test';
import type { MemoryRequest, MemoryResult } from '../../web/src/engine/memory-protocol';
import { MemoryPlayer } from '../../web/src/engine/memory-player';

declare global {
  interface Window {
    memoryQa: { requests: MemoryRequest[]; results: MemoryResult[]; hold: boolean };
  }
}
async function ready(page: Page) {
  await page.addInitScript(() => {
    window.memoryQa = { requests: [], results: [], hold: false };
    const NativeWorker = window.Worker;
    const messageHandler = Object.getOwnPropertyDescriptor(NativeWorker.prototype, 'onmessage')!;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(this, 'onmessage', {
          get: () => messageHandler.get!.call(this),
          set: (callback: ((event: MessageEvent) => unknown) | null) => {
            messageHandler.set!.call(
              this,
              callback &&
                ((event: MessageEvent) => {
                  if (window.memoryQa.hold && event.data?.ok) {
                    window.memoryQa.hold = false;
                    setTimeout(() => callback.call(this, event), 600);
                  } else callback.call(this, event);
                }),
            );
          },
        });
        this.addEventListener('message', ({ data }) => {
          if (data?.ok && data.buffer instanceof ArrayBuffer) {
            const result = JSON.parse(new TextDecoder().decode(data.buffer));
            if (result.engine?.id === 'engine.rust.memory') window.memoryQa.results.push(result);
          }
        });
      }
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
        const data = message as { buffer?: ArrayBuffer };
        if (data.buffer instanceof ArrayBuffer) {
          const request = JSON.parse(new TextDecoder().decode(data.buffer));
          if (request.execVersion === '1.3.0') window.memoryQa.requests.push(request);
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  });
  await page.goto('/#/memory');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-appearance-config', 'ready');
}
async function run(page: Page, id: string) {
  await page.getByLabel('观察样例', { exact: true }).selectOption(id);
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  return page.evaluate(() => window.memoryQa.results.at(-1)!);
}
async function seek(page: Page, cursor: number) {
  await page.getByRole('slider', { name: '执行步骤' }).fill(String(cursor));
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-cursor', String(cursor));
}
async function storedLearning(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((accept, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => accept(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = ['progress', 'dailyFacts', 'goals', 'ledger', 'receipts', 'aliases', 'avatar'];
      const tx = db.transaction(names, 'readonly');
      return await Promise.all(
        names.map(
          (name) =>
            new Promise((accept, reject) => {
              const request = tx.objectStore(name).getAll();
              request.onsuccess = () => accept([name, request.result]);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
    } finally {
      db.close();
    }
  });
}
test.beforeEach(async ({ page }) => ready(page));

function playback(result: MemoryResult) {
  const player = new MemoryPlayer();
  player.accept(result);
  return player;
}
async function chooseStack(page: Page) {
  await page.getByRole('button', { name: '调用栈视图', exact: true }).click();
}
async function assertFrames(page: Page, player: MemoryPlayer, cursor: number) {
  player.seek(cursor);
  const state = player.snapshot().state!;
  await seek(page, cursor);
  await expect(page.getByTestId('stack-depth')).toHaveText(String(state.frames.length));
  expect(
    await page
      .getByTestId('stack-frame')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-frame-id'))),
  ).toEqual([...state.frames].reverse().map((frame) => frame.id));
  await expect(page.getByTestId('stack-current-function')).toHaveText(
    state.frames.at(-1)?.functionName ?? '无活动调用',
  );
  return state;
}
test('C parameters and recursive locals restore after every real function return', async ({
  page,
}) => {
  const result = await run(page, 'functions');
  expect(result.language).toBe('c');
  expect(result.terminal.status).toBe('completed');
  await chooseStack(page);
  const player = playback(result);
  for (const step of result.trace!.steps.filter((step) => step.kind === 'function.return')) {
    await assertFrames(page, player, step.seq - 1);
    const before = await page.getByTestId('stack-panel').innerText();
    await assertFrames(page, player, step.seq);
    await expect(page.getByTestId('stack-returned')).toContainText('帧已出栈');
    await assertFrames(page, player, step.seq - 1);
    expect(await page.getByTestId('stack-panel').innerText()).toBe(before);
  }
  const call = result.trace!.steps.find((step) => step.kind === 'function.enter')!;
  await assertFrames(page, player, call.seq);
  await expect(
    page.locator('[data-testid="stack-binding"][data-kind="parameter"][data-name="n"]'),
  ).toContainText('n: 5');
  await seek(page, result.terminal.cursor);
  await expect(page.getByTestId('memory-output')).toHaveText('5 99 120\n');
  await expect(page.getByTestId('stack-depth')).toHaveText('0');
});
test('Hanoi varied inputs change genuine moves while frame selection preserves current source and cursor', async ({
  page,
}) => {
  await page.getByLabel('观察样例', { exact: true }).selectOption('hanoi');
  for (const disks of [0, 1, 3, 5]) {
    await page.getByLabel('汉诺塔盘数', { exact: true }).fill(String(disks));
    await page.getByRole('button', { name: '运行样例', exact: true }).click();
    await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
    const result = await page.evaluate(() => window.memoryQa.results.at(-1)!);
    expect(result.language).toBe('cpp');
    expect(result.terminal.status).toBe('completed');
    const player = playback(result);
    await chooseStack(page);
    const enters = result.trace!.steps.filter((step) => step.kind === 'function.enter');
    let maximum = 0;
    for (const step of enters) {
      player.seek(step.seq);
      maximum = Math.max(maximum, player.snapshot().state!.frames.length);
    }
    expect(maximum).toBe(disks + 2);
    const step = enters[Math.min(2, enters.length - 1)];
    await assertFrames(page, player, step.seq);
    const identity = await page.getByTestId('memory-workspace').getAttribute('data-run-id');
    const mark = page.getByTestId('memory-source-highlight');
    const sourceBefore = await mark.innerText();
    const node = result.nodeMap.find((node) => node.nodeId === step.nodeId)!;
    expect(sourceBefore).toBe(
      new TextDecoder().decode(
        new TextEncoder()
          .encode((await page.evaluate(() => window.memoryQa.requests.at(-1)!)).source)
          .slice(node.byteRange.start, node.byteRange.end),
      ),
    );
    const caller = player.snapshot().state!.frames[0];
    await page.locator(`[data-testid="stack-frame"][data-frame-id="${caller.id}"]`).click();
    await expect(page.getByTestId('stack-current-function')).toHaveText('hanoi');
    expect(await mark.innerText()).toBe(sourceBefore);
    await expect(page.getByTestId('memory-workspace')).toHaveAttribute(
      'data-cursor',
      String(step.seq),
    );
    await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-run-id', identity!);
    const returned = result.trace!.steps.find((step) => step.kind === 'function.return')!;
    await assertFrames(page, player, returned.seq - 1);
    await page.locator('[data-testid="stack-frame"][data-active="true"]').click();
    const beforeReturn = await page.getByTestId('stack-panel').innerText();
    await assertFrames(page, player, returned.seq);
    await expect(page.getByTestId('stack-returned')).toContainText('hanoi');
    await assertFrames(page, player, returned.seq - 1);
    expect(await page.getByTestId('stack-panel').innerText()).toBe(beforeReturn);
    await seek(page, result.terminal.cursor);
    expect(
      (await page.getByTestId('memory-output').innerText())
        .trim()
        .split('\n')
        .filter((line) => line !== '（无输出）').length,
    ).toBe(2 ** disks - 1);
  }
  await page.getByLabel('汉诺塔盘数', { exact: true }).fill('6');
  await expect(page.getByRole('button', { name: '运行样例', exact: true })).toBeDisabled();
  await test.info().attach('genuine-hanoi-input-and-output', {
    body: JSON.stringify(await page.evaluate(() => window.memoryQa)),
    contentType: 'application/json',
  });
});
test('quicksort keeps caller array aliases and returns sorted real output for five varied inputs', async ({
  page,
}) => {
  await page.getByLabel('观察样例', { exact: true }).selectOption('quicksort');
  for (const values of [
    [4, 2, 9, 1, 5],
    [0, 0, 0, 0, 0],
    [-9, 7, 0, -2, 7],
    [1, 2, 3, 4, 5],
    [5, 4, 3, 2, 1],
  ]) {
    await page.getByLabel('五个排序值').fill(values.join(' '));
    await page.getByRole('button', { name: '运行样例', exact: true }).click();
    await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
    const result = await page.evaluate(() => window.memoryQa.results.at(-1)!);
    expect(result.terminal.status).toBe('completed');
    await chooseStack(page);
    const player = playback(result);
    const enter = result.trace!.steps.find((step) => step.kind === 'function.enter')!;
    const state = await assertFrames(page, player, enter.seq);
    const alias = state.scopes
      .flatMap((scope) => scope.aliases)
      .find((alias) => alias.name === 'a')!;
    await expect(page.locator('[data-testid="stack-binding"][data-kind="alias"]')).toHaveAttribute(
      'data-object-id',
      alias.objectId,
    );
    await expect(page.locator('[data-testid="stack-binding"][data-kind="alias"]')).toContainText(
      '数组引用',
    );
    const returned = result.trace!.steps.find((step) => step.kind === 'function.return')!;
    await assertFrames(page, player, returned.seq - 1);
    const before = await page.getByTestId('stack-panel').innerText();
    await seek(page, returned.seq);
    await seek(page, returned.seq - 1);
    expect(await page.getByTestId('stack-panel').innerText()).toBe(before);
    await seek(page, result.terminal.cursor);
    await expect(page.getByTestId('memory-output')).toHaveText(
      [...values].sort((a, b) => a - b).join(' ') + ' \n',
    );
  }
});
test('deep recursion stops at the original frame limit and its accepted frames remain reversible', async ({
  page,
}) => {
  const result = await run(page, 'stack-limit');
  expect(result.terminal.code).toBe('E_STACK_LIMIT');
  await chooseStack(page);
  const player = playback(result);
  await assertFrames(page, player, result.terminal.cursor);
  await expect(page.getByTestId('stack-depth')).toHaveText('32');
  await expect(page.getByTestId('memory-diagnostic')).toContainText('E_STACK_LIMIT');
  const before = await page.getByTestId('stack-panel').innerText();
  await seek(page, 0);
  await expect(page.getByTestId('stack-depth')).toHaveText('0');
  await seek(page, result.terminal.cursor);
  expect(await page.getByTestId('stack-panel').innerText()).toBe(before);
});
test('three views keep one live player, input invalidation and learning records unchanged', async ({
  page,
}) => {
  const before = await storedLearning(page);
  const result = await run(page, 'hanoi');
  await chooseStack(page);
  const identity = await page.getByTestId('memory-workspace').getAttribute('data-run-id');
  await page.getByLabel('内存播放速度').selectOption('0.25');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  for (const label of ['内存视图', '基础视图', '调用栈视图']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
    await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-run-id', identity!);
  }
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect(await page.evaluate(() => window.memoryQa.requests.length)).toBe(1);
  expect(await storedLearning(page)).toEqual(before);
  await page.getByLabel('汉诺塔盘数', { exact: true }).fill('1');
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-run-id', '');
  await expect(page.getByTestId('stack-panel')).toHaveCount(0);
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  const next = await page.evaluate(() => window.memoryQa.results.at(-1)!);
  expect(next.identity.runId).not.toBe(result.identity.runId);
});
test('catalog entry, three widths and six themes show the real recursive call chain', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/#/cases');
  await page.getByRole('link', { name: '打开递归与调用栈 →', exact: true }).click();
  await expect(page.getByLabel('观察样例', { exact: true })).toHaveValue('hanoi');
  await expect(page.getByRole('button', { name: '调用栈视图', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const label = process.env.STACK_VIEW_LABEL ?? 'manual';
  async function show() {
    const result = await run(page, 'hanoi');
    await chooseStack(page);
    const player = playback(result);
    const enter = result.trace!.steps.filter((step) => step.kind === 'function.enter')[2];
    await assertFrames(page, player, enter.seq);
  }
  await show();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('stack-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `.artifacts/12.4/${label}-stack-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const theme of ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech']) {
    await page.goto('/#/settings?panel=appearance');
    await expect(page.locator('html')).toHaveAttribute('data-appearance-config', 'ready');
    await page.getByTestId(`theme-${theme}`).click();
    await page.getByTestId('save-appearance').click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
    for (const mode of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== mode)
        await page.getByTestId('theme-mode-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await page.goto('/#/memory?example=hanoi&view=stack');
      await show();
      await expect(page.getByTestId('stack-depth')).toHaveText('4');
      await page.screenshot({
        path: `.artifacts/12.4/${label}-theme-${theme}-${mode}.png`,
        fullPage: true,
      });
    }
  }
});
