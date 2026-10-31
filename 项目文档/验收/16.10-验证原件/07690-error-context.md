# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: memory-bugs.spec.ts >> real pointer/loop failure and durable repair: exercise.cpp.bug-missing-update
- Location: tests\browser\memory-bugs.spec.ts:149:3

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByTestId('memory-bug-session')
Expected: "unmet"
Received: "failed"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" getByTestId('memory-bug-session') with timeout 5000ms
  - waiting for getByTestId('memory-bug-session')
    6 × locator resolved to <div data-run-id="" data-cursor="0" data-length="0" data-elapsed-ms="" data-state="running" data-save-state="idle" data-page-id="PAGE-14-4" data-testid="memory-bug-session">…</div>
      - unexpected value "running"
    7 × locator resolved to <div data-run-id="" data-cursor="0" data-length="0" data-elapsed-ms="" data-state="failed" data-save-state="idle" data-page-id="PAGE-14-4" data-testid="memory-bug-session">…</div>
      - unexpected value "failed"

```

```yaml
- navigation "当前位置":
  - list
- paragraph: 受限 C++ · 真实内存关卡
- heading "计数器停在原地" [level=1]
- paragraph: 通过真实循环累计0到n-1并输出总和及换行，n=0时不迭代。
- paragraph: 尚未保存通过 · 4组真实测试 · 首次10分，重复0分。
- paragraph: 本关使用已支持的C++指针与循环子集，代码超出20类积木映射；运行才检查。地址是教学虚拟地址。修改源码或输入会清除旧运行。
- status:
  - heading "本地档案已读取" [level=2]
  - paragraph: 正在显示当前浏览器中已保存的记录与设置。
- region "内存关卡提示与解析":
  - button "查看第 1 层提示"
  - group: 查看修复解析与一种参考写法
- text: 测试输入
- combobox "关卡测试输入":
  - option "three · [3]" [selected]
  - option "empty · [0]"
  - option "single · [1]"
  - option "seven · [7]"
- button "运行本组"
- button "提交全部4组"
- button "取消提交" [disabled]
- paragraph: 运行本组不保存通过或积分；提交全部测试且实际教学目标满足后才保存。整次提交共用原1000ms截止，每组保留原百万fuel及20,000步等上限。
- group: 编辑历史 · 1条已保存
- text: 拖动中间分隔条调整宽度
- button "恢复默认比例" [disabled]
- region "编辑 C++":
  - text: 编辑 C++
  - button "展开编辑 C++": 展开
  - heading "编辑本关 C++ 代码" [level=2]
  - textbox "编辑关卡 C++ 代码": "#include <iostream> int main() { int n; std::cin >> n; int i = 0; int sum = 0; while (i < n) { sum = sum + i; } std::cout << sum << \"\\n\"; return 0; }"
  - paragraph: 完整当前原文；保留std::cin的真实输入。尚未运行时，没有新诊断或通过判定。
- separator "调整面板宽度"
- region "真实执行复盘":
  - text: 真实执行复盘
  - button "展开真实执行复盘": 展开
  - region "内存关卡真实复盘"
- status: E_DEADLINE
- region "错误诊断":
  - heading "错误诊断" [level=4]
  - paragraph: GCC 风格教学展示 · 错误来自当前检查或执行；未调用 GCC。
  - list
- link "返回Bug关卡目录":
  - /url: "#/bugs"
```

# Test source

```ts
  52  |   return q;
  53  | }
  54  | async function submit(p: Page) {
  55  |   await p.getByRole('button', { name: '提交全部4组', exact: true }).click();
  56  |   await expect(root(p)).toHaveAttribute('data-state', 'passed');
  57  |   await expect(root(p)).toHaveAttribute(
  58  |     'data-save-state',
  59  |     p05CourseRelease.registered ? 'saved' : 'unavailable',
  60  |   );
  61  | }
  62  | async function capture(p: Page, label: string, observations: Record<string, unknown> = {}) {
  63  |   const records = await p.evaluate(() =>
  64  |     window.__verticalObservation.workers
  65  |       .filter((w) => w.moduleSeen && w.responseOk)
  66  |       .map((w) => ({
  67  |         moduleSeen: w.moduleSeen,
  68  |         operationId: w.operationId,
  69  |         timing: (w as unknown as { timing: unknown }).timing,
  70  |         ...(
  71  |           w as unknown as {
  72  |             captureEncoded: () => { requestBase64: string | null; responseBase64: string | null };
  73  |           }
  74  |         ).captureEncoded(),
  75  |       })),
  76  |   );
  77  |   const budgets = await p.evaluate(
  78  |     () => (window as unknown as { __memoryBudgets: unknown[] }).__memoryBudgets,
  79  |   );
  80  |   await mkdir(folder, { recursive: true });
  81  |   const captures = [];
  82  |   for (const [i, r] of records.entries()) {
  83  |     if (!r.requestBase64 || !r.responseBase64) continue;
  84  |     const request = JSON.parse(Buffer.from(r.requestBase64, 'base64').toString());
  85  |     if (!request.bug) continue;
  86  |     const raw = Buffer.from(r.responseBase64, 'base64'),
  87  |       result = JSON.parse(raw.toString());
  88  |     const gzip = `${label}-${i}.json.gz`;
  89  |     await writeFile(`${folder}/${gzip}`, gzipSync(raw));
  90  |     captures.push({
  91  |       request,
  92  |       moduleSeen: r.moduleSeen,
  93  |       operationId: r.operationId,
  94  |       timing: r.timing,
  95  |       terminal: result.terminal,
  96  |       verdict: result.bugJudgement,
  97  |       stats: result.stats,
  98  |       steps: result.trace?.steps.length,
  99  |       completeness: result.trace?.completeness,
  100 |       raw: {
  101 |         file: gzip,
  102 |         bytes: raw.length,
  103 |         sha256: createHash('sha256').update(raw).digest('hex'),
  104 |       },
  105 |     });
  106 |   }
  107 |   const proof = { captures, budgets, observations, rows: await rows(p) };
  108 |   await writeFile(`${folder}/${label}.json`, JSON.stringify(proof, null, 2) + '\n');
  109 |   return proof;
  110 | }
  111 | test.beforeEach(async ({ page }) => {
  112 |   await observeCaseSetExecution(page);
  113 |   await page.addInitScript(() => {
  114 |     const budgets: {
  115 |       operationId: unknown;
  116 |       remainingMs: unknown;
  117 |       at: number;
  118 |       wasmPages: number | null;
  119 |     }[] = [];
  120 |     Object.assign(window, { __memoryBudgets: budgets });
  121 |     const post = Worker.prototype.postMessage;
  122 |     Worker.prototype.postMessage = function (
  123 |       message: unknown,
  124 |       options: Transferable[] | StructuredSerializeOptions = [],
  125 |     ) {
  126 |       const value = message as { operationId?: unknown; remainingMs?: unknown; module?: unknown };
  127 |       if (value?.module instanceof WebAssembly.Module) {
  128 |         const entry = {
  129 |           operationId: value.operationId,
  130 |           remainingMs: value.remainingMs,
  131 |           at: performance.now(),
  132 |           wasmPages: null as number | null,
  133 |         };
  134 |         budgets.push(entry);
  135 |         this.addEventListener(
  136 |           'message',
  137 |           (event: MessageEvent) => {
  138 |             const data = event.data as { wasmPages?: unknown };
  139 |             if (typeof data?.wasmPages === 'number') entry.wasmPages = data.wasmPages;
  140 |           },
  141 |           { once: true },
  142 |         );
  143 |       }
  144 |       return post.call(this, message, Array.isArray(options) ? { transfer: options } : options);
  145 |     };
  146 |   });
  147 | });
  148 | for (const [index, q] of memoryBugQuestions.entries())
  149 |   test(`real pointer/loop failure and durable repair: ${q.exerciseRef.id}`, async ({ page }) => {
  150 |     await open(page, index);
  151 |     await page.getByRole('button', { name: '运行本组', exact: true }).click();
> 152 |     await expect(root(page)).toHaveAttribute('data-state', 'unmet');
      |                              ^ Error: expect(locator).toHaveAttribute(expected) failed
  153 |     const code = ['E_UNINITIALIZED', 'E_DANGLING_POINTER', 'E_STEP_LIMIT', 'E_STEP_LIMIT'][index];
  154 |     await expect(page.getByTestId('diagnostic-item')).toHaveAttribute('data-code', code);
  155 |     await expect(page.locator('.topbar-title')).toHaveText('受限 C++ · Bug 闯关');
  156 |     await expect(page.getByTestId('diagnostic-panel')).toContainText('main.cpp');
  157 |     const length = Number(await root(page).getAttribute('data-length'));
  158 |     expect(length).toBe(index >= 2 ? 20000 : index === 0 ? 4 : 9);
  159 |     const brokenElapsedMs = Number(await root(page).getAttribute('data-elapsed-ms'));
  160 |     expect(brokenElapsedMs).toBeLessThan(1000);
  161 |     expect((await rows(page)).ledger).toHaveLength(0);
  162 |     await page.getByRole('button', { name: '查看终止位置', exact: true }).click();
  163 |     await expect(root(page)).toHaveAttribute('data-cursor', String(length));
  164 |     await page.getByRole('button', { name: '后退', exact: true }).click();
  165 |     await expect(root(page)).toHaveAttribute('data-cursor', String(length - 1));
  166 |     await page.getByRole('button', { name: '回到开始', exact: true }).click();
  167 |     await expect(root(page)).toHaveAttribute('data-cursor', '0');
  168 |     await editor(page).fill(q.solutionSource);
  169 |     await expect(root(page)).toHaveAttribute('data-run-id', '');
  170 |     await submit(page);
  171 |     const first = await rows(page);
  172 |     expect(first.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass')).toHaveLength(
  173 |       p05CourseRelease.registered ? 1 : 0,
  174 |     );
  175 |     if (first.ledger.length) expect(first.ledger[0].points).toBe(10);
  176 |     await submit(page);
  177 |     expect((await rows(page)).ledger).toEqual(first.ledger);
  178 |     const proof = await capture(page, q.exerciseRef.id, {
  179 |       brokenElapsedMs,
  180 |       repairedAcceptedMs: Number(await root(page).getAttribute('data-elapsed-ms')),
  181 |     });
  182 |     expect(proof.captures[0].terminal.code).toBe(code);
  183 |     expect(proof.captures[0].completeness).toBe('prefix');
  184 |     expect(proof.captures.filter((r) => r.verdict.status === 'met')).toHaveLength(8);
  185 |     expect(
  186 |       proof.captures.every(
  187 |         (r) => r.moduleSeen && r.request.language === 'cpp' && r.request.source.includes('std::'),
  188 |       ),
  189 |     ).toBe(true);
  190 |     if (p05CourseRelease.registered) {
  191 |       await page.reload();
  192 |       await expect(root(page)).toContainText('已保存通过');
  193 |       expect((await rows(page)).ledger).toEqual(first.ledger);
  194 |     }
  195 |   });
  196 | test('native code history restores broken and repaired text/input while old execution expires', async ({
  197 |   page,
  198 | }) => {
  199 |   const q = await open(page, 1);
  200 |   const broken = (await rows(page)).editHistory.find(
  201 |     (r) => r.scope.exerciseRef.id === q.exerciseRef.id && r.codeText === q.brokenSource,
  202 |   )!;
  203 |   expect(broken).toBeDefined();
  204 |   await editor(page).fill(q.solutionSource);
  205 |   await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  206 |   await submit(page);
  207 |   const repaired = (await rows(page)).editHistory.find(
  208 |     (r) => r.scope.exerciseRef.id === q.exerciseRef.id && r.codeText === q.solutionSource,
  209 |   )!;
  210 |   expect(repaired).toBeDefined();
  211 |   await page.reload();
  212 |   await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  213 |   await history(page).locator('summary').first().click();
  214 |   for (const row of [repaired, broken]) {
  215 |     await page
  216 |       .getByRole('combobox', { name: '内存关卡历史版本', exact: true })
  217 |       .selectOption(row.entryId);
  218 |     await page.getByRole('button', { name: '恢复所选版本', exact: true }).click();
  219 |     await expect(editor(page)).toHaveValue(row.codeText);
  220 |     await expect(root(page)).toHaveAttribute('data-run-id', '');
  221 |     await expect(root(page)).toHaveAttribute('data-length', '0');
  222 |   }
  223 |   await page.getByRole('button', { name: '运行本组', exact: true }).click();
  224 |   await expect(root(page)).toHaveAttribute('data-state', 'unmet');
  225 |   await page
  226 |     .getByRole('combobox', { name: '关卡测试输入', exact: true })
  227 |     .selectOption(q.tests[1].caseKey);
  228 |   await expect(root(page)).toHaveAttribute('data-run-id', '');
  229 | });
  230 | test('real held replies cannot survive source edits or explicit cancellation', async ({ page }) => {
  231 |   await page.addInitScript(() => {
  232 |     const Native = window.Worker;
  233 |     const held: (() => void)[] = [];
  234 |     const state = { hold: true, held };
  235 |     Object.assign(window, { __heldMemoryBug: state });
  236 |     window.Worker = class extends Native {
  237 |       override set onmessage(handler: Worker['onmessage']) {
  238 |         super.onmessage = handler
  239 |           ? (event) => {
  240 |               const deliver = () => handler.call(this, event);
  241 |               if (state.hold) held.push(deliver);
  242 |               else deliver();
  243 |             }
  244 |           : null;
  245 |       }
  246 |       override get onmessage() {
  247 |         return super.onmessage;
  248 |       }
  249 |     };
  250 |   });
  251 |   const q = await open(page);
  252 |   await editor(page).fill(q.solutionSource);
```