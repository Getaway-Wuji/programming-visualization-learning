# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: snapshot-export.spec.ts >> pending actual PNG is cancelled by clear
- Location: tests\browser\snapshot-export.spec.ts:378:3

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByTestId('snapshot-export')
Expected: "idle"
Received: "failed"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" getByTestId('snapshot-export') with timeout 5000ms
  - waiting for getByTestId('snapshot-export')
    13 × locator resolved to <section aria-label="当前快照导出" data-phase="capturing" class="snapshot-export" data-testid="snapshot-export">…</section>
       - unexpected value "capturing"
    - locator resolved to <section aria-label="当前快照导出" data-phase="failed" class="snapshot-export" data-testid="snapshot-export">…</section>
    - unexpected value "failed"

```

```yaml
- region "当前快照导出":
  - heading "保存当前快照" [level=4]
  - text: 仅下载到你的设备
  - paragraph: 文件包含当前源码、输入和完整运行状态，请自行管理。PNG也附带同一状态数据，分享前请确认。
  - button "下载状态文件（JSON）"
  - button "下载快照图片（PNG）"
  - group: 文件包含范围
  - alert: 生成快照超过5秒，未发起下载。可以重新选择格式重试。
```

# Test source

```ts
  300 |       await new Promise<void>((resolve) => {
  301 |         hold.release = () => {
  302 |           hold.waiting = false;
  303 |           resolve();
  304 |         };
  305 |       });
  306 |       return value;
  307 |     };
  308 |     const digest = crypto.subtle.digest.bind(crypto.subtle);
  309 |     crypto.subtle.digest = async (algorithm, data) =>
  310 |       defer(await digest(algorithm, data), 'digest');
  311 |     const nativeBlob = HTMLCanvasElement.prototype.toBlob;
  312 |     HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
  313 |       if (hold.arm === 'canvas-null') {
  314 |         hold.arm = 'none';
  315 |         callback(null);
  316 |         return;
  317 |       }
  318 |       nativeBlob.call(
  319 |         this,
  320 |         (blob) => {
  321 |           void defer(blob, 'canvas').then(callback);
  322 |         },
  323 |         type,
  324 |         quality,
  325 |       );
  326 |     };
  327 |     const ready = Object.getOwnPropertyDescriptor(FontFaceSet.prototype, 'ready')!;
  328 |     Object.defineProperty(FontFaceSet.prototype, 'ready', {
  329 |       configurable: true,
  330 |       get() {
  331 |         return Promise.resolve(ready.get!.call(this)).then((value) => defer(value, 'fonts'));
  332 |       },
  333 |     });
  334 |     const url = URL.createObjectURL;
  335 |     URL.createObjectURL = (blob) => {
  336 |       if (hold.arm === 'url-fail') {
  337 |         hold.arm = 'none';
  338 |         throw Error('Controlled download failure');
  339 |       }
  340 |       return url(blob);
  341 |     };
  342 |   });
  343 | }
  344 | async function arm(p: Page, phase: Hold['arm']) {
  345 |   await p.evaluate((phase) => {
  346 |     window.snapshotHold.arm = phase;
  347 |   }, phase);
  348 | }
  349 | async function waiting(p: Page) {
  350 |   await expect.poll(() => p.evaluate(() => window.snapshotHold.waiting)).toBe(true);
  351 | }
  352 | async function release(p: Page) {
  353 |   await p.evaluate(() => window.snapshotHold.release());
  354 | }
  355 | 
  356 | for (const phase of ['digest', 'canvas', 'fonts'] as const)
  357 |   test(`a real ${phase} continuation cannot download after step-away-and-back`, async ({
  358 |     page: p,
  359 |   }) => {
  360 |     await observeCaseSetExecution(p);
  361 |     await controls(p);
  362 |     await runMemory(p);
  363 |     let count = 0;
  364 |     p.on('download', () => count++);
  365 |     await arm(p, phase);
  366 |     await formatButton(p, 'png').click();
  367 |     await waiting(p);
  368 |     await p.getByRole('slider', { name: '执行步骤', exact: true }).fill('1');
  369 |     await p.getByRole('slider', { name: '执行步骤', exact: true }).fill('0');
  370 |     await expect(exporter(p)).toHaveAttribute('data-phase', 'cancelled');
  371 |     await release(p);
  372 |     await p.waitForTimeout(150);
  373 |     expect(count).toBe(0);
  374 |     const real = await captured(p, `${phase}-retry`);
  375 |     verify((await download(p, 'png')).document, real, 0);
  376 |   });
  377 | for (const action of ['source', 'input', 'run', 'mode', 'unmount', 'clear'] as const)
  378 |   test(`pending actual PNG is cancelled by ${action}`, async ({ page: p, context }) => {
  379 |     await observeCaseSetExecution(p);
  380 |     await controls(p);
  381 |     await runMemory(p);
  382 |     let count = 0;
  383 |     p.on('download', () => count++);
  384 |     await arm(p, 'canvas');
  385 |     await formatButton(p, 'png').click();
  386 |     await waiting(p);
  387 |     if (action === 'source')
  388 |       await p.getByLabel('观察样例', { exact: true }).selectOption('functions');
  389 |     if (action === 'input') await p.getByLabel('三个节点值', { exact: true }).fill('7 -2 0');
  390 |     if (action === 'run') await p.getByRole('button', { name: '运行样例', exact: true }).click();
  391 |     if (action === 'mode') await p.getByRole('button', { name: '基础视图', exact: true }).click();
  392 |     if (action === 'unmount') await p.goto('/#/cases');
  393 |     if (action === 'clear') {
  394 |       const peer = await context.newPage();
  395 |       await clear(peer);
  396 |       await peer.close();
  397 |     }
  398 |     if (action === 'clear') {
  399 |       // A session clear remounts the workspace; the new actor starts empty.
> 400 |       await expect(exporter(p)).toHaveAttribute('data-phase', 'idle');
      |                                 ^ Error: expect(locator).toHaveAttribute(expected) failed
  401 |       await expect(formatButton(p, 'json')).toBeDisabled();
  402 |     } else if (action !== 'unmount')
  403 |       await expect(exporter(p)).toHaveAttribute('data-phase', 'cancelled');
  404 |     await release(p);
  405 |     await p.waitForTimeout(150);
  406 |     expect(count).toBe(0);
  407 |   });
  408 | test('manual cancellation, native encoding failure, timeout and download failure all allow explicit retry', async ({
  409 |   page: p,
  410 | }) => {
  411 |   await observeCaseSetExecution(p);
  412 |   await controls(p);
  413 |   await runMemory(p);
  414 |   let count = 0;
  415 |   p.on('download', () => count++);
  416 |   await arm(p, 'canvas');
  417 |   await formatButton(p, 'png').click();
  418 |   await waiting(p);
  419 |   await p.getByRole('button', { name: '取消导出', exact: true }).click();
  420 |   await expect(exporter(p)).toHaveAttribute('data-phase', 'cancelled');
  421 |   await release(p);
  422 |   for (const phase of ['canvas-null', 'url-fail'] as const) {
  423 |     await arm(p, phase);
  424 |     await formatButton(p, 'png').click();
  425 |     await expect(exporter(p)).toHaveAttribute('data-phase', 'failed');
  426 |     await expect(p.getByTestId('snapshot-export-status')).toContainText('请重试');
  427 |   }
  428 |   await arm(p, 'fonts');
  429 |   await formatButton(p, 'png').click();
  430 |   await waiting(p);
  431 |   await expect(exporter(p)).toHaveAttribute('data-phase', 'failed', { timeout: 7000 });
  432 |   await expect(p.getByTestId('snapshot-export-status')).toContainText('超过5秒');
  433 |   await release(p);
  434 |   expect(count).toBe(0);
  435 |   const real = await captured(p, 'failure-retry');
  436 |   verify((await download(p, 'png')).document, real, 0);
  437 | });
  438 | test('literal Unicode seed remains inert in files and absent from URLs, console and learning stores', async ({
  439 |   page: p,
  440 | }) => {
  441 |   await observeCaseSetExecution(p);
  442 |   await ready(p, 'visualize/case.c.bubble-sort');
  443 |   const marker = '<script>window.snapshotInjected=1</script>中文😀\u202e',
  444 |     logs: string[] = [],
  445 |     urls: string[] = [];
  446 |   p.on('console', (m) => logs.push(m.text()));
  447 |   p.on('request', (r) => urls.push(r.url()));
  448 |   await p.getByTestId('input-seed').fill(marker);
  449 |   await p.getByRole('button', { name: '按种子复现', exact: true }).click();
  450 |   await p.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  451 |   await p.getByRole('button', { name: '运行示例', exact: true }).click();
  452 |   await expect(formatButton(p, 'json')).toBeEnabled();
  453 |   const real = await captured(p, 'literal-seed'),
  454 |     before = await native(p);
  455 |   const json = await download(p, 'json'),
  456 |     png = await download(p, 'png');
  457 |   verify(json.document, real, 0);
  458 |   verify(png.document, real, 0);
  459 |   expect(JSON.stringify(json.document.input)).toContain(marker);
  460 |   expect(JSON.stringify(png.document.input)).toContain(marker);
  461 |   expect(
  462 |     await p.evaluate(() => (window as unknown as { snapshotInjected?: number }).snapshotInjected),
  463 |   ).toBeUndefined();
  464 |   expect(
  465 |     [...logs, ...urls, p.url(), json.name, png.name].some(
  466 |       (s) => s.includes(marker) || s.includes(encodeURIComponent(marker)),
  467 |     ),
  468 |   ).toBe(false);
  469 |   expect(await native(p)).toEqual(before);
  470 | });
  471 | 
  472 | test('an export pauses the original playing memory model and never resumes it', async ({
  473 |   page: p,
  474 | }) => {
  475 |   await observeCaseSetExecution(p);
  476 |   await runMemory(p, 'nodes');
  477 |   const real = await captured(p, 'pause-original');
  478 |   await p.getByRole('button', { name: '播放', exact: true }).click();
  479 |   const file = await download(p, 'png'),
  480 |     cursor = file.document.position.cursor;
  481 |   verify(file.document, real, cursor);
  482 |   await expect(p.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  483 |   await p.waitForTimeout(600);
  484 |   await expect(p.getByTestId('memory-workspace')).toHaveAttribute('data-cursor', String(cursor));
  485 |   expect(
  486 |     await p.evaluate(
  487 |       () => window.__verticalObservation.workers.filter((w) => w.moduleSeen && w.responseOk).length,
  488 |     ),
  489 |   ).toBe(1);
  490 | });
  491 | test('the real 32-frame error prefix exports intact JSON and a complete bounded picture', async ({
  492 |   page: p,
  493 | }) => {
  494 |   await observeCaseSetExecution(p);
  495 |   await runMemory(p, 'stack-limit');
  496 |   const real = await captured(p, 'deep-prefix'),
  497 |     cursor = real.result.trace!.steps.length;
  498 |   await seek(p, real, cursor);
  499 |   const file = await download(p, 'json');
  500 |   verify(file.document, real, cursor);
```