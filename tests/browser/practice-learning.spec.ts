import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { ExerciseEntity, LessonEntity } from '../../web/src/content/types';
import type { Receipt, StorageSnapshot } from '../../web/src/storage/model';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { correctStarter, wrongEcho, blockWorkspace } from './block-ui';
import { observeCaseSetExecution } from './case-set-observation';

const reviewed = JSON.parse(
  readFileSync(new URL('../../content/c/p0/course-1.0.1.json', import.meta.url), 'utf8'),
) as {
  lessons: LessonEntity[];
  exercises: ExerciseEntity[];
};
const panel = (page: Page) => page.getByTestId('practice-execution');
const saveStatus = (page: Page) => page.getByTestId('learning-save-status');
const practicePath = (id: string) => `/#/practice/${encodeURIComponent(id)}`;
const lessonPath = (id: string) => `/#/lessons/${encodeURIComponent(id)}`;
const authorization = '**/content/learning/course-learning-*.json';

/** Read-only native inspection. No progress, receipt, reward or result is seeded. */
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
async function localReady(page: Page) {
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'ready');
}
async function openLesson(page: Page, id: string) {
  await page.goto(lessonPath(id));
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await localReady(page);
}
async function confirm(page: Page) {
  await page.getByRole('button', { name: /^(确认已学习|确认今日复习)$/ }).click();
  await localReady(page);
  await expect(page.getByTestId('lesson-progress')).toContainText(/已确认学习|小节已完成/);
}
async function openPractice(page: Page, id: string) {
  await page.goto(practicePath(id));
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(blockWorkspace(page)).toBeVisible();
  await localReady(page);
}
async function prepare(page: Page) {
  await panel(page).getByRole('button', { name: '准备代码', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
}
async function submit(page: Page, expected: 'passed' | 'unmet' = 'passed') {
  await prepare(page);
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', expected);
}
async function savedPass(page: Page) {
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await localReady(page);
}
async function clear(page: Page) {
  await page.goto('/#/settings?panel=data');
  await localReady(page);
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(saveStatus(page)).toContainText('本地数据已清除');
}
async function executeCount(page: Page) {
  return page.evaluate(
    () => window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
  );
}
function privateFields(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...privateFields(child)]);
}
function noExecutionPersistence(data: StorageSnapshot) {
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
  expect(privateFields(data).filter((key) => forbidden.includes(key))).toEqual([]);
  expect(
    data.ledger.every(
      (row) =>
        row.status === 'posted' &&
        row.points ===
          (row.sourceId === 'reward.exercise.first-pass'
            ? 10
            : row.sourceId === 'reward.lesson.first-completion'
              ? 20
              : row.sourceId === 'reward.daily-goal.once'
                ? 5
                : Number.NaN) &&
        row.policyRef.id ===
          (row.sourceId === 'reward.daily-goal.once'
            ? 'reward.policy.daily-goal.p0'
            : 'reward.policy.p0') &&
        row.policyRef.version === '1.0.0',
    ),
  ).toBe(true);
  const targets = { exercise: 1, lesson: 1, case: 0 };
  expect(data.settings.goalTemplate).toEqual({ revision: 1, targets });
  for (const goal of data.goals) {
    expect(goal).toMatchObject({ goalVersion: 1, targets });
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
}
async function evidence(testInfo: TestInfo, label: string, value: unknown) {
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '11.2',
    'regression',
    'practice-learning',
    testInfo.project.name,
    label,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'native-ui.json');
  await writeFile(path, JSON.stringify(value, null, 2));
  await testInfo.attach(label, { path, contentType: 'application/json' });
}
async function captureAllRuns(page: Page, testInfo: TestInfo) {
  // Convert captured raw buffers only after all final result/deadline guards and saves settle.
  const captured = await page.evaluate(() =>
    window.__verticalObservation.workers
      .filter((worker) => worker.kind === 'execute')
      .map((worker) => {
        const encoded = (
          worker as typeof worker & {
            captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
          }
        ).captureEncoded();
        return { ...encoded, catalogJson: worker.catalogJson, moduleSeen: worker.moduleSeen };
      }),
  );
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '11.2',
    'regression',
    'practice-learning',
    testInfo.project.name,
    'six-lessons-24-groups',
    'runs',
  );
  await mkdir(directory, { recursive: true });
  const identities = [];
  for (const [index, entry] of captured.entries()) {
    expect(entry.moduleSeen).toBe(true);
    expect(entry.requestBase64).toBeTruthy();
    expect(entry.responseBase64).toBeTruthy();
    const requestBytes = Buffer.from(entry.requestBase64!, 'base64');
    const resultBytes = Buffer.from(entry.responseBase64!, 'base64');
    const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
    const result = await decodeResult(Uint8Array.from(resultBytes).buffer, request);
    expect(result.producer).toBe('rust');
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
    expect(result.judgeResult?.status).toBe('met');
    expect(request.mode).toBe('exercise-test');
    expect(request.remainingMs).toBeGreaterThan(0);
    expect(request.remainingMs).toBeLessThanOrEqual(1000);
    const prefix = `${String(index + 1).padStart(2, '0')}-${request.identity.testCaseKey}`;
    await writeFile(join(directory, `${prefix}.request.json`), requestBytes);
    await writeFile(join(directory, `${prefix}.result.json`), resultBytes);
    await writeFile(join(directory, `${prefix}.catalog.json`), entry.catalogJson!);
    identities.push({ subjectRef: request.subjectRef, identity: request.identity });
  }
  return identities;
}

test('a new local archive completes six lessons through native block edits, 24 real groups, review, course return and readonly refresh', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await observeCaseSetExecution(page);
  await page.goto('/#/courses');
  await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  const initial = await snapshot(page);
  expect(initial.progress).toEqual([]);
  expect(initial.receipts).toEqual([]);
  const states = [];
  for (const lesson of reviewed.lessons) {
    const exercise = reviewed.exercises.find(
      (entry) => entry.id === lesson.requiredExerciseRefs[0].id,
    )!;
    await openLesson(page, lesson.id);
    await confirm(page);
    const link = page.getByRole('link', { name: '进入练习工作区', exact: true });
    await expect(link).toHaveAttribute('href', `#/practice/${exercise.id}`);
    await link.click();
    await expect(panel(page)).toHaveAttribute('data-state', 'ready');
    await expect(blockWorkspace(page)).toBeVisible();
    await correctStarter(page, exercise.id);
    await submit(page);
    await savedPass(page);
    const executionCount = await executeCount(page);
    const controls = page.getByTestId('player-controls');
    await controls.getByRole('combobox', { name: '播放速度', exact: true }).selectOption('4');
    await controls.getByRole('button', { name: '播放', exact: true }).click();
    await expect
      .poll(async () => Number(await controls.getAttribute('data-cursor')))
      .toBeGreaterThan(0);
    const pause = controls.getByRole('button', { name: '暂停', exact: true });
    if (await pause.count()) await pause.click();
    const cursor = await controls.getAttribute('data-cursor');
    await panel(page).getByRole('link', { name: '查看本次复盘', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/practice/${exercise.id}/review$`));
    await expect(controls).toHaveAttribute('data-cursor', cursor!);
    expect(await executeCount(page)).toBe(executionCount);
    await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
    await expect(controls).toHaveAttribute('data-cursor', cursor!);
    expect(await executeCount(page)).toBe(executionCount);
    await page.getByRole('link', { name: '返回本节学习', exact: true }).click();
    await expect(page.getByTestId('lesson-progress')).toContainText('小节已完成');
    const current = await snapshot(page);
    noExecutionPersistence(current);
    states.push(current);
  }
  const runs = await captureAllRuns(page, testInfo);
  expect(runs).toHaveLength(24);
  for (const exercise of reviewed.exercises)
    expect(
      runs
        .filter((run) => run.subjectRef?.id === exercise.id)
        .map((run) => run.identity.testCaseKey),
    ).toEqual(exercise.tests.map((entry) => entry.caseKey));
  const finished = await snapshot(page);
  expect(finished.progress).toHaveLength(24);
  expect(finished.receipts).toHaveLength(18);
  expect(finished.ledger).toHaveLength(13);
  expect(finished.ledger.reduce((sum, entry) => sum + (entry.points ?? 0), 0)).toBe(185);
  expect(finished.dailyFacts).toHaveLength(12);
  expect(new Set(finished.receipts.map((row) => row.eventId)).size).toBe(18);
  expect(finished.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(6);
  await page.goto('/#/courses');
  for (const lesson of reviewed.lessons)
    await expect(page.locator(`[data-course-lesson="${lesson.id}"]`)).toContainText('小节已完成');
  await page.reload();
  await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  expect(await snapshot(page)).toEqual(finished);
  await openPractice(page, reviewed.exercises[0].id);
  await expect(page.locator(`[data-learning-subject="${reviewed.exercises[0].id}"]`)).toContainText(
    '练习已通过',
  );
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(finished);
  await evidence(testInfo, 'six-lessons-24-groups', { initial, states, finished, runs });
});

test('passing before study confirmation stays incomplete; later failures preserve history and repeated real passes deduplicate rights', async ({
  page,
}, testInfo) => {
  const exercise = reviewed.exercises[0],
    lesson = reviewed.lessons[0];
  await openPractice(page, exercise.id);
  await correctStarter(page, exercise.id);
  await submit(page);
  await savedPass(page);
  const passed = await snapshot(page);
  expect(passed.progress.map((row) => row.eventType)).toEqual(['exercise.passed']);
  await page.getByRole('link', { name: '返回本节学习', exact: true }).click();
  await expect(page.getByTestId('lesson-progress')).not.toContainText('小节已完成');
  await confirm(page);
  await expect(page.getByTestId('lesson-progress')).toContainText('小节已完成');
  const complete = await snapshot(page);
  await page.getByRole('link', { name: '进入练习工作区', exact: true }).click();
  await expect(blockWorkspace(page)).toBeVisible();
  await submit(page, 'unmet');
  expect(await snapshot(page)).toEqual(complete);
  await correctStarter(page, exercise.id);
  await submit(page);
  await savedPass(page);
  const repeated = await snapshot(page);
  expect(repeated.ledger).toEqual(complete.ledger);
  expect(repeated.dailyFacts).toEqual(complete.dailyFacts);
  expect(repeated.receipts.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(2);
  expect(repeated.progress.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(1);
  expect(repeated.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(1);
  expect(
    repeated.progress.some(
      (row) => row.subjectRef.id === lesson.id && row.eventType === 'lesson.completed',
    ),
  ).toBe(true);
  noExecutionPersistence(repeated);
  await evidence(testInfo, 'pass-confirm-repeat', { passed, complete, repeated });
});

interface SaveFault {
  armed: boolean;
  attempted: Receipt[];
}
async function installPassQuota(page: Page) {
  await page.addInitScript(() => {
    const state: SaveFault = { armed: false, attempted: [] };
    Object.assign(window, { __practiceSaveFault: state });
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (
        this.name === 'receipts' &&
        (value as { eventType?: string })?.eventType === 'exercise.passed'
      ) {
        state.attempted.push(structuredClone(value as Receipt));
        if (state.armed) {
          state.armed = false;
          throw new DOMException('Isolated practice receipt failure', 'QuotaExceededError');
        }
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
}
const fault = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __practiceSaveFault: SaveFault }).__practiceSaveFault,
  );
const armFault = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __practiceSaveFault: SaveFault }).__practiceSaveFault.armed = true;
  });

test('a native quota abort saves no partial pass and retries the original accepted event after editing and leaving the workspace', async ({
  page,
}, testInfo) => {
  await installPassQuota(page);
  const exercise = reviewed.exercises[0];
  await openLesson(page, reviewed.lessons[0].id);
  await confirm(page);
  const before = await snapshot(page);
  await page.getByRole('link', { name: '进入练习工作区', exact: true }).click();
  await expect(blockWorkspace(page)).toBeVisible();
  await correctStarter(page, exercise.id);
  await armFault(page);
  await submit(page);
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
    'data-save-state',
    'unsaved',
  );
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  const failed = await snapshot(page);
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(failed[store]).toEqual(before[store]);
  const original = (await fault(page)).attempted[0];
  expect(original.eventType).toBe('exercise.passed');
  await wrongEcho(page);
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await page.goto('/#/courses');
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  await saveStatus(page).getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await localReady(page);
  await expect(saveStatus(page).getByText('已保存', { exact: true })).toBeVisible();
  const retried = await snapshot(page);
  const received = retried.receipts.find((row) => row.eventType === 'exercise.passed')!;
  const originalSummary: Partial<Receipt> = { ...original };
  const receivedSummary: Partial<Receipt> = { ...received };
  delete originalSummary.committedRevision;
  delete receivedSummary.committedRevision;
  expect(receivedSummary).toEqual(originalSummary);
  expect(retried.ledger).toHaveLength(3);
  expect(retried.dailyFacts).toHaveLength(2);
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(retried);
  noExecutionPersistence(retried);
  await evidence(testInfo, 'native-quota-original-retry', { before, failed, original, retried });
});

test('cross-page clear removes real saved history and a pending accepted retry without revival', async ({
  page,
  context,
}, testInfo) => {
  await installPassQuota(page);
  const exercise = reviewed.exercises[0];
  await openLesson(page, reviewed.lessons[0].id);
  await confirm(page);
  await page.getByRole('link', { name: '进入练习工作区', exact: true }).click();
  await expect(blockWorkspace(page)).toBeVisible();
  await correctStarter(page, exercise.id);
  await submit(page);
  await savedPass(page);
  const saved = await snapshot(page);
  await armFault(page);
  await submit(page);
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  const settings = await context.newPage();
  await clear(settings);
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await expect(
    saveStatus(page).getByRole('button', { name: '重试未保存操作', exact: true }),
  ).toHaveCount(0);
  const cleared = await snapshot(page);
  expect(cleared.meta.generation).not.toBe(saved.meta.generation);
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(cleared[store]).toEqual([]);
  await page.reload();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  expect(await snapshot(page)).toEqual(cleared);
  await evidence(testInfo, 'native-clear-real-history-and-pending', { saved, cleared });
});

test('missing practice learning authorization keeps successful judgement temporary and explicit recovery requires a fresh accepted submission', async ({
  page,
}, testInfo) => {
  await page.route(authorization, (route) =>
    route.fulfill({ status: 503, body: 'isolated missing authorization' }),
  );
  await openPractice(page, reviewed.exercises[0].id);
  const before = await snapshot(page);
  await expect(page.getByTestId('practice-learning-unavailable')).toBeVisible();
  await correctStarter(page, reviewed.exercises[0].id);
  await submit(page);
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
    'data-save-state',
    'unavailable',
  );
  expect(await snapshot(page)).toEqual(before);
  await page.unroute(authorization);
  await page
    .getByTestId('practice-learning-unavailable')
    .getByRole('button', { name: '重试读取学习授权', exact: true })
    .click();
  await expect(page.getByTestId('practice-learning-unavailable')).toHaveCount(0);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await correctStarter(page, reviewed.exercises[0].id);
  await submit(page);
  await savedPass(page);
  const recovered = await snapshot(page);
  expect(recovered.progress.map((row) => row.eventType)).toEqual(['exercise.passed']);
  noExecutionPersistence(recovered);
  await evidence(testInfo, 'authorization-fail-closed-and-recovery', { before, recovered });
});

test('two production pages passing the same exercise merge their receipts and share one first right and daily fact', async ({
  page,
  context,
}, testInfo) => {
  const exercise = reviewed.exercises[0];
  const other = await context.newPage();
  await openPractice(page, exercise.id);
  await correctStarter(page, exercise.id);
  await prepare(page);
  await openPractice(other, exercise.id);
  await correctStarter(other, exercise.id);
  await prepare(other);
  await Promise.all([
    panel(page).getByRole('button', { name: '提交练习', exact: true }).click(),
    panel(other).getByRole('button', { name: '提交练习', exact: true }).click(),
  ]);
  await savedPass(page);
  await savedPass(other);
  const merged = await snapshot(page);
  expect(merged.receipts).toHaveLength(2);
  expect(new Set(merged.receipts.map((row) => row.eventId)).size).toBe(2);
  expect(merged.progress).toHaveLength(1);
  expect(merged.dailyFacts).toHaveLength(1);
  expect(merged.ledger).toHaveLength(1);
  expect(merged.progress[0].eventType).toBe('exercise.passed');
  noExecutionPersistence(merged);
  await evidence(testInfo, 'native-concurrent-same-exercise', merged);
});
