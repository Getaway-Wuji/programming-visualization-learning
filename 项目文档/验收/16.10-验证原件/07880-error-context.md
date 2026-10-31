# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: execution.spec.ts >> switching visible cases discards a queued real result before the next case runs
- Location: tests\browser\execution.spec.ts:543:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: getByTestId('execution-output')
Timeout: 5000ms
- Expected  - 1
+ Received  + 1

- 1 2 3
+ -3 -3 0 2 5 7 9
  ↵

Call log:
  - Expect "toHaveText" getByTestId('execution-output') with timeout 5000ms
  - waiting for getByTestId('execution-output')
    14 × locator resolved to <pre tabindex="0" aria-label="程序完整输出" class="sample-source" data-testid="execution-output">-3 -3 0 2 5 7 9↵</pre>
       - unexpected value "-3 -3 0 2 5 7 9
"

```

```yaml
- text: "-3 -3 0 2 5 7 9"
```

# Test source

```ts
  464 |     session: Object.entries(sessionStorage),
  465 |     writes: window.__executionAudit.storageWrites,
  466 |     cookie: document.cookie,
  467 |     caches: await caches.keys(),
  468 |     databases: await indexedDB.databases(),
  469 |   }));
  470 |   expect(
  471 |     requests.every(
  472 |       (request) =>
  473 |         request.method === 'GET' &&
  474 |         request.body === null &&
  475 |         new URL(request.url).origin === new URL(page.url()).origin,
  476 |     ),
  477 |   ).toBe(true);
  478 |   for (const value of [requests, logs, stored, page.url()])
  479 |     expect(JSON.stringify(value)).not.toContain('CVIZ-07.1-PUBLIC-AUDIT');
  480 |   expect(stored.caches).toEqual([]);
  481 |   expect(stored.databases).toEqual([]);
  482 |   await testInfo.attach('runtime-content-boundary', {
  483 |     body: JSON.stringify({
  484 |       requestCount: requests.length,
  485 |       consoleCount: logs.length,
  486 |       storageWrites: stored.writes.length,
  487 |       cacheNames: stored.caches,
  488 |       databases: stored.databases,
  489 |     }),
  490 |     contentType: 'application/json',
  491 |   });
  492 | });
  493 | 
  494 | test('the visible case runs the exact read-only source and exposes real terminal, steps, output and ready playback', async ({
  495 |   page,
  496 | }, testInfo) => {
  497 |   await observe(page);
  498 |   await page.goto('/#/visualize/case.c.assignment');
  499 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  500 |   await expect(panel(page).getByRole('textbox', { name: '当前执行的 C 代码' })).toHaveValue(
  501 |     /int x = 3;/,
  502 |   );
  503 |   await run(page).click();
  504 |   await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  505 |   await expect(page.getByTestId('execution-terminal')).toContainText(/正常|完成/);
  506 |   await expect(page.getByTestId('execution-output')).toHaveText('5\n');
  507 |   await expect(page.getByTestId('execution-steps')).toContainText(/\d+/);
  508 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-player-status', 'ready');
  509 |   await expect(
  510 |     page.getByTestId('player-controls').getByRole('button', { name: '播放', exact: true }),
  511 |   ).toBeEnabled();
  512 |   await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', '0');
  513 |   await expect(page.getByTestId('source-location')).toContainText('初始');
  514 |   await expect(page.getByTestId('case-view-confirmation')).toHaveAttribute(
  515 |     'data-view-state',
  516 |     'incomplete',
  517 |   );
  518 |   await expect(page.getByRole('button', { name: '确认已观看', exact: true })).toBeDisabled();
  519 |   await page.screenshot({ path: testInfo.outputPath('real-case-execution.png'), fullPage: true });
  520 | });
  521 | 
  522 | test('visible module failure is distinct from program completion and retry uses real Rust', async ({
  523 |   page,
  524 | }) => {
  525 |   await page.route(/\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/, (route) =>
  526 |     route.fulfill({ status: 404, contentType: 'application/wasm', body: 'Missing public module' }),
  527 |   );
  528 |   await page.goto('/#/visualize/case.c.assignment');
  529 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  530 |   await run(page).click();
  531 |   await expect(panel(page)).toHaveAttribute('data-state', 'infrastructure-failure');
  532 |   await expect(panel(page).getByRole('alert')).toBeVisible();
  533 |   await expect(panel(page)).toContainText('E_MODULE_LOAD');
  534 |   await expect(page.getByTestId('execution-steps')).toContainText('有效轨迹：0 步');
  535 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  536 |   await expect(page.getByTestId('execution-output')).toHaveText('（无输出）');
  537 |   await page.unroute(/\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/);
  538 |   await run(page).click();
  539 |   await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  540 |   await expect(page.getByTestId('execution-output')).toHaveText('5\n');
  541 | });
  542 | 
  543 | test('switching visible cases discards a queued real result before the next case runs', async ({
  544 |   page,
  545 | }) => {
  546 |   await observe(page);
  547 |   await page.goto('/#/visualize/case.c.assignment');
  548 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  549 |   await page.evaluate(() => {
  550 |     window.__executionAudit.hold = true;
  551 |   });
  552 |   await run(page).click();
  553 |   await expect.poll(() => page.evaluate(() => window.__executionAudit.held)).toBe(1);
  554 |   await page.evaluate(() => {
  555 |     location.hash = '#/visualize/case.c.selection-sort';
  556 |   });
  557 |   await expect(page.locator('main h1')).toHaveText('选择排序');
  558 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  559 |   await page.evaluate(() => window.__executionAudit.release());
  560 |   await expect(page.getByTestId('execution-output')).toHaveCount(0);
  561 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  562 |   await run(page).click();
  563 |   await expect(panel(page)).toHaveAttribute('data-state', 'completed');
> 564 |   await expect(page.getByTestId('execution-output')).toHaveText('1 2 3\n');
      |                                                      ^ Error: expect(locator).toHaveText(expected) failed
  565 | });
  566 | 
  567 | test('clearing local data in a peer tab invalidates an already accepted real trajectory', async ({
  568 |   page,
  569 |   context,
  570 | }) => {
  571 |   await page.goto('/#/visualize/case.c.assignment');
  572 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  573 |   await run(page).click();
  574 |   await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  575 |   await page
  576 |     .getByTestId('player-controls')
  577 |     .getByRole('button', { name: '播放', exact: true })
  578 |     .click();
  579 |   await expect(page.getByTestId('player-controls')).toHaveAttribute(
  580 |     'data-player-status',
  581 |     'playing',
  582 |   );
  583 |   const settings = await context.newPage();
  584 |   await settings.goto('/#/settings?panel=data');
  585 |   await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  586 |   await settings
  587 |     .getByRole('dialog', { name: '确认清除本地数据', exact: true })
  588 |     .getByRole('button', { name: '确认清除', exact: true })
  589 |     .click();
  590 |   await expect(settings.getByTestId('learning-save-status')).toContainText('本地数据已清除');
  591 |   // The existing page boundary remounts on the new local-data generation.
  592 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  593 |   await expect(page.getByTestId('execution-output')).toHaveCount(0);
  594 |   await expect(page.getByTestId('code-panel').locator('textarea')).toHaveValue(/int x = 3;/);
  595 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  596 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-cursor', '');
  597 |   await page.waitForTimeout(650);
  598 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  599 |   await expect(page.getByTestId('execution-output')).toHaveCount(0);
  600 | });
  601 | 
```