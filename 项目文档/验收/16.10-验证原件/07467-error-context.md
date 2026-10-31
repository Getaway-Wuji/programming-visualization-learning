# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-performance.spec.ts >> P1 current production navigation and maximum-scale real execution use qualified HTTPS network and unchanged deadlines
- Location: tests\browser\phase2-performance.spec.ts:224:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  257 |       for (let i = 1; i <= (pilot ? 1 : 5); i++) {
  258 |         const c = await browser.newContext({
  259 |           viewport: { width: 1440, height: 900 },
  260 |           serviceWorkers: 'block',
  261 |         });
  262 |         try {
  263 |           for (const mode of ['cold', 'warm']) {
  264 |             const p = await c.newPage();
  265 |             await p.bringToFront();
  266 |             await p.addInitScript(
  267 |               ({ selector }) => {
  268 |                 const scope = window as any;
  269 |                 scope.phase2Navigation = { end: null };
  270 |                 const inspect = () => {
  271 |                   if (scope.phase2Navigation.end !== null) return;
  272 |                   const target = document.querySelector(selector),
  273 |                     shell = document.querySelector('.app-shell');
  274 |                   if (
  275 |                     target &&
  276 |                     target.getBoundingClientRect().height > 0 &&
  277 |                     shell?.getAttribute('data-learning-storage-status') === 'ready' &&
  278 |                     shell?.getAttribute('data-learning-reading-status') === 'ready' &&
  279 |                     shell?.getAttribute('data-learning-practice-status') === 'ready'
  280 |                   )
  281 |                     requestAnimationFrame(() =>
  282 |                       requestAnimationFrame(() => {
  283 |                         if (scope.phase2Navigation.end === null)
  284 |                           scope.phase2Navigation.end = performance.now();
  285 |                       }),
  286 |                     );
  287 |                 };
  288 |                 document.addEventListener('DOMContentLoaded', () => {
  289 |                   new MutationObserver(inspect).observe(document.documentElement, {
  290 |                     subtree: true,
  291 |                     childList: true,
  292 |                     attributes: true,
  293 |                   });
  294 |                   inspect();
  295 |                 });
  296 |               },
  297 |               { selector },
  298 |             );
  299 |             await p.goto('/#' + route);
  300 |             await p.waitForFunction(() => (window as any).phase2Navigation.end !== null, null, {
  301 |               timeout: 10000,
  302 |             });
  303 |             const observed = await p.evaluate(() => ({
  304 |               elapsedMs: (window as any).phase2Navigation.end,
  305 |               visibility: document.visibilityState,
  306 |               focus: document.hasFocus(),
  307 |               resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
  308 |             }));
  309 |             report.navigation.push({
  310 |               id,
  311 |               mode,
  312 |               index: i,
  313 |               ...observed,
  314 |               passed:
  315 |                 observed.elapsedMs <= 2000 && observed.visibility === 'visible' && observed.focus,
  316 |             });
  317 |             await p.close();
  318 |           }
  319 |         } catch (e) {
  320 |           report.failures.push({ id, index: i, navigation: true, error: String(e) });
  321 |         } finally {
  322 |           await c.close();
  323 |         }
  324 |       }
  325 |     for (const d of definitions)
  326 |       for (let i = 1; i <= repeat; i++) {
  327 |         const c = await browser.newContext({
  328 |           viewport: { width: 1440, height: 900 },
  329 |           serviceWorkers: 'block',
  330 |         });
  331 |         try {
  332 |           const p = await c.newPage();
  333 |           await p.bringToFront();
  334 |           await p.addInitScript(installPhase2Probe);
  335 |           await prepare(p, d);
  336 |           report.execution.push(await sample(p, d, 'first-context', i));
  337 |           report.execution.push(await sample(p, d, 'warm-module', i));
  338 |         } catch (e) {
  339 |           report.failures.push({ id: d.id, index: i, execution: true, error: String(e) });
  340 |         } finally {
  341 |           await c.close();
  342 |         }
  343 |       }
  344 |   } finally {
  345 |     report.hostEnd = capturePerformanceHost(output, 'end');
  346 |     report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
  347 |     report.summary = {
  348 |       navigation: stats(report.navigation.map((r: any) => r.elapsedMs)),
  349 |       execution: stats(report.execution.map((r: any) => r.elapsedMs)),
  350 |       original500Deviations: report.execution.filter((r: any) => !r.original500Ms).length,
  351 |     };
  352 |     write('measurements', report);
  353 |   }
  354 |   expect(report.failures).toEqual([]);
  355 |   expect(report.qualification.satisfied).toBe(true);
  356 |   expect(report.navigation.every((r: any) => r.passed)).toBe(true);
> 357 |   expect(report.execution.every((r: any) => r.valid && r.elapsedMs <= r.acceptedThresholdMs)).toBe(
      |                                                                                               ^ Error: expect(received).toBe(expected) // Object.is equality
  358 |     true,
  359 |   );
  360 | });
  361 | 
  362 | async function traceEnd(session: CDPSession) {
  363 |   const complete = new Promise<any>((r) => session.once('Tracing.tracingComplete', r));
  364 |   await session.send('Tracing.end');
  365 |   const event = await complete;
  366 |   let text = '';
  367 |   for (;;) {
  368 |     const chunk = await session.send('IO.read', { handle: event.stream });
  369 |     text += chunk.data;
  370 |     if (chunk.eof) break;
  371 |   }
  372 |   await session.send('IO.close', { handle: event.stream });
  373 |   return JSON.parse(text);
  374 | }
  375 | test('P1 two30-item panels and real recursion stack remain responsive for three independent30-second stable playbacks', async ({
  376 |   page: p,
  377 | }) => {
  378 |   test.skip(pilot, 'Pilot checks setup and timings before the longer formal playback.');
  379 |   const playbackOutput = `${output}/playback-host`;
  380 |   mkdirSync(playbackOutput, { recursive: true });
  381 |   const report: any = {
  382 |     task: '16.10',
  383 |     hostStart: capturePerformanceHost(playbackOutput, 'start'),
  384 |     cases: [],
  385 |     boundary:
  386 |       'Timer callback entry→MutationObserver after cursor DOM commit is a conservative application pipeline upper bound, with unchanged native125ms delay. CDP drawing/submission is separate from physical panel presentation.',
  387 |   };
  388 |   try {
  389 |     for (const id of ['c-pair30', 'cpp-pair30', 'memory-hanoi5']) {
  390 |       const d = definitions.find((x) => x.id === id)!;
  391 |       await p.addInitScript(installPhase2Probe);
  392 |       await p.bringToFront();
  393 |       await prepare(p, d);
  394 |       const execution = await sample(p, d, 'playback-preparation', 1);
  395 |       expect(execution.valid).toBe(true);
  396 |       const rate =
  397 |         id === 'c-pair30'
  398 |           ? '对比回放速度'
  399 |           : id === 'cpp-pair30'
  400 |             ? 'C++对比回放速度'
  401 |             : '内存播放速度';
  402 |       await p.getByRole('combobox', { name: rate, exact: true }).selectOption('4');
  403 |       const root = p.locator(d.root);
  404 |       await root.locator(d.slider).fill('0');
  405 |       const control =
  406 |         id === 'memory-hanoi5' ? p.locator('.memory-stage') : p.locator('.comparison-controls');
  407 |       await control.scrollIntoViewIfNeeded();
  408 |       const session = await p.context().newCDPSession(p);
  409 |       await session.send('Tracing.start', {
  410 |         transferMode: 'ReturnAsStream',
  411 |         categories:
  412 |           'devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.screenshot,cc,viz,benchmark,blink.user_timing,toplevel',
  413 |       });
  414 |       const start = await p.evaluate((id) => {
  415 |         const a = (window as any).phase2Perf;
  416 |         a.recording = true;
  417 |         a.lastCursor = 0;
  418 |         a.startAt = performance.now();
  419 |         performance.mark('phase2-' + id);
  420 |         return a.startAt;
  421 |       }, id);
  422 |       await control
  423 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '播放' : '播放对比', exact: true })
  424 |         .click();
  425 |       await p.waitForTimeout(2200);
  426 |       await p.screenshot({ path: `${output}/${id}-start.png`, fullPage: true });
  427 |       await p.waitForTimeout(15000);
  428 |       await p.screenshot({ path: `${output}/${id}-middle.png`, fullPage: true });
  429 |       await p.waitForTimeout(15000);
  430 |       await p.screenshot({ path: `${output}/${id}-end.png`, fullPage: true });
  431 |       const audit = await p.evaluate(readPhase2Probe);
  432 |       await p.evaluate(() => {
  433 |         (window as any).phase2Perf.recording = false;
  434 |       });
  435 |       await control
  436 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '暂停' : '暂停对比', exact: true })
  437 |         .click();
  438 |       const trace = await traceEnd(session);
  439 |       await session.detach();
  440 |       writeFileSync(`${output}/${id}-trace.json.gz`, gzipSync(JSON.stringify(trace)), {
  441 |         flag: 'wx',
  442 |       });
  443 |       const stableStart = start + 2000,
  444 |         stableEnd = stableStart + 30000,
  445 |         raf = audit.raf.filter((t: number) => t >= stableStart && t <= stableEnd),
  446 |         gaps = raf.slice(1).map((t: number, i: number) => t - raf[i]),
  447 |         commits = audit.commits.filter((r: any) => r.at >= stableStart && r.at <= stableEnd),
  448 |         work = stats(commits.map((r: any) => r.duration)),
  449 |         rafStats = stats(gaps),
  450 |         ratio = gaps.filter((v: number) => v > 33.3).length / gaps.length;
  451 |       const mark = trace.traceEvents.find((r: any) => r.name === 'phase2-' + id),
  452 |         offset = mark.ts - start * 1000,
  453 |         events = trace.traceEvents.filter(
  454 |           (r: any) => r.ts >= offset + stableStart * 1000 && r.ts <= offset + stableEnd * 1000,
  455 |         ),
  456 |         draw = events.filter((r: any) => r.name === 'DrawFrame').length,
  457 |         paint = events.filter((r: any) => r.name === 'Paint').length,
```