# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-performance.spec.ts >> P1 two30-item panels and real recursion stack remain responsive for three independent30-second stable playbacks
- Location: tests\browser\phase2-performance.spec.ts:486:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "跳到主要内容" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - complementary [ref=e5]:
    - button "收起侧栏" [expanded] [ref=e6] [cursor=pointer]
    - link "编程可视化教学平台 · 学习首页" [ref=e10] [cursor=pointer]:
      - /url: "#/"
      - generic [ref=e11]: "{ }"
      - generic [ref=e12]:
        - text: 一步一懂
        - generic [ref=e13]: 编程可视化教学平台
    - paragraph [ref=e14]: 从代码，到理解。
    - navigation "主导航" [ref=e15]:
      - link "学习首页" [ref=e16] [cursor=pointer]:
        - /url: "#/"
      - link "C 语言课程" [ref=e20] [cursor=pointer]:
        - /url: "#/courses"
      - link "算法与演示" [ref=e24] [cursor=pointer]:
        - /url: "#/cases"
      - link "编译流程" [ref=e28] [cursor=pointer]:
        - /url: "#/compilation"
      - link "错题与陌生点" [ref=e32] [cursor=pointer]:
        - /url: "#/notebook"
      - link "今日复习" [ref=e36] [cursor=pointer]:
        - /url: "#/reviews"
      - link "学习成就" [ref=e40] [cursor=pointer]:
        - /url: "#/achievements"
      - link "本地设置" [ref=e44] [cursor=pointer]:
        - /url: "#/settings"
    - generic [ref=e48]:
      - strong [ref=e51]: 按自己的节奏学习
      - paragraph [ref=e52]: 学习记录将保存在当前浏览器，不跨设备同步。
      - link "了解本地数据" [ref=e53] [cursor=pointer]:
        - /url: "#/settings?panel=data"
  - generic [ref=e56]:
    - banner [ref=e57]:
      - generic [ref=e58]: C 语言 · 从零开始
      - generic [ref=e59]:
        - button "进入专注模式" [ref=e60] [cursor=pointer]:
          - generic [ref=e63]: 专注
        - generic [ref=e64]: 本地学习
        - link "本地数据" [ref=e65] [cursor=pointer]:
          - /url: "#/settings?panel=data"
        - button "切换为深色" [ref=e69] [cursor=pointer]
    - main [ref=e72]:
      - navigation "切换对比案例组" [ref=e73]:
        - link "C · 冒泡与选择" [ref=e74] [cursor=pointer]:
          - /url: "#/compare"
        - link "C++ · 归并与快速" [ref=e75] [cursor=pointer]:
          - /url: "#/compare?pair=cpp-recursive"
      - generic [ref=e76]:
        - navigation "当前位置" [ref=e77]:
          - list [ref=e78]:
            - listitem [ref=e79]:
              - link "学习首页" [ref=e80] [cursor=pointer]:
                - /url: "#/"
            - listitem [ref=e81]:
              - link "算法与演示" [ref=e84] [cursor=pointer]:
                - /url: "#/cases"
            - listitem [ref=e85]:
              - generic [ref=e88]: 同数据对比
        - generic [ref=e89]:
          - paragraph [ref=e90]: 两种算法 · 同一份输入
          - heading "同样的数据，怎样走完排序？" [level=1] [ref=e91]
          - paragraph [ref=e92]: 分别运行原 C 冒泡与选择排序，用同一游标查看两条真实轨迹。每拍各走一个原子步骤，不代表相同算法阶段。
        - region "对比设置与当前计数" [ref=e93]:
          - generic [ref=e94]:
            - generic [ref=e95]:
              - heading "当前步骤的真实计数" [level=2] [ref=e96]
              - paragraph [ref=e97]: 输入仅供本页使用；对比不记录学习事实或积分。
            - button "互换左右算法" [ref=e98] [cursor=pointer]
          - paragraph [ref=e99]: 共同输入：[30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1]
          - table "当前步骤的真实计数" [ref=e101]:
            - rowgroup [ref=e102]:
              - row [ref=e103]:
                - columnheader "算法" [ref=e104]
                - columnheader "比较" [ref=e105]
                - columnheader "交换" [ref=e106]
                - columnheader "标量写入" [ref=e107]
                - columnheader "数组写入" [ref=e108]
            - rowgroup [ref=e109]:
              - row [ref=e110]:
                - rowheader "冒泡排序" [ref=e111]
                - cell "0" [ref=e112]
                - cell "0" [ref=e113]
                - cell "0" [ref=e114]
                - cell "0" [ref=e115]
              - row [ref=e116]:
                - rowheader "选择排序" [ref=e117]
                - cell "—" [ref=e118]
                - cell "—" [ref=e119]
                - cell "—" [ref=e120]
                - cell "—" [ref=e121]
          - group [ref=e122]:
            - generic "这些计数包含什么？" [ref=e123] [cursor=pointer]
        - group [ref=e124]:
          - generic "共同输入设置" [ref=e125] [cursor=pointer]
        - region "统一运行与回放" [ref=e126]:
          - generic [ref=e127]:
            - button "运行两种算法" [ref=e128] [cursor=pointer]
            - button "取消运行" [disabled] [ref=e129]
            - status [ref=e130]: 执行已结束，可统一回放
          - generic [ref=e131]:
            - button "回到起点" [disabled] [ref=e132]
            - button "后退一拍" [disabled] [ref=e133]
            - button "播放对比" [ref=e134] [cursor=pointer]
            - button "前进一拍" [ref=e135] [cursor=pointer]
            - button "到末尾" [ref=e136] [cursor=pointer]
            - generic [ref=e137]:
              - text: 回放速度
              - combobox "对比回放速度" [ref=e138]:
                - option "0.25×"
                - option "0.5×"
                - option "1×" [selected]
                - option "1.5×"
                - option "2×"
                - option "4×"
          - generic [ref=e139]:
            - text: 统一游标
            - status "统一游标 0" [ref=e140]: 0 / 5330
            - slider "对比步骤" [ref=e141]: "0"
          - paragraph [ref=e142]: 短轨迹到末尾后保持末态，另一侧继续；后退时按同一游标恢复。两次执行顺序收集，共用本次运行的 1 秒截止，不自动重试。
        - generic [ref=e143]:
          - generic [ref=e144]:
            - generic [ref=e145]:
              - paragraph [ref=e146]: 左侧 · C 原案例
              - heading "冒泡排序" [level=2] [ref=e147]
              - paragraph [ref=e148]: 逐对比较相邻元素，严格大于才交换；本模板没有提前退出。
              - paragraph [ref=e149]: 最好 / 平均 / 最坏 Θ(n²)；辅助空间 O(1)；稳定。
              - paragraph [ref=e150]: 程序正常结束 · 轨迹可回放
              - paragraph [ref=e151]: 输入副本：[30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1]
            - generic [ref=e152]:
              - paragraph [ref=e153]: 初始状态：尚未执行任何步骤
              - generic [ref=e154]:
                - generic [ref=e155]:
                  - text: 比较
                  - strong [ref=e156]: "0"
                - generic [ref=e157]:
                  - text: 变量写入
                  - strong [ref=e158]: "0"
                - generic [ref=e159]:
                  - text: 数组写入
                  - strong [ref=e160]: "0"
                - generic [ref=e161]:
                  - text: 交换
                  - strong [ref=e162]: "0"
              - region "当前变量" [ref=e163]:
                - heading "变量" [level=4] [ref=e164]
                - paragraph [ref=e165]: 当前没有存活变量。
              - region "当前数组" [ref=e166]:
                - heading "数组" [level=4] [ref=e167]
                - paragraph [ref=e168]: 当前没有存活数组。
              - region "当前步骤的读写与比较" [ref=e169]:
                - heading "本步读写与比较" [level=4] [ref=e170]
                - paragraph [ref=e171]: 本步没有读写或比较观测。
              - region "当前步骤输出" [ref=e172]:
                - heading "截至当前步骤的输出" [level=4] [ref=e173]
                - generic [ref=e174]: （无输出）
            - group [ref=e175]:
              - generic "本侧实际执行源码与当前位置" [ref=e176] [cursor=pointer]
          - generic [ref=e177]:
            - generic [ref=e178]:
              - paragraph [ref=e179]: 右侧 · C 原案例
              - heading "选择排序" [level=2] [ref=e180]
              - paragraph [ref=e181]: 扫描剩余区间寻找最小值，位置不同时交换；最多 n−1 次交换。
              - paragraph [ref=e182]: 最好 / 平均 / 最坏 Θ(n²)；辅助空间 O(1)；不稳定。
              - paragraph [ref=e183]: 运行超过限制 · 轨迹可回放
              - paragraph [ref=e184]: 输入副本：[30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1]
            - region [ref=e185]:
              - heading "错误诊断" [level=4] [ref=e186]
              - paragraph [ref=e187]: GCC 风格教学展示 · 错误来自当前检查或执行；未调用 GCC。
              - list [ref=e188]:
                - listitem [ref=e189]:
                  - alert [ref=e190]:
                    - code [ref=e191]: "main.c: error: 本次处理超过时限 [E_DEADLINE]"
                  - paragraph [ref=e192]: 结果接收 · 执行适配 · 当前教学文件 main.c
                  - paragraph [ref=e193]: 此诊断没有对应的源码位置，未标记任何语句。
                  - paragraph [ref=e194]: 从发起到接收结果的处理超过安全时限；这不能单独证明程序存在死循环。
                  - paragraph [ref=e195]:
                    - strong [ref=e196]: 可以这样检查：
                    - text: 检查循环与输入规模，也可以保留原稿重试。
                  - group [ref=e197]:
                    - generic "查看原始诊断依据" [ref=e198] [cursor=pointer]
            - paragraph [ref=e200]: 尚无当前步骤画面。运行后从初始状态开始查看。
            - group [ref=e201]:
              - generic "本侧实际执行源码与当前位置" [ref=e202] [cursor=pointer]
```

# Test source

```ts
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
  436 |   expect(report.failures).toEqual([]);
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
> 506 |       expect(execution.valid).toBe(true);
      |                               ^ Error: expect(received).toBe(expected) // Object.is equality
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
  537 |       await p.screenshot({ path: `${output}/${id}-start.png`, fullPage: true });
  538 |       await p.waitForTimeout(15000);
  539 |       await p.screenshot({ path: `${output}/${id}-middle.png`, fullPage: true });
  540 |       await p.waitForTimeout(15000);
  541 |       await p.screenshot({ path: `${output}/${id}-end.png`, fullPage: true });
  542 |       const audit = await p.evaluate(readPhase2Probe);
  543 |       await p.evaluate(() => {
  544 |         (window as any).phase2Perf.recording = false;
  545 |       });
  546 |       await control
  547 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '暂停' : '暂停对比', exact: true })
  548 |         .click();
  549 |       const trace = await traceEnd(session);
  550 |       await session.detach();
  551 |       writeFileSync(`${output}/${id}-trace.json.gz`, gzipSync(JSON.stringify(trace)), {
  552 |         flag: 'wx',
  553 |       });
  554 |       const stableStart = start + 2000,
  555 |         stableEnd = stableStart + 30000,
  556 |         raf = audit.raf.filter((t: number) => t >= stableStart && t <= stableEnd),
  557 |         gaps = raf.slice(1).map((t: number, i: number) => t - raf[i]),
  558 |         commits = audit.commits.filter((r: any) => r.at >= stableStart && r.at <= stableEnd),
  559 |         work = stats(commits.map((r: any) => r.duration)),
  560 |         rafStats = stats(gaps),
  561 |         ratio = gaps.filter((v: number) => v > 33.3).length / gaps.length;
  562 |       const mark = trace.traceEvents.find((r: any) => r.name === 'phase2-' + id),
  563 |         offset = mark.ts - start * 1000,
  564 |         events = trace.traceEvents.filter(
  565 |           (r: any) => r.ts >= offset + stableStart * 1000 && r.ts <= offset + stableEnd * 1000,
  566 |         ),
  567 |         draw = events.filter((r: any) => r.name === 'DrawFrame').length,
  568 |         paint = events.filter((r: any) => r.name === 'Paint').length,
  569 |         images = events
  570 |           .filter((r: any) => r.name === 'Screenshot' && r.args?.snapshot)
  571 |           .map((r: any) =>
  572 |             createHash('sha256').update(Buffer.from(r.args.snapshot, 'base64')).digest('hex'),
  573 |           );
  574 |       report.cases.push({
  575 |         id,
  576 |         stableDurationMs: 30000,
  577 |         rate: 4,
  578 |         cursorStart: commits[0]?.cursor,
  579 |         cursorEnd: commits.at(-1)?.cursor,
  580 |         applicationPipelineUpperBoundMs: work,
  581 |         rafGapMs: rafStats,
  582 |         over33_3Ratio: ratio,
  583 |         drawEvents: draw,
  584 |         paintEvents: paint,
  585 |         screenshotFrames: images.length,
  586 |         distinctEncodedScreenshots: new Set(images).size,
  587 |         allSequential: commits
  588 |           .slice(1)
  589 |           .every((r: any, i: number) => r.cursor === commits[i].cursor + 1),
  590 |         allForeground: commits.every((r: any) => r.visibility === 'visible' && r.focus),
  591 |         passed:
  592 |           work.n > 100 &&
  593 |           work.p95 !== null &&
  594 |           work.p95 <= 16.67 &&
  595 |           rafStats.p95 !== null &&
  596 |           rafStats.p95 <= 20 &&
  597 |           ratio <= 0.01 &&
  598 |           draw > 0 &&
  599 |           paint > 0 &&
  600 |           new Set(images).size > 2,
  601 |         audit,
  602 |       });
  603 |     }
  604 |   } finally {
  605 |     report.hostEnd = capturePerformanceHost(playbackOutput, 'end');
  606 |     report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
```