import { waitForPhase2Archive } from './phase2-ready';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { observeCaseSetExecution } from './case-set-observation';
import { native, clear } from './achievement-helpers';
import {
  decodeMemoryResult,
  type MemoryRequest,
  type MemoryResult,
} from '../../web/src/engine/memory-protocol';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import { engineBuild } from '../../web/src/generated/memory/engine-build';
import { memorySlots } from '../../web/src/memory/presentation';
import type { ClassicCase } from '../../web/src/classics/content';
const specs = JSON.parse(readFileSync('content/algorithms/cpp/classics-1.0.0.json', 'utf8'))
    .cases as ClassicCase[],
  folder = `.artifacts/16.9/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
test.beforeAll(() => mkdir(folder, { recursive: true }));
const workspace = (p: Page) => p.getByTestId('classic-workspace');
async function ready(p: Page, spec = specs[0]) {
  await p.goto('/#/classics/' + spec.id);
  await waitForPhase2Archive(p);
  await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  await p.evaluate(() =>
    document.addEventListener(
      'click',
      (e) => {
        if ((e.target as HTMLElement).closest('button')?.textContent === '运行C++经典案例')
          Object.assign(window, { classicObservedClickAt: performance.now() });
      },
      true,
    ),
  );
}
async function run(p: Page, input: number[] | string) {
  await p.getByTestId('classic-input').fill(typeof input === 'string' ? input : input.join(' '));
  await p.getByRole('button', { name: '运行C++经典案例', exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
}
async function captured(p: Page, label: string) {
  const raw = await p.evaluate(() => {
    const record = window.__verticalObservation.workers.findLast(
      (w) => w.moduleSeen && w.responseOk,
    );
    if (!record) throw Error('Actual native Worker required');
    return {
      moduleSeen: record.moduleSeen,
      terminated: record.terminated,
      timing: (record as unknown as { timing: Record<string, number | null> }).timing,
      observedClickAt: (window as unknown as { classicObservedClickAt: number })
        .classicObservedClickAt,
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
  const request = JSON.parse(Buffer.from(raw.requestBase64, 'base64').toString()) as MemoryRequest,
    result = await decodeMemoryResult(
      Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
      request,
      engineBuild.wasmSha256,
    );
  return { request, result };
}
async function seek(p: Page, cursor: number) {
  await p.getByRole('slider', { name: '经典执行步骤', exact: true }).fill(String(cursor));
  await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
}
async function sameState(p: Page, result: MemoryResult, cursor: number, spec: ClassicCase) {
  const player = new MemoryPlayer();
  player.accept(result);
  player.seek(cursor);
  const state = player.snapshot().state!,
    main = state.frames.find((f) => f.parentFrameId === null),
    objects = main ? state.objects.filter((o) => o.alive && o.frameId === main.id) : [];
  for (const [k, v] of Object.entries(state.counters))
    await expect(p.getByTestId(`classic-counter-${k}`)).toHaveText(String(v));
  await expect(p.getByTestId('classic-output')).toHaveText(state.output || '（无输出）');
  await expect(p.getByTestId('classic-object')).toHaveCount(objects.length);
  for (const o of objects) {
    const row = p.locator(`[data-testid="classic-object"][data-object-id="${o.id}"]`);
    await expect(row).toHaveAttribute('data-name', o.name);
    const slots = memorySlots(o, result.types);
    await expect(row.getByTestId('classic-slot')).toHaveCount(slots.length);
    for (const slot of slots)
      await expect(
        row.locator(`[data-testid="classic-slot"][data-offset="${slot.byteOffset}"]`),
      ).toHaveAttribute(
        'data-value',
        typeof slot.value === 'number' ? String(slot.value) : 'uninitialized',
      );
  }
  if (spec.kind === 'hanoi') {
    const nObj = objects.find((o) => o.name === 'n'),
      n = nObj ? memorySlots(nObj, result.types)[0].value : null,
      pos = objects.find((o) => o.name === 'positions'),
      slots = pos ? memorySlots(pos, result.types) : [],
      initialized =
        typeof n === 'number' && pos && slots.slice(0, n).every((s) => typeof s.value === 'number');
    if (initialized) {
      await expect(p.getByTestId('hanoi-disk')).toHaveCount(n as number);
      for (let d = 0; d < (n as number); d++)
        await expect(p.locator(`[data-testid="hanoi-disk"][data-index="${d}"]`)).toHaveAttribute(
          'data-peg',
          String(slots[d].value),
        );
      for (const peg of [0, 1, 2])
        expect(
          await p
            .locator(`[data-testid="hanoi-peg"][data-peg="${peg}"]`)
            .getByTestId('hanoi-disk')
            .evaluateAll((xs) => xs.map((x) => Number(x.getAttribute('data-index')))),
        ).toEqual(
          slots
            .slice(0, n as number)
            .flatMap((s, i) => (s.value === peg ? [i] : []))
            .reverse(),
        );
    } else await expect(p.getByTestId('hanoi-disk')).toHaveCount(0);
  }
  return state;
}
function numericExpected(spec: ClassicCase, values: number[]) {
  if (spec.kind === 'gcd') {
    const a = Math.abs(values[0]),
      b = Math.abs(values[1]);
    let divisor = 0;
    for (let d = 1; d <= Math.max(a, b); d++) if (a % d === 0 && b % d === 0) divisor = d;
    return `GCD ${divisor}\n`;
  }
  if (spec.kind === 'prime') {
    let yes = values[0] >= 2;
    for (let d = 2; d < values[0]; d++) if (values[0] % d === 0) yes = false;
    return `PRIME ${yes ? 1 : 0}\n`;
  }
  const v = values[0],
    s = String(v);
  return `PALINDROME ${v >= 0 && s === s.split('').reverse().join('') ? 1 : 0}\n`;
}
function verifyHanoi(result: MemoryResult, n: number) {
  const player = new MemoryPlayer();
  player.accept(result);
  const pegs = [Array.from({ length: n }, (_, i) => n - i - 1), [], []] as number[][],
    moves: { cursor: number; disk: number; from: number; to: number }[] = [];
  let positionsId = '';
  for (let i = 1; i <= player.snapshot().length; i++) {
    player.seek(i);
    const s = player.snapshot().state!,
      pos = s.objects.find((o) => o.alive && o.name === 'positions');
    if (pos) positionsId = pos.id;
    for (const c of result.trace!.steps[i - 1].changes)
      if (c.op === 'cell' && c.objectId === positionsId) {
        const disk = c.byteOffset / 4,
          from = c.before as number,
          to = c.after as number;
        expect(pegs[from].pop()).toBe(disk);
        expect(pegs[to].length === 0 || pegs[to].at(-1)! > disk).toBe(true);
        pegs[to].push(disk);
        moves.push({ cursor: i, disk, from, to });
      }
  }
  expect(moves).toHaveLength(2 ** n - 1);
  expect(pegs[2]).toEqual(Array.from({ length: n }, (_, i) => n - i - 1));
  return {
    moves,
    output:
      moves.map((m) => `MOVE ${m.disk + 1} ${m.from} ${m.to}\n`).join('') +
      `MOVES ${moves.length}\n`,
  };
}
for (const spec of specs) {
  const samples =
    spec.kind === 'hanoi'
      ? spec.boundarySamples
      : [{ id: 'default', title: '默认', input: spec.defaultInput }, ...spec.boundarySamples];
  for (const sample of samples)
    test(`actual ${spec.kind} ${sample.id}: exact source, input, current values, output and reverse`, async ({
      page: p,
    }) => {
      await observeCaseSetExecution(p);
      await ready(p, spec);
      const before = await native(p);
      await run(p, sample.input);
      const { request, result } = await captured(p, `${spec.kind}-${sample.id}`),
        player = new MemoryPlayer();
      player.accept(result);
      const initial = player.snapshot(),
        length = result.trace!.steps.length,
        point = Math.max(1, Math.floor(length / 2)),
        firstOutput =
          result.trace!.steps.findIndex((s) => s.changes.some((c) => c.op === 'output')) + 1;
      expect(request.source).toBe(readFileSync(spec.sourceFile, 'utf8'));
      expect(request.input).toEqual(sample.input);
      expect(request.language).toBe('cpp');
      expect(request.engineId).toBe('engine.rust.memory');
      expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 0 });
      await expect(p.getByTestId('classic-source')).toHaveText(request.source);
      expect(await p.getByLabel('可复制的完整经典C++源码').inputValue()).toBe(request.source);
      const hanoi = spec.kind === 'hanoi' ? verifyHanoi(result, sample.input[0]) : null,
        expected = hanoi?.output ?? numericExpected(spec, sample.input);
      player.seek(length);
      expect(player.snapshot().state!.output).toBe(expected);
      expect(player.snapshot().state!.objects.every((o) => !o.alive && o.cells.length === 0)).toBe(
        true,
      );
      let maxFrames = 0;
      for (let i = length; i >= 0; i--) {
        player.seek(i);
        maxFrames = Math.max(maxFrames, player.snapshot().state!.frames.length);
      }
      expect(player.snapshot()).toEqual(initial);
      expect(maxFrames).toBe(spec.kind === 'hanoi' ? sample.input[0] + 2 : 1);
      for (const cursor of [0, point, firstOutput, length - 1, length]) {
        await seek(p, cursor);
        await sameState(p, result, cursor, spec);
      }
      await seek(p, point);
      const saved = await sameState(p, result, point, spec),
        range = result.nodeMap.find(
          (n) => n.nodeId === result.trace!.steps[point - 1].nodeId,
        )!.byteRange;
      await expect(p.getByTestId('classic-source-highlight')).toHaveAttribute(
        'data-byte-start',
        String(range.start),
      );
      await expect(p.getByTestId('classic-source-highlight')).toHaveAttribute(
        'data-byte-end',
        String(range.end),
      );
      await p.getByRole('button', { name: '前进', exact: true }).click();
      await p.getByRole('button', { name: '后退', exact: true }).click();
      expect(await sameState(p, result, point, spec)).toEqual(saved);
      await p.getByRole('button', { name: '查看末步', exact: true }).click();
      await expect(p.getByTestId('classic-terminal')).toContainText('程序正常结束');
      await expect(p.getByTestId('classic-output')).toHaveText(expected);
      await p.getByRole('button', { name: '回到初态', exact: true }).click();
      expect(await native(p)).toEqual(before);
      await writeFile(
        `${folder}/${spec.kind}-${sample.id}-summary.json`,
        JSON.stringify(
          {
            caseId: spec.id,
            input: sample.input,
            identity: result.identity,
            engine: result.engine,
            steps: length,
            fuel: result.stats.fuelUsed,
            maxFrames,
            terminal: result.terminal,
            expected,
            hanoiMoves: hanoi?.moves ?? null,
          },
          null,
          2,
        ),
        { flag: 'wx' },
      );
    });
  test(`${spec.kind} strict syntax, arity and domain reject before Worker and edits discard the old run`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await ready(p, spec);
    for (const draft of [
      '',
      '[]',
      '1.5',
      '1e2',
      Array(spec.inputArity + 1)
        .fill('1')
        .join(' '),
      Array(spec.inputArity)
        .fill(String(spec.max + 1))
        .join(' '),
    ]) {
      await p.getByTestId('classic-input').fill(draft);
      await expect(p.getByRole('button', { name: '运行C++经典案例', exact: true })).toBeDisabled();
      await expect(p.getByRole('alert')).toBeVisible();
      expect(await p.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
    }
    await run(p, Array(spec.inputArity).fill('-0').join('，'));
    const { request } = await captured(p, `${spec.kind}-syntax-recovery`);
    expect(request.input).toEqual(Array(spec.inputArity).fill(0));
    await p.getByTestId('classic-input').fill('bad');
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    await expect(p.getByTestId('classic-source')).toHaveText('');
    await expect(p.getByRole('slider', { name: '经典执行步骤', exact: true })).toBeDisabled();
  });
}

async function holdReply(p: Page) {
  await p.addInitScript(() => {
    const Native = window.Worker,
      descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage')!;
    const control = { armed: false, waiting: false, release: () => {} };
    Object.assign(window, { classicReplyHold: control });
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
    (window as unknown as { classicReplyHold: Hold }).classicReplyHold.armed = true;
  });
}
async function held(p: Page) {
  await expect
    .poll(() =>
      p.evaluate(() => (window as unknown as { classicReplyHold: Hold }).classicReplyHold.waiting),
    )
    .toBe(true);
}
async function release(p: Page) {
  await p.evaluate(() =>
    (window as unknown as { classicReplyHold: Hold }).classicReplyHold.release(),
  );
}
for (const action of ['edit', 'cancel', 'clear', 'leave', 'switch', 'deadline'] as const)
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
    await p.getByRole('button', { name: '运行C++经典案例', exact: true }).click();
    await held(p);
    if (action === 'edit') await p.getByTestId('classic-input').fill('2');
    if (action === 'cancel') await p.getByRole('button', { name: '取消运行', exact: true }).click();
    if (action === 'leave') await p.goto('/#/cases');
    if (action === 'switch')
      await p.getByRole('link', { name: '辗转相除法求GCD', exact: true }).click();
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
    if (action === 'leave' || action === 'switch') await ready(p);
    else if (action === 'cancel' || action === 'deadline') {
      await expect(workspace(p)).toHaveAttribute('data-state', 'failed');
      await expect(p.getByTestId('classic-error')).toContainText(
        action === 'cancel' ? 'E_CANCELLED' : 'E_DEADLINE',
      );
    } else await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    await expect(p.getByTestId('classic-output')).toHaveCount(0);
    await run(p, '2');
    const { request, result } = await captured(p, `retry-${action}`);
    expect(request.input).toEqual([2]);
    expect(result.terminal.status).toBe('completed');
  });
test('native Worker load failure has no stale picture and an explicit new run recovers', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  const worker = /\/memory-worker-[^/]+\.js$/;
  await p.route(worker, (route) => route.abort());
  await p.getByRole('button', { name: '运行C++经典案例', exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'failed');
  await expect(p.getByTestId('classic-output')).toHaveCount(0);
  await p.unroute(worker);
  await run(p, '1');
  const { result } = await captured(p, 'worker-recovery');
  expect(result.terminal.status).toBe('completed');
});
test('one live player supports six speeds, keyboard, source focus and hidden-page pause without new runs', async ({
  page: p,
  context,
}) => {
  await observeCaseSetExecution(p);
  await ready(p, specs[0]);
  await run(p, '3');
  const { result } = await captured(p, 'controls');
  for (const rate of ['0.25', '0.5', '1', '1.5', '2', '4'])
    await p.getByRole('combobox', { name: '经典播放速度', exact: true }).selectOption(rate);
  const stage = p.getByRole('region', { name: '经典问题执行观察', exact: true });
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
    test(`${spec.kind} minimal ${width}px: actual storage, source and controls`, async ({
      page: p,
    }) => {
      await p.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await observeCaseSetExecution(p);
      await ready(p, spec);
      await run(p, spec.defaultInput);
      const { result } = await captured(p, `${spec.kind}-visual-${width}`),
        cursor = Math.floor(result.trace!.steps.length / 2);
      await seek(p, cursor);
      await sameState(p, result, cursor, spec);
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await p.screenshot({ path: `${folder}/${spec.kind}-${width}.png`, fullPage: true });
      if (width < 1000) await p.getByRole('tab', { name: '实际C++源码', exact: true }).click();
      await expect(p.getByTestId('classic-source')).toBeVisible();
      await p.screenshot({ path: `${folder}/${spec.kind}-source-${width}.png`, fullPage: true });
    });
for (const spec of specs)
  test(`${spec.kind} values/memory/stack share one cursor and selecting caller never seeks`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await ready(p, spec);
    const before = await native(p);
    await run(p, spec.defaultInput);
    const { result } = await captured(p, `${spec.kind}-views`),
      player = new MemoryPlayer();
    player.accept(result);
    let point = Math.floor(player.snapshot().length / 2),
      max = 0;
    if (spec.kind === 'hanoi')
      for (let i = 1; i <= player.snapshot().length; i++) {
        player.seek(i);
        const s = player.snapshot().state!;
        if (s.frames.length > max && s.objects.some((o) => o.alive && o.name === 'positions')) {
          max = s.frames.length;
          point = i;
        }
      }
    await seek(p, point);
    const state = await sameState(p, result, point, spec),
      id = state.objects.find((o) => o.alive)!.id,
      runId = await workspace(p).getAttribute('data-run-id');
    await p.getByRole('combobox', { name: '经典观察视图', exact: true }).selectOption('memory');
    await p.getByRole('combobox', { name: '查看内存对象', exact: true }).selectOption(id);
    await expect(p.getByTestId('memory-object')).toHaveAttribute('data-object-id', id);
    await expect(p.getByTestId('memory-object')).toHaveAttribute('data-alive', 'true');
    await p.getByRole('combobox', { name: '经典观察视图', exact: true }).selectOption('stack');
    await expect(p.getByTestId('stack-depth')).toHaveText(String(state.frames.length));
    expect(
      await p
        .getByTestId('stack-frame')
        .evaluateAll((xs) => xs.map((x) => x.getAttribute('data-frame-id'))),
    ).toEqual(state.frames.toReversed().map((f) => f.id));
    if (state.frames.length > 1) {
      await p.getByTestId('stack-frame').last().click();
      await expect(p.getByTestId('stack-details')).toHaveAttribute(
        'data-frame-id',
        state.frames[0].id,
      );
      await expect(p.getByTestId('stack-current-function')).toHaveText(
        state.frames.at(-1)!.functionName,
      );
    }
    await expect(workspace(p)).toHaveAttribute('data-cursor', String(point));
    await p.getByRole('combobox', { name: '经典观察视图', exact: true }).selectOption('values');
    await sameState(p, result, point, spec);
    await expect(workspace(p)).toHaveAttribute('data-run-id', runId!);
    expect(
      await p.evaluate(
        () => window.__verticalObservation.workers.filter((w) => w.moduleSeen).length,
      ),
    ).toBe(1);
    expect(await native(p)).toEqual(before);
  });
test('Hanoi declared/uninitialized, initialized, moved-before-count/output and returned objects reverse exactly', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  await run(p, [2]);
  const { result } = await captured(p, 'hanoi-atomic'),
    declaration = result.trace!.steps.find((s) =>
      s.changes.some(
        (c) =>
          c.op === 'record' &&
          c.table === 'objects' &&
          c.after &&
          'name' in c.after &&
          c.after.name === 'positions',
      ),
    )!;
  await seek(p, declaration.seq);
  const initial = await sameState(p, result, declaration.seq, specs[0]),
    id = initial.objects.find((o) => o.alive && o.name === 'positions')!.id;
  await expect(p.getByTestId('hanoi-uninitialized')).toBeVisible();
  await expect(p.getByTestId('hanoi-disk')).toHaveCount(0);
  const write = result.trace!.steps.find((s) =>
    s.changes.some((c) => c.op === 'cell' && c.objectId === id),
  )!;
  await seek(p, write.seq);
  const moved = await sameState(p, result, write.seq, specs[0]);
  const main = moved.frames.find((f) => f.parentFrameId === null)!,
    status = moved.objects.find((o) => o.alive && o.frameId === main.id && o.name === 'moveState')!;
  expect(memorySlots(status, result.types)[0].value).toBe(0);
  expect(moved.output).toBe('');
  await expect(p.getByTestId('hanoi-disk')).toHaveCount(2);
  await seek(p, write.seq - 1);
  await sameState(p, result, write.seq - 1, specs[0]);
  expect(
    await p
      .getByTestId('hanoi-disk')
      .evaluateAll((xs) => xs.map((x) => x.getAttribute('data-peg'))),
  ).toEqual(['0', '0']);
  const removal = result.trace!.steps.find((s) =>
    s.changes.some(
      (c) =>
        c.op === 'record' &&
        c.table === 'objects' &&
        c.id === id &&
        c.after &&
        'alive' in c.after &&
        !c.after.alive,
    ),
  )!;
  await seek(p, removal.seq);
  await sameState(p, result, removal.seq, specs[0]);
  await expect(p.getByTestId('hanoi-disk')).toHaveCount(0);
  await seek(p, removal.seq - 1);
  await sameState(p, result, removal.seq - 1, specs[0]);
  await expect(p.getByTestId('hanoi-disk')).toHaveCount(2);
});
test('catalog, presets, fixed arity, fresh case identity and unknown route', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  await run(p, [1]);
  const a = await captured(p, 'identity-hanoi');
  for (const s of specs[0].boundarySamples) {
    await p.getByRole('combobox', { name: '经典边界样例' }).selectOption(s.id);
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    expect(await p.getByTestId('classic-input').inputValue()).toBe(s.input.join(' '));
  }
  await p.getByRole('button', { name: '恢复示例', exact: true }).click();
  expect(await p.getByTestId('classic-input').inputValue()).toBe('3');
  await p.getByRole('link', { name: specs[1].title, exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  await run(p, [84, -30]);
  const b = await captured(p, 'identity-gcd');
  expect(b.result.identity.runId).not.toBe(a.result.identity.runId);
  await p.goto('/#/cases');
  await expect(p.getByTestId('cpp-classic-catalog').getByRole('link')).toHaveCount(4);
  await expect(p.getByTestId('cpp-node-catalog').getByRole('link')).toHaveCount(2);
  await expect(p.getByTestId('cpp-structure-catalog').getByRole('link')).toHaveCount(2);
  await expect(p.locator('main a[href^="#/algorithms/"]')).toHaveCount(6);
  await expect(p.locator('main a[href^="#/visualize/"]')).toHaveCount(7);
  await p.goto('/#/classics/missing');
  await expect(p.getByRole('heading', { name: '找不到这个经典案例' })).toBeVisible();
});
test('old C, six sorts, two structures, two node cases, both comparisons and prior observed Hanoi retain boundaries', async ({
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
  }
  for (const slug of ['array-stack', 'circular-queue']) {
    await p.goto('/#/structures/case.cpp.' + slug);
    await p.getByRole('button', { name: '运行C++操作', exact: true }).click();
    await expect(p.getByTestId('structure-workspace')).toHaveAttribute('data-state', 'ready');
  }
  for (const slug of ['singly-linked-list', 'binary-search-tree']) {
    await p.goto('/#/nodes/case.cpp.' + slug);
    await p.getByRole('button', { name: '运行C++节点操作', exact: true }).click();
    await expect(p.getByTestId('node-workspace')).toHaveAttribute('data-state', 'ready');
  }
  await p.goto('/#/visualize/case.c.assignment');
  await p.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(p.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  await p.goto('/#/memory?example=hanoi&view=stack');
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
  await ready(p, specs[3]);
  await run(p, [101]);
  await captured(p, 'engine-switch-return');
  expect(await native(p)).toEqual(before);
});
