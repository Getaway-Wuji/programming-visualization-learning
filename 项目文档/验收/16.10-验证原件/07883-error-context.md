# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: execution.spec.ts >> visible module failure is distinct from program completion and retry uses real Rust
- Location: tests\browser\execution.spec.ts:522:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('case-execution').getByRole('alert')
Expected: visible
Error: strict mode violation: getByTestId('case-execution').getByRole('alert') resolved to 2 elements:
    1) <p role="alert" data-testid="execution-terminal">执行未能完成</p> aka getByTestId('execution-terminal')
    2) <p role="alert" class="diagnostic-heading">…</p> aka getByTestId('diagnostic-item').getByRole('alert')

Call log:
  - Expect "toBeVisible" getByTestId('case-execution').getByRole('alert') with timeout 5000ms
  - waiting for getByTestId('case-execution').getByRole('alert')

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
      - generic [ref=e73]:
        - navigation "当前位置" [ref=e74]:
          - list [ref=e75]:
            - listitem [ref=e76]:
              - link "算法与演示" [ref=e77] [cursor=pointer]:
                - /url: "#/cases"
            - listitem [ref=e78]:
              - generic [ref=e81]: 变量赋值
        - generic [ref=e82]:
          - paragraph [ref=e83]: 语法演示 · 可视化工作区
          - heading "变量赋值" [level=1] [ref=e84]
          - paragraph [ref=e85]: 观察变量的值怎样改变。
        - generic [ref=e87]:
          - paragraph [ref=e89]: 尚无已保存的学习记录
          - generic [ref=e90]:
            - paragraph [ref=e91]: 已审核案例 · 独立观看
            - paragraph [ref=e92]: 内容版本 1.0.0 · 讲解与运行使用同一份已审核案例。 完整观看真实运行后，还需主动确认才记录观看奖励。
            - heading "案例讲解" [level=2] [ref=e93]
            - generic [ref=e94]:
              - heading "学习目标" [level=3] [ref=e95]
              - list [ref=e96]:
                - listitem [ref=e97]: 观察初始化、赋值和输出
              - heading "讲解与示例" [level=3] [ref=e98]
              - paragraph [ref=e99]: 从输入声明读取x，再执行x=x+2，把新值写回同一个变量，最后输出。默认x=3输出5和换行，x=-2输出0。逐步观察初始化、读取、写回和输出；后退时应一起恢复变量与输出。它演示赋值，不替代原样输出练习。
              - generic [ref=e100]:
                - heading "变量赋值演示参考 · 参考源码" [level=4] [ref=e101]
                - paragraph [ref=e102]: 这里是讲解用的参考源码；本次是否运行及实际代码，以执行区域为准。
                - generic "变量赋值演示参考参考源码" [ref=e103]: "#include <stdio.h> int main(void) { int x = 3; x = x + 2; printf(\"%d\\n\", x); return 0; }"
              - heading "常见错误" [level=3] [ref=e104]
              - list [ref=e105]:
                - listitem [ref=e106]: 把倒放动画当状态恢复
              - heading "范围与边界" [level=3] [ref=e107]
              - list [ref=e108]:
                - listitem [ref=e109]: 正零负输入
                - listitem [ref=e110]: 输出恢复
              - paragraph [ref=e111]: 样例来源：content/c/p0/README.md · case.c.assignment；项目原创；沿用08.4已验证程序
          - generic [ref=e112]:
            - heading "执行模块连接" [level=2] [ref=e113]
            - status [ref=e114]: 检查浏览器能否加载执行模块。构建检查不执行 C；案例页可运行内容样例。
            - button "检查执行模块" [ref=e116] [cursor=pointer]
        - generic [ref=e117]:
          - heading "运行内容样例" [level=2] [ref=e118]
          - paragraph [ref=e119]: 逐步看完真实运行后，主动确认可获得案例首次观看奖励。浏览、运行和重播本身不会发放奖励。
          - paragraph [ref=e120]: 程序由此浏览器中的 Rust 解释器执行。代码、输入和轨迹不会上传到执行服务器；网页和课程资源加载需要网络。
          - status [ref=e122]:
            - generic [ref=e126]:
              - heading "本地档案已读取" [level=2] [ref=e127]
              - paragraph [ref=e128]: 正在显示当前浏览器中已保存的记录与设置。
          - region "案例输入设置" [ref=e129]:
            - heading "案例输入" [level=2] [ref=e130]
            - paragraph [ref=e131]: 修改输入会立即清除旧源码与运行结果。应用输入后，查看 Rust 生成的完整源码再运行。
            - generic [ref=e133]:
              - generic [ref=e134]: 整数 x
              - textbox "整数 x" [ref=e135]: "3"
              - paragraph [ref=e136]: 请输入 -999～999 的十进制整数。
            - generic [ref=e138]:
              - generic [ref=e139]: 随机种子
              - textbox "随机种子" [ref=e140]: 466a238c-cb72-46ec-84cb-ffd19053f577
              - paragraph [ref=e141]: 1～128 个 Unicode 字符（组合表情可能计为多个字符），原样区分大小写和空格。同一版本、输入约束、种子与长度可复现同一组数据；只保留在本页内存。
            - generic [ref=e142]:
              - button "生成随机数据" [ref=e143] [cursor=pointer]
              - button "按种子复现" [ref=e144] [cursor=pointer]
              - button "恢复示例输入" [ref=e145] [cursor=pointer]
              - button "应用输入并准备" [ref=e146] [cursor=pointer]
          - generic [ref=e147]:
            - paragraph [ref=e148]:
              - text: 本次输入：
              - code [ref=e149]: "{\"x\":3}"
            - paragraph [ref=e150]: 手动或示例输入
          - generic [ref=e151]:
            - button "运行示例" [ref=e152] [cursor=pointer]
            - button "取消运行" [disabled] [ref=e153]
          - generic "执行播放工作区" [ref=e154]:
            - generic [ref=e155]:
              - generic [ref=e156]:
                - generic [ref=e157]: 拖动中间分隔条调整宽度
                - button "恢复默认比例" [disabled] [ref=e158] [cursor=pointer]
              - generic [ref=e159]:
                - region "代码" [ref=e160]:
                  - generic [ref=e161]:
                    - generic [ref=e162]: 代码
                    - button "展开代码" [ref=e163] [cursor=pointer]:
                      - generic [ref=e166]: 展开
                  - region "执行代码区域" [ref=e168]:
                    - generic [ref=e169]:
                      - heading "本次执行的 C 代码" [level=3] [ref=e170]
                      - generic [ref=e171]: 只读
                    - paragraph [ref=e172]: 尚无当前执行步骤，源码已就绪。
                    - paragraph [ref=e173]: 末尾终止位置（失败动作未提交为步骤）：执行模块加载事件，没有对应源码步骤。
                    - generic [ref=e174]:
                      - generic [aria-hidden]:
                        - code: "#include <stdio.h> int main(void) { int x = 3; x = x + 2; printf(\"%d\\n\", x); return 0; }"
                      - textbox "当前执行的 C 代码" [ref=e175]: "#include <stdio.h> int main(void) { int x = 3; x = x + 2; printf(\"%d\\n\", x); return 0; }"
                - separator "调整面板宽度" [ref=e176]
                - region "运行画面" [ref=e178]:
                  - generic [ref=e179]:
                    - generic [ref=e180]: 运行画面
                    - button "展开运行画面" [ref=e181] [cursor=pointer]:
                      - generic [ref=e184]: 展开
                  - region "运行结果" [ref=e186]:
                    - heading "当前步骤画面" [level=3] [ref=e188]
                    - generic "播放控制" [ref=e189]:
                      - generic [ref=e190]:
                        - button "后退" [disabled] [ref=e191]
                        - button "播放" [disabled] [ref=e192]
                        - button "前进" [disabled] [ref=e193]
                        - button "重播" [disabled] [ref=e194]
                      - generic [ref=e195]:
                        - text: 速度
                        - combobox "播放速度" [disabled] [ref=e196]:
                          - option "0.25×"
                          - option "0.5×"
                          - option "1×" [selected]
                          - option "1.5×"
                          - option "2×"
                          - option "4×"
                      - generic [ref=e197]:
                        - generic [ref=e198]: 步骤 — / 0
                        - status [ref=e199]: 已到达运行停止位置
                      - paragraph [ref=e200]: 聚焦播放工作区后，空格播放或暂停，左右方向键单步查看。重播从初始状态开始播放。
                    - paragraph [ref=e202]: 尚无当前步骤画面。运行后从初始状态开始查看。
                    - region "当前快照导出" [ref=e203]:
                      - generic [ref=e204]:
                        - heading "保存当前快照" [level=4] [ref=e205]
                        - generic [ref=e206]: 仅下载到你的设备
                      - paragraph [ref=e207]: 文件包含当前源码、输入和完整运行状态，请自行管理。PNG也附带同一状态数据，分享前请确认。
                      - generic [ref=e208]:
                        - button "下载状态文件（JSON）" [disabled] [ref=e209]
                        - button "下载快照图片（PNG）" [disabled] [ref=e210]
                      - paragraph [ref=e211]: 运行结束并选择步骤后可导出。
                      - group [ref=e212]:
                        - generic "文件包含范围" [ref=e213] [cursor=pointer]
                    - region "步骤讲解与挑战" [ref=e214]:
                      - generic [ref=e215]:
                        - heading "步骤学习" [level=4] [ref=e216]
                        - group "学习模式" [ref=e217]:
                          - button "教学讲解" [pressed] [ref=e218] [cursor=pointer]
                          - button "预测挑战" [ref=e219] [cursor=pointer]
                      - generic [ref=e220]:
                        - paragraph [ref=e221]:
                          - strong [ref=e222]: 等待真实运行
                        - paragraph [ref=e223]: 运行后可逐步查看说明，并在预测挑战中选择下一步。
                    - generic [ref=e224]:
                      - heading "本次完整运行结果" [level=4] [ref=e225]
                      - alert [ref=e226]: 执行未能完成
                      - paragraph [ref=e227]: 有效轨迹：0 步
                      - region [ref=e228]:
                        - heading "错误诊断" [level=4] [ref=e229]
                        - paragraph [ref=e230]: GCC 风格教学展示 · 错误来自当前检查或执行；未调用 GCC。
                        - list [ref=e231]:
                          - listitem [ref=e232]:
                            - alert [ref=e233]:
                              - code [ref=e234]: "main.c: error: 执行模块加载失败 [E_MODULE_LOAD]"
                            - paragraph [ref=e235]: 模块加载 · 执行适配 · 当前教学文件 main.c
                            - paragraph [ref=e236]: 此诊断没有对应的源码位置，未标记任何语句。
                            - paragraph [ref=e237]: 运行环境尚未就绪，不能据此判断源码有语法错误。
                            - paragraph [ref=e238]:
                              - strong [ref=e239]: 可以这样检查：
                              - text: 保留草稿，检查页面资源是否可用后重试。
                      - generic "程序完整输出" [ref=e240]: （无输出）
                      - paragraph [ref=e241]: 此处是完整运行结果；上方画面对应当前播放步骤。
          - region [ref=e242]:
            - heading "确认本次观看" [level=3] [ref=e243]
            - paragraph [ref=e244]: 已逐步查看 0 / 0 步。请从初始状态逐步前进或播放至结束。
            - paragraph [ref=e245]: 请让当前变量或数组画面保持可见。首次确认获得 5 分。暂停和后退保留本次覆盖；更换输入、重新运行或刷新需重新观看。练习复盘不计案例奖励。
            - button "确认已观看" [disabled] [ref=e246]
            - status [ref=e247]: 本次运行未满足观看确认条件，不会获得通过奖励。
        - generic [ref=e248]:
          - link "返回案例目录" [ref=e249] [cursor=pointer]:
            - /url: "#/cases"
          - link "关联小节：变量和输出" [ref=e250] [cursor=pointer]:
            - /url: "#/lessons/lesson.c.variables-output"
```

# Test source

```ts
  432 | test('public developer marker stays in temporary execution and never enters requests, console, browser storage or Cache API', async ({
  433 |   page,
  434 | }, testInfo) => {
  435 |   await observe(page);
  436 |   const requests: {
  437 |     url: string;
  438 |     method: string;
  439 |     body: string | null;
  440 |     headers: Record<string, string>;
  441 |   }[] = [];
  442 |   const logs: string[] = [];
  443 |   page.on('request', (request) =>
  444 |     requests.push({
  445 |       url: request.url(),
  446 |       method: request.method(),
  447 |       body: request.postData(),
  448 |       headers: request.headers(),
  449 |     }),
  450 |   );
  451 |   page.on('console', (message) => logs.push(message.text()));
  452 |   await checks(page);
  453 |   const prepared = await page.evaluate(() =>
  454 |     window.executionChecks.open('case.c.assignment', 'markup'),
  455 |   );
  456 |   expect(prepared.source).toContain('CVIZ-07.1-PUBLIC-AUDIT');
  457 |   expect(await page.evaluate(() => window.executionChecks.run())).toMatchObject({
  458 |     producer: 'rust',
  459 |     status: 'completed',
  460 |     output: 'CVIZ-07.1-PUBLIC-AUDIT <b>safe text</b>\n5\n',
  461 |   });
  462 |   const stored = await page.evaluate(async () => ({
  463 |     local: Object.entries(localStorage),
  464 |     session: Object.entries(sessionStorage),
  465 |     writes: window.__executionAudit.storageWrites,
  466 |     cookie: document.cookie,
  467 |     caches: await caches.keys(),
  468 |     databases: await indexedDB.databases(),
  469 |   }));
  470 |   expect(
  471 |     requests.every(
  472 |       (request) =>
  473 |         request.method === 'GET' &&
  474 |         request.body === null &&
  475 |         new URL(request.url).origin === new URL(page.url()).origin,
  476 |     ),
  477 |   ).toBe(true);
  478 |   for (const value of [requests, logs, stored, page.url()])
  479 |     expect(JSON.stringify(value)).not.toContain('CVIZ-07.1-PUBLIC-AUDIT');
  480 |   expect(stored.caches).toEqual([]);
  481 |   expect(stored.databases).toEqual([]);
  482 |   await testInfo.attach('runtime-content-boundary', {
  483 |     body: JSON.stringify({
  484 |       requestCount: requests.length,
  485 |       consoleCount: logs.length,
  486 |       storageWrites: stored.writes.length,
  487 |       cacheNames: stored.caches,
  488 |       databases: stored.databases,
  489 |     }),
  490 |     contentType: 'application/json',
  491 |   });
  492 | });
  493 | 
  494 | test('the visible case runs the exact read-only source and exposes real terminal, steps, output and ready playback', async ({
  495 |   page,
  496 | }, testInfo) => {
  497 |   await observe(page);
  498 |   await page.goto('/#/visualize/case.c.assignment');
  499 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  500 |   await expect(panel(page).getByRole('textbox', { name: '当前执行的 C 代码' })).toHaveValue(
  501 |     /int x = 3;/,
  502 |   );
  503 |   await run(page).click();
  504 |   await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  505 |   await expect(page.getByTestId('execution-terminal')).toContainText(/正常|完成/);
  506 |   await expect(page.getByTestId('execution-output')).toHaveText('5\n');
  507 |   await expect(page.getByTestId('execution-steps')).toContainText(/\d+/);
  508 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-player-status', 'ready');
  509 |   await expect(
  510 |     page.getByTestId('player-controls').getByRole('button', { name: '播放', exact: true }),
  511 |   ).toBeEnabled();
  512 |   await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', '0');
  513 |   await expect(page.getByTestId('source-location')).toContainText('初始');
  514 |   await expect(page.getByTestId('case-view-confirmation')).toHaveAttribute(
  515 |     'data-view-state',
  516 |     'incomplete',
  517 |   );
  518 |   await expect(page.getByRole('button', { name: '确认已观看', exact: true })).toBeDisabled();
  519 |   await page.screenshot({ path: testInfo.outputPath('real-case-execution.png'), fullPage: true });
  520 | });
  521 | 
  522 | test('visible module failure is distinct from program completion and retry uses real Rust', async ({
  523 |   page,
  524 | }) => {
  525 |   await page.route(/\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/, (route) =>
  526 |     route.fulfill({ status: 404, contentType: 'application/wasm', body: 'Missing public module' }),
  527 |   );
  528 |   await page.goto('/#/visualize/case.c.assignment');
  529 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  530 |   await run(page).click();
  531 |   await expect(panel(page)).toHaveAttribute('data-state', 'infrastructure-failure');
> 532 |   await expect(panel(page).getByRole('alert')).toBeVisible();
      |                                                ^ Error: expect(locator).toBeVisible() failed
  533 |   await expect(panel(page)).toContainText('E_MODULE_LOAD');
  534 |   await expect(page.getByTestId('execution-steps')).toContainText('有效轨迹：0 步');
  535 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  536 |   await expect(page.getByTestId('execution-output')).toHaveText('（无输出）');
  537 |   await page.unroute(/\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/);
  538 |   await run(page).click();
  539 |   await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  540 |   await expect(page.getByTestId('execution-output')).toHaveText('5\n');
  541 | });
  542 | 
  543 | test('switching visible cases discards a queued real result before the next case runs', async ({
  544 |   page,
  545 | }) => {
  546 |   await observe(page);
  547 |   await page.goto('/#/visualize/case.c.assignment');
  548 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  549 |   await page.evaluate(() => {
  550 |     window.__executionAudit.hold = true;
  551 |   });
  552 |   await run(page).click();
  553 |   await expect.poll(() => page.evaluate(() => window.__executionAudit.held)).toBe(1);
  554 |   await page.evaluate(() => {
  555 |     location.hash = '#/visualize/case.c.selection-sort';
  556 |   });
  557 |   await expect(page.locator('main h1')).toHaveText('选择排序');
  558 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  559 |   await page.evaluate(() => window.__executionAudit.release());
  560 |   await expect(page.getByTestId('execution-output')).toHaveCount(0);
  561 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  562 |   await run(page).click();
  563 |   await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  564 |   await expect(page.getByTestId('execution-output')).toHaveText('1 2 3\n');
  565 | });
  566 | 
  567 | test('clearing local data in a peer tab invalidates an already accepted real trajectory', async ({
  568 |   page,
  569 |   context,
  570 | }) => {
  571 |   await page.goto('/#/visualize/case.c.assignment');
  572 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  573 |   await run(page).click();
  574 |   await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  575 |   await page
  576 |     .getByTestId('player-controls')
  577 |     .getByRole('button', { name: '播放', exact: true })
  578 |     .click();
  579 |   await expect(page.getByTestId('player-controls')).toHaveAttribute(
  580 |     'data-player-status',
  581 |     'playing',
  582 |   );
  583 |   const settings = await context.newPage();
  584 |   await settings.goto('/#/settings?panel=data');
  585 |   await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  586 |   await settings
  587 |     .getByRole('dialog', { name: '确认清除本地数据', exact: true })
  588 |     .getByRole('button', { name: '确认清除', exact: true })
  589 |     .click();
  590 |   await expect(settings.getByTestId('learning-save-status')).toContainText('本地数据已清除');
  591 |   // The existing page boundary remounts on the new local-data generation.
  592 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  593 |   await expect(page.getByTestId('execution-output')).toHaveCount(0);
  594 |   await expect(page.getByTestId('code-panel').locator('textarea')).toHaveValue(/int x = 3;/);
  595 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  596 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-cursor', '');
  597 |   await page.waitForTimeout(650);
  598 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  599 |   await expect(page.getByTestId('execution-output')).toHaveCount(0);
  600 | });
  601 | 
```