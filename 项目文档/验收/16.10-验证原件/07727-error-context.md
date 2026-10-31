# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: classics.spec.ts >> actual prime default: exact source, input, current values, output and reverse
- Location: tests\browser\classics.spec.ts:185:5

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
  - paragraph: C++ · 经典问题 · 真实回放
  - heading "朴素素数判断" [level=1]
  - paragraph: 从2逐个尝试实际因子，观察判断、早停及0/1/负数边界。
  - region "经典问题输入"
  - text: 拖动中间分隔条调整宽度
  - button "恢复默认比例" [disabled]
  - region "实际C++源码"
  - separator "调整面板宽度"
  - region "数值与过程"
  - group: 算法、输入编码与观察目标
  - navigation "切换四个经典案例"
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
  14  | import { memorySlots } from '../../web/src/memory/presentation';
  15  | import type { ClassicCase } from '../../web/src/classics/content';
  16  | const specs = JSON.parse(readFileSync('content/algorithms/cpp/classics-1.0.0.json', 'utf8'))
  17  |     .cases as ClassicCase[],
  18  |   folder = `.artifacts/16.9/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
  19  | test.beforeAll(() => mkdir(folder, { recursive: true }));
  20  | const workspace = (p: Page) => p.getByTestId('classic-workspace');
  21  | async function ready(p: Page, spec = specs[0]) {
  22  |   await p.goto('/#/classics/' + spec.id);
> 23  |   await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
      |                                         ^ Error: expect(locator).toHaveAttribute(expected) failed
  24  |   await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
  25  |   await expect(workspace(p)).toHaveAttribute('data-state', 'idle');
  26  |   await p.evaluate(() =>
  27  |     document.addEventListener(
  28  |       'click',
  29  |       (e) => {
  30  |         if ((e.target as HTMLElement).closest('button')?.textContent === '运行C++经典案例')
  31  |           Object.assign(window, { classicObservedClickAt: performance.now() });
  32  |       },
  33  |       true,
  34  |     ),
  35  |   );
  36  | }
  37  | async function run(p: Page, input: number[] | string) {
  38  |   await p.getByTestId('classic-input').fill(typeof input === 'string' ? input : input.join(' '));
  39  |   await p.getByRole('button', { name: '运行C++经典案例', exact: true }).click();
  40  |   await expect(workspace(p)).toHaveAttribute('data-state', 'ready');
  41  | }
  42  | async function captured(p: Page, label: string) {
  43  |   const raw = await p.evaluate(() => {
  44  |     const record = window.__verticalObservation.workers.findLast(
  45  |       (w) => w.moduleSeen && w.responseOk,
  46  |     );
  47  |     if (!record) throw Error('Actual native Worker required');
  48  |     return {
  49  |       moduleSeen: record.moduleSeen,
  50  |       terminated: record.terminated,
  51  |       timing: (record as unknown as { timing: Record<string, number | null> }).timing,
  52  |       observedClickAt: (window as unknown as { classicObservedClickAt: number })
  53  |         .classicObservedClickAt,
  54  |       ...(
  55  |         record as unknown as {
  56  |           captureEncoded: () => { requestBase64: string; responseBase64: string };
  57  |         }
  58  |       ).captureEncoded(),
  59  |     };
  60  |   });
  61  |   expect(raw.terminated).toBe(true);
  62  |   await writeFile(`${folder}/${label}-worker.json.gz`, gzipSync(JSON.stringify(raw)), {
  63  |     flag: 'wx',
  64  |   });
  65  |   const request = JSON.parse(Buffer.from(raw.requestBase64, 'base64').toString()) as MemoryRequest,
  66  |     result = await decodeMemoryResult(
  67  |       Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
  68  |       request,
  69  |       engineBuild.wasmSha256,
  70  |     );
  71  |   return { request, result };
  72  | }
  73  | async function seek(p: Page, cursor: number) {
  74  |   await p.getByRole('slider', { name: '经典执行步骤', exact: true }).fill(String(cursor));
  75  |   await expect(workspace(p)).toHaveAttribute('data-cursor', String(cursor));
  76  | }
  77  | async function sameState(p: Page, result: MemoryResult, cursor: number, spec: ClassicCase) {
  78  |   const player = new MemoryPlayer();
  79  |   player.accept(result);
  80  |   player.seek(cursor);
  81  |   const state = player.snapshot().state!,
  82  |     main = state.frames.find((f) => f.parentFrameId === null),
  83  |     objects = main ? state.objects.filter((o) => o.alive && o.frameId === main.id) : [];
  84  |   for (const [k, v] of Object.entries(state.counters))
  85  |     await expect(p.getByTestId(`classic-counter-${k}`)).toHaveText(String(v));
  86  |   await expect(p.getByTestId('classic-output')).toHaveText(state.output || '（无输出）');
  87  |   await expect(p.getByTestId('classic-object')).toHaveCount(objects.length);
  88  |   for (const o of objects) {
  89  |     const row = p.locator(`[data-testid="classic-object"][data-object-id="${o.id}"]`);
  90  |     await expect(row).toHaveAttribute('data-name', o.name);
  91  |     const slots = memorySlots(o, result.types);
  92  |     await expect(row.getByTestId('classic-slot')).toHaveCount(slots.length);
  93  |     for (const slot of slots)
  94  |       await expect(
  95  |         row.locator(`[data-testid="classic-slot"][data-offset="${slot.byteOffset}"]`),
  96  |       ).toHaveAttribute(
  97  |         'data-value',
  98  |         typeof slot.value === 'number' ? String(slot.value) : 'uninitialized',
  99  |       );
  100 |   }
  101 |   if (spec.kind === 'hanoi') {
  102 |     const nObj = objects.find((o) => o.name === 'n'),
  103 |       n = nObj ? memorySlots(nObj, result.types)[0].value : null,
  104 |       pos = objects.find((o) => o.name === 'positions'),
  105 |       slots = pos ? memorySlots(pos, result.types) : [],
  106 |       initialized =
  107 |         typeof n === 'number' && pos && slots.slice(0, n).every((s) => typeof s.value === 'number');
  108 |     if (initialized) {
  109 |       await expect(p.getByTestId('hanoi-disk')).toHaveCount(n as number);
  110 |       for (let d = 0; d < (n as number); d++)
  111 |         await expect(p.locator(`[data-testid="hanoi-disk"][data-index="${d}"]`)).toHaveAttribute(
  112 |           'data-peg',
  113 |           String(slots[d].value),
  114 |         );
  115 |       for (const peg of [0, 1, 2])
  116 |         expect(
  117 |           await p
  118 |             .locator(`[data-testid="hanoi-peg"][data-peg="${peg}"]`)
  119 |             .getByTestId('hanoi-disk')
  120 |             .evaluateAll((xs) => xs.map((x) => Number(x.getAttribute('data-index')))),
  121 |         ).toEqual(
  122 |           slots
  123 |             .slice(0, n as number)
```