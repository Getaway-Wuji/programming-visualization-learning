# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: memory-bugs.spec.ts >> quota retry keeps the same real event and awards once
- Location: tests\browser\memory-bugs.spec.ts:323:3

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByTestId('memory-bug-session')
Expected: "saved"
Received: "unsaved"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" getByTestId('memory-bug-session') with timeout 5000ms
  - waiting for getByTestId('memory-bug-session')
    14 × locator resolved to <div data-cursor="0" data-length="10" data-state="passed" data-page-id="PAGE-14-4" data-save-state="unsaved" data-testid="memory-bug-session" data-elapsed-ms="84.69999998807907" data-run-id="56d6576e-20a6-4761-9935-17325be85ca5">…</div>
       - unexpected value "unsaved"

```

```yaml
- navigation "当前位置":
  - list
- paragraph: 受限 C++ · 真实内存关卡
- heading "离开作用域后还可访问吗" [level=1]
- paragraph: 让目标对象的生命期覆盖指针访问，实际解引用后输出输入及换行。
- paragraph: 已保存通过 · 4组真实测试 · 首次10分，重复0分。
- paragraph: 本关使用已支持的C++指针与循环子集，代码超出20类积木映射；运行才检查。地址是教学虚拟地址。修改源码或输入会清除旧运行。
- status:
  - heading "本地档案已读取" [level=2]
  - paragraph: 正在显示当前浏览器中已保存的记录与设置。
- region "内存关卡提示与解析":
  - button "查看第 1 层提示"
  - group: 查看修复解析与一种参考写法
- text: 测试输入
- combobox "关卡测试输入":
  - option "negative · [-9]" [selected]
  - option "zero · [0]"
  - option "positive · [7]"
  - option "boundary · [999]"
- button "运行本组"
- button "提交全部4组"
- button "取消提交" [disabled]
- paragraph: 运行本组不保存通过或积分；提交全部测试且实际教学目标满足后才保存。整次提交共用原1000ms截止，每组保留原百万fuel及20,000步等上限。
- group: 编辑历史 · 2条已保存
- text: 拖动中间分隔条调整宽度
- button "恢复默认比例" [disabled]
- region "编辑 C++":
  - text: 编辑 C++
  - button "展开编辑 C++": 展开
  - heading "编辑本关 C++ 代码" [level=2]
  - textbox "编辑关卡 C++ 代码": "#include <iostream> int main() { int x; std::cin >> x; int value = x; int *p = &value; std::cout << *p << \"\\n\"; return 0; }"
  - paragraph: 完整当前原文；保留std::cin的真实输入。尚未运行时，没有新诊断或通过判定。
- separator "调整面板宽度"
- region "真实执行复盘":
  - text: 真实执行复盘
  - button "展开真实执行复盘": 展开
  - region "内存关卡真实复盘"
- region "本次真实测试反馈":
  - heading "本次测试反馈" [level=2]
  - list
- status: 通过尚未保存；请重试未保存操作，重复运行不会多发奖励。
- paragraph: 全部4组真实判定满足。尚未保存，请使用上方重试未保存操作。
- link "返回Bug关卡目录":
  - /url: "#/bugs"
```

# Test source

```ts
  258 |   );
  259 |   await editor(page).fill(q.alternativeSource);
  260 |   await page.evaluate(() => {
  261 |     const h = (window as unknown as { __heldMemoryBug: { held: (() => void)[] } }).__heldMemoryBug;
  262 |     h.held.splice(0).forEach((fn) => fn());
  263 |   });
  264 |   await expect(root(page)).toHaveAttribute('data-run-id', '');
  265 |   await page.getByRole('button', { name: '运行本组', exact: true }).click();
  266 |   await page.waitForFunction(
  267 |     () =>
  268 |       (window as unknown as { __heldMemoryBug: { held: unknown[] } }).__heldMemoryBug.held
  269 |         .length === 1,
  270 |   );
  271 |   await page.getByRole('button', { name: '取消提交', exact: true }).click();
  272 |   await page.evaluate(() => {
  273 |     const h = (window as unknown as { __heldMemoryBug: { hold: boolean; held: (() => void)[] } })
  274 |       .__heldMemoryBug;
  275 |     h.hold = false;
  276 |     h.held.splice(0).forEach((fn) => fn());
  277 |   });
  278 |   await expect(root(page)).toHaveAttribute('data-run-id', '');
  279 |   expect((await rows(page)).ledger).toHaveLength(0);
  280 |   await submit(page);
  281 | });
  282 | test('eight-level catalog and real diagnostic remain usable at three widths', async ({ page }) => {
  283 |   await page.goto('/#/bugs');
  284 |   await expect(page.locator('[data-page-id="PAGE-14-3"] article')).toHaveCount(8);
  285 |   await page
  286 |     .getByRole('link', { name: `修复：${memoryBugQuestions[0].title}`, exact: true })
  287 |     .click();
  288 |   await expect(editor(page)).toHaveValue(memoryBugQuestions[0].brokenSource);
  289 |   await page.getByRole('button', { name: '查看第 1 层提示', exact: true }).click();
  290 |   await expect(page.getByRole('region', { name: '内存关卡提示与解析' })).toContainText(
  291 |     memoryBugQuestions[0].hints[0],
  292 |   );
  293 |   await page.getByRole('button', { name: '运行本组', exact: true }).click();
  294 |   await expect(root(page)).toHaveAttribute('data-state', 'unmet');
  295 |   await mkdir(folder, { recursive: true });
  296 |   for (const width of [1440, 768, 390]) {
  297 |     await page.setViewportSize({ width, height: 900 });
  298 |     await expect(page.getByTestId('workbench')).toHaveAttribute(
  299 |       'data-narrow',
  300 |       width === 1440 ? 'false' : 'true',
  301 |     );
  302 |     const tab = page.getByRole('tab', { name: '真实执行复盘', exact: true });
  303 |     if (width !== 1440) {
  304 |       await expect(tab).toBeVisible();
  305 |       await tab.click();
  306 |     }
  307 |     await page.getByTestId('diagnostic-panel').scrollIntoViewIfNeeded();
  308 |     await page.screenshot({ path: `${folder}/memory-bug-${width}.png` });
  309 |     await expect
  310 |       .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
  311 |       .toBeLessThanOrEqual(1);
  312 |   }
  313 | });
  314 | test('missing atomic content disables all new memory execution and grants no progress', async ({
  315 |   page,
  316 | }) => {
  317 |   await page.route(`**/${p05CourseRelease.file}`, (route) => route.abort());
  318 |   await page.goto(`/#/bugs/memory/${memoryBugQuestions[0].exerciseRef.id}`);
  319 |   await expect(page.getByRole('button', { name: '运行本组', exact: true })).toBeDisabled();
  320 |   await expect(root(page)).toContainText('受审关卡资源不可用');
  321 | });
  322 | if (p05CourseRelease.registered) {
  323 |   test('quota retry keeps the same real event and awards once', async ({ page }) => {
  324 |     await page.addInitScript(() => {
  325 |       const fault = { armed: false, hits: 0, eventId: '' };
  326 |       Object.assign(window, { __memoryBugFault: fault });
  327 |       const add = IDBObjectStore.prototype.add;
  328 |       IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
  329 |         const row = value as { eventType?: string; eventId?: string };
  330 |         if (fault.armed && this.name === 'receipts' && row.eventType === 'exercise.passed') {
  331 |           fault.hits++;
  332 |           fault.eventId = row.eventId!;
  333 |           throw new DOMException('14.4 quota test', 'QuotaExceededError');
  334 |         }
  335 |         return key === undefined ? add.call(this, value) : add.call(this, value, key);
  336 |       };
  337 |     });
  338 |     const q = await open(page, 1);
  339 |     await editor(page).fill(q.solutionSource);
  340 |     await page.evaluate(
  341 |       () =>
  342 |         ((window as unknown as { __memoryBugFault: { armed: boolean } }).__memoryBugFault.armed =
  343 |           true),
  344 |     );
  345 |     await page.getByRole('button', { name: '提交全部4组', exact: true }).click();
  346 |     await expect(root(page)).toHaveAttribute('data-state', 'passed');
  347 |     await expect(root(page)).toHaveAttribute('data-save-state', 'unsaved');
  348 |     expect((await rows(page)).ledger).toHaveLength(0);
  349 |     const fault = await page.evaluate(() => {
  350 |       const f = (
  351 |         window as unknown as { __memoryBugFault: { armed: boolean; hits: number; eventId: string } }
  352 |       ).__memoryBugFault;
  353 |       f.armed = false;
  354 |       return { ...f };
  355 |     });
  356 |     expect(fault.hits).toBeGreaterThan(0);
  357 |     await page.getByRole('button', { name: '重试未保存操作', exact: true }).click();
> 358 |     await expect(root(page)).toHaveAttribute('data-save-state', 'saved');
      |                              ^ Error: expect(locator).toHaveAttribute(expected) failed
  359 |     const first = await rows(page);
  360 |     expect(first.receipts.some((r) => r.eventId === fault.eventId)).toBe(true);
  361 |     expect(first.ledger).toHaveLength(1);
  362 |     await submit(page);
  363 |     expect((await rows(page)).ledger).toEqual(first.ledger);
  364 |     await mkdir(folder, { recursive: true });
  365 |     await writeFile(
  366 |       `${folder}/quota-retry.json`,
  367 |       JSON.stringify({ fault, first, after: await rows(page) }, null, 2) + '\n',
  368 |     );
  369 |   });
  370 |   test('original C,14.3 and memory Bug keep three separate first rewards after refresh', async ({
  371 |     page,
  372 |   }) => {
  373 |     await page.goto('/#/practice/exercise.c.echo');
  374 |     await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
  375 |     const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  376 |     await expect(code).toBeVisible();
  377 |     await code.fill((await code.inputValue()).replace('return 0;', 'printf("%d\\n", x);return 0;'));
  378 |     await page.getByRole('button', { name: '提交练习', exact: true }).click();
  379 |     await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  380 |       'data-save-state',
  381 |       'saved',
  382 |     );
  383 |     const old = await rows(page);
  384 |     await page.goto('/#/practice/exercise.c.bug-semicolon');
  385 |     await expect(code).toBeVisible();
  386 |     await expect.poll(() => code.inputValue()).toContain('printf("%d\\n", x)\n');
  387 |     await code.fill(
  388 |       (await code.inputValue()).replace('printf("%d\\n", x)\n', 'printf("%d\\n", x);\n'),
  389 |     );
  390 |     await page.getByRole('button', { name: '提交练习', exact: true }).click();
  391 |     await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  392 |       'data-save-state',
  393 |       'saved',
  394 |     );
  395 |     const previous = await rows(page);
  396 |     const q = await open(page);
  397 |     await editor(page).fill(q.solutionSource);
  398 |     await submit(page);
  399 |     const all = await rows(page);
  400 |     expect(all.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass')).toHaveLength(3);
  401 |     expect(
  402 |       all.ledger.filter((r) =>
  403 |         old.ledger.some((o) => o.sourceId === r.sourceId && o.subjectId === r.subjectId),
  404 |       ),
  405 |     ).toEqual(old.ledger);
  406 |     expect(
  407 |       all.ledger.filter((r) =>
  408 |         previous.ledger.some((o) => o.sourceId === r.sourceId && o.subjectId === r.subjectId),
  409 |       ),
  410 |     ).toEqual(previous.ledger);
  411 |     await page.reload();
  412 |     await expect(root(page)).toContainText('已保存通过');
  413 |     expect((await rows(page)).ledger).toEqual(all.ledger);
  414 |     await mkdir(folder, { recursive: true });
  415 |     await writeFile(
  416 |       `${folder}/independent-rights.json`,
  417 |       JSON.stringify({ old, previous, all, after: await rows(page) }, null, 2) + '\n',
  418 |     );
  419 |   });
  420 | }
  421 | 
```