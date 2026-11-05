import { editorValue, expectEditorValue } from './editor-value';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  decodeResult,
  type ExecuteRequest,
  type ExecuteResult,
  type TraceObject,
  type TraceState,
  type TraceStep,
} from '../../web/src/engine/protocol';
import type { StorageSnapshot, ThemeId } from '../../web/src/storage/model';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

const themes: readonly ThemeId[] = ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'];
const widths = [1366, 1440, 1920, 2560, 768, 390];
const panel = (page: Page) => page.getByTestId('case-execution');
const controls = (page: Page) => page.getByTestId('player-controls');
const valuesField = (page: Page) => page.getByTestId('input-field-values');
const source = (page: Page) =>
  panel(page).getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
const bench = (page: Page) => page.locator('[data-testid="workbench"][data-kind="visualize"]');
const action = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
const readValues = async (page: Page) =>
  (await editorValue(valuesField(page)))
    .split(/[\s,]+/u)
    .filter(Boolean)
    .map(Number);

async function ready(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-appearance-config', 'ready');
}

async function open(page: Page, id: string) {
  await page.goto(`/#/visualize/case.c.${id}`);
  await ready(page);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  const seedOptions = page.getByText('复现随机数据', { exact: true });
  if (await seedOptions.count()) {
    const details = seedOptions.locator('..');
    if ((await details.getAttribute('open')) === null) await seedOptions.click();
  }
  await expectEditorValue(source(page), '', { not: true });
}

async function prepare(page: Page, values?: readonly number[]) {
  if (values) await valuesField(page).fill(values.length === 0 ? '[]' : values.join(', '));
  await action(page, '应用输入并准备').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expectEditorValue(source(page), '', { not: true });
}

interface Run {
  request: ExecuteRequest;
  result: ExecuteResult;
  arrayDeclaration: string;
}

async function execute(page: Page, values: readonly number[]): Promise<Run> {
  await action(page, '运行示例').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expect(controls(page)).toHaveAttribute('data-cursor', '0');
  const worker = await observedCaseSetExecute(page);
  expect(worker).toMatchObject({ moduleSeen: true, responseOk: true, terminated: true });
  expect(worker.responseOperationId).toBe(worker.operationId);
  const request = JSON.parse(Buffer.from(worker.requestBytes!).toString('utf8')) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(worker.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0 });
  expect(result.trace?.completeness).toBe('complete');
  expect(result.identity).toEqual(request.identity);
  expect(request.input.values.values).toEqual(values);
  expect(request.remainingMs).toBeGreaterThan(0);
  expect(request.remainingMs).toBeLessThanOrEqual(1000);
  expect(await editorValue(source(page))).toBe(request.source.text.replace(/\r\n?/gu, '\n'));
  expect(request.source.text).toContain(`int n = ${values.length};`);
  expect(request.source.text).toContain(
    values.length === 0 ? 'int values[1] = {0};' : `{${values.join(', ')}}`,
  );
  const binding = result.resolvedBindings.find((item) => item.bindingKey === 'param.values');
  expect(binding).toBeDefined();
  return { request, result, arrayDeclaration: binding!.declarationNodeId };
}

/** Only apply supplied Rust records/deltas. This independent oracle never runs C,
 * sorts a sequence, computes a swap, or imports the production view projection. */
function stateAt(run: Run, cursor: number): TraceState {
  const state = structuredClone(run.result.trace!.initialState);
  for (const step of run.result.trace!.steps.slice(0, cursor)) {
    for (const change of step.changes) {
      switch (change.op) {
        case 'record': {
          const table = state[change.table];
          if (change.before !== null) table.splice(change.index, 1);
          if (change.after !== null)
            (table as (typeof change.after)[]).splice(
              change.index,
              0,
              structuredClone(change.after),
            );
          break;
        }
        case 'cell': {
          const object = state.objects.find((item) => item.id === change.objectId)!;
          object.cells = object.cells.filter((cell) => cell.index !== change.index);
          if (change.after !== object.defaultValue && change.after !== null)
            object.cells.push({ index: change.index, value: change.after });
          object.cells.sort((left, right) => left.index - right.index);
          break;
        }
        case 'output':
          state.output += change.append;
          break;
        case 'control':
          state.control = structuredClone(change.after);
          break;
        case 'allocator':
          state.allocator = structuredClone(change.after);
          break;
        case 'counters':
          state.counters = structuredClone(change.after);
          break;
      }
    }
  }
  return state;
}

function arrayInit(run: Run) {
  const index = run.result.trace!.steps.findIndex(
    (step) =>
      step.kind === 'value.initialize' &&
      step.changes.some(
        (change) =>
          change.op === 'record' &&
          change.table === 'objects' &&
          change.after !== null &&
          (change.after as TraceObject).declarationNodeId === run.arrayDeclaration,
      ),
  );
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
}

async function seek(page: Page, cursor: number) {
  await page.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
  const start = Number(await controls(page).getAttribute('data-cursor'));
  await page.getByTestId('player-workspace').focus();
  for (let count = 0; count < Math.abs(cursor - start); count++)
    await page.keyboard.press(cursor > start ? 'ArrowRight' : 'ArrowLeft');
  await expect(controls(page)).toHaveAttribute('data-cursor', String(cursor));
}

function expectedCells(object: TraceObject, length: number, step?: TraceStep) {
  return Array.from({ length }, (_, index) => {
    const value = object.cells.find((cell) => cell.index === index)?.value ?? object.defaultValue;
    return {
      index: String(index),
      value: String(value ?? 'uninitialized'),
      text: value === null ? '未初始化' : String(value),
      read: String(
        step?.observations.some(
          (item) => item.kind === 'read' && item.objectId === object.id && item.index === index,
        ) ?? false,
      ),
      write: String(
        step?.changes.some(
          (change) =>
            (change.op === 'cell' && change.objectId === object.id && change.index === index) ||
            (change.op === 'record' &&
              change.table === 'objects' &&
              change.id === object.id &&
              step.kind === 'value.initialize' &&
              change.after !== null),
        ) ?? false,
      ),
    };
  });
}

async function assertState(page: Page, run: Run, cursor: number) {
  const state = stateAt(run, cursor);
  const step = run.result.trace!.steps[cursor - 1];
  await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', String(cursor));
  await expect(page.getByTestId('step-summary')).toHaveAttribute(
    'data-step-kind',
    step?.kind ?? '',
  );
  await expect(page.getByTestId('step-output')).toHaveAttribute('data-output', state.output);
  const object = state.objects.find((item) => item.declarationNodeId === run.arrayDeclaration);
  const array = page.getByTestId('trace-array');
  if (!object) {
    await expect(array).toHaveCount(0);
    return;
  }
  const length = (run.request.input.values.values as readonly number[]).length;
  await expect(array).toHaveAttribute('data-object-id', object.id);
  await expect(array).toHaveAttribute('data-logical-length', String(length));
  await expect(array).toHaveAttribute('data-storage-length', String(object.length));
  expect(
    await array.getByTestId('trace-array-cell').evaluateAll((cells) =>
      cells.map((cell) => ({
        index: cell.getAttribute('data-index'),
        value: cell.getAttribute('data-value'),
        read: cell.getAttribute('data-read'),
        write: cell.getAttribute('data-write'),
        text: cell.querySelector('.array-value')!.textContent,
      })),
    ),
  ).toEqual(expectedCells(object, length, step));
  for (const [key, value] of Object.entries(state.counters)) {
    const attribute = key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
    await expect(page.getByTestId('step-counters')).toHaveAttribute(
      `data-${attribute}`,
      String(value),
    );
  }
}

/** Native archive reads only; no progress/reward or configuration rows are seeded. */
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
      const rows = await Promise.all(
        names.map(async (name) => [
          name,
          await new Promise<unknown>((resolve, reject) => {
            const store = transaction.objectStore(name);
            const request = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
              ? store.get('current')
              : store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
        ]),
      );
      await done;
      return Object.fromEntries(rows) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}

function noLearningChange(before: StorageSnapshot, after: StorageSnapshot) {
  for (const key of [
    'progress',
    'dailyFacts',
    'goals',
    'ledger',
    'receipts',
    'aliases',
    'avatar',
  ] as const)
    expect(after[key]).toEqual(before[key]);
  expect(after.meta.generation).toBe(before.meta.generation);
  expect(after.meta.activePackageRef).toEqual(before.meta.activePackageRef);
}

async function executions(page: Page) {
  return page.evaluate(
    () => window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
  );
}

async function assertGeometry(page: Page, length: number) {
  const array = page.getByTestId('trace-array');
  await expect(array).toBeVisible();
  // ResizeObserver selects the actual pane mode after a viewport change. Let
  // two browser paints settle it before measuring the real rendered layout.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const geometry = await array.evaluate((element) => {
    const bounds = (node: Element) => {
      const { left, right, top, width } = node.getBoundingClientRect();
      return { left, right, top, width };
    };
    const wrapper = element.querySelector('.array-chart-scroll')!;
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wrapper: { ...bounds(wrapper), overflow: wrapper.scrollWidth - wrapper.clientWidth },
      cells: Array.from(element.querySelectorAll('[data-testid="trace-array-cell"]'), (cell) => ({
        ...bounds(cell),
        index: cell.getAttribute('data-index'),
        value: bounds(cell.querySelector('.array-value')!),
        label: bounds(cell.querySelector('.array-index')!),
        display: getComputedStyle(cell).display,
      })),
    };
  });
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  expect(geometry.wrapper.overflow).toBeLessThanOrEqual(1);
  expect(geometry.cells).toHaveLength(length);
  expect(geometry.cells.map((cell) => cell.index)).toEqual(
    Array.from({ length }, (_, index) => String(index)),
  );
  for (const cell of geometry.cells) {
    expect(cell.display).not.toBe('none');
    expect(cell.width).toBeGreaterThan(24);
    expect(cell.left).toBeGreaterThanOrEqual(geometry.wrapper.left - 1);
    expect(cell.right).toBeLessThanOrEqual(geometry.wrapper.right + 1);
    for (const text of [cell.value, cell.label]) {
      expect(text.left).toBeGreaterThanOrEqual(cell.left - 1);
      expect(text.right).toBeLessThanOrEqual(cell.right + 1);
    }
  }
  for (let index = 1; index < geometry.cells.length; index++) {
    const previous = geometry.cells[index - 1],
      current = geometry.cells[index];
    if (Math.abs(previous.top - current.top) < 1)
      expect(previous.right).toBeLessThanOrEqual(current.left + 1);
  }
  if ((page.viewportSize()?.width ?? 0) <= 768 && length > 7)
    expect(new Set(geometry.cells.map((cell) => Math.round(cell.top))).size).toBeGreaterThan(1);
  return geometry;
}

async function attach(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value), contentType: 'application/json' });
}

test('both sorting cases start, randomize reproducibly and reset to seven genuine Rust inputs', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  const records = [];
  for (const id of ['bubble-sort', 'selection-sort']) {
    await open(page, id);
    const executionCount = await executions(page);
    const before = await snapshot(page);
    const defaults = await readValues(page);
    expect(defaults).toHaveLength(7);
    await expectEditorValue(page.getByTestId('input-length-values'), '7');
    const initial = await execute(page, defaults);
    await seek(page, arrayInit(initial));
    await assertState(page, initial, arrayInit(initial));
    await action(page, '生成随机数据').click();
    expect(await readValues(page)).toHaveLength(7);
    await page.getByTestId('input-seed').fill(`P0.5-05/${id}/固定种子`);
    await action(page, '按种子复现').click();
    const randomValues = await readValues(page);
    expect(randomValues).toHaveLength(7);
    await action(page, '按种子复现').click();
    expect(await readValues(page)).toEqual(randomValues);
    await prepare(page);
    const randomRun = await execute(page, randomValues);
    expect(randomRun.request.input.random?.seed).toBe(`P0.5-05/${id}/固定种子`);
    await page.getByTestId('input-length-values').fill('15');
    await valuesField(page).fill('3, 2, 1');
    await action(page, '恢复示例输入').click();
    expect(await readValues(page)).toEqual(defaults);
    await expectEditorValue(page.getByTestId('input-length-values'), '7');
    await expect(controls(page)).toHaveCount(0);
    await prepare(page);
    await expectEditorValue(source(page), initial.request.source.text.replace(/\r\n?/gu, '\n'));
    expect(await executions(page)).toBe(executionCount + 2);
    noLearningChange(before, await snapshot(page));
    records.push({
      id,
      defaults,
      randomValues,
      request: randomRun.request,
      producer: randomRun.result.producer,
    });
  }
  await attach(info, 'seven-item-default-random-reset-and-real-source', records);
});

test('seven and fifteen cells retain Rust values, read/write marks and swaps when stepping backwards', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await observeCaseSetExecution(page);
  const records = [];
  for (const item of [
    { id: 'selection-sort', values: [3, -2, 0, 3, 7, -9, 2] },
    { id: 'bubble-sort', values: [4, -8, 0, 4, 9, -8, 2, -1, 7, 0, 5, 3, -6, 8, 1] },
  ]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, item.id);
    const executionCount = await executions(page);
    await prepare(page, item.values);
    const run = await execute(page, item.values);
    const init = arrayInit(run);
    const object = stateAt(run, init).objects.find(
      (value) => value.declarationNodeId === run.arrayDeclaration,
    )!;
    const write =
      run.result.trace!.steps.findIndex((step) =>
        step.changes.some((change) => change.op === 'cell' && change.objectId === object.id),
      ) + 1;
    const swap =
      run.result.trace!.steps.findIndex((step) =>
        step.observations.some(
          (observation) => observation.kind === 'swap' && observation.objectId === object.id,
        ),
      ) + 1;
    expect(write).toBeGreaterThan(init);
    expect(swap).toBeGreaterThanOrEqual(write);
    await seek(page, init);
    await assertState(page, run, init);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await assertGeometry(page, item.values.length);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const cursor of [...new Set([init, write, swap])].sort((left, right) => left - right)) {
      await seek(page, cursor);
      await assertState(page, run, cursor);
    }
    for (const cursor of [...new Set([swap - 1, write - 1, init - 1, 0])].sort(
      (left, right) => right - left,
    )) {
      await seek(page, cursor);
      await assertState(page, run, cursor);
    }
    await expect(controls(page)).toHaveAttribute('data-cursor', '0');
    expect(await executions(page)).toBe(executionCount + 1);
    records.push({
      id: item.id,
      values: item.values,
      init,
      write,
      swap,
      identity: run.request.identity,
    });
  }
  await attach(info, 'actual-rust-array-deltas-forward-backward-and-wrapping', records);
});

test('zero and one remain legal and thirty-one is rejected without preparing or executing', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  const records = [];
  for (const id of ['bubble-sort', 'selection-sort']) {
    await open(page, id);
    const executionCount = await executions(page);
    for (const values of [[], [-999]]) {
      await prepare(page, values);
      const run = await execute(page, values);
      const cursor = arrayInit(run);
      await seek(page, cursor);
      await assertState(page, run, cursor);
      if (values.length === 0) {
        await expect(page.getByTestId('trace-array')).toContainText('空数组');
        await expect(page.getByTestId('trace-array-cell')).toHaveCount(0);
        await expect(page.locator('.array-chart-scroll')).toHaveCount(0);
      } else await assertGeometry(page, 1);
      records.push({ id, values, source: run.request.source.text, terminal: run.result.terminal });
    }
    const before = await page.evaluate(() => window.__verticalObservation.workers.length);
    await valuesField(page).fill(Array(31).fill('1').join(', '));
    await expect(page.getByTestId('input-errors')).toBeVisible();
    await expect(action(page, '应用输入并准备')).toBeDisabled();
    await expect(action(page, '运行示例')).toHaveCount(0);
    await expect(action(page, '准备运行样例')).toBeDisabled();
    await expectEditorValue(source(page), '');
    await expect(controls(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__verticalObservation.workers.length)).toBe(before);
    await page.getByTestId('input-length-values').fill('31');
    await action(page, '按种子复现').click();
    await expect(page.getByTestId('input-errors')).toBeVisible();
    expect(await page.evaluate(() => window.__verticalObservation.workers.length)).toBe(before);
    expect(await executions(page)).toBe(executionCount + 2);
  }
  await attach(info, 'unchanged-zero-one-and-thirty-one-boundaries', records);
});

async function chooseThemeWithoutLosingRun(page: Page, settings: Page, theme: ThemeId) {
  // A case is ephemeral when its route unmounts. Change the native settings in
  // another tab; the product's normal storage broadcast updates this live run.
  await settings.bringToFront();
  await ready(settings);
  await expect(settings.locator('html')).toHaveAttribute(
    'data-theme',
    (await page.locator('html').getAttribute('data-theme'))!,
  );
  await settings.getByTestId(`theme-${theme}`).click();
  if (await settings.getByTestId('save-appearance').isEnabled())
    await settings.getByTestId('save-appearance').click();
  await expect(settings.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
  await ready(settings);
  await page.bringToFront();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
}

test('one thirty-item Rust trajectory wraps across six themes, both modes, widths and workbench layouts without reruns or rewards', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await observeCaseSetExecution(page);
  await open(page, 'array-traversal');
  const values = [
    -999, 0, 999, -7, 7, 7, 0, -13, 29, 5, -5, 3, 0, 41, -41, 6, 8, -2, 2, 10, -10, 4, 4, 17, -17,
    12, 0, -1, 1, 30,
  ];
  await prepare(page, values);
  const run = await execute(page, values);
  const cursor = arrayInit(run);
  await seek(page, cursor);
  await assertState(page, run, cursor);
  const before = await snapshot(page);
  const settings = await page.context().newPage();
  await settings.goto('/#/settings?panel=appearance');
  await ready(settings);
  const samples = [];
  for (const theme of themes) {
    await chooseThemeWithoutLosingRun(page, settings, theme);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
    for (const mode of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== mode) {
        await page.getByTestId('theme-mode-toggle').click();
        await ready(page);
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await expect(controls(page)).toHaveAttribute('data-cursor', String(cursor));
        samples.push({ theme, mode, width, geometry: await assertGeometry(page, 30) });
      }
      if (mode === 'light') {
        await page.setViewportSize({ width: 1440, height: 900 });
        await assertGeometry(page, 30);
        await page
          .getByTestId('trace-array')
          .screenshot({ path: info.outputPath(`${theme}-thirty-cells.png`) });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const scope = bench(page);
  const separator: Locator = scope.getByRole('separator', { name: '调整面板宽度', exact: true });
  for (const key of ['Home', 'End']) {
    await separator.focus();
    await page.keyboard.press(key);
    await ready(page);
    await assertGeometry(page, 30);
  }
  await scope.getByRole('button', { name: '展开运行画面', exact: true }).click();
  await expect(scope).toHaveAttribute('data-expanded', 'second');
  await assertGeometry(page, 30);
  await scope.getByRole('button', { name: '还原分栏', exact: true }).click();
  await page.getByRole('button', { name: '进入专注模式', exact: true }).click();
  await ready(page);
  await assertGeometry(page, 30);
  await page.setViewportSize({ width: 390, height: 900 });
  const tabs = scope.getByRole('tablist', { name: '工作区域', exact: true });
  await tabs.getByRole('tab', { name: '代码', exact: true }).click();
  await expect(scope.getByTestId('workbench-second')).toBeHidden();
  await tabs.getByRole('tab', { name: '运行画面', exact: true }).click();
  await assertGeometry(page, 30);
  await assertState(page, run, cursor);
  expect(await executions(page)).toBe(1);
  const last = await observedCaseSetExecute(page);
  expect(
    (JSON.parse(Buffer.from(last.requestBytes!).toString('utf8')) as ExecuteRequest).identity,
  ).toEqual(run.request.identity);
  noLearningChange(before, await snapshot(page));
  await attach(info, 'same-thirty-item-rust-run-six-themes-light-dark-six-widths', {
    request: run.request,
    producer: run.result.producer,
    cursor,
    executionCount: 1,
    samples,
    before,
    after: await snapshot(page),
  });
  await settings.close();
});
