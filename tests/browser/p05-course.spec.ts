import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { ContentPackage, ExerciseEntity, LessonEntity } from '../../web/src/content/types';
import type { ExecuteRequest } from '../../web/src/engine/protocol';
import { decodeResult } from '../../web/src/engine/protocol';
import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
import type { GoalTargets, Receipt, StorageSnapshot } from '../../web/src/storage/model';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

const current = JSON.parse(
  readFileSync('content/c/p05/course-1.0.0.json', 'utf8'),
) as ContentPackage;
const legacy = JSON.parse(readFileSync('content/c/p0/course-1.0.1.json', 'utf8')) as ContentPackage;
const solutions = JSON.parse(
  readFileSync('tests/fixtures/p05-reference-solutions.json', 'utf8'),
) as {
  solutions: { exerciseRef: { id: string; version: string }; source: string }[];
};
const answers = new Map(solutions.solutions.map((entry) => [entry.exerciseRef.id, entry.source]));
const p05Package = { id: 'content.c.p05', version: '1.0.0' };
const fixedDate = new Date('2026-10-27T04:00:00.000Z');
const panel = (page: Page) => page.getByTestId('practice-execution');
const save = (page: Page) => page.getByTestId('learning-save-status');
const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const editor = (page: Page) => page.getByTestId('draft-code-editor');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Archive = { databaseVersion: number; stores: string[]; data: StorageSnapshot };

test.beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fixedDate); // Date only: the real monotonic execution deadline remains active.
  await observeCaseSetExecution(page);
});

/** Native readonly archive inspection. These tests never seed a pass or learning event. */
async function archive(page: Page): Promise<Archive> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stores = Array.from(db.objectStoreNames);
      const transaction = db.transaction(stores, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const entries = await Promise.all(
        stores.map(async (name) => {
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
      return {
        databaseVersion: db.version,
        stores,
        data: Object.fromEntries(entries) as unknown as StorageSnapshot,
      };
    } finally {
      db.close();
    }
  });
}

function noExecutionPersistence(value: unknown) {
  const keys = (item: unknown): string[] =>
    item && typeof item === 'object'
      ? Object.entries(item).flatMap(([key, child]) => [key, ...keys(child)])
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
    'runId',
    'submissionId',
    'workspace',
  ];
  expect(keys(value).filter((key) => forbidden.includes(key))).toEqual([]);
}
function posted(data: StorageSnapshot, sourceId?: string) {
  const rows = data.ledger.filter((row) => !sourceId || row.sourceId === sourceId);
  expect(rows.every((row) => row.status === 'posted')).toBe(true);
  return rows.reduce((sum, row) => sum + (row.points ?? 0), 0);
}
function stableLearning(before: StorageSnapshot, after: StorageSnapshot) {
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals', 'aliases'] as const)
    expect(after[key]).toEqual(before[key]);
  expect(after.meta.generation).toBe(before.meta.generation);
  expect(after.meta.timeZone).toBe(before.meta.timeZone);
}
async function ready(page: Page) {
  await expect(save(page)).toHaveAttribute('data-save-status', 'ready');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}
async function directory(info: TestInfo, name: string) {
  expect(info.retry).toBe(0);
  const label = process.env.TASK_EVIDENCE_LABEL ?? `p05-course-${Date.now()}`;
  expect(label).toMatch(/^[A-Za-z0-9_.-]+$/);
  const result = join('.artifacts/P0.5-09/browser', label, info.project.name, name);
  await mkdir(join('.artifacts/P0.5-09/browser', label, info.project.name), { recursive: true });
  await mkdir(result, { recursive: false });
  return result;
}
async function record(folder: string, name: string, value: unknown) {
  await writeFile(
    join(folder, `${name}.json`),
    JSON.stringify(
      {
        clock: { date: fixedDate.toISOString(), dateControlled: true, monotonicDeadline: 'real' },
        evidence: value,
      },
      null,
      2,
    ) + '\n',
    {
      flag: 'wx',
    },
  );
}
/** Failure-only, native readonly observations. Never change a learning record or retry a pass. */
test.afterEach(async ({ page }, info) => {
  if (!['failed', 'timedOut'].includes(info.status ?? '')) return;
  const folder = await directory(info, `failure-${sha(info.title).slice(0, 12)}`);
  const bounded = async <T>(operation: Promise<T>, milliseconds = 3000) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Readonly diagnostic timed out')),
            milliseconds,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const diagnostic: Record<string, unknown> = {
    kind: 'failure-only-readonly-observation',
    test: info.title,
    status: info.status,
    project: info.project.name,
    databaseModified: false,
  };
  try {
    diagnostic.ui = await bounded(
      page.evaluate(() => {
        const shell = document.querySelector('.app-shell');
        const attributes = (element: Element | null) =>
          element
            ? Object.fromEntries(Array.from(element.attributes, (item) => [item.name, item.value]))
            : null;
        return {
          observedAt: performance.now(),
          url: location.href,
          shell: attributes(shell),
          learning: attributes(document.querySelector('[data-testid="learning-save-status"]')),
          pass: attributes(document.querySelector('[data-testid="practice-pass-save"]')),
          practice: attributes(document.querySelector('[data-testid="practice-execution"]')),
          completion:
            document.querySelector('[data-testid="lesson-completion"]')?.textContent ?? null,
          body: document.body.innerText,
        };
      }),
    );
  } catch (error) {
    diagnostic.uiError = String(error);
  }
  const archiveStarted = performance.now();
  try {
    const saved = await bounded(archive(page));
    diagnostic.archive = saved;
    diagnostic.archiveCounts = Object.fromEntries(
      Object.entries(saved.data).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.length : 1,
      ]),
    );
  } catch (error) {
    diagnostic.archiveError = String(error);
  }
  diagnostic.archiveElapsedMs = performance.now() - archiveStarted;
  await record(folder, 'failure-state', diagnostic);
  try {
    const count = await bounded(
      page.evaluate(() => window.__verticalObservation?.workers.length ?? 0),
    );
    for (let index = 0; index < count; index++) {
      const worker = await bounded(
        page.evaluate((selected) => {
          const item = window.__verticalObservation.workers[selected];
          const capture = item as typeof item & {
            captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
          };
          return {
            kind: item.kind,
            operationId: item.operationId,
            responseOperationId: item.responseOperationId,
            responseOk: item.responseOk,
            moduleSeen: item.moduleSeen,
            terminated: item.terminated,
            catalogJson: item.catalogJson,
            ...capture.captureEncoded(),
          };
        }, index),
      );
      const prefix = `worker-${String(index + 1).padStart(3, '0')}-${worker.kind}`;
      const { requestBase64, responseBase64, catalogJson, ...metadata } = worker;
      if (requestBase64)
        await writeFile(
          join(folder, `${prefix}.request.json`),
          Buffer.from(requestBase64, 'base64'),
          { flag: 'wx' },
        );
      if (responseBase64)
        await writeFile(
          join(folder, `${prefix}.result.json`),
          Buffer.from(responseBase64, 'base64'),
          { flag: 'wx' },
        );
      if (catalogJson)
        await writeFile(join(folder, `${prefix}.catalog.json`), catalogJson, { flag: 'wx' });
      await record(folder, `${prefix}-metadata`, metadata);
    }
  } catch (error) {
    await record(folder, 'worker-capture-error', { error: String(error) });
  }
  try {
    const benchmark = await bounded(
      page.evaluate(() => {
        const timeZone = 'Asia/Shanghai';
        const count = 200;
        const at = new Date('2026-10-27T04:00:00.000Z');
        let started = performance.now();
        for (let index = 0; index < count; index++)
          new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
        const timeZoneValidationMs = performance.now() - started;
        started = performance.now();
        let last: Intl.DateTimeFormatPart[] = [];
        for (let index = 0; index < count; index++)
          last = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).formatToParts(at);
        return {
          count,
          timeZone,
          clock: 'real-monotonic-after-failure-only',
          timeZoneValidationMs,
          gregoryFormatToPartsMs: performance.now() - started,
          last,
        };
      }),
    );
    await record(folder, 'intl-benchmark', benchmark);
  } catch (error) {
    await record(folder, 'intl-benchmark-error', { error: String(error) });
  }
});
function bundlePath() {
  expect(p05CourseRelease.enabled).toBe(true);
  expect(p05CourseRelease.registered).toBe(true);
  expect(p05CourseRelease.file).toMatch(/^content\//);
  return `/${p05CourseRelease.file}`;
}
async function openLesson(page: Page, lesson: LessonEntity, confirm = true) {
  await page.goto(`/#/lessons/${encodeURIComponent(lesson.id)}`);
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await ready(page);
  await expect(
    page.getByRole('heading', { name: lesson.title, exact: true, level: 1 }),
  ).toBeVisible();
  if (confirm) {
    const start = page.getByRole('button', { name: '开始本节学习', exact: true });
    if (await start.isEnabled()) {
      await start.click();
      await ready(page);
    }
    await page.getByRole('button', { name: /^(确认已学习|确认今日复习)$/ }).click();
    await ready(page);
    await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute(
      'data-saved',
      'yes',
    );
  }
}
async function openAnswer(page: Page, id: string, assertEmpty = true) {
  await page.goto(`/#/practice/${encodeURIComponent(id)}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await ready(page);
  const preference = page
    .getByTestId('block-workspace-preference')
    .getByRole('combobox', { name: '积木显示', exact: true });
  await expect(preference).toBeVisible();
  if ((await preference.inputValue()) !== 'hide') await preference.selectOption('hide');
  await expect(page.getByTestId('practice-editor-layout')).toHaveAttribute(
    'data-blocks-visible',
    'no',
  );
  await expect(code(page)).toBeEditable();
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  if (assertEmpty) {
    expect(await code(page).inputValue()).not.toContain('printf(');
    expect(await code(page).inputValue()).not.toBe(answers.get(id));
  }
}
/** Only public input declarations are prepared by real Rust; no algorithm is executed here.
 * The normal editor/analysis and original trusted catalog independently validate this typed answer. */
function answerSource(content: ContentPackage, exercise: ExerciseEntity) {
  const program = content.programs.find((entry) => entry.id === exercise.programRef.id)!;
  const catalog = {
    packageRef: { id: content.packageId, version: content.packageVersion },
    subject: exercise,
    program: { ...program, sourceExample: answers.get(exercise.id)! },
    inputSpec: content.inputSpecs.find((entry) => entry.id === program.inputRef.id)!,
    judgeProfile: content.judgeProfiles.find((entry) => entry.id === exercise.judgeRef.id)!,
  };
  const input = exercise.tests[0].input;
  const sorted = Object.fromEntries(
    Object.keys(input)
      .sort()
      .map((key) => [key, input[key]]),
  );
  return (
    JSON.parse(
      new TextDecoder().decode(
        prepare_input(
          JSON.stringify(catalog),
          new TextEncoder().encode(JSON.stringify(sorted)),
          1000,
        ),
      ),
    ) as { source: { text: string } }
  ).source.text;
}
async function fillAnswer(page: Page, content: ContentPackage, exercise: ExerciseEntity) {
  const text = answerSource(content, exercise);
  await code(page).fill(text);
  await expect(code(page)).toHaveValue(text);
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await panel(page).getByRole('button', { name: '准备代码', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', /^(ready|passed)$/);
  await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
}
async function executeCount(page: Page) {
  return page.evaluate(
    () => window.__verticalObservation.workers.filter((entry) => entry.kind === 'execute').length,
  );
}
async function submit(page: Page, saved: 'saved' | 'unsaved' = 'saved') {
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
  if (saved === 'saved') await ready(page);
}
async function captureRuns(
  page: Page,
  content: ContentPackage,
  exercise: ExerciseEntity,
  offset: number,
  folder: string,
  label: string,
) {
  const raw = await page.evaluate(
    (first) =>
      window.__verticalObservation.workers
        .filter((entry) => entry.kind === 'execute')
        .slice(first)
        .map((entry) => ({
          ...(
            entry as typeof entry & {
              captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
            }
          ).captureEncoded(),
          catalogJson: entry.catalogJson,
          moduleSeen: entry.moduleSeen,
          terminated: entry.terminated,
          responseOk: entry.responseOk,
          operationId: entry.operationId,
          responseOperationId: entry.responseOperationId,
        })),
    offset,
  );
  expect(raw).toHaveLength(exercise.tests.length);
  const results = [];
  for (const [index, worker] of raw.entries()) {
    expect(worker.moduleSeen).toBe(true);
    expect(worker.terminated).toBe(true);
    expect(worker.responseOk).toBe(true);
    expect(worker.responseOperationId).toBe(worker.operationId);
    expect(worker.requestBase64).toBeTruthy();
    expect(worker.responseBase64).toBeTruthy();
    expect(worker.catalogJson).toBeTruthy();
    const requestBytes = Buffer.from(worker.requestBase64!, 'base64'),
      responseBytes = Buffer.from(worker.responseBase64!, 'base64');
    const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
    const result = await decodeResult(Uint8Array.from(responseBytes).buffer, request);
    const group = exercise.tests[index];
    expect(request.packageRef).toEqual({ id: content.packageId, version: content.packageVersion });
    expect(request.subjectRef).toEqual({ id: exercise.id, version: exercise.version });
    expect(request.mode).toBe('exercise-test');
    expect(request.identity.testCaseKey).toBe(group.caseKey);
    expect(request.input.values).toEqual(group.input);
    expect(request.remainingMs).toBeGreaterThan(0);
    expect(request.remainingMs).toBeLessThanOrEqual(1000);
    expect(result.producer).toBe('rust');
    expect(result.identity).toEqual(request.identity);
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
    expect(result.judgeResult?.status).toBe('met');
    const stdout = result
      .trace!.steps.flatMap((step) =>
        step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
      )
      .join('');
    expect(stdout).toBe(group.expectedStdout);
    const prefix = `${label}-${String(index + 1).padStart(2, '0')}-${group.caseKey}`;
    await writeFile(join(folder, `${prefix}.request.json`), requestBytes, { flag: 'wx' });
    await writeFile(join(folder, `${prefix}.result.json`), responseBytes, { flag: 'wx' });
    await writeFile(join(folder, `${prefix}.catalog.json`), worker.catalogJson!, { flag: 'wx' });
    results.push({
      exerciseId: exercise.id,
      caseKey: group.caseKey,
      requestSha256: sha(requestBytes),
      resultSha256: sha(responseBytes),
      catalogSha256: sha(worker.catalogJson!),
      steps: result.trace!.steps.length,
      stdout,
      protocolVersion: request.protocolVersion,
      judgeVersion: request.judgeVersion,
      remainingMs: request.remainingMs,
    });
  }
  return results;
}
async function complete(
  page: Page,
  content: ContentPackage,
  lesson: LessonEntity,
  folder: string,
  label: string,
) {
  const exercise = content.exercises.find(
    (entry) => entry.id === lesson.requiredExerciseRefs[0].id,
  )!;
  await openLesson(page, lesson);
  await openAnswer(page, exercise.id);
  await fillAnswer(page, content, exercise);
  const offset = await executeCount(page);
  await submit(page);
  const runs = await captureRuns(page, content, exercise, offset, folder, label);
  await expect(page.getByTestId('lesson-completion')).toHaveAttribute('data-state', 'completed');
  return runs;
}
/** The ordinary independent-case path uses its original execution vector in the new package. */
async function viewAndConfirmCase(page: Page, folder: string, label: string) {
  const subject = current.cases.find((entry) => entry.id === 'case.c.assignment')!;
  const casePanel = page.getByTestId('case-execution');
  const controls = page.getByTestId('player-controls');
  const confirmation = page.getByTestId('case-view-confirmation');
  const coverage = page.getByTestId('case-view-coverage');
  const confirm = confirmation.getByRole('button', { name: '确认已观看', exact: true });
  await page.goto(`/#/visualize/${subject.id}`);
  await expect(casePanel).toHaveAttribute('data-state', 'ready');
  await ready(page);
  const before = await archive(page);
  await page.getByTestId('input-field-x').fill('-7');
  await casePanel.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(casePanel).toHaveAttribute('data-state', 'ready');
  await casePanel.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(casePanel).toHaveAttribute('data-state', 'completed');
  const worker = await observedCaseSetExecute(page);
  expect(worker.moduleSeen).toBe(true);
  expect(worker.responseOk).toBe(true);
  expect(worker.terminated).toBe(true);
  expect(worker.responseOperationId).toBe(worker.operationId);
  const requestBytes = Buffer.from(worker.requestBytes!);
  const resultBytes = Buffer.from(worker.responseBytes!);
  // Preserve actual packets before consumer assertions or viewing can fail.
  await writeFile(join(folder, `${label}.request.json`), requestBytes, { flag: 'wx' });
  await writeFile(join(folder, `${label}.result.json`), resultBytes, { flag: 'wx' });
  await writeFile(join(folder, `${label}.catalog.json`), worker.catalogJson!, { flag: 'wx' });
  const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(resultBytes).buffer, request);
  expect(request.packageRef).toEqual(p05Package);
  expect(request.subjectRef).toEqual({ id: subject.id, version: subject.version });
  expect(request.mode).toBe('case');
  expect(request.input.values).toEqual({ x: -7 });
  expect(request.input.random).toBeNull();
  expect([
    request.protocolVersion,
    request.traceVersion,
    request.diagnosticVersion,
    request.judgeVersion,
    request.encodingVersion,
  ]).toEqual(['1.0.0', '1.0.0', '1.0.0', '1.0.0', '1.0.0']);
  expect(result.producer).toBe('rust');
  expect(result.identity).toEqual(request.identity);
  expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
  expect(result.trace?.completeness).toBe('complete');
  expect(request.source.text).toBe(
    await casePanel.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }).inputValue(),
  );
  const stdout = result
    .trace!.steps.flatMap((step) =>
      step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
    )
    .join('');
  expect(stdout).toBe('-5\n');
  const length = result.trace!.steps.length;
  expect(length).toBeGreaterThan(0);
  await expect(controls).toHaveAttribute('data-cursor', '0');
  await expect(coverage).toHaveAttribute('data-total', String(length));
  await expect(confirm).toBeDisabled();
  const trace = page.getByTestId('trace-view');
  const painted = async () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  await trace.scrollIntoViewIfNeeded();
  await painted();
  const viewedCursors = [0];
  for (let cursor = 1; cursor <= length; cursor++) {
    await controls.getByRole('button', { name: '前进', exact: true }).click();
    await expect(controls).toHaveAttribute('data-cursor', String(cursor));
    await expect(trace).toHaveAttribute('data-cursor', String(cursor));
    await trace.scrollIntoViewIfNeeded();
    await painted();
    await expect(coverage).toHaveAttribute('data-covered', String(cursor));
    viewedCursors.push(cursor);
  }
  await expect(confirmation).toHaveAttribute('data-view-state', 'ready');
  const beforeConfirm = await archive(page);
  stableLearning(before.data, beforeConfirm.data);
  const coverageBeforeConfirm = {
    covered: Number(await coverage.getAttribute('data-covered')),
    total: Number(await coverage.getAttribute('data-total')),
  };
  await confirm.click();
  await expect(confirmation).toHaveAttribute('data-view-state', 'saved');
  await ready(page);
  const saved = await archive(page);
  noExecutionPersistence(saved.data);
  return {
    saved,
    run: {
      label,
      packageRef: request.packageRef,
      subjectRef: request.subjectRef,
      mode: request.mode,
      identity: request.identity,
      requestSha256: sha(requestBytes),
      resultSha256: sha(resultBytes),
      catalogSha256: sha(worker.catalogJson!),
      steps: length,
      stdout,
      viewedCursors,
      coverageBeforeConfirm,
      before,
      beforeConfirm,
    },
  };
}
async function openGoals(page: Page) {
  await page.goto('/#/?panel=goals');
  await ready(page);
  await expect(page.getByRole('dialog', { name: '每日目标', exact: true })).toBeVisible();
}
async function fillTargets(page: Page, value: GoalTargets) {
  const form = page.getByTestId('daily-goal-settings');
  for (const [name, count] of [
    ['每日练习数', value.exercise],
    ['每日小节数', value.lesson],
    ['每日案例数', value.case],
  ] as const)
    await form.getByRole('spinbutton', { name, exact: true }).fill(String(count));
}
async function saveTargets(page: Page, value: GoalTargets) {
  await fillTargets(page, value);
  await page
    .getByTestId('daily-goal-settings')
    .getByRole('button', { name: '保存自定义目标', exact: true })
    .click();
  await ready(page);
  await expect(page.getByTestId('goal-template-saved')).toContainText('目标已保存');
}

test('P05 fresh archive: 32 real code answers and 140 groups produce 32 confirmed completions and durable deduplicated rewards', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  bundlePath();
  const folder = await directory(info, 'fresh-32');
  expect(await page.context().storageState({ indexedDB: true })).toEqual({
    cookies: [],
    origins: [],
  });
  await page.goto('/#/courses');
  await ready(page);
  await expect(page.locator('[data-course-lesson]')).toHaveCount(32);
  const initial = await archive(page);
  expect(initial.databaseVersion).toBe(7);
  expect(initial.stores).toHaveLength(15);
  expect(initial.data.meta.activePackageRef).toEqual(p05Package);
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'] as const)
    expect(initial.data[key]).toEqual([]);
  const runs = [];
  for (const [index, lesson] of current.lessons.entries()) {
    const next = await complete(
      page,
      current,
      lesson,
      folder,
      `lesson-${String(index + 1).padStart(2, '0')}`,
    );
    runs.push(...next);
    const data = (await archive(page)).data;
    expect(data.progress.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(
      index + 1,
    );
    expect(data.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(
      index + 1,
    );
    if ([0, 19, 29].includes(index))
      await page.screenshot({ path: join(folder, `lesson-${index + 1}.png`), fullPage: true });
  }
  expect(runs).toHaveLength(140);
  const completed = await archive(page);
  expect(posted(completed.data, 'reward.exercise.first-pass')).toBe(320);
  expect(posted(completed.data, 'reward.lesson.first-completion')).toBe(640);
  expect(posted(completed.data, 'reward.daily-goal.once')).toBe(5);
  expect(posted(completed.data)).toBe(965);
  expect(completed.data.ledger).toHaveLength(65);
  expect(
    completed.data.progress.filter((row) => row.eventType === 'lesson.study-confirmed'),
  ).toHaveLength(32);
  noExecutionPersistence(completed.data);
  await page.goto('/#/courses');
  await page.reload();
  await ready(page);
  const refreshed = await archive(page);
  stableLearning(completed.data, refreshed.data);
  await openAnswer(page, current.exercises[0].id);
  await fillAnswer(page, current, current.exercises[0]);
  await submit(page);
  const repeated = await archive(page);
  expect(repeated.data.ledger).toEqual(completed.data.ledger);
  expect(repeated.data.dailyFacts).toEqual(completed.data.dailyFacts);
  expect(repeated.data.progress.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(
    32,
  );
  await page.goto('/#/cases');
  // The directory has no save panel; its shell reports the shared archive state.
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  const caseLinks = page.locator('.case-grid .case-card .card-link[href^="#/visualize/"]');
  await expect(caseLinks).toHaveCount(7);
  const caseDirectoryIds = await caseLinks.evaluateAll((links) =>
    links.map((link) =>
      decodeURIComponent((link as HTMLAnchorElement).hash.split('/visualize/')[1] ?? ''),
    ),
  );
  expect([...caseDirectoryIds].sort()).toEqual(current.cases.map((entry) => entry.id).sort());
  const once = await viewAndConfirmCase(page, folder, 'case-first');
  const caseOnce = once.saved;
  expect(posted(caseOnce.data, 'reward.case.first-view')).toBe(5);
  expect(posted(caseOnce.data)).toBe(970);
  expect(caseOnce.data.ledger).toHaveLength(66);
  const caseProgress = caseOnce.data.progress.filter(
    (row) => row.eventType === 'case.view-confirmed',
  );
  expect(caseProgress).toHaveLength(1);
  expect(caseProgress[0]).toMatchObject({
    packageRef: p05Package,
    subjectRef: { id: 'case.c.assignment', version: '1.1.0' },
  });
  await page.reload();
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await ready(page);
  const caseRefreshed = await archive(page);
  stableLearning(caseOnce.data, caseRefreshed.data);
  const twice = await viewAndConfirmCase(page, folder, 'case-repeat');
  const caseRepeated = twice.saved;
  expect(twice.run.identity.runId).not.toBe(once.run.identity.runId);
  expect(caseRepeated.data.ledger).toEqual(caseOnce.data.ledger);
  expect(caseRepeated.data.dailyFacts).toEqual(caseOnce.data.dailyFacts);
  expect(posted(caseRepeated.data)).toBe(970);
  expect(
    caseRepeated.data.progress.filter((row) => row.eventType === 'case.view-confirmed'),
  ).toHaveLength(1);
  expect(
    caseRepeated.data.receipts.filter((row) => row.eventType === 'case.view-confirmed'),
  ).toHaveLength(2);
  await record(folder, 'complete-evidence', {
    kind: 'real-native-ui-learning',
    browserVersion: page.context().browser()?.version(),
    initial,
    completed,
    refreshed,
    repeated,
    runs,
    groups: 140,
    repeatSubmissions: 1,
    caseDirectoryIds,
    caseOnce,
    caseRefreshed,
    caseRepeated,
    caseRuns: [once.run, twice.run],
  });
});

test('P05 upgrade: six genuinely completed old lessons retain their exact records, points and opened-day targets while becoming 6 of 32', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const target = bundlePath(),
    folder = await directory(info, 'real-six-upgrade');
  await page.route(`**${target}`, (route) =>
    route.fulfill({ status: 404, body: 'Explicit legacy fallback test' }),
  );
  await page.goto('/#/courses');
  await ready(page);
  await expect(page.getByTestId('course-fallback')).toBeVisible();
  await expect(page.locator('[data-course-lesson]')).toHaveCount(6);
  await openGoals(page);
  await saveTargets(page, { exercise: 6, lesson: 6, case: 1 });
  const runs = [];
  for (const [index, lesson] of legacy.lessons.entries())
    runs.push(...(await complete(page, legacy, lesson, folder, `old-${index + 1}`)));
  expect(runs).toHaveLength(24);
  const old = await archive(page);
  expect(old.data.meta.activePackageRef).toEqual({ id: 'content.c.p0', version: '1.0.2' });
  expect(old.data.settings.goalTemplate?.targets).toEqual({ exercise: 6, lesson: 6, case: 1 });
  expect(old.data.goals).toHaveLength(1);
  expect(old.data.goals[0].targets).toEqual({ exercise: 6, lesson: 6, case: 1 });
  expect(posted(old.data)).toBe(180);
  await page.unroute(`**${target}`);
  await page.reload();
  await ready(page);
  await page.goto('/#/courses');
  await expect(page.locator('[data-course-lesson]')).toHaveCount(32);
  const upgraded = await archive(page);
  expect(upgraded.data.meta.activePackageRef).toEqual(p05Package);
  stableLearning(old.data, upgraded.data);
  expect(upgraded.data.settings).toEqual(old.data.settings);
  const newIds = new Set(
    current.exercises
      .filter((entry) => !legacy.exercises.some((oldEntry) => oldEntry.id === entry.id))
      .map((entry) => entry.id),
  );
  expect(upgraded.data.progress.filter((row) => newIds.has(row.subjectRef.id))).toEqual([]);
  for (const lesson of legacy.lessons) {
    await openLesson(
      page,
      current.lessons.find((entry) => entry.id === lesson.id)!,
      false,
    );
    await expect(page.getByTestId('lesson-completion')).toHaveAttribute('data-state', 'completed');
  }
  await openLesson(
    page,
    current.lessons.find((entry) => !legacy.lessons.some((oldEntry) => oldEntry.id === entry.id))!,
    false,
  );
  await expect(page.getByTestId('lesson-completion')).toHaveAttribute('data-state', 'incomplete');
  const beforeRepeat = (await archive(page)).data;
  const echo = current.exercises.find((entry) => entry.id === 'exercise.c.echo')!;
  await openAnswer(page, echo.id);
  await fillAnswer(page, current, echo);
  await submit(page);
  const repeated = await archive(page);
  expect(repeated.data.ledger).toEqual(beforeRepeat.ledger);
  expect(repeated.data.goals).toEqual(beforeRepeat.goals);
  expect(repeated.data.settings.goalTemplate).toEqual(old.data.settings.goalTemplate);
  noExecutionPersistence(repeated.data);
  await record(folder, 'upgrade-evidence', {
    kind: 'real-old-application-then-new-release',
    old,
    upgraded,
    repeated,
    runs,
    oldGroups: 24,
    compatibleCompletedLessons: 6,
    currentLessonCount: 32,
  });
});

interface QuotaFault {
  armed: boolean;
  attempted: Receipt[];
}
async function installQuota(page: Page) {
  await page.addInitScript(() => {
    const state: QuotaFault = { armed: false, attempted: [] };
    Object.assign(window, { __p05PassQuota: state });
    const native = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (
        this.name === 'receipts' &&
        (value as { eventType?: string })?.eventType === 'exercise.passed'
      ) {
        state.attempted.push(structuredClone(value as Receipt));
        if (state.armed) {
          state.armed = false;
          throw new DOMException('P05 isolated pass transaction abort', 'QuotaExceededError');
        }
      }
      return key === undefined ? native.call(this, value) : native.call(this, value, key);
    };
  });
}
test('P05 native quota and goal bounds: a real new pass saves atomically on retry, 32 is valid and 33 or all-zero is refused without rewriting today', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  bundlePath();
  const folder = await directory(info, 'quota-goal-bounds');
  await installQuota(page);
  const exercise = current.exercises.find((entry) => entry.id === 'exercise.c.first-output')!;
  const lesson = current.lessons.find((entry) => entry.id === exercise.lessonRef.id)!;
  await openLesson(page, lesson);
  await openAnswer(page, exercise.id);
  await fillAnswer(page, current, exercise);
  const before = await archive(page);
  await page.evaluate(() => {
    (window as unknown as { __p05PassQuota: QuotaFault }).__p05PassQuota.armed = true;
  });
  const offset = await executeCount(page);
  await submit(page, 'unsaved');
  const runs = await captureRuns(page, current, exercise, offset, folder, 'quota-real-pass');
  const failed = await archive(page);
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(failed.data[key]).toEqual(before.data[key]);
  const attempted = await page.evaluate(
    () => (window as unknown as { __p05PassQuota: QuotaFault }).__p05PassQuota.attempted[0],
  );
  expect(attempted.eventType).toBe('exercise.passed');
  await code(page).fill('#include <stdio.h>\nint main(void) { printf("wrong\\n"); return 0; }\n');
  await expect(panel(page)).not.toHaveAttribute('data-state', 'passed');
  await page.goto('/#/courses');
  await save(page).getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await ready(page);
  const retried = await archive(page),
    received = retried.data.receipts.find((entry) => entry.eventId === attempted.eventId)!;
  expect(received).toBeTruthy();
  const { committedRevision: ignoredFirst, ...originalSummary } = attempted;
  const { committedRevision: ignoredSecond, ...receivedSummary } = received;
  expect(ignoredFirst).toBeGreaterThan(0);
  expect(ignoredSecond).toBeGreaterThan(0);
  expect(receivedSummary).toEqual(originalSummary);
  await openGoals(page);
  const form = page.getByTestId('daily-goal-settings');
  for (const value of [
    { exercise: 33, lesson: 0, case: 0 },
    { exercise: 0, lesson: 33, case: 0 },
    { exercise: 0, lesson: 0, case: 8 },
    { exercise: 0, lesson: 0, case: 0 },
  ]) {
    await fillTargets(page, value);
    await expect(form.getByRole('button', { name: '保存自定义目标', exact: true })).toBeDisabled();
    expect((await archive(page)).data.settings).toEqual(retried.data.settings);
  }
  await saveTargets(page, { exercise: 32, lesson: 32, case: 7 });
  const maximum = await archive(page);
  expect(maximum.data.settings.goalTemplate?.targets).toEqual({
    exercise: 32,
    lesson: 32,
    case: 7,
  });
  stableLearning(retried.data, maximum.data);
  noExecutionPersistence(maximum.data);
  await page.reload();
  await ready(page);
  expect((await archive(page)).data.settings.goalTemplate).toEqual(
    maximum.data.settings.goalTemplate,
  );
  await record(folder, 'quota-and-goal-evidence', {
    kind: 'real-execution-with-native-IDB-fault',
    before,
    failed,
    attempted,
    retried,
    maximum,
    runs,
  });
});

test('P05 multiple tabs: package CAS invalidates an accepted old run and a later native clear cannot revive it or mint a pass', async ({
  page,
  context,
}, info) => {
  test.setTimeout(90_000);
  const target = bundlePath(),
    folder = await directory(info, 'tabs-package-and-clear');
  await page.route(`**${target}`, (route) =>
    route.fulfill({ status: 404, body: 'Old tab remains on the complete legacy release' }),
  );
  const echo = legacy.exercises.find((entry) => entry.id === 'exercise.c.echo')!;
  await openAnswer(page, echo.id);
  await fillAnswer(page, legacy, echo);
  await panel(page).getByRole('button', { name: '运行本组', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  await expect(page.getByTestId('practice-run-only')).toBeVisible();
  const oldWire = await observedCaseSetExecute(page);
  const oldRequest = JSON.parse(
    Buffer.from(oldWire.requestBytes!).toString('utf8'),
  ) as ExecuteRequest;
  const oldResultBytes = Buffer.from(oldWire.responseBytes!);
  const oldResult = await decodeResult(Uint8Array.from(oldResultBytes).buffer, oldRequest);
  expect(oldResult.producer).toBe('rust');
  expect(oldResult.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
  expect(oldResult.judgeResult?.status).toBe('met');
  expect(oldRequest.packageRef).toEqual({ id: 'content.c.p0', version: '1.0.1' });
  await writeFile(
    join(folder, 'accepted-old-run.request.json'),
    Buffer.from(oldWire.requestBytes!),
    { flag: 'wx' },
  );
  await writeFile(join(folder, 'accepted-old-run.result.json'), oldResultBytes, { flag: 'wx' });
  await writeFile(join(folder, 'accepted-old-run.catalog.json'), oldWire.catalogJson!, {
    flag: 'wx',
  });
  const acceptedOld = await archive(page);
  expect(acceptedOld.data.progress).toEqual([]);
  expect(acceptedOld.data.ledger).toEqual([]);
  const other = await context.newPage();
  await other.clock.setFixedTime(fixedDate);
  await other.goto('/#/courses');
  await ready(other);
  await expect(other.locator('[data-course-lesson]')).toHaveCount(32);
  await expect
    .poll(async () => (await archive(page)).data.meta.activePackageRef)
    .toEqual(p05Package);
  await expect(page.getByTestId('practice-run-only')).toHaveCount(0);
  const switched = await archive(other);
  stableLearning(acceptedOld.data, switched.data);
  await other.goto('/#/settings?panel=data');
  await ready(other);
  await other.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await other
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(save(other)).toContainText('本地数据已清除');
  await expect
    .poll(async () => (await archive(page)).data.meta.generation)
    .not.toBe(switched.data.meta.generation);
  const cleared = await archive(other);
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'] as const)
    expect(cleared.data[key]).toEqual([]);
  await expect(page.getByTestId('practice-run-only')).toHaveCount(0);
  await page.unroute(`**${target}`);
  await page.reload();
  await ready(page);
  const reloaded = await archive(page);
  expect(reloaded.data.meta.generation).toBe(cleared.data.meta.generation);
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(reloaded.data[key]).toEqual([]);
  noExecutionPersistence(reloaded.data);
  await record(folder, 'multi-tab-evidence', {
    kind: 'real-old-run-new-package-CAS-and-native-clear',
    acceptedOld,
    switched,
    cleared,
    reloaded,
  });
  await other.close();
});

test('P05 partial old archive: confirmation-only and pass-only histories remain partial while an uncommitted old accepted event cannot become a new pass', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const target = bundlePath(),
    folder = await directory(info, 'partial-old-and-pending');
  await installQuota(page);
  await page.route(`**${target}`, (route) =>
    route.fulfill({ status: 404, body: 'Complete legacy curriculum for partial-history upgrade' }),
  );
  const echoLesson = legacy.lessons.find((entry) => entry.id === 'lesson.c.variables-output')!;
  const expression = legacy.exercises.find((entry) => entry.id === 'exercise.c.two-x-plus-three')!;
  const branch = legacy.exercises.find((entry) => entry.id === 'exercise.c.nonnegative')!;
  await openLesson(page, echoLesson);
  await openAnswer(page, expression.id);
  await fillAnswer(page, legacy, expression);
  let offset = await executeCount(page);
  await submit(page);
  const passOnlyRuns = await captureRuns(page, legacy, expression, offset, folder, 'pass-only');
  await openAnswer(page, branch.id);
  await fillAnswer(page, legacy, branch);
  const beforePending = await archive(page);
  expect(beforePending.data.progress.filter((row) => row.eventType === 'lesson.completed')).toEqual(
    [],
  );
  expect(
    beforePending.data.progress
      .filter((row) => row.eventType === 'exercise.passed')
      .map((row) => row.subjectRef.id),
  ).toEqual([expression.id]);
  await page.evaluate(() => {
    (window as unknown as { __p05PassQuota: QuotaFault }).__p05PassQuota.armed = true;
  });
  offset = await executeCount(page);
  await submit(page, 'unsaved');
  const pendingRuns = await captureRuns(
    page,
    legacy,
    branch,
    offset,
    folder,
    'accepted-but-unsaved',
  );
  const pending = await archive(page);
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(pending.data[key]).toEqual(beforePending.data[key]);
  const attempted = await page.evaluate(() =>
    (window as unknown as { __p05PassQuota: QuotaFault }).__p05PassQuota.attempted.findLast(
      (row) => row.eventType === 'exercise.passed',
    ),
  );
  expect(attempted?.eventType).toBe('exercise.passed');
  await page.unroute(`**${target}`);
  await page.goto('/#/courses');
  await page
    .getByTestId('course-fallback')
    .getByRole('button', { name: '重试扩充课程', exact: true })
    .click();
  await ready(page);
  await expect(page.locator('[data-course-lesson]')).toHaveCount(32);
  const upgraded = await archive(page);
  expect(upgraded.data.meta.activePackageRef).toEqual(p05Package);
  stableLearning(beforePending.data, upgraded.data);
  expect(upgraded.data.receipts.some((row) => row.eventId === attempted!.eventId)).toBe(false);
  await openLesson(
    page,
    current.lessons.find((entry) => entry.id === echoLesson.id)!,
    false,
  );
  await expect(page.getByTestId('lesson-completion')).toHaveAttribute('data-state', 'incomplete');
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
  await expect(page.getByTestId('lesson-exercise-check')).toHaveAttribute('data-saved', 'no');
  await openLesson(
    page,
    current.lessons.find((entry) => entry.id === expression.lessonRef.id)!,
    false,
  );
  await expect(page.getByTestId('lesson-completion')).toHaveAttribute('data-state', 'incomplete');
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'no');
  await expect(page.getByTestId('lesson-exercise-check')).toHaveAttribute('data-saved', 'yes');
  await openLesson(
    page,
    current.lessons.find((entry) => entry.id === branch.lessonRef.id)!,
    false,
  );
  await expect(page.getByTestId('lesson-exercise-check')).toHaveAttribute('data-saved', 'no');
  await expect(save(page).getByRole('button', { name: '重试未保存操作', exact: true })).toHaveCount(
    0,
  );
  const final = await archive(page);
  stableLearning(upgraded.data, final.data);
  noExecutionPersistence(final.data);
  await record(folder, 'partial-upgrade-evidence', {
    kind: 'real-old-actions-and-native-uncommitted-pass-fault',
    beforePending,
    pending,
    attempted,
    upgraded,
    final,
    passOnlyRuns,
    pendingRuns,
  });
});

/** Fault injection only changes rows that were genuinely produced above. It never creates a passing row. */
async function damageExistingProgress(page: Page, mode: 'foreign-package' | 'malformed-row') {
  return page.evaluate(async (kind) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction(['meta', 'progress'], 'readwrite');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const changed: { key: IDBValidKey; before: unknown; after: unknown }[] = [];
      const cursor = transaction.objectStore('progress').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const value = row.value as StorageSnapshot['progress'][number];
        const targeted = ['lesson.c.variables-output', 'exercise.c.echo'].includes(
          value.subjectRef.id,
        );
        if (targeted && (kind === 'foreign-package' || value.eventType === 'exercise.passed')) {
          const after =
            kind === 'foreign-package'
              ? { ...value, packageRef: { id: 'content.c.unreviewed', version: '1.0.0' } }
              : { ...value, result: 'native-corruption-marker' };
          changed.push({ key: row.primaryKey, before: structuredClone(value), after });
          row.update(after);
        }
        row.continue();
      };
      const meta = transaction.objectStore('meta').get('current');
      meta.onsuccess = () =>
        transaction
          .objectStore('meta')
          .put(
            { ...meta.result, revision: (meta.result as StorageSnapshot['meta']).revision + 1 },
            'current',
          );
      await done;
      return changed;
    } finally {
      db.close();
    }
  }, mode);
}

test('P05 native corruption: foreign-package and damaged versions of genuinely earned progress remain stored but cannot grant current completion or new rewards', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const target = bundlePath(),
    folder = await directory(info, 'native-damaged-and-foreign');
  await page.route(`**${target}`, (route) =>
    route.fulfill({ status: 404, body: 'Earn real prior evidence before fault injection' }),
  );
  const lesson = legacy.lessons.find((entry) => entry.id === 'lesson.c.variables-output')!;
  const runs = await complete(page, legacy, lesson, folder, 'genuinely-earned-old');
  const earned = await archive(page);
  expect(posted(earned.data)).toBe(35);
  const changedPackages = await damageExistingProgress(page, 'foreign-package');
  expect(changedPackages.length).toBeGreaterThanOrEqual(3);
  const foreign = await archive(page);
  const newLesson = current.lessons.find((entry) => entry.id === lesson.id)!;
  await page.unroute(`**${target}`);
  await page.goto(`/#/lessons/${newLesson.id}`);
  await page.reload();
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await expect(save(page)).not.toHaveAttribute('data-save-status', 'loading');
  await expect(page.getByTestId('lesson-completion')).not.toHaveAttribute(
    'data-state',
    'completed',
  );
  const ignored = await archive(page);
  expect(ignored.data.progress).toEqual(foreign.data.progress);
  expect(ignored.data.ledger).toEqual(earned.data.ledger);
  expect(ignored.data.receipts).toEqual(earned.data.receipts);
  expect(ignored.data.aliases).toEqual(earned.data.aliases);
  expect(ignored.data.progress.every((row) => row.packageRef.id === 'content.c.unreviewed')).toBe(
    true,
  );
  const corruptedRows = await damageExistingProgress(page, 'malformed-row');
  expect(corruptedRows).toHaveLength(1);
  const malformed = await archive(page);
  await page.reload();
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await expect(save(page)).toContainText('损坏记录');
  await expect(page.getByTestId('lesson-completion')).not.toHaveAttribute(
    'data-state',
    'completed',
  );
  const retained = await archive(page);
  expect(retained.data.progress).toEqual(malformed.data.progress);
  expect(retained.data.ledger).toEqual(earned.data.ledger);
  expect(retained.data.receipts).toEqual(earned.data.receipts);
  expect(retained.data.meta.generation).toBe(earned.data.meta.generation);
  await record(folder, 'native-corruption-evidence', {
    kind: 'native-fault-injection-after-real-earned-legacy-pass-no-synthetic-success',
    earned,
    changedPackages,
    foreign,
    ignored,
    corruptedRows,
    malformed,
    retained,
    runs,
  });
});
