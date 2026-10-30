# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reconstruction.spec.ts >> 13.5 isolated drafts and native history survive refresh while display preference and old execution stay correct
- Location: tests\browser\reconstruction.spec.ts:246:1

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator:  getByRole('combobox', { name: '积木显示', exact: true })
Expected: "hide"
Received: "auto"
Timeout:  5000ms

Call log:
  - Expect "toHaveValue" getByRole('combobox', { name: '积木显示', exact: true }) with timeout 5000ms
  - waiting for getByRole('combobox', { name: '积木显示', exact: true })
    14 × locator resolved to <select id="_r_e_" aria-label="积木显示" aria-describedby="_r_e_-description _r_e_-status">…</select>
       - unexpected value "auto"

```

```yaml
- combobox "积木显示":
  - option "自动（按课程推荐）" [selected]
  - option "始终显示"
  - option "隐藏"
```

# Test source

```ts
  171 |   });
  172 |   await open(page);
  173 |   await action(page, '提交练习').click();
  174 |   await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  175 |   expect((await archive(page)).progress).toEqual([]);
  176 |   const print = await buildEcho(page);
  177 |   await selectBlock(page, print);
  178 |   await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d');
  179 |   await expect(action(page, '提交练习')).toBeEnabled();
  180 |   await action(page, '提交练习').click();
  181 |   await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  182 |   expect((await archive(page)).ledger).toEqual([]);
  183 |   await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  184 |   await expect(action(page, '提交练习')).toBeEnabled();
  185 |   if (p05CourseRelease.registered)
  186 |     await page.evaluate(() => {
  187 |       (
  188 |         window as unknown as { __reconstructionFault: { armed: boolean } }
  189 |       ).__reconstructionFault.armed = true;
  190 |     });
  191 |   await action(page, '提交练习').click();
  192 |   await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  193 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  194 |     'data-save-state',
  195 |     p05CourseRelease.registered ? 'unsaved' : saved,
  196 |   );
  197 |   if (p05CourseRelease.registered) {
  198 |     expect((await archive(page)).progress).toEqual([]);
  199 |     await page.evaluate(() => {
  200 |       (
  201 |         window as unknown as { __reconstructionFault: { armed: boolean } }
  202 |       ).__reconstructionFault.armed = false;
  203 |     });
  204 |     await page.getByRole('button', { name: '重试未保存操作', exact: true }).click();
  205 |     await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
  206 |       'data-save-status',
  207 |       'ready',
  208 |     );
  209 |   }
  210 |   const first = await archive(page);
  211 |   const awards = first.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass');
  212 |   expect(awards).toHaveLength(p05CourseRelease.registered ? 1 : 0);
  213 |   if (awards.length) expect(awards[0].points).toBe(10);
  214 |   await action(page, '提交练习').click();
  215 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
  216 |   expect((await archive(page)).ledger).toEqual(first.ledger);
  217 |   const worker = await observedCaseSetExecute(page);
  218 |   const request = JSON.parse(Buffer.from(worker.requestBytes!).toString()) as ExecuteRequest;
  219 |   const result = await decodeResult(Uint8Array.from(worker.responseBytes!).buffer, request);
  220 |   expect(result.producer).toBe('rust');
  221 |   expect(result.judgeResult?.status).toBe('met');
  222 |   expect(request.remainingMs).toBeLessThanOrEqual(1000);
  223 |   // The ordinary code mode shares the same genuine exercise entitlement.
  224 |   const text = (await archive(page)).editHistory
  225 |     .filter(
  226 |       (row) =>
  227 |         row.scope.mode === 'reconstruction' &&
  228 |         row.state === 'synced' &&
  229 |         row.codeText.includes('printf'),
  230 |     )
  231 |     .sort((a, b) => b.sequence - a.sequence)[0].codeText;
  232 |   await page.getByRole('button', { name: '独立练习', exact: true }).click();
  233 |   await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
  234 |   const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  235 |   await code.fill(text);
  236 |   await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  237 |   await action(page, '提交练习').click();
  238 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
  239 |   expect((await archive(page)).ledger).toEqual(first.ledger);
  240 |   await info.attach('real-rust-and-rewards', {
  241 |     body: JSON.stringify({ request, result, first, repeat: await archive(page) }),
  242 |     contentType: 'application/json',
  243 |   });
  244 | });
  245 | 
  246 | test('13.5 isolated drafts and native history survive refresh while display preference and old execution stay correct', async ({
  247 |   page,
  248 | }) => {
  249 |   test.setTimeout(60000);
  250 |   await page.goto('/#/practice/exercise.c.echo');
  251 |   await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
  252 |   const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  253 |   await expect(code).toBeEditable();
  254 |   const invalid = (await code.inputValue()) + '\nint';
  255 |   await code.fill(invalid);
  256 |   await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'invalid');
  257 |   await page.getByRole('button', { name: '拆积木练习', exact: true }).click();
  258 |   await buildEcho(page);
  259 |   await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  260 |   const version = (await archive(page)).editHistory
  261 |     .filter(
  262 |       (r) =>
  263 |         r.scope.mode === 'reconstruction' && r.state === 'synced' && r.codeText.includes('printf'),
  264 |     )
  265 |     .sort((a, b) => b.sequence - a.sequence)[0];
  266 |   expect(version.historyVersion).toBe('1.1.0');
  267 |   await action(page, '运行本组').click();
  268 |   await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  269 |   await page.getByRole('button', { name: '独立练习', exact: true }).click();
  270 |   await expect(code).toHaveValue(invalid);
> 271 |   await expect(page.getByRole('combobox', { name: '积木显示', exact: true })).toHaveValue('hide');
      |                                                                           ^ Error: expect(locator).toHaveValue(expected) failed
  272 |   await open(page);
  273 |   await restore(page, version.entryId);
  274 |   await expect(source(page)).toHaveValue(version.codeText);
  275 |   await action(page, '运行本组').click();
  276 |   await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  277 |   await restore(page, version.entryId);
  278 |   await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  279 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-player-status', 'idle');
  280 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  281 |   await expect(
  282 |     page.getByTestId('player-controls').getByRole('button', { name: '播放', exact: true }),
  283 |   ).toBeDisabled();
  284 |   const options = await page
  285 |     .getByRole('combobox', { name: '历史版本', exact: true })
  286 |     .locator('option')
  287 |     .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  288 |   const rows = (await archive(page)).editHistory;
  289 |   expect(options.length).toBeGreaterThan(0);
  290 |   expect(
  291 |     options.every((id) => rows.find((row) => row.entryId === id)?.scope.mode === 'reconstruction'),
  292 |   ).toBe(true);
  293 |   await page.reload();
  294 |   await expect(action(page, '提交练习')).toBeEnabled();
  295 |   await expect(source(page)).not.toHaveValue(/printf/);
  296 |   await restore(page, version.entryId);
  297 |   await expect(source(page)).toHaveValue(version.codeText);
  298 |   await action(page, '提交练习').click();
  299 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
  300 | });
  301 | 
```