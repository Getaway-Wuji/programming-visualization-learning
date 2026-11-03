import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { presentDiagnostic } from '../../web/src/diagnostics/presentation';
import { blockOptions, blockWorkspace, openBlockKeyboardEditor } from './block-ui';
import type { AnalysisResult } from '../../web/src/blocks/analysis-types';
import { openIndependentRepair } from './current-course-helpers';

const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const editor = (page: Page) => page.getByTestId('draft-code-editor');
const action = (page: Page, name: string) =>
  page.getByTestId('practice-execution').getByRole('button', { name, exact: true });
const directory = `.artifacts/14.1/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
test.beforeEach(async ({ page }) => {
  await observeCaseSetExecution(page);
});
async function open(page: Page, id = 'exercise.c.bug-semicolon') {
  await openIndependentRepair(page, id);
  await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('editor-history')).toHaveAttribute('data-save-state', 'ready');
  await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('show');
  const button = action(page, '编辑 C 并同步积木');
  if (await button.isVisible()) await button.click();
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  return code(page).inputValue();
}
const withBody = (base: string, body: string) =>
  `${base.slice(0, base.lastIndexOf('return 0;'))}// 中文😀：保留原稿\n${body}\n}\n`;
async function settled(page: Page, state: string) {
  await expect(editor(page)).toHaveAttribute('data-sync', state);
}
async function learning(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const names = ['progress', 'ledger', 'dailyFacts', 'receipts'];
      const tx = db.transaction(names, 'readonly');
      return await Promise.all(
        names.map(
          (name) =>
            new Promise((resolve) => {
              const r = tx.objectStore(name).getAll();
              r.onsuccess = () => resolve([name, r.result]);
            }),
        ),
      );
    } finally {
      db.close();
    }
  });
}
async function captureAnalysis(page: Page, label: string) {
  const record = await page.evaluate(() => {
    const w = window.__verticalObservation.workers.findLast(
      (w) => w.kind === 'analyze-code' && w.responseOk,
    );
    if (!w) throw new Error('No real analysis');
    return { request: w.requestBytes, result: w.responseBytes, moduleSeen: w.moduleSeen };
  });
  expect(record.moduleSeen).toBe(true);
  const request = JSON.parse(Buffer.from(record.request!).toString('utf8'));
  const result = JSON.parse(Buffer.from(record.result!).toString('utf8')) as AnalysisResult;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${label}.json`, JSON.stringify({ request, result }, null, 2));
  return { request, result };
}

for (const [label, body, errorCode] of [
  ['lex', '@', 'E_LEX_INVALID'],
  ['parse', 'printf("%d\\n", x)\nreturn 0;', 'E_PARSE_INVALID'],
  ['semantic', 'printf("%d\\n", missing); return 0;', 'E_NAME_INVALID'],
] as const) {
  test(`real ${label} diagnostic agrees with Rust and locates without editing`, async ({
    page,
  }) => {
    const base = await open(page);
    const before = await learning(page);
    const draft = withBody(base, body);
    await code(page).fill(draft);
    await settled(page, 'invalid');
    const { request, result } = await captureAnalysis(page, label);
    if (result.kind !== 'analysisResult') throw new Error('Expected analysis');
    expect(result.status).toBe('invalid');
    expect(request.sourceText).toBe(draft);
    const diag = result.diagnostics[0];
    expect(diag.code).toBe(errorCode);
    const shown = presentDiagnostic(diag, { text: draft });
    await expect(editor(page).getByTestId('diagnostic-gcc')).toHaveText(shown.gcc);
    await expect(editor(page).getByTestId('diagnostic-explanation')).toHaveText(shown.explanation);
    await expect(action(page, '运行本组')).toBeDisabled();
    await expect(action(page, '提交练习')).toBeDisabled();
    const revision = await editor(page).getAttribute('data-document-revision');
    await editor(page)
      .getByRole('button', { name: /^定位问题/ })
      .click();
    await expect(code(page)).toBeFocused();
    expect(
      await code(page).evaluate((el) => ({
        start: (el as HTMLTextAreaElement).selectionStart,
        end: (el as HTMLTextAreaElement).selectionEnd,
      })),
    ).toEqual(shown.range!.utf16Range);
    await expect(code(page)).toHaveValue(draft);
    await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
    expect(
      await page.evaluate(
        () => window.__verticalObservation.workers.filter((w) => w.kind === 'execute').length,
      ),
    ).toBe(0);
    expect(await learning(page)).toEqual(before);
    if (label === 'parse') {
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        // Mobile workbench switches the visible pane through the user's control.
        await expect(page.getByTestId('workbench')).toHaveAttribute(
          'data-narrow',
          String(width < 1000),
        );
        if (width < 1000) await page.getByRole('tab', { name: '编辑代码', exact: true }).click();
        await editor(page).getByTestId('diagnostic-panel').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${directory}/parse-${width}.png` });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
      }
    }
    await code(page).fill(withBody(base, 'printf("%d\\n", x); return 0;'));
    await settled(page, 'synced');
    await expect(editor(page).getByTestId('diagnostic-panel')).toHaveCount(0);
    await expect(action(page, '提交练习')).toBeEnabled();
  });
}

test('runtime error locates the frozen executed source and native block, then clears on repair', async ({
  page,
}) => {
  const base = await open(page, 'exercise.c.bug-parenthesis');
  const before = await learning(page);
  const draft = withBody(base, 'printf("%d\\n", x / 0); return 0;');
  await code(page).fill(draft);
  await settled(page, 'synced');
  await action(page, '运行本组').click();
  await expect(
    page.getByTestId('practice-feedback').getByTestId('diagnostic-item'),
  ).toHaveAttribute('data-code', 'E_DIV_ZERO');
  const observed = await observedCaseSetExecute(page);
  const request = JSON.parse(
    Buffer.from(observed.requestBytes!).toString('utf8'),
  ) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(observed.responseBytes!).buffer, request);
  expect(result.terminal.status).toBe('program-error');
  expect(result.trace?.completeness).toBe('prefix');
  const shown = presentDiagnostic(result.terminal.diagnostics[0], {
    ...request.source,
    nodes: result.nodeMap,
  });
  await expect(page.getByTestId('practice-feedback').getByTestId('diagnostic-gcc')).toHaveText(
    shown.gcc,
  );
  const revision = await editor(page).getAttribute('data-document-revision');
  const count = await page.evaluate(() => window.__verticalObservation.workers.length);
  await page
    .getByTestId('practice-feedback')
    .getByRole('button', { name: /^定位问题/ })
    .click();
  const actual = page.getByTestId('executed-source-details').getByRole('textbox');
  await expect(actual).toBeFocused();
  await expect(actual).toHaveValue(request.source.text);
  expect(
    await actual.evaluate((el) => ({
      start: (el as HTMLTextAreaElement).selectionStart,
      end: (el as HTMLTextAreaElement).selectionEnd,
    })),
  ).toEqual(shown.range!.utf16Range);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByTestId('workbench')).toHaveAttribute('data-narrow', 'true');
  await page.getByRole('tab', { name: '编辑代码', exact: true }).click();
  await page
    .getByTestId('practice-feedback')
    .getByRole('button', { name: /^定位积木/ })
    .first()
    .click();
  await expect(blockWorkspace(page).locator('.blocklySelected')).toHaveCount(1);
  await expect(blockWorkspace(page)).toBeVisible();
  await expect(page.getByRole('tab', { name: '积木', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  await expect(
    page.getByRole('textbox', { name: '编辑 C 代码', exact: true, includeHidden: true }),
  ).toHaveValue(draft);
  expect(await page.evaluate(() => window.__verticalObservation.workers.length)).toBe(count);
  expect(await learning(page)).toEqual(before);
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/runtime.json`, JSON.stringify({ request, result }, null, 2));
  await page.screenshot({ path: `${directory}/runtime.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId('workbench')).toHaveAttribute('data-narrow', 'false');
  await code(page).fill(withBody(base, 'printf("%d\\n", x * 2 + 3); return 0;'));
  await settled(page, 'synced');
  await expect(page.getByTestId('practice-feedback').getByTestId('diagnostic-panel')).toHaveCount(
    0,
  );
  await action(page, '运行本组').click();
  await expect(page.getByTestId('practice-feedback')).toContainText('程序正常结束');
  expect(await learning(page)).toEqual(before);
});

test('incomplete native blocks can be located without losing the broken draft', async ({
  page,
}) => {
  await open(page);
  await openBlockKeyboardEditor(page);
  const before = new Set(await blockOptions(page, /./));
  await blockWorkspace(page)
    .getByRole('combobox', { name: '添加积木类型', exact: true })
    .selectOption('print');
  await blockWorkspace(page).getByRole('button', { name: '添加积木', exact: true }).click();
  await expect(action(page, '提交练习')).toBeDisabled();
  const added = (await blockOptions(page, /./)).find((id) => !before.has(id))!;
  const revision = await editor(page).getAttribute('data-document-revision');
  const locate = blockWorkspace(page)
    .getByRole('button', { name: /^定位积木/ })
    .first();
  await expect(locate).toBeVisible();
  await locate.click();
  await expect(
    blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true }),
  ).toHaveValue(added);
  expect(await blockOptions(page, /./)).toContain(added);
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  await expect(action(page, '提交练习')).toBeDisabled();
});

test('invalid draft survives history save, refresh and explicit restoration', async ({ page }) => {
  const base = await open(page);
  const draft = withBody(base, 'printf("%d\\n", x)\nreturn 0;');
  await code(page).fill(draft);
  await settled(page, 'invalid');
  const history = page.getByTestId('editor-history');
  await expect(history).toHaveAttribute('data-save-state', 'ready');
  await history.locator('summary').click();
  await expect(page.getByLabel('所选历史源码', { exact: true })).toHaveText(draft);
  const entry = await history.getByRole('combobox', { name: '历史版本', exact: true }).inputValue();
  await page.reload();
  await expect(history).toHaveAttribute('data-save-state', 'ready');
  await history.locator('summary').click();
  await history.getByRole('combobox', { name: '历史版本', exact: true }).selectOption(entry);
  await history.getByRole('button', { name: '恢复所选版本', exact: true }).click();
  if (await action(page, '编辑 C 并同步积木').isVisible())
    await action(page, '编辑 C 并同步积木').click();
  await settled(page, 'invalid');
  await expect(code(page)).toHaveValue(draft);
  await expect(editor(page).getByTestId('diagnostic-item')).toHaveAttribute(
    'data-code',
    'E_PARSE_INVALID',
  );
  await expect(action(page, '提交练习')).toBeDisabled();
});

test('memory errors use main.cpp and retain the reversible prefix', async ({ page }) => {
  await page.goto('/#/memory?example=bounds');
  await expect(page.getByRole('button', { name: '运行样例', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  const slider = page.getByRole('slider', { name: /执行步/ });
  // The UI's range input seeks the real already-produced trace.
  await slider.fill((await slider.getAttribute('max')) ?? '0');
  const diagnostic = page.getByTestId('memory-diagnostic');
  await expect(diagnostic.getByTestId('diagnostic-item')).toHaveAttribute(
    'data-code',
    'E_POINTER_BOUNDS',
  );
  await expect(diagnostic.getByTestId('diagnostic-gcc')).toContainText('main.cpp:');
  await diagnostic.getByRole('button', { name: /^定位问题/ }).click();
  await expect(page.getByLabel('本次执行的只读源码', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await expect(diagnostic).toHaveCount(0);
});
