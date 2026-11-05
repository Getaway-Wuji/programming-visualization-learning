import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { visualModules } from '../../web/src/visual-lab/catalog';
import samples from '../fixtures/visual-lab-cases.json' with { type: 'json' };

test('home restores panels and goal and navigation lead directly to real exercises', async ({
  page,
}) => {
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: '继续学 C', exact: true })).toBeVisible();
  await expect(page.locator('.c6-next-section')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(
    page.getByTestId('daily-goal-summary').getByRole('link', { name: '练习 →' }),
  ).toHaveAttribute('href', '#/practice');
  await expect(page.getByText('本地档案已读取', { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('link', { name: '今日复习', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '练习', exact: true })
    .click();
  await expect(page.locator('.c6-practice-entry')).toHaveCount(44);
  await page.locator('.c6-practice-entry').first().click();
  await expect(page.getByLabel('完整 C 源码 · main.c', { exact: true })).toBeEditable();
});

test('scrolling completes reading once, retains it on refresh and shows no confirmation or program panel', async ({
  page,
}) => {
  await page.goto('/#/lessons/lesson.c6.s2.1');
  const end = page.getByTestId('reading-end');
  await expect(end).toHaveAttribute('data-read', 'false');
  await expect(page.getByText('本节完整程序', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '我已读完本节', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认今日复习', exact: true })).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(end).toHaveAttribute('data-read', 'true');
  await page.reload();
  await expect(end).toHaveAttribute('data-read', 'true');
  await expect(page.getByRole('button', { name: '标记陌生', exact: true })).toBeAttached();
  await expect(page.getByText('本地档案已读取', { exact: true })).toHaveCount(0);
  await page.goto('/#/courses');
  await page.getByRole('searchbox').fill('2.1');
  await expect(
    page.locator('.c6-node-list').getByRole('link').filter({ hasText: '2.1 简单的C程序示例' }),
  ).toContainText('已完成');
});

test('block preference lives in settings, never in the question workspace', async ({ page }) => {
  await page.goto('/#/practice/exercise.c.bug-semicolon');
  const editor = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('block-workspace-preference')).toHaveCount(0);
  await expect(page.getByText('积木权限', { exact: true })).toHaveCount(0);
  const textareaBox = await editor.boundingBox();
  const hintBox = await page
    .getByRole('button', { name: '查看第 1 层提示', exact: true })
    .boundingBox();
  expect(textareaBox!.y).toBeLessThan(hintBox!.y);
  await page.goto('/#/settings?panel=display');
  await expect(page.getByLabel('积木显示', { exact: true })).toBeVisible();
  await page.getByLabel('积木显示', { exact: true }).selectOption('hide');
  await page.goto('/#/practice/exercise.c6.s2.1');
  await expect(page.getByLabel('完整 C 源码 · main.c', { exact: true })).toBeEditable();
  await expect(page.getByRole('button', { name: '同步到积木', exact: true })).toHaveCount(0);
});

test('case screen hides technical notices and random seeds', async ({ page }) => {
  await page.goto('/#/visualize/case.c.bubble-sort');
  await expect(page.getByTestId('input-panel')).toBeVisible();
  await expect(page.getByText('已审核案例 · 独立观看', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '执行模块连接', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('随机种子', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '生成随机数据', exact: true }).click();
  await expect(page.getByTestId('case-execution')).not.toContainText('种子：');
});

test('catalog includes every reference module and searches across categories', async ({ page }) => {
  await page.goto('/#/cases');
  await expect(page.locator('.lab-category a')).toHaveCount(40);
  await page.getByRole('searchbox').fill('红黑树');
  await expect(page.locator('.lab-category a')).toHaveCount(1);
  await page.getByRole('link', { name: /红黑树 用左倾/ }).click();
  await expect(page.getByTestId('visual-lab')).toHaveAttribute('data-module', 'rbtree');
});

for (const sample of samples)
  test(`live browser ${sample.slug}: exact output, progress, reverse and input invalidation`, async ({
    page,
  }) => {
    await page.goto(`/#/algorithms/lab/${sample.slug}`);
    await expect(page.getByTestId('visual-lab')).toHaveAttribute('data-module', sample.slug);
    const slider = page.getByRole('slider', { name: '播放进度', exact: true });
    await expect(slider).toBeEnabled();
    await expect(page.getByTestId('memory-source-highlight')).toHaveCount(0);
    const initial = await page.getByTestId('lab-current-state').textContent();
    await slider.press('End');
    await expect(page.getByTestId('lab-output')).toHaveText(sample.stdout);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(page.getByTestId('lab-current-state')).toHaveText(initial!);
    await expect(page.getByTestId('memory-source-highlight')).toHaveCount(0);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    const highlight = page.getByTestId('memory-source-highlight');
    await expect(highlight).toBeVisible();
    expect((await highlight.textContent())!.trim()).not.toMatch(/^[{};\s]+$/);
    await expect(highlight).toHaveCSS('outline-style', 'none');
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await expect(page.getByTestId('lab-current-state')).toHaveText(initial!);
    const spec = visualModules.find((s) => s.slug === sample.slug)!;
    if ('values' in spec.defaults) {
      await page.getByLabel(spec.kind === 'tree' ? '节点值' : '数据', { exact: true }).fill('[]');
      await expect(slider).toBeDisabled();
    }
  });

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
])
  test(`layout fits ${width}px for home, reading, practice and algorithm`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const [name, path] of [
      ['home', '/'],
      ['reading', '/lessons/lesson.c6.s2.1'],
      ['practice', '/practice/exercise.c.bug-semicolon'],
      ['algorithm', '/algorithms/lab/bubble'],
    ]) {
      await page.goto(`/#${path}`);
      await expect(page.locator('main h1')).toBeVisible();
      if (name === 'algorithm')
        await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toBeEnabled();
      if (name === 'practice')
        await expect(page.getByRole('textbox', { name: '编辑 C 代码', exact: true })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: `.artifacts/ui-feedback/${name}-${width}.png`,
        fullPage: true,
      });
    }
  });

test('algorithm source remains a real program, and red-black trees keep their invariants on changed inputs', async ({
  page,
}) => {
  await page.goto('/#/algorithms/lab/rbtree');
  await page.getByLabel('节点值', { exact: true }).fill('7 6 5 4 3 2 1');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  const slider = page.getByRole('slider', { name: '播放进度', exact: true });
  await expect(slider).toBeEnabled();
  await slider.press('End');
  await expect(page.getByTestId('lab-output')).toHaveText('1 2 3 4 5 6 7 \n');
  await expect(page.locator('.lab-tree .lab-node')).toHaveCount(7);
  await expect(page.getByLabel('本次执行的只读源码', { exact: true })).toHaveText(
    readFileSync('content/algorithms/visual-lab/rbtree.cpp', 'utf8'),
  );
});
