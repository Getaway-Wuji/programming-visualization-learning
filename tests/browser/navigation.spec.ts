import { editorValue, expectEditorValue } from './editor-value';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openBlockKeyboardEditor, showPracticeBlocks } from './block-ui';
import { openIndependentEchoRepair } from './current-course-helpers';
import { currentSource, submitCurrentVerdict } from './current-c6-ui';

const practicePath = '/#/practice/exercise.c.bug-semicolon';
const currentPracticePath = '/#/practice/exercise.c6.s2.1';
const visualPath = '/#/visualize/case.c.bubble-sort';

async function ready(page: Page, id: string) {
  const surface =
    id === 'PAGE-01'
      ? page.locator('.c6-home-columns')
      : id === 'PAGE-02'
        ? page.getByRole('heading', { name: '课程目录', exact: true })
        : id === 'PAGE-03'
          ? page.locator('.c6-reading-page')
          : id === 'PAGE-04'
            ? page.locator('main h1')
            : id === 'PAGE-06' && page.url().endsWith('/review')
              ? page.locator('[data-mode="exercise-review"]')
              : page.locator(`[data-page-id="${id}"]`);
  await expect(surface).toBeVisible();
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
  await page.locator('main a[href="#/courses/c6.ch02"]').click();
  await page.locator('main a[href="#/lessons/lesson.c6.s2.1"]').click();
  await ready(page, 'PAGE-03');
  await expect(page.locator('main h1')).toHaveText('2.1 简单的C程序示例');
  await expect(page.locator('main h1')).toBeFocused();
  await expect(page.getByTestId('reading-end')).toBeAttached();
  await expect(page.getByRole('button', { name: '我已读完本节', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: '当前位置' }).getByRole('link', {
      name: '第2章 C语言概述',
      exact: true,
    }),
  ).toHaveAttribute('href', '#/courses/c6.ch02');
  expect(wasmRequests).toEqual([]);
  await page.getByRole('link', { name: '去练习', exact: true }).click();
  await ready(page, 'PAGE-04');
  await expect(currentSource(page)).toBeEditable();
  await expect(page.getByTestId('oj-verdict')).toHaveCount(0);
  await currentSource(page).fill(
    '#include <stdio.h>\nint main(void){int n;scanf("%d",&n);printf("n=%d\\n",n);return 0;}',
  );
  await submitCurrentVerdict(page);
  expect(wasmRequests.length).toBeGreaterThan(0);
  await expect(page).toHaveURL(/#\/practice\/exercise\.c6\.s2\.1$/);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('c6-draft-save-status')).toHaveText('草稿已保存');
  await page.reload();
  await ready(page, 'PAGE-04');
  await expect(
    page.getByRole('link', { name: '返回 2.1 简单的C程序示例', exact: true }),
  ).toHaveAttribute('href', '#/lessons/lesson.c6.s2.1');
  await page.goBack();
  await ready(page, 'PAGE-03');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '算法与演示' })
    .click();
  await ready(page, 'PAGE-05');
  await expect(page.locator('main a[href^="#/visualize/"]')).toHaveCount(7);
  await page.locator('summary').filter({ hasText: '基础语法与更多案例' }).click();
  await page.locator('main a[href="#/visualize/case.c.bubble-sort"]').click();
  await ready(page, 'PAGE-06');
  await expect(
    page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '算法与演示' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: '案例讲解', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '设置', exact: true })
    .click();
  await ready(page, 'PAGE-07');
  await expect(page.getByRole('link', { name: /登录|注册|排行榜/ })).toHaveCount(0);
});

test('workspaces keep real blocks beside read-only code, review playback and empty-review boundaries', async ({
  page,
}, testInfo) => {
  await openIndependentEchoRepair(page);
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
  await page.getByRole('button', { name: '运行本组', exact: true }).click();
  await expect(page.getByTestId('animation-panel')).toBeVisible();
  const practiceAnimationBox = await page.getByTestId('animation-panel').boundingBox();
  expect(practiceBox!.y + practiceBox!.height).toBeLessThanOrEqual(practiceAnimationBox!.y + 1);
  const source = practiceCode.locator('textarea');
  await expect(source).toHaveAttribute('readonly', '');
  await source.focus();
  const originalSource = await editorValue(source);
  await page.keyboard.type('int changed = 1;');
  await expectEditorValue(source, originalSource);
  await expectEditorValue(source, '', { not: true });
  await expect(page.getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
  await expect(page.getByTestId('practice-feedback')).not.toContainText('本次提交通过');
  await expect(page.getByRole('link', { name: '查看本次复盘', exact: true })).toHaveAttribute(
    'href',
    '#/practice/exercise.c.bug-semicolon/review',
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

  await page.goto('/#/practice/exercise.c.bug-semicolon/review');
  await ready(page, 'PAGE-06');
  await expect(page.getByTestId('practice-execution')).toContainText('还没有可复盘的运行');
  await expect(page.getByTestId('code-panel')).toHaveCount(0);
  await expect(page.getByTestId('animation-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toHaveCount(0);
  await expect(
    page.locator('main a[href="#/practice/exercise.c.bug-semicolon"]').first(),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bug 修复闯关', exact: true })).toHaveAttribute(
    'href',
    '#/bugs',
  );
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
    const opener =
      dialogName === '积分明细'
        ? page.getByRole('button', { name: /^积分 \d+，查看明细$/ })
        : page.getByRole('link', { name: linkName, exact: true });
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
        await expectEditorValue(dialog.getByRole('spinbutton', { name, exact: true }), value);
      await expect(
        dialog.getByRole('button', { name: '保存自定义目标', exact: true }),
      ).toBeEnabled();
    } else await expect(dialog.locator('.state-empty')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  await page.screenshot({ path: testInfo.outputPath('learning-home.png'), fullPage: true });
  await page.goto('/#/settings?panel=appearance');
  await ready(page, 'PAGE-07');
  for (const [name, panel] of [
    ['外观与主题', 'appearance'],
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
  await page.getByRole('tab', { name: '外观与主题', exact: true }).focus();
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
    if (/\/(courses|lessons|practice)\//.test(path)) {
      await expect(
        page.getByRole('heading', { name: '课程内容已更新', exact: true }),
      ).toBeVisible();
      await page.getByRole('link', { name: '打开课程目录', exact: true }).click();
      await ready(page, 'PAGE-02');
    } else {
      await expect(page.locator('.state-error[role="alert"]')).toBeVisible();
      await expect(page.locator('main .state-actions a')).toBeVisible();
      await page.locator('main .state-actions a').click();
      await expect(page.locator('main h1')).toBeVisible();
    }
  }

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cold = await page.context().newPage();
  await cold.route(/\/assets\/CoursePages-[^/]+\.js$/, async (route) => {
    await gate;
    await route.continue();
  });
  await cold.goto('/#/courses', { waitUntil: 'domcontentloaded' });
  try {
    await expect(cold.locator('.state-loading[role="status"]')).toContainText('正在准备页面');
  } finally {
    release();
  }
  await ready(cold, 'PAGE-02');
  await cold.unroute(/\/assets\/CoursePages-[^/]+\.js$/);
  await cold.close();

  await page.route(/\/assets\/IndependentPracticePage-[^/]+\.js$/, (route) =>
    route.abort('failed'),
  );
  await page.goto(practicePath);
  await expect(page.getByRole('alert')).toContainText('页面加载失败');
  await page.unroute(/\/assets\/IndependentPracticePage-[^/]+\.js$/);
  await page.getByRole('button', { name: '重新加载' }).click();
  await ready(page, 'PAGE-04');
  await openIndependentEchoRepair(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('desktop and narrower layouts avoid horizontal page overflow', async ({ page }) => {
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, id] of [
      ['/', 'PAGE-01'],
      [practicePath, 'PAGE-04'],
      [currentPracticePath, 'PAGE-04'],
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
      await noHorizontalOverflow(page);
    }
  }
});
