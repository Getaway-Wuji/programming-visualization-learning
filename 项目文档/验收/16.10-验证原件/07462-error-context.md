# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-performance.spec.ts >> P1 current production navigation and maximum-scale real execution use qualified HTTPS network and unchanged deadlines
- Location: tests\browser\phase2-performance.spec.ts:225:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 68

- Array []
+ Array [
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "home",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "courses",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "lesson",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "practice",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "cases",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "case",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "settings",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "c-pair",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "cpp-pair",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "memory",
+     "index": 1,
+     "navigation": true,
+   },
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "classic",
+     "index": 1,
+     "navigation": true,
+   },
+ ]
```

# Test source

```ts
  259 |         const c = await browser.newContext({
  260 |           viewport: { width: 1440, height: 900 },
  261 |           serviceWorkers: 'block',
  262 |         });
  263 |         try {
  264 |           for (const mode of ['cold', 'warm']) {
  265 |             const p = await c.newPage();
  266 |             await p.bringToFront();
  267 |             await p.addInitScript(
  268 |               ({ selector }) => {
  269 |                 const scope = window as any;
  270 |                 scope.phase2Navigation = { end: null };
  271 |                 const inspect = () => {
  272 |                   if (scope.phase2Navigation.end !== null) return;
  273 |                   const target = document.querySelector(selector),
  274 |                     shell = document.querySelector('.app-shell');
  275 |                   if (
  276 |                     target &&
  277 |                     target.getBoundingClientRect().height > 0 &&
  278 |                     shell?.getAttribute('data-learning-storage-status') === 'ready' &&
  279 |                     shell?.getAttribute('data-learning-reading-status') === 'ready' &&
  280 |                     shell?.getAttribute('data-learning-practice-status') === 'ready'
  281 |                   )
  282 |                     requestAnimationFrame(() =>
  283 |                       requestAnimationFrame(() => {
  284 |                         if (scope.phase2Navigation.end === null)
  285 |                           scope.phase2Navigation.end = performance.now();
  286 |                       }),
  287 |                     );
  288 |                 };
  289 |                 document.addEventListener('DOMContentLoaded', () => {
  290 |                   new MutationObserver(inspect).observe(document.documentElement, {
  291 |                     subtree: true,
  292 |                     childList: true,
  293 |                     attributes: true,
  294 |                   });
  295 |                   inspect();
  296 |                 });
  297 |               },
  298 |               { selector },
  299 |             );
  300 |             await p.goto('/#' + route);
  301 |             await ready(p);
  302 |             await p.waitForFunction(() => (window as any).phase2Navigation.end !== null, null, {
  303 |               timeout: 10000,
  304 |             });
  305 |             const observed = await p.evaluate(async () => {
  306 |               await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  307 |               return {
  308 |               initialDomElapsedMs: (window as any).phase2Navigation.end,
  309 |               elapsedMs: performance.now(),
  310 |               visibility: document.visibilityState,
  311 |               focus: document.hasFocus(),
  312 |               resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
  313 |             }; });
  314 |             report.navigation.push({
  315 |               id,
  316 |               mode,
  317 |               index: i,
  318 |               ...observed,
  319 |               passed:
  320 |                 observed.elapsedMs <= 2000 && observed.visibility === 'visible' && observed.focus,
  321 |             });
  322 |             await p.close();
  323 |           }
  324 |         } catch (e) {
  325 |           report.failures.push({ id, index: i, navigation: true, error: String(e) });
  326 |         } finally {
  327 |           await c.close();
  328 |         }
  329 |       }
  330 |     for (const d of definitions)
  331 |       for (let i = 1; i <= repeat; i++) {
  332 |         const c = await browser.newContext({
  333 |           viewport: { width: 1440, height: 900 },
  334 |           serviceWorkers: 'block',
  335 |         });
  336 |         try {
  337 |           const p = await c.newPage();
  338 |           await p.bringToFront();
  339 |           await p.addInitScript(installPhase2Probe);
  340 |           await prepare(p, d);
  341 |           report.execution.push(await sample(p, d, 'first-context', i));
  342 |           report.execution.push(await sample(p, d, 'warm-module', i));
  343 |         } catch (e) {
  344 |           report.failures.push({ id: d.id, index: i, execution: true, error: String(e) });
  345 |         } finally {
  346 |           await c.close();
  347 |         }
  348 |       }
  349 |   } finally {
  350 |     report.hostEnd = capturePerformanceHost(output, 'end');
  351 |     report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
  352 |     report.summary = {
  353 |       navigation: stats(report.navigation.map((r: any) => r.elapsedMs)),
  354 |       execution: stats(report.execution.map((r: any) => r.elapsedMs)),
  355 |       original500Deviations: report.execution.filter((r: any) => !r.original500Ms).length,
  356 |     };
  357 |     write('measurements', report);
  358 |   }
> 359 |   expect(report.failures).toEqual([]);
      |                           ^ Error: expect(received).toEqual(expected) // deep equality
  360 |   expect(report.qualification.satisfied).toBe(true);
  361 |   expect(report.navigation.every((r: any) => r.passed)).toBe(true);
  362 |   expect(report.execution.every((r: any) => r.valid && r.elapsedMs <= r.acceptedThresholdMs)).toBe(
  363 |     true,
  364 |   );
  365 | });
  366 | 
  367 | async function traceEnd(session: CDPSession) {
  368 |   const complete = new Promise<any>((r) => session.once('Tracing.tracingComplete', r));
  369 |   await session.send('Tracing.end');
  370 |   const event = await complete;
  371 |   let text = '';
  372 |   for (;;) {
  373 |     const chunk = await session.send('IO.read', { handle: event.stream });
  374 |     text += chunk.data;
  375 |     if (chunk.eof) break;
  376 |   }
  377 |   await session.send('IO.close', { handle: event.stream });
  378 |   return JSON.parse(text);
  379 | }
  380 | test('P1 two30-item panels and real recursion stack remain responsive for three independent30-second stable playbacks', async ({
  381 |   page: p,
  382 | }) => {
  383 |   test.skip(pilot, 'Pilot checks setup and timings before the longer formal playback.');
  384 |   const playbackOutput = `${output}/playback-host`;
  385 |   mkdirSync(playbackOutput, { recursive: true });
  386 |   const report: any = {
  387 |     task: '16.10',
  388 |     hostStart: capturePerformanceHost(playbackOutput, 'start'),
  389 |     cases: [],
  390 |     boundary:
  391 |       'Timer callback entry→MutationObserver after cursor DOM commit is a conservative application pipeline upper bound, with unchanged native125ms delay. CDP drawing/submission is separate from physical panel presentation.',
  392 |   };
  393 |   try {
  394 |     for (const id of ['c-pair30', 'cpp-pair30', 'memory-hanoi5']) {
  395 |       const d = definitions.find((x) => x.id === id)!;
  396 |       await p.addInitScript(installPhase2Probe);
  397 |       await p.bringToFront();
  398 |       await prepare(p, d);
  399 |       const execution = await sample(p, d, 'playback-preparation', 1);
  400 |       expect(execution.valid).toBe(true);
  401 |       const rate =
  402 |         id === 'c-pair30'
  403 |           ? '对比回放速度'
  404 |           : id === 'cpp-pair30'
  405 |             ? 'C++对比回放速度'
  406 |             : '内存播放速度';
  407 |       await p.getByRole('combobox', { name: rate, exact: true }).selectOption('4');
  408 |       const root = p.locator(d.root);
  409 |       await root.locator(d.slider).fill('0');
  410 |       const control =
  411 |         id === 'memory-hanoi5' ? p.locator('.memory-stage') : p.locator('.comparison-controls');
  412 |       await control.scrollIntoViewIfNeeded();
  413 |       const session = await p.context().newCDPSession(p);
  414 |       await session.send('Tracing.start', {
  415 |         transferMode: 'ReturnAsStream',
  416 |         categories:
  417 |           'devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.screenshot,cc,viz,benchmark,blink.user_timing,toplevel',
  418 |       });
  419 |       const start = await p.evaluate((id) => {
  420 |         const a = (window as any).phase2Perf;
  421 |         a.recording = true;
  422 |         a.lastCursor = 0;
  423 |         a.startAt = performance.now();
  424 |         performance.mark('phase2-' + id);
  425 |         return a.startAt;
  426 |       }, id);
  427 |       await control
  428 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '播放' : '播放对比', exact: true })
  429 |         .click();
  430 |       await p.waitForTimeout(2200);
  431 |       await p.screenshot({ path: `${output}/${id}-start.png`, fullPage: true });
  432 |       await p.waitForTimeout(15000);
  433 |       await p.screenshot({ path: `${output}/${id}-middle.png`, fullPage: true });
  434 |       await p.waitForTimeout(15000);
  435 |       await p.screenshot({ path: `${output}/${id}-end.png`, fullPage: true });
  436 |       const audit = await p.evaluate(readPhase2Probe);
  437 |       await p.evaluate(() => {
  438 |         (window as any).phase2Perf.recording = false;
  439 |       });
  440 |       await control
  441 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '暂停' : '暂停对比', exact: true })
  442 |         .click();
  443 |       const trace = await traceEnd(session);
  444 |       await session.detach();
  445 |       writeFileSync(`${output}/${id}-trace.json.gz`, gzipSync(JSON.stringify(trace)), {
  446 |         flag: 'wx',
  447 |       });
  448 |       const stableStart = start + 2000,
  449 |         stableEnd = stableStart + 30000,
  450 |         raf = audit.raf.filter((t: number) => t >= stableStart && t <= stableEnd),
  451 |         gaps = raf.slice(1).map((t: number, i: number) => t - raf[i]),
  452 |         commits = audit.commits.filter((r: any) => r.at >= stableStart && r.at <= stableEnd),
  453 |         work = stats(commits.map((r: any) => r.duration)),
  454 |         rafStats = stats(gaps),
  455 |         ratio = gaps.filter((v: number) => v > 33.3).length / gaps.length;
  456 |       const mark = trace.traceEvents.find((r: any) => r.name === 'phase2-' + id),
  457 |         offset = mark.ts - start * 1000,
  458 |         events = trace.traceEvents.filter(
  459 |           (r: any) => r.ts >= offset + stableStart * 1000 && r.ts <= offset + stableEnd * 1000,
```