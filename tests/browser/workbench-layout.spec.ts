import { editorValue, expectEditorValue } from './editor-value';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { StorageSnapshot, ThemeId } from '../../web/src/storage/model';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { blockWorkspace, openBlockKeyboardEditor, showPracticeBlocks } from './block-ui';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { openIndependentEchoRepair } from './current-course-helpers';

const themes: readonly ThemeId[] =
  process.env.TASK_REPRESENTATIVE_THEME === 'minimal'
    ? ['minimal']
    : ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'];
const shell = (page: Page) => page.locator('.app-shell');
const workbench = (page: Page, kind: string) =>
  page.locator(`[data-testid="workbench"][data-kind="${kind}"]`);
const separator = (scope: Locator) =>
  scope.getByRole('separator', { name: '调整面板宽度', exact: true });

/** Native storage is read only: this suite never seeds progress, rewards or settings. */
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
      const rows = await Promise.all(
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
      return Object.fromEntries(rows) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}

function noLearningChange(before: StorageSnapshot, after: StorageSnapshot) {
  for (const key of [
    'progress',
    'dailyFacts',
    'goals',
    'ledger',
    'receipts',
    'aliases',
    'avatar',
    'settings',
  ] as const)
    expect(after[key]).toEqual(before[key]);
  expect(after.meta.generation).toBe(before.meta.generation);
  expect(after.meta.activePackageRef).toEqual(before.meta.activePackageRef);
}

async function ready(page: Page) {
  await expect(shell(page)).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-appearance-config', 'ready');
}

async function openPractice(page: Page) {
  await openIndependentEchoRepair(page);
  await ready(page);
  await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  await expect(workbench(page, 'practice')).toBeVisible();
  await showPracticeBlocks(page);
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
}

async function openDisclosure(page: Page) {
  const details = blockWorkspace(page).locator('details');
  await expect(details).toBeVisible();
  await openBlockKeyboardEditor(page);
}

async function saveTheme(page: Page, id: ThemeId) {
  await page.goto('/#/settings?panel=appearance');
  await ready(page);
  await page.getByTestId(`theme-${id}`).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', id);
  if (await page.getByTestId('save-appearance').isEnabled())
    await page.getByTestId('save-appearance').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
  await ready(page);
}

async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ),
  ).toBeLessThanOrEqual(1);
}

async function geometry(scope: Locator) {
  return scope.evaluate((element) => {
    const rect = (node: Element) => {
      const { x, y, width, height, right } = node.getBoundingClientRect();
      return { x, y, width, height, right };
    };
    return {
      viewport: document.documentElement.clientWidth,
      sidebar: rect(document.querySelector('.sidebar')!),
      main: rect(document.querySelector('.main-content')!),
      bench: rect(element),
      first: rect(element.querySelector('[data-testid="workbench-first"]')!),
      second: rect(element.querySelector('[data-testid="workbench-second"]')!),
    };
  });
}

async function savedRatio(page: Page, kind: 'practice' | 'visualize' | 'review', value: number) {
  await expect
    .poll(async () => (await snapshot(page)).appearance.layout.splitRatios[kind])
    .toBe(value);
  await ready(page);
}

async function attach(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value), contentType: 'application/json' });
}

async function executions(page: Page) {
  return page.evaluate(
    () => window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
  );
}

async function presentVariableFrame(page: Page) {
  const core = page.getByTestId('trace-view').getByLabel('当前变量', { exact: true });
  await core.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }),
  );
  await expect
    .poll(() =>
      core.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const visibleHeight = Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0);
        const visibleWidth = Math.min(bounds.right, innerWidth) - Math.max(bounds.left, 0);
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          visibleHeight >= Math.min(bounds.height, 160) * 0.75 &&
          visibleWidth >= Math.min(bounds.width, 240) * 0.75
        );
      }),
    )
    .toBe(true);
  // Let the production observer see two genuine painted frames, including cursor zero.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test('selected themes use the available workbench width and keep the collapsible navigation on the left', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await saveTheme(page, 'minimal');
  const before = await snapshot(page);
  const samples = [];
  for (const theme of themes) {
    await saveTheme(page, theme);
    await openPractice(page);
    for (const width of [1366, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(shell(page)).toHaveAttribute('data-sidebar', 'expanded');
      const scope = workbench(page, 'practice');
      await expect(separator(scope)).toBeVisible();
      const expanded = await geometry(scope);
      expect(expanded.sidebar.x).toBeCloseTo(0, 0);
      expect(expanded.sidebar.width).toBeCloseTo(216, 0);
      expect(expanded.main.right).toBeCloseTo(expanded.viewport, 0);
      expect(expanded.bench.width).toBeGreaterThan(expanded.main.width * 0.8);
      expect(expanded.first.right).toBeLessThanOrEqual(expanded.second.x + 1);
      await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
      await expect(shell(page)).toHaveAttribute('data-sidebar', 'collapsed');
      await ready(page);
      const collapsed = await geometry(scope);
      expect(collapsed.sidebar.x).toBeCloseTo(0, 0);
      expect(collapsed.sidebar.width).toBeCloseTo(60, 0);
      expect(collapsed.bench.width).toBeGreaterThan(expanded.bench.width + 140);
      const links = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link');
      await expect(links).toHaveText([
        '学习首页',
        'C 语言课程',
        '练习',
        '进阶课程',
        '算法与演示',
        'C 代码工作台',
        '编译流程',
        '错题与陌生点',
        '学习笔记',
        '学习成就',
        '本地设置',
      ]);
      for (const name of ['学习首页', 'C 语言课程', '算法与演示', '编译流程', '本地设置'])
        await expect(
          page
            .getByRole('navigation', { name: '主导航', exact: true })
            .getByRole('link', { name, exact: true }),
        ).toBeVisible();
      await noPageOverflow(page);
      samples.push({ theme, width, expanded, collapsed });
      if (width === 1440)
        await scope.screenshot({ path: info.outputPath(`${theme}-workbench.png`) });
      await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
      await expect(shell(page)).toHaveAttribute('data-sidebar', 'expanded');
      await ready(page);
    }
  }
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(shell(page)).toHaveAttribute('data-sidebar', 'collapsed');
  const after = await snapshot(page);
  expect(after.appearance.layout.sidebar).toBe('collapsed');
  noLearningChange(before, after);
  await attach(info, 'six-themes-four-desktop-widths-and-native-storage', {
    samples,
    before,
    after,
  });
});

test('pointer and keyboard resizing clamp safely, persist independent ratios and restore the defaults', async ({
  page,
}, info) => {
  await openPractice(page);
  const scope = workbench(page, 'practice');
  const divider = separator(scope);
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await divider.focus();
  await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  await savedRatio(page, 'practice', 70);
  let sizes = await geometry(scope);
  expect(sizes.first.width).toBeGreaterThanOrEqual(340);
  expect(sizes.second.width).toBeGreaterThanOrEqual(420);
  await noPageOverflow(page);
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '30');
  await savedRatio(page, 'practice', 30);
  sizes = await geometry(scope);
  expect(sizes.first.width).toBeGreaterThanOrEqual(340);
  expect(sizes.second.width).toBeGreaterThanOrEqual(420);
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '30');
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '32');
  await savedRatio(page, 'practice', 32);
  await scope.getByRole('button', { name: '恢复默认比例', exact: true }).click();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await savedRatio(page, 'practice', 50);
  await divider.scrollIntoViewIfNeeded();
  const handle = await divider.boundingBox();
  const bounds = await scope.boundingBox();
  expect(handle).not.toBeNull();
  expect(bounds).not.toBeNull();
  const dragY =
    (Math.max(0, handle!.y) + Math.min(page.viewportSize()!.height, handle!.y + handle!.height)) /
    2;
  await page.mouse.move(handle!.x + handle!.width / 2, dragY);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.6, dragY, { steps: 12 });
  // Live drag only changes geometry. The write is committed when the pointer is released.
  expect((await snapshot(page)).appearance.layout.splitRatios.practice).toBe(50);
  await page.mouse.up();
  const dragged = Number(await divider.getAttribute('aria-valuenow'));
  expect(dragged).toBeGreaterThanOrEqual(57);
  expect(dragged).toBeLessThanOrEqual(63);
  await savedRatio(page, 'practice', dragged);
  await page.reload();
  await ready(page);
  await expect(separator(workbench(page, 'practice'))).toHaveAttribute(
    'aria-valuenow',
    String(dragged),
  );

  await page.goto('/#/visualize/case.c.assignment');
  await ready(page);
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  const visualDivider = separator(workbench(page, 'visualize'));
  await expect(visualDivider).toHaveAttribute('aria-valuenow', '35');
  await visualDivider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(visualDivider).toHaveAttribute('aria-valuenow', '37');
  await savedRatio(page, 'visualize', 37);
  const after = await snapshot(page);
  expect(after.appearance.layout.splitRatios).toEqual({
    practice: dragged,
    visualize: 37,
    review: 35,
  });
  await visualDivider.dblclick();
  await expect(visualDivider).toHaveAttribute('aria-valuenow', '35');
  await savedRatio(page, 'visualize', 35);
  await noPageOverflow(page);
  await attach(info, 'pointer-release-keyboard-clamps-independent-ratios', { dragged, after });
});

test('real Rust submission, Blockly draft and review cursor survive expansion, focus and narrow region switches', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await openPractice(page);
  await openDisclosure(page);
  const practice = page.getByTestId('practice-execution');
  await expect(page.getByTestId('code-panel')).toBeVisible();
  await practice.getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(practice).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await ready(page);
  const accepted = await observedCaseSetExecute(page);
  const request = JSON.parse(
    Buffer.from(accepted.requestBytes!).toString('utf8'),
  ) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(accepted.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0 });
  expect(result.judgeResult?.status).toBe('met');
  const executionCount = await executions(page);
  expect(executionCount).toBe(4);
  const controls = page.getByTestId('player-controls');
  await controls.getByRole('button', { name: '前进', exact: true }).click();
  const cursor = await controls.getAttribute('data-cursor');
  expect(Number(cursor)).toBeGreaterThan(0);
  const source = await editorValue(page.getByTestId('code-panel').locator('textarea'));
  const blocks = await editorValue(
    blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true }),
  );
  const before = await snapshot(page);
  const scope = workbench(page, 'practice');
  await scope.getByRole('button', { name: '展开积木', exact: true }).click();
  await expect(scope).toHaveAttribute('data-expanded', 'first');
  await expect(scope.getByTestId('workbench-second')).toBeHidden();
  await scope.getByRole('button', { name: '还原分栏', exact: true }).click();
  await scope.getByRole('button', { name: '展开生成代码', exact: true }).click();
  await expect(scope).toHaveAttribute('data-expanded', 'second');
  await scope.getByRole('button', { name: '还原分栏', exact: true }).click();
  await page.getByRole('button', { name: '进入专注模式', exact: true }).click();
  await expect(shell(page)).toHaveAttribute('data-workbench-mode', 'focus');
  await ready(page);
  await expect(page.getByRole('button', { name: '退出专注模式', exact: true })).toBeVisible();
  for (const width of [768, 390, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noPageOverflow(page);
    if (width < 1000) {
      const tabs = scope.getByRole('tablist', { name: '工作区域', exact: true });
      await expect(tabs).toBeVisible();
      await tabs.getByRole('tab', { name: '生成代码', exact: true }).click();
      await expect(scope.getByTestId('workbench-first')).toBeHidden();
      await expect(scope.getByTestId('workbench-second')).toBeVisible();
      await tabs.getByRole('tab', { name: '积木', exact: true }).click();
      await expect(scope.getByTestId('workbench-first')).toBeVisible();
    }
    await expect(controls).toHaveAttribute('data-cursor', cursor!);
    await expectEditorValue(page.getByTestId('code-panel').locator('textarea'), source);
  }
  await page.getByRole('button', { name: '退出专注模式', exact: true }).click();
  await expect(shell(page)).toHaveAttribute('data-workbench-mode', 'standard');
  await ready(page);
  await openDisclosure(page);
  await expectEditorValue(
    blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true }),
    blocks,
  );
  await expect(practice).toHaveAttribute('data-state', 'passed');
  await page.getByRole('link', { name: '查看本次复盘', exact: true }).click();
  const review = workbench(page, 'review');
  await expect(review).toBeVisible();
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  await expect(separator(review)).toHaveAttribute('aria-valuenow', '35');
  await separator(review).focus();
  await page.keyboard.press('ArrowRight');
  await savedRatio(page, 'review', 37);
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  await page.setViewportSize({ width: 390, height: 900 });
  const reviewTabs = review.getByRole('tablist', { name: '工作区域', exact: true });
  await reviewTabs.getByRole('tab', { name: '代码', exact: true }).click();
  await reviewTabs.getByRole('tab', { name: '运行画面', exact: true }).click();
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  expect(await executions(page)).toBe(executionCount);
  const last = await observedCaseSetExecute(page);
  const lastRequest = JSON.parse(
    Buffer.from(last.requestBytes!).toString('utf8'),
  ) as ExecuteRequest;
  expect(lastRequest.identity).toEqual(request.identity);
  const after = await snapshot(page);
  noLearningChange(before, after);
  expect(after.appearance.layout.workbenchMode).toBe('standard');
  expect(after.appearance.layout.splitRatios.review).toBe(37);
  await page.screenshot({ path: info.outputPath('real-rust-narrow-review.png'), fullPage: true });
  await attach(info, 'same-rust-identity-draft-source-cursor-and-learning', {
    request,
    result,
    executionCount,
    cursor,
    source,
    before,
    after,
  });
});

test('narrow code and trace regions retain one genuine case run and only count the visible current frame', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/#/visualize/case.c.assignment');
  await ready(page);
  const execution = page.getByTestId('case-execution');
  await expect(execution).toHaveAttribute('data-state', 'ready');
  const scope = workbench(page, 'visualize');
  const tabs = scope.getByRole('tablist', { name: '工作区域', exact: true });
  await expect(tabs).toBeVisible();
  await execution.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(execution).toHaveAttribute('data-state', 'completed');
  const source = await editorValue(scope.getByTestId('code-panel').locator('textarea'));
  const accepted = await observedCaseSetExecute(page);
  const request = JSON.parse(
    Buffer.from(accepted.requestBytes!).toString('utf8'),
  ) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(accepted.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.terminal.status).toBe('completed');
  const before = await snapshot(page);
  const controls = page.getByTestId('player-controls');
  const coverage = page.getByTestId('case-view-coverage');
  await tabs.getByRole('tab', { name: '运行画面', exact: true }).click();
  await presentVariableFrame(page);
  // Initial-state presentation is required but is not a teaching step in coverage.seen.
  await expect(coverage).toHaveAttribute('data-covered', '0');
  for (let index = 0; index < 3; index++) {
    await tabs.getByRole('tab', { name: '代码', exact: true }).click();
    await expect(scope.getByTestId('workbench-second')).toBeHidden();
    await expectEditorValue(scope.getByTestId('code-panel').locator('textarea'), source);
    await expect(controls).toHaveAttribute('data-cursor', '0');
    await tabs.getByRole('tab', { name: '运行画面', exact: true }).click();
    await presentVariableFrame(page);
    await expect(coverage).toHaveAttribute('data-covered', '0');
  }
  await expect(execution.getByRole('button', { name: '确认已观看', exact: true })).toBeDisabled();
  await controls.getByRole('button', { name: '前进', exact: true }).click();
  await presentVariableFrame(page);
  await expect.poll(async () => Number(await coverage.getAttribute('data-covered'))).toBe(1);
  await controls.getByRole('combobox', { name: '播放速度', exact: true }).selectOption('4');
  await controls.getByRole('button', { name: '播放', exact: true }).click();
  await expect(controls).toHaveAttribute('data-player-status', 'playing');
  await tabs.getByRole('tab', { name: '代码', exact: true }).click();
  await expect(controls).toHaveAttribute('data-player-status', 'paused');
  const cursor = await controls.getAttribute('data-cursor');
  const covered = await coverage.getAttribute('data-covered');
  // Two scheduled playback intervals pass while the trace is genuinely hidden.
  await page.waitForTimeout(300);
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  await expect(coverage).toHaveAttribute('data-covered', covered!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(separator(scope)).toBeVisible();
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  expect(await executions(page)).toBe(1);
  noLearningChange(before, await snapshot(page));
  await noPageOverflow(page);
  await attach(info, 'one-real-case-run-visible-frame-coverage', { request, result, cursor });
});

test('saving a sidebar layout never commits a pending theme preview and explicit rebase preserves both choices', async ({
  page,
}, info) => {
  await page.goto('/#/settings?panel=appearance');
  await ready(page);
  const before = await snapshot(page);
  await page.getByTestId('theme-cute').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'true');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(shell(page)).toHaveAttribute('data-sidebar', 'collapsed');
  await ready(page);
  const layoutSaved = await snapshot(page);
  expect(layoutSaved.appearance.preset).toBe(before.appearance.preset);
  expect(layoutSaved.appearance.layout.sidebar).toBe('collapsed');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'cute');
  await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'true');
  await page.getByTestId('save-appearance').click();
  await expect(shell(page)).toHaveAttribute('data-learning-storage-status', 'conflict');
  expect(await snapshot(page)).toEqual(layoutSaved);
  await page.getByRole('button', { name: '重新读取并保留这次选择', exact: true }).click();
  await ready(page);
  await page.getByTestId('save-appearance').click();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
  const after = await snapshot(page);
  expect(after.appearance.preset).toBe('cute');
  expect(after.appearance.layout.sidebar).toBe('collapsed');
  noLearningChange(before, after);
  await attach(info, 'saved-layout-separate-from-theme-preview-with-real-cas', {
    before,
    layoutSaved,
    after,
  });
});

test('a peer save during a held drag rejects the old revision and explicit layout retry preserves the peer choices', async ({
  page,
  context,
}, info) => {
  await openPractice(page);
  const peer = await context.newPage();
  await peer.goto('/#/settings?panel=appearance');
  await ready(peer);
  const before = await snapshot(page);
  const scope = workbench(page, 'practice');
  const divider = separator(scope);
  await divider.scrollIntoViewIfNeeded();
  const handle = (await divider.boundingBox())!;
  const bounds = (await scope.boundingBox())!;
  const dragY =
    (Math.max(0, handle.y) + Math.min(page.viewportSize()!.height, handle.y + handle.height)) / 2;
  await page.mouse.move(handle.x + handle.width / 2, dragY);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.62, dragY, { steps: 10 });
  const intended = Number(await divider.getAttribute('aria-valuenow'));
  expect(intended).toBeGreaterThanOrEqual(59);
  expect(intended).toBeLessThanOrEqual(65);
  expect((await snapshot(page)).meta.revision).toBe(before.meta.revision);

  // Keep the first page's real pointer held. A second mouse cannot click the
  // other tab in Firefox; use its ordinary keyboard-operated controls instead.
  await peer.getByTestId('theme-cool').focus();
  await peer.keyboard.press('Enter');
  await expect(peer.getByTestId('save-appearance')).toBeEnabled();
  await peer.getByTestId('save-appearance').focus();
  await peer.keyboard.press('Enter');
  await ready(peer);
  await peer.getByRole('tab', { name: '显示设置', exact: true }).focus();
  await peer.keyboard.press('Enter');
  await peer.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('2');
  await peer.getByRole('button', { name: '保存显示设置', exact: true }).focus();
  await peer.keyboard.press('Enter');
  await ready(peer);
  const peerSaved = await snapshot(peer);
  expect(peerSaved.appearance.preset).toBe('cool');
  expect(peerSaved.settings.playbackRate).toBe(2);
  expect(peerSaved.appearance.layout.splitRatios.practice).toBe(50);
  await page.bringToFront();
  await page.mouse.up();
  const warning = page.getByTestId('layout-save-status');
  await expect(warning).toHaveAttribute('role', 'alert');
  await expect(warning).toContainText('尚未保存');
  await expect(divider).toHaveAttribute('aria-valuenow', String(intended));
  expect(await snapshot(page)).toEqual(peerSaved);
  await warning.getByRole('button', { name: '重试保存布局', exact: true }).click();
  await savedRatio(page, 'practice', intended);
  await expect(warning).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.appearance.preset).toBe('cool');
  expect(after.settings.playbackRate).toBe(2);
  expect(after.appearance.themeOverrides).toEqual(peerSaved.appearance.themeOverrides);
  expect(after.appearance.layout.splitRatios.visualize).toBe(35);
  noLearningChange(peerSaved, after);
  await attach(info, 'real-held-pointer-cas-rejection-and-explicit-sparse-retry', {
    before,
    intended,
    peerSaved,
    after,
  });
  await peer.close();
});

test('native appearance write faults roll back atomically, retry visibly and cannot revive a cleared-generation layout draft', async ({
  page,
  context,
}, info) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const native = IDBObjectStore.prototype.put;
    let selected: 'quota' | 'abort-after-success' | null = null;
    Object.assign(window, {
      workbenchFault: {
        arm: (kind: 'quota' | 'abort-after-success') => {
          selected = kind;
        },
        restore: () => {
          selected = null;
          IDBObjectStore.prototype.put = native;
        },
      },
    });
    IDBObjectStore.prototype.put = function (value, key) {
      const fault = this.name === 'appearance' ? selected : null;
      if (fault) selected = null;
      if (fault === 'quota')
        throw new DOMException('Isolated workbench appearance write fault', 'QuotaExceededError');
      const request = key === undefined ? native.call(this, value) : native.call(this, value, key);
      if (fault === 'abort-after-success')
        request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    };
  });
  await openPractice(page);
  const divider = separator(workbench(page, 'practice'));
  const warning = page.getByTestId('layout-save-status');
  const evidence = [];
  for (const kind of ['quota', 'abort-after-success'] as const) {
    const before = await snapshot(page);
    await page.evaluate(
      (fault) =>
        (
          window as unknown as {
            workbenchFault: { arm: (kind: 'quota' | 'abort-after-success') => void };
          }
        ).workbenchFault.arm(fault),
      kind,
    );
    await divider.focus();
    await page.keyboard.press('End');
    await expect(warning).toHaveAttribute('role', 'alert');
    await expect(warning).toContainText('尚未保存');
    await expect(divider).toHaveAttribute('aria-valuenow', '70');
    expect(await snapshot(page)).toEqual(before);
    await warning.getByRole('button', { name: '重试保存布局', exact: true }).click();
    await savedRatio(page, 'practice', 70);
    await expect(warning).toHaveCount(0);
    const after = await snapshot(page);
    noLearningChange(before, after);
    evidence.push({ kind, before, after });
    await workbench(page, 'practice')
      .getByRole('button', { name: '恢复默认比例', exact: true })
      .click();
    await savedRatio(page, 'practice', 50);
  }
  const beforeClear = await snapshot(page);
  await page.evaluate(() =>
    (window as unknown as { workbenchFault: { arm: (kind: 'quota') => void } }).workbenchFault.arm(
      'quota',
    ),
  );
  await divider.focus();
  await page.keyboard.press('Home');
  await expect(warning).toBeVisible();
  await expect(divider).toHaveAttribute('aria-valuenow', '30');
  expect(await snapshot(page)).toEqual(beforeClear);
  const peer = await context.newPage();
  await peer.goto('/#/settings?panel=data');
  await ready(peer);
  await peer.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await peer
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot(peer)).meta.generation)
    .not.toBe(beforeClear.meta.generation);
  await page.bringToFront();
  await ready(page);
  await expect(warning).toHaveCount(0);
  const clearedDivider = workbench(page, 'practice').getByRole('separator', {
    name: '调整面板宽度',
    exact: true,
    includeHidden: true,
  });
  await expect(clearedDivider).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '编辑 C 代码', exact: true })).toBeEditable();
  await expect(page.getByRole('button', { name: '重试保存布局', exact: true })).toHaveCount(0);
  const cleared = await snapshot(page);
  expect(cleared.appearance.layout).toEqual({
    sidebar: 'expanded',
    workbenchMode: 'standard',
    splitRatios: { practice: 50, visualize: 35, review: 35 },
  });
  await page.evaluate(() =>
    (window as unknown as { workbenchFault: { restore: () => void } }).workbenchFault.restore(),
  );
  await attach(info, 'native-appearance-fault-rollback-retry-and-generation-invalidation', {
    evidence,
    beforeClear,
    cleared,
    scope:
      'Faults are isolated at native appearance put boundaries, including an actual transaction abort after request success. This verifies atomic rollback and honest UI recovery, not physical disk exhaustion or real browser quota limits. Clear uses the production confirmation UI; no learning or saved layout rows are fabricated.',
  });
  await peer.close();
});

test('a long real bubble trace reveals its current code line after a hidden pane returns and hidden workspace keys cannot restart playback', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await observeCaseSetExecution(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/#/visualize/case.c.bubble-sort');
  await ready(page);
  const execution = page.getByTestId('case-execution');
  await expect(execution).toHaveAttribute('data-state', 'ready');
  await execution.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(execution).toHaveAttribute('data-state', 'completed');
  const accepted = await observedCaseSetExecute(page);
  const request = JSON.parse(
    Buffer.from(accepted.requestBytes!).toString('utf8'),
  ) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(accepted.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.terminal.status).toBe('completed');
  const length = result.trace!.steps.length;
  expect(length).toBeGreaterThan(60);
  const scope = workbench(page, 'visualize');
  const controls = page.getByTestId('player-controls');
  const tabs = scope.getByRole('tablist', { name: '工作区域', exact: true });
  await tabs.getByRole('tab', { name: '运行画面', exact: true }).click();
  const workspace = page.getByTestId('player-workspace');
  await workspace.focus();
  for (let cursor = 0; cursor < length; cursor++) await page.keyboard.press('ArrowRight');
  await expect(controls).toHaveAttribute('data-cursor', String(length));
  await controls.getByRole('button', { name: '后退', exact: true }).click();
  const cursor = String(length - 1);
  await expect(controls).toHaveAttribute('data-cursor', cursor);
  await tabs.getByRole('tab', { name: '代码', exact: true }).click();
  await expect(scope.getByTestId('workbench-second')).toBeHidden();
  await workspace.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  await expect(controls).toHaveAttribute('data-player-status', 'paused');
  await expect(controls).toHaveAttribute('data-cursor', cursor);
  const source = scope.getByTestId('code-panel').locator('textarea');
  await expectEditorValue(source, request.source.text);
  const mark = scope.getByTestId('source-step-highlight').last();
  await expect(mark).toBeAttached();
  await expect
    .poll(() =>
      source.evaluate((element) => {
        const code = element.closest('[data-testid="code-panel"]')!;
        const mark = code.querySelector('[data-testid="source-step-highlight"]')!;
        const bounds = element.getBoundingClientRect();
        const target = mark.getBoundingClientRect();
        return {
          scrolled: element.scrollTop > 0,
          visible: target.top >= bounds.top - 2 && target.bottom <= bounds.bottom + 2,
        };
      }),
    )
    .toEqual({ scrolled: true, visible: true });
  await tabs.getByRole('tab', { name: '运行画面', exact: true }).click();
  await expect(controls).toHaveAttribute('data-cursor', cursor);
  expect(await executions(page)).toBe(1);
  await noPageOverflow(page);
  await attach(info, 'one-real-long-trace-source-reveal-and-hidden-key-guard', {
    request,
    result,
    length,
    cursor,
  });
});
