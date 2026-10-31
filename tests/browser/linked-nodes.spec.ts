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
import type { NodeCase } from '../../web/src/node-cases/content';
import { nodesView, mainScalar } from '../../web/src/node-cases/presentation';
const specs = JSON.parse(readFileSync('content/algorithms/cpp/linked-nodes-1.0.0.json', 'utf8'))
  .cases as NodeCase[];
const folder = `.artifacts/16.8/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
test.beforeAll(() => mkdir(folder, { recursive: true }));
const workspace = (p: Page) => p.getByTestId('node-workspace');
async function ready(p: Page, spec = specs[0]) {
  await p.goto('/#/nodes/' + spec.id);
  await waitForPhase2Archive(p);
  await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  await p.evaluate(() =>
    document.addEventListener(
      'click',
      (e) => {
        if ((e.target as HTMLElement).closest('button')?.textContent === '运行C++节点操作')
          Object.assign(window, { nodeObservedClickAt: performance.now() });
      },
      true,
    ),
  );
}
function encode(spec: NodeCase, draft: string) {
  return draft === '[]'
    ? []
    : draft
        .split('\n')
        .filter((l) => l.trim())
        .flatMap((line) => {
          const [c, ...args] = line.trim().split(/\s+/);
          return [
            (
              (spec.kind === 'list'
                ? { 插: 1, 删: 2, 遍历: 3 }
                : { 插: 1, 查: 2, 前序: 3, 中序: 4, 后序: 5 }) as Record<string, number>
            )[c]!,
            ...args.map(Number),
          ];
        });
}
async function run(p: Page, draft: string) {
  await p.getByTestId('node-input').fill(draft);
  await p.getByRole('button', { name: '运行C++节点操作', exact: true }).click();
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
      observedClickAt: (window as unknown as { nodeObservedClickAt: number }).nodeObservedClickAt,
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
  await p.getByRole('slider', { name: '节点执行步骤', exact: true }).fill(String(cursor));
  await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
}
async function sameState(p: Page, result: MemoryResult, cursor: number, spec: NodeCase) {
  const player = new MemoryPlayer();
  player.accept(result);
  player.seek(cursor);
  const state = player.snapshot().state!,
    view = nodesView(state, result.types, spec, cursor ? result.trace!.steps[cursor - 1] : null);
  for (const [k, v] of Object.entries(state.counters))
    await expect(p.getByTestId(`node-counter-${k}`)).toHaveText(String(v));
  await expect(p.getByTestId('node-output')).toHaveText(state.output || '（无输出）');
  await expect(p.getByTestId('node-graph')).toHaveAttribute('data-size', String(view.size ?? ''));
  await expect(p.getByTestId('node-graph')).toHaveAttribute(
    'data-outcome',
    String(view.outcome ?? ''),
  );
  await expect(p.getByTestId('node-record')).toHaveCount(view.nodes.length);
  await expect(p.getByTestId('node-tombstone')).toHaveCount(view.ended.length);
  await expect(p.getByTestId('node-edge')).toHaveCount(view.edges.length);
  for (const n of view.nodes) {
    const row = p.locator(`[data-testid="node-record"][data-object-id="${n.object.id}"]`);
    await expect(row).toHaveAttribute(
      'data-value',
      String(typeof n.value === 'number' ? n.value : 'uninitialized'),
    );
    await expect(row).toHaveAttribute('data-reachable', String(n.reachable));
    for (const f of n.fields) {
      const field = row.locator(`[data-testid="node-field"][data-name="${f.name}"]`);
      await expect(field).toHaveAttribute('data-kind', f.kind);
      await expect(field).toHaveAttribute('data-target', f.value?.objectId ?? '');
      await expect(field).toHaveAttribute('data-offset', String(f.value?.byteOffset ?? ''));
      await expect(field).toHaveAttribute('data-lower', String(f.value?.lowerBound ?? ''));
      await expect(field).toHaveAttribute('data-upper', String(f.value?.upperBound ?? ''));
    }
  }
  for (const edge of view.edges)
    await expect(
      p.locator(`[data-testid="node-edge"][data-from="${edge.from}"][data-field="${edge.field}"]`),
    ).toHaveAttribute('data-to', edge.to);
  return state;
}
type Tree = { value: number; left: Tree | null; right: Tree | null };
function insert(t: Tree | null, v: number): Tree {
  if (!t) return { value: v, left: null, right: null };
  if (v < t.value) t.left = insert(t.left, v);
  else t.right = insert(t.right, v);
  return t;
}
function order(t: Tree | null, k: number): number[] {
  return t
    ? [
        ...(k === 3 ? [t.value] : []),
        ...order(t.left, k),
        ...(k === 4 ? [t.value] : []),
        ...order(t.right, k),
        ...(k === 5 ? [t.value] : []),
      ]
    : [];
}
function expectedCommits(spec: NodeCase, input: number[]) {
  const list: number[] = [],
    unique = new Set<number>();
  let tree: Tree | null = null,
    at = 0,
    output = '';
  const commits: {
    size: number;
    outcome: number;
    consumed: number;
    output: string;
    list: number[];
    tree: Tree | null;
  }[] = [];
  while (at < input.length) {
    const code = input[at++];
    let outcome: number;
    if (spec.kind === 'list') {
      if (code === 1) {
        const pos = input[at++],
          v = input[at++];
        if (pos < 0 || pos > list.length) {
          output += `RANGE ${pos}\n`;
          outcome = 5;
        } else if (list.length === 7) {
          output += `FULL ${v}\n`;
          outcome = 4;
        } else {
          list.splice(pos, 0, v);
          output += `INSERT ${v}\n`;
          outcome = 1;
        }
      } else if (code === 2) {
        const pos = input[at++];
        if (pos < 0 || pos >= list.length) {
          output += `RANGE ${pos}\n`;
          outcome = 5;
        } else {
          output += `DELETE ${list.splice(pos, 1)[0]}\n`;
          outcome = 2;
        }
      } else {
        output += 'LIST' + list.map((v) => ' ' + v).join('') + '\n';
        outcome = 3;
      }
    } else {
      if (code === 1) {
        const v = input[at++];
        if (unique.has(v)) {
          output += `DUP ${v}\n`;
          outcome = 6;
        } else if (unique.size === 7) {
          output += `FULL ${v}\n`;
          outcome = 4;
        } else {
          unique.add(v);
          tree = insert(tree, v);
          output += `INSERT ${v}\n`;
          outcome = 1;
        }
      } else if (code === 2) {
        const v = input[at++],
          found = unique.has(v);
        output += `${found ? 'FOUND' : 'MISS'} ${v}\n`;
        outcome = found ? 7 : 8;
      } else {
        output +=
          { 3: 'PRE', 4: 'IN', 5: 'POST' }[code]! +
          order(tree, code)
            .map((v) => ' ' + v)
            .join('') +
          '\n';
        outcome = 3;
      }
    }
    commits.push({
      size: spec.kind === 'list' ? list.length : unique.size,
      outcome,
      consumed: at,
      output,
      list: [...list],
      tree: structuredClone(tree),
    });
  }
  return { commits, output: output + 'END\n' };
}
for (const spec of specs) {
  const samples = [
    { id: 'default', draft: spec.defaultDraft },
    { id: 'no-ops', draft: '[]' },
    ...spec.boundaryDrafts,
    ...(spec.kind === 'list'
      ? [
          { id: 'single', draft: '插 0 -999\n遍历\n删 0\n遍历' },
          { id: 'duplicates', draft: '插 0 0\n插 1 0\n插 1 0\n遍历\n删 1\n遍历' },
          { id: 'max-in', draft: Array.from({ length: 10 }, (_, i) => `插 0 ${i}`).join('\n') },
          { id: 'max-alternate', draft: Array(6).fill('插 0 0\n删 0').join('\n') },
          { id: 'max-empty-traverse', draft: Array(30).fill('遍历').join('\n') },
        ]
      : [
          { id: 'single', draft: '插 0\n查 0\n前序\n中序\n后序' },
          { id: 'max-in', draft: Array.from({ length: 15 }, (_, i) => `插 ${i}`).join('\n') },
          {
            id: 'max-find',
            draft: [
              ...Array.from({ length: 7 }, (_, i) => `插 ${i}`),
              ...Array.from({ length: 8 }, (_, i) => `查 ${i}`),
            ].join('\n'),
          },
          { id: 'max-empty-traverse', draft: Array(10).fill('前序\n中序\n后序').join('\n') },
        ]),
  ];
  for (const sample of samples)
    test(`actual ${spec.kind} ${sample.id}: source, pointer commit states, output and reverse`, async ({
      page: p,
    }) => {
      await observeCaseSetExecution(p);
      await ready(p, spec);
      const before = await native(p);
      await run(p, sample.draft);
      const { request, result } = await captured(p, `${spec.kind}-${sample.id}`),
        input = encode(spec, sample.draft),
        source = readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', String(input.length)),
        expected = expectedCommits(spec, input);
      expect(request.source).toBe(source);
      expect(request.input).toEqual(input);
      expect(request.engineId).toBe('engine.rust.memory');
      expect(request.language).toBe('cpp');
      expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 0 });
      await expect(p.getByTestId('node-source')).toHaveText(source);
      expect(await p.getByLabel('可复制的完整节点C++源码').inputValue()).toBe(source);
      const player = new MemoryPlayer();
      player.accept(result);
      const initial = player.snapshot(),
        points: number[] = [];
      let done = 0,
        maxFrames = 0,
        maxHeap = 0;
      for (let i = 1; i <= player.snapshot().length; i++) {
        player.seek(i);
        const state = player.snapshot().state!,
          view = nodesView(state, result.types, spec, result.trace!.steps[i - 1]);
        maxFrames = Math.max(maxFrames, state.frames.length);
        maxHeap = Math.max(maxHeap, view.nodes.length);
        expect(view.nodes.length).toBeLessThanOrEqual(7);
        const processed = mainScalar(state, result.types, 'processed');
        if (processed === null || processed === done) continue;
        expect(processed).toBe(done + 1);
        const e = expected.commits[done];
        expect(view.size).toBe(e.size);
        expect(view.outcome).toBe(e.outcome);
        expect(view.consumed).toBe(e.consumed);
        expect(state.control.inputCursor).toBe(e.consumed);
        expect(state.output).toBe(e.output);
        expect(view.nodes.length).toBe(e.size);
        expect(view.reachableCount).toBe(e.size);
        done = processed;
        points.push(i);
      }
      expect(done).toBe(expected.commits.length);
      expect(maxFrames).toBeLessThanOrEqual(spec.kind === 'list' ? 2 : 9);
      expect(player.snapshot().state!.output).toBe(expected.output);
      for (let i = result.trace!.steps.length - 1; i >= 0; i--) player.seek(i);
      expect(player.snapshot()).toEqual(initial);
      const length = result.trace!.steps.length;
      for (const point of [
        ...new Set([
          0,
          ...points.filter((_, i) => i === 0 || i === 6 || i === 7 || i === points.length - 1),
          length - 1,
          length,
        ]),
      ]) {
        await seek(p, point);
        await sameState(p, result, point, spec);
      }
      const point = points[0] ?? Math.floor(length / 2);
      await seek(p, point);
      const saved = await sameState(p, result, point, spec),
        range = result.nodeMap.find(
          (n) => n.nodeId === result.trace!.steps[point - 1].nodeId,
        )!.byteRange;
      await expect(p.getByTestId('node-source-highlight')).toHaveAttribute(
        'data-byte-start',
        String(range.start),
      );
      await expect(p.getByTestId('node-source-highlight')).toHaveAttribute(
        'data-byte-end',
        String(range.end),
      );
      await p.getByRole('button', { name: '前进', exact: true }).click();
      await p.getByRole('button', { name: '后退', exact: true }).click();
      expect(await sameState(p, result, point, spec)).toEqual(saved);
      await p.getByRole('button', { name: '查看末步', exact: true }).click();
      await expect(p.getByTestId('node-output')).toHaveText(expected.output);
      await expect(p.getByTestId('node-terminal')).toContainText('程序正常结束');
      await p.getByRole('button', { name: '回到初态', exact: true }).click();
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
            maxFrames,
            maxHeap,
            terminal: result.terminal,
            expected,
            commits: points,
          },
          null,
          2,
        ),
        { flag: 'wx' },
      );
    });
  test(`${spec.kind} malformed syntax and31 encoded slots create no Worker; edits invalidate accepted state`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await ready(p, spec);
    for (const draft of [
      '',
      '插',
      '插 1.5',
      'push 1',
      spec.kind === 'list' ? '插 0 1000' : '插 1000',
      Array(31)
        .fill(spec.kind === 'list' ? '遍历' : '前序')
        .join('\n'),
    ]) {
      await p.getByTestId('node-input').fill(draft);
      await expect(p.getByRole('button', { name: '运行C++节点操作', exact: true })).toBeDisabled();
      await expect(p.getByRole('alert')).toBeVisible();
      expect(await p.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
    }
    await run(p, spec.kind === 'list' ? '插 -1 -0' : '插 -0\n插 -0');
    const { request } = await captured(p, `${spec.kind}-syntax-recovery`);
    expect(request.input).toEqual(spec.kind === 'list' ? [1, -1, 0] : [1, 0, 1, 0]);
    await p.getByTestId('node-input').fill('bad');
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    await expect(p.getByTestId('node-source')).toHaveText('');
    await expect(p.getByRole('slider', { name: '节点执行步骤', exact: true })).toBeDisabled();
  });
}

async function holdReply(p: Page) {
  await p.addInitScript(() => {
    const Native = window.Worker,
      descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage')!;
    const control = { armed: false, waiting: false, release: () => {} };
    Object.assign(window, { nodeReplyHold: control });
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
    (window as unknown as { nodeReplyHold: Hold }).nodeReplyHold.armed = true;
  });
}
async function held(p: Page) {
  await expect
    .poll(() =>
      p.evaluate(() => (window as unknown as { nodeReplyHold: Hold }).nodeReplyHold.waiting),
    )
    .toBe(true);
}
async function release(p: Page) {
  await p.evaluate(() => (window as unknown as { nodeReplyHold: Hold }).nodeReplyHold.release());
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
    await p.getByRole('button', { name: '运行C++节点操作', exact: true }).click();
    await held(p);
    if (action === 'edit') await p.getByTestId('node-input').fill('插 0 4\n遍历');
    if (action === 'cancel') await p.getByRole('button', { name: '取消运行', exact: true }).click();
    if (action === 'leave') await p.goto('/#/cases');
    if (action === 'switch')
      await p.getByRole('link', { name: '二叉搜索树（BST）', exact: true }).click();
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
      await expect(p.getByTestId('node-error')).toContainText(
        action === 'cancel' ? 'E_CANCELLED' : 'E_DEADLINE',
      );
    } else await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    await expect(p.getByTestId('node-output')).toHaveCount(0);
    await run(p, '插 0 2\n遍历');
    const { request, result } = await captured(p, `retry-${action}`);
    expect(request.input).toEqual([1, 0, 2, 3]);
    expect(result.terminal.status).toBe('completed');
  });
test('native Worker load failure has no stale picture and an explicit new run recovers', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  const worker = /\/memory-worker-[^/]+\.js$/;
  await p.route(worker, (route) => route.abort());
  await p.getByRole('button', { name: '运行C++节点操作', exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-state', 'failed');
  await expect(p.getByTestId('node-output')).toHaveCount(0);
  await p.unroute(worker);
  await run(p, '插 0 1\n插 1 -1');
  const { result } = await captured(p, 'worker-recovery');
  expect(result.terminal.status).toBe('completed');
});
test('one live player supports six speeds, keyboard, source focus and hidden-page pause without new runs', async ({
  page: p,
  context,
}) => {
  await observeCaseSetExecution(p);
  await ready(p, specs[0]);
  await run(p, '插 0 3\n插 1 1\n遍历');
  const { result } = await captured(p, 'controls');
  for (const rate of ['0.25', '0.5', '1', '1.5', '2', '4'])
    await p.getByRole('combobox', { name: '节点播放速度', exact: true }).selectOption(rate);
  const stage = p.getByRole('region', { name: '动态节点执行观察', exact: true });
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
    test(`${spec.kind} minimal ${width}px: live graph, physical identity and source stay usable`, async ({
      page: p,
    }) => {
      await p.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await observeCaseSetExecution(p);
      await ready(p, spec);
      await run(p, spec.defaultDraft);
      const { result } = await captured(p, `${spec.kind}-visual-${width}`),
        player = new MemoryPlayer();
      player.accept(result);
      let point = 0;
      for (let i = 1; i <= player.snapshot().length; i++) {
        player.seek(i);
        if (mainScalar(player.snapshot().state!, result.types, 'processed') === 3) {
          point = i;
          break;
        }
      }
      expect(point).toBeGreaterThan(0);
      await seek(p, point);
      const state = await sameState(p, result, point, spec);
      const rootId = nodesView(state, result.types, spec).anchor.value!.objectId;
      const root = await p
        .locator(`[data-testid="node-figure"][data-object-id="${rootId}"]`)
        .boundingBox();
      const viewport = await p.locator('.node-diagram-scroll').boundingBox();
      expect(
        root &&
          viewport &&
          root.x >= viewport.x &&
          root.x + root.width <= viewport.x + viewport.width,
      ).toBe(true);
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await p.screenshot({ path: `${folder}/${spec.kind}-${width}.png`, fullPage: true });
      if (width < 1000) await p.getByRole('tab', { name: '实际C++源码', exact: true }).click();
      await expect(p.getByTestId('node-source')).toBeVisible();
      await p.screenshot({ path: `${folder}/${spec.kind}-source-${width}.png`, fullPage: true });
    });
for (const spec of specs)
  test(`${spec.kind} graph/memory/stack share the exact cursor, raw object and real frame chain`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await ready(p, spec);
    const before = await native(p);
    await run(p, spec.defaultDraft);
    const { result } = await captured(p, `${spec.kind}-views`),
      player = new MemoryPlayer();
    player.accept(result);
    let point = 0,
      max = 0;
    for (let i = 1; i <= player.snapshot().length; i++) {
      player.seek(i);
      const s = player.snapshot().state!;
      if (s.frames.length > max && s.objects.some((o) => o.alive && o.storage === 'heap')) {
        max = s.frames.length;
        point = i;
      }
    }
    await seek(p, point);
    const state = await sameState(p, result, point, spec),
      id = state.objects.find((o) => o.alive && o.storage === 'heap')!.id,
      runId = await workspace(p).getAttribute('data-run-id');
    await p.getByRole('combobox', { name: '节点观察视图', exact: true }).selectOption('memory');
    await expect(p.getByTestId('memory-panel')).toBeVisible();
    const picker = p.getByRole('combobox', { name: '查看内存对象', exact: true });
    for (let i = 0; i < 40 && !(await picker.locator(`option[value="${id}"]`).count()); i++)
      await p.getByRole('button', { name: '下一页对象', exact: true }).click();
    await picker.selectOption(id);
    await expect(p.getByTestId('memory-object')).toHaveAttribute('data-object-id', id);
    await expect(p.getByTestId('memory-object')).toHaveAttribute('data-alive', 'true');
    await expect(p.getByTestId('memory-object')).toHaveAttribute(
      'data-base-address',
      String(state.objects.find((o) => o.id === id)!.baseAddress),
    );
    await p.getByRole('combobox', { name: '节点观察视图', exact: true }).selectOption('stack');
    await expect(p.getByTestId('stack-depth')).toHaveText(String(state.frames.length));
    expect(
      await p
        .getByTestId('stack-frame')
        .evaluateAll((xs) => xs.map((x) => x.getAttribute('data-frame-id'))),
    ).toEqual(state.frames.toReversed().map((f) => f.id));
    await p.getByRole('combobox', { name: '节点观察视图', exact: true }).selectOption('graph');
    await sameState(p, result, point, spec);
    await expect(workspace(p)).toHaveAttribute('data-run-id', runId!);
    await expect(workspace(p)).toHaveAttribute('data-cursor', String(point));
    expect(
      await p.evaluate(
        () => window.__verticalObservation.workers.filter((w) => w.moduleSeen).length,
      ),
    ).toBe(1);
    expect(await native(p)).toEqual(before);
  });
for (const spec of specs)
  test(`${spec.kind} real allocation before publication, disconnect/release and tombstone reverse`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await ready(p, spec);
    await run(p, spec.kind === 'list' ? '插 0 0\n插 1 7\n删 0\n遍历' : '插 0\n插 -1\n插 1\n中序');
    const { result } = await captured(p, `${spec.kind}-lifetime`),
      allocation = result.trace!.steps.find((s) => s.kind === 'memory.allocate')!;
    await seek(p, allocation.seq);
    const state = await sameState(p, result, allocation.seq, spec),
      node = state.objects.find((o) => o.storage === 'heap' && o.alive)!,
      record = p.locator(`[data-testid="node-record"][data-object-id="${node.id}"]`);
    await expect(record).toHaveAttribute('data-reachable', 'false');
    await expect(record).toHaveAttribute('data-value', '0');
    expect(node.zeroInitialized).toBe(true);
    expect(
      await record
        .getByTestId('node-field')
        .evaluateAll((xs) => xs.map((x) => x.getAttribute('data-kind'))),
    ).toEqual(spec.kind === 'list' ? ['null'] : ['null', 'null']);
    const removal = result.trace!.steps.find(
      (s) =>
        s.kind === 'memory.release' &&
        s.changes.some(
          (c) =>
            c.op === 'record' &&
            c.table === 'objects' &&
            c.after &&
            'storage' in c.after &&
            c.after.storage === 'heap' &&
            !c.after.alive,
        ),
    )!;
    await seek(p, removal.seq);
    const endedState = await sameState(p, result, removal.seq, spec),
      dead = endedState.objects.find((o) => o.storage === 'heap' && !o.alive)!;
    await expect(p.locator(`[data-testid="node-record"][data-object-id="${dead.id}"]`)).toHaveCount(
      0,
    );
    await expect(
      p.locator(`[data-testid="node-tombstone"][data-object-id="${dead.id}"]`),
    ).toContainText('无当前值');
    expect(dead.cells).toEqual([]);
    await expect(p.getByTestId('node-pointer').filter({ hasText: '悬空引用' }).first()).toHaveCount(
      1,
    );
    await seek(p, removal.seq - 1);
    await sameState(p, result, removal.seq - 1, spec);
    await expect(p.locator(`[data-testid="node-record"][data-object-id="${dead.id}"]`)).toHaveCount(
      1,
    );
    await expect(
      p.locator(`[data-testid="node-tombstone"][data-object-id="${dead.id}"]`),
    ).toHaveCount(0);
  });
test('catalog, presets, case identity and unknown route keep existing navigation', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  await run(p, specs[0].defaultDraft);
  const a = await captured(p, 'identity-list');
  for (const preset of specs[0].boundaryDrafts) {
    await p.getByRole('combobox', { name: '节点边界样例' }).selectOption(preset.id);
    await expect(workspace(p)).toHaveAttribute('data-run-id', '');
    expect(await p.getByTestId('node-input').inputValue()).toBe(preset.draft);
  }
  await p.getByRole('button', { name: '恢复示例', exact: true }).click();
  expect(await p.getByTestId('node-input').inputValue()).toBe(specs[0].defaultDraft);
  await p.getByRole('button', { name: '使用空序列', exact: true }).click();
  expect(await p.getByTestId('node-input').inputValue()).toBe('[]');
  await p.getByRole('link', { name: specs[1].title, exact: true }).click();
  await expect(workspace(p)).toHaveAttribute('data-run-id', '');
  await run(p, specs[1].defaultDraft);
  const b = await captured(p, 'identity-bst');
  expect(b.result.identity.runId).not.toBe(a.result.identity.runId);
  await p.goto('/#/cases');
  await expect(p.getByTestId('cpp-node-catalog').getByRole('link')).toHaveCount(2);
  await expect(p.getByTestId('cpp-structure-catalog').getByRole('link')).toHaveCount(2);
  await expect(p.locator('main a[href^="#/visualize/"]')).toHaveCount(7);
  await expect(p.locator('main a[href^="#/algorithms/"]')).toHaveCount(6);
  await p.goto('/#/nodes/missing');
  await expect(p.getByRole('heading', { name: '找不到这个节点案例' })).toBeVisible();
});
test('old six sorts, stack/queue, original C, memory and both comparison routes retain execution and store boundaries', async ({
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
    await p.getByRole('button', { name: '查看末步', exact: true }).click();
    await expect(p.getByTestId('sort-terminal')).toContainText('正常结束');
  }
  for (const slug of ['array-stack', 'circular-queue']) {
    await p.goto('/#/structures/case.cpp.' + slug);
    await p.getByRole('button', { name: '运行C++操作', exact: true }).click();
    await expect(p.getByTestId('structure-workspace')).toHaveAttribute('data-state', 'ready');
    await p.getByRole('button', { name: '查看末步', exact: true }).click();
    await expect(p.getByTestId('structure-terminal')).toContainText('正常结束');
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
  await run(p, '插 999\n中序');
  const { result } = await captured(p, 'engine-switch-return');
  expect(result.engine.id).toBe('engine.rust.memory');
  expect(await native(p)).toEqual(before);
});
