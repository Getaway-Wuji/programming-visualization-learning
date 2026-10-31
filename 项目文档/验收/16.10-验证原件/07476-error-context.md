# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-performance.spec.ts >> P1 current production navigation and maximum-scale real execution use qualified HTTPS network and unchanged deadlines
- Location: tests\browser\phase2-performance.spec.ts:227:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  264 |         });
  265 |         try {
  266 |           for (const mode of ['cold', 'warm']) {
  267 |             const p = await c.newPage();
  268 |             await p.bringToFront();
  269 |             await p.addInitScript(
  270 |               ({ selector, registered }) => {
  271 |                 const scope = window as any;
  272 |                 scope.phase2Navigation = { end: null };
  273 |                 const inspect = () => {
  274 |                   if (scope.phase2Navigation.end !== null) return;
  275 |                   const target = document.querySelector(selector),
  276 |                     shell = document.querySelector('.app-shell');
  277 |                   if (
  278 |                     target &&
  279 |                     target.getBoundingClientRect().height > 0 &&
  280 |                     ['ready', ...(registered ? [] : ['unsaved'])].includes(shell?.getAttribute('data-learning-storage-status') ?? '') &&
  281 |                     shell?.getAttribute('data-learning-reading-status') === 'ready' &&
  282 |                     shell?.getAttribute('data-learning-practice-status') === (registered ? 'ready' : 'failed')
  283 |                   )
  284 |                     requestAnimationFrame(() =>
  285 |                       requestAnimationFrame(() => {
  286 |                         if (scope.phase2Navigation.end === null)
  287 |                           scope.phase2Navigation.end = performance.now();
  288 |                       }),
  289 |                     );
  290 |                 };
  291 |                 document.addEventListener('DOMContentLoaded', () => {
  292 |                   new MutationObserver(inspect).observe(document.documentElement, {
  293 |                     subtree: true,
  294 |                     childList: true,
  295 |                     attributes: true,
  296 |                   });
  297 |                   inspect();
  298 |                 });
  299 |               },
  300 |               { selector, registered: p05CourseRelease.registered },
  301 |             );
  302 |             await p.goto('/#' + route);
  303 |             await ready(p);
  304 |             await p.waitForFunction(() => (window as any).phase2Navigation.end !== null, null, {
  305 |               timeout: 10000,
  306 |             });
  307 |             const observed = await p.evaluate(async () => {
  308 |               await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  309 |               return {
  310 |               initialDomElapsedMs: (window as any).phase2Navigation.end,
  311 |               elapsedMs: performance.now(),
  312 |               visibility: document.visibilityState,
  313 |               focus: document.hasFocus(),
  314 |               resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
  315 |             }; });
  316 |             report.navigation.push({
  317 |               id,
  318 |               mode,
  319 |               index: i,
  320 |               ...observed,
  321 |               passed:
  322 |                 observed.elapsedMs <= 2000 && observed.visibility === 'visible' && observed.focus,
  323 |             });
  324 |             await p.close();
  325 |           }
  326 |         } catch (e) {
  327 |           report.failures.push({ id, index: i, navigation: true, error: String(e) });
  328 |         } finally {
  329 |           await c.close();
  330 |         }
  331 |       }
  332 |     for (const d of definitions)
  333 |       for (let i = 1; i <= repeat; i++) {
  334 |         const c = await browser.newContext({
  335 |           viewport: { width: 1440, height: 900 },
  336 |           serviceWorkers: 'block',
  337 |         });
  338 |         try {
  339 |           const p = await c.newPage();
  340 |           await p.bringToFront();
  341 |           await p.addInitScript(installPhase2Probe);
  342 |           await prepare(p, d);
  343 |           report.execution.push(await sample(p, d, 'first-context', i));
  344 |           report.execution.push(await sample(p, d, 'warm-module', i));
  345 |         } catch (e) {
  346 |           report.failures.push({ id: d.id, index: i, execution: true, error: String(e) });
  347 |         } finally {
  348 |           await c.close();
  349 |         }
  350 |       }
  351 |   } finally {
  352 |     report.hostEnd = capturePerformanceHost(output, 'end');
  353 |     report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
  354 |     report.summary = {
  355 |       navigation: stats(report.navigation.map((r: any) => r.elapsedMs)),
  356 |       execution: stats(report.execution.map((r: any) => r.elapsedMs)),
  357 |       original500Deviations: report.execution.filter((r: any) => !r.original500Ms).length,
  358 |     };
  359 |     write('measurements', report);
  360 |   }
  361 |   expect(report.failures).toEqual([]);
  362 |   expect(report.qualification.satisfied).toBe(true);
  363 |   expect(report.navigation.every((r: any) => r.passed)).toBe(true);
> 364 |   expect(report.execution.every((r: any) => r.valid && r.elapsedMs <= r.acceptedThresholdMs)).toBe(
      |                                                                                               ^ Error: expect(received).toBe(expected) // Object.is equality
  365 |     true,
  366 |   );
  367 | });
  368 | 
  369 | async function traceEnd(session: CDPSession) {
  370 |   const complete = new Promise<any>((r) => session.once('Tracing.tracingComplete', r));
  371 |   await session.send('Tracing.end');
  372 |   const event = await complete;
  373 |   let text = '';
  374 |   for (;;) {
  375 |     const chunk = await session.send('IO.read', { handle: event.stream });
  376 |     text += chunk.data;
  377 |     if (chunk.eof) break;
  378 |   }
  379 |   await session.send('IO.close', { handle: event.stream });
  380 |   return JSON.parse(text);
  381 | }
  382 | test('P1 two30-item panels and real recursion stack remain responsive for three independent30-second stable playbacks', async ({
  383 |   page: p,
  384 | }) => {
  385 |   test.skip(pilot, 'Pilot checks setup and timings before the longer formal playback.');
  386 |   const playbackOutput = `${output}/playback-host`;
  387 |   mkdirSync(playbackOutput, { recursive: true });
  388 |   const report: any = {
  389 |     task: '16.10',
  390 |     hostStart: capturePerformanceHost(playbackOutput, 'start'),
  391 |     cases: [],
  392 |     boundary:
  393 |       'Timer callback entry→MutationObserver after cursor DOM commit is a conservative application pipeline upper bound, with unchanged native125ms delay. CDP drawing/submission is separate from physical panel presentation.',
  394 |   };
  395 |   try {
  396 |     for (const id of ['c-pair30', 'cpp-pair30', 'memory-hanoi5']) {
  397 |       const d = definitions.find((x) => x.id === id)!;
  398 |       await p.addInitScript(installPhase2Probe);
  399 |       await p.bringToFront();
  400 |       await prepare(p, d);
  401 |       const execution = await sample(p, d, 'playback-preparation', 1);
  402 |       expect(execution.valid).toBe(true);
  403 |       const rate =
  404 |         id === 'c-pair30'
  405 |           ? '对比回放速度'
  406 |           : id === 'cpp-pair30'
  407 |             ? 'C++对比回放速度'
  408 |             : '内存播放速度';
  409 |       await p.getByRole('combobox', { name: rate, exact: true }).selectOption('4');
  410 |       const root = p.locator(d.root);
  411 |       await root.locator(d.slider).fill('0');
  412 |       const control =
  413 |         id === 'memory-hanoi5' ? p.locator('.memory-stage') : p.locator('.comparison-controls');
  414 |       await control.scrollIntoViewIfNeeded();
  415 |       const session = await p.context().newCDPSession(p);
  416 |       await session.send('Tracing.start', {
  417 |         transferMode: 'ReturnAsStream',
  418 |         categories:
  419 |           'devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.screenshot,cc,viz,benchmark,blink.user_timing,toplevel',
  420 |       });
  421 |       const start = await p.evaluate((id) => {
  422 |         const a = (window as any).phase2Perf;
  423 |         a.recording = true;
  424 |         a.lastCursor = 0;
  425 |         a.startAt = performance.now();
  426 |         performance.mark('phase2-' + id);
  427 |         return a.startAt;
  428 |       }, id);
  429 |       await control
  430 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '播放' : '播放对比', exact: true })
  431 |         .click();
  432 |       await p.waitForTimeout(2200);
  433 |       await p.screenshot({ path: `${output}/${id}-start.png`, fullPage: true });
  434 |       await p.waitForTimeout(15000);
  435 |       await p.screenshot({ path: `${output}/${id}-middle.png`, fullPage: true });
  436 |       await p.waitForTimeout(15000);
  437 |       await p.screenshot({ path: `${output}/${id}-end.png`, fullPage: true });
  438 |       const audit = await p.evaluate(readPhase2Probe);
  439 |       await p.evaluate(() => {
  440 |         (window as any).phase2Perf.recording = false;
  441 |       });
  442 |       await control
  443 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '暂停' : '暂停对比', exact: true })
  444 |         .click();
  445 |       const trace = await traceEnd(session);
  446 |       await session.detach();
  447 |       writeFileSync(`${output}/${id}-trace.json.gz`, gzipSync(JSON.stringify(trace)), {
  448 |         flag: 'wx',
  449 |       });
  450 |       const stableStart = start + 2000,
  451 |         stableEnd = stableStart + 30000,
  452 |         raf = audit.raf.filter((t: number) => t >= stableStart && t <= stableEnd),
  453 |         gaps = raf.slice(1).map((t: number, i: number) => t - raf[i]),
  454 |         commits = audit.commits.filter((r: any) => r.at >= stableStart && r.at <= stableEnd),
  455 |         work = stats(commits.map((r: any) => r.duration)),
  456 |         rafStats = stats(gaps),
  457 |         ratio = gaps.filter((v: number) => v > 33.3).length / gaps.length;
  458 |       const mark = trace.traceEvents.find((r: any) => r.name === 'phase2-' + id),
  459 |         offset = mark.ts - start * 1000,
  460 |         events = trace.traceEvents.filter(
  461 |           (r: any) => r.ts >= offset + stableStart * 1000 && r.ts <= offset + stableEnd * 1000,
  462 |         ),
  463 |         draw = events.filter((r: any) => r.name === 'DrawFrame').length,
  464 |         paint = events.filter((r: any) => r.name === 'Paint').length,
```