import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { ExecuteRequest, ExecuteResult } from '../../web/src/engine/protocol';
import type { LedgerEntry, StorageSnapshot } from '../../web/src/storage/model';
import { blockWorkspace, correctStarter, wrongEcho, showPracticeBlocks } from './block-ui';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

const caseId = 'case.c.assignment';
const exerciseId = 'exercise.c.echo';
const lessonId = 'lesson.c.variables-output';
const casePanel = (page: Page) => page.getByTestId('case-execution');
const practicePanel = (page: Page) => page.getByTestId('practice-execution');
const controls = (page: Page) => page.getByTestId('player-controls');
const confirmation = (page: Page) => page.getByTestId('case-view-confirmation');
const confirmViewing = (page: Page) =>
  confirmation(page).getByRole('button', { name: '确认已观看', exact: true });
const saveStatus = (page: Page) => page.getByTestId('learning-save-status');
const policyRef = { id: 'reward.policy.p0', version: '1.0.0' };
const dailyPolicyRef = { id: 'reward.policy.daily-goal.p0', version: '1.0.0' };
const recommendedTargets = { exercise: 1, lesson: 1, case: 0 };

/** Inspect the real database without seeding progress, rewards or execution evidence. */
async function snapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const entries = await Promise.all(
        names.map(async (name) => {
          const value = await new Promise<unknown>((resolve, reject) => {
            const store = tx.objectStore(name);
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

const localReady = (page: Page) =>
  expect(saveStatus(page)).toHaveAttribute('data-save-status', 'ready');

function points(data: StorageSnapshot) {
  return data.ledger.reduce((total, row) => total + (row.points ?? 0), 0);
}

function assertRewards(data: StorageSnapshot, expectedPoints: number) {
  expect(points(data)).toBe(expectedPoints);
  for (const row of data.ledger) {
    expect(row.status).toBe('posted');
    expect(row.policyRef).toEqual(
      row.sourceId === 'reward.daily-goal.once' ? dailyPolicyRef : policyRef,
    );
    expect(row.points).toBe(
      row.sourceId === 'reward.exercise.first-pass'
        ? 10
        : row.sourceId === 'reward.lesson.first-completion'
          ? 20
          : row.sourceId === 'reward.case.first-view' || row.sourceId === 'reward.daily-goal.once'
            ? 5
            : Number.NaN,
    );
  }
  expect(data.settings.goalTemplate).toEqual({ revision: 1, targets: recommendedTargets });
  for (const goal of data.goals) {
    expect(goal).toMatchObject({ goalVersion: 1, targets: recommendedTargets });
    const facts = data.dailyFacts.filter((fact) => fact.localDate === goal.localDate);
    const achieved =
      facts.some((fact) => fact.eventType === 'exercise.passed') &&
      facts.some((fact) => fact.eventType === 'lesson.completed');
    expect(goal.achievedAt !== null).toBe(achieved);
    expect(
      data.ledger.filter(
        (entry) =>
          entry.sourceId === 'reward.daily-goal.once' && entry.localDate === goal.localDate,
      ),
    ).toHaveLength(achieved ? 1 : 0);
  }
  const keys = (value: unknown): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
      : [];
  const forbidden = [
    'source',
    'sourceSha256',
    'input',
    'seed',
    'stdout',
    'trace',
    'ast',
    'nodeMap',
    'checks',
    'coverage',
    'submissionId',
    'runId',
    'contextId',
    'sourceRevision',
    'workspace',
  ];
  expect(keys(data).filter((key) => forbidden.includes(key))).toEqual([]);
}

function assertNoLearningChange(before: StorageSnapshot, after: StorageSnapshot) {
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(after[store]).toEqual(before[store]);
}

async function evidence(testInfo: TestInfo, label: string, value: unknown) {
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '11.2',
    'regression',
    'rewards',
    process.env.REWARD_BROWSER_ROUND ?? 'current',
    testInfo.project.name,
    label,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'evidence.json');
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
  await testInfo.attach(label, { path, contentType: 'application/json' });
  return directory;
}

async function openCase(page: Page) {
  await page.bringToFront();
  await page.goto(`/#/visualize/${caseId}`);
  await expect(casePanel(page)).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  await expect(confirmation(page)).toBeVisible();
}

async function prepareCase(page: Page, input = '-7') {
  await page.getByTestId('input-field-x').fill(input);
  await casePanel(page).getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(casePanel(page)).toHaveAttribute('data-state', 'ready');
}

async function painted(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function runCase(page: Page, testInfo: TestInfo, label: string) {
  await casePanel(page).getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(casePanel(page)).toHaveAttribute('data-state', 'completed');
  await expect(controls(page)).toHaveAttribute('data-cursor', '0');
  const worker = await observedCaseSetExecute(page);
  const requestBytes = Buffer.from(worker.requestBytes!);
  const resultBytes = Buffer.from(worker.responseBytes!);
  const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
  const result = JSON.parse(resultBytes.toString('utf8')) as ExecuteResult;
  expect(worker.moduleSeen).toBe(true);
  expect(worker.responseOk).toBe(true);
  expect(worker.terminated).toBe(true);
  expect(request.mode).toBe('case');
  expect(request.subjectRef?.id).toBe(caseId);
  expect(result.producer).toBe('rust');
  expect(result.identity).toEqual(request.identity);
  expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
  expect(result.trace?.completeness).toBe('complete');
  expect(request.source.text).toBe(
    await casePanel(page)
      .getByRole('textbox', { name: '当前执行的 C 代码', exact: true })
      .inputValue(),
  );
  const length = result.trace!.steps.length;
  expect(length).toBeGreaterThan(1);
  await expect(controls(page)).toHaveAttribute('data-length', String(length));
  await expect(page.getByTestId('case-view-coverage')).toHaveAttribute(
    'data-total',
    String(length),
  );
  await page.getByTestId('trace-view').scrollIntoViewIfNeeded();
  await painted(page);
  const directory = await evidence(testInfo, label, {
    requestIdentity: request.identity,
    producer: result.producer,
    terminal: result.terminal,
    steps: length,
    requestSourceMatchesDisplayed:
      request.source.text ===
      (await casePanel(page)
        .getByRole('textbox', { name: '当前执行的 C 代码', exact: true })
        .inputValue()),
  });
  await writeFile(join(directory, 'request.json'), requestBytes);
  await writeFile(join(directory, 'result.json'), resultBytes);
  await writeFile(join(directory, 'catalog.json'), worker.catalogJson!);
  return { length, identity: result.identity };
}

/** Each adjacent genuine state must reach the rendered trace before the next action. */
async function walk(page: Page, from: number, to: number) {
  const cursors = [];
  const direction = from < to ? 1 : -1;
  for (
    let cursor = from + direction;
    direction > 0 ? cursor <= to : cursor >= to;
    cursor += direction
  ) {
    const previousSeen = Number(
      await page.getByTestId('case-view-coverage').getAttribute('data-covered'),
    );
    await controls(page)
      .getByRole('button', { name: direction > 0 ? '前进' : '后退', exact: true })
      .click();
    await expect(controls(page)).toHaveAttribute('data-cursor', String(cursor));
    await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', String(cursor));
    await page.getByTestId('trace-view').scrollIntoViewIfNeeded();
    await painted(page);
    await expect(page.getByTestId('case-view-coverage')).toHaveAttribute(
      'data-covered',
      String(direction > 0 ? Math.max(previousSeen, cursor) : previousSeen),
    );
    cursors.push(cursor);
  }
  return cursors;
}

async function saveCase(page: Page) {
  await expect(confirmation(page)).toHaveAttribute('data-view-state', 'ready');
  await expect(confirmViewing(page)).toBeEnabled();
  await confirmViewing(page).click();
  await expect(confirmation(page)).toHaveAttribute('data-view-state', 'saved');
  await localReady(page);
}

async function openPractice(page: Page) {
  await page.goto(`/#/practice/${exerciseId}`);
  await expect(practicePanel(page)).toHaveAttribute('data-state', 'ready');
  await expect.poll(async () => (await snapshot(page)).settings.goalTemplate).not.toBeNull();
  await localReady(page);
  await showPracticeBlocks(page);
  await expect(blockWorkspace(page)).toBeVisible();
  await localReady(page);
}

async function preparePractice(page: Page) {
  await practicePanel(page).getByRole('button', { name: '准备代码', exact: true }).click();
  await expect(practicePanel(page)).toHaveAttribute('data-state', 'ready');
  await expect(
    practicePanel(page).getByRole('button', { name: '提交练习', exact: true }),
  ).toBeEnabled();
}

async function submitPractice(page: Page, terminal: 'passed' | 'unmet' = 'passed') {
  await preparePractice(page);
  await practicePanel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(practicePanel(page)).toHaveAttribute('data-state', terminal);
}

async function savedPass(page: Page) {
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await localReady(page);
}

async function confirmLesson(page: Page) {
  await page.goto(`/#/lessons/${lessonId}`);
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  await page.getByRole('button', { name: /^(确认已学习|确认今日复习)$/ }).click();
  await localReady(page);
  await expect(page.getByTestId('lesson-progress')).toContainText(/已确认学习|小节已完成/);
}

interface LedgerFault {
  armedSource: string | null;
  attempted: LedgerEntry[];
}

/** Fail a native ledger write, after production has verified a genuine learning fact. */
async function installLedgerQuota(page: Page) {
  await page.addInitScript(() => {
    const state: LedgerFault = { armedSource: null, attempted: [] };
    Object.assign(window, { __rewardLedgerFault: state });
    for (const method of ['add', 'put'] as const) {
      const native = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (value, key) {
        if (this.name === 'ledger' && state.armedSource) {
          state.attempted.push(structuredClone(value as LedgerEntry));
          if ((value as LedgerEntry).sourceId === state.armedSource) {
            state.armedSource = null;
            throw new DOMException(
              'Isolated native reward ledger write failure',
              'QuotaExceededError',
            );
          }
        }
        return key === undefined ? native.call(this, value) : native.call(this, value, key);
      };
    }
  });
}

async function armLedgerQuota(page: Page, source: LedgerEntry['sourceId']) {
  await page.evaluate((value) => {
    (window as unknown as { __rewardLedgerFault: LedgerFault }).__rewardLedgerFault.armedSource =
      value;
  }, source);
}

const ledgerFault = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __rewardLedgerFault: LedgerFault }).__rewardLedgerFault,
  );

async function retryOriginal(page: Page) {
  await saveStatus(page).getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await localReady(page);
}

async function clearArchive(page: Page) {
  await page.goto('/#/settings?panel=data');
  await localReady(page);
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(saveStatus(page)).toContainText('本地数据已清除');
}

test('a real complete adjacent case viewing requires active confirmation and awards five only once across replay, refresh and another run', async ({
  page,
}, testInfo) => {
  await observeCaseSetExecution(page);
  await openCase(page);
  const initial = await snapshot(page);
  await prepareCase(page);
  const first = await runCase(page, testInfo, 'case-first-real-run');
  await expect(confirmViewing(page)).toBeDisabled();
  const forward = await walk(page, 0, first.length - 1);
  await expect(confirmViewing(page)).toBeDisabled();
  await walk(page, first.length - 1, first.length);
  await expect(confirmation(page)).toHaveAttribute('data-view-state', 'ready');
  assertNoLearningChange(initial, await snapshot(page));
  const coverage = await page.getByTestId('case-view-coverage').innerText();
  await saveCase(page);
  const saved = await snapshot(page);
  assertRewards(saved, 5);
  expect(saved.receipts.filter((row) => row.eventType === 'case.view-confirmed')).toHaveLength(1);
  expect(saved.dailyFacts).toHaveLength(1);
  await walk(page, first.length, 0);
  expect(await snapshot(page)).toEqual(saved);
  await controls(page).getByRole('combobox', { name: '播放速度', exact: true }).selectOption('4');
  await controls(page).getByRole('button', { name: '重播', exact: true }).click();
  await expect(controls(page)).toHaveAttribute('data-player-status', 'ended');
  expect(await snapshot(page)).toEqual(saved);
  await page.reload();
  await expect(casePanel(page)).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  await expect(confirmViewing(page)).toBeDisabled();
  expect(await snapshot(page)).toEqual(saved);
  await prepareCase(page, '8');
  const second = await runCase(page, testInfo, 'case-repeat-real-run');
  expect(second.identity.runId).not.toBe(first.identity.runId);
  await walk(page, 0, second.length);
  await saveCase(page);
  const repeated = await snapshot(page);
  assertRewards(repeated, 5);
  expect(repeated.ledger).toEqual(saved.ledger);
  expect(repeated.dailyFacts).toEqual(saved.dailyFacts);
  expect(repeated.receipts.filter((row) => row.eventType === 'case.view-confirmed')).toHaveLength(
    2,
  );
  await evidence(testInfo, 'case-explicit-first-and-repeat', {
    initial,
    saved,
    repeated,
    forward: [0, ...forward, first.length],
    coverage,
    refreshDidNotRestoreViewingCoverage: true,
  });
});

test('input changes reset genuine viewing coverage and cancelled or deadline-failed runs cannot award viewing points', async ({
  page,
}, testInfo) => {
  await observeCaseSetExecution(page);
  await openCase(page);
  const initial = await snapshot(page);
  await prepareCase(page);
  const first = await runCase(page, testInfo, 'case-before-input-change');
  await walk(page, 0, first.length);
  await expect(confirmViewing(page)).toBeEnabled();
  await page.getByTestId('input-field-x').fill('9');
  await expect(casePanel(page)).toHaveAttribute('data-state', 'unprepared');
  await expect(confirmViewing(page)).toBeDisabled();
  await prepareCase(page, '9');
  const second = await runCase(page, testInfo, 'case-after-input-change');
  await expect(confirmViewing(page)).toBeDisabled();
  await walk(page, 0, second.length - 1);
  await expect(confirmViewing(page)).toBeDisabled();
  assertNoLearningChange(initial, await snapshot(page));
  await page.getByTestId('input-field-x').fill('10');
  await prepareCase(page, '10');
  // Hold the outbound execute operation; the UI must handle a real cancellation/deadline.
  // No successful response or trajectory is supplied by this fault injector.
  await page.evaluate(() => {
    const native = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, options) {
      if ((message as { kind?: string })?.kind === 'execute') return;
      Reflect.apply(native, this, [message, options ?? {}]);
    };
  });
  await casePanel(page).getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(casePanel(page)).toHaveAttribute('data-state', 'running');
  await casePanel(page).getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(casePanel(page)).toHaveAttribute('data-state', 'cancelled');
  await expect(confirmViewing(page)).toBeDisabled();
  assertNoLearningChange(initial, await snapshot(page));
  await casePanel(page).getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(casePanel(page)).toHaveAttribute('data-state', 'resource-limit');
  await expect(casePanel(page)).toContainText('E_DEADLINE');
  await expect(confirmViewing(page)).toBeDisabled();
  const after = await snapshot(page);
  assertNoLearningChange(initial, after);
  assertRewards(after, 0);
  await evidence(testInfo, 'input-invalidation-cancel-and-deadline', { initial, after });
});

test('a real exercise first pass awards ten and confirmed lesson completion adds twenty plus one daily five; failure, repetition and refresh preserve the ledger', async ({
  page,
}, testInfo) => {
  await observeCaseSetExecution(page);
  await openPractice(page);
  await submitPractice(page, 'unmet');
  const wrong = await snapshot(page);
  assertRewards(wrong, 0);
  await correctStarter(page, exerciseId);
  await submitPractice(page);
  await savedPass(page);
  const passed = await snapshot(page);
  assertRewards(passed, 10);
  expect(passed.ledger).toHaveLength(1);
  await practicePanel(page).getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/practice/${exerciseId}/review$`));
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认已观看', exact: true })).toHaveCount(0);
  await confirmLesson(page);
  await expect(page.getByTestId('lesson-progress')).toContainText('小节已完成');
  const completed = await snapshot(page);
  assertRewards(completed, 35);
  expect(completed.ledger).toHaveLength(3);
  await openPractice(page);
  await submitPractice(page, 'unmet');
  const failedAgain = await snapshot(page);
  expect(failedAgain.ledger).toEqual(completed.ledger);
  expect(failedAgain.dailyFacts).toEqual(completed.dailyFacts);
  expect(
    failedAgain.progress.filter((row) => row.eventType !== 'exercise.attempt-evaluated'),
  ).toEqual(completed.progress.filter((row) => row.eventType !== 'exercise.attempt-evaluated'));
  await correctStarter(page, exerciseId);
  await submitPractice(page);
  await savedPass(page);
  const repeated = await snapshot(page);
  assertRewards(repeated, 35);
  expect(repeated.ledger).toEqual(completed.ledger);
  expect(repeated.dailyFacts).toEqual(completed.dailyFacts);
  expect(repeated.receipts.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(2);
  await page.reload();
  await expect(practicePanel(page)).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  const reloaded = await snapshot(page);
  for (const store of [
    'progress',
    'dailyFacts',
    'ledger',
    'receipts',
    'goals',
    'aliases',
    'settings',
    'avatar',
    'appearance',
    'appearanceAssets',
  ] as const)
    expect(reloaded[store]).toEqual(repeated[store]);
  await evidence(testInfo, 'exercise-ten-lesson-twenty-repeat', {
    wrong,
    passed,
    completed,
    repeated,
  });
});

test('two real case pages concurrently confirming complete coverage share one five-point first reward', async ({
  page,
  context,
}, testInfo) => {
  const other = await context.newPage();
  for (const target of [page, other]) {
    await observeCaseSetExecution(target);
    await openCase(target);
    await prepareCase(target);
    const run = await runCase(
      target,
      testInfo,
      target === page ? 'concurrent-case-a' : 'concurrent-case-b',
    );
    await walk(target, 0, run.length);
    await expect(confirmViewing(target)).toBeEnabled();
  }
  await Promise.all([confirmViewing(page).click(), confirmViewing(other).click()]);
  for (const target of [page, other])
    await expect(confirmation(target)).toHaveAttribute('data-view-state', 'saved');
  const merged = await snapshot(page);
  assertRewards(merged, 5);
  expect(merged.ledger).toHaveLength(1);
  expect(merged.progress).toHaveLength(1);
  expect(merged.dailyFacts).toHaveLength(1);
  expect(merged.receipts).toHaveLength(2);
  expect(new Set(merged.receipts.map((row) => row.eventId)).size).toBe(2);
  await evidence(testInfo, 'native-concurrent-case-first', merged);
});

test('two real exercise pages concurrently passing share one ten-point first reward', async ({
  page,
  context,
}, testInfo) => {
  const other = await context.newPage();
  for (const target of [page, other]) {
    await openPractice(target);
    await correctStarter(target, exerciseId);
    await preparePractice(target);
  }
  await Promise.all(
    [page, other].map((target) =>
      practicePanel(target).getByRole('button', { name: '提交练习', exact: true }).click(),
    ),
  );
  await savedPass(page);
  await savedPass(other);
  const merged = await snapshot(page);
  assertRewards(merged, 10);
  expect(merged.ledger).toHaveLength(1);
  expect(merged.progress).toHaveLength(1);
  expect(merged.dailyFacts).toHaveLength(1);
  expect(merged.receipts).toHaveLength(2);
  expect(new Set(merged.receipts.map((row) => row.eventId)).size).toBe(2);
  await evidence(testInfo, 'native-concurrent-exercise-first', merged);
});

test('a native second-ledger quota failure rolls all awards and pass effects back, then retries the original operation', async ({
  page,
}, testInfo) => {
  await installLedgerQuota(page);
  await observeCaseSetExecution(page);
  await confirmLesson(page);
  const before = await snapshot(page);
  await openPractice(page);
  await correctStarter(page, exerciseId);
  await armLedgerQuota(page, 'reward.lesson.first-completion');
  await submitPractice(page);
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
    'data-save-state',
    'unsaved',
  );
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  const failed = await snapshot(page);
  assertNoLearningChange(before, failed);
  const attempted = (await ledgerFault(page)).attempted;
  expect(attempted.map((row) => row.sourceId)).toEqual([
    'reward.exercise.first-pass',
    'reward.lesson.first-completion',
  ]);
  const runsBefore = await page.evaluate(
    () => window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
  );
  await wrongEcho(page);
  await page.goto('/#/courses');
  await retryOriginal(page);
  const retried = await snapshot(page);
  assertRewards(retried, 35);
  expect(retried.ledger.filter((entry) => entry.sourceId !== 'reward.daily-goal.once')).toEqual(
    attempted,
  );
  expect(retried.ledger).toHaveLength(3);
  expect(retried.receipts.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(1);
  expect(
    await page.evaluate(
      () =>
        window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
    ),
  ).toBe(runsBefore);
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(retried);
  await evidence(testInfo, 'native-ledger-atomic-quota-and-original-retry', {
    before,
    failed,
    attempted,
    retried,
    runsBefore,
  });
});

test('a case ledger quota failure remains unsaved and original accepted confirmation can retry after input invalidation', async ({
  page,
}, testInfo) => {
  await installLedgerQuota(page);
  await observeCaseSetExecution(page);
  await openCase(page);
  const before = await snapshot(page);
  await prepareCase(page);
  const run = await runCase(page, testInfo, 'case-ledger-quota-real-run');
  await walk(page, 0, run.length);
  await armLedgerQuota(page, 'reward.case.first-view');
  await confirmViewing(page).click();
  await expect(confirmation(page)).toHaveAttribute('data-view-state', 'unsaved');
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  const failed = await snapshot(page);
  assertNoLearningChange(before, failed);
  const attempted = (await ledgerFault(page)).attempted;
  expect(attempted).toHaveLength(1);
  await page.getByTestId('input-field-x').fill('12');
  await expect(confirmViewing(page)).toBeDisabled();
  await page.goto('/#/courses');
  await retryOriginal(page);
  const retried = await snapshot(page);
  assertRewards(retried, 5);
  expect(retried.ledger).toEqual(attempted);
  expect(retried.receipts.filter((row) => row.eventType === 'case.view-confirmed')).toHaveLength(1);
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(retried);
  await evidence(testInfo, 'native-case-quota-and-original-retry', {
    before,
    failed,
    attempted,
    retried,
  });
});

test('clearing from another page discards a pending case award and prevents old-generation revival', async ({
  page,
  context,
}, testInfo) => {
  await installLedgerQuota(page);
  await observeCaseSetExecution(page);
  await openCase(page);
  await prepareCase(page);
  const run = await runCase(page, testInfo, 'case-before-clear-real-run');
  await walk(page, 0, run.length);
  await armLedgerQuota(page, 'reward.case.first-view');
  await confirmViewing(page).click();
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  const before = await snapshot(page);
  const settings = await context.newPage();
  await clearArchive(settings);
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  await expect(page.getByTestId('case-view-coverage')).toHaveAttribute('data-covered', '0');
  await expect(page.getByTestId('case-view-coverage')).toHaveAttribute('data-total', '0');
  await expect(confirmViewing(page)).toBeDisabled();
  await expect(
    saveStatus(page).getByRole('button', { name: '重试未保存操作', exact: true }),
  ).toHaveCount(0);
  const cleared = await snapshot(page);
  expect(cleared.meta.generation).not.toBe(before.meta.generation);
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(cleared[store]).toEqual([]);
  await page.reload();
  await expect(casePanel(page)).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  expect(await snapshot(page)).toEqual(cleared);
  assertRewards(cleared, 0);
  await evidence(testInfo, 'native-case-clear-generation-barrier', { before, cleared });
});

test('the points detail explains the native ledger and fixed first-reward rules at desktop, tablet and phone widths', async ({
  page,
}, testInfo) => {
  await openPractice(page);
  await correctStarter(page, exerciseId);
  await submitPractice(page);
  await savedPass(page);
  await confirmLesson(page);
  const saved = await snapshot(page);
  assertRewards(saved, 35);
  await page.goto('/#/?panel=points');
  await expect(page.getByTestId('learning-posted-points')).toHaveText('35');
  const dialog = page.getByRole('dialog', { name: '积分明细', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.learning-history-list li')).toHaveCount(3);
  await expect(dialog).toContainText('35');
  for (const number of ['10', '20', '5']) await expect(dialog).toContainText(number);
  await expect(dialog).toContainText(/习题|练习/);
  await expect(dialog).toContainText('小节');
  await expect(dialog).toContainText('案例');
  const directory = await evidence(testInfo, 'points-detail-responsive', saved);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(dialog).toBeVisible();
    const geometry = await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        viewport: innerWidth,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(-1);
    expect(geometry.right).toBeLessThanOrEqual(width + 1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    await page.screenshot({ path: join(directory, `points-${width}.png`), fullPage: true });
  }
  expect(await snapshot(page)).toEqual(saved);
});

test('one pixel of trace visibility cannot credit hidden keyboard steps or backfill missing adjacent viewing', async ({
  page,
}, testInfo) => {
  await observeCaseSetExecution(page);
  await openCase(page);
  const before = await snapshot(page);
  await prepareCase(page);
  const run = await runCase(page, testInfo, 'one-pixel-real-run');
  expect(run.length).toBeGreaterThan(2);
  const trace = page.getByTestId('trace-view');
  const core = trace.locator('[aria-label="当前变量"]');
  const coverage = page.getByTestId('case-view-coverage');
  const workspace = page.getByTestId('player-workspace');
  await core.scrollIntoViewIfNeeded();
  await painted(page);
  await painted(page);
  await expect(coverage).toHaveAttribute('data-covered', '0');
  await expect(trace).toHaveAttribute('data-cursor', '0');
  await workspace.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await expect(workspace).toBeFocused();

  const readVisibility = () =>
    trace.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const variables = element.querySelector('[aria-label="当前变量"]')!;
      const coreBounds = variables.getBoundingClientRect();
      return {
        traceVisibleHeight: Math.max(
          0,
          Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0),
        ),
        coreVisibleHeight: Math.max(
          0,
          Math.min(coreBounds.bottom, innerHeight) - Math.max(coreBounds.top, 0),
        ),
        coreHeight: coreBounds.height,
        scrollY,
      };
    });
  await trace.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    window.scrollTo({ top: scrollY + bounds.top - innerHeight + 1, behavior: 'instant' });
  });
  await painted(page);
  const hiddenFrames = [];
  for (const cursor of [1, 2]) {
    const visibilityBefore = await readVisibility();
    expect(visibilityBefore.traceVisibleHeight).toBeGreaterThan(0);
    expect(visibilityBefore.traceVisibleHeight).toBeLessThanOrEqual(2);
    expect(visibilityBefore.coreVisibleHeight).toBe(0);
    // Keep focus without locator.click/focus causing the browser to scroll the player into view.
    await page.keyboard.press('ArrowRight');
    await expect(controls(page)).toHaveAttribute('data-cursor', String(cursor));
    await expect(trace).toHaveAttribute('data-cursor', String(cursor));
    await painted(page);
    await painted(page);
    const visibilityAfter = await readVisibility();
    expect(visibilityAfter.traceVisibleHeight).toBeGreaterThan(0);
    expect(visibilityAfter.traceVisibleHeight).toBeLessThanOrEqual(2);
    expect(visibilityAfter.coreVisibleHeight).toBe(0);
    await expect(coverage).toHaveAttribute('data-covered', '0');
    hiddenFrames.push({ cursor, visibilityBefore, visibilityAfter, covered: 0 });
  }

  await core.scrollIntoViewIfNeeded();
  await painted(page);
  await painted(page);
  const visible = await readVisibility();
  expect(visible.coreVisibleHeight).toBeGreaterThanOrEqual(
    Math.min(visible.coreHeight, 160) * 0.75,
  );
  // Cursor 2 is now visible, but the missing presented edge 0 -> 1 -> 2 cannot be invented.
  await expect(coverage).toHaveAttribute('data-covered', '0');
  const partial = [];
  for (let cursor = 3; cursor <= run.length; cursor++) {
    await page.keyboard.press('ArrowRight');
    await expect(trace).toHaveAttribute('data-cursor', String(cursor));
    await core.scrollIntoViewIfNeeded();
    await painted(page);
    await expect(coverage).toHaveAttribute('data-covered', String(cursor - 2));
    partial.push({ cursor, covered: cursor - 2 });
  }
  await expect(confirmViewing(page)).toBeDisabled();
  assertNoLearningChange(before, await snapshot(page));
  const incomplete = await coverage.innerText();
  const directory = await evidence(testInfo, 'one-pixel-cannot-complete-viewing', {
    hiddenFrames,
    visible,
    partial,
    incomplete,
  });
  await page.screenshot({ path: join(directory, 'incomplete-before-rewatch.png'), fullPage: true });

  for (let cursor = run.length - 1; cursor >= 0; cursor--) {
    await page.keyboard.press('ArrowLeft');
    await expect(trace).toHaveAttribute('data-cursor', String(cursor));
    await core.scrollIntoViewIfNeeded();
    await painted(page);
    await expect(coverage).toHaveAttribute('data-covered', String(run.length - 2));
  }
  const rewatched = [];
  for (let cursor = 1; cursor <= run.length; cursor++) {
    await page.keyboard.press('ArrowRight');
    await expect(trace).toHaveAttribute('data-cursor', String(cursor));
    await core.scrollIntoViewIfNeeded();
    await painted(page);
    const covered = run.length - 2 + Math.min(cursor, 2);
    await expect(coverage).toHaveAttribute('data-covered', String(covered));
    rewatched.push({ cursor, covered });
  }
  await saveCase(page);
  const saved = await snapshot(page);
  assertRewards(saved, 5);
  expect(saved.receipts.filter((row) => row.eventType === 'case.view-confirmed')).toHaveLength(1);
  await evidence(testInfo, 'one-pixel-requires-visible-adjacent-rewatch', {
    before,
    hiddenFrames,
    partial,
    rewatched,
    saved,
  });
});

test('the reviewed independent case keeps genuine viewing and current history when course reading is unavailable', async ({
  page,
}, testInfo) => {
  await page.route('**/content/reading/course-reading-*.json', (route) => route.abort('failed'));
  await observeCaseSetExecution(page);
  await openCase(page);
  await expect(page.getByText('正式学习未开放，预览不计进度。', { exact: true })).toHaveCount(0);
  await prepareCase(page);
  const run = await runCase(page, testInfo, 'independent-case-with-reading-failure');
  await walk(page, 0, run.length);
  await saveCase(page);
  const saved = await snapshot(page);
  assertRewards(saved, 5);
  await expect(page.locator(`[data-learning-subject="${caseId}"]`)).toContainText('已确认观看');
  await page.reload();
  await expect(casePanel(page)).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  await expect(page.locator(`[data-learning-subject="${caseId}"]`)).toContainText('已确认观看');
  expect(await snapshot(page)).toEqual(saved);
  await evidence(testInfo, 'independent-case-reading-failure-history', saved);
});
