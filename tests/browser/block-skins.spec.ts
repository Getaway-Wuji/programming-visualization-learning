import { expect, test, type Page } from '@playwright/test';
import { blockOptions, blockWorkspace, correctStarter, selectBlock } from './block-ui';

const themes = ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'] as const;
const toggle = (page: Page) => page.getByTestId('theme-mode-toggle');
const practice = (page: Page) => page.getByTestId('practice-execution');

async function ready(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-appearance-config', 'ready');
}

async function readableEditor(page: Page) {
  const editor = blockWorkspace(page);
  await expect(editor.locator('details')).toBeVisible();
  if ((await editor.locator('details').getAttribute('open')) === null)
    await editor.locator('summary').click();
  await expect(editor.getByRole('combobox', { name: '积木列表', exact: true })).toBeVisible();
  return editor;
}

function luminance(color: string): number {
  // Production CSS can shorten six-digit hex tokens without changing their color.
  if (/^#[0-9a-f]{3}$/i.test(color))
    color = `#${color
      .slice(1)
      .split('')
      .map((part) => part + part)
      .join('')}`;
  const channels = color.startsWith('#')
    ? color
        .slice(1)
        .match(/../g)!
        .map((part) => parseInt(part, 16))
    : color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
  const [r, g, b] = channels.map((part) => {
    const value = part / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function skinSample(page: Page) {
  return blockWorkspace(page)
    .locator('.block-canvas')
    .evaluate((canvas) => {
      const styles = getComputedStyle(canvas);
      const variable = (name: string) => styles.getPropertyValue(`--block-${name}`).trim();
      const family = ['program', 'variable', 'number', 'control', 'logic', 'output'].map(variable);
      const paths = Array.from(
        canvas.querySelectorAll<SVGPathElement>(
          '.blocklyBlockCanvas .blocklyBlock > .blocklyPath:not(.blocklyPathSelected)',
        ),
      ).filter((path) => !path.closest('.blocklyInsertionMarker'));
      const labels = paths.flatMap((path) =>
        Array.from(
          path.parentElement!.querySelectorAll<SVGTextElement>(
            ':scope > .blocklyLabelField > .blocklyText',
          ),
        ).map((label) => ({
          ink: getComputedStyle(label).fill,
          fill: getComputedStyle(path).fill,
        })),
      );
      return {
        family,
        ink: variable('ink'),
        field: variable('field'),
        fieldInk: variable('field-ink'),
        filter: variable('filter'),
        fieldRadius: variable('field-radius'),
        toolboxRadius: variable('tool-radius'),
        actualFills: paths.map((path) => getComputedStyle(path).fill),
        labels,
        fields: Array.from(canvas.querySelectorAll('.blocklyField:not(.blocklyLabelField)'))
          .filter(
            (field) =>
              field.querySelector('.blocklyFieldRect') && field.querySelector('.blocklyText'),
          )
          .map((field) => ({
            ink: getComputedStyle(field.querySelector('.blocklyText')!).fill,
            fill: getComputedStyle(field.querySelector('.blocklyFieldRect')!).fill,
          })),
        paths: paths.map((path) => path.getAttribute('d')),
      };
    });
}

for (const theme of themes) {
  test(`${theme} skin stays readable in both modes and native drag, connection and Rust submission still work`, async ({
    page,
  }, info) => {
    await page.goto('/#/settings?panel=appearance');
    await ready(page);
    await page.getByTestId(`theme-${theme}`).click();
    await page.getByTestId('save-appearance').click();
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
    await page.goto('/#/practice/exercise.c.echo');
    await expect(practice(page)).toHaveAttribute('data-state', 'ready');
    const editor = await readableEditor(page);
    await correctStarter(page, 'exercise.c.echo');
    const samples = [];
    for (const mode of ['light', 'dark'] as const) {
      if ((await page.locator('html').getAttribute('data-theme')) !== mode) {
        await toggle(page).click();
        await ready(page);
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      const sample = await skinSample(page);
      expect(sample.actualFills.length).toBeGreaterThan(2);
      expect(sample.labels.length).toBeGreaterThan(2);
      for (const fill of sample.family)
        expect(contrast(sample.ink, fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(sample.fieldInk, sample.field)).toBeGreaterThanOrEqual(4.5);
      for (const label of sample.labels)
        expect(contrast(label.ink, label.fill)).toBeGreaterThanOrEqual(4.5);
      for (const field of sample.fields)
        expect(contrast(field.ink, field.fill)).toBeGreaterThanOrEqual(4.5);
      await expect(editor.locator('.blocklyPathSelected').first()).toHaveCSS('fill', 'none');
      if (samples.length) expect(sample.paths).toEqual(samples[0].sample.paths);
      samples.push({ mode, sample });
      await editor.locator('.block-canvas').screenshot({
        path: info.outputPath(`${theme}-${mode}-blocks.png`),
        animations: 'disabled',
      });
    }

    const existing = new Set(await blockOptions(page, /./));
    await editor.getByRole('treeitem', { name: '程序与作用域', exact: true }).click();
    const flyout = editor.locator('.blocklyFlyout .blocklyBlockCanvas > .blocklyDraggable');
    await expect(flyout).toHaveCount(3);
    const scopeBlock = flyout.nth(1);
    await scopeBlock.scrollIntoViewIfNeeded();
    const start = await scopeBlock.boundingBox();
    const canvas = await editor.locator('.block-canvas').boundingBox();
    expect(start).not.toBeNull();
    expect(canvas).not.toBeNull();
    await page.mouse.move(start!.x + 35, start!.y + 15);
    await page.mouse.down();
    await page.mouse.move(canvas!.x + canvas!.width - 90, canvas!.y + canvas!.height * 0.65, {
      steps: 20,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await blockOptions(page, /./)).filter((id) => !existing.has(id)).length)
      .toBe(1);
    const scope = (await blockOptions(page, /./)).find((id) => !existing.has(id))!;
    const outputs = await blockOptions(page, /^\d+\. 输出 ·/);
    expect(outputs).toHaveLength(1);
    await selectBlock(page, scope);
    await editor
      .getByRole('combobox', { name: '连接到积木', exact: true })
      .selectOption(outputs[0]);
    await editor.getByRole('combobox', { name: '连接位置', exact: true }).selectOption('$next');
    await editor.getByRole('button', { name: '连接选中积木', exact: true }).click();
    await expect(editor.locator('.block-notice')).toHaveText('积木已连接。');
    await expect(page.getByTestId('block-issues')).toHaveCount(0);
    await practice(page).getByRole('button', { name: '准备代码', exact: true }).click();
    const code = page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
    await expect(code).toHaveValue(/printf\("%d\\n", x\)/);
    await practice(page).getByRole('button', { name: '提交练习', exact: true }).click();
    await expect(practice(page)).toHaveAttribute('data-state', 'passed');
    await info.attach('readable-real-block-skins-and-native-drag', {
      body: JSON.stringify({ theme, samples, scope, source: await code.inputValue() }),
      contentType: 'application/json',
    });
  });
}

test('the header control stays circular and reachable at desktop and phone widths', async ({
  page,
}, info) => {
  await page.goto('/#/settings?panel=appearance');
  await ready(page);
  const samples = [];
  for (const theme of themes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId(`theme-${theme}`).click();
    await page.getByTestId('save-appearance').click();
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const geometry = await toggle(page).evaluate((button) => {
        const { x, y, width, height, right } = button.getBoundingClientRect();
        const center = document.elementFromPoint(x + width / 2, y + height / 2);
        return {
          x,
          y,
          width,
          height,
          right,
          radius: getComputedStyle(button).borderRadius,
          hit: center === button || button.contains(center),
          viewport: document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(geometry.width).toBe(44);
      expect(geometry.height).toBe(44);
      expect(geometry.radius).toBe('50%');
      expect(geometry.hit).toBe(true);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.viewport - geometry.right).toBeLessThanOrEqual(40);
      expect(geometry.y).toBeGreaterThanOrEqual(0);
      expect(geometry.y + geometry.height).toBeLessThanOrEqual(80);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      samples.push({ theme, viewportWidth: width, ...geometry });
    }
  }
  await info.attach('six-theme-circular-header-control', {
    body: JSON.stringify(samples),
    contentType: 'application/json',
  });
});

test('a pending display form cannot overwrite the newer header mode save', async ({ page }) => {
  await page.goto('/#/settings?panel=display');
  await ready(page);
  const mode = page.getByRole('combobox', { name: '主题', exact: true });
  await expect(mode).toHaveValue('light');
  await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('2');
  await toggle(page).click();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-learning-storage-status',
    'conflict',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await page.reload();
  await ready(page);
  await expect(mode).toHaveValue('dark');
  await expect(page.getByRole('combobox', { name: '默认播放速度', exact: true })).toHaveValue('1');
});

test('the header follows peer mode updates and preserves the newer display preferences', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await ready(page);
  const other = await context.newPage();
  await other.goto('/#/settings?panel=display');
  await ready(other);
  await other.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark');
  await other.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('2');
  await other.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await ready(other);
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await toggle(page).click();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await page.goto('/#/settings?panel=display');
  await ready(page);
  await expect(page.getByRole('combobox', { name: '主题', exact: true })).toHaveValue('light');
  await expect(page.getByRole('combobox', { name: '默认播放速度', exact: true })).toHaveValue('2');
  await expect(page.locator('.theme-mode-error')).toHaveCount(0);
});
