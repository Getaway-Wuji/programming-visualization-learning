import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { decodeC6Response, type C6JudgeRequest } from '../../web/src/engine/c6-protocol';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';
import { installC6Packets, observedC6Packet } from './c6-observation';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import type { C6Attempt, C6CourseActivity, C6CourseDraft } from '../../web/src/c6-learning/model';
import type { GoalTargets, LedgerEntry, StorageSnapshot } from '../../web/src/storage/model';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

const exerciseId = 'exercise.c6.s2.1';
const lessonId = 'lesson.c6.s2.1';
const exercise = (
  JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
    chapters: { exercises: C6CourseExercise[] }[];
  }
).chapters
  .flatMap((c) => c.exercises)
  .find((e) => e.ref.id === exerciseId)!;
const recommended: GoalTargets = { exercise: 1, lesson: 1, case: 0 };
const dailyPolicy = { id: 'reward.policy.daily-goal.p0', version: '1.0.0' };
const contentPolicy = { id: 'reward.policy.p0', version: '1.0.0' };
const firstDay = new Date('2026-10-20T12:00:00.000Z');
const secondDay = new Date('2026-10-21T12:00:00.000Z');
const summary = (page: Page) => page.locator('.c6-home-columns').getByTestId('daily-goal-summary');
const saveStatus = (page: Page) => page.getByTestId('learning-save-status');
const goalDialog = (page: Page) => page.getByRole('dialog', { name: '每日目标', exact: true });
const goalForm = (page: Page) => page.getByTestId('daily-goal-settings');

type CurrentSnapshot = StorageSnapshot & {
  courseActivities: C6CourseActivity[];
  courseDrafts: C6CourseDraft[];
};
/** Native read-only inspection, never an issuer of learning facts or awards. */
async function snapshot(page: Page): Promise<CurrentSnapshot> {
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
      return Object.fromEntries(entries) as unknown as CurrentSnapshot;
    } finally {
      db.close();
    }
  });
}

function dateAt(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function total(data: StorageSnapshot) {
  return data.ledger.reduce((sum, row) => sum + (row.points ?? 0), 0);
}

function dailyAwards(data: StorageSnapshot) {
  return data.ledger.filter((row) => row.sourceId === 'reward.daily-goal.once');
}

function assertPoints(data: CurrentSnapshot, points: number, dailyCount: number) {
  expect(total(data)).toBe(points);
  expect(dailyAwards(data)).toHaveLength(dailyCount);
  for (const award of data.ledger) {
    expect(award.status).toBe('posted');
    if (award.sourceId === 'reward.daily-goal.once') {
      expect(award.points).toBe(5);
      expect(award.policyRef).toEqual(dailyPolicy);
    } else {
      expect(award.policyRef).toEqual(contentPolicy);
      expect(award.points).toBe(
        award.sourceId === 'reward.exercise.first-pass'
          ? 10
          : award.sourceId === 'reward.lesson.first-completion'
            ? 20
            : 5,
      );
    }
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
  const attemptMetadata = (attempt: C6Attempt | null) => {
    if (!attempt) return null;
    const { sourceRevision, sourceSha256, ...summary } = attempt;
    expect(sourceRevision).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/);
    expect(sourceSha256).toBe(createHash('sha256').update(exercise.referenceSource).digest('hex'));
    expect(summary.engineBuildSha256).toBe(engineBuild.wasmSha256);
    expect(summary.profileRef).toEqual(exercise.profileRef);
    return summary;
  };
  expect(data.courseDrafts).toEqual([]);
  const summaries = {
    ...data,
    courseActivities: data.courseActivities.map((row) =>
      row.kind === 'exercise'
        ? {
            ...row,
            firstPass: attemptMetadata(row.firstPass),
            latestAttempt: attemptMetadata(row.latestAttempt),
          }
        : row,
    ),
  };
  expect(keys(summaries).filter((key) => forbidden.includes(key))).toEqual([]);
}

function noLearningChange(before: StorageSnapshot, after: StorageSnapshot) {
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'] as const)
    expect(after[store]).toEqual(before[store]);
}

async function evidence(testInfo: TestInfo, page: Page, label: string, value: unknown) {
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '11.2',
    'browser',
    testInfo.project.name,
    label,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'native-ui.json');
  await writeFile(
    path,
    JSON.stringify(
      {
        browserVersion: page.context().browser()?.version(),
        userAgent: await page.evaluate(() => navigator.userAgent),
        clockScope: 'Only Date is fixed; production performance deadlines and Rust are active.',
        value,
      },
      null,
      2,
    ) + '\n',
  );
  await testInfo.attach(label, { path, contentType: 'application/json' });
  return directory;
}

async function localReady(page: Page) {
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'ready');
}

async function openHome(page: Page) {
  await page.goto('/#/');
  await localReady(page);
  await expect(summary(page)).toBeVisible();
}

async function openGoals(page: Page) {
  await page.goto('/#/?panel=goals');
  await localReady(page);
  await expect(goalDialog(page)).toBeVisible();
  await expect(goalForm(page)).toBeVisible();
}

async function fillTargets(page: Page, targets: GoalTargets) {
  for (const [label, value] of [
    ['每日练习数', targets.exercise],
    ['每日小节数', targets.lesson],
    ['每日案例数', targets.case],
  ] as const)
    await goalForm(page).getByRole('spinbutton', { name: label, exact: true }).fill(String(value));
}

async function saveTargets(page: Page, targets: GoalTargets) {
  await fillTargets(page, targets);
  await goalForm(page).getByRole('button', { name: '保存自定义目标', exact: true }).click();
  await localReady(page);
  await expect(page.getByTestId('goal-template-saved')).toContainText(/后续.*日期/);
}

async function confirmLesson(page: Page, review = false) {
  for (const id of review ? [lessonId] : [lessonId, 'lesson.c6.s2.2.1']) {
    await page.goto(`/#/lessons/${id}`);
    await expect(page.locator('.c6-reading-confirmation')).toBeVisible();
    await localReady(page);
    const before = await snapshot(page);
    await page
      .getByRole('button', { name: review ? '确认今日复习' : '我已读完本节', exact: true })
      .click();
    await expect
      .poll(async () => (await snapshot(page)).receipts.length)
      .toBeGreaterThan(before.receipts.length);
    await localReady(page);
  }
}

async function openPractice(page: Page) {
  await page.goto(`/#/practice/${exerciseId}`);
  await expect(page.getByLabel('完整 C 源码 · main.c', { exact: true })).toBeEditable();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}

async function preparePass(page: Page) {
  await page.getByLabel('完整 C 源码 · main.c', { exact: true }).fill(exercise.referenceSource);
  await expect(page.getByRole('button', { name: '判定全部四组', exact: true })).toBeEnabled();
}

async function submitPrepared(page: Page, saved = true) {
  await page.getByRole('button', { name: '判定全部四组', exact: true }).click();
  await expect(page.getByRole('heading', { name: '四组全部通过', exact: true })).toBeVisible();
  if (saved) {
    await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
  } else
    await expect(
      saveStatus(page).getByRole('button', { name: '重试未保存操作', exact: true }),
    ).toBeVisible();
}

/** Preserve genuine public Worker bytes after the complete submission has settled. */
async function captureRuns(page: Page, testInfo: TestInfo, label: string) {
  const count = await page.evaluate(() => window.c6CurrentPackets.length);
  expect(count).toBeGreaterThanOrEqual(1);
  const captured = [];
  for (let i = 0; i < count; i++) captured.push(await observedC6Packet(page, i));
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '11.2',
    'browser',
    testInfo.project.name,
    label,
    'runs',
  );
  await mkdir(directory, { recursive: true });
  const identities = [];
  for (const [index, worker] of captured.entries()) {
    expect(worker.moduleSeen).toBe(true);
    expect(worker.terminated).toBe(true);
    expect(worker.request).toBeTruthy();
    expect(worker.response).toBeTruthy();
    const requestBytes = Buffer.from(worker.request!, 'base64');
    const resultBytes = Buffer.from(worker.response!, 'base64');
    const request = JSON.parse(requestBytes.toString('utf8')) as C6JudgeRequest;
    expect(request.source).toBe(exercise.referenceSource);
    expect(request.profileRef).toEqual(exercise.profileRef);
    const result = await decodeC6Response(
      Uint8Array.from(resultBytes).buffer,
      request,
      engineBuild.wasmSha256,
    );
    if (!('cases' in result)) throw new Error('Real current four-case judge required');
    expect(result.status).toBe('passed');
    expect(result.cases).toHaveLength(4);
    for (const [i, c] of result.cases.entries()) {
      expect(c.packet.engine.buildId).toBe(engineBuild.wasmSha256);
      expect(c.packet.terminal.status).toBe('completed');
      expect(c.stdoutMatches && c.returnMatches && c.observationMatches).toBe(true);
      const output =
        c.packet.trace!.initialState.output +
        c.packet
          .trace!.steps.flatMap((s) =>
            s.changes.flatMap((c) => (c.op === 'output' ? [c.append] : [])),
          )
          .join('');
      expect(output).toBe(exercise.tests[i].expectedStdout);
    }
    const prefix = `${String(index + 1).padStart(2, '0')}-${request.runId}`;
    await writeFile(join(directory, `${prefix}.request.json`), requestBytes);
    await writeFile(join(directory, `${prefix}.result.json`), resultBytes);
    identities.push({
      runId: request.runId,
      profileRef: request.profileRef,
      sourceRevision: request.sourceRevision,
      sourceSha256: request.sourceSha256,
    });
  }
  return identities;
}

async function completeFirstLesson(page: Page, testInfo: TestInfo, label: string) {
  await confirmLesson(page);
  await openPractice(page);
  await preparePass(page);
  await submitPrepared(page);
  return captureRuns(page, testInfo, label);
}

interface DailyLedgerFault {
  armed: boolean;
  attempted: LedgerEntry[];
}

/** Native quota fault only; all facts still come from the real Rust submission. */
async function installDailyQuota(page: Page) {
  await page.addInitScript(() => {
    const state: DailyLedgerFault = { armed: false, attempted: [] };
    Object.assign(window, { __dailyLedgerFault: state });
    for (const method of ['add', 'put'] as const) {
      const native = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (value, key) {
        if (this.name === 'ledger' && state.armed) {
          state.attempted.push(structuredClone(value as LedgerEntry));
          if ((value as LedgerEntry).sourceId === 'reward.daily-goal.once') {
            state.armed = false;
            throw new DOMException(
              'Isolated daily award native write failure',
              'QuotaExceededError',
            );
          }
        }
        return key === undefined ? native.call(this, value) : native.call(this, value, key);
      };
    }
  });
}

test('recommended preview is durable without opening a day; real learning achieves 35 and same-day template edits cannot re-award', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await page.addInitScript(installC6Packets);
  await openHome(page);
  await expect(summary(page)).toHaveAttribute('data-goal-state', 'preview');
  const initial = await snapshot(page);
  expect(initial.settings.goalTemplate).toEqual({ revision: 1, targets: recommended });
  expect(initial.goals).toEqual([]);
  expect(initial.progress).toEqual([]);
  expect(initial.dailyFacts).toEqual([]);
  expect(initial.receipts).toEqual([]);
  await page.reload();
  await localReady(page);
  await expect(summary(page)).toHaveAttribute('data-goal-state', 'preview');
  expect(await snapshot(page)).toEqual(initial);
  await openGoals(page);
  for (const invalid of [
    { exercise: 0, lesson: 0, case: 0 },
    { exercise: 33, lesson: 0, case: 0 },
    { exercise: 0, lesson: 0, case: 8 },
  ]) {
    await fillTargets(page, invalid);
    await expect(
      goalForm(page).getByRole('button', { name: '保存自定义目标', exact: true }),
    ).toBeDisabled();
    expect(await snapshot(page)).toEqual(initial);
  }
  await goalDialog(page).getByRole('button', { name: '使用推荐目标', exact: true }).click();
  await localReady(page);
  expect(await snapshot(page)).toEqual(initial);
  const runs = await completeFirstLesson(page, testInfo, 'first-completion');
  const achieved = await snapshot(page);
  assertPoints(achieved, 35, 1);
  expect(achieved.goals).toHaveLength(1);
  expect(achieved.goals[0].targets).toEqual(recommended);
  expect(achieved.goals[0].goalVersion).toBe(1);
  const pass = achieved.receipts.find((row) => row.eventType === 'exercise.passed')!;
  expect(achieved.goals[0].achievedAt).toBe(pass.occurredAt);
  expect(dailyAwards(achieved)[0].occurredAt).toBe(pass.occurredAt);
  expect(achieved.dailyFacts).toHaveLength(3);
  await openHome(page);
  await expect(summary(page)).toHaveAttribute('data-goal-state', 'achieved');
  await expect(summary(page)).toHaveAttribute('data-local-date', pass.localDate);
  await openGoals(page);
  await saveTargets(page, { exercise: 2, lesson: 0, case: 0 });
  const customized = await snapshot(page);
  expect(customized.settings.goalTemplate?.targets).toEqual({ exercise: 2, lesson: 0, case: 0 });
  noLearningChange(achieved, customized);
  await goalDialog(page).getByRole('button', { name: '使用推荐目标', exact: true }).click();
  await localReady(page);
  const restored = await snapshot(page);
  expect(restored.settings.goalTemplate?.targets).toEqual(recommended);
  noLearningChange(achieved, restored);
  const directory = await evidence(testInfo, page, 'first-completion', {
    initial,
    achieved,
    customized,
    restored,
    runs,
  });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await goalDialog(page).evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      width: innerWidth,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
    await page.screenshot({ path: join(directory, `goal-settings-${width}.png`), fullPage: true });
    if (width === 390) {
      const save = goalForm(page).getByRole('button', { name: '保存自定义目标', exact: true });
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeVisible();
      const button = await save.boundingBox();
      expect(button!.y).toBeGreaterThanOrEqual(0);
      expect(button!.y + button!.height).toBeLessThanOrEqual(900);
      await page.screenshot({
        path: join(directory, 'goal-settings-390-actions.png'),
        fullPage: true,
      });
    }
  }
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(restored);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPractice(page);
  await preparePass(page);
  await submitPrepared(page);
  const repeated = await snapshot(page);
  assertPoints(repeated, 35, 1);
  for (const store of ['ledger', 'dailyFacts', 'goals'] as const)
    expect(repeated[store]).toEqual(restored[store]);
  const repeatedRuns = await captureRuns(page, testInfo, 'same-day-repeat');
  await evidence(testInfo, page, 'same-day-repeat', { restored, repeated, repeatedRuns });
});

test('a new local day needs fresh active review and a real repeat pass; refresh and history do not manufacture a check-in', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await page.addInitScript(installC6Packets);
  await openHome(page);
  const firstRuns = await completeFirstLesson(page, testInfo, 'cross-day-first');
  const first = await snapshot(page);
  assertPoints(first, 35, 1);
  await openHome(page);
  await page.clock.setFixedTime(secondDay);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(summary(page)).toHaveAttribute(
    'data-local-date',
    dateAt(secondDay, first.meta.timeZone),
  );
  await expect(summary(page)).toHaveAttribute('data-goal-state', 'preview');
  noLearningChange(first, await snapshot(page));
  await page.reload();
  await localReady(page);
  await expect(summary(page)).toHaveAttribute('data-goal-state', 'preview');
  noLearningChange(first, await snapshot(page));
  await confirmLesson(page, true);
  const reviewed = await snapshot(page);
  assertPoints(reviewed, 35, 1);
  expect(reviewed.goals).toHaveLength(2);
  const today = dateAt(secondDay, first.meta.timeZone);
  expect(reviewed.goals.find((row) => row.localDate === today)?.achievedAt).toBeNull();
  expect(reviewed.dailyFacts.filter((row) => row.localDate === today)).toHaveLength(1);
  await openPractice(page);
  await preparePass(page);
  await submitPrepared(page);
  const secondRuns = await captureRuns(page, testInfo, 'cross-day-second');
  const second = await snapshot(page);
  assertPoints(second, 40, 2);
  expect(second.goals.every((row) => row.achievedAt !== null)).toBe(true);
  expect(second.dailyFacts).toHaveLength(5);
  expect(second.ledger.filter((row) => row.sourceId !== 'reward.daily-goal.once')).toEqual(
    first.ledger.filter((row) => row.sourceId !== 'reward.daily-goal.once'),
  );
  await page.goto('/#/?panel=history');
  await expect(page.getByTestId('goal-history')).toContainText(today);
  await expect(page.getByTestId('goal-history')).toContainText(first.goals[0].localDate);
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(second);
  await evidence(testInfo, page, 'cross-day-new-facts-only', {
    first,
    reviewed,
    second,
    firstRuns,
    secondRuns,
  });
});

test('two real tabs passing the same exercise share one daily award and one set of daily facts', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await page.addInitScript(installC6Packets);
  await confirmLesson(page);
  const other = await context.newPage();
  await other.clock.setFixedTime(firstDay);
  await other.addInitScript(installC6Packets);
  for (const target of [page, other]) {
    await openPractice(target);
    await preparePass(target);
  }
  await Promise.all([submitPrepared(page), submitPrepared(other)]);
  const merged = await snapshot(page);
  assertPoints(merged, 35, 1);
  expect(merged.dailyFacts).toHaveLength(3);
  expect(merged.goals).toHaveLength(1);
  expect(merged.receipts.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(2);
  expect(new Set(merged.receipts.map((row) => row.eventId)).size).toBe(merged.receipts.length);
  const a = await captureRuns(page, testInfo, 'concurrent-a');
  const b = await captureRuns(other, testInfo, 'concurrent-b');
  await evidence(testInfo, page, 'concurrent-one-daily-award', { merged, a, b });
});

test('two open goal forms detect a stale template revision and preserve the winning draft', async ({
  page,
  context,
}, testInfo) => {
  await page.clock.setFixedTime(firstDay);
  await openGoals(page);
  const other = await context.newPage();
  await other.clock.setFixedTime(firstDay);
  await openGoals(other);
  const before = await snapshot(page);
  const targets = [
    { exercise: 2, lesson: 0, case: 0 },
    { exercise: 0, lesson: 2, case: 0 },
  ];
  await fillTargets(page, targets[0]);
  await fillTargets(other, targets[1]);
  await Promise.all(
    [page, other].map((target) =>
      goalForm(target).getByRole('button', { name: '保存自定义目标', exact: true }).click(),
    ),
  );
  await expect
    .poll(async () => {
      const states = await Promise.all(
        [page, other].map((target) => saveStatus(target).getAttribute('data-save-status')),
      );
      return states.filter((value) => value === 'conflict').length;
    })
    .toBe(1);
  const saved = await snapshot(page);
  expect(saved.settings.goalTemplate?.revision).toBe(before.settings.goalTemplate!.revision + 1);
  expect(targets).toContainEqual(saved.settings.goalTemplate?.targets);
  noLearningChange(before, saved);
  const states = await Promise.all(
    [page, other].map(async (target) => ({
      status: await saveStatus(target).getAttribute('data-save-status'),
      form: await goalForm(target).innerText(),
    })),
  );
  await evidence(testInfo, page, 'template-native-cas-conflict', { before, saved, states });
});

test('a native daily-award failure aborts the whole pass and retry after midnight preserves the original date and time', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await installDailyQuota(page);
  await page.addInitScript(installC6Packets);
  await confirmLesson(page);
  const before = await snapshot(page);
  await openPractice(page);
  await preparePass(page);
  await page.evaluate(() => {
    (window as unknown as { __dailyLedgerFault: DailyLedgerFault }).__dailyLedgerFault.armed = true;
  });
  await submitPrepared(page, false);
  await expect(saveStatus(page)).toHaveAttribute('data-save-status', 'unsaved');
  const failed = await snapshot(page);
  noLearningChange(before, failed);
  const attempted = await page.evaluate(
    () =>
      (window as unknown as { __dailyLedgerFault: DailyLedgerFault }).__dailyLedgerFault.attempted,
  );
  expect(attempted.map((row) => row.sourceId)).toEqual([
    'reward.exercise.first-pass',
    'reward.lesson.first-completion',
    'reward.daily-goal.once',
  ]);
  const runs = await captureRuns(page, testInfo, 'quota-original-submission');
  await page.clock.setFixedTime(secondDay);
  await page.goto('/#/');
  await saveStatus(page).getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await localReady(page);
  const retried = await snapshot(page);
  assertPoints(retried, 35, 1);
  expect([...retried.ledger].sort((a, b) => a.sourceId.localeCompare(b.sourceId))).toEqual(
    [...attempted].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  );
  expect(retried.goals).toHaveLength(1);
  const pass = retried.receipts.find((row) => row.eventType === 'exercise.passed')!;
  expect(pass.localDate).toBe(dateAt(firstDay, before.meta.timeZone));
  expect(pass.occurredAt).toBe(firstDay.toISOString());
  expect(retried.goals[0].achievedAt).toBe(firstDay.toISOString());
  expect(retried.dailyFacts.every((row) => row.localDate === pass.localDate)).toBe(true);
  expect(await page.evaluate(() => window.c6CurrentPackets.length)).toBe(1);
  await openHome(page);
  await expect(summary(page)).toHaveAttribute('data-goal-state', 'preview');
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(retried);
  await evidence(testInfo, page, 'quota-original-date-retry', {
    before,
    failed,
    attempted,
    retried,
    runs,
  });
});

test('an explicit engineering null-day shape stays immutable; real learning counts and only a new configured day earns a daily award', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await page.addInitScript(installC6Packets);
  await openHome(page);
  const initialized = await snapshot(page);
  const legacyDate = dateAt(firstDay, initialized.meta.timeZone);
  // Compatibility shape only: no synthetic progress, passed event, receipt or reward is seeded.
  // This is explicitly not evidence of running the historical engineering application.
  await page.evaluate(
    async ({ localDate, generation }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = db.transaction(['meta', 'goals'], 'readwrite');
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        const meta = tx.objectStore('meta');
        const request = meta.get('current');
        request.onsuccess = () => {
          if (request.result.generation !== generation) return tx.abort();
          meta.put({ ...request.result, revision: request.result.revision + 1 }, 'current');
          tx.objectStore('goals').add(
            { localDate, goalVersion: 1, targets: null, achievedAt: null },
            [generation, localDate],
          );
        };
        await done;
      } finally {
        db.close();
      }
    },
    { localDate: legacyDate, generation: initialized.meta.generation },
  );
  await page.reload();
  await localReady(page);
  await expect(summary(page)).toHaveAttribute('data-goal-state', 'legacy');
  const legacy = await snapshot(page);
  await completeFirstLesson(page, testInfo, 'legacy-real-course-completion');
  const completed = await snapshot(page);
  assertPoints(completed, 30, 0);
  expect(completed.goals).toEqual(legacy.goals);
  await openGoals(page);
  await saveTargets(page, { exercise: 1, lesson: 0, case: 0 });
  expect((await snapshot(page)).goals).toEqual(legacy.goals);
  await page.clock.setFixedTime(secondDay);
  await openPractice(page);
  await preparePass(page);
  await submitPrepared(page);
  const runs = await captureRuns(page, testInfo, 'legacy-following-configured-day');
  const next = await snapshot(page);
  assertPoints(next, 35, 1);
  expect(next.goals.find((row) => row.localDate === legacyDate)).toEqual(legacy.goals[0]);
  expect(next.goals.find((row) => row.localDate !== legacyDate)?.targets).toEqual({
    exercise: 1,
    lesson: 0,
    case: 0,
  });
  await evidence(testInfo, page, 'legacy-null-immutable', {
    fixtureScope:
      'explicit native engineering null-day compatibility shape; no learning facts were seeded',
    initialized,
    legacy,
    completed,
    next,
    runs,
  });
});

test('clearing creates a new generation with a valid recommended template and refresh keeps it unopened', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await page.addInitScript(installC6Packets);
  await openHome(page);
  await completeFirstLesson(page, testInfo, 'before-clear-real-completion');
  await openGoals(page);
  await saveTargets(page, { exercise: 0, lesson: 0, case: 2 });
  const before = await snapshot(page);
  await page.goto('/#/settings?panel=data');
  await localReady(page);
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(saveStatus(page)).toContainText('本地数据已清除');
  await openHome(page);
  await expect(summary(page)).toHaveAttribute('data-goal-state', 'preview');
  const cleared = await snapshot(page);
  expect(cleared.meta.generation).not.toBe(before.meta.generation);
  expect(cleared.settings.goalTemplate).toEqual({ revision: 1, targets: recommended });
  for (const store of ['progress', 'dailyFacts', 'goals', 'ledger', 'receipts'] as const)
    expect(cleared[store]).toEqual([]);
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(cleared);
  await evidence(testInfo, page, 'clear-new-valid-template', { before, cleared });
});

test('a reachable custom case-only goal requires genuine adjacent viewing and active confirmation before its ten points are saved', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await observeCaseSetExecution(page);
  await openGoals(page);
  await saveTargets(page, { exercise: 0, lesson: 0, case: 1 });
  const configured = await snapshot(page);
  expect(configured.goals).toEqual([]);
  expect(configured.settings.goalTemplate?.targets).toEqual({ exercise: 0, lesson: 0, case: 1 });
  const caseId = 'case.c.assignment';
  await page.goto(`/#/visualize/${caseId}`);
  const casePanel = page.getByTestId('case-execution');
  const confirmation = page.getByTestId('case-view-confirmation');
  const confirmViewing = confirmation.getByRole('button', { name: '确认已观看', exact: true });
  await expect(casePanel).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  await page.getByTestId('input-field-x').fill('-7');
  await casePanel.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(casePanel).toHaveAttribute('data-state', 'ready');
  await casePanel.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(casePanel).toHaveAttribute('data-state', 'completed');
  const worker = await observedCaseSetExecute(page);
  expect(worker.moduleSeen).toBe(true);
  expect(worker.terminated).toBe(true);
  expect(worker.responseOk).toBe(true);
  const requestBytes = Buffer.from(worker.requestBytes!);
  const resultBytes = Buffer.from(worker.responseBytes!);
  const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(resultBytes).buffer, request);
  expect(request.mode).toBe('case');
  expect(request.subjectRef?.id).toBe(caseId);
  expect(result.producer).toBe('rust');
  expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
  expect(result.trace?.completeness).toBe('complete');
  expect(request.source.text).toBe(
    await casePanel.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }).inputValue(),
  );
  const length = result.trace!.steps.length;
  expect(length).toBe(6);
  const controls = page.getByTestId('player-controls');
  await page.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
  const trace = page.getByTestId('trace-view');
  const core = trace.locator('[aria-label="当前变量"]');
  const coverage = page.getByTestId('case-view-coverage');
  const presented = async () => {
    await core.scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  };
  await expect(controls).toHaveAttribute('data-cursor', '0');
  await expect(coverage).toHaveAttribute('data-total', String(length));
  await presented();
  const cursors = [0];
  for (let cursor = 1; cursor <= length; cursor++) {
    await expect(confirmViewing).toBeDisabled();
    await controls.getByRole('button', { name: '前进', exact: true }).click();
    await expect(controls).toHaveAttribute('data-cursor', String(cursor));
    await expect(trace).toHaveAttribute('data-cursor', String(cursor));
    await presented();
    await expect(coverage).toHaveAttribute('data-covered', String(cursor));
    cursors.push(cursor);
  }
  await expect(confirmation).toHaveAttribute('data-view-state', 'ready');
  const watched = await snapshot(page);
  noLearningChange(configured, watched);
  assertPoints(watched, 0, 0);
  await confirmViewing.click();
  await expect(confirmation).toHaveAttribute('data-view-state', 'saved');
  await localReady(page);
  const saved = await snapshot(page);
  assertPoints(saved, 10, 1);
  expect(saved.dailyFacts).toHaveLength(1);
  expect(saved.dailyFacts[0].eventType).toBe('case.view-confirmed');
  expect(saved.progress).toHaveLength(1);
  expect(saved.progress[0].eventType).toBe('case.view-confirmed');
  expect(saved.receipts).toHaveLength(1);
  expect(saved.goals).toHaveLength(1);
  expect(saved.goals[0].targets).toEqual({ exercise: 0, lesson: 0, case: 1 });
  expect(saved.goals[0].achievedAt).toBe(saved.receipts[0].occurredAt);
  const directory = await evidence(testInfo, page, 'custom-case-only-real-viewing', {
    configured,
    watched,
    saved,
    adjacentPresentedCursors: cursors,
    requestIdentity: request.identity,
    terminal: result.terminal,
  });
  await writeFile(join(directory, 'request.json'), requestBytes);
  await writeFile(join(directory, 'result.json'), resultBytes);
  await writeFile(join(directory, 'catalog.json'), worker.catalogJson!);
  await openHome(page);
  await expect(summary(page)).toHaveAttribute('data-goal-state', 'achieved');
  await expect(summary(page).getByTestId('goal-progress-case')).toContainText('1 / 1');
  await page.reload();
  await localReady(page);
  expect(await snapshot(page)).toEqual(saved);
});
