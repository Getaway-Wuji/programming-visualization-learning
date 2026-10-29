import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ExerciseEntity, LessonEntity } from '../../web/src/content/types';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { blockWorkspace, correctStarter, showPracticeBlocks } from './block-ui';
import { observeCaseSetExecution } from './case-set-observation';

// Expectations come from the reviewed source. The browser receives only the
// actual published reading, practice, learning, and Rust/WASM resources.
const reviewed = JSON.parse(
  readFileSync(new URL('../../content/c/p0/course-1.0.1.json', import.meta.url), 'utf8'),
) as { lessons: LessonEntity[]; exercises: ExerciseEntity[] };
const caseId = 'case.c.assignment';
const targets = { exercise: 6, lesson: 6, case: 1 };
const avatar = { presetId: 'avatar.basic.04', accentColor: '#4466CC' };
const practice = (page: Page) => page.getByTestId('practice-execution');
const controls = (page: Page) => page.getByTestId('player-controls');
const source = (page: Page) =>
  page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** The database is inspected with readonly transactions, never populated by this test. */
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
      const rows = await Promise.all(
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
      return Object.fromEntries(rows) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}

async function localReady(page: Page) {
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
}

/** Navigation is a real click on an existing application link, including lesson entry. */
async function follow(page: Page, href: string) {
  await page.locator(`a[href="${href}"]`).first().click();
  await expect(page).toHaveURL((url) => url.hash === href);
}

function postedTotal(data: StorageSnapshot) {
  expect(data.ledger.every((row) => row.status === 'posted')).toBe(true);
  return data.ledger.reduce((sum, row) => sum + (row.points ?? 0), 0);
}

function noPrivateExecutionData(data: StorageSnapshot) {
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

function sameAwards(before: StorageSnapshot, after: StorageSnapshot) {
  for (const store of ['ledger', 'dailyFacts', 'goals'] as const)
    expect(after[store]).toEqual(before[store]);
  expect(after.meta.generation).toBe(before.meta.generation);
}

async function saveJson(directory: string, name: string, value: unknown) {
  await writeFile(join(directory, `${name}.json`), JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
  });
}

async function painted(page: Page) {
  await page.getByTestId('trace-view').locator('[aria-label="当前变量"]').scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** Actual rendered objects, output, events, counters and precise source location. */
async function rendered(page: Page) {
  return {
    cursor: await controls(page).getAttribute('data-cursor'),
    traceHtml: await page.getByTestId('trace-view').innerHTML(),
    location: await page.getByTestId('source-location').innerText(),
    sourceMarks: await page.getByTestId('source-step-highlight').evaluateAll((marks) =>
      marks.map((mark) => ({
        text: mark.textContent,
        start: mark.getAttribute('data-byte-start'),
        end: mark.getAttribute('data-byte-end'),
      })),
    ),
  };
}

/** Walk every adjacent state and prove the full rendered state restores at each cursor. */
async function completeRoundTrip(page: Page, length: number, caseCoverage = false) {
  await expect(controls(page)).toHaveAttribute('data-cursor', '0');
  await painted(page);
  const states = [await rendered(page)];
  for (let cursor = 1; cursor <= length; cursor++) {
    await controls(page).getByRole('button', { name: '前进', exact: true }).click();
    await expect(controls(page)).toHaveAttribute('data-cursor', String(cursor));
    await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', String(cursor));
    await painted(page);
    if (caseCoverage)
      await expect(page.getByTestId('case-view-coverage')).toHaveAttribute(
        'data-covered',
        String(cursor),
      );
    states.push(await rendered(page));
  }
  for (let cursor = length - 1; cursor >= 0; cursor--) {
    await controls(page).getByRole('button', { name: '后退', exact: true }).click();
    await expect(controls(page)).toHaveAttribute('data-cursor', String(cursor));
    await painted(page);
    expect(await rendered(page)).toEqual(states[cursor]);
  }
  await expect(controls(page).getByRole('button', { name: '后退', exact: true })).toBeDisabled();
  return states;
}

interface RunEvidence {
  label: string;
  request: ExecuteRequest;
  steps: number;
  stdout: string;
  requestSha256: string;
  resultSha256: string;
  catalogSha256: string;
}

/** Observation copies native Worker messages; the original Worker still executes unchanged. */
async function captureRuns(page: Page, directory: string, label: string, offset: number) {
  const captures = await page.evaluate((first) => {
    return window.__verticalObservation.workers
      .filter((worker) => worker.kind === 'execute')
      .slice(first)
      .map((worker) => {
        const encoded = (
          worker as typeof worker & {
            captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
          }
        ).captureEncoded();
        return {
          ...encoded,
          id: worker.id,
          catalogJson: worker.catalogJson,
          operationId: worker.operationId,
          responseOperationId: worker.responseOperationId,
          responseOk: worker.responseOk,
          moduleSeen: worker.moduleSeen,
          terminated: worker.terminated,
        };
      });
  }, offset);
  const records: RunEvidence[] = [];
  for (const [index, worker] of captures.entries()) {
    expect(worker.moduleSeen).toBe(true);
    expect(worker.terminated).toBe(true);
    expect(worker.responseOk).toBe(true);
    expect(worker.responseOperationId).toBe(worker.operationId);
    expect(worker.requestBase64).toBeTruthy();
    expect(worker.responseBase64).toBeTruthy();
    expect(worker.catalogJson).toBeTruthy();
    const requestBytes = Buffer.from(worker.requestBase64!, 'base64');
    const resultBytes = Buffer.from(worker.responseBase64!, 'base64');
    const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
    const result = await decodeResult(Uint8Array.from(resultBytes).buffer, request);
    expect(request.remainingMs).toBeGreaterThan(0);
    expect(request.remainingMs).toBeLessThanOrEqual(1000);
    expect(result.producer).toBe('rust');
    expect(result.identity).toEqual(request.identity);
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
    expect(result.trace?.completeness).toBe('complete');
    const stdout = result
      .trace!.steps.flatMap((step) =>
        step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
      )
      .join('');
    if (request.mode === 'exercise-test') {
      const exercise = reviewed.exercises.find((entry) => entry.id === request.subjectRef?.id)!;
      const group = exercise.tests.find((entry) => entry.caseKey === request.identity.testCaseKey)!;
      expect(group).toBeTruthy();
      expect(request.input.values).toEqual(group.input);
      expect(stdout).toBe(group.expectedStdout);
      expect(result.judgeResult?.status).toBe('met');
    } else {
      expect(request.mode).toBe('case');
      expect(request.subjectRef?.id).toBe(caseId);
      expect(request.input.values).toEqual({ x: -7 });
      expect(stdout).toBe('-5\n');
    }
    const prefix = `${label}-${String(index + 1).padStart(2, '0')}`;
    await writeFile(join(directory, `${prefix}.request.json`), requestBytes, { flag: 'wx' });
    await writeFile(join(directory, `${prefix}.result.json`), resultBytes, { flag: 'wx' });
    await writeFile(join(directory, `${prefix}.catalog.json`), worker.catalogJson!, { flag: 'wx' });
    records.push({
      label: prefix,
      request,
      steps: result.trace!.steps.length,
      stdout,
      requestSha256: digest(requestBytes),
      resultSha256: digest(resultBytes),
      catalogSha256: digest(worker.catalogJson!),
    });
  }
  return records;
}

async function preparePractice(page: Page) {
  await expect(practice(page)).toHaveAttribute('data-state', 'ready');
  await showPracticeBlocks(page);
  await expect(blockWorkspace(page)).toBeVisible();
  await localReady(page);
  await practice(page).getByRole('button', { name: '准备代码', exact: true }).click();
  await expect(practice(page)).toHaveAttribute('data-state', 'ready');
  await expect(source(page)).toHaveAttribute('readonly', '');
  await expect(source(page)).not.toHaveValue('');
}

async function submitPractice(page: Page) {
  await practice(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(practice(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await localReady(page);
  await expect(controls(page)).toHaveAttribute('data-cursor', '0');
}

async function runAssignment(page: Page) {
  await follow(page, '#/cases');
  await follow(page, `#/visualize/${caseId}`);
  const panel = page.getByTestId('case-execution');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  await page.getByTestId('input-field-x').fill('-7');
  await panel.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await panel.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(panel).toHaveAttribute('data-state', 'completed');
}

test('P0 delivery: a fresh browser archive completes six lessons, 24 real groups, full viewing, rewards, goals, avatar and durable deduplicated refresh', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(testInfo.retry).toBe(0);
  const task = process.env.TASK_EVIDENCE_TASK ?? '11.5';
  expect(['11.5', 'P0.5-08']).toContain(task);
  const label = process.env.TASK_EVIDENCE_LABEL ?? `delivery-${Date.now()}`;
  expect(label).toMatch(/^[A-Za-z0-9_.-]+$/);
  const directory = join('.artifacts', task, label, testInfo.project.name);
  // Each run owns a previously absent directory: failed evidence is never overwritten.
  await mkdir(join('.artifacts', task, label), { recursive: true });
  await mkdir(directory, { recursive: false });
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL ?? 'http://127.0.0.1:4178',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const resources: { url: string; status: number }[] = [];
  const errors: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (/\/content\/|\.wasm(?:\?|$)/.test(url)) resources.push({ url, status: response.status() });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const steps: { name: string; state: StorageSnapshot }[] = [];
  try {
    const blankContext = await context.storageState({ indexedDB: true });
    expect(blankContext).toEqual({ cookies: [], origins: [] });
    await observeCaseSetExecution(page);
    await page.bringToFront();
    await page.goto('/#/');
    await localReady(page);
    const initial = await snapshot(page);
    for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'] as const)
      expect(initial[store]).toEqual([]);
    expect(postedTotal(initial)).toBe(0);
    await saveJson(directory, 'initial-empty-archive', { blankContext, initial });

    await page.getByRole('link', { name: '设置每日目标', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '每日目标', exact: true });
    const form = page.getByTestId('daily-goal-settings');
    await expect(dialog).toBeVisible();
    for (const [name, value] of [
      ['每日练习数', targets.exercise],
      ['每日小节数', targets.lesson],
      ['每日案例数', targets.case],
    ] as const)
      await form.getByRole('spinbutton', { name, exact: true }).fill(String(value));
    await form.getByRole('button', { name: '保存自定义目标', exact: true }).click();
    await localReady(page);
    await expect(page.getByTestId('goal-template-saved')).toContainText('目标已保存');
    await dialog.getByRole('button', { name: '关闭面板', exact: true }).click();
    const configured = await snapshot(page);
    expect(configured.settings.goalTemplate?.targets).toEqual(targets);
    expect(configured.goals).toEqual([]);
    sameAwards(initial, configured);
    await page.screenshot({ path: join(directory, '01-fresh-home.png'), fullPage: true });

    await follow(page, '#/courses');
    await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-course-lesson]')).toHaveCount(6);
    const curriculumRuns: RunEvidence[] = [];
    const blockEdits = [];
    for (const [index, lesson] of reviewed.lessons.entries()) {
      const exercise = reviewed.exercises.find(
        (entry) => entry.id === lesson.requiredExerciseRefs[0].id,
      )!;
      await page.locator(`[data-course-lesson="${lesson.id}"] a`).click();
      await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
      await expect(page.getByRole('heading', { name: lesson.title, exact: true })).toBeVisible();
      for (const objective of lesson.teaching.objectives)
        await expect(page.getByTestId('lesson-reading')).toContainText(objective);
      await page.getByRole('button', { name: '开始本节学习', exact: true }).click();
      await localReady(page);
      await page.getByRole('button', { name: '确认已学习', exact: true }).click();
      await localReady(page);
      await expect(page.getByTestId('lesson-progress')).toContainText('已确认学习');
      await page.getByRole('link', { name: '进入练习工作区', exact: true }).click();
      await preparePractice(page);
      const before = await source(page).inputValue();
      await correctStarter(page, exercise.id);
      await expect(source(page)).not.toHaveValue(before);
      await expect(source(page)).toHaveAttribute('readonly', '');
      const edited = await source(page).inputValue();
      blockEdits.push({ exerciseId: exercise.id, before, edited });
      await submitPractice(page);
      const currentRuns = await captureRuns(
        page,
        directory,
        `course-${index + 1}`,
        curriculumRuns.length,
      );
      expect(currentRuns).toHaveLength(exercise.tests.length);
      expect(currentRuns.map((run) => run.request.identity.testCaseKey)).toEqual(
        exercise.tests.map((group) => group.caseKey),
      );
      expect(currentRuns.every((run) => run.request.subjectRef?.id === exercise.id)).toBe(true);
      expect(currentRuns.every((run) => run.request.source.blockMap.length > 0)).toBe(true);
      const last = currentRuns.at(-1)!;
      expect(last.request.source.text).toBe(await source(page).inputValue());
      curriculumRuns.push(...currentRuns);
      if (index === 0) {
        const states = await completeRoundTrip(page, last.steps);
        await saveJson(directory, 'practice-complete-round-trip', states);
        await controls(page)
          .getByRole('combobox', { name: '播放速度', exact: true })
          .selectOption('4');
        await controls(page).getByRole('button', { name: '播放', exact: true }).click();
        await expect(controls(page)).toHaveAttribute('data-player-status', 'ended');
        await controls(page)
          .getByRole('combobox', { name: '播放速度', exact: true })
          .selectOption('0.25');
        await controls(page).getByRole('button', { name: '重播', exact: true }).click();
        await expect(controls(page)).toHaveAttribute('data-cursor', '0');
        await controls(page).getByRole('button', { name: '暂停', exact: true }).click();
        expect(await rendered(page)).toEqual(states[0]);
      } else {
        const first = await rendered(page);
        await controls(page).getByRole('button', { name: '前进', exact: true }).click();
        await expect(controls(page)).toHaveAttribute('data-cursor', '1');
        await controls(page).getByRole('button', { name: '后退', exact: true }).click();
        await expect(controls(page)).toHaveAttribute('data-cursor', '0');
        expect(await rendered(page)).toEqual(first);
        await controls(page)
          .getByRole('combobox', { name: '播放速度', exact: true })
          .selectOption('4');
        await controls(page).getByRole('button', { name: '播放', exact: true }).click();
        await expect
          .poll(async () => Number(await controls(page).getAttribute('data-cursor')))
          .toBeGreaterThan(0);
        const pause = controls(page).getByRole('button', { name: '暂停', exact: true });
        if (await pause.count()) await pause.click();
      }
      const cursor = await controls(page).getAttribute('data-cursor');
      await practice(page).getByRole('link', { name: '查看本次复盘', exact: true }).click();
      await expect(page).toHaveURL((url) => url.hash === `#/practice/${exercise.id}/review`);
      await expect(controls(page)).toHaveAttribute('data-cursor', cursor!);
      await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
      await expect(controls(page)).toHaveAttribute('data-cursor', cursor!);
      expect(
        await page.evaluate(
          () =>
            window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute')
              .length,
        ),
      ).toBe(curriculumRuns.length);
      await page.screenshot({
        path: join(directory, `02-practice-${index + 1}.png`),
        fullPage: true,
      });
      await page.getByRole('link', { name: '返回本节学习', exact: true }).click();
      await expect(page.getByTestId('lesson-progress')).toContainText('小节已完成');
      const learned = await snapshot(page);
      expect(postedTotal(learned)).toBe((index + 1) * 30);
      noPrivateExecutionData(learned);
      steps.push({ name: lesson.id, state: learned });
      await follow(page, '#/courses');
    }
    expect(curriculumRuns).toHaveLength(24);
    const completedCourse = await snapshot(page);
    expect(
      completedCourse.progress.filter((row) => row.eventType === 'exercise.passed'),
    ).toHaveLength(6);
    expect(
      completedCourse.progress.filter((row) => row.eventType === 'lesson.completed'),
    ).toHaveLength(6);
    expect(completedCourse.dailyFacts).toHaveLength(12);
    expect(completedCourse.goals).toHaveLength(1);
    expect(completedCourse.goals[0].targets).toEqual(targets);
    expect(completedCourse.goals[0].achievedAt).toBeNull();
    for (const lesson of reviewed.lessons)
      await expect(page.locator(`[data-course-lesson="${lesson.id}"]`)).toContainText('小节已完成');
    await page.screenshot({ path: join(directory, '03-completed-course.png'), fullPage: true });

    await runAssignment(page);
    const caseRuns = await captureRuns(page, directory, 'case-first', 24);
    expect(caseRuns).toHaveLength(1);
    expect(caseRuns[0].request.source.text).toBe(await source(page).inputValue());
    const confirmation = page.getByTestId('case-view-confirmation');
    const confirmViewing = confirmation.getByRole('button', { name: '确认已观看', exact: true });
    await expect(confirmViewing).toBeDisabled();
    const caseStates = await completeRoundTrip(page, caseRuns[0].steps, true);
    await saveJson(directory, 'case-complete-round-trip', caseStates);
    // Watching, stepping backward, and replaying still cannot issue a learning award.
    sameAwards(completedCourse, await snapshot(page));
    await controls(page).getByRole('combobox', { name: '播放速度', exact: true }).selectOption('4');
    await controls(page).getByRole('button', { name: '播放', exact: true }).click();
    await expect(controls(page)).toHaveAttribute('data-player-status', 'ended');
    await expect(confirmation).toHaveAttribute('data-view-state', 'ready');
    await expect(page.getByTestId('step-output')).toHaveAttribute('data-output', '-5\n');
    await confirmViewing.click();
    await expect(confirmation).toHaveAttribute('data-view-state', 'saved');
    await localReady(page);
    const finished = await snapshot(page);
    expect(postedTotal(finished)).toBe(190);
    expect(finished.ledger).toHaveLength(14);
    expect(finished.ledger.filter((row) => row.sourceId === 'reward.daily-goal.once')).toHaveLength(
      1,
    );
    expect(finished.ledger.filter((row) => row.sourceId === 'reward.case.first-view')).toHaveLength(
      1,
    );
    expect(finished.dailyFacts).toHaveLength(13);
    expect(finished.goals[0].achievedAt).not.toBeNull();
    noPrivateExecutionData(finished);

    await follow(page, '#/');
    await localReady(page);
    await expect(page.getByTestId('learning-posted-points')).toHaveText('190');
    await expect(page.getByTestId('learning-level')).toHaveAttribute('data-level', '3');
    const goal = page.getByTestId('learning-today-goal').getByTestId('daily-goal-summary');
    await expect(goal).toHaveAttribute('data-goal-state', 'achieved');
    for (const [kind, total] of [
      ['exercise', 6],
      ['lesson', 6],
      ['case', 1],
    ] as const)
      await expect(goal.getByTestId(`goal-progress-${kind}`)).toContainText(`${total} / ${total}`);
    await page.getByRole('link', { name: '查看积分明细', exact: true }).click();
    const points = page.getByRole('dialog', { name: '积分明细', exact: true });
    await expect(points.locator('.reward-ledger > li')).toHaveCount(14);
    await expect(points).toContainText('每日目标达成');
    await points.getByRole('button', { name: '关闭面板', exact: true }).click();
    await page.getByRole('link', { name: '查看打卡历史', exact: true }).click();
    await expect(page.getByTestId('goal-history')).toContainText(finished.goals[0].localDate);
    await page
      .getByRole('dialog', { name: '打卡历史', exact: true })
      .getByRole('button', { name: '关闭面板', exact: true })
      .click();
    await page.getByRole('link', { name: '调整基础形象', exact: true }).click();
    await localReady(page);
    await page.getByRole('radio', { name: '星光', exact: true }).check();
    await page
      .getByRole('textbox', { name: '强调色十六进制', exact: true })
      .fill(avatar.accentColor);
    await page.getByRole('button', { name: '保存基础形象', exact: true }).click();
    await localReady(page);
    await expect(page.getByRole('button', { name: '保存基础形象', exact: true })).toBeDisabled();
    const saved = await snapshot(page);
    expect(saved.avatar).toEqual(avatar);
    sameAwards(finished, saved);
    await page.screenshot({ path: join(directory, '04-saved-avatar.png'), fullPage: true });
    await page.reload();
    await localReady(page);
    expect(await snapshot(page)).toEqual(saved);
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute(
      'data-avatar-preset',
      avatar.presetId,
    );
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute(
      'data-avatar-color',
      avatar.accentColor,
    );
    await follow(page, '#/');
    await localReady(page);
    await expect(page.getByTestId('learning-avatar')).toHaveAttribute(
      'data-avatar-preset',
      avatar.presetId,
    );
    await expect(page.getByTestId('learning-avatar')).toHaveAttribute(
      'data-avatar-color',
      avatar.accentColor,
    );
    await expect(page.getByTestId('learning-posted-points')).toHaveText('190');
    await expect(goal).toHaveAttribute('data-goal-state', 'achieved');
    expect(await snapshot(page)).toEqual(saved);
    await page.screenshot({ path: join(directory, '05-restored-home.png'), fullPage: true });

    // Refresh intentionally removes temporary programs/runs, while preserving saved summaries.
    await follow(page, '#/courses');
    await page.locator(`[data-course-lesson="${reviewed.lessons[0].id}"] a`).click();
    await page.getByRole('link', { name: '进入练习工作区', exact: true }).click();
    await preparePractice(page);
    await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
    await expect(controls(page)).toHaveAttribute('data-cursor', '');
    await correctStarter(page, reviewed.exercises[0].id);
    await submitPractice(page);
    const repeatRuns = await captureRuns(page, directory, 'repeat-first-exercise', 0);
    expect(repeatRuns).toHaveLength(3);
    const repeated = await snapshot(page);
    sameAwards(saved, repeated);
    expect(postedTotal(repeated)).toBe(190);
    await runAssignment(page);
    const repeatCaseRuns = await captureRuns(page, directory, 'repeat-case', 3);
    expect(repeatCaseRuns).toHaveLength(1);
    await completeRoundTrip(page, repeatCaseRuns[0].steps, true);
    await confirmViewing.click();
    await expect(confirmation).toHaveAttribute('data-view-state', 'saved');
    await localReady(page);
    const deduplicated = await snapshot(page);
    sameAwards(saved, deduplicated);
    noPrivateExecutionData(deduplicated);
    expect(postedTotal(deduplicated)).toBe(190);
    await page.reload();
    await localReady(page);
    expect(await snapshot(page)).toEqual(deduplicated);
    expect(errors).toEqual([]);
    expect(resources.every((entry) => entry.status >= 200 && entry.status < 400)).toBe(true);
    expect(resources.some((entry) => entry.url.endsWith('/course-reading-1.0.0.json'))).toBe(true);
    expect(resources.some((entry) => /\/course-learning-[0-9.]+\.json$/.test(entry.url))).toBe(
      true,
    );
    expect(resources.some((entry) => /\.wasm$/.test(entry.url))).toBe(true);
    expect(resources.some((entry) => entry.url.endsWith('/course-1.0.1.json'))).toBe(false);
    await saveJson(directory, 'native-ui', {
      task,
      regressionOf: '11.5',
      browser: testInfo.project.name,
      browserVersion: browser.version(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      retry: testInfo.retry,
      freshBrowserContext: true,
      isolatedOriginStateBeforeNavigation: blankContext,
      scope:
        'Production UI only; no routes, content, execution, time or learning facts are mocked.',
      observation:
        'Native Worker messages copied for evidence; all eleven IDB stores inspected readonly.',
      metrics: {
        lessons: 6,
        exercises: 6,
        firstSubmissionGroups: 24,
        firstCases: 1,
        repeatGroups: 3,
        repeatCases: 1,
        totalRealExecutions: 29,
        points: 190,
      },
      initial,
      configured,
      steps,
      blockEdits,
      completedCourse,
      finished,
      saved,
      repeated,
      deduplicated,
      curriculumRuns,
      caseRuns,
      repeatRuns,
      repeatCaseRuns,
      resources,
      errors,
      performanceScope:
        'Functional delivery verification; no new 500 ms gate. The 1000 ms execution safety deadline remains active.',
    });
    await testInfo.attach('p0-delivery-native-ui', {
      path: join(directory, 'native-ui.json'),
      contentType: 'application/json',
    });
  } catch (error) {
    await page
      .screenshot({ path: join(directory, 'failure.png'), fullPage: true })
      .catch(() => undefined);
    await saveJson(directory, 'failure', {
      message: error instanceof Error ? error.stack : String(error),
      url: page.url(),
      steps,
      resources,
      errors,
    });
    throw error;
  } finally {
    await context.close();
  }
});
