import { expectedSourceLine } from './source-highlight';
import { readFileSync } from 'node:fs';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { observeCaseSetExecution } from './case-set-observation';
import { waitForPhase2Archive } from './phase2-ready';
import { native, clear } from './scheduler-helpers';
import type { ExampleSpec } from '../../web/src/examples/content';
import type { AdvancedRequest } from '../../web/src/engine/advanced-protocol';
import { decodeAdvancedResult } from '../../web/src/engine/advanced-protocol';
import { AdvancedPlayer } from '../../web/src/engine/advanced-player';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
const specs = JSON.parse(readFileSync('content/advanced/examples-1.0.0.json', 'utf8'))
  .examples as ExampleSpec[];
const sets = JSON.parse(readFileSync('content/advanced/example-solutions-1.0.0.json', 'utf8'))
  .examples as {
  solutions: { sourceFile: string; solutionRef: { id: string } }[];
  supplementalSamples: ExampleSpec['samples'];
}[];
type Probe = {
  posts: { remainingMs: number; at: number }[];
  active: number;
  max: number;
  hold: number;
  waiting: boolean;
  release: () => void;
};
async function observe(page: Page) {
  await page.addInitScript(() => {
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
    Object.assign(window, { solutionsProbe: probe });
    window.Worker = class extends Native {
      private counted = false;
      private ordinal = 0;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(this, 'onmessage', {
          get: () => descriptor.get!.call(this),
          set: (callback: ((e: MessageEvent) => unknown) | null) =>
            descriptor.set!.call(
              this,
              callback &&
                ((event: MessageEvent) => {
                  if (this.counted && probe.hold === this.ordinal && event.data?.ok) {
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
        const d = message as { module?: unknown; remainingMs: number };
        if (d?.module instanceof WebAssembly.Module) {
          this.counted = true;
          probe.active++;
          probe.max = Math.max(probe.max, probe.active);
          probe.posts.push({ remainingMs: d.remainingMs, at: performance.now() });
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
  await observeCaseSetExecution(page);
}
const root = (p: Page) => p.getByTestId('example-comparison'),
  lane = (p: Page, i: number) => p.getByTestId('solution-lane-' + i);
async function open(p: Page, spec = specs[0]) {
  await p.goto('/#/advanced/examples/' + spec.id + '/compare');
  await waitForPhase2Archive(p);
  await expect(root(p)).toHaveAttribute('data-phase', 'idle');
}
async function run(p: Page) {
  await p.getByRole('button', { name: '运行两份C++方案', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-phase', 'settled');
}
async function seek(p: Page, k: number) {
  await p.getByRole('slider', { name: '同题统一步骤', exact: true }).fill(String(k));
  await expect(root(p)).toHaveAttribute('data-cursor', String(k));
}
async function packets(p: Page, info: TestInfo) {
  const raws = await p.evaluate(() =>
    window.__verticalObservation.workers
      .filter((w) => w.moduleSeen && w.responseOk)
      .slice(-2)
      .map((w) => ({
        moduleSeen: w.moduleSeen,
        terminated: w.terminated,
        ...(
          w as unknown as { captureEncoded(): { requestBase64: string; responseBase64: string } }
        ).captureEncoded(),
      })),
  );
  expect(raws).toHaveLength(2);
  await info.attach('two-real-cpp-packets', {
    body: JSON.stringify(raws),
    contentType: 'application/json',
  });
  return Promise.all(
    raws.map(async (raw) => {
      expect(raw.terminated).toBe(true);
      const request = JSON.parse(
        Buffer.from(raw.requestBase64, 'base64').toString(),
      ) as AdvancedRequest;
      const result = await decodeAdvancedResult(
        Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
        request,
        engineBuild.wasmSha256,
      );
      return { request, result };
    }),
  );
}
for (const [i, spec] of specs.entries())
  for (const sample of [...spec.samples, ...sets[i].supplementalSamples])
    test(`same problem real cpp ${spec.id}/${sample.key}`, async ({ page }, info) => {
      await observe(page);
      await open(page, spec);
      await page
        .getByRole('combobox', { name: '同题边界样例', exact: true })
        .selectOption(sample.key);
      await run(page);
      const captures = await packets(page, info);
      expect(captures[0].request.runId).not.toBe(captures[1].request.runId);
      expect(captures[0].request.sourceRevision).not.toBe(captures[1].request.sourceRevision);
      await expect(page.getByTestId('solutions-outcome')).toHaveAttribute(
        'data-outcome',
        sample.expectedReturn ? 'rejected' : 'equal',
      );
      for (const [j, { request, result }] of captures.entries()) {
        const source = readFileSync(sets[i].solutions[j].sourceFile, 'utf8').replace(
          '{{n}}',
          String(sample.values.length),
        );
        expect(request.language).toBe('cpp');
        expect(request.source).toBe(source);
        expect(request.input).toEqual({
          kind: 'integers',
          values: [...sample.values, ...(spec.hasTarget ? [sample.target!] : [])],
        });
        expect(result.terminal).toMatchObject({
          status: 'completed',
          returnValue: sample.expectedReturn,
        });
        await lane(page, j).getByText('本侧实际源码与高亮', { exact: true }).click();
        await expect(lane(page, j).getByLabel('本侧实际C++源码', { exact: true })).toHaveText(
          source,
        );
      }
      const length = Number(await root(page).getAttribute('data-length')),
        k = Math.floor(Math.min(...captures.map((c) => c.result.trace!.steps.length)) / 2);
      await seek(page, k);
      for (const [j, { request, result }] of captures.entries()) {
        const player = new AdvancedPlayer();
        player.accept(result);
        player.seek(k);
        const state = player.snapshot().state!;
        await expect(lane(page, j)).toHaveAttribute('data-cursor', String(k));
        for (const array of state.objects.filter(
          (o) => o.alive && ['values', 'order', 'scratch'].includes(o.name),
        )) {
          const expected = Array.from({ length: sample.values.length }, (_, at) =>
            String(
              array.cells.find((c) => c.byteOffset === at * 4)?.value ??
                (array.zeroInitialized ? 0 : '未初始化'),
            ),
          );
          expect(
            await lane(page, j)
              .locator(`[data-testid="solution-array"][data-name="${array.name}"] li strong`)
              .allTextContents(),
          ).toEqual(expected);
        }
        for (const [key, count] of Object.entries(state.counters))
          await expect(lane(page, j).locator(`[data-counter="${key}"]`)).toHaveText(String(count));
        const range = expectedSourceLine(request.source, player.snapshot().byteRange);
        const highlight = lane(page, j).getByTestId('pair-source-highlight');
        if (range) {
          await expect(highlight).toHaveAttribute(
            'data-byte-start',
            String(player.snapshot().byteRange!.start),
          );
          await expect(highlight).toHaveAttribute(
            'data-byte-end',
            String(player.snapshot().byteRange!.end),
          );
        } else await expect(highlight).toHaveCount(0);
        await lane(page, j)
          .getByRole('combobox', { name: '本侧观察视图', exact: true })
          .selectOption('memory');
        await expect(lane(page, j).getByLabel('内存视图', { exact: true })).toContainText(
          state.allocator.liveBytes + ' B',
        );
        await lane(page, j)
          .getByRole('combobox', { name: '本侧观察视图', exact: true })
          .selectOption('stack');
        await expect(lane(page, j).getByLabel('调用栈视图', { exact: true })).toContainText(
          '当前 ' + state.frames.length + ' 个活动帧',
        );
        await expect(lane(page, j)).toHaveAttribute('data-cursor', String(k));
        await lane(page, j)
          .getByRole('combobox', { name: '本侧观察视图', exact: true })
          .selectOption('basic');
      }
      await page.getByRole('button', { name: '统一前进', exact: true }).click();
      await page.getByRole('button', { name: '统一后退', exact: true }).click();
      await expect(root(page)).toHaveAttribute('data-cursor', String(k));
      await seek(page, length);
      for (const j of [0, 1]) {
        await expect(lane(page, j).getByTestId('custom-output')).toHaveText(sample.expectedStdout);
        await expect(lane(page, j)).toHaveAttribute(
          'data-cursor',
          String(captures[j].result.trace!.steps.length),
        );
      }
      await seek(page, 0);
      for (const j of [0, 1])
        await expect(lane(page, j).getByTestId('custom-output')).toHaveText('（尚无输出）');
      const probe = await page.evaluate(
        () => (window as unknown as { solutionsProbe: Probe }).solutionsProbe,
      );
      expect(probe.max).toBe(1);
      expect(probe.active).toBe(0);
      expect(probe.posts).toHaveLength(2);
      expect(probe.posts[1].remainingMs).toBeLessThan(probe.posts[0].remainingMs);
      await info.attach('shared-budget', {
        body: JSON.stringify(probe.posts),
        contentType: 'application/json',
      });
    });
test('swapping, malformed edits and changing topic invalidate both traces; unknown identity is bounded', async ({
  page,
}) => {
  await open(page);
  await run(page);
  await page.getByRole('button', { name: '交换左右方案', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-phase', 'idle');
  await run(page);
  await expect(lane(page, 0)).toHaveAttribute('data-solution', sets[0].solutions[1].solutionRef.id);
  await page.getByTestId('solutions-values').fill('3 1');
  await expect(root(page)).toHaveAttribute('data-phase', 'idle');
  await page.getByRole('combobox', { name: '对比例题', exact: true }).selectOption(specs[2].id);
  await page.getByTestId('solutions-values').fill('3 1');
  await expect(page.getByRole('button', { name: '运行两份C++方案', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('严格递增');
  await page.goto('/#/advanced/examples/fake/compare');
  await expect(
    page.getByRole('heading', { name: '找不到这个同题对比', exact: true }),
  ).toBeVisible();
});
test('controlled second Worker cancellation retains accepted first; genuine late packet cannot revive, next run recovers', async ({
  page,
}) => {
  await observe(page);
  await open(page, specs[1]);
  await page.evaluate(
    () => ((window as unknown as { solutionsProbe: Probe }).solutionsProbe.hold = 2),
  );
  await page.getByRole('button', { name: '运行两份C++方案', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { solutionsProbe: Probe }).solutionsProbe.waiting),
    )
    .toBe(true);
  await page.getByRole('button', { name: '取消本组运行', exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as { solutionsProbe: Probe }).solutionsProbe.release(),
  );
  await expect(root(page)).toHaveAttribute('data-phase', 'cancelled');
  await expect(lane(page, 0)).toHaveAttribute('data-phase', 'accepted');
  await expect(lane(page, 1)).toHaveAttribute('data-phase', 'cancelled');
  await page.getByRole('button', { name: '查看两侧末步', exact: true }).click();
  await expect(lane(page, 0).getByTestId('custom-output')).toHaveText('4 -2 4 0 0\n');
  await run(page);
  await expect(page.getByTestId('solutions-outcome')).toHaveAttribute('data-outcome', 'equal');
});
test('controlled first Worker hold past original common deadline fails honestly and fresh execution recovers', async ({
  page,
}) => {
  await observe(page);
  await open(page, specs[1]);
  await page.evaluate(
    () => ((window as unknown as { solutionsProbe: Probe }).solutionsProbe.hold = 1),
  );
  await run(page);
  await expect(lane(page, 0).getByTestId('solution-lane-status')).toContainText('E_DEADLINE');
  await expect(lane(page, 1).getByTestId('solution-lane-status')).toContainText('E_DEADLINE');
  await expect(page.getByTestId('solutions-outcome')).toHaveAttribute(
    'data-outcome',
    'unavailable',
  );
  await page.evaluate(() =>
    (window as unknown as { solutionsProbe: Probe }).solutionsProbe.release(),
  );
  await run(page);
  await expect(page.getByTestId('solutions-outcome')).toHaveAttribute('data-outcome', 'equal');
});
test('one controlled real Worker failure leaves the other independent; rerun recovers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    let fail = true;
    window.Worker = class extends Native {
      override postMessage(
        message: unknown,
        options: Transferable[] | StructuredSerializeOptions = [],
      ) {
        const d = message as { module?: unknown };
        if (fail && d?.module instanceof WebAssembly.Module) {
          fail = false;
          this.dispatchEvent(
            new ErrorEvent('error', { cancelable: true, message: 'controlled QA worker failure' }),
          );
          return;
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  await open(page, specs[1]);
  await run(page);
  await expect(lane(page, 0).getByTestId('solution-lane-status')).toContainText('E_WORKER_FAILURE');
  await expect(lane(page, 1)).toHaveAttribute('data-phase', 'accepted');
  await expect(page.getByTestId('solutions-outcome')).toHaveAttribute(
    'data-outcome',
    'unavailable',
  );
  await run(page);
  await expect(page.getByTestId('solutions-outcome')).toHaveAttribute('data-outcome', 'equal');
});
test('missing WASM and restoration do not invent accepted traces', async ({ page }) => {
  const module = /c_viz_advanced_bg[^/]*\.wasm/;
  await page.route(module, (route) => route.abort());
  await open(page, specs[1]);
  await run(page);
  await expect(lane(page, 0)).toHaveAttribute('data-phase', 'failed');
  await expect(lane(page, 1)).toHaveAttribute('data-phase', 'failed');
  await expect(root(page)).toHaveAttribute('data-length', '0');
  await page.unroute(module);
  await run(page);
  await expect(page.getByTestId('solutions-outcome')).toHaveAttribute('data-outcome', 'equal');
});
test('both real executions and replay mint no learning facts, rewards or persistent input; sources are optional', async ({
  page,
}, info) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (/leetcode\.com/.test(r.url())) external.push(r.url());
  });
  await open(page);
  const before = await native(page);
  for (const spec of specs) {
    await open(page, spec);
    await run(page);
    await seek(page, Number(await root(page).getAttribute('data-length')));
    await seek(page, 0);
  }
  const after = await native(page);
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals', 'aliases'] as const)
    expect(after[key]).toEqual(before[key]);
  expect(JSON.stringify(after)).not.toContain('std::cin');
  expect(external).toEqual([]);
  await info.attach('no-learning-side-effects', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
});
test('real cross-tab clear invalidates both traces and next execution works', async ({
  page,
  context,
}) => {
  await open(page, specs[1]);
  await run(page);
  const other = await context.newPage();
  await clear(other);
  await expect(root(page)).toHaveAttribute('data-phase', 'idle');
  await expect(root(page)).toHaveAttribute('data-length', '0');
  await other.close();
  await run(page);
  await expect(page.getByTestId('solutions-outcome')).toHaveAttribute('data-outcome', 'equal');
});
for (const width of [1440, 768, 390])
  test(`same-problem keyboard and layout ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/advanced/examples');
    await waitForPhase2Archive(page);
    const link = page.getByRole('link', { name: '同题两解与复杂度 →', exact: true }).nth(1);
    await link.press('Enter');
    await expect(root(page)).toHaveAttribute('data-phase', 'idle');
    await page.getByRole('button', { name: '运行两份C++方案', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(root(page)).toHaveAttribute('data-phase', 'settled');
    await seek(page, 50);
    await page.getByLabel('同题统一回放', { exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(root(page)).toHaveAttribute('data-cursor', '51');
    await page.keyboard.press('ArrowLeft');
    await expect(root(page)).toHaveAttribute('data-cursor', '50');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.screenshot({
      path: info.outputPath('comparison-' + width + '.png'),
      fullPage: true,
    });
  });
