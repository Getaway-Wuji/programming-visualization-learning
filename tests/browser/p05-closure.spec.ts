import { expect, test, type Page } from '@playwright/test';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import {
  blockOptions,
  blockWorkspace,
  correctStarter,
  selectBlock,
  showPracticeBlocks,
} from './block-ui';
import { observeCaseSetExecution } from './case-set-observation';

const themes = ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'] as const;
const panel = (page: Page) => page.getByTestId('practice-execution');
const action = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
const source = (page: Page) =>
  page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
async function ready(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.getByTestId('learning-temporary-status')).toHaveCount(0);
}

function luminance(color: string) {
  if (/^#[0-9a-f]{3}$/i.test(color))
    color = `#${color
      .slice(1)
      .split('')
      .map((value) => value + value)
      .join('')}`;
  const channels = color.startsWith('#')
    ? color
        .slice(1)
        .match(/../g)!
        .map((value) => parseInt(value, 16))
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
function contrast(left: string, right: string) {
  const [bright, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

test('six registered themes render readable native Blockly skins in light and dark modes', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const samples = [];
  for (const theme of themes) {
    await page.goto('/#/settings?panel=appearance');
    await ready(page);
    await page.getByTestId(`theme-${theme}`).click();
    if (await page.getByTestId('save-appearance').isEnabled())
      await page.getByTestId('save-appearance').click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
    await page.goto('/#/practice/exercise.c.echo');
    await ready(page);
    await expect(panel(page)).toHaveAttribute('data-state', 'ready');
    await showPracticeBlocks(page);
    await correctStarter(page, 'exercise.c.echo');
    for (const mode of ['light', 'dark'] as const) {
      if ((await page.locator('html').getAttribute('data-theme')) !== mode)
        await page.getByTestId('theme-mode-toggle').click();
      await ready(page);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      const sample = await blockWorkspace(page)
        .locator('.block-canvas')
        .evaluate((canvas) => {
          const styles = getComputedStyle(canvas);
          const variable = (name: string) => styles.getPropertyValue(`--block-${name}`).trim();
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
            palette: ['program', 'variable', 'number', 'control', 'logic', 'output'].map(variable),
            ink: variable('ink'),
            labels,
            paths: paths.map((path) => path.getAttribute('d')),
          };
        });
      expect(sample.paths.length).toBeGreaterThan(2);
      expect(sample.labels.length).toBeGreaterThan(2);
      for (const fill of sample.palette)
        expect(contrast(sample.ink, fill)).toBeGreaterThanOrEqual(4.5);
      for (const label of sample.labels)
        expect(contrast(label.ink, label.fill)).toBeGreaterThanOrEqual(4.5);
      samples.push({ theme, mode, sample });
      if (mode === 'light')
        await blockWorkspace(page)
          .locator('.block-canvas')
          .screenshot({ path: info.outputPath(`${theme}-blocks.png`), animations: 'disabled' });
    }
  }
  expect(
    new Set(
      samples
        .filter((sample) => sample.mode === 'light')
        .map((sample) => JSON.stringify(sample.sample.palette)),
    ).size,
  ).toBe(6);
  await info.attach('six-current-registered-block-skins', {
    body: JSON.stringify(samples),
    contentType: 'application/json',
  });
});

/** Native readonly archive observation; no facts or app records are fabricated. */
async function snapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const transaction = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const entries = await Promise.all(
        names.map(async (name) => {
          const value = await new Promise<unknown>((resolve, reject) => {
            const store = transaction.objectStore(name);
            const request = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
              ? store.get('current')
              : store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return [name, value];
        }),
      );
      await done;
      return Object.fromEntries(entries) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}
async function add(page: Page, kind: string) {
  const before = new Set(await blockOptions(page, /./));
  await blockWorkspace(page)
    .getByRole('combobox', { name: '添加积木类型', exact: true })
    .selectOption(kind);
  await blockWorkspace(page).getByRole('button', { name: '添加积木', exact: true }).click();
  await expect
    .poll(async () => (await blockOptions(page, /./)).filter((id) => !before.has(id)).length)
    .toBe(1);
  return (await blockOptions(page, /./)).find((id) => !before.has(id))!;
}
async function connect(page: Page, child: string, parent: string, slot: string) {
  await selectBlock(page, child);
  await blockWorkspace(page)
    .getByRole('combobox', { name: '连接到积木', exact: true })
    .selectOption(parent);
  await blockWorkspace(page)
    .getByRole('combobox', { name: '连接位置', exact: true })
    .selectOption(slot);
  await blockWorkspace(page).getByRole('button', { name: '连接选中积木', exact: true }).click();
  await expect(blockWorkspace(page).locator('.block-notice')).toHaveText('积木已连接。');
}

test('a fresh registered course saves a complete lesson built from empty native blocks', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await page.goto('/#/lessons/lesson.c.variables-output');
  await ready(page);
  await page.getByRole('button', { name: '确认已学习', exact: true }).click();
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
  await page.getByRole('link', { name: '进入练习工作区', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await showPracticeBlocks(page);
  await expect(
    page.getByTestId('practice-mode').getByRole('button', { name: '独立练习', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await blockOptions(page, /^\d+\. 输出 ·/)).toEqual([]);
  const inputs = await blockOptions(page, /^\d+\. 声明整数 · x$/);
  expect(inputs).toHaveLength(1);
  const print = await add(page, 'print');
  await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  await connect(page, print, inputs[0], '$next');
  const read = await add(page, 'variable');
  await blockWorkspace(page).getByRole('textbox', { name: '变量名称', exact: true }).fill('x');
  await connect(page, read, print, 'ARG0');
  await expect(page.getByTestId('block-issues')).toHaveCount(0);
  await expect(source(page)).toHaveValue(/printf\("%d\\n", x\)/);
  const before = await snapshot(page);
  await action(page, '运行本组').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  const afterRun = await snapshot(page);
  for (const key of ['progress', 'receipts', 'ledger'] as const)
    expect(afterRun[key]).toEqual(before[key]);
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await expect(page.getByTestId('lesson-completion')).toHaveAttribute('data-state', 'completed');
  const finished = await snapshot(page);
  expect(finished.meta.activePackageRef).toEqual({ id: 'content.c.p05', version: '1.0.0' });
  expect(finished.progress.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(1);
  expect(finished.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(1);
  const captures = await page.evaluate(() =>
    window.__verticalObservation.workers
      .filter((worker) => worker.kind === 'execute')
      .map((worker) => ({ request: worker.requestBytes, response: worker.responseBytes })),
  );
  expect(captures).toHaveLength(4);
  const runs = [];
  for (const [index, capture] of captures.entries()) {
    const request = JSON.parse(Buffer.from(capture.request!).toString('utf8')) as ExecuteRequest;
    const result = await decodeResult(Uint8Array.from(capture.response!).buffer, request);
    expect(request.packageRef).toEqual({ id: 'content.c.p05', version: '1.0.0' });
    expect(result.producer).toBe('rust');
    expect(result.terminal.status).toBe('completed');
    if (index > 0) expect(result.judgeResult?.status).toBe('met');
    runs.push({ request, result });
  }
  await page.reload();
  await ready(page);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('lesson-completion')).toHaveAttribute('data-state', 'completed');
  const refreshed = await snapshot(page);
  for (const key of ['progress', 'receipts', 'ledger'] as const)
    expect(refreshed[key]).toEqual(finished[key]);
  await info.attach('empty-blocks-real-run-submit-save-refresh', {
    body: JSON.stringify({ before, afterRun, finished, refreshed, runs }),
    contentType: 'application/json',
  });
});
