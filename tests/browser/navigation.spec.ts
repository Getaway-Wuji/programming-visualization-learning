import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openBlockKeyboardEditor, showPracticeBlocks } from './block-ui';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';

const practicePath = '/#/practice/exercise.c.echo';
const visualPath = '/#/visualize/case.c.bubble-sort';

async function ready(page: Page, id: string) {
  await expect(page.locator(`[data-page-id="${id}"]`)).toBeVisible();
  await expect(page.locator('.state-loading')).toHaveCount(0);
  await expect(page.locator('main h1')).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
}

test('public routes preserve content relationships, refresh and browser history', async ({
  page,
}) => {
  const wasmRequests: string[] = [];
  page.on('request', (request) => {
    if (/\.wasm(?:\?|$)/.test(request.url())) wasmRequests.push(request.url());
  });
  await page.goto('/');
  await ready(page, 'PAGE-01');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: 'C 语言课程' })
    .click();
  await ready(page, 'PAGE-02');
  await expect(
    page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: 'C 语言课程' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.locator('[data-course-lesson] a[href="#/lessons/lesson.c.variables-output"]').click();
  await ready(page, 'PAGE-03');
  await expect(page.locator('main h1')).toHaveText('变量和输出');
  await expect(page.locator('main h1')).toBeFocused();
  await expect(page.getByRole('button', { name: '确认已学习' })).toBeEnabled();
  await expect(
    page.getByRole('navigation', { name: '当前位置' }).getByRole('link', {
      name:
        p05CourseRelease.enabled && process.env.P05_HIDE_COURSE_BUNDLE !== '1'
          ? '程序入门与输出'
          : '变量与表达式',
      exact: true,
    }),
  ).toHaveAttribute('href', '#/courses/chapter.c.values');
  expect(wasmRequests).toEqual([]);
  await page.getByRole('link', { name: '进入练习工作区' }).click();
  await ready(page, 'PAGE-04');
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  expect(wasmRequests.length).toBeGreaterThan(0);
  await expect(page).toHaveURL(/#\/practice\/exercise\.c\.echo$/);
  await page.reload();
  await ready(page, 'PAGE-04');
  await expect(
    page.getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '变量和输出' }),
  ).toHaveAttribute('href', '#/lessons/lesson.c.variables-output');
  await page.goBack();
  await ready(page, 'PAGE-03');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '算法与演示' })
    .click();
  await ready(page, 'PAGE-05');
  await expect(page.locator('main a[href^="#/visualize/"]')).toHaveCount(7);
  await page.locator('main a[href="#/visualize/case.c.bubble-sort"]').click();
  await ready(page, 'PAGE-06');
  await expect(
    page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '算法与演示' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main a[href="#/lessons/lesson.c.array-sum"]').first()).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '本地设置' })
    .click();
  await ready(page, 'PAGE-07');
  await expect(page.getByRole('link', { name: /登录|注册|排行榜/ })).toHaveCount(0);
});

test('workspaces keep real blocks beside read-only code, review playback and empty-review boundaries', async ({
  page,
}, testInfo) => {
  await page.goto(practicePath);
  await ready(page, 'PAGE-04');
  const options = page.getByRole('region', { name: '积木工作区', exact: true });
  await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  await showPracticeBlocks(page);
  await expect(options).toBeVisible();
  await openBlockKeyboardEditor(page);
  await expect(
    options.getByRole('combobox', { name: '添加积木类型', exact: true }).locator('option'),
  ).toHaveCount(20);
  await expect(options.getByRole('combobox', { name: '积木列表', exact: true })).toBeVisible();
  await expect(options.locator('.blocklySvg')).toBeVisible();
  const practiceCode = page.getByTestId('code-panel');
  await expect(practiceCode).toBeVisible();
  await expect(page.getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '运行本组', exact: true })).toBeEnabled();
  const optionsBox = await options.boundingBox();
  const practiceBox = await practiceCode.boundingBox();
  expect(optionsBox).not.toBeNull();
  expect(practiceBox).not.toBeNull();
  expect(optionsBox!.x + optionsBox!.width).toBeLessThanOrEqual(practiceBox!.x + 1);
  expect(Math.abs(optionsBox!.y - practiceBox!.y)).toBeLessThanOrEqual(1);
  const practiceAnimationBox = await page.getByTestId('animation-panel').boundingBox();
  expect(practiceBox!.y + practiceBox!.height).toBeLessThanOrEqual(practiceAnimationBox!.y + 1);
  const source = practiceCode.locator('textarea');
  await expect(source).toHaveAttribute('readonly', '');
  await source.focus();
  const originalSource = await source.inputValue();
  await page.keyboard.type('int changed = 1;');
  await expect(source).toHaveValue(originalSource);
  await expect(source).not.toHaveValue('');
  await expect(page.getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
  await expect(page.getByTestId('practice-feedback')).not.toContainText('本次提交通过');
  await expect(page.getByRole('link', { name: '查看本次复盘', exact: true })).toHaveAttribute(
    'href',
    '#/practice/exercise.c.echo/review',
  );
  await page.screenshot({ path: testInfo.outputPath('practice-layout.png'), fullPage: true });

  await page.goto(visualPath);
  await ready(page, 'PAGE-06');
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('button', { name: '运行示例', exact: true })).toBeEnabled();
  const visualCode = page.getByTestId('code-panel');
  const animation = page.getByTestId('animation-panel');
  const codeBox = await visualCode.boundingBox();
  const animationBox = await animation.boundingBox();
  expect(codeBox!.x + codeBox!.width).toBeLessThanOrEqual(animationBox!.x + 1);
  await expect(visualCode.locator('textarea')).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('input-panel')).toBeVisible();
  for (const label of ['播放', '前进', '后退', '重播']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
  }
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', '');
  await page.screenshot({ path: testInfo.outputPath('visualize-layout.png'), fullPage: true });

  await page.goto('/#/practice/exercise.c.echo/review');
  await ready(page, 'PAGE-06');
  await expect(page.getByTestId('practice-execution')).toContainText('还没有可复盘的运行');
  await expect(page.getByTestId('code-panel')).toHaveCount(0);
  await expect(page.getByTestId('animation-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toHaveCount(0);
  await expect(page.locator('main a[href="#/practice/exercise.c.echo"]').first()).toBeVisible();
  await expect(
    page.locator('main a[href="#/lessons/lesson.c.variables-output"]').first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /运行|设置输入|随机数据/ })).toHaveCount(0);
});

test('keyboard navigation, native dialogs and settings tabs remain usable', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await ready(page, 'PAGE-01');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: '跳到主要内容' });
  await expect(skip).toBeFocused();
  const visibleFocus = await skip.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
  });
  expect(visibleFocus).toBe(true);
  const previousHash = await page.evaluate(() => location.hash);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  expect(await page.evaluate(() => location.hash)).toBe(previousHash);

  for (const [linkName, dialogName] of [
    ['查看积分明细', '积分明细'],
    ['设置每日目标', '每日目标'],
    ['查看打卡历史', '打卡历史'],
  ] as const) {
    const opener = page.getByRole('link', { name: linkName, exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: dialogName });
    await expect(dialog).toBeVisible();
    if (dialogName === '每日目标') {
      await expect(dialog.getByTestId('daily-goal-settings')).toBeVisible();
      for (const [name, value] of [
        ['每日练习数', '1'],
        ['每日小节数', '1'],
        ['每日案例数', '0'],
      ] as const)
        await expect(dialog.getByRole('spinbutton', { name, exact: true })).toHaveValue(value);
      await expect(
        dialog.getByRole('button', { name: '保存自定义目标', exact: true }),
      ).toBeEnabled();
    } else await expect(dialog.locator('.state-empty')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  await page.screenshot({ path: testInfo.outputPath('learning-home.png'), fullPage: true });
  await page.goto('/#/settings?panel=avatar');
  await ready(page, 'PAGE-07');
  for (const [name, panel] of [
    ['基础形象', 'avatar'],
    ['显示设置', 'display'],
    ['本地数据', 'data'],
  ] as const) {
    const tab = page.getByRole('tab', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`#/settings\\?panel=${panel}$`));
    await expect(page.getByRole('tabpanel')).toBeVisible();
  }
  await expect(page.locator('main')).toContainText('不跨设备同步');
  // 04.3 enables the confirmed clear flow once this archive is safely readable.
  await expect(page.getByRole('button', { name: '清除本地数据', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: '基础形象', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '显示设置', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: '显示设置', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: '本地数据', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: '外观与主题', exact: true })).toBeFocused();
});

test('unknown addresses and real lazy module failures provide recovery', async ({ page }) => {
  for (const path of [
    '/#/courses/missing.chapter',
    '/#/lessons/missing.lesson',
    '/#/practice/missing.exercise',
    '/#/visualize/missing.case',
    '/#/unknown',
  ]) {
    await page.goto(path);
    await expect(page.locator('.state-error[role="alert"]')).toBeVisible();
    await expect(page.locator('main .state-actions a')).toBeVisible();
    await page.locator('main .state-actions a').click();
    await expect(page.locator('main [data-page-id]')).toBeVisible();
  }

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/CatalogPages-[^/]+\.js$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
  await ready(page, 'PAGE-01');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: 'C 语言课程' })
    .click();
  try {
    await expect(page.locator('.state-loading[role="status"]')).toContainText('正在准备页面');
  } finally {
    release();
  }
  await ready(page, 'PAGE-02');
  await page.unroute(/\/assets\/CatalogPages-[^/]+\.js$/);

  await page.route(/\/assets\/Workspaces-[^/]+\.js$/, (route) => route.abort('failed'));
  await page.goto(practicePath);
  await expect(page.getByRole('alert')).toContainText('页面加载失败');
  await page.unroute(/\/assets\/Workspaces-[^/]+\.js$/);
  await page.getByRole('button', { name: '重新加载' }).click();
  await ready(page, 'PAGE-04');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('desktop and narrower layouts avoid horizontal page overflow', async ({ page }) => {
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, id] of [
      ['/', 'PAGE-01'],
      [practicePath, 'PAGE-04'],
      [visualPath, 'PAGE-06'],
      ['/#/settings', 'PAGE-07'],
    ] as const) {
      await page.goto(path);
      await ready(page, id);
      await noHorizontalOverflow(page);
      const menu = page.getByRole('button', { name: '展开或收起导航', exact: true });
      await expect(menu).toBeVisible();
      await menu.click();
      // The open drawer makes the background header inert, removing its opener
      // from the accessible tree until navigation is closed.
      await expect(page.locator('.nav-toggle')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveText([
        '学习首页',
        'C 语言课程',
        '算法与演示',
        '编译流程',
        '本地设置',
      ]);
      await noHorizontalOverflow(page);
    }
  }
});
