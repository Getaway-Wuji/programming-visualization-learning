import { expect, test } from '@playwright/test';
import { native } from '../ai-browser/helpers';
import { openIndependentEchoRepair } from '../browser/current-course-helpers';

test('current navigation entries and original workbench width/collapse behavior at four desktop widths', async ({
  page,
}, info) => {
  await openIndependentEchoRepair(page);
  await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  const before = await native(page);
  const samples = [];
  for (const width of [1366, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    const bench = page.locator('[data-testid="workbench"][data-kind="practice"]');
    const geometry = () =>
      bench.evaluate((element) => {
        const box = (node: Element) => {
          const { x, width, right } = node.getBoundingClientRect();
          return { x, width, right };
        };
        return {
          sidebar: box(document.querySelector('.sidebar')!),
          main: box(document.querySelector('.main-content')!),
          bench: box(element),
          first: box(element.querySelector('[data-testid="workbench-first"]')!),
          second: box(element.querySelector('[data-testid="workbench-second"]')!),
        };
      });
    await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toBeVisible();
    const expanded = await geometry();
    expect(expanded.sidebar.x).toBeCloseTo(0, 0);
    expect(expanded.sidebar.width).toBeCloseTo(216, 0);
    expect(expanded.main.right).toBeCloseTo(width, 0);
    expect(expanded.bench.width).toBeGreaterThan(expanded.main.width * 0.8);
    expect(expanded.first.right).toBeLessThanOrEqual(expanded.second.x + 1);
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
    const collapsed = await geometry();
    expect(collapsed.sidebar.x).toBeCloseTo(0, 0);
    expect(collapsed.sidebar.width).toBeCloseTo(60, 0);
    expect(collapsed.bench.width).toBeGreaterThan(expanded.bench.width + 140);
    const links = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link');
    await expect(links).toHaveText([
      '学习首页',
      'C 语言课程',
      'Python 课程',
      'Java 课程',
      'C++ 课程',
      'Rust 课程',
      'MySQL 课程',
      '练习',
      '进阶课程',
      '算法与演示',
      'C 代码工作台',
      '错题与陌生点',
      '学习笔记',
      '学习成就',
      '设置',
    ]);
    for (const link of await links.all()) await expect(link).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    samples.push({ width, expanded, collapsed });
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'expanded');
  }
  const after = await native(page);
  const a = before.databases['c-viz-learning'] as { rows: Record<string, unknown> };
  const b = after.databases['c-viz-learning'] as { rows: Record<string, unknown> };
  // The original Blockly practice intentionally autosaves its editHistory draft on mounting.
  // All learning partitions and their native keys must still remain byte-for-byte equal.
  for (const name of Object.keys(a.rows).filter(
    (name) => !['appearance', 'meta', 'editHistory'].includes(name),
  ))
    expect(b.rows[name]).toEqual(a.rows[name]);
  await info.attach('current-navigation-and-geometry', {
    body: JSON.stringify({ samples, before, after }),
    contentType: 'application/json',
  });
});

test('a real static deployment without the AI gateway fails before forwarding a Key and ordinary Rust C still runs', async ({
  page,
}) => {
  const posts: string[] = [];
  const external: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/ai/'))
      posts.push(request.url());
    if (!request.url().startsWith('http://127.0.0.1:4178/')) external.push(request.url());
  });
  await page.goto('/#/settings?panel=ai');
  await page.getByLabel('AI服务', { exact: true }).selectOption('openai');
  await page.getByLabel('AI模型', { exact: true }).selectOption('gpt-5.4-mini-2026-03-17');
  await page.getByLabel('你自己的API Key', { exact: true }).fill('DESIGN_ONLY_NOT_A_REAL_KEY');
  await page.getByRole('switch', { name: '验证并开启AI解释', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('当前入口未连接AI转发服务');
  expect(posts).toEqual([]);
  await page.goto('/#/custom-code');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-status', 'ready');
  expect(external).toEqual([]);
});
