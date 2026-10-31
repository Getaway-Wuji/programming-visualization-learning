# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-performance.spec.ts >> P1 current production navigation and maximum-scale real execution use qualified HTTPS network and unchanged deadlines
- Location: tests\browser\phase2-performance.spec.ts:296:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -   1
+ Received  + 228

- Array []
+ Array [
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"failed\">…</div>
+     11 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "home",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"failed\">…</div>
+     11 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "home",
+     "index": 2,
+     "navigation": true,
+   },
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     11 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "home",
+     "index": 3,
+     "navigation": true,
+   },
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"failed\">…</div>
+     11 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "home",
+     "index": 4,
+     "navigation": true,
+   },
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     11 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "home",
+     "index": 5,
+     "navigation": true,
+   },
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     11 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "courses",
+     "index": 2,
+     "navigation": true,
+   },
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     11 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "courses",
+     "index": 4,
+     "navigation": true,
+   },
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"unsaved\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"failed\">…</div>
+     10 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "lesson",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"unsaved\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"failed\">…</div>
+     10 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "lesson",
+     "index": 2,
+     "navigation": true,
+   },
+   Object {
+     "error": "Error: expect(locator).toHaveAttribute(expected) failed
+
+ Locator:  locator('.app-shell')
+ Expected: \"ready\"
+ Received: \"unsaved\"
+ Timeout:  5000ms
+
+ Call log:
+   - Expect \"toHaveAttribute\" locator('.app-shell') with timeout 5000ms
+   - waiting for locator('.app-shell')
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"loading\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"loading\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-profile-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-learning-reading-status=\"loading\" data-learning-practice-status=\"loading\" data-achievement-storage-status=\"failed\">…</div>
+     - unexpected value \"unsaved\"
+     - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-review-storage-status=\"failed\" data-learning-goal-status=\"loading\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-reward-status=\"loading\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"failed\">…</div>
+     10 × unexpected value \"unsaved\"
+        - locator resolved to <div data-nav-open=\"false\" data-sidebar=\"expanded\" class=\"app-shell p05-app\" data-workbench-mode=\"standard\" data-learning-goal-status=\"ready\" data-review-storage-status=\"ready\" data-learning-reward-status=\"ready\" data-learning-reading-status=\"ready\" data-learning-profile-status=\"ready\" data-learning-practice-status=\"ready\" data-learning-storage-status=\"unsaved\" data-achievement-storage-status=\"ready\">…</div>
+     - unexpected value \"unsaved\"
+ ",
+     "id": "lesson",
+     "index": 4,
+     "navigation": true,
+   },
+ ]
```

# Test source

```ts
  336 |             const p = await c.newPage();
  337 |             await p.bringToFront();
  338 |             await p.addInitScript(
  339 |               ({ selector, registered }) => {
  340 |                 const scope = window as any;
  341 |                 scope.phase2Navigation = { end: null };
  342 |                 const inspect = () => {
  343 |                   if (scope.phase2Navigation.end !== null) return;
  344 |                   const target = document.querySelector(selector),
  345 |                     shell = document.querySelector('.app-shell');
  346 |                   if (
  347 |                     target &&
  348 |                     target.getBoundingClientRect().height > 0 &&
  349 |                     ['ready', ...(registered ? [] : ['unsaved'])].includes(
  350 |                       shell?.getAttribute('data-learning-storage-status') ?? '',
  351 |                     ) &&
  352 |                     shell?.getAttribute('data-learning-reading-status') === 'ready' &&
  353 |                     shell?.getAttribute('data-learning-practice-status') ===
  354 |                       (registered ? 'ready' : 'failed')
  355 |                   )
  356 |                     requestAnimationFrame(() =>
  357 |                       requestAnimationFrame(() => {
  358 |                         if (scope.phase2Navigation.end === null)
  359 |                           scope.phase2Navigation.end = performance.now();
  360 |                       }),
  361 |                     );
  362 |                 };
  363 |                 document.addEventListener('DOMContentLoaded', () => {
  364 |                   new MutationObserver(inspect).observe(document.documentElement, {
  365 |                     subtree: true,
  366 |                     childList: true,
  367 |                     attributes: true,
  368 |                   });
  369 |                   inspect();
  370 |                 });
  371 |               },
  372 |               { selector, registered: p05CourseRelease.registered },
  373 |             );
  374 |             await p.goto('/#' + route);
  375 |             await ready(p);
  376 |             await p.waitForFunction(() => (window as any).phase2Navigation.end !== null, null, {
  377 |               timeout: 10000,
  378 |             });
  379 |             const observed = await p.evaluate(async () => {
  380 |               await new Promise<void>((resolve) =>
  381 |                 requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  382 |               );
  383 |               return {
  384 |                 initialDomElapsedMs: (window as any).phase2Navigation.end,
  385 |                 elapsedMs: performance.now(),
  386 |                 visibility: document.visibilityState,
  387 |                 focus: document.hasFocus(),
  388 |                 resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
  389 |               };
  390 |             });
  391 |             report.navigation.push({
  392 |               id,
  393 |               mode,
  394 |               index: i,
  395 |               ...observed,
  396 |               passed:
  397 |                 observed.elapsedMs <= 2000 && observed.visibility === 'visible' && observed.focus,
  398 |             });
  399 |             await p.close();
  400 |           }
  401 |         } catch (e) {
  402 |           report.failures.push({ id, index: i, navigation: true, error: String(e) });
  403 |         } finally {
  404 |           await c.close();
  405 |         }
  406 |       }
  407 |     for (const d of definitions)
  408 |       for (let i = 1; i <= repeat; i++) {
  409 |         const c = await browser.newContext({
  410 |           viewport: { width: 1440, height: 900 },
  411 |           serviceWorkers: 'block',
  412 |         });
  413 |         try {
  414 |           const p = await c.newPage();
  415 |           await p.bringToFront();
  416 |           await p.addInitScript(installPhase2Probe);
  417 |           await prepare(p, d);
  418 |           report.execution.push(await sample(p, d, 'first-context', i));
  419 |           report.execution.push(await sample(p, d, 'warm-module', i));
  420 |         } catch (e) {
  421 |           report.failures.push({ id: d.id, index: i, execution: true, error: String(e) });
  422 |         } finally {
  423 |           await c.close();
  424 |         }
  425 |       }
  426 |   } finally {
  427 |     report.hostEnd = capturePerformanceHost(output, 'end');
  428 |     report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
  429 |     report.summary = {
  430 |       navigation: stats(report.navigation.map((r: any) => r.elapsedMs)),
  431 |       execution: stats(report.execution.map((r: any) => r.elapsedMs)),
  432 |       original500Deviations: report.execution.filter((r: any) => !r.original500Ms).length,
  433 |     };
  434 |     write('measurements', report);
  435 |   }
> 436 |   expect(report.failures).toEqual([]);
      |                           ^ Error: expect(received).toEqual(expected) // deep equality
  437 |   expect(report.qualification.satisfied).toBe(true);
  438 |   expect(report.navigation.every((r: any) => r.passed)).toBe(true);
  439 |   expect(
  440 |     report.execution.every(
  441 |       (r: any) =>
  442 |         r.valid &&
  443 |         r.groupWithinUnchangedDeadline &&
  444 |         r.executionPartitions.every(
  445 |           (part: any) => part.elapsedMs !== null && part.elapsedMs <= part.acceptedThresholdMs,
  446 |         ),
  447 |     ),
  448 |   ).toBe(true);
  449 | });
  450 | 
  451 | async function traceEnd(session: CDPSession) {
  452 |   const complete = new Promise<any>((r) => session.once('Tracing.tracingComplete', r));
  453 |   await session.send('Tracing.end');
  454 |   const event = await complete;
  455 |   let text = '';
  456 |   for (;;) {
  457 |     const chunk = await session.send('IO.read', { handle: event.stream });
  458 |     text += chunk.data;
  459 |     if (chunk.eof) break;
  460 |   }
  461 |   await session.send('IO.close', { handle: event.stream });
  462 |   return JSON.parse(text);
  463 | }
  464 | test('P1 validation CPU diagnostic preserves all validation and original deadlines', async ({
  465 |   page: p,
  466 | }) => {
  467 |   const d = definitions.find((x) => x.id === 'c-pair30')!;
  468 |   await p.addInitScript(installPhase2Probe);
  469 |   await p.bringToFront();
  470 |   await prepare(p, d);
  471 |   const first = await sample(p, d, 'diagnostic-first', 1);
  472 |   const session = await p.context().newCDPSession(p);
  473 |   await session.send('Profiler.enable');
  474 |   await session.send('Profiler.setSamplingInterval', { interval: 1000 });
  475 |   await session.send('Profiler.start');
  476 |   const second = await sample(p, d, 'diagnostic-warm', 1);
  477 |   const { profile } = await session.send('Profiler.stop');
  478 |   await session.detach();
  479 |   write('diagnostic-profile', profile);
  480 |   write('diagnostic-summary', {
  481 |     first,
  482 |     second,
  483 |     boundary: 'CPU diagnostic adds sampling overhead; never a formal performance pass.',
  484 |   });
  485 | });
  486 | test('P1 two30-item panels and real recursion stack remain responsive for three independent30-second stable playbacks', async ({
  487 |   page: p,
  488 | }) => {
  489 |   test.skip(pilot, 'Pilot checks setup and timings before the longer formal playback.');
  490 |   const playbackOutput = `${output}/playback-host`;
  491 |   mkdirSync(playbackOutput, { recursive: true });
  492 |   const report: any = {
  493 |     task: '16.10',
  494 |     hostStart: capturePerformanceHost(playbackOutput, 'start'),
  495 |     cases: [],
  496 |     boundary:
  497 |       'Timer callback entry→MutationObserver after cursor DOM commit is a conservative application pipeline upper bound, with unchanged native125ms delay. CDP drawing/submission is separate from physical panel presentation.',
  498 |   };
  499 |   await p.addInitScript(installPhase2Probe);
  500 |   try {
  501 |     for (const id of ['c-pair30', 'cpp-pair30', 'memory-hanoi5']) {
  502 |       const d = definitions.find((x) => x.id === id)!;
  503 |       await p.bringToFront();
  504 |       await prepare(p, d);
  505 |       const execution = await sample(p, d, 'playback-preparation', 1);
  506 |       expect(execution.valid).toBe(true);
  507 |       const rate =
  508 |         id === 'c-pair30'
  509 |           ? '对比回放速度'
  510 |           : id === 'cpp-pair30'
  511 |             ? 'C++对比回放速度'
  512 |             : '内存播放速度';
  513 |       await p.getByRole('combobox', { name: rate, exact: true }).selectOption('4');
  514 |       const root = p.locator(d.root);
  515 |       await root.locator(d.slider).fill('0');
  516 |       const control =
  517 |         id === 'memory-hanoi5' ? p.locator('.memory-stage') : p.locator('.comparison-controls');
  518 |       await control.scrollIntoViewIfNeeded();
  519 |       const session = await p.context().newCDPSession(p);
  520 |       await session.send('Tracing.start', {
  521 |         transferMode: 'ReturnAsStream',
  522 |         categories:
  523 |           'devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.screenshot,cc,viz,benchmark,blink.user_timing,toplevel',
  524 |       });
  525 |       const start = await p.evaluate((id) => {
  526 |         const a = (window as any).phase2Perf;
  527 |         a.recording = true;
  528 |         a.lastCursor = 0;
  529 |         a.startAt = performance.now();
  530 |         performance.mark('phase2-' + id);
  531 |         return a.startAt;
  532 |       }, id);
  533 |       await control
  534 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '播放' : '播放对比', exact: true })
  535 |         .click();
  536 |       await p.waitForTimeout(2200);
```