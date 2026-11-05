import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { observeCaseSetExecution } from './case-set-observation';
import type { AlgorithmResult } from '../../web/src/engine/algorithm-protocol';

const folder = `.artifacts/21.6/ui-feedback/${process.env.TASK_EVIDENCE_LABEL ?? 'current'}`;
test.beforeAll(() => mkdir(folder, { recursive: true }));
for (const width of [1440, 768, 390])
  test(`home learning card leads and knowledge map closes the page at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const continuation = page.locator('.c6-next-section .button-primary');
    await expect(continuation).toBeVisible();
    await expect(page.getByTestId('achievement-summary')).toHaveCount(0);
    const composition = page.locator('.c6-course-page');
    expect(
      await composition.locator('.c6-home-columns > section').first().getAttribute('class'),
    ).toMatch(/\bc6-next-section\b/);
    await expect(composition.locator(':scope > section').last()).toHaveAttribute(
      'data-testid',
      'c6-knowledge-map',
    );
    const graph = page.getByTestId('c6-knowledge-map'),
      feature = page.locator('.c6-next-section');
    await expect(graph.locator(':scope > details')).toHaveCount(17);
    await expect(graph).toContainText('0 / 421 已点亮');
    expect((await graph.boundingBox())!.y).toBeGreaterThan((await feature.boundingBox())!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${folder}/home-${width}.png`, fullPage: true });
    await continuation.click();
    await expect(page).toHaveURL(/\/lessons\//);
  });

test('catalog follows syntax, basic sorting/search, C++ sorting, structures and classics', async ({
  page,
}) => {
  await page.goto('/#/cases');
  await expect(page.locator('.lab-category a')).toHaveCount(40);
  await page.getByText('基础语法与更多案例', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '基础语法演示', exact: true })).toBeVisible();
  const headings = await page.locator('main h2').allTextContents();
  const groups = ['基础语法演示', '排序与查找', 'C++ · 迭代排序', 'C++ · 递归排序', 'C++ · 桶排序'];
  expect(groups.map((text) => headings.indexOf(text))).toEqual(
    [...groups.map((text) => headings.indexOf(text))].sort((a, b) => a - b),
  );
  expect(headings[0]).toMatch(/算法可视化/);
  expect(headings.at(-1)).toBe('进阶观察 · 内存与调用栈');
  expect(await page.locator('main a[href*="/visualize/"]').count()).toBe(7);
  await page.screenshot({ path: `${folder}/catalog.png`, fullPage: true });
});

test('real C key playback credits rendered key stops, preserves backtracking and locks challenge detail', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await page.goto('/#/visualize/case.c.assignment');
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  const detail = page.getByRole('combobox', { name: '步骤显示', exact: true });
  await expect(detail).toHaveValue('key');
  const controls = page.getByTestId('player-controls');
  await page.getByTestId('trace-view').scrollIntoViewIfNeeded();
  const total = Number(await page.getByTestId('case-view-coverage').getAttribute('data-total'));
  for (let at = 1; at <= total; at++) {
    await controls.getByRole('button', { name: '前进', exact: true }).click();
    await page.getByTestId('trace-view').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('case-view-coverage')).toHaveAttribute(
      'data-covered',
      String(at),
    );
  }
  expect(Number(await controls.getAttribute('data-length'))).toBeGreaterThan(total);
  await expect(page.getByRole('button', { name: '确认已观看', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '确认已观看', exact: true }).click();
  await expect(page.getByTestId('case-view-confirmation')).toHaveAttribute(
    'data-view-state',
    'saved',
  );
  await controls.getByRole('button', { name: '后退', exact: true }).click();
  await expect(page.getByTestId('source-step-highlight')).toBeVisible();
  await detail.selectOption('all');
  await page.getByRole('button', { name: '预测挑战', exact: true }).click();
  await expect(detail).toBeDisabled();
  await expect(detail).toHaveValue('all');
  await expect(
    page.getByRole('group', { name: '本次挑战题目', exact: true }).getByRole('button'),
  ).toHaveCount(3);
  expect(
    await page.evaluate(() =>
      window.__verticalObservation.workers.some((w) => w.moduleSeen && w.responseOk),
    ),
  ).toBe(true);
});

for (const width of [1440, 390])
  test(`nearby sorting values and a full 30-item array stay readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await observeCaseSetExecution(page);
    await page.goto('/#/algorithms/case.cpp.insertion-sort');
    const workspace = page.getByTestId('sort-workspace');
    await expect(workspace).toHaveAttribute('data-state', 'idle');
    for (const values of [[7, 8, 9], Array.from({ length: 30 }, (_, i) => 970 + i)]) {
      await page.getByTestId('sort-input').fill(values.join(' '));
      await page.getByRole('button', { name: '运行C++案例', exact: true }).click();
      await expect(workspace).toHaveAttribute('data-state', 'ready');
      const encoded = await page.evaluate(() => {
        const record = window.__verticalObservation.workers.findLast(
          (w) => w.moduleSeen && w.responseOk,
        )!;
        return (
          record as unknown as { captureEncoded: () => { responseBase64: string } }
        ).captureEncoded().responseBase64;
      });
      const result = JSON.parse(Buffer.from(encoded, 'base64').toString()) as AlgorithmResult;
      const cursor = result.trace!.steps.findLastIndex((step) => step.kind === 'input.read') + 1;
      await page.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
      await page.getByRole('slider', { name: 'C++排序执行步骤', exact: true }).fill(String(cursor));
      await expect(workspace).toHaveAttribute('data-cursor', String(cursor));
      const cells = page.getByTestId('sort-cell');
      await expect(cells).toHaveCount(values.length);
      expect(await cells.locator('.array-value').allTextContents()).toEqual(values.map(String));
      expect(
        await cells.locator('.array-value').evaluateAll((elements) =>
          elements.every((el) => {
            const parent = el.parentElement!.getBoundingClientRect(),
              label = el.getBoundingClientRect();
            return (
              parseFloat(getComputedStyle(el).fontSize) >= 16 &&
              label.left >= parent.left &&
              label.right <= parent.right
            );
          }),
        ),
      ).toBe(true);
      await cells.first().scrollIntoViewIfNeeded();
      await page
        .getByTestId('sort-array')
        .screenshot({ path: `${folder}/numbers-${width}-${values.length}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });

const groups = [
  [
    'content/algorithms/cpp/iterative-sorts-1.0.0.json',
    'algorithms',
    'sort',
    '运行C++案例',
    'C++排序执行步骤',
  ],
  [
    'content/algorithms/cpp/recursive-sorts-1.0.0.json',
    'algorithms',
    'sort',
    '运行C++案例',
    'C++排序执行步骤',
  ],
  [
    'content/algorithms/cpp/bucket-sort-1.0.0.json',
    'algorithms',
    'sort',
    '运行C++案例',
    'C++排序执行步骤',
  ],
  [
    'content/algorithms/cpp/stack-queue-1.0.0.json',
    'structures',
    'structure',
    '运行C++操作',
    '结构执行步骤',
  ],
  [
    'content/algorithms/cpp/linked-nodes-1.0.0.json',
    'nodes',
    'node',
    '运行C++节点操作',
    '节点执行步骤',
  ],
  [
    'content/algorithms/cpp/classics-1.0.0.json',
    'classics',
    'classic',
    '运行C++经典案例',
    '经典执行步骤',
  ],
] as const;
for (const [file, route, prefix, runName, sliderName] of groups) {
  const specs = JSON.parse(readFileSync(file, 'utf8')).cases as { id: string }[];
  for (const spec of specs)
    test(`actual C++ key/detail controls and recovery: ${spec.id}`, async ({ page }) => {
      await page.goto(`/#/${route}/${spec.id}`);
      const workspace = page.getByTestId(`${prefix}-workspace`);
      await expect(workspace).toHaveAttribute('data-state', 'idle');
      const detail = page.getByRole('combobox', { name: '步骤显示', exact: true });
      await expect(detail).toHaveValue('key');
      await page.getByRole('button', { name: runName, exact: true }).click();
      await expect(workspace).toHaveAttribute('data-state', 'ready');
      const forward = page.getByRole('button', { name: '前进', exact: true });
      await forward.click();
      expect(Number(await workspace.getAttribute('data-cursor'))).toBeGreaterThan(1);
      await page.getByRole('button', { name: '后退', exact: true }).click();
      await expect(workspace).toHaveAttribute('data-cursor', '0');
      await detail.selectOption('all');
      await forward.click();
      await expect(workspace).toHaveAttribute('data-cursor', '1');
      const fullLength = Number(await workspace.getAttribute('data-length'));
      await detail.selectOption('key');
      const slider = page.getByRole('slider', { name: sliderName, exact: true });
      expect(Number(await slider.getAttribute('max'))).toBeLessThan(fullLength);
      await slider.fill((await slider.getAttribute('max')) ?? '0');
      await expect(workspace).toHaveAttribute('data-cursor', String(fullLength));
      await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '回到初态', exact: true }).click();
      await expect(workspace).toHaveAttribute('data-cursor', '0');
      if (prefix === 'sort') {
        await detail.selectOption('all');
        for (let i = 0; i < 30 && !(await page.getByTestId('sort-cell').count()); i++)
          await forward.click();
        const cell = page
          .getByTestId('sort-cell')
          .filter({ has: page.locator('.array-value') })
          .first();
        await expect(cell.locator('.array-value')).toBeVisible();
        expect(
          await cell
            .locator('.array-value')
            .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
        ).toBeGreaterThanOrEqual(16);
        await page.screenshot({ path: `${folder}/${spec.id}.png`, fullPage: true });
      }
    });
}
