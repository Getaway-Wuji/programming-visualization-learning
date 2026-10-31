# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-performance.spec.ts >> P1 two30-item panels and real recursion stack remain responsive for three independent30-second stable playbacks
- Location: tests\browser\phase2-performance.spec.ts:595:1

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
              - generic [ref=e88]: C++递归排序对比
        - generic [ref=e89]:
          - paragraph [ref=e90]: C++ · 同数据 · 真实轨迹
          - heading "归并与快速，同步观察" [level=1] [ref=e91]
          - paragraph [ref=e92]: 同一整数序列，生成两份独立输入。沿统一原子步骤游标观察数组、递归帧和实际计数。
        - region "C++对比共同输入" [ref=e93]:
          - generic [ref=e94]: 共同整数序列
          - textbox "共同整数序列" [ref=e95]: 30 29 28 27 26 25 24 23 22 21 20 19 18 17 16 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1
          - paragraph [ref=e96]: 0～30项，−999～999。空数组写[]。修改输入、交换左右、清除数据或离开页面撤销本组旧运行；观察不计学习进度或积分。
          - generic [ref=e97]:
            - button "应用共同输入" [ref=e98] [cursor=pointer]
            - button "交换左右" [ref=e99] [cursor=pointer]
        - region "C++统一回放控制" [ref=e100]:
          - status [ref=e101]: 执行已结束，可统一回放
          - generic [ref=e102]:
            - button "运行两份C++" [ref=e103] [cursor=pointer]
            - button "回到初态" [ref=e104] [cursor=pointer]
            - button "统一后退" [disabled] [ref=e105]
            - button "播放对比" [ref=e106] [cursor=pointer]
            - button "统一前进" [ref=e107] [cursor=pointer]
            - button "到末尾" [ref=e108] [cursor=pointer]
            - generic [ref=e109]:
              - text: 速度
              - combobox "C++对比回放速度" [ref=e110]:
                - option "0.25×"
                - option "0.5×"
                - option "1×" [selected]
                - option "1.5×"
                - option "2×"
                - option "4×"
          - generic [ref=e111]:
            - text: 统一步骤 0 / 2891
            - slider "C++对比统一步骤" [ref=e112]: "0"
          - paragraph [ref=e113]: 两次执行共用本组1秒截止，顺序占用单执行槽，不自动重试。短侧到末尾保持末态，后退恢复完整状态。相同步号不代表相同算法阶段；计数是实际步骤累计，包含循环、输入和初始化。
        - generic [ref=e114]:
          - generic [ref=e115]:
            - generic [ref=e116]:
              - paragraph [ref=e117]: 左侧 · 独立C++运行
              - heading "归并排序" [level=2] [ref=e118]
              - paragraph [ref=e119]: 递归整理两个闭区间，借助同一个辅助数组合并，再写回原区间。
              - paragraph [ref=e120]: O(n log n)时间；空或单项立即返回。原始计数包含循环、边界判断及初始化，并非只统计元素比较。
              - paragraph [ref=e121]: completed · 轨迹可回放
              - paragraph [ref=e122]: 输入副本：[30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1]
            - generic [ref=e123]:
              - heading "初始状态" [level=3] [ref=e124]
              - paragraph [ref=e125]: 尚未执行源码步骤；前进后查看真实存储与输入。
              - paragraph [ref=e126]: 本侧步骤0/2891 · 初态
            - generic [ref=e127]:
              - generic [ref=e128]:
                - text: 数组写入
                - strong [ref=e129]: "0"
              - generic [ref=e130]:
                - text: 比较
                - strong [ref=e131]: "0"
              - generic [ref=e132]:
                - text: 变量写入
                - strong [ref=e133]: "0"
              - generic [ref=e134]:
                - text: 交换
                - strong [ref=e135]: "0"
            - paragraph [ref=e136]: 计数含输入、初始化、循环条件与同值写。当前引擎未标注交换，不能用它推测交换次数。
            - generic [ref=e137]:
              - heading "同一步的调用栈" [level=3] [ref=e138]
              - paragraph [ref=e139]: 执行帧：无。选择调用者只切换观察，不移动执行步骤。
              - paragraph [ref=e140]: 当前存活分配：0教学字节。下列地址是虚拟地址，非宿主真实地址；数组形参别名共享原对象。
              - list
              - generic "当前观察帧的真实对象" [ref=e141]:
                - table [ref=e142]:
                  - caption [ref=e143]: 当前观察帧的参数与局部对象
                  - rowgroup [ref=e144]:
                    - row [ref=e145]:
                      - columnheader "名称 / 对象" [ref=e146]
                      - columnheader "种类" [ref=e147]
                      - columnheader "虚拟地址" [ref=e148]
                      - columnheader "容量 / 当前值" [ref=e149]
                  - rowgroup
            - paragraph [ref=e150]: 当前没有存活的原数组；前进到声明之后或从末步后退查看。
            - generic [ref=e151]:
              - heading "当前变量 · 观察帧" [level=3] [ref=e152]
              - list
            - generic [ref=e153]:
              - heading "本步实际写入" [level=3] [ref=e154]
              - paragraph [ref=e155]: 本步没有单槽写入变化；声明、整体初始化和作用域变化以原步骤为准。
            - generic [ref=e156]:
              - heading "当前输出" [level=3] [ref=e157]
              - generic [ref=e158]: （无输出）
            - group [ref=e159]:
              - generic "本侧算法、存储与实际源码" [ref=e160] [cursor=pointer]
          - generic [ref=e161]:
            - generic [ref=e162]:
              - paragraph [ref=e163]: 右侧 · 独立C++运行
              - heading "快速排序" [level=2] [ref=e164]
              - paragraph [ref=e165]: 以区间末项为枢轴分区，递归较小的一侧，在当前帧循环处理较大的一侧。
              - paragraph [ref=e166]: 平均O(n log n)、最坏O(n²)时间；已排序、逆序和全相等仍可能退化。较小段递归保证O(log n)调用栈，不画不存在的全递归树。
              - paragraph [ref=e167]: 本侧执行未接收
              - paragraph [ref=e168]: 输入副本：[30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1]
            - alert [ref=e169]: E_DEADLINE
            - group [ref=e170]:
              - generic "本侧算法、存储与实际源码" [ref=e171] [cursor=pointer]
```

# Test source

```ts
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
  570 |     }
  571 |   }
  572 | });
  573 | test('P1 validation CPU diagnostic preserves all validation and original deadlines', async ({
  574 |   page: p,
  575 | }) => {
  576 |   const d = definitions.find((x) => x.id === 'c-pair30')!;
  577 |   await p.addInitScript(installPhase2Probe);
  578 |   await p.bringToFront();
  579 |   await prepare(p, d);
  580 |   const first = await sample(p, d, 'diagnostic-first', 1);
  581 |   const session = await p.context().newCDPSession(p);
  582 |   await session.send('Profiler.enable');
  583 |   await session.send('Profiler.setSamplingInterval', { interval: 1000 });
  584 |   await session.send('Profiler.start');
  585 |   const second = await sample(p, d, 'diagnostic-warm', 1);
  586 |   const { profile } = await session.send('Profiler.stop');
  587 |   await session.detach();
  588 |   write('diagnostic-profile', profile);
  589 |   write('diagnostic-summary', {
  590 |     first,
  591 |     second,
  592 |     boundary: 'CPU diagnostic adds sampling overhead; never a formal performance pass.',
  593 |   });
  594 | });
  595 | test('P1 two30-item panels and real recursion stack remain responsive for three independent30-second stable playbacks', async ({
  596 |   page: p,
  597 | }) => {
  598 |   test.skip(pilot, 'Pilot checks setup and timings before the longer formal playback.');
  599 |   const playbackOutput = `${output}/playback-host`;
  600 |   mkdirSync(playbackOutput, { recursive: true });
  601 |   const report: any = {
  602 |     task: '16.10',
  603 |     hostStart: capturePerformanceHost(playbackOutput, 'start'),
  604 |     cases: [],
  605 |     boundary:
  606 |       'Timer callback entry→MutationObserver after cursor DOM commit is a conservative application pipeline upper bound, with unchanged native125ms delay. CDP drawing/submission is separate from physical panel presentation.',
  607 |   };
  608 |   await p.addInitScript(installPhase2Probe);
  609 |   try {
  610 |     for (const id of ['c-pair30', 'cpp-pair30', 'memory-hanoi5']) {
  611 |       const d = definitions.find((x) => x.id === id)!;
  612 |       await p.bringToFront();
  613 |       await prepare(p, d);
  614 |       const execution = await sample(p, d, 'playback-preparation', 1);
> 615 |       expect(execution.valid).toBe(true);
      |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  616 |       const rate =
  617 |         id === 'c-pair30'
  618 |           ? '对比回放速度'
  619 |           : id === 'cpp-pair30'
  620 |             ? 'C++对比回放速度'
  621 |             : '内存播放速度';
  622 |       await p.getByRole('combobox', { name: rate, exact: true }).selectOption('4');
  623 |       const root = p.locator(d.root);
  624 |       await root.locator(d.slider).fill('0');
  625 |       const control =
  626 |         id === 'memory-hanoi5' ? p.locator('.memory-stage') : p.locator('.comparison-controls');
  627 |       await control.scrollIntoViewIfNeeded();
  628 |       const session = await p.context().newCDPSession(p);
  629 |       await session.send('Tracing.start', {
  630 |         transferMode: 'ReturnAsStream',
  631 |         categories:
  632 |           'devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.screenshot,cc,viz,benchmark,blink.user_timing,toplevel',
  633 |       });
  634 |       const start = await p.evaluate((id) => {
  635 |         const a = (window as any).phase2Perf;
  636 |         a.recording = true;
  637 |         a.lastCursor = 0;
  638 |         a.startAt = performance.now();
  639 |         performance.mark('phase2-' + id);
  640 |         return a.startAt;
  641 |       }, id);
  642 |       await control
  643 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '播放' : '播放对比', exact: true })
  644 |         .click();
  645 |       await p.waitForTimeout(2200);
  646 |       await p.screenshot({ path: `${output}/${id}-start.png`, fullPage: true });
  647 |       await p.waitForTimeout(15000);
  648 |       await p.screenshot({ path: `${output}/${id}-middle.png`, fullPage: true });
  649 |       await p.waitForTimeout(15000);
  650 |       await p.screenshot({ path: `${output}/${id}-end.png`, fullPage: true });
  651 |       const audit = await p.evaluate(readPhase2Probe);
  652 |       await p.evaluate(() => {
  653 |         (window as any).phase2Perf.recording = false;
  654 |       });
  655 |       await control
  656 |         .getByRole('button', { name: id === 'memory-hanoi5' ? '暂停' : '暂停对比', exact: true })
  657 |         .click();
  658 |       const trace = await traceEnd(session);
  659 |       await session.detach();
  660 |       writeFileSync(`${output}/${id}-trace.json.gz`, gzipSync(JSON.stringify(trace)), {
  661 |         flag: 'wx',
  662 |       });
  663 |       const stableStart = start + 2000,
  664 |         stableEnd = stableStart + 30000,
  665 |         raf = audit.raf.filter((t: number) => t >= stableStart && t <= stableEnd),
  666 |         gaps = raf.slice(1).map((t: number, i: number) => t - raf[i]),
  667 |         commits = audit.commits.filter((r: any) => r.at >= stableStart && r.at <= stableEnd),
  668 |         work = stats(commits.map((r: any) => r.duration)),
  669 |         rafStats = stats(gaps),
  670 |         ratio = gaps.filter((v: number) => v > 33.3).length / gaps.length;
  671 |       const mark = trace.traceEvents.find((r: any) => r.name === 'phase2-' + id),
  672 |         offset = mark.ts - start * 1000,
  673 |         events = trace.traceEvents.filter(
  674 |           (r: any) => r.ts >= offset + stableStart * 1000 && r.ts <= offset + stableEnd * 1000,
  675 |         ),
  676 |         draw = events.filter((r: any) => r.name === 'DrawFrame').length,
  677 |         paint = events.filter((r: any) => r.name === 'Paint').length,
  678 |         images = events
  679 |           .filter((r: any) => r.name === 'Screenshot' && r.args?.snapshot)
  680 |           .map((r: any) =>
  681 |             createHash('sha256').update(Buffer.from(r.args.snapshot, 'base64')).digest('hex'),
  682 |           );
  683 |       report.cases.push({
  684 |         id,
  685 |         stableDurationMs: 30000,
  686 |         rate: 4,
  687 |         cursorStart: commits[0]?.cursor,
  688 |         cursorEnd: commits.at(-1)?.cursor,
  689 |         applicationPipelineUpperBoundMs: work,
  690 |         rafGapMs: rafStats,
  691 |         over33_3Ratio: ratio,
  692 |         drawEvents: draw,
  693 |         paintEvents: paint,
  694 |         screenshotFrames: images.length,
  695 |         distinctEncodedScreenshots: new Set(images).size,
  696 |         allSequential: commits
  697 |           .slice(1)
  698 |           .every((r: any, i: number) => r.cursor === commits[i].cursor + 1),
  699 |         allForeground: commits.every((r: any) => r.visibility === 'visible' && r.focus),
  700 |         passed:
  701 |           work.n > 100 &&
  702 |           work.p95 !== null &&
  703 |           work.p95 <= 16.67 &&
  704 |           rafStats.p95 !== null &&
  705 |           rafStats.p95 <= 20 &&
  706 |           ratio <= 0.01 &&
  707 |           draw > 0 &&
  708 |           paint > 0 &&
  709 |           new Set(images).size > 2,
  710 |         audit,
  711 |       });
  712 |     }
  713 |   } finally {
  714 |     report.hostEnd = capturePerformanceHost(playbackOutput, 'end');
  715 |     report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
```