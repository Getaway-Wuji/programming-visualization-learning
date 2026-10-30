import { expect, test, type Page } from '@playwright/test';
import type { MemoryRequest, MemoryResult, MemoryStep } from '../../web/src/engine/memory-protocol';
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

function mappedLine(source: string, result: MemoryResult, nodeId: string) {
  const start = result.nodeMap.find((node) => node.nodeId === nodeId)!.byteRange.start;
  return new TextDecoder()
    .decode(new TextEncoder().encode(source).slice(0, start))
    .split(/\r\n|\r|\n/).length;
}
async function playTo(page: Page, from: number, target: number, rate = 4) {
  await page.getByRole('button', { name: /^(播放|继续)$/ }).click();
  await page.clock.runFor((target - from) * (500 / rate) + 5);
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-cursor', String(target));
  await expect(page.getByTestId('debug-hit')).toContainText(`第 ${target} 步`);
}
async function mark(page: Page, line: number) {
  await page.getByRole('button', { name: `设置第 ${line} 行断点`, exact: true }).click();
}
function callNode(step: MemoryStep) {
  if (step.kind !== 'function.enter') return null;
  for (const change of step.changes)
    if (
      change.op === 'record' &&
      change.table === 'frames' &&
      change.before === null &&
      change.after &&
      'callNodeId' in change.after
    )
      return change.after.callNodeId;
  return null;
}

test('Hanoi real repeated visits stop, continue and reverse restores returned frames at the same cursor', async ({
  page,
}) => {
  await page.getByLabel('观察样例', { exact: true }).selectOption('hanoi');
  await mark(page, 4);
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(() => window.memoryQa.results.at(-1)!);
  const source = await page.getByLabel('本次执行的只读源码', { exact: true }).innerText();
  const steps = result.trace!.steps;
  const hits = steps.filter(
    (step) => callNode(step) && mappedLine(source, result, callNode(step)!) === 4,
  );
  expect(hits.length).toBeGreaterThan(3);
  const player = new MemoryPlayer();
  player.accept(result);
  await page.getByRole('button', { name: '调用栈视图', exact: true }).click();
  await page.getByLabel('内存播放速度').selectOption('4');
  await page.clock.install();
  let cursor = 0;
  for (const hit of hits.slice(0, 4)) {
    await playTo(page, cursor, hit.seq);
    player.seek(hit.seq);
    await expect(page.getByTestId('stack-depth')).toHaveText(
      String(player.snapshot().state!.frames.length),
    );
    const node = result.nodeMap.find((node) => node.nodeId === callNode(hit))!;
    await expect(page.getByTestId('memory-source-highlight')).toHaveAttribute(
      'data-byte-start',
      String(node.byteRange.start),
    );
    await expect(page.getByTestId('memory-source-position')).toContainText('第 4 行');
    await page.clock.runFor(2000);
    await expect(page.getByTestId('memory-workspace')).toHaveAttribute(
      'data-cursor',
      String(hit.seq),
    );
    cursor = hit.seq;
  }
  const returned = steps.find((step) => step.kind === 'function.return')!;
  await seek(page, returned.seq - 1);
  const before = await page.getByTestId('stack-panel').innerText();
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await page.getByRole('button', { name: '后退', exact: true }).click();
  expect(await page.getByTestId('stack-panel').innerText()).toBe(before);
  expect(
    await page
      .getByRole('button', { name: '移除第 4 行断点', exact: true })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  expect(await page.evaluate(() => window.memoryQa.requests.length)).toBe(1);
});

test('single-line C++ loop hits new iterations; speed, view switching and replay keep one run and learning unchanged', async ({
  page,
}) => {
  const learning = await storedLearning(page);
  const result = await run(page, 'quicksort');
  const source = await page.getByLabel('本次执行的只读源码', { exact: true }).innerText();
  const line = source.split(/\r?\n/).findIndex((text) => text.includes('std::cin')) + 1;
  await mark(page, line);
  const steps = result.trace!.steps;
  const first = steps.find((step) => mappedLine(source, result, step.nodeId) === line)!;
  const conditions = steps.filter(
    (step) =>
      step.seq > first.seq &&
      step.kind === 'condition' &&
      mappedLine(source, result, step.nodeId) === line,
  );
  expect(conditions.length).toBe(6);
  const identity = await page.getByTestId('memory-workspace').getAttribute('data-run-id');
  await page.getByLabel('内存播放速度').selectOption('4');
  await page.clock.install();
  await playTo(page, 0, first.seq);
  await page.getByLabel('内存播放速度').selectOption('2');
  await page.clock.runFor(1000);
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute(
    'data-cursor',
    String(first.seq),
  );
  for (const name of ['内存视图', '调用栈视图', '基础视图'])
    await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByTestId('debug-hit')).toBeVisible();
  await playTo(page, first.seq, conditions[0].seq, 2);
  await page.getByLabel('内存播放速度').selectOption('4');
  await playTo(page, conditions[0].seq, conditions[1].seq);
  await page.getByRole('button', { name: '重播', exact: true }).click();
  await page.clock.runFor(first.seq * 125 + 5);
  await expect(page.getByTestId('debug-hit')).toContainText(`第 ${first.seq} 步`);
  await page.getByRole('button', { name: '清除全部断点', exact: true }).click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.clock.runFor(result.trace!.steps.length * 125 + 5);
  await expect(page.getByTestId('memory-output')).toContainText('1 2 4 5 9');
  expect(await page.getByTestId('memory-workspace').getAttribute('data-run-id')).toBe(identity);
  expect(await page.evaluate(() => window.memoryQa.requests.length)).toBe(1);
  expect(await storedLearning(page)).toEqual(learning);
});

test('same-line declaration tail advances once; manual steps, pause and no-visit marks never trap playback', async ({
  page,
}) => {
  const result = await run(page, 'pointers');
  const source = await page.getByLabel('本次执行的只读源码', { exact: true }).innerText();
  await mark(page, 1); // The include line is not executed; never silently relocates.
  await mark(page, 7);
  await expect(page.getByTestId('debug-breakpoints')).toContainText('本次轨迹无停靠步骤：第 1 行');
  const steps = result.trace!.steps;
  const first = steps.find((step) => mappedLine(source, result, step.nodeId) === 7)!;
  expect(mappedLine(source, result, steps[first.seq].nodeId)).toBe(7);
  await page.getByLabel('内存播放速度').selectOption('4');
  await page.clock.install();
  await playTo(page, 0, first.seq);
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute(
    'data-cursor',
    String(first.seq + 1),
  );
  await expect(page.getByTestId('debug-hit')).toHaveCount(0);
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.clock.runFor(125);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const paused = await page.getByTestId('memory-workspace').getAttribute('data-cursor');
  await page.clock.runFor(2000);
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-cursor', paused!);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.clock.runFor(steps.length * 125 + 5);
  await expect(page.getByTestId('memory-output')).toContainText('9 6');
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute(
    'data-cursor',
    String(steps.length),
  );
});

test('input changes keep source-bound marks, sample changes clear them and late cancelled results stay invalid', async ({
  page,
}) => {
  await run(page, 'hanoi');
  await mark(page, 4);
  await page.getByLabel('汉诺塔盘数', { exact: true }).fill('2');
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByRole('button', { name: '移除第 4 行断点', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('debug-breakpoints')).toContainText('第 4 行');
  await page.getByLabel('观察样例', { exact: true }).selectOption('functions');
  await expect(page.getByTestId('debug-breakpoints')).toContainText('尚未设置断点');
  await expect(page.getByText('源码已变化，原行断点已清除。', { exact: true })).toBeVisible();
  await mark(page, 5);
  await page.evaluate(() => {
    window.memoryQa.hold = true;
  });
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await page.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'failed');
  await page.waitForTimeout(750);
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-run-id', '');
  await expect(page.getByTestId('debug-hit')).toHaveCount(0);
  await page.getByLabel('观察样例', { exact: true }).selectOption('hanoi');
  await expect(page.getByTestId('debug-breakpoints')).toContainText('尚未设置断点');
});

test('one representative theme: line marks, real stack and keyboard controls remain usable at three widths', async ({
  page,
}) => {
  const result = await run(page, 'hanoi');
  await mark(page, 4);
  await page.getByRole('button', { name: '调用栈视图', exact: true }).click();
  const source = await page.getByLabel('本次执行的只读源码', { exact: true }).innerText();
  const first = result.trace!.steps.find(
    (step) => callNode(step) && mappedLine(source, result, callNode(step)!) === 4,
  )!;
  await page.getByLabel('内存播放速度').selectOption('4');
  await page.clock.install();
  await playTo(page, 0, first.seq);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1100) await page.getByRole('tab', { name: '示例源码', exact: true }).click();
    const button = page.getByRole('button', { name: '移除第 4 行断点', exact: true });
    await button.focus();
    await page.keyboard.press('Space');
    await expect(
      page.getByRole('button', { name: '设置第 4 行断点', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    if (width < 1100) await page.getByRole('tab', { name: '执行观察', exact: true }).click();
    const stage = page.locator('.memory-stage');
    // Existing stage is a labelled section with an h2, giving it the region role.
    await stage.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('memory-workspace')).toHaveAttribute(
      'data-cursor',
      String(first.seq),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({
      path: `.artifacts/12.5/${process.env.BREAKPOINT_LABEL}-debug-${width}.png`,
      fullPage: true,
    });
  }
});
