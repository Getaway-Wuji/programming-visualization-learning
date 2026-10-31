import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { observeCaseSetExecution } from './case-set-observation';
import { native, clear } from './achievement-helpers';
import {
  decodeAlgorithmResult,
  type AlgorithmRequest,
} from '../../web/src/engine/algorithm-protocol';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
const specs = JSON.parse(readFileSync('content/algorithms/cpp/recursive-sorts-1.0.0.json', 'utf8'))
  .cases as { id: string; sourceFile: string }[];
const folder = `.artifacts/16.5/pair-browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
test.beforeAll(() => mkdir(folder, { recursive: true }));
const root = (p: Page) => p.getByTestId('recursive-comparison');
type Probe = {
  posts: { remainingMs: number; at: number }[];
  active: number;
  max: number;
  hold: number;
  waiting: boolean;
  release: () => void;
};
async function observe(p: Page) {
  await p.addInitScript(() => {
    const Native = window.Worker,
      descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage')!;
    const probe: Probe = {
      posts: [],
      active: 0,
      max: 0,
      hold: 0,
      waiting: false,
      release: () => {},
    };
    Object.assign(window, { pairProbe: probe });
    window.Worker = class extends Native {
      private algorithm = false;
      private counted = false;
      private ordinal = 0;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(this, 'onmessage', {
          get: () => descriptor.get!.call(this),
          set: (callback: ((event: MessageEvent) => unknown) | null) =>
            descriptor.set!.call(
              this,
              callback &&
                ((event: MessageEvent) => {
                  if (this.algorithm && probe.hold === this.ordinal && event.data?.ok) {
                    probe.waiting = true;
                    probe.release = () => {
                      probe.waiting = false;
                      callback.call(this, event);
                    };
                  } else callback.call(this, event);
                }),
            ),
        });
      }
      override postMessage(
        message: unknown,
        options: Transferable[] | StructuredSerializeOptions = [],
      ) {
        const data = message as { module?: unknown; remainingMs: number };
        if (data?.module instanceof WebAssembly.Module) {
          this.algorithm = true;
          this.counted = true;
          probe.active++;
          probe.max = Math.max(probe.max, probe.active);
          probe.posts.push({ remainingMs: data.remainingMs, at: performance.now() });
          this.ordinal = probe.posts.length;
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      override terminate() {
        if (this.counted) {
          probe.active--;
          this.counted = false;
        }
        super.terminate();
      }
    };
  });
  await observeCaseSetExecution(p);
}
async function ready(p: Page) {
  await p.goto('/#/compare?pair=cpp-recursive');
  await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
  await expect(root(p)).toHaveAttribute('data-phase', 'idle');
}
async function prepare(p: Page, values: number[]) {
  await p.getByTestId('pair-input').fill(values.length ? values.join(' ') : '[]');
  await p.getByRole('button', { name: '应用共同输入', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-phase', 'ready');
}
async function run(p: Page, values: number[]) {
  await prepare(p, values);
  await p.getByRole('button', { name: '运行两份C++', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-phase', 'settled');
}
async function capture(p: Page, label: string) {
  const raws = await p.evaluate(() =>
    window.__verticalObservation.workers
      .filter((w) => w.moduleSeen && w.responseOk)
      .map((w) => ({
        terminated: w.terminated,
        ...(
          w as unknown as {
            captureEncoded: () => { requestBase64: string; responseBase64: string };
          }
        ).captureEncoded(),
      })),
  );
  const decoded = [];
  for (const [i, raw] of raws.entries()) {
    await writeFile(`${folder}/${label}-${i}.json.gz`, gzipSync(JSON.stringify(raw)), {
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
    decoded.push({ request, result });
    expect(raw.terminated).toBe(true);
  }
  return decoded;
}
async function seek(p: Page, cursor: number) {
  await p.getByRole('slider', { name: 'C++对比统一步骤', exact: true }).fill(String(cursor));
  await expect(root(p)).toHaveAttribute('data-cursor', String(cursor));
}
for (const [label, values] of Object.entries({
  default: [7, -3, 0, 5, -3, 2, 9],
  empty: [],
  single: [-999],
  duplicates: [3, -2, 3, 0, -2, 3],
  ends: [999, -999, 0, 999, -999],
  sorted30: Array.from({ length: 30 }, (_, i) => i - 15),
  reverse30: Array.from({ length: 30 }, (_, i) => 15 - i),
  equal30: Array(30).fill(999) as number[],
})) {
  test(`real C++ pair ${label}: independent source/input, single slot, shared budget and reversible synchronized counters`, async ({
    page: p,
  }) => {
    await observe(p);
    await ready(p);
    const before = await native(p);
    await run(p, values);
    const runs = await capture(p, label);
    expect(runs).toHaveLength(2);
    expect(runs[0].request.runId).not.toBe(runs[1].request.runId);
    for (const [i, { request, result }] of runs.entries()) {
      expect(request.language).toBe('cpp');
      expect(request.input).toEqual(values);
      expect(request.source).toBe(
        readFileSync(specs[i].sourceFile, 'utf8').replace('{{n}}', String(values.length)),
      );
      expect(result.terminal.status).toBe('completed');
      expect(result.trace!.completeness).toBe('complete');
      await expect(p.getByTestId(`pair-lane-${i}`)).toHaveAttribute('data-phase', 'accepted');
      const details = p.getByTestId(`pair-lane-${i}`).locator('details.sort-method');
      await details.locator('summary').first().click();
      await expect(details.getByTestId('pair-source')).toHaveText(request.source);
      expect(
        await details.getByLabel('本侧可复制的完整C++源码', { exact: true }).inputValue(),
      ).toBe(request.source);
    }
    const probe = await p.evaluate(() => {
      const q = (window as unknown as { pairProbe: Probe }).pairProbe;
      return { posts: q.posts, max: q.max, active: q.active };
    });
    expect(probe.posts).toHaveLength(2);
    expect(probe.max).toBe(1);
    expect(probe.active).toBe(0);
    expect(probe.posts[1].remainingMs).toBeLessThan(probe.posts[0].remainingMs);
    const deadlineA = probe.posts[0].at + probe.posts[0].remainingMs,
      deadlineB = probe.posts[1].at + probe.posts[1].remainingMs;
    expect(Math.abs(deadlineA - deadlineB)).toBeLessThan(5);
    const lengths = runs.map((r) => r.result.trace!.steps.length),
      length = Math.max(...lengths);
    for (const cursor of [
      Math.floor(Math.min(...lengths) / 2),
      Math.min(...lengths) + 1,
      length,
      0,
    ]) {
      if (cursor > length) continue;
      await seek(p, cursor);
      for (const [i, { result, request }] of runs.entries()) {
        const player = new AlgorithmPlayer();
        player.accept(result);
        player.seek(Math.min(cursor, lengths[i]));
        const view = player.snapshot(),
          lane = p.getByTestId(`pair-lane-${i}`);
        await expect(lane).toHaveAttribute('data-cursor', String(view.cursor));
        for (const [key, value] of Object.entries(view.state!.counters))
          await expect(lane.getByTestId(`sort-counter-${key}`)).toHaveText(String(value));
        await expect(lane.getByTestId('sort-output')).toHaveText(
          view.state!.output || '（无输出）',
        );
        await expect(lane.getByTestId('sort-stack')).toHaveAttribute(
          'data-active-frame',
          view.state!.control.activeFrameId ?? '',
        );
        if (view.byteRange) {
          const mark = lane.getByTestId('pair-source-highlight');
          await expect(mark).toHaveAttribute('data-byte-start', String(view.byteRange.start));
          expect(await mark.textContent()).toBe(
            new TextDecoder().decode(
              new TextEncoder()
                .encode(request.source)
                .slice(view.byteRange.start, view.byteRange.end),
            ),
          );
        }
        if (cursor === length)
          await expect(lane.getByTestId('sort-output')).toHaveText(
            [...values]
              .sort((a, b) => a - b)
              .map((v) => `${v} `)
              .join('') + '\n',
          );
      }
    }
    expect(await native(p)).toEqual(before);
    await writeFile(
      `${folder}/${label}-summary.json`,
      JSON.stringify({ input: values, lengths, probe, storesUnchanged: true }, null, 2),
      { flag: 'wx' },
    );
  });
}
for (const action of ['edit', 'cancel', 'clear', 'family', 'leave', 'deadline'] as const)
  test(`real second-side reply held across ${action} cannot restore an invalid group`, async ({
    page: p,
    context,
  }) => {
    await observe(p);
    await ready(p);
    const peer = action === 'clear' ? await context.newPage() : null;
    if (peer) {
      await peer.goto('/#/settings?panel=data');
      await expect(peer.locator('.app-shell')).toHaveAttribute(
        'data-learning-storage-status',
        'ready',
      );
      await p.bringToFront();
    }
    await prepare(p, [3, 1, 2]);
    await p.evaluate(() => {
      (window as unknown as { pairProbe: Probe }).pairProbe.hold = 2;
    });
    await p.getByRole('button', { name: '运行两份C++', exact: true }).click();
    await expect
      .poll(() => p.evaluate(() => (window as unknown as { pairProbe: Probe }).pairProbe.waiting))
      .toBe(true);
    await expect(p.getByTestId('pair-lane-0')).toHaveAttribute('data-phase', 'accepted');
    if (action === 'edit') await p.getByTestId('pair-input').fill('5 1');
    if (action === 'cancel')
      await p.getByRole('button', { name: '取消本组运行', exact: true }).click();
    if (peer) {
      await clear(peer);
      await expect(root(p)).toHaveAttribute('data-phase', 'idle');
      await peer.close();
    }
    if (action === 'family')
      await p.getByRole('link', { name: 'C · 冒泡与选择', exact: true }).click();
    if (action === 'leave') await p.goto('/#/cases');
    if (action === 'deadline') {
      await expect(root(p)).toHaveAttribute('data-phase', 'settled');
      await expect(p.getByTestId('pair-lane-1')).toContainText('E_DEADLINE');
    }
    await p.evaluate(() => (window as unknown as { pairProbe: Probe }).pairProbe.release());
    if (action === 'family' || action === 'leave') await ready(p);
    else if (action === 'cancel' || action === 'deadline') {
      await expect(p.getByTestId('pair-lane-0')).toHaveAttribute('data-phase', 'accepted');
      await expect(p.getByTestId('pair-lane-1')).toHaveAttribute(
        'data-phase',
        action === 'cancel' ? 'cancelled' : 'failed',
      );
      await p.getByRole('button', { name: '到末尾', exact: true }).click();
      await expect(p.getByTestId('pair-lane-0').getByTestId('sort-output')).toHaveText('1 2 3 \n');
    } else {
      await expect(root(p)).toHaveAttribute('data-group-id', '');
      await expect(p.getByTestId('sort-output')).toHaveCount(0);
    }
  });
test('pair controls, invalid input, swap and new run keep execution and replay separate', async ({
  page: p,
}) => {
  await observe(p);
  await ready(p);
  for (const text of ['', '1e2', '1000', '-1000', Array(31).fill('1').join(' ')]) {
    await p.getByTestId('pair-input').fill(text);
    await expect(p.getByRole('button', { name: '应用共同输入', exact: true })).toBeDisabled();
  }
  await run(p, [4, 1, 3, 2]);
  const first = await root(p).getAttribute('data-group-id');
  await p.clock.install();
  await p.getByRole('button', { name: '播放对比', exact: true }).click();
  await p.clock.runFor(500);
  await expect(root(p)).toHaveAttribute('data-cursor', '1');
  await p.getByRole('combobox', { name: 'C++对比回放速度', exact: true }).selectOption('4');
  await p.clock.runFor(125);
  await expect(root(p)).toHaveAttribute('data-cursor', '2');
  await p.getByRole('button', { name: '暂停对比', exact: true }).click();
  await p.clock.runFor(1000);
  await expect(root(p)).toHaveAttribute('data-cursor', '2');
  await p.clock.resume();
  await p.getByRole('button', { name: '统一后退', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-cursor', '1');
  await p.getByRole('button', { name: '统一前进', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-cursor', '2');
  expect(
    await p.evaluate(() => window.__verticalObservation.workers.filter((w) => w.moduleSeen).length),
  ).toBe(2);
  await p.getByRole('button', { name: '运行两份C++', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-phase', 'settled');
  expect(await root(p).getAttribute('data-group-id')).not.toBe(first);
  await p.getByRole('button', { name: '交换左右', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-group-id', '');
  await prepare(p, [2, 1]);
  await p.getByRole('button', { name: '运行两份C++', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-phase', 'settled');
  await expect(p.getByTestId('pair-lane-0').getByRole('heading', { level: 2 })).toHaveText(
    '快速排序',
  );
});
for (const width of [1440, 768, 390])
  test(`minimal C++ pair ${width}px actual views remain usable`, async ({ page: p }) => {
    await p.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await observe(p);
    await ready(p);
    await run(p, [7, -3, 0, 5, -3, 2, 9]);
    await seek(p, 60);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const panel of await p.getByTestId('sort-array').all()) {
      expect(
        await panel
          .locator('.array-chart-scroll')
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    await p.screenshot({ path: `${folder}/pair-${width}.png`, fullPage: true });
  });

test('native pair Worker load failure leaves no old state and a new explicit run recovers both sides', async ({
  page: p,
}) => {
  await observe(p);
  await ready(p);
  await run(p, [2, 1]);
  const worker = /\/algorithm-worker-[^/]+\.js$/;
  await p.route(worker, (route) => route.abort());
  await p.getByRole('button', { name: '运行两份C++', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-phase', 'settled');
  await expect(p.getByTestId('pair-lane-0')).toHaveAttribute('data-phase', 'failed');
  await expect(p.getByTestId('pair-lane-1')).toHaveAttribute('data-phase', 'failed');
  await expect(p.getByTestId('sort-output')).toHaveCount(0);
  await p.unroute(worker);
  await p.getByRole('button', { name: '运行两份C++', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-phase', 'settled');
  for (const i of [0, 1])
    await expect(p.getByTestId(`pair-lane-${i}`)).toHaveAttribute('data-phase', 'accepted');
});
