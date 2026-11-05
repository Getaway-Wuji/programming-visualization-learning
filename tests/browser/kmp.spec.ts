import { expectedSourceLine } from './source-highlight';
import { expectEditorValue } from './editor-value';
import { readFileSync } from 'node:fs';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { observeCaseSetExecution } from './case-set-observation';
import { waitForPhase2Archive } from './phase2-ready';
import { native, clear } from './scheduler-helpers';
import { decodeAdvancedResult, type AdvancedRequest } from '../../web/src/engine/advanced-protocol';
import { AdvancedPlayer } from '../../web/src/engine/advanced-player';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
const spec = JSON.parse(readFileSync('content/algorithms/cpp/kmp-1.0.0.json', 'utf8')).case as {
  sourceFile: string;
  defaults: { text: string; pattern: string };
  samples: { key: string; text: string; pattern: string; expectedStdout: string }[];
};
const root = (p: Page) => p.getByTestId('kmp-workspace');
async function open(p: Page) {
  await p.goto('/#/advanced/algorithms/case.cpp.kmp');
  await waitForPhase2Archive(p);
  await expect(root(p)).toHaveAttribute('data-state', 'idle');
  await expectEditorValue(p.getByRole('combobox', { name: '步骤显示', exact: true }), 'key');
  await p.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
}
async function run(p: Page) {
  await p.getByRole('button', { name: '运行C++ KMP', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-state', 'ready');
}
async function seek(p: Page, n: number) {
  await p.getByRole('slider', { name: '算法执行步骤', exact: true }).fill(String(n));
  await expect(root(p)).toHaveAttribute('data-cursor', String(n));
}
async function packet(p: Page, info: TestInfo) {
  const raw = await p.evaluate(() => {
    const w = window.__verticalObservation.workers.findLast((w) => w.moduleSeen && w.responseOk)!;
    return {
      moduleSeen: w.moduleSeen,
      terminated: w.terminated,
      ...(
        w as unknown as { captureEncoded(): { requestBase64: string; responseBase64: string } }
      ).captureEncoded(),
    };
  });
  expect(raw.moduleSeen).toBe(true);
  expect(raw.terminated).toBe(true);
  const request = JSON.parse(
    Buffer.from(raw.requestBase64, 'base64').toString(),
  ) as AdvancedRequest;
  const result = await decodeAdvancedResult(
    Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
    request,
    engineBuild.wasmSha256,
  );
  await info.attach('actual-cpp-kmp-packet', {
    body: JSON.stringify(raw),
    contentType: 'application/json',
  });
  return { request, result };
}
for (const sample of spec.samples)
  test(`real KMP source/characters/prefix/views/reversal: ${sample.key}`, async ({
    page,
  }, info) => {
    await observeCaseSetExecution(page);
    await open(page);
    await page.getByRole('combobox', { name: 'KMP边界样例', exact: true }).selectOption(sample.key);
    await run(page);
    const { request, result } = await packet(page, info),
      source = readFileSync(spec.sourceFile, 'utf8');
    expect(request.source).toBe(source);
    expect(request.language).toBe('cpp');
    expect(request.input).toEqual({ kind: 'lines', values: [sample.text, sample.pattern] });
    await expect(page.getByLabel('本次执行的只读源码', { exact: true })).toHaveText(source);
    expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 0 });
    const player = new AdvancedPlayer();
    player.accept(result);
    const k = Math.floor(player.snapshot().length / 2);
    player.seek(k);
    const view = player.snapshot(),
      state = view.state!,
      object = (name: string) => state.objects.find((o) => o.alive && o.name === name),
      scalar = (name: string) => {
        const value = object(name)?.cells[0]?.value;
        return typeof value === 'number' ? value : null;
      },
      prefix = object('prefix'),
      expected = {
        scalars: Object.fromEntries(
          [
            'phase',
            'n',
            'm',
            'built',
            'buildIndex',
            'border',
            'textIndex',
            'matched',
            'answer',
          ].map((name) => [name, scalar(name)]),
        ),
        strings: ['text', 'pattern'].map((name) => {
          const o = object(name),
            value = o?.cells[0]?.value;
          return { name, present: !!o, value: typeof value === 'string' ? value : null };
        }),
        prefix: {
          present: !!prefix,
          values: Array.from(
            { length: Math.min(scalar('m') ?? 0, prefix?.length ?? 0) },
            (_, i) => prefix?.cells.find((c) => c.byteOffset === i * 4)?.value ?? null,
          ),
        },
      };
    await seek(page, k);
    for (const s of expected.strings) {
      const row = page.locator(`[data-testid="kmp-string"][data-name="${s.name}"]`);
      await expect(row).toHaveAttribute('data-present', String(s.present));
      await expect(row).toHaveAttribute('data-value', s.value ?? '');
      expect(await row.locator('li strong').allTextContents()).toEqual(
        Array.from(s.value ?? '', (c) => (c === ' ' ? '␠' : c)),
      );
    }
    await expect(page.getByTestId('kmp-prefix')).toHaveAttribute(
      'data-present',
      String(expected.prefix.present),
    );
    expect(await page.getByTestId('kmp-prefix').locator('li strong').allTextContents()).toEqual(
      expected.prefix.values.map((v) => (v === null ? '未初始化' : String(v))),
    );
    for (const [name, value] of Object.entries(expected.scalars))
      await expect(page.locator(`[data-testid="kmp-scalar"][data-name="${name}"]`)).toHaveText(
        value === null ? '尚未声明或已结束' : String(value),
      );
    for (const [name, value] of Object.entries(state.counters))
      await expect(page.locator(`[data-counter="${name}"]`)).toHaveText(String(value));
    if (expectedSourceLine(request.source, view.byteRange))
      await expect(page.getByTestId('memory-source-highlight')).toHaveAttribute(
        'data-byte-start',
        String(view.byteRange!.start),
      );
    else await expect(page.getByTestId('memory-source-highlight')).toHaveCount(0);
    await page.getByRole('combobox', { name: '算法观察视图', exact: true }).selectOption('memory');
    await expect(page.getByLabel('内存视图', { exact: true })).toContainText(
      state.allocator.liveBytes + ' B',
    );
    await expect(root(page)).toHaveAttribute('data-cursor', String(k));
    await page.getByRole('combobox', { name: '算法观察视图', exact: true }).selectOption('stack');
    await expect(page.getByLabel('调用栈视图', { exact: true })).toContainText(
      '当前 ' + state.frames.length + ' 个活动帧',
    );
    await page.getByRole('combobox', { name: '算法观察视图', exact: true }).selectOption('basic');
    await page.getByRole('button', { name: '前进', exact: true }).click();
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect(root(page)).toHaveAttribute('data-cursor', String(k));
    await seek(page, view.length);
    await expect(page.getByTestId('custom-output')).toHaveText(sample.expectedStdout);
    await expect(page.getByTestId('algorithm-terminal')).toContainText('completed · 返回值0');
    await seek(page, 0);
    await expect(page.getByTestId('custom-output')).toHaveText('（尚无输出）');
  });
test('non-preset text and pattern stay exact, keep source constant and revoke the previous trace', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await open(page);
  await run(page);
  const first = await packet(page, info);
  await page.getByTestId('kmp-text-input').fill('zzabababacxy');
  await expect(root(page)).toHaveAttribute('data-state', 'idle');
  await expect(root(page)).toHaveAttribute('data-length', '0');
  await page.getByTestId('kmp-pattern-input').fill('ababac');
  await run(page);
  const next = await packet(page, info);
  expect(next.request.source).toBe(first.request.source);
  expect(next.request.runId).not.toBe(first.request.runId);
  expect(next.request.input).toEqual({ kind: 'lines', values: ['zzabababacxy', 'ababac'] });
  await page.getByRole('button', { name: '查看末步', exact: true }).click();
  await expect(page.getByTestId('custom-output')).toHaveText('4\n');
});
test('invalid and oversized drafts never execute; two explicit empty rows execute as two lines', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await open(page);
  for (const [field, value] of [
    ['text', 'é'],
    ['pattern', 'a'.repeat(31)],
  ] as const) {
    await page.getByTestId('kmp-' + field + '-input').fill(value);
    await expect(page.getByRole('button', { name: '运行C++ KMP', exact: true })).toBeDisabled();
    await expect(page.locator('#kmp-input-help')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#kmp-input-help')).toBeVisible();
    await page.getByTestId('kmp-' + field + '-input').fill('');
  }
  expect(await page.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
  await page.getByTestId('kmp-text-input').fill('');
  await page.getByTestId('kmp-pattern-input').fill('');
  await run(page);
  expect((await packet(page, info)).request.input).toEqual({ kind: 'lines', values: ['', ''] });
});
test('course and case directory open the precise KMP workspace, reading uses original review links', async ({
  page,
}) => {
  for (const url of ['/#/advanced', '/#/cases']) {
    await page.goto(url);
    await waitForPhase2Archive(page);
    if (url.endsWith('/cases')) await page.getByText('基础语法与更多案例', { exact: true }).click();
    const link = page
      .getByTestId('kmp-catalog')
      .getByRole('link', { name: 'KMP字符串匹配', exact: true });
    await link.focus();
    await link.press('Enter');
    await expect(root(page)).toHaveAttribute('data-case', 'case.cpp.kmp');
    await root(page).getByText('算法讲解、复杂度与基础复习', { exact: true }).click();
    await expect(root(page).getByRole('link', { name: '错题与陌生点', exact: true })).toBeVisible();
  }
  await page.goto('/#/advanced/algorithms/case.cpp.not-kmp');
  await expect(
    page.getByRole('heading', { name: '找不到这个进阶算法', exact: true }),
  ).toBeVisible();
});
test('missing advanced WASM fails honestly and the next explicit run recovers', async ({
  page,
}) => {
  await page.route(/c_viz_advanced_bg[^/]*\.wasm/, (route) => route.abort());
  await open(page);
  await page.getByRole('button', { name: '运行C++ KMP', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-state', 'failed');
  await expect(root(page)).toHaveAttribute('data-length', '0');
  await page.unroute(/c_viz_advanced_bg[^/]*\.wasm/);
  await run(page);
});
test('cross-tab clear revokes a genuine KMP result and the next run is available', async ({
  page,
  context,
}) => {
  await open(page);
  await run(page);
  const other = await context.newPage();
  await clear(other);
  await expect(root(page)).toHaveAttribute('data-state', 'idle');
  await expect(root(page)).toHaveAttribute('data-length', '0');
  await other.close();
  await run(page);
});
test('KMP reads and playback do not mint facts, rewards or persist private text, pattern or trace', async ({
  page,
}, info) => {
  await open(page);
  const before = await native(page);
  await page.getByTestId('kmp-text-input').fill('PRIVATE_TEXT_NEVER_SAVE');
  await page.getByTestId('kmp-pattern-input').fill('TEXT');
  await run(page);
  await page.getByRole('button', { name: '查看末步', exact: true }).click();
  await page.getByRole('button', { name: '回到初态', exact: true }).click();
  const after = await native(page);
  expect(after).toEqual(before);
  expect(JSON.stringify(after)).not.toContain('PRIVATE_TEXT_NEVER_SAVE');
  await page.reload();
  await waitForPhase2Archive(page);
  await expectEditorValue(page.getByTestId('kmp-text-input'), spec.defaults.text);
  await expectEditorValue(page.getByTestId('kmp-pattern-input'), spec.defaults.pattern);
  await info.attach('no-persistent-learning-or-input', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
});
for (const width of [1440, 768, 390])
  test(`maximum KMP characters/prefix layout and keyboard at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page
      .getByRole('combobox', { name: 'KMP边界样例', exact: true })
      .selectOption('maximum-fallback-miss');
    await run(page);
    const k = Math.floor(Number(await root(page).getAttribute('data-length')) * 0.7);
    await seek(page, k);
    await page.getByLabel('算法执行观察', { exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(root(page)).toHaveAttribute('data-cursor', String(k + 1));
    await page.keyboard.press('ArrowLeft');
    await expect(root(page)).toHaveAttribute('data-cursor', String(k));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.screenshot({ path: info.outputPath(`kmp-${width}.png`), fullPage: true });
  });

test('controlled native Worker cancellation discards its genuinely late packet and next run recovers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker,
      descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage')!;
    Object.assign(window, {
      kmpHold: true,
      kmpWaiting: false,
      kmpRelease: () => {},
    });
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(this, 'onmessage', {
          get: () => descriptor.get!.call(this),
          set: (callback: ((e: MessageEvent) => unknown) | null) =>
            descriptor.set!.call(
              this,
              callback &&
                ((event: MessageEvent) => {
                  const w = window as unknown as {
                    kmpHold: boolean;
                    kmpWaiting: boolean;
                    kmpRelease: () => void;
                  };
                  if (w.kmpHold && event.data?.ok) {
                    w.kmpWaiting = true;
                    w.kmpRelease = () => callback.call(this, event);
                  } else callback.call(this, event);
                }),
            ),
        });
      }
    };
  });
  await open(page);
  await page.getByRole('button', { name: '运行C++ KMP', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { kmpWaiting: boolean }).kmpWaiting))
    .toBe(true);
  await page.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-state', 'failed');
  await page.evaluate(() => {
    const w = window as unknown as { kmpHold: boolean; kmpRelease: () => void };
    w.kmpRelease();
    w.kmpHold = false;
  });
  await expect(root(page)).toHaveAttribute('data-length', '0');
  await run(page);
});
