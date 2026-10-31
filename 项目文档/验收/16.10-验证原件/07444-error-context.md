# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-performance.spec.ts >> P1 current production navigation and maximum-scale real execution use qualified HTTPS network and unchanged deadlines
- Location: tests\browser\phase2-performance.spec.ts:301:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  369 |                   new MutationObserver(inspect).observe(document.documentElement, {
  370 |                     subtree: true,
  371 |                     childList: true,
  372 |                     attributes: true,
  373 |                   });
  374 |                   inspect();
  375 |                 });
  376 |               },
  377 |               { selector, registered: p05CourseRelease.registered },
  378 |             );
  379 |             await p.goto('/#' + route);
  380 |             await ready(p);
  381 |             await p.waitForFunction(() => (window as any).phase2Navigation.end !== null, null, {
  382 |               timeout: 10000,
  383 |             });
  384 |             const observed = await p.evaluate(async () => {
  385 |               await new Promise<void>((resolve) =>
  386 |                 requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  387 |               );
  388 |               return {
  389 |                 initialDomElapsedMs: (window as any).phase2Navigation.end,
  390 |                 elapsedMs: performance.now(),
  391 |                 storageStatus: document
  392 |                   .querySelector('.app-shell')
  393 |                   ?.getAttribute('data-learning-storage-status'),
  394 |                 readingStatus: document
  395 |                   .querySelector('.app-shell')
  396 |                   ?.getAttribute('data-learning-reading-status'),
  397 |                 practiceStatus: document
  398 |                   .querySelector('.app-shell')
  399 |                   ?.getAttribute('data-learning-practice-status'),
  400 |                 visibility: document.visibilityState,
  401 |                 focus: document.hasFocus(),
  402 |                 resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
  403 |               };
  404 |             });
  405 |             report.navigation.push({
  406 |               id,
  407 |               mode,
  408 |               index: i,
  409 |               ...observed,
  410 |               passed:
  411 |                 observed.elapsedMs <= 2000 &&
  412 |                 (p05CourseRelease.registered
  413 |                   ? observed.storageStatus === 'ready'
  414 |                   : ['ready', 'unsaved'].includes(observed.storageStatus ?? '')) &&
  415 |                 observed.readingStatus === 'ready' &&
  416 |                 observed.practiceStatus === (p05CourseRelease.registered ? 'ready' : 'failed') &&
  417 |                 observed.visibility === 'visible' &&
  418 |                 observed.focus,
  419 |             });
  420 |             await p.close();
  421 |           }
  422 |         } catch (e) {
  423 |           report.failures.push({ id, index: i, navigation: true, error: String(e) });
  424 |         } finally {
  425 |           await c.close();
  426 |         }
  427 |       }
  428 |     for (const d of definitions)
  429 |       for (let i = 1; i <= repeat; i++) {
  430 |         const c = await browser.newContext({
  431 |           viewport: { width: 1440, height: 900 },
  432 |           serviceWorkers: 'block',
  433 |         });
  434 |         try {
  435 |           const p = await c.newPage();
  436 |           await p.bringToFront();
  437 |           await p.addInitScript(installPhase2Probe);
  438 |           await prepare(p, d);
  439 |           report.execution.push(await sample(p, d, 'first-context', i));
  440 |           report.execution.push(await sample(p, d, 'warm-module', i));
  441 |         } catch (e) {
  442 |           report.failures.push({ id: d.id, index: i, execution: true, error: String(e) });
  443 |         } finally {
  444 |           await c.close();
  445 |         }
  446 |       }
  447 |   } finally {
  448 |     report.hostEnd = capturePerformanceHost(output, 'end');
  449 |     report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
  450 |     report.summary = {
  451 |       navigation: stats(report.navigation.map((r: any) => r.elapsedMs)),
  452 |       execution: stats(report.execution.map((r: any) => r.elapsedMs)),
  453 |       original500Deviations: report.execution.filter((r: any) => !r.original500Ms).length,
  454 |     };
  455 |     write('measurements', report);
  456 |   }
  457 |   expect(report.failures).toEqual([]);
  458 |   expect(report.qualification.satisfied).toBe(true);
  459 |   expect(report.navigation.every((r: any) => r.passed)).toBe(true);
  460 |   expect(
  461 |     report.execution.every(
  462 |       (r: any) =>
  463 |         r.valid &&
  464 |         r.groupWithinUnchangedDeadline &&
  465 |         r.executionPartitions.every(
  466 |           (part: any) => part.elapsedMs !== null && part.elapsedMs <= part.acceptedThresholdMs,
  467 |         ),
  468 |     ),
> 469 |   ).toBe(true);
      |     ^ Error: expect(received).toBe(expected) // Object.is equality
  470 | });
  471 | 
  472 | async function traceEnd(session: CDPSession) {
  473 |   const complete = new Promise<any>((r) => session.once('Tracing.tracingComplete', r));
  474 |   await session.send('Tracing.end');
  475 |   const event = await complete;
  476 |   let text = '';
  477 |   for (;;) {
  478 |     const chunk = await session.send('IO.read', { handle: event.stream });
  479 |     text += chunk.data;
  480 |     if (chunk.eof) break;
  481 |   }
  482 |   await session.send('IO.close', { handle: event.stream });
  483 |   return JSON.parse(text);
  484 | }
  485 | test('P1 archive initialization diagnostic observes real cold storage without changing state', async ({
  486 |   browser,
  487 | }) => {
  488 |   for (const [id, route] of [
  489 |     ['home-1', '/'],
  490 |     ['home-2', '/'],
  491 |     ['home-3', '/'],
  492 |     ['home-4', '/'],
  493 |     ['home-5', '/'],
  494 |     ['courses', '/courses'],
  495 |   ]) {
  496 |     const context = await browser.newContext({
  497 |       viewport: { width: 1440, height: 900 },
  498 |       serviceWorkers: 'block',
  499 |     });
  500 |     try {
  501 |       for (const mode of ['cold', 'warm']) {
  502 |         const page = await context.newPage();
  503 |         await page.bringToFront();
  504 |         await page.addInitScript(
  505 |           ({ registered }) => {
  506 |             const scope = window as any;
  507 |             scope.phase2Navigation = { end: null };
  508 |             const inspect = () => {
  509 |               if (scope.phase2Navigation.end !== null) return;
  510 |               const target = document.querySelector(
  511 |                   '[data-testid="home-continue-learning"], [data-course-lesson]',
  512 |                 ),
  513 |                 shell = document.querySelector('.app-shell');
  514 |               if (
  515 |                 target &&
  516 |                 target.getBoundingClientRect().height > 0 &&
  517 |                 shell?.getAttribute('data-learning-storage-status') === 'ready' &&
  518 |                 shell?.getAttribute('data-learning-reading-status') === 'ready' &&
  519 |                 shell?.getAttribute('data-learning-practice-status') ===
  520 |                   (registered ? 'ready' : 'failed')
  521 |               )
  522 |                 requestAnimationFrame(() =>
  523 |                   requestAnimationFrame(() => {
  524 |                     if (scope.phase2Navigation.end === null)
  525 |                       scope.phase2Navigation.end = performance.now();
  526 |                   }),
  527 |                 );
  528 |             };
  529 |             document.addEventListener('DOMContentLoaded', () => {
  530 |               new MutationObserver(inspect).observe(document.documentElement, {
  531 |                 subtree: true,
  532 |                 childList: true,
  533 |                 attributes: true,
  534 |               });
  535 |               inspect();
  536 |             });
  537 |           },
  538 |           { registered: p05CourseRelease.registered },
  539 |         );
  540 |         await page.goto('/#' + route);
  541 |         let readinessFailure: string | null = null;
  542 |         try {
  543 |           await ready(page);
  544 |         } catch (e) {
  545 |           readinessFailure = String(e).split('\n')[0];
  546 |         }
  547 |         await page.waitForTimeout(1800);
  548 |         const ui = await page.evaluate(() => ({
  549 |           shell: document.querySelector('.app-shell')?.outerHTML.slice(0, 1300),
  550 |           status: [...document.querySelectorAll('[data-testid="learning-save-status"]')].map(
  551 |             (e) => ({ text: e.textContent, html: e.outerHTML }),
  552 |           ),
  553 |           body: document.body.innerText.slice(0, 4000),
  554 |         }));
  555 |         write(`initialization-${id}-${mode}`, {
  556 |           readinessFailure,
  557 |           ui,
  558 |           archive: await native(page),
  559 |           boundary:
  560 |             'Read-only cold/warm initial-state diagnosis with the original passive navigation observer; no storage edits or automatic retries.',
  561 |         });
  562 |         await page.screenshot({
  563 |           path: `${output}/initialization-${id}-${mode}.png`,
  564 |           fullPage: true,
  565 |         });
  566 |         await page.close();
  567 |       }
  568 |     } finally {
  569 |       await context.close();
```