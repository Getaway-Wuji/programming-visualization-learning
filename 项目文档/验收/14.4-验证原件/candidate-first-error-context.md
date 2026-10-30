# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: memory-bugs.spec.ts >> eight-level catalog and real diagnostic remain usable at three widths
- Location: tests\browser\memory-bugs.spec.ts:280:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.scrollIntoViewIfNeeded: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByTestId('diagnostic-panel')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "跳到主要内容" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=e5]:
    - banner [ref=e6]:
      - button "展开或收起导航" [ref=e7] [cursor=pointer]
      - generic [ref=e10]: C 语言 · 从零开始
      - generic [ref=e11]:
        - generic [ref=e12]: 本地学习
        - link "本地数据" [ref=e13] [cursor=pointer]:
          - /url: "#/settings?panel=data"
        - button "切换为深色" [ref=e17] [cursor=pointer]
    - main [ref=e20]:
      - alert [ref=e21]:
        - generic [ref=e25]:
          - heading "页面加载失败" [level=2] [ref=e26]
          - paragraph [ref=e27]: 页面资源暂时无法加载。检查连接后可重新加载当前页面。
          - button "重新加载" [ref=e29] [cursor=pointer]
```

# Test source

```ts
  198 |   const broken = (await rows(page)).editHistory.find(
  199 |     (r) => r.scope.exerciseRef.id === q.exerciseRef.id && r.codeText === q.brokenSource,
  200 |   )!;
  201 |   expect(broken).toBeDefined();
  202 |   await editor(page).fill(q.solutionSource);
  203 |   await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  204 |   await submit(page);
  205 |   const repaired = (await rows(page)).editHistory.find(
  206 |     (r) => r.scope.exerciseRef.id === q.exerciseRef.id && r.codeText === q.solutionSource,
  207 |   )!;
  208 |   expect(repaired).toBeDefined();
  209 |   await page.reload();
  210 |   await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  211 |   await history(page).locator('summary').first().click();
  212 |   for (const row of [repaired, broken]) {
  213 |     await page
  214 |       .getByRole('combobox', { name: '内存关卡历史版本', exact: true })
  215 |       .selectOption(row.entryId);
  216 |     await page.getByRole('button', { name: '恢复所选版本', exact: true }).click();
  217 |     await expect(editor(page)).toHaveValue(row.codeText);
  218 |     await expect(root(page)).toHaveAttribute('data-run-id', '');
  219 |     await expect(root(page)).toHaveAttribute('data-length', '0');
  220 |   }
  221 |   await page.getByRole('button', { name: '运行本组', exact: true }).click();
  222 |   await expect(root(page)).toHaveAttribute('data-state', 'unmet');
  223 |   await page
  224 |     .getByRole('combobox', { name: '关卡测试输入', exact: true })
  225 |     .selectOption(q.tests[1].caseKey);
  226 |   await expect(root(page)).toHaveAttribute('data-run-id', '');
  227 | });
  228 | test('real held replies cannot survive source edits or explicit cancellation', async ({ page }) => {
  229 |   await page.addInitScript(() => {
  230 |     const Native = window.Worker;
  231 |     const held: (() => void)[] = [];
  232 |     const state = { hold: true, held };
  233 |     Object.assign(window, { __heldMemoryBug: state });
  234 |     window.Worker = class extends Native {
  235 |       override set onmessage(handler: Worker['onmessage']) {
  236 |         super.onmessage = handler
  237 |           ? (event) => {
  238 |               const deliver = () => handler.call(this, event);
  239 |               if (state.hold) held.push(deliver);
  240 |               else deliver();
  241 |             }
  242 |           : null;
  243 |       }
  244 |       override get onmessage() {
  245 |         return super.onmessage;
  246 |       }
  247 |     };
  248 |   });
  249 |   const q = await open(page);
  250 |   await editor(page).fill(q.solutionSource);
  251 |   await page.getByRole('button', { name: '运行本组', exact: true }).click();
  252 |   await page.waitForFunction(
  253 |     () =>
  254 |       (window as unknown as { __heldMemoryBug: { held: unknown[] } }).__heldMemoryBug.held
  255 |         .length === 1,
  256 |   );
  257 |   await editor(page).fill(q.alternativeSource);
  258 |   await page.evaluate(() => {
  259 |     const h = (window as unknown as { __heldMemoryBug: { held: (() => void)[] } }).__heldMemoryBug;
  260 |     h.held.splice(0).forEach((fn) => fn());
  261 |   });
  262 |   await expect(root(page)).toHaveAttribute('data-run-id', '');
  263 |   await page.getByRole('button', { name: '运行本组', exact: true }).click();
  264 |   await page.waitForFunction(
  265 |     () =>
  266 |       (window as unknown as { __heldMemoryBug: { held: unknown[] } }).__heldMemoryBug.held
  267 |         .length === 1,
  268 |   );
  269 |   await page.getByRole('button', { name: '取消提交', exact: true }).click();
  270 |   await page.evaluate(() => {
  271 |     const h = (window as unknown as { __heldMemoryBug: { hold: boolean; held: (() => void)[] } })
  272 |       .__heldMemoryBug;
  273 |     h.hold = false;
  274 |     h.held.splice(0).forEach((fn) => fn());
  275 |   });
  276 |   await expect(root(page)).toHaveAttribute('data-run-id', '');
  277 |   expect((await rows(page)).ledger).toHaveLength(0);
  278 |   await submit(page);
  279 | });
  280 | test('eight-level catalog and real diagnostic remain usable at three widths', async ({ page }) => {
  281 |   await page.goto('/#/bugs');
  282 |   await expect(page.locator('[data-page-id="PAGE-14-3"] article')).toHaveCount(8);
  283 |   await page
  284 |     .getByRole('link', { name: `修复：${memoryBugQuestions[0].title}`, exact: true })
  285 |     .click();
  286 |   await expect(editor(page)).toHaveValue(memoryBugQuestions[0].brokenSource);
  287 |   await page.getByRole('button', { name: '查看第 1 层提示', exact: true }).click();
  288 |   await expect(page.getByRole('region', { name: '内存关卡提示与解析' })).toContainText(
  289 |     memoryBugQuestions[0].hints[0],
  290 |   );
  291 |   await page.getByRole('button', { name: '运行本组', exact: true }).click();
  292 |   await expect(root(page)).toHaveAttribute('data-state', 'unmet');
  293 |   await mkdir(folder, { recursive: true });
  294 |   for (const width of [1440, 768, 390]) {
  295 |     await page.setViewportSize({ width, height: 900 });
  296 |     const tab = page.getByRole('tab', { name: '真实执行复盘', exact: true });
  297 |     if (await tab.isVisible()) await tab.click();
> 298 |     await page.getByTestId('diagnostic-panel').scrollIntoViewIfNeeded();
      |                                                ^ Error: locator.scrollIntoViewIfNeeded: Test timeout of 30000ms exceeded.
  299 |     await page.screenshot({ path: `${folder}/memory-bug-${width}.png` });
  300 |     await expect
  301 |       .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
  302 |       .toBeLessThanOrEqual(1);
  303 |   }
  304 | });
  305 | test('missing atomic content disables all new memory execution and grants no progress', async ({
  306 |   page,
  307 | }) => {
  308 |   await page.route(`**/${p05CourseRelease.file}`, (route) => route.abort());
  309 |   await page.goto(`/#/bugs/memory/${memoryBugQuestions[0].exerciseRef.id}`);
  310 |   await expect(page.getByRole('button', { name: '运行本组', exact: true })).toBeDisabled();
  311 |   await expect(root(page)).toContainText('受审关卡资源不可用');
  312 | });
  313 | if (p05CourseRelease.registered) {
  314 |   test('quota retry keeps the same real event and awards once', async ({ page }) => {
  315 |     await page.addInitScript(() => {
  316 |       const fault = { armed: false, hits: 0, eventId: '' };
  317 |       Object.assign(window, { __memoryBugFault: fault });
  318 |       const add = IDBObjectStore.prototype.add;
  319 |       IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
  320 |         const row = value as { eventType?: string; eventId?: string };
  321 |         if (fault.armed && this.name === 'receipts' && row.eventType === 'exercise.passed') {
  322 |           fault.hits++;
  323 |           fault.eventId = row.eventId!;
  324 |           throw new DOMException('14.4 quota test', 'QuotaExceededError');
  325 |         }
  326 |         return key === undefined ? add.call(this, value) : add.call(this, value, key);
  327 |       };
  328 |     });
  329 |     const q = await open(page, 1);
  330 |     await editor(page).fill(q.solutionSource);
  331 |     await page.evaluate(
  332 |       () =>
  333 |         ((window as unknown as { __memoryBugFault: { armed: boolean } }).__memoryBugFault.armed =
  334 |           true),
  335 |     );
  336 |     await page.getByRole('button', { name: '提交全部4组', exact: true }).click();
  337 |     await expect(root(page)).toHaveAttribute('data-state', 'passed');
  338 |     await expect(root(page)).toHaveAttribute('data-save-state', 'unsaved');
  339 |     expect((await rows(page)).ledger).toHaveLength(0);
  340 |     const fault = await page.evaluate(() => {
  341 |       const f = (
  342 |         window as unknown as { __memoryBugFault: { armed: boolean; hits: number; eventId: string } }
  343 |       ).__memoryBugFault;
  344 |       f.armed = false;
  345 |       return { ...f };
  346 |     });
  347 |     expect(fault.hits).toBeGreaterThan(0);
  348 |     await page.getByRole('button', { name: '重试未保存操作', exact: true }).click();
  349 |     await expect(root(page)).toHaveAttribute('data-save-state', 'saved');
  350 |     const first = await rows(page);
  351 |     expect(first.receipts.some((r) => r.eventId === fault.eventId)).toBe(true);
  352 |     expect(first.ledger).toHaveLength(1);
  353 |     await submit(page);
  354 |     expect((await rows(page)).ledger).toEqual(first.ledger);
  355 |     await mkdir(folder, { recursive: true });
  356 |     await writeFile(
  357 |       `${folder}/quota-retry.json`,
  358 |       JSON.stringify({ fault, first, after: await rows(page) }, null, 2) + '\n',
  359 |     );
  360 |   });
  361 |   test('original C,14.3 and memory Bug keep three separate first rewards after refresh', async ({
  362 |     page,
  363 |   }) => {
  364 |     await page.goto('/#/practice/exercise.c.echo');
  365 |     await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
  366 |     const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  367 |     await expect(code).toBeVisible();
  368 |     await code.fill((await code.inputValue()).replace('return 0;', 'printf("%d\\n", x);return 0;'));
  369 |     await page.getByRole('button', { name: '提交练习', exact: true }).click();
  370 |     await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  371 |       'data-save-state',
  372 |       'saved',
  373 |     );
  374 |     const old = await rows(page);
  375 |     await page.goto('/#/practice/exercise.c.bug-semicolon');
  376 |     await expect(code).toBeVisible();
  377 |     await expect.poll(() => code.inputValue()).toContain('printf("%d\\n", x)\n');
  378 |     await code.fill(
  379 |       (await code.inputValue()).replace('printf("%d\\n", x)\n', 'printf("%d\\n", x);\n'),
  380 |     );
  381 |     await page.getByRole('button', { name: '提交练习', exact: true }).click();
  382 |     await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  383 |       'data-save-state',
  384 |       'saved',
  385 |     );
  386 |     const previous = await rows(page);
  387 |     const q = await open(page);
  388 |     await editor(page).fill(q.solutionSource);
  389 |     await submit(page);
  390 |     const all = await rows(page);
  391 |     expect(all.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass')).toHaveLength(3);
  392 |     expect(
  393 |       all.ledger.filter((r) =>
  394 |         old.ledger.some((o) => o.sourceId === r.sourceId && o.subjectId === r.subjectId),
  395 |       ),
  396 |     ).toEqual(old.ledger);
  397 |     expect(
  398 |       all.ledger.filter((r) =>
```