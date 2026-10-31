# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p05-course.spec.ts >> P05 fresh archive: 32 real code answers and 140 groups produce 32 confirmed completions and durable deduplicated rewards
- Location: tests\browser\p05-course.spec.ts:615:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByTestId('practice-execution')
Expected: "passed"
Received: "unmet"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" getByTestId('practice-execution') with timeout 5000ms
  - waiting for getByTestId('practice-execution')
    6 × locator resolved to <section data-state="running" class="card section-card" data-testid="practice-execution">…</section>
      - unexpected value "running"
    8 × locator resolved to <section data-state="unmet" class="card section-card" data-testid="practice-execution">…</section>
      - unexpected value "unmet"

```

```yaml
- heading "题目与答题区" [level=2]
- paragraph: 数组长度0..30，元素-999..999。需要原地改变同一个源数组，保持元素出现次数；输出所有排序后元素、单空格、无尾空格、末尾换行。仅打印另一份已排序常量不能通过销毁前数组检查。 教学目标：按冻结冒泡方案相邻严格大于才交换，逐轮缩尾、不提前退出；真实源数组最终升序且多重集合保持。 所有测试都须正常结束且main返回0。必须让当前真实执行的数据与控制过程满足目标，不能用固定答案、死读取或未执行结构代替。
- paragraph: 教学目标：按冻结冒泡方案相邻严格大于才交换，逐轮缩尾、不提前退出；真实源数组最终升序且多重集合保持。
- group: 练习与保存说明
- button "独立练习" [pressed]
- button "改错练习"
- link "查看课程示例":
  - /url: "#/lessons/lesson.c.bubble-sort"
- paragraph: 从零搭建解答。已保留本题输入声明，请在 main 中加入你的程序。各模式草稿独立保留，切换会清除本次结果；已保存的编辑历史可在离题或刷新后选择恢复，未保存内容可能丢失。示例在新标签页打开。
- strong: 需要一点帮助？
- button "查看第 1 层提示"
- button "运行本组"
- button "准备代码"
- button "提交练习"
- button "取消提交" [disabled]
- link "查看本次复盘":
  - /url: "#/practice/exercise.c.bubble-sort/review"
- paragraph: 运行本组只检查第一组输入，不记录通过或积分；提交练习才检查全部6 组与教学目标。准备代码只生成源码。 修改积木或代码会立即使旧判定和轨迹失效；已保存的历史通过仍保留。
- text: 积木显示
- combobox "积木显示":
  - option "自动（按课程推荐）"
  - option "始终显示"
  - option "隐藏" [selected]
- paragraph: 本节推荐显示积木。隐藏积木后仍可写代码、运行和提交；切换显示不会修改解答。
- status: 正在使用当前浏览器的积木显示偏好。
- group: 积木权限：已永久解锁 20 / 20 · 本节临时开放 0 类
- group: 编辑历史 · 2 条已保存
- region "编辑代码":
  - text: 编辑代码
  - complementary "代码与积木联动"
- heading "本次提交未通过" [level=3]
- status: 本组未正常完成，请查看诊断；本次提交没有通过。
- paragraph:
  - text: 本次尚无已保存的错误记录。
  - link "查看错题与陌生点":
    - /url: "#/notebook"
- paragraph: 已检查 6/6 组；首个未通过即停止。
- list:
  - listitem: empty：本组通过
  - listitem: one：本组通过
  - listitem: ordered：本组通过
  - listitem: reverse：本组通过
  - listitem: mixed：本组通过
  - listitem: maximum：本组未通过
- paragraph: 本次提交超过运行限制。
- region "错误诊断":
  - heading "错误诊断" [level=4]
  - paragraph: GCC 风格教学展示 · 错误来自当前检查或执行；未调用 GCC。
  - list
- list
- paragraph: 输出按原样比较，空格与换行也计入；教学目标需要真实的输入贡献或控制路径，只有输出相同仍可能未通过。
- heading "本组实际输出" [level=4]
- text: （无输出）
- heading "本组预期输出" [level=4]
- text: 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30
- status:
  - heading "已保存" [level=2]
  - paragraph: 这次更改已保存到当前浏览器。
- region "小节完成清单":
  - heading "小节完成清单" [level=3]
  - text: 1/2 项已保存
  - list
  - paragraph: 小节尚未完成
  - link "继续搭建并提交全部测试":
    - /url: "#/practice/exercise.c.bubble-sort#practice-answer"
- paragraph: 当前源码与复盘对应测试组：maximum。只保留本组轨迹；复盘不重新运行。
- paragraph:
  - text: 本组输入：
  - code: "{\"values\":[30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1]}"
- group: 查看本组实际执行的 C 代码
- region "运行结果":
  - heading "当前步骤画面" [level=3]
  - button "后退" [disabled]
  - button "播放" [disabled]
  - button "前进" [disabled]
  - button "重播" [disabled]
  - text: 速度
  - combobox "播放速度" [disabled]
  - text: 步骤 — / 0
  - status: 已到达运行停止位置
  - paragraph: 聚焦播放工作区后，空格播放或暂停，左右方向键单步查看。重播从初始状态开始播放。
  - paragraph: 尚无当前步骤画面。运行后从初始状态开始查看。
```

# Test source

```ts
  277 |         };
  278 |       }),
  279 |     );
  280 |     await record(folder, 'intl-benchmark', benchmark);
  281 |   } catch (error) {
  282 |     await record(folder, 'intl-benchmark-error', { error: String(error) });
  283 |   }
  284 | });
  285 | function bundlePath() {
  286 |   expect(p05CourseRelease.enabled).toBe(true);
  287 |   expect(p05CourseRelease.registered).toBe(true);
  288 |   expect(p05CourseRelease.file).toMatch(/^content\//);
  289 |   return `/${p05CourseRelease.file}`;
  290 | }
  291 | async function openLesson(page: Page, lesson: LessonEntity, confirm = true) {
  292 |   await page.goto(`/#/lessons/${encodeURIComponent(lesson.id)}`);
  293 |   await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  294 |   await ready(page);
  295 |   await expect(
  296 |     page.getByRole('heading', { name: lesson.title, exact: true, level: 1 }),
  297 |   ).toBeVisible();
  298 |   if (confirm) {
  299 |     const start = page.getByRole('button', { name: '开始本节学习', exact: true });
  300 |     if (await start.isEnabled()) {
  301 |       await start.click();
  302 |       await ready(page);
  303 |     }
  304 |     await page.getByRole('button', { name: /^(确认已学习|确认今日复习)$/ }).click();
  305 |     await ready(page);
  306 |     await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute(
  307 |       'data-saved',
  308 |       'yes',
  309 |     );
  310 |   }
  311 | }
  312 | async function openAnswer(page: Page, id: string, assertEmpty = true) {
  313 |   await page.goto(`/#/practice/${encodeURIComponent(id)}`);
  314 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  315 |   await ready(page);
  316 |   const preference = page
  317 |     .getByTestId('block-workspace-preference')
  318 |     .getByRole('combobox', { name: '积木显示', exact: true });
  319 |   await expect(preference).toBeVisible();
  320 |   if ((await preference.inputValue()) !== 'hide') await preference.selectOption('hide');
  321 |   await expect(page.getByTestId('practice-editor-layout')).toHaveAttribute(
  322 |     'data-blocks-visible',
  323 |     'no',
  324 |   );
  325 |   await expect(code(page)).toBeEditable();
  326 |   await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  327 |   if (assertEmpty) {
  328 |     expect(await code(page).inputValue()).not.toContain('printf(');
  329 |     expect(await code(page).inputValue()).not.toBe(answers.get(id));
  330 |   }
  331 | }
  332 | /** Only public input declarations are prepared by real Rust; no algorithm is executed here.
  333 |  * The normal editor/analysis and original trusted catalog independently validate this typed answer. */
  334 | function answerSource(content: ContentPackage, exercise: ExerciseEntity) {
  335 |   const program = content.programs.find((entry) => entry.id === exercise.programRef.id)!;
  336 |   const catalog = {
  337 |     packageRef: { id: content.packageId, version: content.packageVersion },
  338 |     subject: exercise,
  339 |     program: { ...program, sourceExample: answers.get(exercise.id)! },
  340 |     inputSpec: content.inputSpecs.find((entry) => entry.id === program.inputRef.id)!,
  341 |     judgeProfile: content.judgeProfiles.find((entry) => entry.id === exercise.judgeRef.id)!,
  342 |   };
  343 |   const input = exercise.tests[0].input;
  344 |   const sorted = Object.fromEntries(
  345 |     Object.keys(input)
  346 |       .sort()
  347 |       .map((key) => [key, input[key]]),
  348 |   );
  349 |   return (
  350 |     JSON.parse(
  351 |       new TextDecoder().decode(
  352 |         prepare_input(
  353 |           JSON.stringify(catalog),
  354 |           new TextEncoder().encode(JSON.stringify(sorted)),
  355 |           1000,
  356 |         ),
  357 |       ),
  358 |     ) as { source: { text: string } }
  359 |   ).source.text;
  360 | }
  361 | async function fillAnswer(page: Page, content: ContentPackage, exercise: ExerciseEntity) {
  362 |   const text = answerSource(content, exercise);
  363 |   await code(page).fill(text);
  364 |   await expect(code(page)).toHaveValue(text);
  365 |   await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  366 |   await panel(page).getByRole('button', { name: '准备代码', exact: true }).click();
  367 |   await expect(panel(page)).toHaveAttribute('data-state', /^(ready|passed)$/);
  368 |   await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
  369 | }
  370 | async function executeCount(page: Page) {
  371 |   return page.evaluate(
  372 |     () => window.__verticalObservation.workers.filter((entry) => entry.kind === 'execute').length,
  373 |   );
  374 | }
  375 | async function submit(page: Page, saved: 'saved' | 'unsaved' = 'saved') {
  376 |   await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
> 377 |   await expect(panel(page)).toHaveAttribute('data-state', 'passed');
      |                             ^ Error: expect(locator).toHaveAttribute(expected) failed
  378 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
  379 |   if (saved === 'saved') await ready(page);
  380 | }
  381 | async function captureRuns(
  382 |   page: Page,
  383 |   content: ContentPackage,
  384 |   exercise: ExerciseEntity,
  385 |   offset: number,
  386 |   folder: string,
  387 |   label: string,
  388 | ) {
  389 |   const raw = await page.evaluate(
  390 |     (first) =>
  391 |       window.__verticalObservation.workers
  392 |         .filter((entry) => entry.kind === 'execute')
  393 |         .slice(first)
  394 |         .map((entry) => ({
  395 |           ...(
  396 |             entry as typeof entry & {
  397 |               captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
  398 |             }
  399 |           ).captureEncoded(),
  400 |           catalogJson: entry.catalogJson,
  401 |           moduleSeen: entry.moduleSeen,
  402 |           terminated: entry.terminated,
  403 |           responseOk: entry.responseOk,
  404 |           operationId: entry.operationId,
  405 |           responseOperationId: entry.responseOperationId,
  406 |         })),
  407 |     offset,
  408 |   );
  409 |   expect(raw).toHaveLength(exercise.tests.length);
  410 |   const results = [];
  411 |   for (const [index, worker] of raw.entries()) {
  412 |     expect(worker.moduleSeen).toBe(true);
  413 |     expect(worker.terminated).toBe(true);
  414 |     expect(worker.responseOk).toBe(true);
  415 |     expect(worker.responseOperationId).toBe(worker.operationId);
  416 |     expect(worker.requestBase64).toBeTruthy();
  417 |     expect(worker.responseBase64).toBeTruthy();
  418 |     expect(worker.catalogJson).toBeTruthy();
  419 |     const requestBytes = Buffer.from(worker.requestBase64!, 'base64'),
  420 |       responseBytes = Buffer.from(worker.responseBase64!, 'base64');
  421 |     const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
  422 |     const result = await decodeResult(Uint8Array.from(responseBytes).buffer, request);
  423 |     const group = exercise.tests[index];
  424 |     expect(request.packageRef).toEqual({ id: content.packageId, version: content.packageVersion });
  425 |     expect(request.subjectRef).toEqual({ id: exercise.id, version: exercise.version });
  426 |     expect(request.mode).toBe('exercise-test');
  427 |     expect(request.identity.testCaseKey).toBe(group.caseKey);
  428 |     expect(request.input.values).toEqual(group.input);
  429 |     expect(request.remainingMs).toBeGreaterThan(0);
  430 |     expect(request.remainingMs).toBeLessThanOrEqual(1000);
  431 |     expect(result.producer).toBe('rust');
  432 |     expect(result.identity).toEqual(request.identity);
  433 |     expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
  434 |     expect(result.judgeResult?.status).toBe('met');
  435 |     const stdout = result
  436 |       .trace!.steps.flatMap((step) =>
  437 |         step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
  438 |       )
  439 |       .join('');
  440 |     expect(stdout).toBe(group.expectedStdout);
  441 |     const prefix = `${label}-${String(index + 1).padStart(2, '0')}-${group.caseKey}`;
  442 |     await writeFile(join(folder, `${prefix}.request.json`), requestBytes, { flag: 'wx' });
  443 |     await writeFile(join(folder, `${prefix}.result.json`), responseBytes, { flag: 'wx' });
  444 |     await writeFile(join(folder, `${prefix}.catalog.json`), worker.catalogJson!, { flag: 'wx' });
  445 |     results.push({
  446 |       exerciseId: exercise.id,
  447 |       caseKey: group.caseKey,
  448 |       requestSha256: sha(requestBytes),
  449 |       resultSha256: sha(responseBytes),
  450 |       catalogSha256: sha(worker.catalogJson!),
  451 |       steps: result.trace!.steps.length,
  452 |       stdout,
  453 |       protocolVersion: request.protocolVersion,
  454 |       judgeVersion: request.judgeVersion,
  455 |       remainingMs: request.remainingMs,
  456 |     });
  457 |   }
  458 |   return results;
  459 | }
  460 | async function complete(
  461 |   page: Page,
  462 |   content: ContentPackage,
  463 |   lesson: LessonEntity,
  464 |   folder: string,
  465 |   label: string,
  466 | ) {
  467 |   const exercise = content.exercises.find(
  468 |     (entry) => entry.id === lesson.requiredExerciseRefs[0].id,
  469 |   )!;
  470 |   await openLesson(page, lesson);
  471 |   await openAnswer(page, exercise.id);
  472 |   await fillAnswer(page, content, exercise);
  473 |   const offset = await executeCount(page);
  474 |   await submit(page);
  475 |   const runs = await captureRuns(page, content, exercise, offset, folder, label);
  476 |   await expect(page.getByTestId('lesson-completion')).toHaveAttribute('data-state', 'completed');
  477 |   return runs;
```