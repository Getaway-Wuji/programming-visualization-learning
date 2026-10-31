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
import type { StructureCase } from '../../web/src/structures/content';
import { scalarValue, structureView } from '../../web/src/structures/presentation';
import { slotValue } from '../../web/src/algorithms/presentation';
const specs = JSON.parse(readFileSync('content/algorithms/cpp/stack-queue-1.0.0.json', 'utf8'))
  .cases as StructureCase[];
const folder = `.artifacts/16.7/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
test.beforeAll(() => mkdir(folder, { recursive: true }));
const workspace = (p: Page) => p.getByTestId('structure-workspace');
async function ready(p: Page, spec = specs[0]) {
  await p.goto('/#/structures/' + spec.id);
  await waitForPhase2Archive(p);
  await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  await p.evaluate(() =>
    document.addEventListener(
      'click',
      (e) => {
        if ((e.target as HTMLElement).closest('button')?.textContent === '运行C++操作')
          Object.assign(window, { structureObservedClickAt: performance.now() });
      },
      true,
    ),
  );
}
function encode(draft: string) {
  return draft === '[]'
    ? []
    : draft
        .split('\n')
        .filter((x) => x.trim())
        .flatMap((line) => (line.trim() === '出' ? [2] : [1, Number(line.trim().split(/\s+/)[1])]));
}
async function run(p: Page, draft: string) {
  await p.getByTestId('structure-input').fill(draft);
  await p.getByRole('button', { name: '运行C++操作', exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
}
async function captured(p: Page, label: string) {
  const raw = await p.evaluate(() => {
    const record = window.__verticalObservation.workers.findLast(
      (w) => w.moduleSeen && w.responseOk,
    );
    if (!record) throw Error('Actual production Worker required');
    return {
      moduleSeen: record.moduleSeen,
      terminated: record.terminated,
      timing: (record as unknown as { timing: Record<string, number | null> }).timing,
      observedClickAt: (window as unknown as { structureObservedClickAt: number })
        .structureObservedClickAt,
      ...(
        record as unknown as {
          captureEncoded: () => { requestBase64: string; responseBase64: string };
        }
      ).captureEncoded(),
    };
  });
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
  await p.getByRole('slider', { name: '结构执行步骤', exact: true }).fill(String(cursor));
  await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
}
async function sameState(p: Page, result: AlgorithmResult, cursor: number, spec: StructureCase) {
  const player = new AlgorithmPlayer();
  player.accept(result);
  player.seek(cursor);
  const state = player.snapshot().state!,
    step = cursor ? result.trace!.steps[cursor - 1] : null,
    view = structureView(state, step, spec);
  for (const [key, value] of Object.entries(state.counters))
    await expect(p.getByTestId(`structure-counter-${key}`)).toHaveText(String(value));
  await expect(p.getByTestId('structure-output')).toHaveText(state.output || '（无输出）');
  for (const o of state.objects.filter((o) => o.kind === 'int'))
    await expect(
      p
        .getByTestId('structure-variable')
        .filter({ has: p.locator('small', { hasText: `${o.id} · ${o.scopeId}` }) })
        .locator('b'),
    ).toHaveText(String(slotValue(o, 0) ?? '未初始化'));
  if (!view.data) {
    await expect(p.getByTestId('structure-cell')).toHaveCount(0);
    return state;
  }
  await expect(p.getByTestId('structure-data')).toHaveAttribute('data-object-id', view.data.id);
  await expect(p.getByTestId('structure-cell')).toHaveCount(5);
  for (const c of view.cells) {
    const cell = p.locator(`[data-testid="structure-cell"][data-index="${c.index}"]`);
    await expect(cell).toHaveAttribute('data-value', String(c.value ?? 'uninitialized'));
    await expect(cell).toHaveAttribute(
      'data-valid',
      c.valid === null ? 'unknown' : String(c.valid),
    );
    await expect(cell).toHaveAttribute('data-write', String(c.write));
    await expect(cell).toHaveAttribute('data-address', String(c.virtualAddress));
  }
  await expect(p.getByTestId('structure-outcome')).toHaveAttribute(
    'data-code',
    String(view.outcome ?? ''),
  );
  return state;
}
for (const spec of specs) {
  const samples = [
    { id: 'default', draft: spec.defaultDraft },
    { id: 'empty', draft: '[]' },
    { id: 'ends-order', draft: '入 -999\n入 0\n入 999\n出\n出\n出\n出' },
    ...spec.boundaryDrafts
      .filter((x) => x.id !== 'empty')
      .map((x) => ({ id: x.id, draft: x.draft })),
    { id: 'all-in-max', draft: Array(15).fill('入 0').join('\n') },
    { id: 'all-out-max', draft: Array(30).fill('出').join('\n') },
  ];
  for (const sample of samples)
    test(`actual ${spec.kind} ${sample.id}: source, encoding, commit order, residuals and reverse`, async ({
      page: p,
    }) => {
      await observeCaseSetExecution(p);
      await ready(p, spec);
      const before = await native(p);
      await run(p, sample.draft);
      const { request, result } = await captured(p, `${spec.kind}-${sample.id}`),
        input = encode(sample.draft),
        source = readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', String(input.length));
      expect(request.source).toBe(source);
      expect(request.input).toEqual(input);
      expect(request.language).toBe('cpp');
      expect(result.terminal.status).toBe('completed');
      expect(result.terminal.returnValue).toBe(0);
      expect(result.trace!.completeness).toBe('complete');
      await expect(p.getByTestId('structure-source')).toHaveText(source);
      expect(await p.getByLabel('可复制的完整结构C++源码').inputValue()).toBe(source);
      const player = new AlgorithmPlayer();
      player.accept(result);
      let processed = 0,
        offset = 0,
        output = '',
        outcome: number,
        writes = 0;
      const logical: number[] = [],
        points: number[] = [];
      for (let i = 1; i <= player.snapshot().length; i++) {
        player.seek(i);
        const state = player.snapshot().state!,
          step = result.trace!.steps[i - 1],
          view = structureView(state, step, spec);
        expect(view.layoutIssue).toBe(false);
        const current = scalarValue(state, 'processed');
        if (current !== null && current > processed) {
          const code = input[offset++];
          if (code === 1) {
            const value = input[offset++];
            if (logical.length === 5) {
              output += `FULL ${value}\n`;
              outcome = 3;
            } else {
              logical.push(value);
              writes++;
              output += `IN ${value}\n`;
              outcome = 1;
            }
          } else if (!logical.length) {
            output += 'EMPTY\n';
            outcome = 4;
          } else {
            const value = spec.kind === 'stack' ? logical.pop() : logical.shift();
            output += `OUT ${value}\n`;
            outcome = 2;
          }
          expect(state.output).toBe(output);
          expect(view.logical!.map((x) => x.value)).toEqual(logical);
          expect(view.outcome).toBe(outcome);
          expect(state.control.inputCursor).toBe(offset);
          expect(state.counters.arrayWrites).toBe(writes);
          processed = current;
          points.push(i);
        }
      }
      expect(offset).toBe(input.length);
      expect(player.snapshot().state!.output).toBe(output + 'END\n');
      const length = result.trace!.steps.length,
        interesting = [
          0,
          ...points.filter(
            (_, i) => i === 0 || i === 4 || i === 5 || i === 9 || i === points.length - 1,
          ),
          length - 1,
          length,
        ];
      for (const point of [...new Set(interesting)]) {
        await seek(p, point);
        await sameState(p, result, point, spec);
      }
      const point = points[0] ?? Math.floor(length / 2);
      await seek(p, point);
      const saved = await sameState(p, result, point, spec);
      const range = result.nodeMap.find(
        (n) => n.nodeId === result.trace!.steps[point - 1].nodeId,
      )!.byteRange;
      await expect(p.getByTestId('structure-source-highlight')).toHaveAttribute(
        'data-byte-start',
        String(range.start),
      );
      await expect(p.getByTestId('structure-source-highlight')).toHaveAttribute(
        'data-byte-end',
        String(range.end),
      );
      await p.getByRole('button', { name: '前进', exact: true }).click();
      await p.getByRole('button', { name: '后退', exact: true }).click();
      expect(await sameState(p, result, point, spec)).toEqual(saved);
      await p.getByRole('button', { name: '查看末步', exact: true }).click();
      await expect(p.getByTestId('structure-terminal')).toContainText('程序正常结束');
      await expect(p.getByTestId('structure-output')).toHaveText(output + 'END\n');
      await p.getByRole('button', { name: '回到初态', exact: true }).click();
      await sameState(p, result, 0, spec);
      expect(await native(p)).toEqual(before);
      await writeFile(
        `${folder}/${spec.kind}-${sample.id}-summary.json`,
        JSON.stringify(
          {
            caseId: spec.id,
            input,
            identity: result.identity,
            engine: result.engine,
            steps: length,
            fuel: result.stats.fuelUsed,
            terminal: result.terminal,
            expectedOutput: output + 'END\n',
            operations: processed,
            acceptedWrites: writes,
            finalCounters: player.snapshot().state!.counters,
            commits: points,
          },
          null,
          2,
        ),
        { flag: 'wx' },
      );
    });
  test(`${spec.kind} rejects syntax/domain/31 slots and invalidates prior result before Worker`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await ready(p, spec);
    for (const text of [
      '',
      '入 1.5',
      '入 1e2',
      '入 1000',
      '入 -1000',
      '出 1',
      '入',
      'push 1',
      '[]\n出',
      Array(31).fill('出').join('\n'),
    ]) {
      await p.getByTestId('structure-input').fill(text);
      await expect(p.getByRole('button', { name: '运行C++操作', exact: true })).toBeDisabled();
      await expect(p.getByRole('alert')).toBeVisible();
      expect(await p.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
    }
    await run(p, '入 -0\n出');
    const { request } = await captured(p, `${spec.kind}-negative-zero`);
    expect(request.input).toEqual([1, 0, 2]);
    await p.getByTestId('structure-input').fill('bad');
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    await expect(p.getByTestId('structure-source')).toHaveText('');
    await expect(p.getByRole('slider', { name: '结构执行步骤', exact: true })).toBeDisabled();
  });
}

async function holdReply(p: Page) {
  await p.addInitScript(() => {
    const Native = window.Worker,
      descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage')!;
    const control = { armed: false, waiting: false, release: () => {} };
    Object.assign(window, { structureReplyHold: control });
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
    (window as unknown as { structureReplyHold: Hold }).structureReplyHold.armed = true;
  });
}
async function held(p: Page) {
  await expect
    .poll(() =>
      p.evaluate(
        () => (window as unknown as { structureReplyHold: Hold }).structureReplyHold.waiting,
      ),
    )
    .toBe(true);
}
async function release(p: Page) {
  await p.evaluate(() =>
    (window as unknown as { structureReplyHold: Hold }).structureReplyHold.release(),
  );
}
for (const action of ['edit', 'cancel', 'clear', 'leave', 'deadline'] as const)
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
    await p.getByRole('button', { name: '运行C++操作', exact: true }).click();
    await held(p);
    if (action === 'edit') await p.getByTestId('structure-input').fill('入 4\n出');
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
    if (action === 'deadline') await expect(workspace(p)).toHaveAttribute('data-state', 'failed');
    await release(p);
    if (action === 'leave') await ready(p);
    else if (action === 'cancel' || action === 'deadline') {
      await expect(workspace(p)).toHaveAttribute('data-state', 'failed');
      await expect(p.getByTestId('structure-error')).toContainText(
        action === 'cancel' ? 'E_CANCELLED' : 'E_DEADLINE',
      );
    } else await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    await expect(p.getByTestId('structure-output')).toHaveCount(0);
    await run(p, '入 2\n出');
    const { request, result } = await captured(p, `retry-${action}`);
    expect(request.input).toEqual([1, 2, 2]);
    expect(result.terminal.status).toBe('completed');
  });
test('native Worker load failure has no stale picture and an explicit new run recovers', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  const worker = /\/algorithm-worker-[^/]+\.js$/;
  await p.route(worker, (route) => route.abort());
  await p.getByRole('button', { name: '运行C++操作', exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'failed');
  await expect(p.getByTestId('structure-output')).toHaveCount(0);
  await p.unroute(worker);
  await run(p, '入 1\n入 -1');
  const { result } = await captured(p, 'worker-recovery');
  expect(result.terminal.status).toBe('completed');
});
test('one live player supports six speeds, keyboard, source focus and hidden-page pause without new runs', async ({
  page: p,
  context,
}) => {
  await observeCaseSetExecution(p);
  await ready(p, specs[0]);
  await run(p, '入 3\n入 1\n出');
  const { result } = await captured(p, 'controls');
  for (const rate of ['0.25', '0.5', '1', '1.5', '2', '4'])
    await p.getByRole('combobox', { name: '结构播放速度', exact: true }).selectOption(rate);
  const stage = p.getByRole('region', { name: '数据结构执行观察', exact: true });
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
  await sameState(p, result, 2, specs[0]);
  expect(
    await p.evaluate(() => window.__verticalObservation.workers.filter((w) => w.moduleSeen).length),
  ).toBe(1);
});

for (const spec of specs)
  for (const width of [1440, 768, 390])
    test(`${spec.kind} minimal ${width}px shows real physical cells, source and controls`, async ({
      page: p,
    }) => {
      await p.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await observeCaseSetExecution(p);
      await ready(p, spec);
      await run(p, spec.boundaryDrafts.find((x) => x.id === 'full')!.draft);
      const { result } = await captured(p, `${spec.kind}-visual-${width}`),
        player = new AlgorithmPlayer();
      player.accept(result);
      let point = 0;
      for (let i = 1; i <= player.snapshot().length; i++) {
        player.seek(i);
        if (scalarValue(player.snapshot().state!, 'processed') === 6) {
          point = i;
          break;
        }
      }
      expect(point).toBeGreaterThan(0);
      await seek(p, point);
      await sameState(p, result, point, spec);
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await p.screenshot({ path: `${folder}/${spec.kind}-${width}.png`, fullPage: true });
      if (width < 1000) await p.getByRole('tab', { name: '实际C++源码', exact: true }).click();
      await expect(p.getByTestId('structure-source')).toBeVisible();
      await p.screenshot({ path: `${folder}/${spec.kind}-source-${width}.png`, fullPage: true });
    });
for (const spec of specs)
  test(`${spec.kind} actual zero pending publication, residual and scope removal restore exactly`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await ready(p, spec);
    await run(p, '入 0\n出');
    const { result } = await captured(p, `${spec.kind}-pending`);
    const record = result
      .trace!.steps.flatMap((s) => s.changes)
      .find(
        (c) =>
          c.op === 'record' &&
          c.table === 'objects' &&
          c.after &&
          'name' in c.after &&
          c.after.name === 'data',
      )!;
    if (record.op !== 'record') throw Error('Actual data declaration required');
    const append = result.trace!.steps.find((s) =>
      s.changes.some(
        (c) => c.op === 'cell' && c.objectId === record.id && c.index === 0 && c.after === 0,
      ),
    )!;
    await seek(p, append.seq);
    await sameState(p, result, append.seq, spec);
    const cell = p.locator('[data-testid="structure-cell"][data-index="0"]');
    await expect(cell).toHaveAttribute('data-value', '0');
    await expect(cell).toHaveAttribute('data-valid', 'false');
    await expect(cell).toHaveAttribute('data-write', 'true');
    await seek(p, append.seq - 1);
    await sameState(p, result, append.seq - 1, spec);
    await expect(cell).toHaveAttribute('data-value', 'uninitialized');
    const player = new AlgorithmPlayer();
    player.accept(result);
    let emptyAfter = 0;
    for (let i = 1; i <= player.snapshot().length; i++) {
      player.seek(i);
      if (scalarValue(player.snapshot().state!, 'processed') === 2) {
        emptyAfter = i;
        break;
      }
    }
    await seek(p, emptyAfter);
    await sameState(p, result, emptyAfter, spec);
    await expect(cell).toHaveAttribute('data-value', '0');
    await expect(cell).toHaveAttribute('data-valid', 'false');
    const removal = result.trace!.steps.find((s) =>
      s.changes.some(
        (c) => c.op === 'record' && c.table === 'objects' && c.id === record.id && !c.after,
      ),
    )!;
    await seek(p, removal.seq);
    await sameState(p, result, removal.seq, spec);
    await expect(p.getByTestId('structure-cell')).toHaveCount(0);
    await seek(p, removal.seq - 1);
    await sameState(p, result, removal.seq - 1, spec);
    await expect(p.getByTestId('structure-cell')).toHaveCount(5);
  });
test('presets and case switching discard the old identity; catalog and unknown route preserve navigation', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  await run(p, specs[0].defaultDraft);
  const first = await captured(p, 'first-identity');
  for (const s of specs[0].boundaryDrafts) {
    await p.getByRole('combobox', { name: '结构边界样例' }).selectOption(s.id);
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    expect(await p.getByTestId('structure-input').inputValue()).toBe(s.draft);
  }
  await p.getByRole('button', { name: '恢复示例', exact: true }).click();
  expect(await p.getByTestId('structure-input').inputValue()).toBe(specs[0].defaultDraft);
  await p.getByRole('button', { name: '使用空序列', exact: true }).click();
  expect(await p.getByTestId('structure-input').inputValue()).toBe('[]');
  await p.getByRole('link', { name: '环形队列', exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  await run(p, specs[1].defaultDraft);
  const next = await captured(p, 'second-identity');
  expect(next.result.identity.runId).not.toBe(first.result.identity.runId);
  await p.goto('/#/cases');
  await expect(p.getByTestId('cpp-structure-catalog').getByRole('link')).toHaveCount(2);
  await expect(p.locator('main a[href^="#/visualize/"]')).toHaveCount(7);
  await expect(p.locator('main a[href^="#/algorithms/"]')).toHaveCount(6);
  await p.goto('/#/structures/missing');
  await expect(p.getByRole('heading', { name: '找不到这个结构案例' })).toBeVisible();
});
test('old six C++ cases, original C, memory and both comparisons retain real engine and local-store boundaries', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  const before = await native(p);
  for (const slug of [
    'insertion-sort',
    'shell-sort',
    'counting-sort',
    'merge-sort',
    'quick-sort',
    'bucket-sort',
  ]) {
    await p.goto('/#/algorithms/case.cpp.' + slug);
    await p.getByRole('button', { name: '运行C++案例', exact: true }).click();
    await expect(p.getByTestId('sort-workspace')).toHaveAttribute('data-state', 'ready');
    const { request, result } = await captured(p, 'compat-' + slug);
    expect(request.source).toBe(
      readFileSync(`content/algorithms/cpp/${slug}-1.0.0.cpp`, 'utf8').replace('{{n}}', '7'),
    );
    expect(result.terminal.status).toBe('completed');
  }
  await p.goto('/#/visualize/case.c.assignment');
  await p.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(p.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  await p.goto('/#/memory?example=nodes');
  await p.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(p.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  await p.goto('/#/compare');
  await p.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(p.getByTestId('comparison-page')).toHaveAttribute('data-phase', 'ready');
  await p.getByRole('button', { name: '运行两种算法', exact: true }).click();
  await expect(p.getByTestId('comparison-page')).toHaveAttribute('data-phase', 'settled');
  await p.goto('/#/compare?pair=cpp-recursive');
  await p.getByRole('button', { name: '应用共同输入', exact: true }).click();
  await expect(p.getByTestId('recursive-comparison')).toHaveAttribute('data-phase', 'ready');
  await p.getByRole('button', { name: '运行两份C++', exact: true }).click();
  await expect(p.getByTestId('recursive-comparison')).toHaveAttribute('data-phase', 'settled');
  await ready(p, specs[1]);
  await run(p, '入 999\n出');
  await captured(p, 'engine-switch-return');
  expect(await native(p)).toEqual(before);
});
