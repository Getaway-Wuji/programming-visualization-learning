import { expectEditorValue, editorValue } from './editor-value';
import { expect, test, type Page } from '@playwright/test';
import type { InputValues } from '../../web/src/content/types';
import type {} from './harness/input-data';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

type HoldKind = 'prepare-case' | 'execute';
interface InputAudit {
  holdKind: HoldKind | null;
  held: number;
  release: () => void;
  writes: string[];
  workers: { kind: string; terminated: boolean }[];
  preparation?: Promise<{ source: string | null; code: string | null }>;
}
declare global {
  interface Window {
    __inputAudit: InputAudit;
  }
}

async function observe(page: Page) {
  await page.addInitScript(() => {
    let pending: (() => void)[] = [];
    const audit: InputAudit = {
      holdKind: null,
      held: 0,
      writes: [],
      workers: [],
      release() {
        const held = pending;
        pending = [];
        audit.held = 0;
        held.forEach((deliver) => deliver());
      },
    };
    window.__inputAudit = audit;
    const nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      audit.writes.push(`${key}:${value}`);
      return nativeSet.call(this, key, value);
    };
    const nativePut = IDBObjectStore.prototype.put;
    const nativeAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.put = function (value, key) {
      audit.writes.push(JSON.stringify(value));
      return key === undefined ? nativePut.call(this, value) : nativePut.call(this, value, key);
    };
    IDBObjectStore.prototype.add = function (value, key) {
      audit.writes.push(JSON.stringify(value));
      return key === undefined ? nativeAdd.call(this, value) : nativeAdd.call(this, value, key);
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private record = { kind: '', terminated: false };
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        audit.workers.push(this.record);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (audit.holdKind !== this.record.kind) return;
          const handler = this.onmessage;
          if (!handler) return;
          event.stopImmediatePropagation();
          audit.holdKind = null;
          audit.held++;
          pending.push(() => handler.call(this, new MessageEvent('message', { data: event.data })));
        });
      }
      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        const data = message as Record<string, unknown>;
        if (typeof data?.kind === 'string') this.record.kind = data.kind;
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      terminate() {
        this.record.terminated = true;
        super.terminate();
      }
    };
  });
}

const panel = (page: Page) => page.getByTestId('case-execution');
const field = (page: Page, key: string) => page.getByTestId(`input-field-${key}`);
const source = (page: Page) => panel(page).getByRole('textbox', { name: '当前执行的 C 代码' });
const apply = (page: Page) =>
  panel(page).getByRole('button', { name: '应用输入并准备', exact: true });
const run = (page: Page) => panel(page).getByRole('button', { name: '运行示例', exact: true });
async function visible(page: Page, caseId = 'case.c.assignment') {
  await page.goto(`/#/visualize/${caseId}`);
  await expect(page.getByTestId('input-panel')).toBeVisible();
  const seedOptions = page.getByText('复现随机数据', { exact: true });
  if (await seedOptions.count()) {
    const details = seedOptions.locator('..');
    if ((await details.getAttribute('open')) === null) await seedOptions.click();
  }
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(run(page)).toBeEnabled();
  await expectEditorValue(source(page), '', { not: true });
}
async function prepared(page: Page) {
  await apply(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
}
async function completed(page: Page, output: string) {
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('execution-output')).toHaveText(output);
}
async function expectRandomMetadata(page: Page, seed: string) {
  const packet = await observedCaseSetExecute(page);
  const request = JSON.parse(Buffer.from(packet.requestBytes!).toString('utf8'));
  expect(request.input.random.seed).toBe(seed);
  expect(request.input.random.generatorRef.version).toBe('1.0.0');
}
async function noOldRun(page: Page) {
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  await expectEditorValue(source(page), '');
  await expect(page.getByTestId('execution-input')).toHaveCount(0);
}
async function noPriorTrajectory(page: Page) {
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expectEditorValue(source(page), '', { not: true });
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-cursor', '');
}
async function checks(page: Page) {
  await page.goto('/checks/');
  await expect.poll(() => page.evaluate(() => typeof window.inputChecks?.open)).toBe('function');
}

test('seven public templates bind changed inputs into their actual Rust source without replacing static examples', async ({
  page,
}, testInfo) => {
  await checks(page);
  const cases: { id: string; values: InputValues; declaration: string; output: string }[] = [
    { id: 'assignment', values: { x: -999 }, declaration: 'int x = -999;', output: '-997\n' },
    { id: 'branch', values: { x: 999 }, declaration: 'int x = 999;', output: '1\n' },
    { id: 'loops', values: { n: 1 }, declaration: 'int n = 1;', output: '1\n1\n' },
    {
      id: 'array-traversal',
      values: { values: [-999, 999, 7] },
      declaration: '{-999, 999, 7}',
      output: '7\n',
    },
    {
      id: 'bubble-sort',
      values: { values: [3, -5, 3] },
      declaration: '{3, -5, 3}',
      output: '-5 3 3\n',
    },
    {
      id: 'selection-sort',
      values: { values: [999, 0, -999] },
      declaration: '{999, 0, -999}',
      output: '-999 0 999\n',
    },
    {
      id: 'binary-search-first',
      values: { values: [-2, 4, 4, 9], target: 4 },
      declaration: 'int target = 4;',
      output: '1\n',
    },
  ];
  const observations = [];
  for (const item of cases) {
    const prepared = await page.evaluate(
      ({ id, values }) => window.inputChecks.open(`case.c.${id}`, values),
      item,
    );
    expect(prepared.source).toContain(item.declaration);
    expect(prepared.values).toEqual(item.values);
    expect(prepared.exampleInput).not.toEqual(item.values);
    const result = await page.evaluate(() => window.inputChecks.run());
    expect(result).toMatchObject({
      producer: 'rust',
      status: 'completed',
      exitCode: 0,
      output: item.output,
      completeness: 'complete',
      judge: null,
    });
    expect(result.steps).toBeGreaterThan(1);
    expect(result.cursor).toBe(result.steps);
    expect(result.bindingCount).toBe(prepared.bindings);
    const inspect = await page.evaluate(() => window.inputChecks.inspect());
    expect(inspect.request!.input.values).toEqual(item.values);
    expect(inspect.request!.input.random).toBeNull();
    expect(inspect.request!.source.text).toBe(prepared.source);
    expect(inspect).toMatchObject({ activeWorkers: 0, commitCount: 1 });
    observations.push({ id: item.id, ...result });
  }
  await testInfo.attach('changed-input-real-Rust', {
    body: JSON.stringify(observations),
    contentType: 'application/json',
  });
});

test('logical array sizes zero, one and thirty remain real valid inputs including empty storage placeholders', async ({
  page,
}) => {
  await checks(page);
  const thirty = Array.from({ length: 30 }, (_, index) => index + 1);
  for (const [n, output] of [
    [0, '0\n0\n'],
    [30, '465\n465\n'],
  ] as const) {
    await page.evaluate((n) => window.inputChecks.open('case.c.loops', { n }), n);
    expect(await page.evaluate(() => window.inputChecks.run())).toMatchObject({
      producer: 'rust',
      status: 'completed',
      output,
    });
  }
  for (const id of ['array-traversal', 'bubble-sort', 'selection-sort', 'binary-search-first']) {
    for (const values of [[], [7], thirty]) {
      const input: InputValues = id === 'binary-search-first' ? { values, target: 7 } : { values };
      const prepared = await page.evaluate(
        ({ id, input }) => window.inputChecks.open(`case.c.${id}`, input),
        { id, input },
      );
      expect(prepared.source).toContain(`int n = ${values.length};`);
      if (values.length === 0) expect(prepared.source).toContain('int values[1] = {0};');
      const result = await page.evaluate(() => window.inputChecks.run());
      const expected =
        id === 'array-traversal'
          ? values.length === 0
            ? '0\n'
            : values.length === 1
              ? '7\n'
              : '465\n'
          : id === 'binary-search-first'
            ? values.length === 0
              ? '-1\n'
              : values.length === 1
                ? '0\n'
                : '6\n'
            : `${values.join(' ')}\n`;
      expect(result).toMatchObject({
        producer: 'rust',
        status: 'completed',
        output: expected,
        completeness: 'complete',
      });
    }
  }
});

test('the visible thirty-item reverse bubble run receives its complete checked trajectory within the original deadline', async ({
  page,
}, testInfo) => {
  await observe(page);
  await visible(page, 'case.c.bubble-sort');
  const values = Array.from({ length: 30 }, (_, index) => 30 - index);
  await field(page, 'values').fill(values.join(', '));
  await prepared(page);
  await expectEditorValue(source(page), /int n = 30;/);
  const start = Date.now();
  await completed(page, `${Array.from({ length: 30 }, (_, index) => index + 1).join(' ')}\n`);
  await expect(page.getByTestId('execution-steps')).toContainText('5330');
  expect(
    await page.evaluate(() => window.__inputAudit.workers.every((worker) => worker.terminated)),
  ).toBe(true);
  await testInfo.attach('reverse-thirty-visible', {
    body: JSON.stringify({
      browserVersion: page.context().browser()?.version(),
      visibleWaitMs: Date.now() - start,
      terminal: await page.getByTestId('execution-terminal').innerText(),
      steps: await page.getByTestId('execution-steps').innerText(),
    }),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath('input-reverse-thirty.png'), fullPage: true });
});

test('manual sequence input rejects blank, malformed, fractional, out-of-domain and excessive values without silent repair', async ({
  page,
}) => {
  await visible(page, 'case.c.bubble-sort');
  for (const value of [
    '',
    '   ',
    '1, nope, 2',
    '1.5, 2',
    '1000',
    '-1000',
    '1,,2',
    Array(31).fill('1').join(','),
  ]) {
    await field(page, 'values').fill(value);
    await expect(page.getByTestId('input-errors')).toContainText(/.+/);
    await expect(apply(page)).toBeDisabled();
    await noOldRun(page);
    await expectEditorValue(field(page, 'values'), value);
  }
  await panel(page).getByRole('button', { name: '使用空数组', exact: true }).click();
  await expectEditorValue(field(page, 'values'), '[]');
  await prepared(page);
  await expectEditorValue(source(page), /int n = 0;[\s\S]*int values\[1\] = \{0\};/);
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('execution-output')).toHaveText('\n');
});

test('manual scalar validation is explicit and accepts both integer endpoints after correction', async ({
  page,
}) => {
  await visible(page);
  for (const value of ['', '  ', 'NaN', '1.5', '1e2', '1000', '-1000']) {
    await field(page, 'x').fill(value);
    await expect(page.getByTestId('input-errors')).toContainText(/.+/);
    await expect(apply(page)).toBeDisabled();
    await noOldRun(page);
  }
  for (const [value, output] of [
    ['-999', '-997\n'],
    ['999', '1001\n'],
  ]) {
    await field(page, 'x').fill(value!);
    await prepared(page);
    await expectEditorValue(source(page), new RegExp(`int x = ${value};`));
    await completed(page, output!);
  }
});

test('binary search explains nondecreasing input, rejects disorder and returns the first duplicate match from Rust', async ({
  page,
}) => {
  await visible(page, 'case.c.binary-search-first');
  await expect(page.getByTestId('input-panel')).toContainText(/非递减|从小到大|有序/);
  await field(page, 'values').fill('1, 5, 3');
  await expect(page.getByTestId('input-errors')).toContainText(/非递减|顺序|有序/);
  await expect(apply(page)).toBeDisabled();
  await expectEditorValue(field(page, 'values'), '1, 5, 3');
  await field(page, 'values').fill('-2, 4, 4, 9');
  await field(page, 'target').fill('4');
  await prepared(page);
  await completed(page, '1\n');
});

test('the same seed and length reproduce random values, prepared source and real output with versioned temporary metadata', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await visible(page, 'case.c.array-traversal');
  await page.getByTestId('input-seed').fill('CVIZ-07.2-PUBLIC-REPRO');
  await page.getByTestId('input-length-values').fill('6');
  await panel(page).getByRole('button', { name: '按种子复现', exact: true }).click();
  const values = await editorValue(field(page, 'values'));
  await prepared(page);
  const firstSource = await editorValue(source(page));
  const firstMetadata = await page.getByTestId('execution-input').innerText();
  await expect(page.getByTestId('input-seed')).toHaveValue('CVIZ-07.2-PUBLIC-REPRO');
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expectRandomMetadata(page, 'CVIZ-07.2-PUBLIC-REPRO');
  const firstOutput = await page.getByTestId('execution-output').innerText();
  await panel(page).getByRole('button', { name: '按种子复现', exact: true }).click();
  await noOldRun(page);
  await expectEditorValue(field(page, 'values'), values);
  await prepared(page);
  await expectEditorValue(source(page), firstSource);
  await expect(page.getByTestId('execution-input')).toHaveText(firstMetadata, {
    useInnerText: true,
  });
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('execution-output')).toHaveText(firstOutput);
  await field(page, 'values').fill('8, 9');
  await noOldRun(page);
  await prepared(page);
  await expect(page.getByTestId('execution-input')).not.toContainText('CVIZ-07.2-PUBLIC-REPRO');
  await completed(page, '17\n');
});

test('random generation supports lengths zero, one and thirty and enforces its length and seed bounds', async ({
  page,
}) => {
  await visible(page, 'case.c.binary-search-first');
  for (const length of ['0', '1', '30']) {
    await page.getByTestId('input-length-values').fill(length);
    await panel(page).getByRole('button', { name: '生成随机数据', exact: true }).click();
    const text = await editorValue(field(page, 'values'));
    const generated = text === '[]' ? [] : text.split(',').map((item) => Number(item.trim()));
    expect(generated).toHaveLength(Number(length));
    expect(
      generated.every((value) => Number.isInteger(value) && value >= -999 && value <= 999),
    ).toBe(true);
    expect(generated.every((value, index) => index === 0 || generated[index - 1]! <= value)).toBe(
      true,
    );
    await prepared(page);
    await run(page).click();
    await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  }
  for (const invalid of ['', '-1', '31', '1.5', '0'.repeat(32) + '1']) {
    await page.getByTestId('input-length-values').fill(invalid);
    await expectEditorValue(page.getByTestId('input-length-values'), invalid);
    await panel(page).getByRole('button', { name: '生成随机数据', exact: true }).click();
    await expect(page.getByTestId('input-errors')).toContainText(/.+/);
    await expect(apply(page)).toBeDisabled();
    await noOldRun(page);
  }
  await page.getByTestId('input-length-values').fill('3');
  for (const seed of ['', 'x'.repeat(129)]) {
    await page.getByTestId('input-seed').fill(seed);
    await panel(page).getByRole('button', { name: '按种子复现', exact: true }).click();
    await expect(page.getByTestId('input-errors')).toContainText(/.+/);
    await expect(apply(page)).toBeDisabled();
    await noOldRun(page);
  }
});

test('editing values, seed or length immediately removes a previous result and reset prepares the original example', async ({
  page,
}) => {
  await visible(page, 'case.c.array-traversal');
  await prepared(page);
  await completed(page, '4\n');
  for (const [testId, value] of [
    ['input-field-values', '8, 9'],
    ['input-seed', 'CVIZ-07.2-EDIT'],
    ['input-length-values', '2'],
  ]) {
    await page.getByTestId(testId!).fill(value!);
    await noOldRun(page);
    await prepared(page);
    await completed(page, '17\n');
  }
  await panel(page).getByRole('button', { name: '恢复示例输入', exact: true }).click();
  await noOldRun(page);
  await prepared(page);
  await expectEditorValue(source(page), /\{3, -1, 2\}/);
  await completed(page, '4\n');
});

test('a replacement input invalidates a queued real fixture preparation and its late response cannot overwrite the new source', async ({
  page,
}) => {
  await observe(page);
  await checks(page);
  await page.evaluate(() => {
    window.__inputAudit.holdKind = 'prepare-case';
    window.__inputAudit.preparation = window.inputChecks.open('case.c.assignment', { x: 3 }).then(
      (prepared) => ({ source: prepared.source, code: null }),
      (error: unknown) => ({
        source: null,
        code: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  await expect.poll(() => page.evaluate(() => window.__inputAudit.held)).toBe(1);
  const prepared = await page.evaluate(() =>
    window.inputChecks.open('case.c.assignment', { x: 8 }),
  );
  expect(prepared.source).toContain('int x = 8;');
  expect(await page.evaluate(() => window.__inputAudit.preparation)).toEqual({
    source: null,
    code: 'E_CANCELLED',
  });
  await page.evaluate(() => window.__inputAudit.release());
  expect((await page.evaluate(() => window.inputChecks.inspect())).source).toBe(prepared.source);
  expect(await page.evaluate(() => window.inputChecks.run())).toMatchObject({
    producer: 'rust',
    status: 'completed',
    output: '10\n',
  });
  expect(await page.evaluate(() => window.inputChecks.inspect())).toMatchObject({
    commitCount: 1,
    activeWorkers: 0,
  });
  expect(
    await page.evaluate(() => window.__inputAudit.workers.every((worker) => worker.terminated)),
  ).toBe(true);
});

test('retrying a real first-run module failure preserves the random draft, seed and matching prepared source', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  const wasm = /\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/;
  await page.route(wasm, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/wasm',
      body: 'Missing public module for input recovery',
    }),
  );
  await visible(page, 'case.c.array-traversal');
  const seed = 'CVIZ-07.2-PUBLIC-RETRY';
  await page.getByTestId('input-seed').fill(seed);
  await page.getByTestId('input-length-values').fill('4');
  await panel(page).getByRole('button', { name: '按种子复现', exact: true }).click();
  const draft = await editorValue(field(page, 'values'));
  await apply(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  const firstSource = await editorValue(source(page));
  expect(firstSource).toContain(`int values[4] = {${draft}};`);
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'infrastructure-failure');
  await expect(panel(page)).toContainText('E_MODULE_LOAD');
  await expect(page.getByTestId('execution-steps')).toContainText('有效轨迹：0 步');
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await expect(page.getByTestId('execution-output')).toHaveText('（无输出）');
  await page.unroute(wasm);
  await expectEditorValue(field(page, 'values'), draft);
  await expectEditorValue(page.getByTestId('input-seed'), seed);
  await expectEditorValue(page.getByTestId('input-length-values'), '4');
  await expectEditorValue(source(page), firstSource);
  await expect(page.getByTestId('input-seed')).toHaveValue(seed);
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expectRandomMetadata(page, seed);
  const output = await page.getByTestId('execution-output').innerText();
  await panel(page).getByRole('button', { name: '按种子复现', exact: true }).click();
  await expectEditorValue(field(page, 'values'), draft);
  await prepared(page);
  await expectEditorValue(source(page), firstSource);
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('execution-output')).toHaveText(output);
});

test('an edited input defeats a queued real completed result and no old output returns', async ({
  page,
}) => {
  await observe(page);
  await visible(page);
  await prepared(page);
  await page.evaluate(() => {
    window.__inputAudit.holdKind = 'execute';
  });
  await run(page).click();
  await expect.poll(() => page.evaluate(() => window.__inputAudit.held)).toBe(1);
  await field(page, 'x').fill('11');
  await noOldRun(page);
  await page.evaluate(() => window.__inputAudit.release());
  await noOldRun(page);
  await prepared(page);
  await completed(page, '13\n');
});

test('case switching, refresh and a peer data clear discard custom input, seed, source and trajectory', async ({
  page,
  context,
}) => {
  await visible(page, 'case.c.array-traversal');
  await field(page, 'values').fill('8, 9');
  await page.getByTestId('input-seed').fill('CVIZ-07.2-EXIT');
  await prepared(page);
  await completed(page, '17\n');
  await page.evaluate(() => {
    location.hash = '#/visualize/case.c.assignment';
  });
  await expect(field(page, 'x')).toBeVisible();
  await noPriorTrajectory(page);
  await page.evaluate(() => {
    location.hash = '#/visualize/case.c.array-traversal';
  });
  await expect(field(page, 'values')).toBeVisible();
  await expectEditorValue(field(page, 'values'), '8, 9', { not: true });
  await expectEditorValue(page.getByTestId('input-seed'), 'CVIZ-07.2-EXIT', { not: true });
  await field(page, 'values').fill('8, 9');
  await prepared(page);
  await completed(page, '17\n');
  await page.reload();
  await expect(field(page, 'values')).toBeVisible();
  await noPriorTrajectory(page);
  await expectEditorValue(field(page, 'values'), '8, 9', { not: true });
  await field(page, 'values').fill('8, 9');
  await prepared(page);
  await completed(page, '17\n');
  const settings = await context.newPage();
  await settings.goto('/#/settings?panel=data');
  await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await settings
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(settings.getByRole('dialog')).toHaveCount(0);
  await expect(settings.locator('.app-shell')).toHaveAttribute(
    'data-learning-storage-status',
    'ready',
  );
  await noPriorTrajectory(page);
  await expectEditorValue(field(page, 'values'), '8, 9', { not: true });
});

test('public random seed and actual input stay out of network, URL, logs, web storage, IndexedDB and Cache API', async ({
  page,
}, testInfo) => {
  await observe(page);
  const requests: {
    url: string;
    method: string;
    body: string | null;
    headers: Record<string, string>;
  }[] = [];
  const logs: string[] = [];
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
      headers: request.headers(),
    }),
  );
  page.on('console', (message) => logs.push(message.text()));
  await visible(page);
  const marker = 'CVIZ-07.2-PUBLIC-PRIVATE-SEED';
  await page.getByTestId('input-seed').fill(marker);
  await panel(page).getByRole('button', { name: '按种子复现', exact: true }).click();
  const values = { x: Number(await editorValue(field(page, 'x'))) };
  await prepared(page);
  await expect(page.getByTestId('input-seed')).toHaveValue(marker);
  await completed(page, `${values.x + 2}\n`);
  const stored = await page.evaluate(async () => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    writes: window.__inputAudit.writes,
    cookie: document.cookie,
    caches: await caches.keys(),
    databases: await indexedDB.databases(),
  }));
  for (const value of [requests, logs, stored, page.url()]) {
    expect(JSON.stringify(value)).not.toContain(marker);
    expect(JSON.stringify(value)).not.toContain(JSON.stringify(values));
  }
  expect(
    requests.every(
      (request) =>
        request.method === 'GET' &&
        request.body === null &&
        new URL(request.url).origin === new URL(page.url()).origin,
    ),
  ).toBe(true);
  expect(stored.caches).toEqual([]);
  await testInfo.attach('temporary-input-boundary', {
    body: JSON.stringify({
      requestCount: requests.length,
      consoleCount: logs.length,
      storageWrites: stored.writes.length,
      caches: stored.caches,
      databases: stored.databases,
    }),
    contentType: 'application/json',
  });
});
