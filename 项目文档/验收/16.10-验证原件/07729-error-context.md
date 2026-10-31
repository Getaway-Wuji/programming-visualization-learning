# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: iterative-sorts.spec.ts >> actual 插入排序 default: source, sorted output, deltas and reverse state
- Location: tests\browser\iterative-sorts.spec.ts:121:5

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
  - paragraph: C++ · 真实执行与回放
  - heading "插入排序" [level=1]
  - paragraph: 暂存一个数，将左侧较大的元素右移，再放回空位。
  - region "排序案例输入"
  - text: 拖动中间分隔条调整宽度
  - button "恢复默认比例" [disabled]
  - region "实际C++源码"
  - separator "调整面板宽度"
  - region "排序观察"
  - group: 算法、限制与观察目标
  - navigation "切换C++排序案例"
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
  14  | import type { SortCase } from '../../web/src/algorithms/content';
  15  | import { slotValue } from '../../web/src/algorithms/presentation';
  16  | 
  17  | // Read the published files independently; Playwright does not use Vite's raw loader.
  18  | const sortCases = JSON.parse(
  19  |   readFileSync('content/algorithms/cpp/iterative-sorts-1.0.0.json', 'utf8'),
  20  | ).cases as SortCase[];
  21  | function expectedSource(spec: SortCase, length: number) {
  22  |   return readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', String(length));
  23  | }
  24  | 
  25  | const folder = `.artifacts/16.4/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
  26  | test.beforeAll(() => mkdir(folder, { recursive: true }));
  27  | const workspace = (p: Page) => p.getByTestId('sort-workspace');
  28  | async function ready(p: Page, spec = sortCases[0]) {
  29  |   await p.goto(`/#/algorithms/${spec.id}`);
> 30  |   await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
      |                                         ^ Error: expect(locator).toHaveAttribute(expected) failed
  31  |   await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
  32  |   await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  33  | }
  34  | async function run(p: Page, values: number[]) {
  35  |   await p.getByTestId('sort-input').fill(values.length ? values.join(' ') : '[]');
  36  |   await p.getByRole('button', { name: '运行C++案例', exact: true }).click();
  37  |   await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
  38  | }
  39  | async function captured(p: Page, label: string) {
  40  |   const raw = await p.evaluate(() => {
  41  |     const record = window.__verticalObservation.workers.findLast(
  42  |       (w) => w.moduleSeen && w.responseOk,
  43  |     );
  44  |     if (!record) throw Error('A real production algorithm Worker is required');
  45  |     return {
  46  |       moduleSeen: record.moduleSeen,
  47  |       terminated: record.terminated,
  48  |       ...(
  49  |         record as unknown as {
  50  |           captureEncoded: () => { requestBase64: string; responseBase64: string };
  51  |         }
  52  |       ).captureEncoded(),
  53  |     };
  54  |   });
  55  |   expect(raw.moduleSeen).toBe(true);
  56  |   expect(raw.terminated).toBe(true);
  57  |   await writeFile(`${folder}/${label}-worker.json.gz`, gzipSync(JSON.stringify(raw)), {
  58  |     flag: 'wx',
  59  |   });
  60  |   const request = JSON.parse(
  61  |     Buffer.from(raw.requestBase64, 'base64').toString(),
  62  |   ) as AlgorithmRequest;
  63  |   const result = await decodeAlgorithmResult(
  64  |     Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
  65  |     request,
  66  |     engineBuild.wasmSha256,
  67  |   );
  68  |   return { request, result };
  69  | }
  70  | async function seek(p: Page, cursor: number) {
  71  |   await p.getByRole('slider', { name: 'C++排序执行步骤', exact: true }).fill(String(cursor));
  72  |   await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
  73  | }
  74  | async function sameState(p: Page, result: AlgorithmResult, cursor: number, inputLength: number) {
  75  |   const player = new AlgorithmPlayer();
  76  |   player.accept(result);
  77  |   player.seek(cursor);
  78  |   const view = player.snapshot(),
  79  |     state = view.state!;
  80  |   for (const [key, value] of Object.entries(state.counters))
  81  |     await expect(p.getByTestId(`sort-counter-${key}`)).toHaveText(String(value));
  82  |   await expect(p.getByTestId('sort-output')).toHaveText(state.output || '（无输出）');
  83  |   for (const name of ['values', 'counts']) {
  84  |     const object = state.objects.find((object) => object.name === name),
  85  |       panel = p
  86  |         .getByTestId('sort-array')
  87  |         .filter({ has: p.locator('h3', { hasText: name === 'values' ? '原数组' : '计数桶' }) });
  88  |     if (!object) {
  89  |       await expect(panel).toHaveCount(0);
  90  |       continue;
  91  |     }
  92  |     const length = name === 'values' ? inputLength : 41;
  93  |     await expect(panel).toHaveAttribute('data-object-id', object.id);
  94  |     await expect(panel.getByTestId('sort-cell')).toHaveCount(length);
  95  |     const actual = await panel
  96  |       .getByTestId('sort-cell')
  97  |       .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-value')));
  98  |     expect(actual).toEqual(
  99  |       Array.from({ length }, (_, index) => String(slotValue(object, index) ?? 'uninitialized')),
  100 |     );
  101 |   }
  102 |   for (const object of state.objects.filter((object) => object.kind === 'int'))
  103 |     await expect(
  104 |       p
  105 |         .getByTestId('sort-variable')
  106 |         .filter({ has: p.locator('small', { hasText: `${object.id} · ${object.scopeId}` }) })
  107 |         .locator('b'),
  108 |     ).toHaveText(String(slotValue(object, 0) ?? '未初始化'));
  109 |   return state;
  110 | }
  111 | for (const spec of sortCases) {
  112 |   const samples = [
  113 |     { id: 'default', values: spec.defaultInput },
  114 |     { id: 'empty', values: [] },
  115 |     { id: 'single', values: [spec.min] },
  116 |     { id: 'duplicates', values: [3, -2, 3, 0, -2, 3] },
  117 |     { id: 'domain-ends', values: [spec.max, spec.min, 0, spec.max, spec.min] },
  118 |     { id: 'capacity-reverse', values: Array.from({ length: 30 }, (_, i) => 15 - i) },
  119 |   ];
  120 |   for (const sample of samples)
  121 |     test(`actual ${spec.title} ${sample.id}: source, sorted output, deltas and reverse state`, async ({
  122 |       page: p,
  123 |     }) => {
  124 |       await observeCaseSetExecution(p);
  125 |       await ready(p, spec);
  126 |       const before = await native(p);
  127 |       await run(p, sample.values);
  128 |       const { request, result } = await captured(p, `${spec.id}-${sample.id}`),
  129 |         preparedSource = expectedSource(spec, sample.values.length);
  130 |       expect(request.language).toBe('cpp');
```