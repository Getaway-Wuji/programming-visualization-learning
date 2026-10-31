# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: memory-bugs.spec.ts >> quota retry keeps the same real event and awards once
- Location: tests\browser\memory-bugs.spec.ts:336:3

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
    14 × locator resolved to <div data-cursor="0" data-length="10" data-state="passed" data-page-id="PAGE-14-4" data-save-state="unsaved" data-testid="memory-bug-session" data-elapsed-ms="87.59999999403954" data-run-id="bb854999-4690-4bb5-b624-d9b91dc38113">…</div>
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
  271 |   );
  272 |   await editor(page).fill(q.alternativeSource);
  273 |   await page.evaluate(() => {
  274 |     const h = (window as unknown as { __heldMemoryBug: { held: (() => void)[] } }).__heldMemoryBug;
  275 |     h.held.splice(0).forEach((fn) => fn());
  276 |   });
  277 |   await expect(root(page)).toHaveAttribute('data-run-id', '');
  278 |   await page.getByRole('button', { name: '运行本组', exact: true }).click();
  279 |   await page.waitForFunction(
  280 |     () =>
  281 |       (window as unknown as { __heldMemoryBug: { held: unknown[] } }).__heldMemoryBug.held
  282 |         .length === 1,
  283 |   );
  284 |   await page.getByRole('button', { name: '取消提交', exact: true }).click();
  285 |   await page.evaluate(() => {
  286 |     const h = (window as unknown as { __heldMemoryBug: { hold: boolean; held: (() => void)[] } })
  287 |       .__heldMemoryBug;
  288 |     h.hold = false;
  289 |     h.held.splice(0).forEach((fn) => fn());
  290 |   });
  291 |   await expect(root(page)).toHaveAttribute('data-run-id', '');
  292 |   expect((await rows(page)).ledger).toHaveLength(0);
  293 |   await submit(page);
  294 | });
  295 | test('eight-level catalog and real diagnostic remain usable at three widths', async ({ page }) => {
  296 |   await page.goto('/#/bugs');
  297 |   await expect(page.locator('[data-page-id="PAGE-14-3"] article')).toHaveCount(8);
  298 |   await page
  299 |     .getByRole('link', { name: `修复：${memoryBugQuestions[0].title}`, exact: true })
  300 |     .click();
  301 |   await expect(editor(page)).toHaveValue(memoryBugQuestions[0].brokenSource);
  302 |   await page.getByRole('button', { name: '查看第 1 层提示', exact: true }).click();
  303 |   await expect(page.getByRole('region', { name: '内存关卡提示与解析' })).toContainText(
  304 |     memoryBugQuestions[0].hints[0],
  305 |   );
  306 |   await page.getByRole('button', { name: '运行本组', exact: true }).click();
  307 |   await expect(root(page)).toHaveAttribute('data-state', 'unmet');
  308 |   await mkdir(folder, { recursive: true });
  309 |   for (const width of [1440, 768, 390]) {
  310 |     await page.setViewportSize({ width, height: 900 });
  311 |     await expect(page.getByTestId('workbench')).toHaveAttribute(
  312 |       'data-narrow',
  313 |       width === 1440 ? 'false' : 'true',
  314 |     );
  315 |     const tab = page.getByRole('tab', { name: '真实执行复盘', exact: true });
  316 |     if (width !== 1440) {
  317 |       await expect(tab).toBeVisible();
  318 |       await tab.click();
  319 |     }
  320 |     await page.getByTestId('diagnostic-panel').scrollIntoViewIfNeeded();
  321 |     await page.screenshot({ path: `${folder}/memory-bug-${width}.png` });
  322 |     await expect
  323 |       .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
  324 |       .toBeLessThanOrEqual(1);
  325 |   }
  326 | });
  327 | test('missing atomic content disables all new memory execution and grants no progress', async ({
  328 |   page,
  329 | }) => {
  330 |   await page.route(`**/${p05CourseRelease.file}`, (route) => route.abort());
  331 |   await page.goto(`/#/bugs/memory/${memoryBugQuestions[0].exerciseRef.id}`);
  332 |   await expect(page.getByRole('button', { name: '运行本组', exact: true })).toBeDisabled();
  333 |   await expect(root(page)).toContainText('受审关卡资源不可用');
  334 | });
  335 | if (p05CourseRelease.registered) {
  336 |   test('quota retry keeps the same real event and awards once', async ({ page }) => {
  337 |     await page.addInitScript(() => {
  338 |       const fault = { armed: false, hits: 0, eventId: '' };
  339 |       Object.assign(window, { __memoryBugFault: fault });
  340 |       const add = IDBObjectStore.prototype.add;
  341 |       IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
  342 |         const row = value as { eventType?: string; eventId?: string };
  343 |         if (fault.armed && this.name === 'receipts' && row.eventType === 'exercise.passed') {
  344 |           fault.hits++;
  345 |           fault.eventId = row.eventId!;
  346 |           throw new DOMException('14.4 quota test', 'QuotaExceededError');
  347 |         }
  348 |         return key === undefined ? add.call(this, value) : add.call(this, value, key);
  349 |       };
  350 |     });
  351 |     const q = await open(page, 1);
  352 |     await editor(page).fill(q.solutionSource);
  353 |     await page.evaluate(
  354 |       () =>
  355 |         ((window as unknown as { __memoryBugFault: { armed: boolean } }).__memoryBugFault.armed =
  356 |           true),
  357 |     );
  358 |     await page.getByRole('button', { name: '提交全部4组', exact: true }).click();
  359 |     await expect(root(page)).toHaveAttribute('data-state', 'passed');
  360 |     await expect(root(page)).toHaveAttribute('data-save-state', 'unsaved');
  361 |     expect((await rows(page)).ledger).toHaveLength(0);
  362 |     const fault = await page.evaluate(() => {
  363 |       const f = (
  364 |         window as unknown as { __memoryBugFault: { armed: boolean; hits: number; eventId: string } }
  365 |       ).__memoryBugFault;
  366 |       f.armed = false;
  367 |       return { ...f };
  368 |     });
  369 |     expect(fault.hits).toBeGreaterThan(0);
  370 |     await page.getByRole('button', { name: '重试未保存操作', exact: true }).click();
> 371 |     await expect(root(page)).toHaveAttribute('data-save-state', 'saved');
      |                              ^ Error: expect(locator).toHaveAttribute(expected) failed
  372 |     const first = await rows(page);
  373 |     expect(first.receipts.some((r) => r.eventId === fault.eventId)).toBe(true);
  374 |     expect(first.ledger).toHaveLength(1);
  375 |     await submit(page);
  376 |     expect((await rows(page)).ledger).toEqual(first.ledger);
  377 |     await mkdir(folder, { recursive: true });
  378 |     await writeFile(
  379 |       `${folder}/quota-retry.json`,
  380 |       JSON.stringify({ fault, first, after: await rows(page) }, null, 2) + '\n',
  381 |     );
  382 |   });
  383 |   test('original C,14.3 and memory Bug keep three separate first rewards after refresh', async ({
  384 |     page,
  385 |   }) => {
  386 |     await page.goto('/#/practice/exercise.c.echo');
  387 |     await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
  388 |     const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  389 |     await expect(code).toBeVisible();
  390 |     await code.fill((await code.inputValue()).replace('return 0;', 'printf("%d\\n", x);return 0;'));
  391 |     await page.getByRole('button', { name: '提交练习', exact: true }).click();
  392 |     await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  393 |       'data-save-state',
  394 |       'saved',
  395 |     );
  396 |     const old = await rows(page);
  397 |     await page.goto('/#/practice/exercise.c.bug-semicolon');
  398 |     await expect(code).toBeVisible();
  399 |     await expect.poll(() => code.inputValue()).toContain('printf("%d\\n", x)\n');
  400 |     await code.fill(
  401 |       (await code.inputValue()).replace('printf("%d\\n", x)\n', 'printf("%d\\n", x);\n'),
  402 |     );
  403 |     await page.getByRole('button', { name: '提交练习', exact: true }).click();
  404 |     await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  405 |       'data-save-state',
  406 |       'saved',
  407 |     );
  408 |     const previous = await rows(page);
  409 |     const q = await open(page);
  410 |     await editor(page).fill(q.solutionSource);
  411 |     await submit(page);
  412 |     const all = await rows(page);
  413 |     expect(all.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass')).toHaveLength(3);
  414 |     expect(
  415 |       all.ledger.filter((r) =>
  416 |         old.ledger.some((o) => o.sourceId === r.sourceId && o.subjectId === r.subjectId),
  417 |       ),
  418 |     ).toEqual(old.ledger);
  419 |     expect(
  420 |       all.ledger.filter((r) =>
  421 |         previous.ledger.some((o) => o.sourceId === r.sourceId && o.subjectId === r.subjectId),
  422 |       ),
  423 |     ).toEqual(previous.ledger);
  424 |     await page.reload();
  425 |     await expect(root(page)).toContainText('已保存通过');
  426 |     expect((await rows(page)).ledger).toEqual(all.ledger);
  427 |     await mkdir(folder, { recursive: true });
  428 |     await writeFile(
  429 |       `${folder}/independent-rights.json`,
  430 |       JSON.stringify({ old, previous, all, after: await rows(page) }, null, 2) + '\n',
  431 |     );
  432 |   });
  433 | }
  434 | 
```