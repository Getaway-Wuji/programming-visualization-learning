# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: bucket-sort.spec.ts >> actual 桶排序 default: source, sorted output, deltas and reverse state
- Location: tests\browser\bucket-sort.spec.ts:215:5

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
  - heading "桶排序" [level=1]
  - paragraph: 将有限域整数依序放入五个桶，在桶内插入排序，再按桶序写回原数组。
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
  18  | const sortCases = JSON.parse(readFileSync('content/algorithms/cpp/bucket-sort-1.0.0.json', 'utf8'))
  19  |   .cases as SortCase[];
  20  | function expectedSource(spec: SortCase, length: number) {
  21  |   return readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', String(length));
  22  | }
  23  | 
  24  | const folder = `.artifacts/16.6/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
  25  | test.beforeAll(() => mkdir(folder, { recursive: true }));
  26  | const workspace = (p: Page) => p.getByTestId('sort-workspace');
  27  | async function ready(p: Page, spec = sortCases[0]) {
  28  |   await p.goto(`/#/algorithms/${spec.id}`);
> 29  |   await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
      |                                         ^ Error: expect(locator).toHaveAttribute(expected) failed
  30  |   await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
  31  |   await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  32  |   await p.evaluate(() => {
  33  |     const observed = window as unknown as {
  34  |       bucketClickObserver?: boolean;
  35  |       bucketObservedClickAt?: number;
  36  |     };
  37  |     if (!observed.bucketClickObserver) {
  38  |       document.addEventListener(
  39  |         'click',
  40  |         (event) => {
  41  |           if ((event.target as HTMLElement).closest('button')?.textContent === '运行C++案例')
  42  |             observed.bucketObservedClickAt = performance.now();
  43  |         },
  44  |         true,
  45  |       );
  46  |       observed.bucketClickObserver = true;
  47  |     }
  48  |   });
  49  | }
  50  | async function run(p: Page, values: number[]) {
  51  |   await p.getByTestId('sort-input').fill(values.length ? values.join(' ') : '[]');
  52  |   await p.getByRole('button', { name: '运行C++案例', exact: true }).click();
  53  |   await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
  54  | }
  55  | async function captured(p: Page, label: string) {
  56  |   const raw = await p.evaluate(() => {
  57  |     const record = window.__verticalObservation.workers.findLast(
  58  |       (w) => w.moduleSeen && w.responseOk,
  59  |     );
  60  |     if (!record) throw Error('A real production algorithm Worker is required');
  61  |     return {
  62  |       moduleSeen: record.moduleSeen,
  63  |       terminated: record.terminated,
  64  |       timing: (record as unknown as { timing: Record<string, number | null> }).timing,
  65  |       observedClickAt:
  66  |         (window as unknown as { bucketObservedClickAt?: number }).bucketObservedClickAt ?? null,
  67  |       ...(
  68  |         record as unknown as {
  69  |           captureEncoded: () => { requestBase64: string; responseBase64: string };
  70  |         }
  71  |       ).captureEncoded(),
  72  |     };
  73  |   });
  74  |   expect(raw.moduleSeen).toBe(true);
  75  |   expect(raw.terminated).toBe(true);
  76  |   await writeFile(`${folder}/${label}-worker.json.gz`, gzipSync(JSON.stringify(raw)), {
  77  |     flag: 'wx',
  78  |   });
  79  |   const request = JSON.parse(
  80  |     Buffer.from(raw.requestBase64, 'base64').toString(),
  81  |   ) as AlgorithmRequest;
  82  |   const result = await decodeAlgorithmResult(
  83  |     Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
  84  |     request,
  85  |     engineBuild.wasmSha256,
  86  |   );
  87  |   return { request, result };
  88  | }
  89  | async function seek(p: Page, cursor: number) {
  90  |   await p.getByRole('slider', { name: 'C++排序执行步骤', exact: true }).fill(String(cursor));
  91  |   await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
  92  | }
  93  | async function sameState(p: Page, result: AlgorithmResult, cursor: number, inputLength: number) {
  94  |   const player = new AlgorithmPlayer();
  95  |   player.accept(result);
  96  |   player.seek(cursor);
  97  |   const view = player.snapshot(),
  98  |     state = view.state!;
  99  |   for (const [key, value] of Object.entries(state.counters))
  100 |     await expect(p.getByTestId(`sort-counter-${key}`)).toHaveText(String(value));
  101 |   await expect(p.getByTestId('sort-output')).toHaveText(state.output || '（无输出）');
  102 |   for (const name of ['values', 'counts']) {
  103 |     const object = state.objects.find((object) => object.name === name),
  104 |       panel = p
  105 |         .getByTestId('sort-array')
  106 |         .filter({ has: p.locator('h3', { hasText: name === 'values' ? '原数组' : '计数桶' }) });
  107 |     if (!object) {
  108 |       await expect(panel).toHaveCount(0);
  109 |       continue;
  110 |     }
  111 |     const length = name === 'values' ? inputLength : 41;
  112 |     await expect(panel).toHaveAttribute('data-object-id', object.id);
  113 |     await expect(panel.getByTestId('sort-cell')).toHaveCount(length);
  114 |     const actual = await panel
  115 |       .getByTestId('sort-cell')
  116 |       .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-value')));
  117 |     expect(actual).toEqual(
  118 |       Array.from({ length }, (_, index) => String(slotValue(object, index) ?? 'uninitialized')),
  119 |     );
  120 |   }
  121 |   for (const object of state.objects.filter((object) => object.kind === 'int'))
  122 |     await expect(
  123 |       p
  124 |         .getByTestId('sort-variable')
  125 |         .filter({ has: p.locator('small', { hasText: `${object.id} · ${object.scopeId}` }) })
  126 |         .locator('b'),
  127 |     ).toHaveText(String(slotValue(object, 0) ?? '未初始化'));
  128 |   await sameBuckets(p, result, cursor);
  129 |   return state;
```