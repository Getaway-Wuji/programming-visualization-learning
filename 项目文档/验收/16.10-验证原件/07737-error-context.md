# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: linked-nodes.spec.ts >> actual list default: source, pointer commit states, output and reverse
- Location: tests\browser\linked-nodes.spec.ts:264:5

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('.app-shell')
Expected: "ready"
Received: "unsaved"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" locator('.app-shell') with timeout 5000ms
  - waiting for locator('.app-shell')
    - locator resolved to <div data-nav-open="false" data-sidebar="expanded" class="app-shell p05-app" data-workbench-mode="standard" data-review-storage-status="failed" data-learning-goal-status="loading" data-learning-reading-status="ready" data-learning-profile-status="ready" data-learning-reward-status="loading" data-learning-storage-status="loading" data-learning-practice-status="failed" data-achievement-storage-status="failed">…</div>
    - unexpected value "loading"
    13 × locator resolved to <div data-nav-open="false" data-sidebar="expanded" class="app-shell p05-app" data-workbench-mode="standard" data-review-storage-status="failed" data-learning-goal-status="loading" data-learning-reading-status="ready" data-learning-profile-status="ready" data-learning-reward-status="loading" data-learning-storage-status="unsaved" data-learning-practice-status="failed" data-achievement-storage-status="failed">…</div>
       - unexpected value "unsaved"

```

```yaml
- link "跳到主要内容":
  - /url: "#main-content"
- complementary:
  - button "收起侧栏" [expanded]
  - link "编程可视化教学平台 · 学习首页":
    - /url: "#/"
    - text: "{ } 一步一懂 编程可视化教学平台"
  - paragraph: 从代码，到理解。
  - navigation "主导航"
  - strong: 按自己的节奏学习
  - paragraph: 学习记录将保存在当前浏览器，不跨设备同步。
  - link "了解本地数据":
    - /url: "#/settings?panel=data"
- banner:
  - text: C 语言 · 从零开始
  - button "进入专注模式": 专注
  - text: 本地学习
  - link "本地数据":
    - /url: "#/settings?panel=data"
  - button "切换为深色"
- main:
  - navigation "当前位置"
  - paragraph: C++ · 操作序列 · 真实回放
  - heading "单链表" [level=1]
  - paragraph: 沿真实指针逐步核对位置插入、断链删除与遍历，分清存活节点和释放墓碑。
  - region "节点操作序列"
  - text: 拖动中间分隔条调整宽度
  - button "恢复默认比例" [disabled]
  - region "实际C++源码"
  - separator "调整面板宽度"
  - region "节点观察"
  - group: 算法、输入编码与观察目标
  - navigation "切换链表与BST案例"
```

# Test source

```ts
  1   | import { mkdir, writeFile } from 'node:fs/promises';
  2   | import { readFileSync } from 'node:fs';
  3   | import { gzipSync } from 'node:zlib';
  4   | import { test, expect, type Page } from '@playwright/test';
  5   | import { observeCaseSetExecution } from './case-set-observation';
  6   | import { native, clear } from './achievement-helpers';
  7   | import {
  8   |   decodeMemoryResult,
  9   |   type MemoryRequest,
  10  |   type MemoryResult,
  11  | } from '../../web/src/engine/memory-protocol';
  12  | import { MemoryPlayer } from '../../web/src/engine/memory-player';
  13  | import { engineBuild } from '../../web/src/generated/memory/engine-build';
  14  | import type { NodeCase } from '../../web/src/node-cases/content';
  15  | import { nodesView, mainScalar } from '../../web/src/node-cases/presentation';
  16  | const specs = JSON.parse(readFileSync('content/algorithms/cpp/linked-nodes-1.0.0.json', 'utf8'))
  17  |   .cases as NodeCase[];
  18  | const folder = `.artifacts/16.8/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
  19  | test.beforeAll(() => mkdir(folder, { recursive: true }));
  20  | const workspace = (p: Page) => p.getByTestId('node-workspace');
  21  | async function ready(p: Page, spec = specs[0]) {
  22  |   await p.goto('/#/nodes/' + spec.id);
> 23  |   await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
      |                                         ^ Error: expect(locator).toHaveAttribute(expected) failed
  24  |   await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
  25  |   await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  26  |   await p.evaluate(() =>
  27  |     document.addEventListener(
  28  |       'click',
  29  |       (e) => {
  30  |         if ((e.target as HTMLElement).closest('button')?.textContent === '运行C++节点操作')
  31  |           Object.assign(window, { nodeObservedClickAt: performance.now() });
  32  |       },
  33  |       true,
  34  |     ),
  35  |   );
  36  | }
  37  | function encode(spec: NodeCase, draft: string) {
  38  |   return draft === '[]'
  39  |     ? []
  40  |     : draft
  41  |         .split('\n')
  42  |         .filter((l) => l.trim())
  43  |         .flatMap((line) => {
  44  |           const [c, ...args] = line.trim().split(/\s+/);
  45  |           return [
  46  |             (
  47  |               (spec.kind === 'list'
  48  |                 ? { 插: 1, 删: 2, 遍历: 3 }
  49  |                 : { 插: 1, 查: 2, 前序: 3, 中序: 4, 后序: 5 }) as Record<string, number>
  50  |             )[c]!,
  51  |             ...args.map(Number),
  52  |           ];
  53  |         });
  54  | }
  55  | async function run(p: Page, draft: string) {
  56  |   await p.getByTestId('node-input').fill(draft);
  57  |   await p.getByRole('button', { name: '运行C++节点操作', exact: true }).click();
  58  |   await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
  59  | }
  60  | async function captured(p: Page, label: string) {
  61  |   const raw = await p.evaluate(() => {
  62  |     const record = window.__verticalObservation.workers.findLast(
  63  |       (w) => w.moduleSeen && w.responseOk,
  64  |     );
  65  |     if (!record) throw Error('Actual native Worker required');
  66  |     return {
  67  |       moduleSeen: record.moduleSeen,
  68  |       terminated: record.terminated,
  69  |       timing: (record as unknown as { timing: Record<string, number | null> }).timing,
  70  |       observedClickAt: (window as unknown as { nodeObservedClickAt: number }).nodeObservedClickAt,
  71  |       ...(
  72  |         record as unknown as {
  73  |           captureEncoded: () => { requestBase64: string; responseBase64: string };
  74  |         }
  75  |       ).captureEncoded(),
  76  |     };
  77  |   });
  78  |   expect(raw.terminated).toBe(true);
  79  |   await writeFile(`${folder}/${label}-worker.json.gz`, gzipSync(JSON.stringify(raw)), {
  80  |     flag: 'wx',
  81  |   });
  82  |   const request = JSON.parse(Buffer.from(raw.requestBase64, 'base64').toString()) as MemoryRequest,
  83  |     result = await decodeMemoryResult(
  84  |       Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
  85  |       request,
  86  |       engineBuild.wasmSha256,
  87  |     );
  88  |   return { request, result };
  89  | }
  90  | async function seek(p: Page, cursor: number) {
  91  |   await p.getByRole('slider', { name: '节点执行步骤', exact: true }).fill(String(cursor));
  92  |   await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
  93  | }
  94  | async function sameState(p: Page, result: MemoryResult, cursor: number, spec: NodeCase) {
  95  |   const player = new MemoryPlayer();
  96  |   player.accept(result);
  97  |   player.seek(cursor);
  98  |   const state = player.snapshot().state!,
  99  |     view = nodesView(state, result.types, spec, cursor ? result.trace!.steps[cursor - 1] : null);
  100 |   for (const [k, v] of Object.entries(state.counters))
  101 |     await expect(p.getByTestId(`node-counter-${k}`)).toHaveText(String(v));
  102 |   await expect(p.getByTestId('node-output')).toHaveText(state.output || '（无输出）');
  103 |   await expect(p.getByTestId('node-graph')).toHaveAttribute('data-size', String(view.size ?? ''));
  104 |   await expect(p.getByTestId('node-graph')).toHaveAttribute(
  105 |     'data-outcome',
  106 |     String(view.outcome ?? ''),
  107 |   );
  108 |   await expect(p.getByTestId('node-record')).toHaveCount(view.nodes.length);
  109 |   await expect(p.getByTestId('node-tombstone')).toHaveCount(view.ended.length);
  110 |   await expect(p.getByTestId('node-edge')).toHaveCount(view.edges.length);
  111 |   for (const n of view.nodes) {
  112 |     const row = p.locator(`[data-testid="node-record"][data-object-id="${n.object.id}"]`);
  113 |     await expect(row).toHaveAttribute(
  114 |       'data-value',
  115 |       String(typeof n.value === 'number' ? n.value : 'uninitialized'),
  116 |     );
  117 |     await expect(row).toHaveAttribute('data-reachable', String(n.reachable));
  118 |     for (const f of n.fields) {
  119 |       const field = row.locator(`[data-testid="node-field"][data-name="${f.name}"]`);
  120 |       await expect(field).toHaveAttribute('data-kind', f.kind);
  121 |       await expect(field).toHaveAttribute('data-target', f.value?.objectId ?? '');
  122 |       await expect(field).toHaveAttribute('data-offset', String(f.value?.byteOffset ?? ''));
  123 |       await expect(field).toHaveAttribute('data-lower', String(f.value?.lowerBound ?? ''));
```