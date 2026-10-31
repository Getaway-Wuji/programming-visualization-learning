import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { ExecuteResult } from '../../web/src/engine/protocol';
import { observedExecute, observeVerticalExecution } from './vertical-observation';
import { isolateCaseProgram } from './case-content-copy';

const panel = (page: Page) => page.getByTestId('case-execution');
const controls = (page: Page) => page.getByTestId('player-controls');
const workspace = (page: Page) => page.getByTestId('player-workspace');
const source = (page: Page) =>
  panel(page).getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
const button = (page: Page, name: string) =>
  controls(page).getByRole('button', { name, exact: true });
const rate = (page: Page) => controls(page).getByRole('combobox', { name: '播放速度' });
const run = (page: Page) => panel(page).getByRole('button', { name: '运行示例', exact: true });

async function open(page: Page, caseId = 'case.c.assignment') {
  await page.goto(`/#/visualize/${caseId}`);
  await expect(page.getByTestId('input-panel')).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
}

async function emptyPreparedPlayer(page: Page, expectedExecutions: number) {
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(source(page)).not.toHaveValue('');
  await expect(source(page)).toHaveAttribute('readonly', '');
  await expect(controls(page)).toHaveAttribute('data-length', '0');
  await expect(controls(page)).toHaveAttribute('data-cursor', '');
  await expect(controls(page)).toHaveAttribute('data-player-status', 'idle');
  await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', '');
  for (const name of ['播放', '前进', '后退', '重播'])
    await expect(button(page, name)).toBeDisabled();
  await expect(rate(page)).toBeDisabled();
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.__verticalObservation.workers.filter((entry) => entry.kind === 'execute').length,
    ),
  ).toBe(expectedExecutions);
  expect(
    await page.evaluate(() =>
      window.__verticalObservation.workers.every((entry) => entry.terminated),
    ),
  ).toBe(true);
}

async function prepare(page: Page) {
  await panel(page).getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(controls(page)).toBeVisible();
}

async function cursor(page: Page, value: number) {
  await expect(controls(page)).toHaveAttribute('data-cursor', String(value));
  const length = Number(await controls(page).getAttribute('data-length'));
  await expect(page.getByTestId('player-cursor')).toHaveText(`步骤 ${value} / ${length}`);
}

async function accepted(
  page: Page,
  status: 'completed' | 'program-error' = 'completed',
): Promise<ExecuteResult> {
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', status);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'ready');
  await cursor(page, 0);
  const worker = await observedExecute(page);
  const result = JSON.parse(Buffer.from(worker.responseBytes!).toString('utf8')) as ExecuteResult;
  expect(worker.moduleSeen).toBe(true);
  expect(worker.responseOk).toBe(true);
  expect(worker.terminated).toBe(true);
  expect(result.producer).toBe('rust');
  expect(result.terminal.status).toBe(status);
  expect(result.trace!.steps.length).toBeGreaterThan(1);
  await expect(controls(page)).toHaveAttribute('data-length', String(result.trace!.steps.length));
  return result;
}

/** Install only after execution has finished; real Worker deadlines remain on real time. */
async function controlledPlaybackClock(page: Page) {
  const time = Date.now();
  await page.clock.install({ time });
  await page.clock.pauseAt(time + 1000);
}

async function evidence(page: Page, testInfo: TestInfo, name: string, extra = {}) {
  const worker = await observedExecute(page);
  const result = JSON.parse(Buffer.from(worker.responseBytes!).toString('utf8')) as ExecuteResult;
  await testInfo.attach(name, {
    body: JSON.stringify({
      evidenceLevel: 'production-ui-real-worker',
      browserVersion: page.context().browser()?.version(),
      producer: result.producer,
      terminal: result.terminal.status,
      completeness: result.trace?.completeness,
      steps: result.trace?.steps.length,
      requestOperationId: worker.operationId,
      responseOperationId: worker.responseOperationId,
      playerStatus: await controls(page).getAttribute('data-player-status'),
      cursor: await controls(page).getAttribute('data-cursor'),
      ...extra,
    }),
    contentType: 'application/json',
  });
}

test('preparation leaves controls disabled and a checked real Rust run starts at the initial cursor', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await open(page);
  await emptyPreparedPlayer(page, 0);
  await page.getByTestId('input-field-x').fill('-7');
  await prepare(page);
  for (const name of ['播放', '后退', '前进', '重播'])
    await expect(button(page, name)).toBeDisabled();
  await expect(rate(page)).toBeDisabled();
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  await accepted(page);
  await expect(page.getByTestId('execution-terminal')).toHaveText('程序正常结束');
  await expect(page.getByTestId('execution-output')).toHaveText('-5\n');
  await expect(button(page, '后退')).toBeDisabled();
  for (const name of ['播放', '前进', '重播']) await expect(button(page, name)).toBeEnabled();
  await expect(rate(page)).toBeEnabled();
  await expect(controls(page)).toContainText(/初始|就绪/);
  await evidence(page, testInfo, 'initial-real-Rust-player');
  await page.screenshot({ path: testInfo.outputPath('player-ready.png'), fullPage: true });
});

test('single-step boundaries, terminal state and replay use one accepted trajectory', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await open(page);
  await prepare(page);
  const result = await accepted(page);
  const length = result.trace!.steps.length;
  for (let value = 1; value <= length; value++) {
    await button(page, '前进').click();
    await cursor(page, value);
  }
  await expect(controls(page)).toHaveAttribute('data-player-status', 'ended');
  await expect(controls(page)).toContainText(/结束/);
  for (const name of ['播放', '前进']) await expect(button(page, name)).toBeDisabled();
  for (const name of ['后退', '重播']) await expect(button(page, name)).toBeEnabled();
  for (let value = length - 1; value >= 0; value--) {
    await button(page, '后退').click();
    await cursor(page, value);
  }
  await expect(button(page, '后退')).toBeDisabled();
  await controlledPlaybackClock(page);
  await button(page, '前进').click();
  await button(page, '重播').click();
  await cursor(page, 0);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'playing');
  await button(page, '暂停').click();
  await page.clock.runFor(2000);
  await cursor(page, 0);
  expect(
    await page.evaluate(
      () =>
        window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
    ),
  ).toBe(1);
  await evidence(page, testInfo, 'boundaries-and-replay', { forwardAndReverseSteps: length });
});

test('repeated play and pause never multiply timers and a paused cursor remains stable', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await open(page, 'case.c.bubble-sort');
  await prepare(page);
  await accepted(page);
  await controlledPlaybackClock(page);
  for (let cycle = 0; cycle < 12; cycle++) {
    await button(page, '播放').click();
    await button(page, '暂停').click();
    await expect(controls(page)).toHaveAttribute('data-player-status', 'paused');
  }
  await page.clock.runFor(2500);
  await cursor(page, 0);
  await button(page, '播放').click();
  await page.clock.runFor(495);
  await cursor(page, 0);
  await page.clock.runFor(10);
  await cursor(page, 1);
  await page.clock.runFor(500);
  await cursor(page, 2);
  await button(page, '暂停').click();
  await page.clock.runFor(4000);
  await cursor(page, 2);
  await evidence(page, testInfo, 'single-scheduler-paused-stability', { rapidToggleCycles: 12 });
});

test('all six speeds control the next real step and a speed change replaces the pending timer', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await open(page, 'case.c.bubble-sort');
  await prepare(page);
  await accepted(page);
  await controlledPlaybackClock(page);
  expect(
    await rate(page)
      .locator('option')
      .evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value)),
  ).toEqual(['0.25', '0.5', '1', '1.5', '2', '4']);
  const observations = [];
  for (const speed of [0.25, 0.5, 1, 1.5, 2, 4]) {
    await rate(page).selectOption(String(speed));
    await button(page, '重播').click();
    await cursor(page, 0);
    const period = Math.ceil(500 / speed);
    await page.clock.runFor(period - 5);
    await cursor(page, 0);
    await page.clock.runFor(10);
    await cursor(page, 1);
    await button(page, '暂停').click();
    observations.push({ speed, period, observedCursor: 1 });
  }
  await rate(page).selectOption('1');
  await button(page, '重播').click();
  await page.clock.runFor(100);
  await rate(page).selectOption('2');
  await page.clock.runFor(240);
  await cursor(page, 0);
  await page.clock.runFor(20);
  await cursor(page, 1);
  await page.clock.runFor(250);
  await cursor(page, 2);
  await button(page, '暂停').click();
  await evidence(page, testInfo, 'speed-and-reschedule', { observations });
});

test('space and left or right arrows work in the focused workspace and stay scoped to it', async ({
  page,
}) => {
  await observeVerticalExecution(page);
  await open(page);
  await prepare(page);
  await accepted(page);
  await controlledPlaybackClock(page);
  await expect(workspace(page)).toHaveAttribute('tabindex', '0');
  await workspace(page).focus();
  await page.keyboard.press('ArrowRight');
  await cursor(page, 1);
  await page.keyboard.press('ArrowRight');
  await cursor(page, 2);
  await page.keyboard.press('ArrowLeft');
  await cursor(page, 1);
  await page.keyboard.press('Space');
  await expect(controls(page)).toHaveAttribute('data-player-status', 'playing');
  await page.clock.runFor(505);
  await cursor(page, 2);
  await page.keyboard.press('Space');
  await expect(controls(page)).toHaveAttribute('data-player-status', 'paused');
  await page.clock.runFor(2000);
  await cursor(page, 2);
  await page.locator('main h1').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await page.clock.runFor(1000);
  await cursor(page, 2);
});

test('source, input, select and button focus retain their native keyboard semantics', async ({
  page,
}) => {
  await observeVerticalExecution(page);
  await open(page);
  await page.getByTestId('input-field-x').fill('-7');
  await prepare(page);
  await accepted(page);
  await controlledPlaybackClock(page);
  const originalSource = await source(page).inputValue();
  await source(page).focus();
  for (const key of ['ArrowRight', 'ArrowLeft', 'Space']) await page.keyboard.press(key);
  await expect(source(page)).toHaveValue(originalSource);
  await cursor(page, 0);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'ready');
  await rate(page).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(rate(page)).toHaveValue('0.5');
  await page.keyboard.press('Escape');
  await cursor(page, 0);
  await button(page, '前进').focus();
  await page.keyboard.press('ArrowLeft');
  await cursor(page, 0);
  await page.keyboard.press('Space');
  await cursor(page, 1);
  await page.getByTestId('input-field-x').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await cursor(page, 1);
  await page.keyboard.press('End');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('input-field-x')).toHaveValue('-7 ');
  await expect(controls(page)).toHaveCount(0);
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
});

test('editing, a replacement execution and reload synchronously discard old playback', async ({
  page,
}) => {
  await observeVerticalExecution(page);
  await open(page);
  await prepare(page);
  await accepted(page);
  await button(page, '播放').click();
  await page.getByTestId('input-field-x').fill('8');
  await expect(controls(page)).toHaveCount(0);
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  await page.waitForTimeout(650);
  await expect(controls(page)).toHaveCount(0);
  await prepare(page);
  const replacement = await accepted(page);
  await expect(page.getByTestId('execution-output')).toHaveText('10\n');
  await button(page, '播放').click();
  const newest = await accepted(page);
  expect(newest.identity.runId).not.toBe(replacement.identity.runId);
  await page.waitForTimeout(650);
  await cursor(page, 0);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'ready');
  await button(page, '播放').click();
  await page.reload();
  await expect(page.getByTestId('input-panel')).toBeVisible();
  await emptyPreparedPlayer(page, 0);
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  for (const name of ['播放', '前进', '后退', '重播'])
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
});

test('leaving a playing page and returning through browser history cannot revive its run', async ({
  page,
}) => {
  await observeVerticalExecution(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await prepare(page);
  await accepted(page);
  await button(page, '播放').click();
  await page.getByRole('link', { name: '返回案例目录', exact: true }).click();
  await expect(page).toHaveURL(/#\/cases$/);
  await expect(controls(page)).toHaveCount(0);
  await page.waitForTimeout(650);
  await page.goBack();
  await expect(page.getByTestId('input-panel')).toBeVisible();
  await emptyPreparedPlayer(page, 1);
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  await prepare(page);
  await accepted(page);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'ready');
  expect(errors).toEqual([]);
});

test('a document becoming hidden pauses playback and returning does not restart it', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await open(page, 'case.c.bubble-sort');
  await prepare(page);
  await accepted(page);
  await controlledPlaybackClock(page);
  await button(page, '播放').click();
  await page.clock.runFor(505);
  await cursor(page, 1);
  const other = await page.context().newPage();
  await other.bringToFront();
  const nativeHidden = await page.evaluate(() => document.visibilityState === 'hidden');
  if (!nativeHidden) {
    // Headless browsers may keep every tab visible. Exercise the same DOM lifecycle
    // boundary explicitly, without touching the player/controller or its state.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  await expect(controls(page)).toHaveAttribute('data-player-status', 'paused');
  await page.clock.runFor(2500);
  await cursor(page, 1);
  await other.close();
  await page.bringToFront();
  if (!nativeHidden) {
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  await page.clock.runFor(1500);
  await cursor(page, 1);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'paused');
  await evidence(page, testInfo, 'visibility-pause', {
    visibilityEvidence: nativeHidden ? 'native-background-tab' : 'isolated-DOM-visibility-event',
  });
});

test('a genuine Rust failure prefix remains playable and reaches its failed tail', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  // This test changes the bundled independent case only. Keep the separately
  // fetched current course unavailable so it cannot supply an unmodified template.
  await page.route(/\/content\/(?:course|review)\//, (route) =>
    route.fulfill({ status: 404, body: 'Isolated independent-case failure-prefix test' }),
  );
  const isolation = await isolateCaseProgram(page, 'program.c.assignment', (original) => {
    const find = 'x = x + 2;';
    expect(original.split(find)).toHaveLength(2);
    return original.replace(find, 'printf("%d\\n", x); x = x / 0;');
  });
  await open(page);
  await page.getByTestId('input-field-x').fill('-7');
  await prepare(page);
  const result = await accepted(page, 'program-error');
  expect(result.trace!.completeness).toBe('prefix');
  expect(result.terminal.diagnostics.map((diagnostic) => diagnostic.code)).toContain('E_DIV_ZERO');
  await expect(page.getByTestId('execution-terminal')).toHaveText('程序发生错误');
  await expect(page.getByTestId('execution-output')).toHaveText('-7\n');
  await expect(page.getByTestId('execution-steps')).toContainText('未完成的有效前缀');
  await controlledPlaybackClock(page);
  await button(page, '播放').click();
  await page.clock.runFor(result.trace!.steps.length * 500 + 10);
  await cursor(page, result.trace!.steps.length);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'failed');
  await expect(controls(page)).toContainText(/停止|失败|错误/);
  for (const name of ['播放', '前进']) await expect(button(page, name)).toBeDisabled();
  for (const name of ['后退', '重播']) await expect(button(page, name)).toBeEnabled();
  await button(page, '后退').click();
  await cursor(page, result.trace!.steps.length - 1);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'paused');
  await expect(page.getByTestId('execution-terminal')).toHaveText('程序发生错误');
  await button(page, '重播').click();
  await cursor(page, 0);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'playing');
  await button(page, '暂停').click();
  await evidence(page, testInfo, 'real-failure-prefix-controls', {
    sourceKind: 'test-isolated-application-case-config-copy/divide-by-zero',
    publicationEvidence: false,
    isolatedConfiguration: isolation.getCopy(),
  });
  expect(isolation.getCopy()).toBeDefined();
  await page.screenshot({ path: testInfo.outputPath('player-failure-prefix.png'), fullPage: true });
});

test('a real Worker load failure has no playable trajectory and a new execution recovers', async ({
  page,
}) => {
  await observeVerticalExecution(page);
  await open(page);
  await prepare(page);
  const workerUrl = /\/assets\/execution\.worker-[^/]+\.js$/;
  await page.route(workerUrl, (route) => route.abort('failed'));
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'infrastructure-failure');
  await expect(controls(page)).toHaveAttribute('data-player-status', 'failed');
  await expect(controls(page)).toHaveAttribute('data-cursor', '');
  await expect(controls(page)).toHaveAttribute('data-length', '0');
  await expect(page.getByTestId('execution-steps')).toContainText('有效轨迹：0 步');
  for (const name of ['播放', '后退', '前进', '重播'])
    await expect(button(page, name)).toBeDisabled();
  await expect(rate(page)).toBeDisabled();
  await page.unroute(workerUrl);
  await accepted(page);
  await expect(button(page, '前进')).toBeEnabled();
});

test('a real result crossing its deadline during initial player rendering cannot resurrect its trace', async ({
  page,
}, testInfo) => {
  await observeVerticalExecution(page);
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    let advanced = false;
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => {
        if (
          !advanced &&
          document.querySelector('[data-testid="player-controls"][data-player-status="ready"]')
        )
          advanced = true;
        return realNow() + (advanced ? 1500 : 0);
      },
    });
  });
  await open(page);
  await prepare(page);
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'resource-limit');
  await expect(page.getByTestId('animation-panel')).toContainText('E_DEADLINE');
  await expect(controls(page)).toHaveAttribute('data-player-status', 'failed');
  await expect(controls(page)).toHaveAttribute('data-cursor', '');
  await expect(controls(page)).toHaveAttribute('data-length', '0');
  for (const name of ['播放', '后退', '前进', '重播'])
    await expect(button(page, name)).toBeDisabled();
  await page.waitForTimeout(650);
  await expect(controls(page)).toHaveAttribute('data-player-status', 'failed');
  await expect(controls(page)).toHaveAttribute('data-cursor', '');
  await evidence(page, testInfo, 'post-commit-deadline-rejection', {
    fault: 'main-thread monotonic clock advances 1500 ms after first ready DOM commit',
    expectedAdapterCode: 'E_DEADLINE',
    performanceAcceptanceClaim: false,
  });
});
