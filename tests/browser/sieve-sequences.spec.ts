import { expectedSourceLine } from './source-highlight';
import { expectEditorValue } from './editor-value';
import { readFileSync } from 'node:fs';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import type { AdvancedAlgorithmSpec } from '../../web/src/advanced-algorithms/content';
import type { AdvancedRequest } from '../../web/src/engine/advanced-protocol';
import { decodeAdvancedResult } from '../../web/src/engine/advanced-protocol';
import { AdvancedPlayer } from '../../web/src/engine/advanced-player';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
import { observeCaseSetExecution } from './case-set-observation';
import { waitForPhase2Archive } from './phase2-ready';
import { native, clear } from './scheduler-helpers';
const specs = JSON.parse(readFileSync('content/algorithms/cpp/sieve-sequences-1.0.0.json', 'utf8'))
  .cases as AdvancedAlgorithmSpec[];
const root = (p: Page) => p.getByTestId('advanced-algorithm-workspace');
async function open(p: Page, spec = specs[0]) {
  const route = '/#/advanced/algorithms/' + spec.id;
  const detail = p.getByRole('combobox', { name: '步骤显示', exact: true });
  const expectedDetail = p.url().endsWith(route) ? await detail.inputValue() : 'key';
  await p.goto(route);
  await waitForPhase2Archive(p);
  await expect(root(p)).toHaveAttribute('data-state', 'idle');
  await expectEditorValue(detail, expectedDetail);
  await detail.selectOption('all');
}
async function run(p: Page) {
  await p.getByRole('button', { name: '运行C++算法', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-state', 'ready');
}
async function seek(p: Page, n: number) {
  await p.getByRole('slider', { name: '算法执行步骤', exact: true }).fill(String(n));
  await expect(root(p)).toHaveAttribute('data-cursor', String(n));
}
async function packet(p: Page, info: TestInfo) {
  const raw = await p.evaluate(() => {
    const w = window.__verticalObservation.workers.findLast((w) => w.moduleSeen && w.responseOk)!;
    return {
      moduleSeen: w.moduleSeen,
      terminated: w.terminated,
      ...(
        w as unknown as { captureEncoded(): { requestBase64: string; responseBase64: string } }
      ).captureEncoded(),
    };
  });
  expect(raw.moduleSeen).toBe(true);
  expect(raw.terminated).toBe(true);
  const request = JSON.parse(
      Buffer.from(raw.requestBase64, 'base64').toString(),
    ) as AdvancedRequest,
    result = await decodeAdvancedResult(
      Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
      request,
      engineBuild.wasmSha256,
    );
  await info.attach('actual-cpp-packet', {
    body: JSON.stringify(raw),
    contentType: 'application/json',
  });
  return { request, result };
}
for (const spec of specs)
  for (const sample of spec.samples)
    test(`real advanced algorithm ${spec.id}/${sample.key}`, async ({ page }, info) => {
      await observeCaseSetExecution(page);
      await open(page, spec);
      await page
        .getByRole('combobox', { name: '算法边界样例', exact: true })
        .selectOption(sample.key);
      await run(page);
      const { request, result } = await packet(page, info),
        source = readFileSync(spec.sourceFile, 'utf8').replace(
          '{{n}}',
          String(sample.values.length),
        );
      expect(request.source).toBe(source);
      expect(request.language).toBe('cpp');
      expect(request.input).toEqual({ kind: 'integers', values: sample.values });
      await expect(page.getByLabel('本次执行的只读源码', { exact: true })).toHaveText(source);
      expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 0 });
      const player = new AdvancedPlayer();
      player.accept(result);
      const k = Math.floor(player.snapshot().length / 2);
      player.seek(k);
      const view = player.snapshot(),
        state = view.state!;
      await seek(page, k);
      for (const a of spec.arrays) {
        const graph = page.locator(`[data-testid="algorithm-array"][data-name="${a.name}"]`),
          object = state.objects.find((o) => o.alive && o.name === a.name),
          count = state.objects.find((o) => o.alive && o.name === 'count')?.cells[0]?.value,
          extent =
            a.extent === 'bound'
              ? sample.values[0] + 1
              : a.extent === 'input'
                ? sample.values.length
                : typeof count === 'number'
                  ? count
                  : null;
        await expect(graph).toHaveAttribute('data-present', String(!!object));
        if (object) {
          await expect(graph).toHaveAttribute(
            'data-extent',
            extent === null ? 'unknown' : String(extent),
          );
          const expected = Array.from(
            { length: extent === null ? 0 : Math.min(extent, object.length) },
            (_, i) => {
              const v =
                object.cells.find((c) => c.byteOffset === i * 4)?.value ??
                (object.zeroInitialized ? 0 : null);
              return v === null ? '未初始化' : String(v);
            },
          );
          expect(await graph.locator('li strong').allTextContents()).toEqual(expected);
        } else await expect(graph.locator('li')).toHaveCount(0);
      }
      for (const [key, value] of Object.entries(state.counters))
        await expect(page.locator(`[data-counter="${key}"]`)).toHaveText(String(value));
      if (expectedSourceLine(request.source, view.byteRange))
        await expect(page.getByTestId('memory-source-highlight')).toHaveAttribute(
          'data-byte-start',
          String(view.byteRange!.start),
        );
      else await expect(page.getByTestId('memory-source-highlight')).toHaveCount(0);
      await page
        .getByRole('combobox', { name: '算法观察视图', exact: true })
        .selectOption('memory');
      await expect(page.getByLabel('内存视图', { exact: true })).toContainText(
        state.allocator.liveBytes + ' B',
      );
      await expect(root(page)).toHaveAttribute('data-cursor', String(k));
      await page.getByRole('combobox', { name: '算法观察视图', exact: true }).selectOption('stack');
      await expect(page.getByLabel('调用栈视图', { exact: true })).toContainText(
        '当前 ' + state.frames.length + ' 个活动帧',
      );
      await page.getByRole('combobox', { name: '算法观察视图', exact: true }).selectOption('basic');
      await page.getByRole('button', { name: '前进', exact: true }).click();
      await page.getByRole('button', { name: '后退', exact: true }).click();
      await expect(root(page)).toHaveAttribute('data-cursor', String(k));
      await seek(page, view.length);
      await expect(page.getByTestId('custom-output')).toHaveText(sample.expectedStdout || '');
      await expect(page.getByTestId('algorithm-terminal')).toContainText('completed · 返回值0');
      await seek(page, 0);
      await expect(page.getByTestId('custom-output')).toHaveText('（尚无输出）');
    });
test('manual non-preset inputs change actual Rust output and invalidate the preceding trace', async ({
  page,
}) => {
  const data = [
    [[18], '2 3 5 7 11 13 17\n'],
    [[18], '2 3 5 7 11 13 17\n'],
    [[-4, 2, 5, -3], '7\n'],
    [[4, 2, 3, 1, 5], '3\n'],
  ] as [number[], string][];
  for (const [i, spec] of specs.entries()) {
    await open(page, spec);
    await run(page);
    await page.getByTestId('algorithm-input').fill(data[i][0].join(' '));
    await expect(root(page)).toHaveAttribute('data-state', 'idle');
    await expect(root(page)).toHaveAttribute('data-length', '0');
    await run(page);
    await page.getByRole('button', { name: '查看末步', exact: true }).click();
    await expect(page.getByTestId('custom-output')).toHaveText(data[i][1]);
  }
});
test('illegal, missing and excessive drafts are preserved, cannot run and cannot reuse an old trace', async ({
  page,
}) => {
  await open(page);
  await run(page);
  for (const draft of ['31', '-1', '[]', '', '1e1', '1.5', '1 2']) {
    await page.getByTestId('algorithm-input').fill(draft);
    await expectEditorValue(page.getByTestId('algorithm-input'), draft);
    await expect(page.getByRole('button', { name: '运行C++算法', exact: true })).toBeDisabled();
    await expect(root(page)).toHaveAttribute('data-length', '0');
  }
  await open(page, specs[3]);
  for (const draft of ['', Array(31).fill('1').join(' '), '1000', '-1000']) {
    await page.getByTestId('algorithm-input').fill(draft);
    await expect(page.getByRole('button', { name: '运行C++算法', exact: true })).toBeDisabled();
  }
  await page.getByTestId('algorithm-input').fill('[]');
  await run(page);
  await page.getByRole('button', { name: '查看末步', exact: true }).click();
  await expect(page.getByTestId('custom-output')).toHaveText('0\n');
});
test('course and algorithm catalog entries link four precise cases and unknown ids do not fall back to another program', async ({
  page,
}) => {
  await page.goto('/#/advanced');
  await waitForPhase2Archive(page);
  await expect(page.getByTestId('advanced-algorithm-catalog').locator('li')).toHaveCount(4);
  await page.getByRole('link', { name: '查看四个算法 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '筛法与序列', exact: true })).toBeVisible();
  await page.goto('/#/cases');
  await page.getByText('基础语法与更多案例', { exact: true }).click();
  await expect(page.getByTestId('advanced-algorithm-catalog').locator('li')).toHaveCount(4);
  await page.getByRole('link', { name: '欧拉筛', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-case', specs[1].id);
  await page.getByText('算法讲解、复杂度与基础复习', { exact: true }).click();
  await expect(root(page).getByRole('link', { name: '错题与陌生点', exact: true })).toBeVisible();
  await page.goto('/#/advanced/algorithms/case.cpp.fake');
  await expect(
    page.getByRole('heading', { name: '找不到这个进阶算法', exact: true }),
  ).toBeVisible();
});
test('missing real advanced WASM fails honestly, restoration recovers', async ({ page }) => {
  const module = /c_viz_advanced_bg[^/]*\.wasm/;
  await page.route(module, (r) => r.abort());
  await open(page);
  await page.getByRole('button', { name: '运行C++算法', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('custom-output')).toHaveCount(0);
  await page.unroute(module);
  await run(page);
});
test('controlled native Worker cancellation discards its genuinely late packet and next run recovers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker,
      descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage')!;
    Object.assign(window, {
      algorithmHold: true,
      algorithmWaiting: false,
      algorithmRelease: () => {},
    });
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(this, 'onmessage', {
          get: () => descriptor.get!.call(this),
          set: (callback: ((e: MessageEvent) => unknown) | null) =>
            descriptor.set!.call(
              this,
              callback &&
                ((event: MessageEvent) => {
                  const w = window as unknown as {
                    algorithmHold: boolean;
                    algorithmWaiting: boolean;
                    algorithmRelease: () => void;
                  };
                  if (w.algorithmHold && event.data?.ok) {
                    w.algorithmWaiting = true;
                    w.algorithmRelease = () => callback.call(this, event);
                  } else callback.call(this, event);
                }),
            ),
        });
      }
    };
  });
  await open(page);
  await page.getByRole('button', { name: '运行C++算法', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { algorithmWaiting: boolean }).algorithmWaiting),
    )
    .toBe(true);
  await page.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-state', 'failed');
  await page.evaluate(() => {
    const w = window as unknown as { algorithmHold: boolean; algorithmRelease: () => void };
    w.algorithmRelease();
    w.algorithmHold = false;
  });
  await expect(root(page)).toHaveAttribute('data-length', '0');
  await run(page);
});
test('cross-tab clear invalidates a real run and fresh execution remains available', async ({
  page,
  context,
}) => {
  await open(page, specs[2]);
  await run(page);
  const other = await context.newPage();
  await clear(other);
  await expect(root(page)).toHaveAttribute('data-state', 'idle');
  await expect(root(page)).toHaveAttribute('data-length', '0');
  await other.close();
  await run(page);
});
test('read, execute, seek and views do not mint learning facts or persist algorithm input/trace', async ({
  page,
}, info) => {
  await open(page);
  const before = await native(page);
  for (const s of specs) {
    await open(page, s);
    await run(page);
    await page.getByRole('button', { name: '查看末步', exact: true }).click();
    await page.getByRole('button', { name: '回到初态', exact: true }).click();
  }
  const after = await native(page);
  for (const k of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals', 'aliases'] as const)
    expect(after[k]).toEqual(before[k]);
  expect(JSON.stringify(after)).not.toContain('std::cin');
  await info.attach('no-learning-side-effects', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
});
for (const width of [1440, 768, 390])
  test(`real sieve/DP layout and keyboard ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    for (const spec of [specs[1], specs[3]]) {
      await open(page, spec);
      await page.getByRole('button', { name: '运行C++算法', exact: true }).press('Enter');
      await expect(root(page)).toHaveAttribute('data-state', 'ready');
      const k = Math.floor(Number(await root(page).getAttribute('data-length')) / 2);
      await seek(page, k);
      await page.getByLabel('算法执行观察', { exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(root(page)).toHaveAttribute('data-cursor', String(k + 1));
      await page.keyboard.press('ArrowLeft');
      await expect(root(page)).toHaveAttribute('data-cursor', String(k));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      await page.screenshot({
        path: info.outputPath(spec.id + '-' + width + '.png'),
        fullPage: true,
      });
    }
  });
