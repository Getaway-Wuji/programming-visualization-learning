import { editorValue, expectEditorValue } from './editor-value';
import { expectedSourceLine } from './source-highlight';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type {
  ByteRange,
  ExecuteRequest,
  ExecuteResult,
  ExecutionLocation,
  TraceObject,
  TraceState,
  TraceStep,
} from '../../web/src/engine/protocol';
import { observedExecute, observeVerticalExecution } from './vertical-observation';
import { isolateCaseProgram } from './case-content-copy';

const panel = (page: Page) => page.getByTestId('case-execution');
const controls = (page: Page) => page.getByTestId('player-controls');
const view = (page: Page) => page.getByTestId('trace-view');
const source = (page: Page) =>
  panel(page).getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
const button = (page: Page, name: string) =>
  controls(page).getByRole('button', { name, exact: true });

async function followSystemTheme(page: Page) {
  // A new SAVE2 archive starts light. Opt into system mode through the real
  // settings UI before testing a media change against an accepted trajectory.
  await page.goto('/#/settings?panel=display');
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-learning-storage-status',
    /^(ready|unsaved)$/,
  );
  await expect(page.getByRole('combobox', { name: '主题', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('system');
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-learning-storage-status',
    /^(ready|unsaved)$/,
  );
  await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await page.getByRole('tab', { name: '外观与主题', exact: true }).click();
  await expect(page.getByTestId('theme-minimal')).toBeEnabled();
}

async function expectReadableMark(page: Page, testId: string) {
  const colors = await page
    .getByTestId(testId)
    .first()
    .evaluate((element) => {
      // CSS color-mix can return color(srgb ... / alpha). Flatten the actual
      // painted ancestor colors in the browser before computing contrast.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 1, 1);
      const ancestors: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement)
        ancestors.unshift(current);
      for (const ancestor of ancestors) {
        context.fillStyle = getComputedStyle(ancestor).backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      context.fillStyle = getComputedStyle(element).color;
      context.fillRect(0, 0, 1, 1);
      return [[...context.getImageData(0, 0, 1, 1).data].slice(0, 3), background];
    });
  const luminance = (color: number[]) => {
    const channels = color.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const [foreground, background] = colors.map(luminance).sort((left, right) => right - left);
  expect((foreground + 0.05) / (background + 0.05)).toBeGreaterThanOrEqual(4.5);
}

interface Run {
  request: ExecuteRequest;
  result: ExecuteResult;
  states: TraceState[];
}

/** This test-only oracle applies Rust's supplied records and values. It neither
 * imports the production player projection nor evaluates the program's C. */
function projectedStates(result: ExecuteResult): TraceState[] {
  const state = structuredClone(result.trace!.initialState);
  const states = [structuredClone(state)];
  for (const step of result.trace!.steps) {
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
    states.push(structuredClone(state));
  }
  return states;
}

async function isolatedPublicCopy(
  page: Page,
  programId: string,
  change: (original: string) => string,
) {
  // These probes deliberately exercise the bundled legacy configuration copy.
  // The newer verified course bundle otherwise correctly takes precedence.
  await page.route(/\/content\/(?:course|review)\//, (route) =>
    route.fulfill({
      status: 404,
      body: 'Legacy trace probe: current course intentionally unavailable',
    }),
  );
  return isolateCaseProgram(page, programId, change);
}

async function acceptedRun(
  page: Page,
  caseId = 'case.c.assignment',
  draft: Record<string, string> = { x: '-7' },
  status: 'completed' | 'program-error' = 'completed',
): Promise<Run> {
  await page.goto(`/#/visualize/${caseId}`);
  await expect(page.getByTestId('input-panel')).toBeVisible();
  for (const [key, value] of Object.entries(draft))
    await page.getByTestId(`input-field-${key}`).fill(value);
  await panel(page).getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await page.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
  await expect(source(page)).toHaveAttribute('readonly', '');
  await panel(page).getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', status);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'ready');
  const worker = await observedExecute(page);
  expect(worker).toMatchObject({ moduleSeen: true, responseOk: true, terminated: true });
  expect(worker.responseOperationId).toBe(worker.operationId);
  const request = JSON.parse(Buffer.from(worker.requestBytes!).toString('utf8')) as ExecuteRequest;
  const result = JSON.parse(Buffer.from(worker.responseBytes!).toString('utf8')) as ExecuteResult;
  expect(result.producer).toBe('rust');
  expect(result.terminal.status).toBe(status);
  expect(result.identity).toEqual(request.identity);
  // Textareas normalize CRLF on their DOM value; the submitted original is
  // retained unchanged and the independent byte-coordinate oracle uses it.
  expect(await editorValue(source(page))).toBe(request.source.text.replace(/\r\n?/gu, '\n'));
  expect(result.trace!.steps.length).toBeGreaterThan(1);
  expect(result.trace!.steps.length).toBeLessThan(150);
  return { request, result, states: projectedStates(result) };
}

function rangeFor(run: Run, location: ExecutionLocation): ByteRange | null {
  let range: ByteRange | undefined;
  let edge: 'start' | 'whole' | 'end';
  if (location.kind === 'synthetic') {
    if (location.reason !== 'implicit-return' || !location.anchorNodeId) return null;
    range = run.result.nodeMap.find((node) => node.nodeId === location.anchorNodeId)?.byteRange;
    edge = 'end';
  } else {
    range =
      location.byteRange ??
      run.result.nodeMap.find((node) => node.nodeId === location.nodeId)?.byteRange;
    edge = location.byteRange ? 'whole' : (location.edge ?? 'whole');
  }
  if (!range || edge === 'whole' || range.start === range.end) return range ?? null;
  const encoded = Buffer.from(run.request.source.text, 'utf8');
  const characters = Array.from(encoded.subarray(range.start, range.end).toString('utf8'));
  const size = Buffer.byteLength(edge === 'start' ? characters[0] : characters.at(-1)!);
  return edge === 'start'
    ? { start: range.start, end: range.start + size }
    : { start: range.end - size, end: range.end };
}

function objectCells(object: TraceObject, count: number, step?: TraceStep) {
  return Array.from({ length: count }, (_, index) => ({
    index: String(index),
    value: String(
      object.cells.find((cell) => cell.index === index)?.value ??
        object.defaultValue ??
        'uninitialized',
    ),
    read: String(
      step?.observations.some(
        (observation) =>
          observation.kind === 'read' &&
          observation.objectId === object.id &&
          observation.index === index,
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
  }));
}

async function assertView(page: Page, run: Run, cursor: number) {
  const state = run.states[cursor];
  const step = run.result.trace!.steps[cursor - 1];
  await expect(controls(page)).toHaveAttribute('data-cursor', String(cursor));
  await expect(view(page)).toHaveAttribute('data-cursor', String(cursor));
  await expect(page.getByTestId('step-summary')).toHaveAttribute(
    'data-step-kind',
    step?.kind ?? '',
  );
  await expect(page.getByTestId('step-output')).toHaveAttribute('data-output', state.output);
  const ui = await view(page).evaluate((element) => {
    const attr = (item: Element, key: string) => item.getAttribute(`data-${key}`);
    return {
      scalars: Array.from(element.querySelectorAll('[data-testid="trace-variable"]'), (item) => ({
        id: attr(item, 'object-id'),
        name: attr(item, 'name'),
        scope: attr(item, 'scope-id'),
        value: attr(item, 'value'),
        read: attr(item, 'read'),
        write: attr(item, 'write'),
      })),
      arrays: Array.from(element.querySelectorAll('[data-testid="trace-array"]'), (item) => ({
        id: attr(item, 'object-id'),
        name: attr(item, 'name'),
        length: attr(item, 'logical-length'),
        storageLength: attr(item, 'storage-length'),
        cells: Array.from(item.querySelectorAll('[data-testid="trace-array-cell"]'), (cell) => ({
          index: attr(cell, 'index'),
          value: attr(cell, 'value'),
          read: attr(cell, 'read'),
          write: attr(cell, 'write'),
        })),
      })),
      counters: Array.from(element.querySelectorAll('[data-testid="step-counters"]'), (item) => ({
        comparisons: attr(item, 'comparisons'),
        scalarWrites: attr(item, 'scalar-writes'),
        arrayWrites: attr(item, 'array-writes'),
        swaps: attr(item, 'swaps'),
      })),
    };
  });
  expect(ui.scalars).toEqual(
    state.objects
      .filter((object) => object.kind === 'int')
      .map((object) => ({
        id: object.id,
        name: object.name,
        scope: object.scopeId,
        ...objectCells(object, 1, step).map(({ value, read, write }) => ({
          value,
          read,
          write,
        }))[0],
      })),
  );
  const arrayDeclaration = run.result.resolvedBindings.find(
    (binding) => binding.bindingKey === 'param.values',
  )?.declarationNodeId;
  expect(ui.arrays).toEqual(
    state.objects
      .filter((object) => object.kind === 'int-array')
      .map((object) => {
        const length =
          object.declarationNodeId === arrayDeclaration
            ? (run.request.input.values.values as readonly number[]).length
            : object.length;
        return {
          id: object.id,
          name: object.name,
          length: String(length),
          storageLength: String(object.length),
          cells: objectCells(object, length, step),
        };
      }),
  );
  expect(ui.counters).toEqual([
    Object.fromEntries(Object.entries(state.counters).map(([key, value]) => [key, String(value)])),
  ]);
  const expectedRange = expectedSourceLine(
    run.request.source.text,
    step ? rangeFor(run, step.location) : null,
  );
  const marks = await page.getByTestId('source-step-highlight').evaluateAll((elements) =>
    elements.map((element) => ({
      start: Number(element.getAttribute('data-byte-start')),
      end: Number(element.getAttribute('data-byte-end')),
      utf16Start: Number(element.getAttribute('data-start')),
      utf16End: Number(element.getAttribute('data-end')),
    })),
  );
  if (!expectedRange) expect(marks).toEqual([]);
  else {
    expect(marks.length).toBeGreaterThan(0);
    expect({
      start: Math.min(...marks.map((mark) => mark.start)),
      end: Math.max(...marks.map((mark) => mark.end)),
    }).toEqual(expectedRange);
    const bytes = Buffer.from(run.request.source.text, 'utf8');
    expect(Math.min(...marks.map((mark) => mark.utf16Start))).toBe(
      bytes.subarray(0, expectedRange.start).toString('utf8').length,
    );
    expect(Math.max(...marks.map((mark) => mark.utf16End))).toBe(
      bytes.subarray(0, expectedRange.end).toString('utf8').length,
    );
  }
  if (cursor !== run.result.trace!.steps.length || run.result.terminal.status === 'completed')
    await expect(page.getByTestId('source-terminal-highlight')).toHaveCount(0);
  for (const observation of step?.observations ?? []) {
    if (
      observation.kind === 'evaluate' &&
      ['<', '<=', '>', '>=', '==', '!='].includes(observation.operator)
    )
      await expect(page.getByTestId('step-events')).toContainText(
        `比较 ${observation.operands.join(` ${observation.operator} `)} → ${observation.value}`,
      );
  }
}

async function walkAndRecover(page: Page, run: Run, onForward?: (cursor: number) => Promise<void>) {
  await assertView(page, run, 0);
  for (let cursor = 1; cursor < run.states.length; cursor++) {
    await button(page, '前进').click();
    await assertView(page, run, cursor);
    await onForward?.(cursor);
  }
  for (let cursor = run.states.length - 2; cursor >= 0; cursor--) {
    await button(page, '后退').click();
    await assertView(page, run, cursor);
  }
  expect(
    await page.evaluate(
      () =>
        window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
    ),
  ).toBe(1);
}

async function evidence(
  page: Page,
  run: Run,
  testInfo: TestInfo,
  sourceKind = 'public-content-original',
) {
  await testInfo.attach('08.3-trace-view-real-worker.json', {
    body: JSON.stringify({
      evidenceLevel: 'production-ui-real-worker',
      sourceKind,
      browserVersion: page.context().browser()?.version(),
      request: run.request,
      result: run.result,
      checks: [
        'same-cursor-values',
        'source-byte-ranges',
        'current-output',
        'current-read-write',
        'counters',
        'full-reverse-recovery',
      ],
      finalCursor: await view(page).getAttribute('data-cursor'),
    }),
    contentType: 'application/json',
  });
}

test('real scalar declaration, initialization, write, output and return recover at every cursor', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  const run = await acceptedRun(page);
  expect(run.result.trace!.steps.map((step) => step.kind)).toEqual(
    expect.arrayContaining([
      'object.declare',
      'value.initialize',
      'value.write',
      'output.append',
      'program.return',
    ]),
  );
  expect(
    run.states.some((state) =>
      state.objects.some((object) => object.defaultValue === null && object.cells.length === 0),
    ),
  ).toBe(true);
  await expect(page.getByTestId('execution-output')).toHaveText('-5\n');
  await expect(page.getByTestId('step-output')).toHaveAttribute('data-output', '');
  await walkAndRecover(page, run);
  await evidence(page, run, testInfo);
});

test('real arrays show negative, duplicate and zero values with current reads, writes and comparisons', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await isolatedPublicCopy(page, 'program.c.array-sum', (original) =>
    original.replace(
      '    printf("%d\\n", sum);',
      '    values[1] = values[0];\n    if (values[0] == values[1]) { values[0] = 0; }\n    printf("%d\\n", sum);',
    ),
  );
  const run = await acceptedRun(page, 'case.c.array-traversal', { values: '-2, 5, 5, 0' });
  const initialized = run.states.find((state) =>
    state.objects.some((object) => object.kind === 'int-array' && object.defaultValue === 0),
  )!;
  const values = initialized.objects.find((object) => object.name === 'values')!;
  expect(objectCells(values, 4).map((cell) => cell.value)).toEqual(['-2', '5', '5', '0']);
  expect(
    run.result.trace!.steps.some(
      (step) =>
        step.kind === 'value.write' &&
        step.changes.some((change) => change.op === 'cell' && change.objectId === values.id),
    ),
  ).toBe(true);
  expect(
    run.result.trace!.steps.some((step) =>
      step.observations.some(
        (observation) => observation.kind === 'evaluate' && observation.operator === '==',
      ),
    ),
  ).toBe(true);
  await walkAndRecover(page, run, async (cursor) => {
    if (run.states[cursor] !== initialized) return;
    const cells = page.getByTestId('trace-array-cell');
    await expect(cells.nth(0).locator('.value-bar')).toHaveClass(/value-negative/u);
    await expect(cells.nth(1).locator('.value-bar')).toHaveClass(/value-positive/u);
    expect(await cells.nth(1).locator('.value-bar').getAttribute('style')).toBe(
      await cells.nth(2).locator('.value-bar').getAttribute('style'),
    );
    await expect(cells.nth(3).locator('.value-bar')).toHaveCSS('height', '2px');
    await page.screenshot({
      path: testInfo.outputPath('trace-array-boundaries.png'),
      fullPage: true,
    });
  });
  await evidence(page, run, testInfo, 'test-isolated-public-content-array-boundary-copy');
});

test('empty logical arrays never expose the Rust storage placeholder as a visible element', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  const run = await acceptedRun(page, 'case.c.array-traversal', { values: '[]' });
  expect(run.request.source.text).toContain('int values[1] = {0};');
  let sawEmpty = false;
  for (let cursor = 0; cursor < run.states.length; cursor++) {
    if (cursor) await button(page, '前进').click();
    await assertView(page, run, cursor);
    if (run.states[cursor].objects.some((object) => object.kind === 'int-array')) {
      sawEmpty = true;
      await expect(page.getByTestId('trace-array')).toHaveAttribute('data-logical-length', '0');
      await expect(page.getByTestId('trace-array')).toHaveAttribute('data-storage-length', '1');
      await expect(page.getByTestId('trace-array-cell')).toHaveCount(0);
      await expect(page.getByTestId('trace-array')).toContainText('空数组');
    }
  }
  expect(sawEmpty).toBe(true);
  for (let cursor = run.states.length - 2; cursor >= 0; cursor--) {
    await button(page, '后退').click();
    await assertView(page, run, cursor);
  }
  await evidence(page, run, testInfo);
});

test('same-line steps and shadowed objects keep separate identities through scope exit and reverse', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await isolatedPublicCopy(page, 'program.c.assignment', (original) =>
    original.replace(
      'x = x + 2;',
      '{ int x = -11; int local; local = x; printf("%d\\n", local); } x = x + 2;',
    ),
  );
  const run = await acceptedRun(page);
  const shadow = run.states.find(
    (state) => state.objects.filter((object) => object.name === 'x').length === 2,
  )!;
  expect(shadow).toBeDefined();
  const xs = shadow.objects.filter((object) => object.name === 'x');
  expect(new Set(xs.map((object) => object.id)).size).toBe(2);
  expect(new Set(xs.map((object) => object.scopeId)).size).toBe(2);
  expect(run.result.trace!.steps.filter((step) => step.kind === 'scope.exit')).not.toHaveLength(0);
  const lineStart = run.request.source.text.indexOf('{ int x');
  const lineEnd = run.request.source.text.indexOf('\n', lineStart);
  expect(
    run.result.trace!.steps.filter((step) => {
      const range = rangeFor(run, step.location);
      return range && range.start >= lineStart && range.end <= lineEnd;
    }).length,
  ).toBeGreaterThan(5);
  await walkAndRecover(page, run);
  await evidence(page, run, testInfo, 'test-isolated-public-content-shadow-same-line-copy');
});

test('Unicode and CRLF preserve Rust byte ranges and Unicode scalar line and column positions', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await isolatedPublicCopy(page, 'program.c.assignment', (original) =>
    `// 中文😀\n${original}`
      .replace('printf("%d\\n", x);', 'printf("结果😀:%d\\n", x);')
      .replace(/\n/gu, '\r\n'),
  );
  const run = await acceptedRun(page);
  expect(run.request.source.text).toContain('// 中文😀\r\n');
  expect(run.request.source.text).toContain('printf("结果😀:%d\\n", x);');
  for (let cursor = 1; cursor < run.states.length; cursor++) {
    await button(page, '前进').click();
    await assertView(page, run, cursor);
    const range = rangeFor(run, run.result.trace!.steps[cursor - 1].location);
    if (range) {
      const prefix = Buffer.from(run.request.source.text).subarray(0, range.start).toString('utf8');
      const lines = prefix.split(/\r\n|\r|\n/u);
      const line = lines.length;
      const column = Array.from(lines.at(-1)!).length + 1;
      await expect(page.getByTestId('source-location')).toContainText(
        new RegExp(`第\\s*${line}\\s*行.*第\\s*${column}\\s*列`, 'u'),
      );
    }
  }
  expect(run.states.at(-1)!.output).toBe('结果😀:-5\n');
  for (let cursor = run.states.length - 2; cursor >= 0; cursor--) {
    await button(page, '后退').click();
    await assertView(page, run, cursor);
  }
  await evidence(page, run, testInfo, 'test-isolated-public-content-Unicode-CRLF-copy');
});

test('a genuine failed prefix shows its terminal range only at the tail and fully restores prior views', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await isolatedPublicCopy(page, 'program.c.assignment', (original) =>
    original.replace('x = x + 2;', 'printf("%d\\n", x); x = x / 0;'),
  );
  await followSystemTheme(page);
  const run = await acceptedRun(page, 'case.c.assignment', { x: '-7' }, 'program-error');
  expect(run.result.trace!.completeness).toBe('prefix');
  expect(run.result.terminal.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    'E_DIV_ZERO',
  );
  for (let cursor = 0; cursor < run.states.length; cursor++) {
    if (cursor) await button(page, '前进').click();
    await assertView(page, run, cursor);
  }
  const terminalRange = rangeFor(run, run.result.terminal.location)!;
  const terminalMarks = await page
    .getByTestId('source-terminal-highlight')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        start: Number(element.getAttribute('data-byte-start')),
        end: Number(element.getAttribute('data-byte-end')),
      })),
    );
  expect(terminalMarks.length).toBeGreaterThan(0);
  expect({
    start: Math.min(...terminalMarks.map((range) => range.start)),
    end: Math.max(...terminalMarks.map((range) => range.end)),
  }).toEqual(terminalRange);
  await expect(view(page)).toContainText('E_DIV_ZERO');
  await expect(page.getByTestId('step-summary')).toHaveAttribute('data-step-kind', 'output.append');
  await expectReadableMark(page, 'source-terminal-highlight');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectReadableMark(page, 'source-terminal-highlight');
  await page.screenshot({ path: testInfo.outputPath('trace-failed-tail.png'), fullPage: true });
  for (let cursor = run.states.length - 2; cursor >= 0; cursor--) {
    await button(page, '后退').click();
    await assertView(page, run, cursor);
    await expect(view(page)).not.toContainText('E_DIV_ZERO');
  }
  await expect(page.getByTestId('execution-output')).toHaveText('-7\n');
  await evidence(page, run, testInfo, 'test-isolated-public-content-divide-by-zero-copy');
});

test('implicit return has an explicit explanation and editing removes every old source and data view', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await isolatedPublicCopy(page, 'program.c.assignment', (original) =>
    original.replace('    return 0;\n', ''),
  );
  const run = await acceptedRun(page);
  expect(run.result.trace!.steps.at(-1)!.location).toMatchObject({
    kind: 'synthetic',
    reason: 'implicit-return',
  });
  for (let cursor = 1; cursor < run.states.length; cursor++) {
    await button(page, '前进').click();
    await assertView(page, run, cursor);
  }
  await expect(page.getByTestId('source-location')).toContainText('隐式返回');
  for (let cursor = run.states.length - 2; cursor >= 0; cursor--) {
    await button(page, '后退').click();
    await assertView(page, run, cursor);
  }
  await evidence(page, run, testInfo, 'test-isolated-public-content-implicit-return-copy');
  await page.getByTestId('input-field-x').fill('8');
  for (const id of [
    'trace-view',
    'step-output',
    'source-step-highlight',
    'source-terminal-highlight',
    'source-location',
  ])
    await expect(page.getByTestId(id)).toHaveCount(0);
  await expectEditorValue(source(page), '');
  await expect(controls(page)).toHaveCount(0);
  await page.waitForTimeout(650);
  await expect(page.getByTestId('trace-variable')).toHaveCount(0);
  await expect(page.getByTestId('trace-array')).toHaveCount(0);
});

test('the visible highlight follows long-source scroll without stealing selection or keyboard focus', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await isolatedPublicCopy(
    page,
    'program.c.assignment',
    (original) =>
      '// 行😀\n'.repeat(45) + original.replace('    int x = 3;', `${' '.repeat(160)}int x = 3;`),
  );
  await followSystemTheme(page);
  const run = await acceptedRun(page);
  const declaration = run.result.trace!.steps.find((step) => step.kind === 'object.declare')!.seq;
  await page.getByTestId('player-workspace').focus();
  for (let cursor = 1; cursor <= declaration; cursor++) await page.keyboard.press('ArrowRight');
  await assertView(page, run, declaration);
  await expect(page.getByTestId('player-workspace')).toBeFocused();
  const geometry = await source(page).evaluate((area: HTMLTextAreaElement) => {
    const overlay = document.querySelector<HTMLElement>('.source-highlight')!;
    const mark = document.querySelector<HTMLElement>('[data-testid="source-step-highlight"]')!;
    const text = mark.firstChild!;
    const token = document.createRange();
    const start = mark.textContent!.search(/\S/);
    token.setStart(text, start);
    token.setEnd(text, mark.textContent!.trimEnd().length);
    const visibleCode = token.getBoundingClientRect();
    const native = getComputedStyle(area),
      painted = getComputedStyle(overlay);
    return {
      left: area.scrollLeft,
      top: area.scrollTop,
      areaLeft: area.getBoundingClientRect().left,
      right: area.getBoundingClientRect().right,
      markLeft: visibleCode.left,
      markRight: visibleCode.right,
      areaTop: area.getBoundingClientRect().top,
      markTop: mark.getBoundingClientRect().top,
      bottom: area.getBoundingClientRect().bottom,
      native: [
        native.fontFamily,
        native.fontSize,
        native.lineHeight,
        native.paddingLeft,
        native.paddingTop,
      ],
      painted: [
        painted.fontFamily,
        painted.fontSize,
        painted.lineHeight,
        painted.paddingLeft,
        painted.paddingTop,
      ],
    };
  });
  expect(geometry.left).toBeGreaterThan(0);
  expect(geometry.top).toBeGreaterThan(0);
  expect(geometry.markLeft).toBeLessThan(geometry.right);
  // Native scroll offsets round while inline glyph bounds retain subpixel precision.
  expect(geometry.markLeft).toBeGreaterThanOrEqual(geometry.areaLeft - 1);
  expect(geometry.markRight).toBeLessThanOrEqual(geometry.right + 1);
  expect(geometry.markTop).toBeGreaterThanOrEqual(geometry.areaTop);
  expect(geometry.markTop).toBeLessThan(geometry.bottom);
  expect(geometry.native).toEqual(geometry.painted);
  await expectReadableMark(page, 'source-step-highlight');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectReadableMark(page, 'source-step-highlight');
  await page
    .getByTestId('code-panel')
    .screenshot({ path: testInfo.outputPath('trace-dark-source.png') });
  await source(page).focus();
  await source(page).evaluate((area: HTMLTextAreaElement) => {
    area.setSelectionRange(0, 8);
    area.scrollTop = 0;
    area.scrollLeft = 0;
    area.dispatchEvent(new Event('scroll'));
  });
  await expect(source(page)).toBeFocused();
  expect(
    await page.locator('.source-highlight-text').evaluate((node) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return [matrix.m41, matrix.m42];
    }),
  ).toEqual([0, 0]);
  expect(
    await source(page).evaluate((area: HTMLTextAreaElement) => [
      area.selectionStart,
      area.selectionEnd,
    ]),
  ).toEqual([0, 8]);
  await page.keyboard.press('ArrowRight');
  // Native caret movement may scroll the textarea; compare the overlay with
  // that actual offset after the browser has delivered its scroll events.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect
    .poll(() =>
      source(page).evaluate((area: HTMLTextAreaElement) => {
        const code = area.parentElement!.querySelector<HTMLElement>('.source-highlight-text')!;
        const matrix = new DOMMatrixReadOnly(getComputedStyle(code).transform);
        return [matrix.m41 + area.scrollLeft, matrix.m42 + area.scrollTop];
      }),
    )
    .toEqual([0, 0]);
  await expect(source(page)).toBeFocused();
  await expect(controls(page)).toHaveAttribute('data-cursor', String(declaration));
});
