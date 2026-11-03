import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import { installC6Packets } from './c6-observation';
import {
  currentSnapshot,
  assertCurrentRun,
  assertCurrentJudge,
  assertNoExecutionPersistence,
  assertLearningEqual,
  currentJudgeCount,
} from './current-practice-observation';
const exercises = (
  JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
    chapters: { exercises: C6CourseExercise[] }[];
  }
).chapters
  .flatMap((c) => c.exercises)
  .slice(0, 6);
const manifest = JSON.parse(
  readFileSync('content/c/primer6-teaching/manifest-2.0.0.json', 'utf8'),
) as { nodes: { id: string; titleDisplay: string }[] };
const c6Editor = (page: Page) => page.getByLabel('完整 C 源码 · main.c', { exact: true });
async function visitLeaf(page: Page, id: string) {
  await follow(page, '#/courses');
  const node = manifest.nodes.find((n) => `lesson.${n.id}` === id)!;
  expect(node).toBeTruthy();
  await page
    .getByRole('searchbox', { name: '查找章节或主题', exact: true })
    .fill(node.titleDisplay);
  await follow(page, `#/lessons/${id}`);
  await expect(page.locator('.c6-reading-confirmation')).toBeVisible();
}
async function confirmLeaf(page: Page, id: string) {
  await visitLeaf(page, id);
  await page.getByRole('button', { name: '我已读完本节', exact: true }).click();
  await expect(page.getByRole('button', { name: '已确认阅读', exact: true })).toBeDisabled();
  await localReady(page);
}
async function currentRoundTrip(page: Page, length: number) {
  const trace = page.locator('.c6-trace');
  await expect(trace).toHaveAttribute('data-cursor', '0');
  const states = [await trace.innerHTML()];
  for (let c = 1; c <= length; c++) {
    await trace.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(trace).toHaveAttribute('data-cursor', String(c));
    states.push(await trace.innerHTML());
  }
  for (let c = length - 1; c >= 0; c--) {
    await trace.getByRole('button', { name: '上一步', exact: true }).click();
    await expect(trace).toHaveAttribute('data-cursor', String(c));
    expect(await trace.innerHTML()).toBe(states[c]);
  }
  await expect(trace.getByRole('button', { name: '上一步', exact: true })).toBeDisabled();
  return states;
}
async function nativeDraft(page: Page) {
  const before = await currentSnapshot(page);
  await c6Editor(page).fill(
    '#include <stdio.h>\nint main(void){int probe=1;printf("%d\\n",probe);return 0;}',
  );
  await page.getByRole('button', { name: '同步到积木', exact: true }).click();
  const ids = await blockOptions(page, /^\d+\. 整数 · 1$/);
  expect(ids).toHaveLength(1);
  await selectBlock(page, ids[0]);
  await blockWorkspace(page).getByRole('textbox', { name: '整数值', exact: true }).fill('2');
  await expect(page.getByText('积木生成的完整程序预览', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '应用生成代码', exact: true }).click();
  const source = await c6Editor(page).inputValue();
  expect(source).toMatch(/probe\s*=\s*2/);
  await page.getByRole('button', { name: '运行当前代码', exact: true }).click();
  await expect(page.locator('.c6-trace')).toBeVisible();
  await assertCurrentRun(page, source, exercises[0].tests[0].stdin);
  await page.getByRole('button', { name: '到本次末尾', exact: true }).click();
  await expect(page.getByLabel('当前游标标准输出')).toHaveText('2\n');
  assertLearningEqual(before, await currentSnapshot(page));
  return source;
}
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ExerciseEntity, LessonEntity } from '../../web/src/content/types';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { blockWorkspace, blockOptions, selectBlock } from './block-ui';
import { observeCaseSetExecution } from './case-set-observation';

// Expectations come from the reviewed source. The browser receives only the
// actual published reading, practice, learning, and Rust/WASM resources.
const reviewed = JSON.parse(
  readFileSync(new URL('../../content/c/p0/course-1.0.1.json', import.meta.url), 'utf8'),
) as { lessons: LessonEntity[]; exercises: ExerciseEntity[] };
const caseId = 'case.c.assignment';
const targets = { exercise: 6, lesson: 6, case: 1 };
const avatar = { presetId: 'avatar.basic.04', accentColor: '#4466CC' };
const controls = (page: Page) => page.getByTestId('player-controls');
const source = (page: Page) =>
  page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

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
  assertNoExecutionPersistence(
    data as Awaited<ReturnType<typeof currentSnapshot>>,
    exercises.map((e) => e.referenceSource),
    exercises,
  );
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
  testInfo.annotations.push({
    type: 'current-contract',
    description:
      'Scope49: current6 exercises/24 groups and7 reading leaves, manual full C6 round trips; native probe does not grant course pass.',
  });
  const task = process.env.TASK_EVIDENCE_TASK ?? '11.5';
  expect(['11.5', 'P0.5-08', '21.6']).toContain(task);
  const label = process.env.TASK_EVIDENCE_LABEL ?? `delivery-${Date.now()}`;
  expect(label).toMatch(/^[A-Za-z0-9_.-]+$/);
  const directory = join('.artifacts', task, label, testInfo.project.name);
  await mkdir(join('.artifacts', task, label), { recursive: true });
  await mkdir(directory, { recursive: false });
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(installC6Packets);
  const page = await context.newPage();
  const resources: { url: string; status: number }[] = [],
    errors: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (/\/content\/|\.wasm(?:\?|$)/.test(url)) resources.push({ url, status: response.status() });
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const steps = [];
  try {
    const blank = await context.storageState({ indexedDB: true });
    expect(blank).toEqual({ cookies: [], origins: [] });
    await observeCaseSetExecution(page);
    await page.bringToFront();
    await page.goto('/#/');
    await localReady(page);
    await expect
      .poll(async () => (await currentSnapshot(page)).settings.goalTemplate)
      .not.toBeNull();
    const initial = await currentSnapshot(page);
    for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'] as const)
      expect(initial[key]).toEqual([]);
    expect(postedTotal(initial)).toBe(0);
    await page.getByRole('link', { name: '设置每日目标', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '每日目标', exact: true }),
      form = page.getByTestId('daily-goal-settings');
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
    const configured = await currentSnapshot(page);
    expect(configured.settings.goalTemplate?.targets).toEqual(targets);
    expect(configured.goals).toEqual([]);
    sameAwards(initial, configured);
    await page.screenshot({ path: join(directory, '01-fresh-home.png'), fullPage: true });
    await confirmLeaf(page, 'lesson.c6.s2.2.1');
    const runs = [];
    let blockEdit = '';
    for (const [i, e] of exercises.entries()) {
      await confirmLeaf(page, e.lessonRef.id);
      await follow(page, `#/practice/${e.ref.id}`);
      await expect(c6Editor(page)).toHaveValue(e.starterSource);
      if (i === 0) blockEdit = await nativeDraft(page);
      await c6Editor(page).fill(e.referenceSource);
      await page.getByRole('button', { name: '判定全部四组', exact: true }).click();
      await expect(page.getByRole('heading', { name: '四组全部通过', exact: true })).toBeVisible();
      await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
      const run = await assertCurrentJudge(page, e, 'passed');
      runs.push(run);
      const before = await currentSnapshot(page),
        count = await currentJudgeCount(page);
      for (let n = 0; n < 4; n++) {
        await page.getByRole('button', { name: `第 ${n + 1} 组 · 通过`, exact: true }).click();
        const states = await currentRoundTrip(page, run.result.cases[n].packet.trace!.steps.length);
        if (i === 0) await saveJson(directory, `current-complete-round-trip-${n + 1}`, states);
        await page.getByRole('button', { name: '到本次末尾', exact: true }).click();
        await expect(page.getByLabel('当前游标标准输出')).toHaveText(e.tests[n].expectedStdout);
      }
      expect(await currentJudgeCount(page)).toBe(count);
      assertLearningEqual(before, await currentSnapshot(page));
      await page.locator('.c6-workbench > a.text-link').click();
      await expect(page.locator('.c6-reading-confirmation')).toContainText('本节已完成');
      const state = await currentSnapshot(page);
      noPrivateExecutionData(state);
      steps.push({ lesson: e.lessonRef, state });
    }
    expect(runs.flatMap((r) => r.result.cases)).toHaveLength(24);
    const completed = await currentSnapshot(page);
    expect(completed.progress.filter((p) => p.eventType === 'lesson.completed')).toHaveLength(7);
    expect(completed.progress.filter((p) => p.eventType === 'exercise.passed')).toHaveLength(6);
    expect(completed.dailyFacts).toHaveLength(13);
    expect(completed.goals).toHaveLength(1);
    expect(completed.goals[0].targets).toEqual(targets);
    expect(completed.goals[0].achievedAt).toBeNull();
    expect(postedTotal(completed)).toBe(60);
    await runAssignment(page);
    const caseRuns = await captureRuns(page, directory, 'case-first', 0);
    expect(caseRuns).toHaveLength(1);
    expect(caseRuns[0].request.source.text).toBe(await source(page).inputValue());
    await controls(page)
      .getByRole('combobox', { name: '步骤显示', exact: true })
      .selectOption('all');
    const confirmation = page.getByTestId('case-view-confirmation'),
      confirm = confirmation.getByRole('button', { name: '确认已观看', exact: true });
    await expect(confirm).toBeDisabled();
    const states = await completeRoundTrip(page, caseRuns[0].steps, true);
    await saveJson(directory, 'case-complete-round-trip', states);
    sameAwards(completed, await currentSnapshot(page));
    await controls(page).getByRole('combobox', { name: '播放速度', exact: true }).selectOption('4');
    await controls(page).getByRole('button', { name: '播放', exact: true }).click();
    await expect(controls(page)).toHaveAttribute('data-player-status', 'ended');
    await expect(confirmation).toHaveAttribute('data-view-state', 'ready');
    await expect(page.getByTestId('step-output')).toHaveAttribute('data-output', '-5\n');
    await confirm.click();
    await expect(confirmation).toHaveAttribute('data-view-state', 'saved');
    await localReady(page);
    const finished = await currentSnapshot(page);
    expect(postedTotal(finished)).toBe(70);
    expect(finished.ledger).toHaveLength(7);
    expect(finished.dailyFacts).toHaveLength(14);
    expect(finished.goals[0].achievedAt).not.toBeNull();
    noPrivateExecutionData(finished);
    await follow(page, '#/');
    await localReady(page);
    await expect(page.getByRole('heading', { name: '已入账 70 分', exact: true })).toBeVisible();
    await expect(page.getByTestId('learning-level')).toHaveAttribute('data-level', '2');
    const goal = page.getByTestId('daily-goal-summary');
    await expect(goal).toHaveAttribute('data-goal-state', 'achieved');
    for (const [kind, count, target] of [
      ['exercise', 6, 6],
      ['lesson', 7, 6],
      ['case', 1, 1],
    ] as const)
      await expect(goal.getByTestId(`goal-progress-${kind}`)).toContainText(`${count} / ${target}`);
    await page.getByRole('link', { name: '查看积分明细', exact: true }).click();
    const points = page.getByRole('dialog', { name: '积分明细', exact: true });
    await expect(points.locator('.reward-ledger > li')).toHaveCount(7);
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
    const saved = await currentSnapshot(page);
    expect(saved.avatar).toEqual(avatar);
    sameAwards(finished, saved);
    await page.reload();
    await localReady(page);
    expect(await currentSnapshot(page)).toEqual(saved);
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
    await visitLeaf(page, exercises[0].lessonRef.id);
    await follow(page, `#/practice/${exercises[0].ref.id}`);
    await expect(c6Editor(page)).toHaveValue(exercises[0].starterSource);
    await expect(page.locator('.c6-trace')).toHaveCount(0);
    await c6Editor(page).fill(exercises[0].referenceSource);
    await page.getByRole('button', { name: '判定全部四组', exact: true }).click();
    await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
    const repeat = await assertCurrentJudge(page, exercises[0], 'passed');
    sameAwards(saved, await currentSnapshot(page));
    await runAssignment(page);
    const repeatedCase = await captureRuns(page, directory, 'case-repeat', 0);
    expect(repeatedCase).toHaveLength(1);
    await controls(page)
      .getByRole('combobox', { name: '步骤显示', exact: true })
      .selectOption('all');
    await completeRoundTrip(page, repeatedCase[0].steps, true);
    await confirm.click();
    await expect(confirmation).toHaveAttribute('data-view-state', 'saved');
    await localReady(page);
    const final = await currentSnapshot(page);
    sameAwards(saved, final);
    noPrivateExecutionData(final);
    expect(postedTotal(final)).toBe(70);
    await page.reload();
    await localReady(page);
    expect(await currentSnapshot(page)).toEqual(final);
    expect(errors).toEqual([]);
    expect(resources.every((r) => r.status >= 200 && r.status < 400)).toBe(true);
    expect(resources.some((r) => r.url.endsWith('/primer6-teaching/manifest-2.0.0.json'))).toBe(
      true,
    );
    expect(resources.some((r) => r.url.endsWith('/primer6-learning/index-1.0.0.json'))).toBe(true);
    expect(resources.some((r) => /\.wasm$/.test(r.url))).toBe(true);
    await saveJson(directory, 'native-ui', {
      task,
      browserVersion: browser.version(),
      blank,
      initial,
      configured,
      steps,
      blockEdit,
      completed,
      finished,
      saved,
      final,
      runs: runs.map((r) => ({
        request: r.request,
        caseKeys: r.result.cases.map((c) => c.caseKey),
      })),
      caseRuns,
      repeat: repeat.request,
      repeatedCase,
      resources,
      errors,
      metrics: {
        readingLeaves: 7,
        exercises: 6,
        firstGroups: 24,
        repeatGroups: 4,
        caseRuns: 2,
        points: 70,
      },
      scope:
        'Current production UI; real44 owner bytes; full manual C6 round trips; raw legacy case autoplay/full state restored; no fabricated learning facts.',
    });
  } catch (error) {
    await page
      .screenshot({ path: join(directory, 'failure.png'), fullPage: true })
      .catch(() => undefined);
    await saveJson(directory, 'failure', {
      message: String(error),
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
