import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { ExampleSpec } from '../../web/src/examples/content';
import type { AdvancedRequest } from '../../web/src/engine/advanced-protocol';
import { decodeAdvancedResult } from '../../web/src/engine/advanced-protocol';
import { AdvancedPlayer } from '../../web/src/engine/advanced-player';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
import { observeCaseSetExecution } from './case-set-observation';
import { waitForPhase2Archive } from './phase2-ready';
import { native } from './scheduler-helpers';
const specs = JSON.parse(readFileSync('content/advanced/examples-1.0.0.json', 'utf8'))
  .examples as ExampleSpec[];
const workspace = (p: Page) => p.getByTestId('example-workspace');
async function open(p: Page, spec = specs[0]) {
  await p.goto('/#/advanced/examples/' + spec.id);
  await waitForPhase2Archive(p);
  await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
}
async function run(p: Page) {
  await p.getByRole('button', { name: '运行C++例题', exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
}
async function seek(p: Page, cursor: number) {
  await p.getByRole('slider', { name: '例题执行步骤', exact: true }).fill(String(cursor));
  await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
}
async function capture(p: Page, info: TestInfo) {
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
  ) as AdvancedRequest;
  const result = await decodeAdvancedResult(
    Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
    request,
    engineBuild.wasmSha256,
  );
  await info.attach('real-cpp-packet', {
    body: JSON.stringify(raw),
    contentType: 'application/json',
  });
  return { request, result };
}
for (const spec of specs)
  for (const sample of spec.samples)
    test(`real example ${spec.id}/${sample.key}: source, state, reverse and result`, async ({
      page,
    }, info) => {
      await observeCaseSetExecution(page);
      await open(page, spec);
      await page
        .getByRole('combobox', { name: '例题边界样例', exact: true })
        .selectOption(sample.key);
      await run(page);
      const { request, result } = await capture(page, info);
      expect(request.language).toBe('cpp');
      const expectedSource = readFileSync(spec.sourceFile, 'utf8').replace(
        '{{n}}',
        String(sample.values.length),
      );
      expect(request.source).toBe(expectedSource);
      await expect(page.getByLabel('本次执行的只读源码', { exact: true })).toHaveText(
        expectedSource,
      );
      expect(request.input).toEqual({
        kind: 'integers',
        values: [...sample.values, ...(spec.hasTarget ? [sample.target!] : [])],
      });
      expect(result.terminal).toMatchObject({
        status: 'completed',
        returnValue: sample.expectedReturn,
      });
      const player = new AdvancedPlayer();
      player.accept(result);
      const cursor = Math.floor(result.trace!.steps.length / 2);
      player.seek(cursor);
      const view = player.snapshot();
      await seek(page, cursor);
      const object = view.state!.objects.find((o) => o.name === 'values' && o.alive);
      const expected = object
        ? Array.from({ length: sample.values.length }, (_, i) =>
            String(
              object.cells.find((c) => c.byteOffset === i * 4)?.value ??
                (object.zeroInitialized ? 0 : '未初始化'),
            ),
          )
        : [];
      expect(
        await page.getByTestId('example-array').locator('li strong').allTextContents(),
      ).toEqual(expected);
      if (view.byteRange)
        await expect(page.getByTestId('memory-source-highlight')).toHaveAttribute(
          'data-byte-start',
          String(view.byteRange.start),
        );
      await page
        .getByRole('combobox', { name: '例题观察视图', exact: true })
        .selectOption('memory');
      await expect(page.getByRole('region', { name: '内存视图', exact: true })).toContainText(
        '非本机真实地址',
      );
      await expect(workspace(page)).toHaveAttribute('data-cursor', String(cursor));
      await page.getByRole('combobox', { name: '例题观察视图', exact: true }).selectOption('stack');
      await expect(page.getByRole('region', { name: '调用栈视图', exact: true })).toContainText(
        String(view.state!.frames.length) + ' 个活动帧',
      );
      await expect(workspace(page)).toHaveAttribute('data-cursor', String(cursor));
      await page.getByRole('combobox', { name: '例题观察视图', exact: true }).selectOption('basic');
      await page.getByRole('button', { name: '后退', exact: true }).click();
      await expect(workspace(page)).toHaveAttribute('data-cursor', String(cursor - 1));
      await page.getByRole('button', { name: '前进', exact: true }).click();
      expect(
        await page.getByTestId('example-array').locator('li strong').allTextContents(),
      ).toEqual(expected);
      await page.getByRole('button', { name: '查看末步', exact: true }).click();
      await expect(page.getByTestId('custom-output')).toHaveText(sample.expectedStdout);
      await expect(page.getByTestId('example-terminal')).toContainText(
        '返回值' + sample.expectedReturn,
      );
      await page.getByRole('button', { name: '回到初态', exact: true }).click();
      await expect(page.getByTestId('custom-output')).toHaveText('（尚无输出）');
      await expect(page.getByTestId('example-array').locator('li')).toHaveCount(0);
    });
test('invalid shapes, sortedness and edits invalidate the old run without silently changing input', async ({
  page,
}) => {
  await open(page, specs[2]);
  await run(page);
  const values = page.getByTestId('example-values');
  for (const draft of ['', '3 1', '1 1', '1e2 3', '1000 2000', Array(13).fill('0').join(' ')]) {
    await values.fill(draft);
    await expect(workspace(page)).toHaveAttribute('data-state', 'idle');
    await expect(page.getByRole('button', { name: '运行C++例题', exact: true })).toBeDisabled();
    await expect(values).toHaveValue(draft);
    await expect(page.getByTestId('custom-output')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '恢复示例输入', exact: true }).click();
  await run(page);
});
test('external sources remain optional and the three source records match the original links', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**://leetcode.com/**', (route) => {
    requests++;
    return route.abort();
  });
  for (const spec of specs) {
    await open(page, spec);
    await page.getByText('讲解、复杂度、边界与原始来源', { exact: true }).click();
    await expect(page.locator('a[href="' + spec.source.url + '"]')).toHaveText(
      '力扣 ' + spec.source.problemNumber + ' · ' + spec.source.title + ' 原题',
    );
    await expect(page.locator('.example-reading')).toContainText('来源核验日期：2026-11-01');
    await run(page);
  }
  expect(requests).toBe(0);
});
test('missing real WASM fails visibly and the next run recovers', async ({ page }) => {
  const module = /c_viz_advanced_bg[^/]*\.wasm/;
  await page.route(module, (route) => route.abort());
  await open(page);
  await page.getByRole('button', { name: '运行C++例题', exact: true }).click();
  await expect(workspace(page)).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('example-run-status')).toContainText('未接收');
  await expect(page.getByTestId('custom-output')).toHaveCount(0);
  await page.unroute(module);
  await run(page);
});
test('cancel releases an explicitly held real Worker and a fresh run succeeds', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    Object.assign(window, { exampleHold: true });
    window.Worker = class extends Native {
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        if ((window as unknown as { exampleHold: boolean }).exampleHold) return;
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  await open(page);
  await page.getByRole('button', { name: '运行C++例题', exact: true }).click();
  await page.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(workspace(page)).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('example-run-status')).toContainText('E_CANCELLED');
  await page.evaluate(() => ((window as unknown as { exampleHold: boolean }).exampleHold = false));
  await run(page);
});
test('passive reading, actual execution and replay do not mint progress or persist source/input/trace', async ({
  page,
}, info) => {
  await open(page);
  const before = await native(page);
  for (const spec of specs) {
    await open(page, spec);
    await run(page);
    await page.getByRole('button', { name: '查看末步', exact: true }).click();
    await page.getByRole('button', { name: '回到初态', exact: true }).click();
  }
  const after = await native(page);
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals', 'aliases'] as const)
    expect(after[key]).toEqual(before[key]);
  expect(JSON.stringify(after)).not.toContain('std::cin');
  await info.attach('no-learning-side-effects', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
});
test('directory links and unknown identities remain bounded to reviewed examples', async ({
  page,
}) => {
  await page.goto('/#/advanced');
  await waitForPhase2Archive(page);
  await expect(page.getByRole('link', { name: '查看全部三例 →', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看全部三例 →', exact: true }).click();
  await expect(page.getByTestId('example-catalog').locator('.advanced-lesson-list li')).toHaveCount(
    3,
  );
  await page.goto('/#/advanced/examples/example.cpp.fake');
  await expect(
    page.getByRole('heading', { name: '找不到这个经典例题', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '返回经典例题', exact: true }).click();
  await expect(page.getByTestId('example-catalog')).toBeVisible();
});
for (const width of [1440, 768, 390])
  test(`classical example layout and keyboard action at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/advanced/examples');
    await expect(page.getByTestId('example-catalog')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('catalog-' + width + '.png'), fullPage: true });
    await page.getByRole('link', { name: specs[1].title, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(workspace(page)).toHaveAttribute('data-state', 'idle');
    await page.getByRole('button', { name: '运行C++例题', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(workspace(page)).toHaveAttribute('data-state', 'ready');
    await seek(page, Math.floor(Number(await workspace(page).getAttribute('data-length')) / 2));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('workspace-' + width + '.png'), fullPage: true });
  });
