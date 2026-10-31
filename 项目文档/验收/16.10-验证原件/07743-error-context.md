# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: structures.spec.ts >> actual circular-queue default: source, encoding, commit order, residuals and reverse
- Location: tests\browser\structures.spec.ts:139:5

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
    12 × locator resolved to <div data-nav-open="false" data-sidebar="expanded" class="app-shell p05-app" data-workbench-mode="standard" data-review-storage-status="failed" data-learning-goal-status="loading" data-learning-reading-status="ready" data-learning-profile-status="ready" data-learning-reward-status="loading" data-learning-storage-status="unsaved" data-learning-practice-status="failed" data-achievement-storage-status="failed">…</div>
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
  - heading "环形队列" [level=1]
  - paragraph: 沿真实C++操作观察先进先出，用读写序号取模复用五个物理槽。
  - region "结构操作序列"
  - text: 拖动中间分隔条调整宽度
  - button "恢复默认比例" [disabled]
  - region "实际C++源码"
  - separator "调整面板宽度"
  - region "结构观察"
  - group: 算法、输入编码与观察目标
  - navigation "切换栈与队列案例"
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
  8   |   decodeAlgorithmResult,
  9   |   type AlgorithmRequest,
  10  |   type AlgorithmResult,
  11  | } from '../../web/src/engine/algorithm-protocol';
  12  | import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
  13  | import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
  14  | import type { StructureCase } from '../../web/src/structures/content';
  15  | import { scalarValue, structureView } from '../../web/src/structures/presentation';
  16  | import { slotValue } from '../../web/src/algorithms/presentation';
  17  | const specs = JSON.parse(readFileSync('content/algorithms/cpp/stack-queue-1.0.0.json', 'utf8'))
  18  |   .cases as StructureCase[];
  19  | const folder = `.artifacts/16.7/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
  20  | test.beforeAll(() => mkdir(folder, { recursive: true }));
  21  | const workspace = (p: Page) => p.getByTestId('structure-workspace');
  22  | async function ready(p: Page, spec = specs[0]) {
  23  |   await p.goto('/#/structures/' + spec.id);
> 24  |   await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
      |                                         ^ Error: expect(locator).toHaveAttribute(expected) failed
  25  |   await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
  26  |   await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  27  |   await p.evaluate(() =>
  28  |     document.addEventListener(
  29  |       'click',
  30  |       (e) => {
  31  |         if ((e.target as HTMLElement).closest('button')?.textContent === '运行C++操作')
  32  |           Object.assign(window, { structureObservedClickAt: performance.now() });
  33  |       },
  34  |       true,
  35  |     ),
  36  |   );
  37  | }
  38  | function encode(draft: string) {
  39  |   return draft === '[]'
  40  |     ? []
  41  |     : draft
  42  |         .split('\n')
  43  |         .filter((x) => x.trim())
  44  |         .flatMap((line) => (line.trim() === '出' ? [2] : [1, Number(line.trim().split(/\s+/)[1])]));
  45  | }
  46  | async function run(p: Page, draft: string) {
  47  |   await p.getByTestId('structure-input').fill(draft);
  48  |   await p.getByRole('button', { name: '运行C++操作', exact: true }).click();
  49  |   await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
  50  | }
  51  | async function captured(p: Page, label: string) {
  52  |   const raw = await p.evaluate(() => {
  53  |     const record = window.__verticalObservation.workers.findLast(
  54  |       (w) => w.moduleSeen && w.responseOk,
  55  |     );
  56  |     if (!record) throw Error('Actual production Worker required');
  57  |     return {
  58  |       moduleSeen: record.moduleSeen,
  59  |       terminated: record.terminated,
  60  |       timing: (record as unknown as { timing: Record<string, number | null> }).timing,
  61  |       observedClickAt: (window as unknown as { structureObservedClickAt: number })
  62  |         .structureObservedClickAt,
  63  |       ...(
  64  |         record as unknown as {
  65  |           captureEncoded: () => { requestBase64: string; responseBase64: string };
  66  |         }
  67  |       ).captureEncoded(),
  68  |     };
  69  |   });
  70  |   expect(raw.terminated).toBe(true);
  71  |   await writeFile(`${folder}/${label}-worker.json.gz`, gzipSync(JSON.stringify(raw)), {
  72  |     flag: 'wx',
  73  |   });
  74  |   const request = JSON.parse(
  75  |     Buffer.from(raw.requestBase64, 'base64').toString(),
  76  |   ) as AlgorithmRequest;
  77  |   const result = await decodeAlgorithmResult(
  78  |     Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
  79  |     request,
  80  |     engineBuild.wasmSha256,
  81  |   );
  82  |   return { request, result };
  83  | }
  84  | async function seek(p: Page, cursor: number) {
  85  |   await p.getByRole('slider', { name: '结构执行步骤', exact: true }).fill(String(cursor));
  86  |   await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
  87  | }
  88  | async function sameState(p: Page, result: AlgorithmResult, cursor: number, spec: StructureCase) {
  89  |   const player = new AlgorithmPlayer();
  90  |   player.accept(result);
  91  |   player.seek(cursor);
  92  |   const state = player.snapshot().state!,
  93  |     step = cursor ? result.trace!.steps[cursor - 1] : null,
  94  |     view = structureView(state, step, spec);
  95  |   for (const [key, value] of Object.entries(state.counters))
  96  |     await expect(p.getByTestId(`structure-counter-${key}`)).toHaveText(String(value));
  97  |   await expect(p.getByTestId('structure-output')).toHaveText(state.output || '（无输出）');
  98  |   for (const o of state.objects.filter((o) => o.kind === 'int'))
  99  |     await expect(
  100 |       p
  101 |         .getByTestId('structure-variable')
  102 |         .filter({ has: p.locator('small', { hasText: `${o.id} · ${o.scopeId}` }) })
  103 |         .locator('b'),
  104 |     ).toHaveText(String(slotValue(o, 0) ?? '未初始化'));
  105 |   if (!view.data) {
  106 |     await expect(p.getByTestId('structure-cell')).toHaveCount(0);
  107 |     return state;
  108 |   }
  109 |   await expect(p.getByTestId('structure-data')).toHaveAttribute('data-object-id', view.data.id);
  110 |   await expect(p.getByTestId('structure-cell')).toHaveCount(5);
  111 |   for (const c of view.cells) {
  112 |     const cell = p.locator(`[data-testid="structure-cell"][data-index="${c.index}"]`);
  113 |     await expect(cell).toHaveAttribute('data-value', String(c.value ?? 'uninitialized'));
  114 |     await expect(cell).toHaveAttribute(
  115 |       'data-valid',
  116 |       c.valid === null ? 'unknown' : String(c.valid),
  117 |     );
  118 |     await expect(cell).toHaveAttribute('data-write', String(c.write));
  119 |     await expect(cell).toHaveAttribute('data-address', String(c.virtualAddress));
  120 |   }
  121 |   await expect(p.getByTestId('structure-outcome')).toHaveAttribute(
  122 |     'data-code',
  123 |     String(view.outcome ?? ''),
  124 |   );
```