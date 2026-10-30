import { learnBlockPrerequisites } from './learn-block-prerequisites';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import {
  blockWorkspace,
  correctStarter,
  openCorrectionPractice,
  showPracticeBlocks,
} from './block-ui';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

type Point = { x: number; y: number };
test.beforeEach(async ({ page }, info) => {
  if (/native flyout dragging builds nested arithmetic/.test(info.title)) {
    test.setTimeout(Math.max(info.timeout, 90000));
    await learnBlockPrerequisites(page);
  }
});

const exercise = 'exercise.c.echo';
const practice = (page: Page) => page.getByTestId('practice-execution');
const disclosure = (page: Page) => page.getByTestId('block-keyboard-editor');
const canvas = (page: Page) => blockWorkspace(page).locator('.block-canvas');
const mainCanvas = (page: Page) =>
  canvas(page).locator('.blocklyBlockCanvas:has(> [data-id="lesson.main"])');
const controls = (page: Page) => page.getByTestId('player-controls');
const feedback = (page: Page) => blockWorkspace(page).locator('.block-drag-feedback');
const block = (page: Page, id: string) =>
  mainCanvas(page)
    .locator(`[data-id=${JSON.stringify(id)}]`)
    .first();

async function ready(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-appearance-config', 'ready');
}
async function open(page: Page) {
  await page.goto(`/#/practice/${exercise}`);
  await ready(page);
  await expect(practice(page)).toHaveAttribute('data-state', 'ready');
  await showPracticeBlocks(page);
  await expect(canvas(page).locator('.blocklySvg')).toBeVisible();
  await openCorrectionPractice(page);
  await canvas(page).scrollIntoViewIfNeeded();
}
async function nativeIds(page: Page) {
  return mainCanvas(page)
    .locator('[data-id]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => !element.closest('.blocklyFlyout,.blocklyInsertionMarker'))
        .map((element) => element.getAttribute('data-id')!)
        .filter(Boolean),
    );
}
async function parent(page: Page, id: string) {
  return block(page, id).evaluate(
    (element) => element.parentElement?.closest('[data-id]')?.getAttribute('data-id') ?? null,
  );
}
async function pointAtBlock(page: Page, id: string) {
  const bounds = await block(page, id)
    .locator(':scope > .blocklyPath:not(.blocklyPathSelected)')
    .first()
    .boundingBox();
  if (!bounds) throw new Error('Native block must be visible for pointer operations');
  return {
    x: bounds.x + Math.max(10, Math.min(48, bounds.width / 3)),
    y: bounds.y + Math.min(7, bounds.height / 4),
  };
}
/** Read native rendered SVG ports only. No Blockly workspace API or mutator is called. */
async function port(
  page: Page,
  id: string,
  kind: 'value' | 'statement',
  index = 0,
): Promise<Point> {
  const label = kind === 'value' ? '值位置' : '语句位置';
  return block(page, id)
    .locator(`:scope > .blocklyHighlightedConnectionPath[aria-roledescription="${label}"]`)
    .nth(index)
    .evaluate((element) => {
      const matrix = (element as SVGGraphicsElement).getScreenCTM();
      if (!matrix) throw new Error('Native SVG port has no screen transformation');
      const position = new DOMPoint(0, 0).matrixTransform(matrix);
      return { x: position.x, y: position.y };
    });
}
async function output(page: Page, id: string): Promise<Point> {
  const bounds = await block(page, id)
    .locator(':scope > .blocklyPath:not(.blocklyPathSelected)')
    .first()
    .boundingBox();
  if (!bounds) throw new Error('Expression shape is missing');
  return { x: bounds.x, y: bounds.y + bounds.height / 2 };
}
async function drag(page: Page, id: string, target: Point, offset = 0, hold = false) {
  const start = await pointAtBlock(page, id);
  const origin = await output(page, id);
  const end = { x: start.x + target.x - origin.x + offset, y: start.y + target.y - origin.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 24 });
  if (!hold) await page.mouse.up();
  return { start, end };
}
async function detach(page: Page, id: string) {
  const start = await pointAtBlock(page, id);
  const area = await canvas(page).boundingBox();
  if (!area) throw new Error('Canvas missing');
  const end = {
    x: Math.min(area.x + area.width - 80, start.x + 170),
    y: Math.min(area.y + area.height - 90, start.y + 115),
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => parent(page, id)).toBeNull();
  return { start, end };
}
async function zoomButton(page: Page, name: 'Zoom out' | 'Zoom in' | 'Reset zoom') {
  // Blockly's SVG group also contains a clipped sprite. Its full bounding box
  // extends outside the actual 32-pixel button, so use its visible focus rect.
  const rect = await blockWorkspace(page)
    .getByRole('button', { name, exact: true })
    .locator('rect')
    .first()
    .boundingBox();
  if (!rect) throw new Error('Zoom button missing');
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}
async function scale(page: Page) {
  return mainCanvas(page).evaluate((element) => {
    const transform = element.getAttribute('transform') ?? '';
    const matched = /scale\(([^)]+)\)/u.exec(transform);
    return matched ? Number(matched[1]) : 1;
  });
}
async function chooseScale(page: Page, target: 0.35 | 0.8 | 1.5) {
  if (target !== 0.8)
    for (let count = 0; count < 9; count++)
      await zoomButton(page, target < 0.8 ? 'Zoom out' : 'Zoom in');
  await expect.poll(() => scale(page)).toBeCloseTo(target, 5);
}
async function flyout(page: Page, category: string, index: number) {
  const before = new Set(await nativeIds(page));
  await blockWorkspace(page).getByRole('treeitem', { name: category, exact: true }).click();
  const source = canvas(page)
    .locator('.blocklyFlyout .blocklyBlockCanvas > .blocklyDraggable')
    .nth(index);
  const rect = await source.boundingBox(),
    area = await canvas(page).boundingBox();
  if (!rect || !area) throw new Error('Flyout block missing');
  const start = {
    x: rect.x + Math.min(35, rect.width / 3),
    y: rect.y + Math.min(15, rect.height / 3),
  };
  const end = { x: area.x + area.width - 100, y: area.y + Math.min(300, area.height - 120) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 24 });
  await page.mouse.up();
  await expect
    .poll(async () => (await nativeIds(page)).filter((id) => !before.has(id)).length)
    .toBe(1);
  return { id: (await nativeIds(page)).find((id) => !before.has(id))!, start, end };
}
async function trash(page: Page, id: string) {
  const start = await pointAtBlock(page, id);
  const rect = await canvas(page).locator('.blocklyTrash').boundingBox();
  if (!rect) throw new Error('Trash can missing');
  // Sprite images can exceed the clipping rectangle; use the actual lid/body
  // transform's lower-right visible native trash region.
  const end = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 24 });
  await page.mouse.up();
  await expect.poll(async () => (await nativeIds(page)).includes(id)).toBe(false);
  return { start, end };
}
async function attach(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value), contentType: 'application/json' });
}

test('keyboard editing starts folded, remains keyboard reachable and opening it preserves genuine Rust playback across themes and widths', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await observeCaseSetExecution(page);
  await open(page);
  await expect(disclosure(page)).not.toHaveAttribute('open', '');
  await expect(
    blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true }),
  ).toBeHidden();
  const summary = disclosure(page).locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure(page)).toHaveAttribute('open', '');
  await correctStarter(page, exercise);
  await practice(page).getByRole('button', { name: '准备代码', exact: true }).click();
  await practice(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(practice(page)).toHaveAttribute('data-state', 'passed');
  const worker = await observedCaseSetExecute(page);
  const request = JSON.parse(Buffer.from(worker.requestBytes!).toString('utf8')) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(worker.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.judgeResult?.status).toBe('met');
  await controls(page).getByRole('button', { name: '前进', exact: true }).click();
  const cursor = await controls(page).getAttribute('data-cursor');
  const ids = await nativeIds(page);
  const source = await page
    .getByRole('textbox', { name: '当前执行的 C 代码', exact: true, includeHidden: true })
    .inputValue();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure(page)).not.toHaveAttribute('open', '');
  const settings = await page.context().newPage();
  await settings.goto('/#/settings?panel=appearance');
  await ready(settings);
  const samples = [];
  for (const theme of process.env.TASK_REPRESENTATIVE_THEME === 'minimal'
    ? ['minimal']
    : ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech']) {
    await settings.bringToFront();
    await settings.getByTestId(`theme-${theme}`).click();
    if (await settings.getByTestId('save-appearance').isEnabled())
      await settings.getByTestId('save-appearance').click();
    await expect(settings.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
    await page.bringToFront();
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(disclosure(page)).not.toHaveAttribute('open', '');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure(page)).toHaveAttribute('open', '');
      await expect(
        blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true }),
      ).toBeVisible();
      await summary.focus();
      await page.keyboard.press('Enter');
      expect(await nativeIds(page)).toEqual(ids);
      await expect(controls(page)).toHaveAttribute('data-cursor', cursor!);
      expect(
        await page
          .getByRole('textbox', { name: '当前执行的 C 代码', exact: true, includeHidden: true })
          .inputValue(),
      ).toBe(source);
      samples.push({ theme, width, cursor, ids });
    }
  }
  await settings.close();
  await attach(info, 'folded-keyboard-editor-retains-one-rust-submission', {
    request,
    result,
    samples,
  });
});

test('native value connections expose a visible preview and accept the same twenty-pixel offset at minimum normal and maximum zoom', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const records = [];
  for (const targetScale of [0.35, 0.8, 1.5] as const) {
    await page.goto('about:blank');
    await open(page);
    await chooseScale(page, targetScale);
    const id = 'lesson.block.3';
    await detach(page, id);
    const destination = await port(page, 'lesson.block.2', 'value');
    const pointer = await drag(page, id, destination, 20, true);
    await attach(info, `held-geometry-${targetScale}`, {
      targetScale,
      destination,
      pointer,
      heldShapes: await canvas(page)
        .locator(`[data-id=${JSON.stringify(id)}]`)
        .evaluateAll((elements) =>
          elements.map((element) => ({
            class: element.parentElement?.getAttribute('class'),
            rect: element.getBoundingClientRect().toJSON(),
          })),
        ),
      feedback: await feedback(page).innerText(),
    });
    await expect(feedback(page)).toHaveText('已找到连接位置，松开即可拼接。');
    await page.mouse.up();
    await expect.poll(() => parent(page, id)).toBe('lesson.block.2');
    await detach(page, id);
    const outside = await drag(page, id, await port(page, 'lesson.block.2', 'value'), 50, true);
    await expect(feedback(page)).not.toHaveText('已找到连接位置，松开即可拼接。');
    await page.mouse.up();
    await expect.poll(() => parent(page, id)).toBeNull();
    await drag(page, id, await port(page, 'lesson.block.2', 'value'));
    await expect.poll(() => parent(page, id)).toBe('lesson.block.2');
    records.push({
      scale: await scale(page),
      pointer,
      outside,
      connectedTo: await parent(page, id),
    });
  }
  await attach(info, 'actual-native-mouse-screen-space-snapping', records);
});

test('native flyout dragging builds nested arithmetic and rejects wrong connection types with reversible deletion before genuine Rust submission', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await observeCaseSetExecution(page);
  await open(page);
  await correctStarter(page, exercise);
  if ((await disclosure(page).getAttribute('open')) !== null)
    await disclosure(page).locator('summary').click();
  await canvas(page).scrollIntoViewIfNeeded();
  const old = 'lesson.block.3';
  const detached = await detach(page, old);
  const arithmetic = await flyout(page, '运算与判断', 1);
  await drag(page, arithmetic.id, await port(page, 'lesson.block.2', 'value'));
  await expect.poll(() => parent(page, arithmetic.id)).toBe('lesson.block.2');
  await drag(page, old, await port(page, arithmetic.id, 'value', 0));
  await expect.poll(() => parent(page, old)).toBe(arithmetic.id);
  const integer = await flyout(page, '整数与变量', 0);
  await drag(page, integer.id, await port(page, arithmetic.id, 'value', 1));
  await expect.poll(() => parent(page, integer.id)).toBe(arithmetic.id);
  const invalid = await flyout(page, '整数与变量', 0);
  await drag(page, invalid.id, await port(page, 'lesson.block.2', 'statement', 1), 0, true);
  await expect(feedback(page)).not.toHaveText('已找到连接位置，松开即可拼接。');
  await page.mouse.up();
  await expect.poll(() => parent(page, invalid.id)).toBeNull();
  const deletion = await trash(page, invalid.id);
  await blockWorkspace(page).getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await nativeIds(page)).includes(invalid.id)).toBe(true);
  await blockWorkspace(page).getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(async () => (await nativeIds(page)).includes(invalid.id)).toBe(false);
  await expect(page.getByTestId('block-issues')).toHaveCount(0);
  await practice(page).getByRole('button', { name: '准备代码', exact: true }).click();
  await practice(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(practice(page)).toHaveAttribute('data-state', 'passed');
  const worker = await observedCaseSetExecute(page);
  const request = JSON.parse(Buffer.from(worker.requestBytes!).toString('utf8')) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(worker.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.judgeResult?.status).toBe('met');
  expect(request.source.text).toContain('(x + 0)');
  await expect(
    page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true, includeHidden: true }),
  ).toHaveValue(request.source.text);
  await attach(info, 'native-pointer-nesting-delete-undo-redo-and-real-rust', {
    detached,
    arithmetic,
    integer,
    invalid,
    deletion,
    request,
    result,
  });
});

test('holding a native dragged block near the canvas edge scrolls progressively and moving inward or releasing stops it', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await open(page);
  await canvas(page).scrollIntoViewIfNeeded();
  const id = 'lesson.block.3';
  await detach(page, id);
  const area = await canvas(page).boundingBox();
  if (!area) throw new Error('Canvas missing');
  const matrix = () => mainCanvas(page).getAttribute('transform');
  const start = await pointAtBlock(page, id);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const edge = { x: area.x + area.width - 20, y: area.y + area.height / 2 };
  await page.mouse.move(edge.x, edge.y, { steps: 25 });
  await expect(feedback(page)).toHaveText('正在移动画布，移回中间即可停止。');
  const first = await matrix();
  await expect.poll(matrix).not.toBe(first);
  const moved = await matrix();
  const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  await page.mouse.move(center.x, center.y, { steps: 16 });
  await expect(feedback(page)).not.toHaveText('正在移动画布，移回中间即可停止。');
  const stopped = await matrix();
  await page.waitForTimeout(180);
  expect(await matrix()).toBe(stopped);
  await page.mouse.up();
  const released = await matrix();
  await page.waitForTimeout(180);
  expect(await matrix()).toBe(released);
  const afterRelease = await block(page, id).boundingBox();
  await page.mouse.move(center.x + 40, center.y + 20, { steps: 12 });
  await page.waitForTimeout(180);
  expect(await block(page, id).boundingBox()).toEqual(afterRelease);
  const nextStart = await pointAtBlock(page, id),
    nextEnd = { x: nextStart.x - 50, y: nextStart.y + 30 };
  await page.mouse.move(nextStart.x, nextStart.y);
  await page.mouse.down();
  await page.mouse.move(nextEnd.x, nextEnd.y, { steps: 16 });
  await page.mouse.up();
  expect(await block(page, id).boundingBox()).not.toEqual(afterRelease);
  await attach(info, 'native-held-pointer-edge-scroll', {
    start,
    edge,
    center,
    first,
    moved,
    stopped,
    released,
    afterRelease,
    nextStart,
    nextEnd,
  });
});

test('a statement stack reconnects by native pointer with its child retained and the original C source restored', async ({
  page,
}, info) => {
  await open(page);
  await correctStarter(page, exercise);
  if ((await disclosure(page).getAttribute('open')) !== null)
    await disclosure(page).locator('summary').click();
  await practice(page).getByRole('button', { name: '准备代码', exact: true }).click();
  const source = page.getByRole('textbox', {
    name: '当前执行的 C 代码',
    exact: true,
    includeHidden: true,
  });
  const before = await source.inputValue();
  await canvas(page).scrollIntoViewIfNeeded();
  const id = 'lesson.block.2';
  const beforeParent = await parent(page, id);
  const child = 'lesson.block.3';
  const start = await pointAtBlock(page, id);
  const area = await canvas(page).boundingBox();
  if (!area) throw new Error('Canvas missing');
  const away = { x: area.x + area.width - 160, y: area.y + Math.min(280, area.height - 140) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(away.x, away.y, { steps: 24 });
  await page.mouse.up();
  await expect.poll(() => parent(page, id)).toBeNull();
  await expect.poll(() => parent(page, child)).toBe(id);
  const grab = await pointAtBlock(page, id);
  const previous = await port(page, id, 'statement', 0);
  const target = await port(page, 'lesson.block.1', 'statement', 1);
  const end = { x: grab.x + target.x - previous.x + 16, y: grab.y + target.y - previous.y };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 24 });
  await expect(feedback(page)).toHaveText('已找到连接位置，松开即可拼接。');
  await page.mouse.up();
  await expect.poll(() => parent(page, id)).toBe(beforeParent);
  await expect.poll(() => parent(page, child)).toBe(id);
  await practice(page).getByRole('button', { name: '准备代码', exact: true }).click();
  await expect(source).toHaveValue(before);
  await attach(info, 'native-statement-stack-detach-and-reconnect', {
    id,
    child,
    beforeParent,
    start,
    away,
    grab,
    previous,
    target,
    end,
    source: before,
  });
});
