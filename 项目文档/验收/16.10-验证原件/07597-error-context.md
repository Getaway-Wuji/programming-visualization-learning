# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-integration.spec.ts >> one native archive connects real failure, review, completion, challenge, both execution families and downloaded current state
- Location: tests\browser\phase2-integration.spec.ts:14:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByTestId('learning-save-status')
Expected: "ready"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" getByTestId('learning-save-status') with timeout 5000ms
  - waiting for getByTestId('learning-save-status')

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
  - navigation "主导航":
    - link "学习首页":
      - /url: "#/"
    - link "C 语言课程":
      - /url: "#/courses"
    - link "算法与演示":
      - /url: "#/cases"
    - link "编译流程":
      - /url: "#/compilation"
    - link "错题与陌生点":
      - /url: "#/notebook"
    - link "今日复习":
      - /url: "#/reviews"
    - link "学习成就":
      - /url: "#/achievements"
    - link "本地设置":
      - /url: "#/settings"
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
  - navigation "切换对比案例组":
    - link "C · 冒泡与选择":
      - /url: "#/compare"
    - link "C++ · 归并与快速":
      - /url: "#/compare?pair=cpp-recursive"
  - navigation "当前位置":
    - list:
      - listitem:
        - link "学习首页":
          - /url: "#/"
      - listitem:
        - link "算法与演示":
          - /url: "#/cases"
      - listitem: C++递归排序对比
  - paragraph: C++ · 同数据 · 真实轨迹
  - heading "归并与快速，同步观察" [level=1]
  - paragraph: 同一整数序列，生成两份独立输入。沿统一原子步骤游标观察数组、递归帧和实际计数。
  - region "C++对比共同输入":
    - text: 共同整数序列
    - textbox "共同整数序列": 7 -3 0 5 -3 2 9
    - paragraph: 0～30项，−999～999。空数组写[]。修改输入、交换左右、清除数据或离开页面撤销本组旧运行；观察不计学习进度或积分。
    - button "应用共同输入"
    - button "交换左右"
  - region "C++统一回放控制":
    - status: 请应用共同输入
    - button "运行两份C++" [disabled]
    - button "回到初态" [disabled]
    - button "统一后退" [disabled]
    - button "播放对比" [disabled]
    - button "统一前进" [disabled]
    - button "到末尾" [disabled]
    - text: 速度
    - combobox "C++对比回放速度":
      - option "0.25×"
      - option "0.5×"
      - option "1×" [selected]
      - option "1.5×"
      - option "2×"
      - option "4×"
    - text: 统一步骤 0 / 0
    - slider "C++对比统一步骤" [disabled]: "0"
    - paragraph: 两次执行共用本组1秒截止，顺序占用单执行槽，不自动重试。短侧到末尾保持末态，后退恢复完整状态。相同步号不代表相同算法阶段；计数是实际步骤累计，包含循环、输入和初始化。
  - paragraph: 左侧 · 独立C++运行
  - heading "归并排序" [level=2]
  - paragraph: 递归整理两个闭区间，借助同一个辅助数组合并，再写回原区间。
  - paragraph: O(n log n)时间；空或单项立即返回。原始计数包含循环、边界判断及初始化，并非只统计元素比较。
  - paragraph: 请先应用输入
  - paragraph: 输入副本：尚未准备
  - group: 本侧算法、存储与实际源码
  - paragraph: 右侧 · 独立C++运行
  - heading "快速排序" [level=2]
  - paragraph: 以区间末项为枢轴分区，递归较小的一侧，在当前帧循环处理较大的一侧。
  - paragraph: 平均O(n log n)、最坏O(n²)时间；已排序、逆序和全相等仍可能退化。较小段递归保证O(log n)调用栈，不画不存在的全递归树。
  - paragraph: 请先应用输入
  - paragraph: 输入副本：尚未准备
  - group: 本侧算法、存储与实际源码
```

# Test source

```ts
  1   | import { readFileSync } from 'node:fs';
  2   | import { mkdir, writeFile } from 'node:fs/promises';
  3   | import { gzipSync } from 'node:zlib';
  4   | import { expect, test, type Page } from '@playwright/test';
  5   | import type { ContentPackage } from '../../web/src/content/types';
  6   | import type { StorageSnapshot } from '../../web/src/storage/model';
  7   | import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
  8   | import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
  9   | import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
  10  | 
  11  | const course = JSON.parse(
  12  |   readFileSync('content/c/p05/course-1.0.0.json', 'utf8'),
  13  | ) as ContentPackage;
  14  | const solutions = JSON.parse(
  15  |   readFileSync('tests/fixtures/p05-reference-solutions.json', 'utf8'),
  16  | ) as { solutions: { exerciseRef: { id: string }; source: string }[] };
  17  | const folder = `.artifacts/15.2/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
  18  | const panel = (page: Page) => page.getByTestId('practice-execution');
  19  | const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  20  | const ready = (page: Page) =>
> 21  |   expect(page.getByTestId('learning-save-status')).toHaveAttribute(
      |                                                    ^ Error: expect(locator).toHaveAttribute(expected) failed
  22  |     'data-save-status',
  23  |     p05CourseRelease.registered ? 'ready' : /^(ready|unsaved)$/,
  24  |   );
  25  | async function archive(page: Page): Promise<StorageSnapshot> {
  26  |   return page.evaluate(async () => {
  27  |     const db = await new Promise<IDBDatabase>((resolve, reject) => {
  28  |       const req = indexedDB.open('c-viz-learning');
  29  |       req.onsuccess = () => resolve(req.result);
  30  |       req.onerror = () => reject(req.error);
  31  |     });
  32  |     try {
  33  |       const names = Array.from(db.objectStoreNames);
  34  |       const tx = db.transaction(names, 'readonly');
  35  |       const done = new Promise<void>((resolve, reject) => {
  36  |         tx.oncomplete = () => resolve();
  37  |         tx.onabort = () => reject(tx.error);
  38  |       });
  39  |       const entries = await Promise.all(
  40  |         names.map(async (name) => [
  41  |           name,
  42  |           await new Promise<unknown>((resolve, reject) => {
  43  |             const store = tx.objectStore(name);
  44  |             const req = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
  45  |               ? store.get('current')
  46  |               : store.getAll();
  47  |             req.onsuccess = () => resolve(req.result);
  48  |             req.onerror = () => reject(req.error);
  49  |           }),
  50  |         ]),
  51  |       );
  52  |       await done;
  53  |       return Object.fromEntries(entries) as unknown as StorageSnapshot;
  54  |     } finally {
  55  |       db.close();
  56  |     }
  57  |   });
  58  | }
  59  | async function confirm(page: Page, id: string) {
  60  |   await page.goto(`/#/lessons/${id}`);
  61  |   await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  62  |   await ready(page);
  63  |   const start = page.getByRole('button', { name: '开始本节学习', exact: true });
  64  |   if (await start.isEnabled()) {
  65  |     await start.click();
  66  |     await ready(page);
  67  |   }
  68  |   await page.getByRole('button', { name: /^(确认已学习|确认今日复习)$/ }).click();
  69  |   await ready(page);
  70  |   await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
  71  | }
  72  | async function openAnswer(page: Page, exerciseId: string) {
  73  |   const subject = course.exercises.find((item) => item.id === exerciseId)!;
  74  |   const program = course.programs.find((item) => item.id === subject.programRef.id)!;
  75  |   const input = Object.fromEntries(
  76  |     Object.entries(subject.tests[0].input).sort(([a], [b]) => a.localeCompare(b)),
  77  |   );
  78  |   const source = JSON.parse(
  79  |     new TextDecoder().decode(
  80  |       prepare_input(
  81  |         JSON.stringify({
  82  |           packageRef: { id: course.packageId, version: course.packageVersion },
  83  |           subject,
  84  |           program: {
  85  |             ...program,
  86  |             sourceExample: solutions.solutions.find((item) => item.exerciseRef.id === exerciseId)!
  87  |               .source,
  88  |           },
  89  |           inputSpec: course.inputSpecs.find((item) => item.id === program.inputRef.id)!,
  90  |           judgeProfile: course.judgeProfiles.find((item) => item.id === subject.judgeRef.id)!,
  91  |         }),
  92  |         new TextEncoder().encode(JSON.stringify(input)),
  93  |         1000,
  94  |       ),
  95  |     ),
  96  |   ) as { source: { text: string } };
  97  |   await page.goto(`/#/practice/${exerciseId}`);
  98  |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  99  |   await ready(page);
  100 |   // The normal auto preference can reveal code between checking and clicking
  101 |   // its expander. Select the public code-only view before editing instead.
  102 |   await page
  103 |     .getByTestId('block-workspace-preference')
  104 |     .getByRole('combobox', { name: '积木显示', exact: true })
  105 |     .selectOption('hide');
  106 |   await expect(page.getByTestId('practice-editor-layout')).toHaveAttribute(
  107 |     'data-blocks-visible',
  108 |     'no',
  109 |   );
  110 |   await expect(code(page)).toBeEditable();
  111 |   await code(page).fill(source.source.text);
  112 |   await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  113 | }
  114 | async function submit(page: Page, saved = true) {
  115 |   await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  116 |   await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  117 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  118 |     'data-save-state',
  119 |     saved ? 'saved' : 'unsaved',
  120 |   );
  121 |   if (saved) await ready(page);
```