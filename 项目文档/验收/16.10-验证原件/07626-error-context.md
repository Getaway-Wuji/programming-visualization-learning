# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook.spec.ts >> 15.2 formal damaged core attempt receipts show unknown instead of a false empty notebook
- Location: tests\browser\notebook.spec.ts:419:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '编辑 C 并同步积木', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "跳到主要内容" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - complementary [ref=e5]:
    - button "收起侧栏" [expanded] [ref=e6] [cursor=pointer]
    - link "编程可视化教学平台 · 学习首页" [ref=e10] [cursor=pointer]:
      - /url: "#/"
      - generic [ref=e11]: "{ }"
      - generic [ref=e12]:
        - text: 一步一懂
        - generic [ref=e13]: 编程可视化教学平台
    - paragraph [ref=e14]: 从代码，到理解。
    - navigation "主导航" [ref=e15]:
      - link "学习首页" [ref=e16] [cursor=pointer]:
        - /url: "#/"
      - link "C 语言课程" [ref=e20] [cursor=pointer]:
        - /url: "#/courses"
      - link "算法与演示" [ref=e24] [cursor=pointer]:
        - /url: "#/cases"
      - link "编译流程" [ref=e28] [cursor=pointer]:
        - /url: "#/compilation"
      - link "错题与陌生点" [ref=e32] [cursor=pointer]:
        - /url: "#/notebook"
      - link "今日复习" [ref=e36] [cursor=pointer]:
        - /url: "#/reviews"
      - link "学习成就" [ref=e40] [cursor=pointer]:
        - /url: "#/achievements"
      - link "本地设置" [ref=e44] [cursor=pointer]:
        - /url: "#/settings"
    - generic [ref=e48]:
      - strong [ref=e51]: 按自己的节奏学习
      - paragraph [ref=e52]: 学习记录将保存在当前浏览器，不跨设备同步。
      - link "了解本地数据" [ref=e53] [cursor=pointer]:
        - /url: "#/settings?panel=data"
  - generic [ref=e56]:
    - banner [ref=e57]:
      - generic [ref=e58]: C 语言 · 从零开始
      - generic [ref=e59]:
        - button "进入专注模式" [ref=e60] [cursor=pointer]:
          - generic [ref=e63]: 专注
        - generic [ref=e64]: 本地学习
        - link "本地数据" [ref=e65] [cursor=pointer]:
          - /url: "#/settings?panel=data"
        - button "切换为深色" [ref=e69] [cursor=pointer]
    - main [ref=e72]:
      - generic [ref=e73]:
        - navigation "当前位置" [ref=e74]:
          - list [ref=e75]:
            - listitem [ref=e76]:
              - link "C 语言课程" [ref=e77] [cursor=pointer]:
                - /url: "#/courses"
            - listitem [ref=e78]:
              - link "表达式" [ref=e81] [cursor=pointer]:
                - /url: "#/lessons/lesson.c.expressions"
            - listitem [ref=e82]:
              - generic [ref=e85]: 两倍加三
        - generic [ref=e86]:
          - paragraph [ref=e87]: 动手练习 · 程序与输入
          - heading "两倍加三" [active] [level=1] [ref=e88]
          - paragraph [ref=e89]: 用 C 代码或积木解答，提交后逐步复盘真实执行。
        - paragraph [ref=e93]: 尚无已保存的学习记录
        - generic [ref=e94]:
          - generic [ref=e96]:
            - heading "题目与答题区" [level=2] [ref=e97]
            - paragraph [ref=e98]: 保留输入源x，计算它的两倍加三并输出一行整数。例：7→17，0→3，-9→-15（每个结果后均有换行）。必须实际执行与x有关的乘法和加法，可用临时变量或等价顺序；不要写2*(x+3)，也不要打印常量。输入域-999到999，结果不按输入域截断。所有测试正常结束且返回0。思路：先乘2，再加3，最后输出。
            - paragraph [ref=e99]: 教学目标：实际执行与输入相关的乘法及加法，允许等价顺序。
            - group [ref=e100]:
              - generic "练习与保存说明" [ref=e101] [cursor=pointer]
          - generic [ref=e102]:
            - generic [ref=e103]:
              - generic "练习起点" [ref=e104]:
                - button "独立练习" [pressed] [ref=e105] [cursor=pointer]
                - button "改错练习" [ref=e106] [cursor=pointer]
                - button "拆积木练习" [ref=e107] [cursor=pointer]
              - link "查看课程示例" [ref=e108] [cursor=pointer]:
                - /url: "#/lessons/lesson.c.expressions"
            - paragraph [ref=e109]: 从零搭建解答。已保留本题输入声明，请在 main 中加入你的程序。各模式草稿独立保留，切换会清除本次结果；已保存的编辑历史可在离题或刷新后选择恢复，未保存内容可能丢失。示例在新标签页打开。
            - generic [ref=e111]:
              - strong [ref=e112]: 需要一点帮助？
              - button "查看第 1 层提示" [ref=e113] [cursor=pointer]
          - generic [ref=e114]:
            - button "运行本组" [ref=e115] [cursor=pointer]
            - button "准备代码" [ref=e116] [cursor=pointer]
            - button "提交练习" [ref=e117] [cursor=pointer]
            - button "取消提交" [disabled] [ref=e118]
            - link "查看本次复盘" [ref=e119] [cursor=pointer]:
              - /url: "#/practice/exercise.c.two-x-plus-three/review"
          - paragraph [ref=e120]: 运行本组只检查第一组输入，不记录通过或积分；提交练习才检查全部3 组与教学目标。准备代码只生成源码。 修改积木或代码会立即使旧判定和轨迹失效；已保存的历史通过仍保留。
          - generic [ref=e121]:
            - generic [ref=e122]:
              - generic [ref=e123]: 积木显示
              - combobox "积木显示" [ref=e124]:
                - option "自动（按课程推荐）" [selected]
                - option "始终显示"
                - option "隐藏"
            - paragraph [ref=e125]: 本节推荐代码作答。隐藏积木后仍可写代码、运行和提交；切换显示不会修改解答。
            - status [ref=e126]: 正在使用当前浏览器的积木显示偏好。
          - group [ref=e127]:
            - generic "积木权限：已永久解锁 0 / 20 · 本节临时开放 10 类" [ref=e128] [cursor=pointer]
          - group [ref=e129]:
            - generic "编辑历史 · 1 条已保存" [ref=e130] [cursor=pointer]
          - region "编辑代码" [ref=e134]:
            - complementary "代码与积木联动" [ref=e138]:
              - generic [ref=e139]:
                - generic [ref=e140]:
                  - heading "编辑 C 代码" [level=3] [ref=e141]
                  - generic [ref=e142]: 当前草稿
                - status [ref=e143]: 代码与积木已同步。
                - generic [ref=e144]:
                  - generic [aria-hidden]:
                    - code: "#include <stdio.h> int main(void) { int x = 7; return 0; }"
                  - textbox "编辑 C 代码" [ref=e145]: "#include <stdio.h> int main(void) { int x = 7; return 0; }"
                - paragraph [ref=e146]:
                  - text: 编辑稿使用本题第一组输入：
                  - code [ref=e147]: "{\"x\":7}"
                  - text: 。已保存的编辑历史可在刷新后选择恢复，未保存内容仅在本次页面保留；选择代码或积木可查看对应位置。
          - heading "本次提交与反馈" [level=3] [ref=e149]
          - status [ref=e151]:
            - generic [ref=e155]:
              - heading "已保存" [level=2] [ref=e156]
              - paragraph [ref=e157]: 这次更改已保存到当前浏览器。
          - region "小节完成清单" [ref=e158]:
            - generic [ref=e159]:
              - heading "小节完成清单" [level=3] [ref=e160]
              - generic [ref=e161]: 1/2 项已保存
            - list [ref=e162]:
              - listitem [ref=e163]:
                - generic [ref=e164]: 阅读并主动确认学习
                - strong [ref=e165]: 已保存
              - listitem [ref=e166]:
                - generic [ref=e167]: 两倍加三
                - strong [ref=e168]: 待通过并保存
            - paragraph [ref=e169]: 小节尚未完成
            - link "继续搭建并提交全部测试" [ref=e170] [cursor=pointer]:
              - /url: "#/practice/exercise.c.two-x-plus-three#practice-answer"
          - paragraph [ref=e171]: 当前源码对应测试组：positive。此处为将实际执行的完整代码。
          - paragraph [ref=e172]:
            - text: 本组输入：
            - code [ref=e173]: "{\"x\":7}"
          - generic "执行播放工作区" [ref=e174]:
            - region "运行结果" [ref=e175]:
              - heading "当前步骤画面" [level=3] [ref=e177]
              - generic "播放控制" [ref=e178]:
                - generic [ref=e179]:
                  - button "后退" [disabled] [ref=e180]
                  - button "播放" [disabled] [ref=e181]
                  - button "前进" [disabled] [ref=e182]
                  - button "重播" [disabled] [ref=e183]
                - generic [ref=e184]:
                  - text: 速度
                  - combobox "播放速度" [disabled] [ref=e185]:
                    - option "0.25×"
                    - option "0.5×"
                    - option "1×" [selected]
                    - option "1.5×"
                    - option "2×"
                    - option "4×"
                - generic [ref=e186]:
                  - generic [ref=e187]: 步骤 — / 0
                  - status [ref=e188]: 等待运行轨迹
                - paragraph [ref=e189]: 聚焦播放工作区后，空格播放或暂停，左右方向键单步查看。重播从初始状态开始播放。
              - paragraph [ref=e191]: 尚无当前步骤画面。运行后从初始状态开始查看。
        - paragraph [ref=e192]: 积木只生成受支持的 C 程序。返回本节可查看已保存的历史进度。
        - link "返回本节学习" [ref=e193] [cursor=pointer]:
          - /url: "#/lessons/lesson.c.expressions"
```

# Test source

```ts
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
  21  |   expect(page.getByTestId('learning-save-status')).toHaveAttribute(
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
  100 |   const expand = page.getByRole('button', { name: '编辑 C 并同步积木', exact: true });
  101 |   await expect(code(page).or(expand).first()).toBeVisible();
> 102 |   if (await expand.isVisible()) await expand.click();
      |                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  103 |   await expect(code(page)).toBeEditable();
  104 |   await code(page).fill(source.source.text);
  105 |   await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  106 | }
  107 | async function submit(page: Page, saved = true) {
  108 |   await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  109 |   await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  110 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  111 |     'data-save-state',
  112 |     saved ? 'saved' : 'unsaved',
  113 |   );
  114 |   if (saved) await ready(page);
  115 | }
  116 | async function capture(page: Page, name: string) {
  117 |   const actual = await observedCaseSetExecute(page);
  118 |   expect(actual.moduleSeen).toBe(true);
  119 |   expect(actual.responseOk).toBe(true);
  120 |   await mkdir(folder, { recursive: true });
  121 |   await writeFile(`${folder}/${name}.json.gz`, gzipSync(JSON.stringify(actual)), { flag: 'wx' });
  122 | }
  123 | 
  124 | test.beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));
  125 | 
  126 | export {
  127 |   archive,
  128 |   ready,
  129 |   confirm,
  130 |   openAnswer,
  131 |   submit,
  132 |   capture,
  133 |   panel,
  134 |   code,
  135 |   folder,
  136 |   observeCaseSetExecution,
  137 | };
  138 | 
```