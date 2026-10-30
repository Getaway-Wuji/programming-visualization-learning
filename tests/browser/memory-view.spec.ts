import { expect, test, type Page } from '@playwright/test';
import type { MemoryRequest, MemoryResult } from '../../web/src/engine/memory-protocol';

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

test('real C state is shared by both views, changes reverse, and switching grants no learning', async ({
  page,
}) => {
  const before = await storedLearning(page);
  const result = await run(page, 'pointers');
  const step = result.trace!.steps.find((step) => step.kind === 'pointer.write')!;
  expect(step).toBeTruthy();
  await seek(page, step.seq);
  const identity = await page.getByTestId('memory-workspace').getAttribute('data-run-id');
  const basic = await page.getByTestId('memory-basic').innerText();
  await page.getByRole('button', { name: '内存视图', exact: true }).click();
  await expect(page.getByTestId('memory-panel')).toContainText('教学用虚拟地址，非本机真实地址');
  const changed = step.changes.find((change) => change.op === 'cell');
  expect(changed).toBeTruthy();
  if (changed?.op === 'cell') await page.getByLabel('查看内存对象').selectOption(changed.objectId);
  await expect(page.locator('[data-changed="true"]')).not.toHaveCount(0);
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute(
    'data-cursor',
    String(step.seq - 1),
  );
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await page.getByRole('button', { name: '基础视图', exact: true }).click();
  expect(await page.getByTestId('memory-basic').innerText()).toBe(basic);
  expect(await page.getByTestId('memory-workspace').getAttribute('data-run-id')).toBe(identity);
  expect(await page.evaluate(() => window.memoryQa.requests.length)).toBe(1);
  expect(await storedLearning(page)).toEqual(before);
  await test.info().attach('real-memory-request-and-result', {
    body: JSON.stringify(await page.evaluate(() => window.memoryQa)),
    contentType: 'application/json',
  });
});
test('scope exit keeps tombstones and a dangling diagnostic only at the failing cursor', async ({
  page,
}) => {
  const result = await run(page, 'scope');
  expect(result.terminal.code).toBe('E_DANGLING_POINTER');
  await seek(page, result.terminal.cursor);
  await expect(page.getByTestId('memory-diagnostic')).toContainText('E_DANGLING_POINTER');
  await expect(page.getByTestId('memory-source-highlight')).toBeVisible();
  await page.getByRole('button', { name: '内存视图', exact: true }).click();
  const declaration = result.trace!.steps.find((step) =>
    step.changes.some(
      (change) =>
        change.op === 'record' &&
        change.table === 'objects' &&
        change.before &&
        change.after &&
        'alive' in change.after &&
        !change.after.alive,
    ),
  );
  expect(declaration).toBeTruthy();
  await seek(page, declaration!.seq - 1);
  await expect(page.getByTestId('memory-diagnostic')).toHaveCount(0);
  const saved = await page.getByTestId('memory-panel').innerText();
  await seek(page, declaration!.seq);
  await seek(page, declaration!.seq - 1);
  expect(await page.getByTestId('memory-panel').innerText()).toBe(saved);
});
test('C++ heap fields restore across delete and changed inputs produce new real values', async ({
  page,
}) => {
  const first = await run(page, 'nodes');
  expect(first.language).toBe('cpp');
  const released = first.trace!.steps.find((step) => step.kind === 'memory.release')!;
  await seek(page, released.seq - 1);
  await page.getByRole('button', { name: '内存视图', exact: true }).click();
  const record = released.changes.find(
    (change) => change.op === 'record' && change.table === 'objects',
  )!;
  if (record.op !== 'record') throw new Error('Missing genuine release');
  await page.getByLabel('查看内存对象').selectOption(record.id);
  await expect(page.getByTestId('memory-lifetime')).toContainText('存活');
  const prior = await page.getByTestId('memory-object').innerText();
  await seek(page, released.seq);
  await expect(page.getByTestId('memory-lifetime')).toContainText('已结束');
  await expect(page.getByTestId('memory-slot')).toHaveCount(0);
  await seek(page, released.seq - 1);
  expect(await page.getByTestId('memory-object').innerText()).toBe(prior);
  await page.getByLabel('三个节点值').fill('7 -2 0');
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-run-id', '');
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  const second = await page.evaluate(() => window.memoryQa.results.at(-1)!);
  expect(second.identity.runId).not.toBe(first.identity.runId);
  await seek(page, second.terminal.cursor);
  await expect(page.getByTestId('memory-output')).toHaveText('7 -2 0 \n7 0 \n');
});
test('null, uninitialized and field one-past references remain distinct and reversible', async ({
  page,
}) => {
  for (const [id, code, text] of [
    ['null', 'E_NULL_POINTER', '空指针'],
    ['uninitialized', 'E_UNINITIALIZED', '未初始化'],
    ['bounds', 'E_POINTER_BOUNDS', '尾后指针'],
  ]) {
    const result = await run(page, id);
    expect(result.terminal.code).toBe(code);
    await seek(page, result.terminal.cursor);
    await expect(page.getByTestId('memory-diagnostic')).toContainText(code);
    await page.getByRole('button', { name: '内存视图', exact: true }).click();
    const pointerId = result
      .trace!.steps.flatMap((step) => step.changes)
      .findLast(
        (change) =>
          change.op === 'record' &&
          change.table === 'objects' &&
          change.after &&
          'typeName' in change.after &&
          change.after.typeName === 'int*',
      );
    expect(pointerId).toBeTruthy();
    if (pointerId?.op === 'record')
      await page.getByLabel('查看内存对象').selectOption(pointerId.id);
    await expect(page.getByTestId('memory-object')).toContainText(text);
    await seek(page, 0);
    await expect(page.getByTestId('memory-panel')).toContainText('当前没有符合条件的对象');
    await seek(page, result.terminal.cursor);
    await expect(page.getByTestId('memory-diagnostic')).toContainText(code);
  }
});
test('changing sample invalidates and cancelling a held genuine Worker reply discards late success', async ({
  page,
}) => {
  await run(page, 'nodes');
  await page.getByLabel('三个节点值').fill('1 2');
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-run-id', '');
  await expect(page.getByRole('button', { name: '运行样例', exact: true })).toBeDisabled();
  await page.getByLabel('三个节点值').fill(',1,2');
  await expect(page.getByRole('button', { name: '运行样例', exact: true })).toBeDisabled();
  await page.getByLabel('观察样例', { exact: true }).selectOption('pointers');
  await page.evaluate(() => {
    window.memoryQa.hold = true;
  });
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.memoryQa.results.length)).toBe(2);
  await page.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('memory-diagnostic')).toContainText('E_CANCELLED');
  await page.waitForTimeout(700);
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-run-id', '');
  await page.getByLabel('观察样例', { exact: true }).selectOption('null');
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-run-id', '');
  await run(page, 'null');
});

test('configured saved themes in both modes preserve readable real memory data', async ({
  page,
}) => {
  test.setTimeout(90000);
  for (const theme of process.env.TASK_REPRESENTATIVE_THEME === 'minimal'
    ? ['minimal']
    : ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech']) {
    await page.goto('/#/settings?panel=appearance');
    await expect(page.locator('html')).toHaveAttribute('data-appearance-config', 'ready');
    await page.getByTestId(`theme-${theme}`).click();
    await page.getByTestId('save-appearance').click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
    for (const mode of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== mode)
        await page.getByTestId('theme-mode-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await page.goto('/#/memory');
      await expect(page.getByTestId('memory-workspace')).toBeVisible();
      const result = await run(page, 'pointers');
      await seek(page, Math.min(10, result.terminal.cursor));
      await page.getByRole('button', { name: '内存视图', exact: true }).click();
      await expect(page.getByTestId('memory-slot')).toHaveCount(3);
      await expect(page.getByTestId('memory-slot').nth(1)).toContainText('9');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: `.artifacts/12.3/${process.env.MEMORY_VIEW_LABEL ?? 'manual'}-theme-${theme}-${mode}.png`,
        fullPage: true,
      });
    }
  }
});
test('keyboard, pause, view switching and replay use a single genuine run for thirty seconds', async ({
  page,
}) => {
  test.setTimeout(45000);
  const result = await run(page, 'nodes');
  await page.getByLabel('内存播放速度').selectOption('0.25');
  const stage = page
    .getByRole('region', { name: '执行观察', exact: true })
    .filter({ has: page.getByTestId('memory-observation') });
  // Focus the actual keyboard surface rather than its outer workbench region.
  await page.locator('.memory-stage').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-cursor', '1');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-cursor', '0');
  await page.keyboard.press('Space');
  await page.waitForTimeout(30000);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const cursor = await page.getByTestId('memory-workspace').getAttribute('data-cursor');
  expect(Number(cursor)).toBeGreaterThan(5);
  expect(Number(cursor)).toBeLessThan(result.terminal.cursor);
  await page.getByRole('button', { name: '内存视图', exact: true }).click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-cursor', cursor!);
  expect(await page.evaluate(() => window.memoryQa.requests.length)).toBe(1);
  await page.getByRole('button', { name: '重播', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-cursor', '0');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  void stage;
});
test('three widths keep memory values readable inside the shared workbench', async ({ page }) => {
  const result = await run(page, 'pointers');
  await seek(page, Math.min(10, result.terminal.cursor));
  await page.getByRole('button', { name: '内存视图', exact: true }).click();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('memory-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: `.artifacts/12.3/${process.env.MEMORY_VIEW_LABEL ?? 'manual'}-memory-${width}.png`,
      fullPage: true,
    });
  }
});
