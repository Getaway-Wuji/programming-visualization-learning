# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-performance.spec.ts >> P1 current production navigation and maximum-scale real execution use qualified HTTPS network and unchanged deadlines
- Location: tests\browser\phase2-performance.spec.ts:217:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 8

- Array []
+ Array [
+   Object {
+     "error": "TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.",
+     "id": "practice",
+     "index": 1,
+     "navigation": true,
+   },
+ ]
```

# Test source

```ts
  247 |   });
  248 |   try {
  249 |     for (const [id, route, selector] of navigation)
  250 |       for (let i = 1; i <= (pilot ? 1 : 5); i++) {
  251 |         const c = await browser.newContext({
  252 |           viewport: { width: 1440, height: 900 },
  253 |           serviceWorkers: 'block',
  254 |         });
  255 |         try {
  256 |           for (const mode of ['cold', 'warm']) {
  257 |             const p = await c.newPage();
  258 |             await p.bringToFront();
  259 |             await p.addInitScript(
  260 |               ({ selector }) => {
  261 |                 const scope = window as any;
  262 |                 scope.phase2Navigation = { end: null };
  263 |                 const inspect = () => {
  264 |                   if (scope.phase2Navigation.end !== null) return;
  265 |                   const target = document.querySelector(selector),
  266 |                     shell = document.querySelector('.app-shell');
  267 |                   if (
  268 |                     target &&
  269 |                     target.getBoundingClientRect().height > 0 &&
  270 |                     shell?.getAttribute('data-learning-storage-status') === 'ready' &&
  271 |                     shell?.getAttribute('data-learning-reading-status') === 'ready' &&
  272 |                     shell?.getAttribute('data-learning-practice-status') === 'ready'
  273 |                   )
  274 |                     requestAnimationFrame(() =>
  275 |                       requestAnimationFrame(() => {
  276 |                         if (scope.phase2Navigation.end === null)
  277 |                           scope.phase2Navigation.end = performance.now();
  278 |                       }),
  279 |                     );
  280 |                 };
  281 |                 document.addEventListener('DOMContentLoaded', () => {
  282 |                   new MutationObserver(inspect).observe(document.documentElement, {
  283 |                     subtree: true,
  284 |                     childList: true,
  285 |                     attributes: true,
  286 |                   });
  287 |                   inspect();
  288 |                 });
  289 |               },
  290 |               { selector },
  291 |             );
  292 |             await p.goto('/#' + route);
  293 |             await p.waitForFunction(() => (window as any).phase2Navigation.end !== null, null, {
  294 |               timeout: 10000,
  295 |             });
  296 |             const observed = await p.evaluate(() => ({
  297 |               elapsedMs: (window as any).phase2Navigation.end,
  298 |               visibility: document.visibilityState,
  299 |               focus: document.hasFocus(),
  300 |               resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
  301 |             }));
  302 |             report.navigation.push({
  303 |               id,
  304 |               mode,
  305 |               index: i,
  306 |               ...observed,
  307 |               passed:
  308 |                 observed.elapsedMs <= 2000 && observed.visibility === 'visible' && observed.focus,
  309 |             });
  310 |             await p.close();
  311 |           }
  312 |         } catch (e) {
  313 |           report.failures.push({ id, index: i, navigation: true, error: String(e) });
  314 |         } finally {
  315 |           await c.close();
  316 |         }
  317 |       }
  318 |     for (const d of definitions)
  319 |       for (let i = 1; i <= repeat; i++) {
  320 |         const c = await browser.newContext({
  321 |           viewport: { width: 1440, height: 900 },
  322 |           serviceWorkers: 'block',
  323 |         });
  324 |         try {
  325 |           const p = await c.newPage();
  326 |           await p.bringToFront();
  327 |           await p.addInitScript(installPhase2Probe);
  328 |           await prepare(p, d);
  329 |           report.execution.push(await sample(p, d, 'first-context', i));
  330 |           report.execution.push(await sample(p, d, 'warm-module', i));
  331 |         } catch (e) {
  332 |           report.failures.push({ id: d.id, index: i, execution: true, error: String(e) });
  333 |         } finally {
  334 |           await c.close();
  335 |         }
  336 |       }
  337 |   } finally {
  338 |     report.hostEnd = capturePerformanceHost(output, 'end');
  339 |     report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
  340 |     report.summary = {
  341 |       navigation: stats(report.navigation.map((r: any) => r.elapsedMs)),
  342 |       execution: stats(report.execution.map((r: any) => r.elapsedMs)),
  343 |       original500Deviations: report.execution.filter((r: any) => !r.original500Ms).length,
  344 |     };
  345 |     write('measurements', report);
  346 |   }
> 347 |   expect(report.failures).toEqual([]);
      |                           ^ Error: expect(received).toEqual(expected) // deep equality
  348 |   expect(report.qualification.satisfied).toBe(true);
  349 |   expect(report.navigation.every((r: any) => r.passed)).toBe(true);
  350 |   expect(report.execution.every((r: any) => r.valid && r.elapsedMs <= r.acceptedThresholdMs)).toBe(
  351 |     true,
  352 |   );
  353 | });
  354 | 
  355 | async function traceEnd(session: CDPSession) {
  356 |   const complete = new Promise<any>((r) => session.once('Tracing.tracingComplete', r));
  357 |   await session.send('Tracing.end');
  358 |   const event = await complete;
  359 |   let text = '';
  360 |   for (;;) {
  361 |     const chunk = await session.send('IO.read', { handle: event.stream });
  362 |     text += chunk.data;
  363 |     if (chunk.eof) break;
  364 |   }
  365 |   await session.send('IO.close', { handle: event.stream });
  366 |   return JSON.parse(text);
  367 | }
  368 | test('P1 two30-item panels and real recursion stack remain responsive for three independent30-second stable playbacks', async ({
  369 |   page: p,
  370 | }) => {
  371 |   test.skip(pilot, 'Pilot checks setup and timings before the longer formal playback.');
  372 |   const playbackOutput = `${output}/playback-host`;
  373 |   mkdirSync(playbackOutput, { recursive: true });
  374 |   const report: any = {
  375 |     task: '16.10',
  376 |     hostStart: capturePerformanceHost(playbackOutput, 'start'),
  377 |     cases: [],
  378 |     boundary:
  379 |       'Timer callback entry→MutationObserver after cursor DOM commit is a conservative application pipeline upper bound, with unchanged native125ms delay. CDP drawing/submission is separate from physical panel presentation.',
  380 |   };
  381 |   try {
  382 |     for (const id of ['c-pair30', 'cpp-pair30', 'memory-hanoi5']) {
  383 |       const d = definitions.find((x) => x.id === id)!;
  384 |       await p.addInitScript(installPhase2Probe);
  385 |       await p.bringToFront();
  386 |       await prepare(p, d);
  387 |       const execution = await sample(p, d, 'playback-preparation', 1);
  388 |       expect(execution.valid).toBe(true);
  389 |       const rate =
  390 |         id === 'c-pair30'
  391 |           ? '对比回放速度'
  392 |           : id === 'cpp-pair30'
  393 |             ? 'C++对比回放速度'
  394 |             : '内存播放速度';
  395 |       await p.getByRole('combobox', { name: rate, exact: true }).selectOption('4');
  396 |       const root = p.locator(d.root);
  397 |       await root.locator(d.slider).fill('0');
  398 |       const control =
  399 |         id === 'memory-hanoi5' ? p.locator('.memory-stage') : p.locator('.comparison-controls');
  400 |       await control.scrollIntoViewIfNeeded();
  401 |       const session = await p.context().newCDPSession(p);
  402 |       await session.send('Tracing.start', {
  403 |         transferMode: 'ReturnAsStream',
  404 |         categories:
  405 |           'devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.screenshot,cc,viz,benchmark,blink.user_timing,toplevel',
  406 |       });
  407 |       const start = await p.evaluate((id) => {
  408 |         const a = (window as any).phase2Perf;
  409 |         a.recording = true;
  410 |         a.lastCursor = 0;
  411 |         a.startAt = performance.now();
  412 |         performance.mark('phase2-' + id);
  413 |         return a.startAt;
  414 |       }, id);
  415 |       await control
  416 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '播放' : '播放对比', exact: true })
  417 |         .click();
  418 |       await p.waitForTimeout(2200);
  419 |       await p.screenshot({ path: `${output}/${id}-start.png`, fullPage: true });
  420 |       await p.waitForTimeout(15000);
  421 |       await p.screenshot({ path: `${output}/${id}-middle.png`, fullPage: true });
  422 |       await p.waitForTimeout(15000);
  423 |       await p.screenshot({ path: `${output}/${id}-end.png`, fullPage: true });
  424 |       const audit = await p.evaluate(readPhase2Probe);
  425 |       await p.evaluate(() => {
  426 |         (window as any).phase2Perf.recording = false;
  427 |       });
  428 |       await control
  429 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '暂停' : '暂停对比', exact: true })
  430 |         .click();
  431 |       const trace = await traceEnd(session);
  432 |       await session.detach();
  433 |       writeFileSync(`${output}/${id}-trace.json.gz`, gzipSync(JSON.stringify(trace)), {
  434 |         flag: 'wx',
  435 |       });
  436 |       const stableStart = start + 2000,
  437 |         stableEnd = stableStart + 30000,
  438 |         raf = audit.raf.filter((t: number) => t >= stableStart && t <= stableEnd),
  439 |         gaps = raf.slice(1).map((t: number, i: number) => t - raf[i]),
  440 |         commits = audit.commits.filter((r: any) => r.at >= stableStart && r.at <= stableEnd),
  441 |         work = stats(commits.map((r: any) => r.duration)),
  442 |         rafStats = stats(gaps),
  443 |         ratio = gaps.filter((v: number) => v > 33.3).length / gaps.length;
  444 |       const mark = trace.traceEvents.find((r: any) => r.name === 'phase2-' + id),
  445 |         offset = mark.ts - start * 1000,
  446 |         events = trace.traceEvents.filter(
  447 |           (r: any) => r.ts >= offset + stableStart * 1000 && r.ts <= offset + stableEnd * 1000,
```