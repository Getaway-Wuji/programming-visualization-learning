import { waitForPhase2Archive } from './phase2-ready';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { observeCaseSetExecution } from './case-set-observation';
import { native, clear } from './achievement-helpers';
import {
  decodeAlgorithmResult,
  type AlgorithmRequest,
  type AlgorithmResult,
} from '../../web/src/engine/algorithm-protocol';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
import type { SortCase } from '../../web/src/algorithms/content';
import { slotValue } from '../../web/src/algorithms/presentation';

// Read the published files independently; Playwright does not use Vite's raw loader.
const sortCases = JSON.parse(
  readFileSync('content/algorithms/cpp/iterative-sorts-1.0.0.json', 'utf8'),
).cases as SortCase[];
function expectedSource(spec: SortCase, length: number) {
  return readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', String(length));
}

const folder = `.artifacts/16.4/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
test.beforeAll(() => mkdir(folder, { recursive: true }));
const workspace = (p: Page) => p.getByTestId('sort-workspace');
async function ready(p: Page, spec = sortCases[0]) {
  await p.goto(`/#/algorithms/${spec.id}`);
  await waitForPhase2Archive(p);
  await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  // Raw cursor assertions explicitly use the retained full-detail mode.
  await p.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
}
async function run(p: Page, values: number[]) {
  await p.getByTestId('sort-input').fill(values.length ? values.join(' ') : '[]');
  await p.getByRole('button', { name: '运行C++案例', exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
}
async function captured(p: Page, label: string) {
  const raw = await p.evaluate(() => {
    const record = window.__verticalObservation.workers.findLast(
      (w) => w.moduleSeen && w.responseOk,
    );
    if (!record) throw Error('A real production algorithm Worker is required');
    return {
      moduleSeen: record.moduleSeen,
      terminated: record.terminated,
      ...(
        record as unknown as {
          captureEncoded: () => { requestBase64: string; responseBase64: string };
        }
      ).captureEncoded(),
    };
  });
  expect(raw.moduleSeen).toBe(true);
  expect(raw.terminated).toBe(true);
  await writeFile(`${folder}/${label}-worker.json.gz`, gzipSync(JSON.stringify(raw)), {
    flag: 'wx',
  });
  const request = JSON.parse(
    Buffer.from(raw.requestBase64, 'base64').toString(),
  ) as AlgorithmRequest;
  const result = await decodeAlgorithmResult(
    Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
    request,
    engineBuild.wasmSha256,
  );
  return { request, result };
}
async function seek(p: Page, cursor: number) {
  await p.getByRole('slider', { name: 'C++排序执行步骤', exact: true }).fill(String(cursor));
  await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
}
async function sameState(p: Page, result: AlgorithmResult, cursor: number, inputLength: number) {
  const player = new AlgorithmPlayer();
  player.accept(result);
  player.seek(cursor);
  const view = player.snapshot(),
    state = view.state!;
  for (const [key, value] of Object.entries(state.counters))
    await expect(p.getByTestId(`sort-counter-${key}`)).toHaveText(String(value));
  await expect(p.getByTestId('sort-output')).toHaveText(state.output || '（无输出）');
  for (const name of ['values', 'counts']) {
    const object = state.objects.find((object) => object.name === name),
      panel = p
        .getByTestId('sort-array')
        .filter({ has: p.locator('h3', { hasText: name === 'values' ? '原数组' : '计数桶' }) });
    if (!object) {
      await expect(panel).toHaveCount(0);
      continue;
    }
    const length = name === 'values' ? inputLength : 41;
    await expect(panel).toHaveAttribute('data-object-id', object.id);
    await expect(panel.getByTestId('sort-cell')).toHaveCount(length);
    const actual = await panel
      .getByTestId('sort-cell')
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-value')));
    expect(actual).toEqual(
      Array.from({ length }, (_, index) => String(slotValue(object, index) ?? 'uninitialized')),
    );
  }
  for (const object of state.objects.filter((object) => object.kind === 'int'))
    await expect(
      p
        .getByTestId('sort-variable')
        .filter({ has: p.locator('small', { hasText: `${object.id} · ${object.scopeId}` }) })
        .locator('b'),
    ).toHaveText(String(slotValue(object, 0) ?? '未初始化'));
  return state;
}
for (const spec of sortCases) {
  const samples = [
    { id: 'default', values: spec.defaultInput },
    { id: 'empty', values: [] },
    { id: 'single', values: [spec.min] },
    { id: 'duplicates', values: [3, -2, 3, 0, -2, 3] },
    { id: 'domain-ends', values: [spec.max, spec.min, 0, spec.max, spec.min] },
    { id: 'capacity-reverse', values: Array.from({ length: 30 }, (_, i) => 15 - i) },
  ];
  for (const sample of samples)
    test(`actual ${spec.title} ${sample.id}: source, sorted output, deltas and reverse state`, async ({
      page: p,
    }) => {
      await observeCaseSetExecution(p);
      await ready(p, spec);
      const before = await native(p);
      await run(p, sample.values);
      const { request, result } = await captured(p, `${spec.id}-${sample.id}`),
        preparedSource = expectedSource(spec, sample.values.length);
      expect(request.language).toBe('cpp');
      expect(request.engineId).toBe('engine.rust.p1');
      expect(request.source).toBe(preparedSource);
      expect(request.input).toEqual(sample.values);
      expect(result.engine.buildId).toBe(engineBuild.wasmSha256);
      expect(result.terminal.status).toBe('completed');
      expect(result.trace!.completeness).toBe('complete');
      await expect(p.getByTestId('sort-source')).toHaveText(request.source);
      expect(await p.getByLabel('可复制的完整C++源码', { exact: true }).inputValue()).toBe(
        request.source,
      );
      const length = result.trace!.steps.length,
        point = Math.min(length - 1, Math.max(1, Math.floor(length / 2)));
      await sameState(p, result, 0, sample.values.length);
      await seek(p, point);
      const saved = await sameState(p, result, point, sample.values.length);
      const rawRange = result.nodeMap.find(
        (node) => node.nodeId === result.trace!.steps[point - 1].nodeId,
      )!.byteRange;
      const prefix = new TextDecoder().decode(
        new TextEncoder().encode(request.source).slice(0, rawRange.start),
      );
      const phaseId = [...prefix.matchAll(/\/\/ @phase ([a-z]+)/g)].at(-1)![1];
      await expect(p.getByTestId('sort-explanation')).toContainText(
        spec.phases.find((phase) => phase.id === phaseId)!.title,
      );
      if (rawRange) {
        await expect(p.getByTestId('sort-source-highlight')).toHaveAttribute(
          'data-byte-start',
          String(rawRange.start),
        );
        await expect(p.getByTestId('sort-source-highlight')).toHaveAttribute(
          'data-byte-end',
          String(rawRange.end),
        );
      }
      await p.getByRole('button', { name: '前进', exact: true }).click();
      await p.getByRole('button', { name: '后退', exact: true }).click();
      expect(await sameState(p, result, point, sample.values.length)).toEqual(saved);
      const firstOutput = result.trace!.steps.findIndex((step) =>
        step.changes.some((change) => change.op === 'output'),
      );
      await seek(p, firstOutput);
      const outputState = await sameState(p, result, firstOutput, sample.values.length),
        array = outputState.objects.find((object) => object.name === 'values')!;
      expect(Array.from({ length: sample.values.length }, (_, i) => slotValue(array, i))).toEqual(
        [...sample.values].sort((a, b) => a - b),
      );
      await p.getByRole('button', { name: '查看末步', exact: true }).click();
      await sameState(p, result, length, sample.values.length);
      await expect(p.getByTestId('sort-terminal')).toContainText('正常结束');
      await expect(p.getByTestId('sort-output')).toHaveText(
        [...sample.values]
          .sort((a, b) => a - b)
          .map((value) => `${value} `)
          .join('') + '\n',
      );
      await p.getByRole('button', { name: '后退', exact: true }).click();
      await sameState(p, result, length - 1, sample.values.length);
      await p.getByRole('button', { name: '回到初态', exact: true }).click();
      await sameState(p, result, 0, sample.values.length);
      expect(await native(p)).toEqual(before);
      await writeFile(
        `${folder}/${spec.id}-${sample.id}-summary.json`,
        JSON.stringify(
          {
            caseId: spec.id,
            programId: spec.programId,
            version: spec.version,
            source: request.source,
            input: request.input,
            identity: result.identity,
            engine: result.engine,
            steps: length,
            fuel: result.stats.fuelUsed,
            terminal: result.terminal,
            counters: outputState.counters,
            expected: [...sample.values].sort((a, b) => a - b),
          },
          null,
          2,
        ),
        { flag: 'wx' },
      );
    });
  test(`${spec.title} rejects malformed, oversized and out-of-domain input before creating a Worker`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await ready(p, spec);
    for (const text of [
      '',
      '1e2',
      '1.5',
      String(spec.max + 1),
      String(spec.min - 1),
      Array(31).fill('1').join(' '),
    ]) {
      await p.getByTestId('sort-input').fill(text);
      await expect(p.getByRole('button', { name: '运行C++案例', exact: true })).toBeDisabled();
      await expect(p.getByRole('alert')).toContainText('十进制整数');
      expect(await p.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
    }
    await run(p, [spec.max, spec.min]);
    await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
    await p.getByTestId('sort-input').fill('bad');
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    await expect(p.getByRole('slider', { name: 'C++排序执行步骤', exact: true })).toBeDisabled();
    await expect(p.getByTestId('sort-source')).toHaveText('');
  });
}

async function holdReply(p: Page) {
  await p.addInitScript(() => {
    const Native = window.Worker,
      descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage')!;
    const control = { armed: false, waiting: false, release: () => {} };
    Object.assign(window, { sortReplyHold: control });
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(this, 'onmessage', {
          get: () => descriptor.get!.call(this),
          set: (callback: ((event: MessageEvent) => unknown) | null) =>
            descriptor.set!.call(
              this,
              callback &&
                ((event: MessageEvent) => {
                  if (control.armed && event.data?.ok) {
                    control.armed = false;
                    control.waiting = true;
                    control.release = () => {
                      control.waiting = false;
                      callback.call(this, event);
                    };
                  } else callback.call(this, event);
                }),
            ),
        });
      }
    };
  });
}
type Hold = { armed: boolean; waiting: boolean; release: () => void };
async function arm(p: Page) {
  await p.evaluate(() => {
    (window as unknown as { sortReplyHold: Hold }).sortReplyHold.armed = true;
  });
}
async function held(p: Page) {
  await expect
    .poll(() =>
      p.evaluate(() => (window as unknown as { sortReplyHold: Hold }).sortReplyHold.waiting),
    )
    .toBe(true);
}
async function release(p: Page) {
  await p.evaluate(() => (window as unknown as { sortReplyHold: Hold }).sortReplyHold.release());
}
for (const action of ['edit', 'cancel', 'clear', 'leave'] as const)
  test(`real held C++ result cannot revive after ${action}`, async ({ page: p, context }) => {
    await holdReply(p);
    await observeCaseSetExecution(p);
    await ready(p);
    const clearPeer = action === 'clear' ? await context.newPage() : null;
    if (clearPeer) {
      await clearPeer.goto('/#/settings?panel=data');
      await expect(clearPeer.locator('.app-shell')).toHaveAttribute(
        'data-learning-storage-status',
        'ready',
      );
      await p.bringToFront();
    }
    await arm(p);
    await p.getByRole('button', { name: '运行C++案例', exact: true }).click();
    await held(p);
    if (action === 'edit') await p.getByTestId('sort-input').fill('4 1');
    if (action === 'cancel') await p.getByRole('button', { name: '取消运行', exact: true }).click();
    if (action === 'leave') await p.goto('/#/cases');
    if (clearPeer) {
      await clear(clearPeer);
      // Keep the peer alive until the real clear/epoch notification has reached
      // this workspace. Closing immediately can abort the peer's pending clear.
      await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
      await expect(workspace(p)).toHaveAttribute('data-run-id', '');
      await clearPeer.close();
    }
    await release(p);
    if (action === 'leave') await ready(p);
    else if (action === 'cancel') {
      await expect(workspace(p)).toHaveAttribute('data-state', 'failed');
      await expect(p.getByTestId('sort-error')).toContainText('E_CANCELLED');
    } else await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    await expect(p.getByTestId('sort-output')).toHaveCount(0);
    await run(p, [2, 1]);
    const { request, result } = await captured(p, `retry-${action}`);
    expect(request.input).toEqual([2, 1]);
    expect(result.terminal.status).toBe('completed');
  });
test('native Worker load failure has no stale picture and an explicit new run recovers', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  const worker = /\/algorithm-worker-[^/]+\.js$/;
  await p.route(worker, (route) => route.abort());
  await p.getByRole('button', { name: '运行C++案例', exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'failed');
  await expect(p.getByTestId('sort-output')).toHaveCount(0);
  await p.unroute(worker);
  await run(p, [1, -1]);
  const { result } = await captured(p, 'worker-recovery');
  expect(result.terminal.status).toBe('completed');
});
test('one live player supports six speeds, keyboard, source focus and hidden-page pause without new runs', async ({
  page: p,
  context,
}) => {
  await observeCaseSetExecution(p);
  await ready(p, sortCases[1]);
  await run(p, [3, 1, 2]);
  const { result } = await captured(p, 'controls');
  for (const rate of ['0.25', '0.5', '1', '1.5', '2', '4'])
    await p.getByRole('combobox', { name: 'C++排序播放速度', exact: true }).selectOption(rate);
  const stage = p.getByRole('region', { name: '排序执行观察', exact: true });
  await stage.focus();
  await p.keyboard.press('ArrowRight');
  await expect(workspace(p)).toHaveAttribute('data-cursor', '1');
  await p.keyboard.press('ArrowLeft');
  await expect(workspace(p)).toHaveAttribute('data-cursor', '0');
  const time = Date.now();
  await p.clock.install({ time });
  await p.clock.pauseAt(time + 1000);
  await stage.focus();
  await p.keyboard.press('Space');
  await p.clock.runFor(250);
  await expect(workspace(p)).toHaveAttribute('data-cursor', '2');
  await p.keyboard.press('Space');
  await p.clock.runFor(1000);
  await expect(workspace(p)).toHaveAttribute('data-cursor', '2');
  await p.keyboard.press('Space');
  const peer = await context.newPage();
  await peer.goto('/#/cases');
  await peer.bringToFront();
  const nativeHidden = await p.evaluate(() => document.visibilityState === 'hidden');
  if (!nativeHidden)
    await p.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  await p.clock.runFor(1000);
  await p.bringToFront();
  await expect(workspace(p)).toHaveAttribute('data-cursor', '2');
  await peer.close();
  if (!nativeHidden)
    await p.evaluate(() => {
      Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
    });
  await p.clock.runFor(1000);
  await expect(workspace(p)).toHaveAttribute('data-cursor', '2');
  await writeFile(
    `${folder}/visibility-evidence.json`,
    JSON.stringify({
      evidence: nativeHidden ? 'native-background-tab' : 'isolated-DOM-visibility-event',
      noPlayerStateInjection: true,
    }),
    { flag: 'wx' },
  );
  await sameState(p, result, 2, 3);
  expect(
    await p.evaluate(() => window.__verticalObservation.workers.filter((w) => w.moduleSeen).length),
  ).toBe(1);
});
test('catalog exposes exactly three new C++ cases and retains all seven original C routes', async ({
  page: p,
}) => {
  await ready(p);
  await p.goto('/#/cases');
  await expect(p.getByTestId('cpp-sort-catalog').getByRole('link')).toHaveCount(3);
  await expect(p.locator('main a[href^="#/visualize/"]')).toHaveCount(7);
  await p.getByRole('link', { name: '查看计数排序工作区 →', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: '计数排序', exact: true })).toBeVisible();
  await expect(
    p
      .getByRole('navigation', { name: '主导航' })
      .getByRole('link', { name: '算法与演示', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});
test('switching among actual C++, original C, memory and paired C engines preserves their boundaries without learning writes', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  const before = await native(p);
  await run(p, [3, 1, 2]);
  await p.goto('/#/visualize/case.c.assignment');
  await p.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(p.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  await expect(p.getByRole('button', { name: '下载状态文件（JSON）', exact: true })).toBeEnabled();
  await p.goto('/#/memory?example=nodes');
  await p.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(p.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  await p.goto('/#/compare');
  await p.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(p.getByTestId('comparison-page')).toHaveAttribute('data-phase', 'ready');
  await p.getByRole('button', { name: '运行两种算法', exact: true }).click();
  await expect(p.getByTestId('comparison-page')).toHaveAttribute('data-phase', 'settled');
  await ready(p, sortCases[2]);
  await expect(workspace(p)).toHaveAttribute('data-run-id', '');
  await run(p, [20, -20, 0]);
  const { result } = await captured(p, 'engine-switch-return');
  expect(result.language).toBe('cpp');
  const engines = await p.evaluate(() =>
    window.__verticalObservation.workers
      .filter((w) => w.moduleSeen && w.responseOk)
      .map((w) => {
        const bytes = (
          w as unknown as { captureEncoded: () => { responseBase64: string } }
        ).captureEncoded().responseBase64;
        const raw = JSON.parse(
          new TextDecoder().decode(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))),
        );
        return raw.engine?.id ?? raw.engineRef?.id;
      }),
  );
  expect(engines).toContain('engine.rust.p1');
  expect(engines).toContain('engine.rust.memory');
  expect(
    engines.some(
      (id) => typeof id === 'string' && id !== 'engine.rust.p1' && id !== 'engine.rust.memory',
    ),
  ).toBe(true);
  expect(await native(p)).toEqual(before);
  await writeFile(
    `${folder}/engine-switch-summary.json`,
    JSON.stringify({ engines, storesUnchanged: true }),
    { flag: 'wx' },
  );
});
for (const width of [1440, 768, 390])
  test(`minimal ${width}px keeps actual C++ values, source and controls usable`, async ({
    page: p,
  }) => {
    await p.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await observeCaseSetExecution(p);
    await ready(p, sortCases[2]);
    await run(p, [20, -20, 3, 3, 0, -1, 20]);
    const { result } = await captured(p, `visual-${width}`);
    const cursor =
      result.trace!.steps.find(
        (step) =>
          step.kind === 'value.write' &&
          step.changes.some((change) => change.op === 'cell' && change.after === 2),
      )?.seq ?? 50;
    await seek(p, cursor);
    await sameState(p, result, cursor, 7);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await p.screenshot({ path: `${folder}/counting-${width}.png`, fullPage: true });
    if (width < 1000) await p.getByRole('tab', { name: '实际C++源码', exact: true }).click();
    await expect(p.getByTestId('sort-source')).toBeVisible();
    await p.screenshot({ path: `${folder}/source-${width}.png`, fullPage: true });
  });
