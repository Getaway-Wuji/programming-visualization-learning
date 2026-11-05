import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import { blockOptions, blockWorkspace, selectBlock } from './block-ui';

const source = JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
  chapters: { exercises: C6CourseExercise[] }[];
};
const exercises = source.chapters.flatMap((chapter) => chapter.exercises);
const editorText = (page: Page) =>
  page
    .locator('.code-editor .cm-line')
    .allTextContents()
    .then((lines) => lines.join('\n'));
async function scrollBottom(page: Page) {
  await expect(page.getByTestId('reading-end')).toBeAttached();
  await page.locator('main').click({ position: { x: 10, y: 100 } });
  await page.mouse.wheel(0, 100_000);
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read', 'true');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}
test('mouse scrolling records two consecutive sections, daily and course progress, reload and deduplication', async ({
  page,
}) => {
  await page.goto('/#/lessons/lesson.c6.s1.2.2');
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read', 'false');
  await scrollBottom(page);
  await page.getByRole('navigation', { name: '下一小节' }).getByRole('link').click();
  await expect(page).toHaveURL(/lesson.c6.s1.2.3/);
  await scrollBottom(page);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '学习首页', exact: true })
    .click();
  await expect(page.getByTestId('goal-progress-lesson')).toContainText('2 / 1');
  await expect(
    page.getByRole('progressbar', { name: 'C 课程完成进度', exact: true }),
  ).toHaveAttribute('value', '2');
  await page.reload();
  await expect(page.getByTestId('goal-progress-lesson')).toContainText('2 / 1');
  await page.goto('/#/lessons/lesson.c6.s1.2.2');
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read', 'true');
  await scrollBottom(page);
  await page.goto('/#/');
  await expect(page.getByTestId('goal-progress-lesson')).toContainText('2 / 1');
});
test('course offers only bound exercise links and completing reading does not require passing the exercise', async ({
  page,
}) => {
  await page.goto('/#/lessons/lesson.c6.s2.1');
  await scrollBottom(page);
  await page.getByRole('link', { name: '去练习', exact: true }).click();
  await expect(page).toHaveURL(/practice\/exercise.c6.s2.1$/);
  await page.goto('/#/');
  await expect(page.getByTestId('goal-progress-lesson')).toContainText('1 / 1');
  await page.goto('/#/lessons/lesson.c6.s1.2.2');
  await expect(page.getByRole('link', { name: '去练习', exact: true })).toHaveCount(0);
});
for (const exercise of exercises)
  test(`OJ samples match authored data: ${exercise.ref.id}`, async ({ page }) => {
    await page.goto(`/#/practice/${exercise.ref.id}`);
    await expect(
      page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true }),
    ).toBeEditable();
    await expect(page.getByRole('heading', { name: '题目描述', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '输入格式', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '输出格式', exact: true })).toBeVisible();
    await expect(page.getByLabel('输入示例 1', { exact: true })).toHaveText(
      exercise.tests[0].stdin || '（无输入）',
    );
    await expect(page.getByLabel('输出示例 1', { exact: true })).toHaveText(
      exercise.tests[0].expectedStdout || '（无输出）',
    );
    await expect(page.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: /下载|判定全部|运行当前/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '真实执行轨迹' })).toHaveCount(0);
  });
test('real C6 submissions ignore trailing whitespace, retain correct learning rights and reject wrong data', async ({
  page,
}) => {
  const exercise = exercises.find((e) => e.ref.id === 'exercise.c6.s2.1')!;
  await page.goto('/#/practice/exercise.c6.s2.1');
  const editor = page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true });
  await expect(editor).toBeEditable();
  await editor.fill(exercise.referenceSource.replace(/\\n/g, '  \\n\\n'));
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveText('通过');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await page.goto('/#/practice');
  await expect(page.locator('a[href="#/practice/exercise.c6.s2.1"]')).toContainText('已通过');
  await page.reload();
  await expect(page.locator('a[href="#/practice/exercise.c6.s2.1"]')).toContainText('已通过');
  await page.goto('/#/practice/exercise.c6.s2.1');
  await editor.fill(exercise.referenceSource.replace(/\\n/g, ''));
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveText('通过');
  await editor.fill(exercise.referenceSource.replace('n=%d', 'wrong=%d'));
  await expect(page.getByTestId('oj-verdict')).toHaveCount(0);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveText('未通过');
});
test('editor supports indentation, undo/redo, prefix suggestions, selection and dismissal', async ({
  page,
}) => {
  await page.goto('/#/practice/exercise.c6.s2.1');
  const editor = page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true });
  await editor.fill('int count = 3;\n');
  await editor.press('Control+End');
  await editor.press('Tab');
  await expect.poll(() => editorText(page)).toBe('int count = 3;\n    ');
  await editor.press('Shift+Tab');
  await expect.poll(() => editorText(page)).toBe('int count = 3;\n');
  await editor.press('Control+z');
  await expect.poll(() => editorText(page)).toBe('int count = 3;\n    ');
  await editor.press('Control+y');
  await expect.poll(() => editorText(page)).toBe('int count = 3;\n');
  await editor.pressSequentially('pri');
  await expect(page.getByRole('option').filter({ hasText: 'printf' })).toBeVisible();
  await editor.press('Tab');
  await expect.poll(() => editorText(page)).toContain('printf');
  await editor.press('Enter');
  await editor.pressSequentially('sca');
  await expect(page.getByRole('option').filter({ hasText: 'scanf' })).toBeVisible();
  await editor.press('Enter');
  await expect.poll(() => editorText(page)).toContain('scanf');
  await editor.press('Enter');
  await editor.pressSequentially('co');
  await expect(page.getByRole('option').filter({ hasText: 'count' })).toBeVisible();
  await editor.press('ArrowDown');
  await editor.press('ArrowUp');
  await editor.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await editor.press('Control+a');
  await editor.press('Tab');
  await expect.poll(() => editorText(page)).toMatch(/^ {4}int count/);
  await editor.press('Shift+Tab');
  await expect.poll(() => editorText(page)).toMatch(/^int count/);
});

test('editor keeps line numbers aligned under the production security policy and dark theme', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, { editorStyleViolations: [] as string[] });
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.violatedDirective.startsWith('style'))
        (window as unknown as { editorStyleViolations: string[] }).editorStyleViolations.push(
          event.violatedDirective,
        );
    });
  });
  await page.goto('/#/practice/exercise.c6.s2.1');
  const editor = page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true });
  await expect(editor).toBeEditable();
  const gutter = page.locator('.code-editor .cm-gutters');
  const text = page.locator('.code-editor .cm-line').first();
  expect((await gutter.boundingBox())!.x).toBeLessThan((await text.boundingBox())!.x);
  await expect(page.locator('.code-editor .cm-editor')).toHaveCSS('font-size', '14px');
  await page.getByRole('button', { name: /切换.*深色|切换.*暗色/ }).click();
  await expect(page.locator('.points-toggle')).toHaveCSS('background-color', 'rgb(25, 27, 29)');
  await expect(gutter).toHaveCSS('background-color', 'rgb(25, 27, 29)');
  await expect(editor).toBeVisible();
  await editor.press('Control+a');
  await editor.press('Backspace');
  await editor.pressSequentially('pri');
  await editor.press('Control+End');
  await editor.press('Control+Space');
  await expect(page.getByRole('option').filter({ hasText: 'printf' })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { editorStyleViolations: string[] }).editorStyleViolations,
    ),
  ).toEqual([]);
});

for (const slug of ['bubble', 'selection', 'quick'])
  test(`atomic swap forward and back in the browser: ${slug}`, async ({ page }) => {
    await page.goto(`/#/algorithms/lab/${slug}`);
    await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toBeEnabled();
    const values = () => page.locator('.lab-bar-column strong').allTextContents();
    let found = false;
    for (let index = 0; index < 120; index++) {
      const before = await values();
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      const after = await values();
      expect([...after].sort()).toEqual([...before].sort());
      if (
        (await page.locator('.lab-step-caption').textContent()) === '交换两个元素' &&
        JSON.stringify(before) !== JSON.stringify(after)
      ) {
        expect(after.filter((value, index) => value !== before[index])).toHaveLength(2);
        await page.getByRole('button', { name: '上一步', exact: true }).click();
        expect(await values()).toEqual(before);
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        expect(await values()).toEqual(after);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
test('block display preference persists and is honoured by ordinary practice, while repairs never show blocks', async ({
  page,
}) => {
  await page.goto('/#/settings?panel=display');
  const choice = page.getByLabel('积木显示', { exact: true });
  await expect(choice).toBeEnabled();
  await choice.selectOption('show');
  await expect(page.getByTestId('block-preference-save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.goto('/#/practice/exercise.c6.s2.1');
  await expect(page.getByRole('heading', { name: '积木视图', exact: true })).toBeVisible();
  await expect(page.locator('.blocklySvg')).toBeVisible();
  await page.reload();
  await expect(page.locator('.blocklySvg')).toBeVisible();
  await page.goto('/#/practice/exercise.c.bug-semicolon');
  await expect(page.getByRole('textbox', { name: '编辑 C 代码', exact: true })).toBeEditable();
  await expect(page.locator('.blocklySvg')).toHaveCount(0);
  await page.goto('/#/bugs/memory/exercise.cpp.bug-missing-update');
  await expect(
    page.getByRole('textbox', { name: '编辑关卡 C++ 代码', exact: true }),
  ).toBeEditable();
  await expect(page.locator('.blocklySvg')).toHaveCount(0);
  await page.goto('/#/settings?panel=display');
  await choice.selectOption('hide');
  await expect(page.getByTestId('block-preference-save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.goto('/#/practice/exercise.c6.s2.1');
  await expect(
    page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.c6-block-pane')).toHaveCount(0);
});
test('semicolon repair submits successfully with the OJ editor', async ({ page }) => {
  await page.goto('/#/practice/exercise.c.bug-semicolon');
  const editor = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  await expect(editor).toBeEditable();
  const original = await editorText(page);
  await editor.fill(original.replace('printf("%d\\n", x)', 'printf("%d\\n", x);'));
  await expect(page.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('practice-feedback')).toHaveText('通过');
});

test('block preview and repeated application keep only the explicit return', async ({ page }) => {
  await page.goto('/#/practice/exercise.c6.s2.1');
  const editor = page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true });
  await expect(editor).toBeEditable();
  await editor.fill(
    '#include <stdio.h>\nint main(void) {\n    int x = 7;\n    printf("%d\\n", x);\n    return 0;\n}\n',
  );
  const pane = page.locator('.c6-block-pane');
  await expect(pane).toHaveAttribute('aria-busy', 'false');
  for (const value of [7, 8]) {
    await expect
      .poll(() => blockOptions(page, new RegExp(`^\\d+\\. 整数 · ${value}$`)))
      .toHaveLength(1);
    const [integer] = await blockOptions(page, new RegExp(`^\\d+\\. 整数 · ${value}$`));
    await selectBlock(page, integer);
    await blockWorkspace(page)
      .getByRole('textbox', { name: '整数值', exact: true })
      .fill(String(value + 1));
    const preview = pane.locator('.c6-source-read');
    await expect(preview).toContainText(`int x = ${value + 1};`);
    expect((await preview.innerText()).match(/return 0;/g)).toHaveLength(1);
    await pane.getByRole('button', { name: '应用生成代码', exact: true }).click();
    await expect.poll(() => editorText(page)).toContain(`int x = ${value + 1};`);
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    expect((await editorText(page)).match(/return 0;/g)).toHaveLength(1);
  }
  await page.screenshot({ path: '.artifacts/oj-feedback/block-return-after.png', fullPage: true });
});

test('practice pairs blocks on the left with code on the right on desktop', async ({ page }) => {
  for (const width of [1440, 2048]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/practice/exercise.c6.s2.1');
    await expect(page.locator('.blocklySvg')).toBeVisible();
    const code = (await page.locator('.oj-answer').boundingBox())!;
    const blocks = (await page.locator('.c6-block-pane').boundingBox())!;
    expect(blocks.x + blocks.width).toBeLessThanOrEqual(code.x);
    expect(Math.abs(blocks.y - code.y)).toBeLessThanOrEqual(1);
    expect(code.width).toBeGreaterThan(400);
  }
});

test('slow typing keeps the canvas mounted and the page still without save banners', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/practice/exercise.c6.s2.1');
  const editor = page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true });
  await expect(page.locator('.blocklySvg')).toBeVisible();
  await editor.press('Control+Home');
  await editor.press('ArrowDown');
  await editor.press('End');
  await editor.press('Enter');
  await expect(page.locator('.c6-block-pane')).toHaveAttribute('aria-busy', 'false');
  await editor.click();
  await editor.press('Control+Home');
  await editor.press('ArrowDown');
  await editor.press('End');
  await editor.press('Enter');
  await page.evaluate(() => {
    const code = document.querySelector('[data-testid=code-editor]')!;
    const canvas = document.querySelector('.blocklySvg')!;
    const samples: { scroll: number; top: number; sameCanvas: boolean }[] = [];
    const stats = { recording: true, samples };
    Object.assign(window, { __typingLayout: stats });
    const sample = () => {
      if (!stats.recording) return;
      samples.push({
        scroll: window.scrollY,
        top: code.getBoundingClientRect().top,
        sameCanvas: document.querySelector('.blocklySvg') === canvas,
      });
      requestAnimationFrame(sample);
    };
    sample();
  });
  await editor.pressSequentially('int second = 2;', { delay: 260 });
  await expect(page.locator('.c6-block-pane')).toHaveAttribute('aria-busy', 'false');
  const samples = await page.evaluate(() => {
    const stats = (
      window as unknown as {
        __typingLayout: {
          recording: boolean;
          samples: { scroll: number; top: number; sameCanvas: boolean }[];
        };
      }
    ).__typingLayout;
    stats.recording = false;
    return stats.samples;
  });
  expect(samples.length).toBeGreaterThan(30);
  expect(samples.every((sample) => sample.sameCanvas)).toBe(true);
  for (const key of ['scroll', 'top'] as const) {
    const values = samples.map((sample) => sample[key]);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  }
  writeFileSync(
    '.artifacts/oj-feedback/typing-layout-after.json',
    JSON.stringify({ samples }, null, 2),
  );
  await expect(page.getByTestId('learning-save-status')).toHaveCount(0);
  await expect(page.getByText('本题已有学习记录', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('c6-draft-save-status')).toHaveText('草稿已保存');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.getByTestId('learning-save-status')).toHaveCount(0);
  await expect(page.getByText('完整草稿已保存在此浏览器。', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(editor).toContainText('int second = 2;');
});

test('the second bubble swap highlights indices one and two only and restores on reverse', async ({
  page,
}) => {
  await page.goto('/#/algorithms/lab/bubble');
  await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toBeEnabled();
  const bars = page.locator('.lab-bar-column');
  const highlighted = () =>
    page
      .locator('.lab-bar-column[data-write=true], .lab-bar-column[data-active=true] small')
      .evaluateAll((nodes) =>
        [
          ...new Set(
            nodes.map(
              (node) => (node.matches('small') ? node : node.querySelector('small'))!.textContent,
            ),
          ),
        ].sort(),
      );
  let swaps = 0;
  for (let step = 0; step < 30 && swaps < 2; step++) {
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    if ((await page.locator('.lab-step-caption').textContent()) !== '交换两个元素') continue;
    swaps++;
    if (swaps === 1) expect(await highlighted()).toEqual(['0', '1']);
    if (swaps === 2) {
      expect(await bars.locator('strong').allTextContents()).toEqual([
        '3',
        '6',
        '8',
        '2',
        '7',
        '1',
      ]);
      expect(await highlighted()).toEqual(['1', '2']);
      await page
        .locator('.lab-stage')
        .screenshot({ path: '.artifacts/oj-feedback/swap-highlights-after.png' });
      await expect(bars.nth(0)).toHaveAttribute('data-active', 'false');
      await expect(bars.nth(0)).toHaveAttribute('data-write', 'false');
      await page.getByRole('button', { name: '上一步', exact: true }).click();
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      expect(await highlighted()).toEqual(['1', '2']);
    }
  }
  expect(swaps).toBe(2);
});
test('home keeps compact points and ledger dialog, with no pet or level card/settings', async ({
  page,
}) => {
  await page.goto('/#/');
  const button = page.getByRole('button', { name: '积分 0，查看明细', exact: true });
  await expect(button).toBeVisible();
  await expect(page.locator('.c6-profile-section')).toHaveCount(0);
  await expect(page.getByTestId('learning-profile')).toHaveCount(0);
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: '积分明细', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await page.goto('/#/settings?panel=avatar');
  await expect(page.getByRole('tab', { name: '基础形象', exact: true })).toHaveCount(0);
  await expect(page.getByText('选择基础形象', { exact: true })).toHaveCount(0);
});
for (const width of [1440, 768, 390])
  test(`responsive OJ, home and algorithm at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [name, route] of [
      ['home', '/'],
      ['practice', '/practice/exercise.c6.s2.1'],
      ['bug', '/practice/exercise.c.bug-semicolon'],
      ['algorithm', '/algorithms/lab/bubble'],
    ]) {
      await page.goto(`/#${route}`);
      await expect(page.locator('main h1')).toBeVisible();
      if (name === 'practice')
        await expect(
          page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true }),
        ).toBeVisible();
      if (name === 'bug')
        await expect(page.getByRole('textbox', { name: '编辑 C 代码', exact: true })).toBeVisible();
      if (name === 'algorithm')
        await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toBeEnabled();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: `.artifacts/oj-feedback/${name}-${width}.png`,
        fullPage: true,
      });
    }
  });
