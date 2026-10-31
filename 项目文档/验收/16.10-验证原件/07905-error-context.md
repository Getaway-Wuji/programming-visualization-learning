# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: performance-exceptions.spec.ts >> a failed inner Blockly lazy module reaches the page boundary and an explicit reload recovers
- Location: tests\browser\performance-exceptions.spec.ts:395:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('alert')
Expected substring: "页面加载失败"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('alert') with timeout 5000ms
  - waiting for getByRole('alert')

```

```yaml
- link "跳到主要内容":
  - /url: "#main-content"
- complementary:
  - button "收起侧栏" [expanded]
  - link "编程可视化教学平台 · 学习首页":
    - /url: "#/"
    - text: "{ } 一步一懂 编程可视化教学平台"
  - paragraph: 从代码，到理解。
  - navigation "主导航":
    - link "学习首页":
      - /url: "#/"
    - link "C 语言课程":
      - /url: "#/courses"
    - link "算法与演示":
      - /url: "#/cases"
    - link "编译流程":
      - /url: "#/compilation"
    - link "错题与陌生点":
      - /url: "#/notebook"
    - link "今日复习":
      - /url: "#/reviews"
    - link "学习成就":
      - /url: "#/achievements"
    - link "本地设置":
      - /url: "#/settings"
  - strong: 按自己的节奏学习
  - paragraph: 学习记录将保存在当前浏览器，不跨设备同步。
  - link "了解本地数据":
    - /url: "#/settings?panel=data"
- banner:
  - text: C 语言 · 从零开始
  - button "进入专注模式": 专注
  - text: 本地学习
  - link "本地数据":
    - /url: "#/settings?panel=data"
  - button "切换为深色"
- main:
  - navigation "当前位置":
    - list:
      - listitem:
        - link "C 语言课程":
          - /url: "#/courses"
      - listitem:
        - link "变量和输出":
          - /url: "#/lessons/lesson.c.variables-output"
      - listitem: 输出输入变量
  - paragraph: 动手练习 · 程序与输入
  - heading "输出输入变量" [level=1]
  - paragraph: 用 C 代码或积木解答，提交后逐步复盘真实执行。
  - paragraph: 尚无已保存的学习记录
  - heading "题目与答题区" [level=2]
  - paragraph: 保留输入源变量x（-999到999），用输出积木读取x，输出它的十进制整数和一个换行，不要加提示文字。例：x=7输出7并换行，x=0输出0，x=-9输出-9。必须实际声明、读取输入变量，不能打印固定答案。所有测试正常结束且main返回0。思路：先找到输入声明，再把变量读取放进printf的%d参数。
  - paragraph: 教学目标：真实声明并读取x，输出依赖输入，不打印固定答案。
  - group: 练习与保存说明
  - button "独立练习" [pressed]
  - button "改错练习"
  - button "拆积木练习"
  - link "查看课程示例":
    - /url: "#/lessons/lesson.c.variables-output"
  - paragraph: 从零搭建解答。已保留本题输入声明，请在 main 中加入你的程序。各模式草稿独立保留，切换会清除本次结果；已保存的编辑历史可在离题或刷新后选择恢复，未保存内容可能丢失。示例在新标签页打开。
  - strong: 需要一点帮助？
  - button "查看第 1 层提示"
  - button "运行本组"
  - button "准备代码"
  - button "提交练习"
  - button "取消提交" [disabled]
  - link "查看本次复盘":
    - /url: "#/practice/exercise.c.echo/review"
  - paragraph: 运行本组只检查第一组输入，不记录通过或积分；提交练习才检查全部3 组与教学目标。准备代码只生成源码。 修改积木或代码会立即使旧判定和轨迹失效；已保存的历史通过仍保留。
  - text: 积木显示
  - combobox "积木显示":
    - option "自动（按课程推荐）" [selected]
    - option "始终显示"
    - option "隐藏"
  - paragraph: 本节推荐代码作答。隐藏积木后仍可写代码、运行和提交；切换显示不会修改解答。
  - status: 正在使用当前浏览器的积木显示偏好。
  - group: 积木权限：已永久解锁 0 / 20 · 本节临时开放 8 类
  - group: 编辑历史 · 1 条已保存
  - region "编辑代码":
    - text: 编辑代码
    - complementary "代码与积木联动":
      - heading "编辑 C 代码" [level=3]
      - text: 当前草稿
      - status: 代码与积木已同步。
      - textbox "编辑 C 代码": "#include <stdio.h> int main(void) { int x = 7; return 0; }"
      - paragraph:
        - text: 编辑稿使用本题第一组输入：
        - code: "{\"x\":7}"
        - text: 。已保存的编辑历史可在刷新后选择恢复，未保存内容仅在本次页面保留；选择代码或积木可查看对应位置。
  - heading "本次提交与反馈" [level=3]
  - status:
    - heading "本地档案已读取" [level=2]
    - paragraph: 正在显示当前浏览器中已保存的记录与设置。
  - region "小节完成清单":
    - heading "小节完成清单" [level=3]
    - text: 0/2 项已保存
    - list:
      - listitem:
        - text: 阅读并主动确认学习
        - strong: 待确认
      - listitem:
        - text: 输出输入变量
        - strong: 待通过并保存
    - paragraph: 小节尚未完成
    - link "阅读并确认本节学习":
      - /url: "#/lessons/lesson.c.variables-output#lesson-study-confirmation"
  - paragraph: 当前源码对应测试组：positive。此处为将实际执行的完整代码。
  - paragraph:
    - text: 本组输入：
    - code: "{\"x\":7}"
  - region "运行结果":
    - heading "当前步骤画面" [level=3]
    - button "后退" [disabled]
    - button "播放" [disabled]
    - button "前进" [disabled]
    - button "重播" [disabled]
    - text: 速度
    - combobox "播放速度" [disabled]:
      - option "0.25×"
      - option "0.5×"
      - option "1×" [selected]
      - option "1.5×"
      - option "2×"
      - option "4×"
    - text: 步骤 — / 0
    - status: 等待运行轨迹
    - paragraph: 聚焦播放工作区后，空格播放或暂停，左右方向键单步查看。重播从初始状态开始播放。
    - paragraph: 尚无当前步骤画面。运行后从初始状态开始查看。
  - paragraph: 积木只生成受支持的 C 程序。返回本节可查看已保存的历史进度。
  - link "返回本节学习":
    - /url: "#/lessons/lesson.c.variables-output"
```

# Test source

```ts
  309 |           audit.nextExecute = resolve;
  310 |         });
  311 |       const runId = window.executionChecks.start();
  312 |       let handledAt: number | null = null;
  313 |       if (dispatched) {
  314 |         await dispatched;
  315 |         const running = window.executionChecks.inspect();
  316 |         if (running.activeWorkers !== 1 || running.state !== 'running')
  317 |           throw new Error(`Round ${index + 1} was not dispatched before cancellation.`);
  318 |         handledAt = performance.now();
  319 |         window.executionChecks.cancel();
  320 |       }
  321 |       const result = await window.executionChecks.wait(runId);
  322 |       const settledAt = performance.now();
  323 |       if (!cancelled) expectedCommits++;
  324 |       const inspect = window.executionChecks.inspect();
  325 |       const active = audit.workers.filter((worker) => worker.terminatedAt === null).length;
  326 |       const worker = audit.workers.at(-1)!;
  327 |       rounds.push({
  328 |         round: index + 1,
  329 |         cancelled,
  330 |         runId,
  331 |         workerId: worker.id,
  332 |         newWorkers: audit.workers.length - beforeWorkers,
  333 |         producer: result.producer,
  334 |         status: result.status,
  335 |         steps: result.steps,
  336 |         elapsedCancelMs: handledAt === null ? null : settledAt - handledAt,
  337 |         active,
  338 |         activeWorkers: inspect.activeWorkers,
  339 |         cachedModules: inspect.cachedModules,
  340 |         commitCount: inspect.commitCount,
  341 |         expectedCommits,
  342 |       });
  343 |       if ((index + 1) % 5 === 0)
  344 |         samples.push({ after: index + 1, at: performance.now(), heap: heap() });
  345 |       // Yield without retaining a result or Worker so native queued events may
  346 |       // settle. The harness itself keeps bounded summaries until close().
  347 |       await new Promise<void>((resolve) => setTimeout(resolve, 0));
  348 |     }
  349 |     const beforeLate = window.executionChecks.inspect().commitCount;
  350 |     await new Promise<void>((resolve) => setTimeout(resolve, 150));
  351 |     return {
  352 |       rounds,
  353 |       samples,
  354 |       workers: audit.workers,
  355 |       maximumActive: audit.maximumActive,
  356 |       compileCalls: audit.compileCalls,
  357 |       moduleCount: audit.moduleCount,
  358 |       beforeLate,
  359 |       afterLate: window.executionChecks.inspect().commitCount,
  360 |       finalInspect: window.executionChecks.inspect(),
  361 |     };
  362 |   });
  363 |   await evidence(page, info, 'fifty-alternating', {
  364 |     observation,
  365 |     memoryInterpretation:
  366 |       'performance.memory is optional and coarse. No forced GC occurs. The observer retains only metadata, WeakMap Module IDs and no raw buffers/Worker objects. /checks intentionally keeps job summaries and a last result; these samples describe trend and lifecycle bounds, not proof of zero retained trajectories, subscriptions, timers or absence of every host leak.',
  367 |   });
  368 |   expect(observation.rounds).toHaveLength(50);
  369 |   expect(observation.maximumActive).toBe(1);
  370 |   expect(observation.compileCalls).toBe(1);
  371 |   expect(observation.moduleCount).toBe(1);
  372 |   expect(new Set(observation.rounds.map((round) => round.workerId)).size).toBe(50);
  373 |   expect(new Set(observation.rounds.map((round) => round.runId)).size).toBe(50);
  374 |   for (const round of observation.rounds) {
  375 |     expect(round).toMatchObject({
  376 |       newWorkers: 1,
  377 |       active: 0,
  378 |       activeWorkers: 0,
  379 |       cachedModules: 1,
  380 |       commitCount: round.expectedCommits,
  381 |       producer: round.cancelled ? 'adapter' : 'rust',
  382 |       status: round.cancelled ? 'cancelled' : 'completed',
  383 |     });
  384 |     if (round.cancelled) {
  385 |       expect(round.steps).toBeNull();
  386 |       expect(round.elapsedCancelMs).toBeLessThanOrEqual(100);
  387 |     } else expect(round.steps).toBeGreaterThan(0);
  388 |   }
  389 |   expect(observation.beforeLate).toBe(25);
  390 |   expect(observation.afterLate).toBe(25);
  391 |   expect(observation.workers.every((worker) => worker.terminatedAt !== null)).toBe(true);
  392 |   expect(observation.workers.every((worker) => worker.messagesAfterTermination === 0)).toBe(true);
  393 | });
  394 | 
  395 | test('a failed inner Blockly lazy module reaches the page boundary and an explicit reload recovers', async ({
  396 |   page,
  397 | }, info) => {
  398 |   const blockPattern = /\/assets\/BlockWorkspace-[^/]+\.js$/;
  399 |   const failedRequests: string[] = [];
  400 |   await page.route(blockPattern, async (route) => {
  401 |     failedRequests.push(route.request().url());
  402 |     await route.fulfill({ status: 404, contentType: 'text/javascript', body: 'missing' });
  403 |   });
  404 |   await page.goto('/#/practice/exercise.c.echo');
  405 |   await page
  406 |     .getByTestId('block-workspace-preference')
  407 |     .getByRole('combobox', { name: '积木显示', exact: true })
  408 |     .selectOption('show');
> 409 |   await expect(page.getByRole('alert')).toContainText('页面加载失败');
      |                                         ^ Error: expect(locator).toContainText(expected) failed
  410 |   // Browsers may retry a failed module fetch. Every attempt is faulted and
  411 |   // they must all address the same inner lazy module.
  412 |   expect(failedRequests.length).toBeGreaterThanOrEqual(1);
  413 |   expect(new Set(failedRequests).size).toBe(1);
  414 |   await expect(page.getByRole('region', { name: '积木工作区', exact: true })).toHaveCount(0);
  415 |   await page.unroute(blockPattern);
  416 |   await page.getByRole('button', { name: '重新加载', exact: true }).click();
  417 |   await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  418 |   await expect(page.getByRole('region', { name: '积木工作区', exact: true })).toBeVisible();
  419 |   await expect(page.getByRole('alert')).toHaveCount(0);
  420 |   await evidence(page, info, 'inner-blockly-lazy-recovery', {
  421 |     scope:
  422 |       'Production inner BlockWorkspace JavaScript 404; native visible page recovery button reload after removing that fault. No Rust or learning result is synthesized.',
  423 |     failedRequests,
  424 |     recovered: true,
  425 |   });
  426 | });
  427 | 
```