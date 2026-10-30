import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { StorageSnapshot, ThemeId } from '../../web/src/storage/model';
import {
  blockOptions,
  blockWorkspace,
  correctStarter,
  openCorrectionPractice,
  selectBlock,
} from './block-ui';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';

const ids: readonly ThemeId[] = ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'];
const root = (page: Page) => page.locator('html');
const modeToggle = (page: Page) => page.getByTestId('theme-mode-toggle');

/** Read-only native storage evidence; no fixtures, user facts or application writes are injected. */
async function snapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const transaction = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const entries = await Promise.all(
        names.map(async (name) => {
          const value = await new Promise<unknown>((resolve, reject) => {
            const store = transaction.objectStore(name);
            const request = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
              ? store.get('current')
              : store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return [name, value];
        }),
      );
      await done;
      return Object.fromEntries(entries) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}
function noLearningChange(before: StorageSnapshot, after: StorageSnapshot) {
  for (const name of [
    'progress',
    'dailyFacts',
    'goals',
    'ledger',
    'receipts',
    'aliases',
    'avatar',
  ] as const)
    expect(after[name]).toEqual(before[name]);
  expect(after.meta.generation).toBe(before.meta.generation);
  expect(after.meta.activePackageRef).toEqual(before.meta.activePackageRef);
}
async function ready(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(root(page)).toHaveAttribute('data-appearance-config', 'ready');
}
async function openSettings(page: Page) {
  await page.goto('/#/settings?panel=appearance');
  await ready(page);
  await expect(page.getByTestId('theme-minimal')).toBeEnabled();
}
async function choose(page: Page, id: ThemeId) {
  await page.getByTestId(`theme-${id}`).click();
  await expect(root(page)).toHaveAttribute('data-appearance', id);
  await expect(root(page)).toHaveAttribute('data-appearance-preference', id);
}
async function save(page: Page) {
  await page.getByTestId('save-appearance').click();
  await ready(page);
  await expect(root(page)).toHaveAttribute('data-appearance-draft', 'false');
  await expect(page.getByTestId('appearance-unsaved')).toHaveCount(0);
  await expect(page.getByTestId('save-appearance')).toBeDisabled();
}
async function attach(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, { body: JSON.stringify(value), contentType: 'application/json' });
}

test('six complete themes save and refresh with the header mode while removed appearance controls stay absent', async ({
  page,
}, testInfo) => {
  await openSettings(page);
  const before = await snapshot(page);
  await expect(page.getByTestId('appearance-hex')).toHaveCount(0);
  await expect(page.getByLabel('当前主题色', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '恢复当前主题颜色', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '外观明暗模式', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '试试这个手感', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '体验按钮反馈', exact: true })).toHaveCount(0);
  await expect(modeToggle(page)).toHaveAccessibleName('切换为深色');
  await modeToggle(page).click();
  await ready(page);
  await expect(root(page)).toHaveAttribute('data-appearance-draft', 'false');
  await expect(root(page)).toHaveAttribute('data-theme-preference', 'dark');
  for (const id of ids) {
    await choose(page, id);
    await expect(root(page)).toHaveAttribute('data-theme', 'dark');
    await save(page);
    await page.reload();
    await ready(page);
    await expect(root(page)).toHaveAttribute('data-appearance', id);
    await expect(root(page)).toHaveAttribute('data-theme', 'dark');
    await expect(modeToggle(page)).toHaveAccessibleName('切换为浅色');
  }
  const after = await snapshot(page);
  expect(after.meta).toMatchObject({ dbVersion: 6, schemaVersion: '6.0.0' });
  expect(after.appearance.preset).toBe('tech');
  expect(after.settings.theme).toBe('dark');
  expect(after.appearance.themeOverrides).toEqual(before.appearance.themeOverrides);
  expect(after.settings.reducedMotion).toBe(before.settings.reducedMotion);
  expect(after.settings.playbackRate).toBe(before.settings.playbackRate);
  expect(after.appearanceAssets).toEqual([]);
  noLearningChange(before, after);
  await attach(testInfo, 'six-real-saved-appearance-records', { before, after });
});

test('system mode follows media and the header selects an explicit mode without changing theme colors', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openSettings(page);
  await page.getByRole('tab', { name: '显示设置', exact: true }).click();
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('system');
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await ready(page);
  await expect(root(page)).toHaveAttribute('data-theme-preference', 'system');
  await page.getByRole('tab', { name: '外观与主题', exact: true }).click();
  await choose(page, 'cute');
  await save(page);
  const before = await snapshot(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root(page)).toHaveAttribute('data-theme', 'dark');
  expect(await snapshot(page)).toEqual(before);
  await expect(modeToggle(page)).toHaveAccessibleName('切换为浅色');
  await modeToggle(page).click();
  await ready(page);
  await expect(root(page)).toHaveAttribute('data-theme-preference', 'light');
  await expect(root(page)).toHaveAttribute('data-theme', 'light');
  await expect(root(page)).toHaveAttribute('data-appearance-draft', 'false');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root(page)).toHaveAttribute('data-theme', 'light');
  const after = await snapshot(page);
  expect(after.appearance.themeOverrides).toEqual(before.appearance.themeOverrides);
  expect(after.appearance.layout).toEqual(before.appearance.layout);
  expect(after.appearance.background).toEqual(before.appearance.background);
  expect(after.settings.theme).toBe('light');
  noLearningChange(before, after);
});

test('header mode changes join a theme preview until save and discard or full reset restores the saved appearance', async ({
  page,
}) => {
  await openSettings(page);
  const saved = await snapshot(page);
  await choose(page, 'cute');
  await modeToggle(page).click();
  await expect(root(page)).toHaveAttribute('data-theme', 'dark');
  await expect(root(page)).toHaveAttribute('data-appearance-draft', 'true');
  await expect(page.getByTestId('save-appearance')).toBeEnabled();
  expect(await snapshot(page)).toEqual(saved);
  await page
    .locator('.appearance-preview-note')
    .getByRole('button', { name: '采用已保存外观', exact: true })
    .click();
  await expect(root(page)).toHaveAttribute('data-appearance-draft', 'false');
  await expect(root(page)).toHaveAttribute('data-appearance', 'minimal');
  await expect(root(page)).toHaveAttribute('data-theme', 'light');
  expect(await snapshot(page)).toEqual(saved);
  await choose(page, 'cool');
  await modeToggle(page).click();
  await save(page);
  await expect(root(page)).toHaveAttribute('data-theme', 'dark');
  const committed = await snapshot(page);
  expect(committed.appearance.preset).toBe('cool');
  expect(committed.settings.theme).toBe('dark');
  await choose(page, 'glass');
  await modeToggle(page).click();
  await expect(root(page)).toHaveAttribute('data-appearance-draft', 'true');
  expect(await snapshot(page)).toEqual(committed);
  await page.getByRole('button', { name: '恢复全部外观默认', exact: true }).click();
  await page
    .getByRole('dialog', { name: '恢复全部外观默认', exact: true })
    .getByRole('button', { name: '确认恢复全部外观', exact: true })
    .click();
  await ready(page);
  await expect(root(page)).toHaveAttribute('data-appearance', 'minimal');
  await expect(root(page)).toHaveAttribute('data-appearance-draft', 'false');
  await expect(root(page)).toHaveAttribute('data-theme', 'light');
  const restored = await snapshot(page);
  for (const id of ids) expect(restored.appearance.themeOverrides[id].accentColor).toBeNull();
  expect(restored.appearanceAssets).toEqual([]);
  noLearningChange(saved, restored);
});

test('a competing tab forces explicit CAS rebase without overwriting its saved mode or hidden colors', async ({
  page,
  context,
}, testInfo) => {
  await openSettings(page);
  const other = await context.newPage();
  await openSettings(other);
  const before = await snapshot(page);
  await choose(page, 'glass');
  await modeToggle(page).click();
  await choose(other, 'cute');
  await save(page);
  const newer = await snapshot(page);
  await other.getByTestId('save-appearance').click();
  await expect(other.locator('.app-shell')).toHaveAttribute(
    'data-learning-storage-status',
    'conflict',
  );
  await expect(other.getByTestId('appearance-unsaved')).toBeVisible();
  await expect(root(other)).toHaveAttribute('data-appearance', 'cute');
  expect(await snapshot(other)).toEqual(newer);
  await other.getByRole('button', { name: '重新读取并保留这次选择', exact: true }).click();
  await ready(other);
  await expect(other.getByTestId('appearance-unsaved')).toBeVisible();
  await save(other);
  const after = await snapshot(other);
  expect(after.appearance.preset).toBe('cute');
  expect(after.appearance.themeOverrides).toEqual(before.appearance.themeOverrides);
  expect(after.settings.theme).toBe('dark');
  noLearningChange(before, after);
  await attach(testInfo, 'real-two-tab-cas-explicit-rebase', { before, newer, after });
  await other.close();
});

test('an actual Blockly draft survives settings theme changes and browser back without executing or granting learning', async ({
  page,
}, testInfo) => {
  await observeCaseSetExecution(page);
  await page.goto('/#/practice/exercise.c.echo');
  await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  await ready(page);
  const workspace = blockWorkspace(page);
  await openCorrectionPractice(page);
  // Wait for the lazily mounted editor before reading the disclosure state.
  // A missing combobox during mount does not mean an open disclosure is closed.
  await expect(workspace.locator('details')).toBeVisible();
  if ((await workspace.locator('details').getAttribute('open')) === null)
    await workspace.locator('summary').click();
  const outputs = await blockOptions(page, /^\d+\. 输出 ·/);
  expect(outputs).toHaveLength(1);
  await selectBlock(page, outputs[0]);
  const draft = '%d 外观切换草稿\\n';
  await workspace.getByRole('textbox', { name: '输出格式', exact: true }).fill(draft);
  await page.getByRole('button', { name: '准备代码', exact: true }).click();
  const source = await page.getByTestId('code-panel').locator('textarea').inputValue();
  expect(source).toContain('外观切换草稿');
  const before = await snapshot(page);
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '本地设置', exact: true })
    .click();
  await expect(page.getByTestId('appearance-settings')).toBeVisible();
  await choose(page, 'cute');
  await save(page);
  await page.goBack();
  await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  const restored = blockWorkspace(page);
  await expect(restored.locator('details')).toBeVisible();
  if ((await restored.locator('details').getAttribute('open')) === null)
    await restored.locator('summary').click();
  await selectBlock(page, outputs[0]);
  await expect(restored.getByRole('textbox', { name: '输出格式', exact: true })).toHaveValue(draft);
  await expect(page.getByTestId('code-panel').locator('textarea')).toHaveValue(source);
  const executions = await page.evaluate(
    () => window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
  );
  expect(executions).toBe(0);
  const after = await snapshot(page);
  noLearningChange(before, after);
  await attach(testInfo, 'real-blockly-draft-theme-roundtrip', {
    draft,
    source,
    executions,
    before,
    after,
  });
});

test('a real accepted Rust submission and player cursor survive appearance changes without another execution or reward', async ({
  page,
}, testInfo) => {
  await observeCaseSetExecution(page);
  await page.goto('/#/practice/exercise.c.echo');
  const practice = page.getByTestId('practice-execution');
  await expect(practice).toHaveAttribute('data-state', 'ready');
  await ready(page);
  await correctStarter(page, 'exercise.c.echo');
  await practice.getByRole('button', { name: '准备代码', exact: true }).click();
  await practice.getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(practice).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await ready(page);
  const controls = page.getByTestId('player-controls');
  await controls.getByRole('button', { name: '前进', exact: true }).click();
  const cursor = await controls.getAttribute('data-cursor');
  expect(Number(cursor)).toBeGreaterThan(0);
  const source = await page
    .getByRole('textbox', { name: '当前执行的 C 代码', exact: true })
    .inputValue();
  const accepted = await observedCaseSetExecute(page);
  const request = JSON.parse(
    Buffer.from(accepted.requestBytes!).toString('utf8'),
  ) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(accepted.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0 });
  expect(result.judgeResult?.status).toBe('met');
  const executions = await page.evaluate(
    () => window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
  );
  expect(executions).toBe(3);
  const before = await snapshot(page);
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '本地设置', exact: true })
    .click();
  await expect(page.getByTestId('appearance-settings')).toBeVisible();
  await choose(page, 'glass');
  await modeToggle(page).click();
  await save(page);
  await page.goBack();
  await expect(practice).toHaveAttribute('data-state', 'passed');
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  await expect(page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true })).toHaveValue(
    source,
  );
  expect(
    await page.evaluate(
      () =>
        window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
    ),
  ).toBe(executions);
  const after = await snapshot(page);
  noLearningChange(before, after);
  await attach(testInfo, 'same-real-rust-identity-after-appearance-save', {
    request,
    result,
    cursor,
    executions,
    before,
    after,
  });
});
