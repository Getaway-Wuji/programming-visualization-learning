import { editorValue, expectEditorValue } from './editor-value';
import { routeHistoricalApp } from './legacy-app';
import { installC6Packets } from './c6-observation';
import {
  confirmCurrentLesson,
  openCurrentAnswer,
  completeCurrentFirstGroup,
  submitCurrent,
} from './current-course-helpers';
import {
  currentSnapshot,
  currentLocalReady,
  assertCurrentJudge,
  assertNoExecutionPersistence,
  assertLearningEqual,
  currentJudgeCount,
  installCurrentReceiptFault,
  armCurrentReceiptFault,
  currentReceiptFault,
} from './current-practice-observation';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import { c6RewardGroups } from '../../web/src/c6-learning/rewards.generated';

const currentExercises = (
  JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
    chapters: { exercises: C6CourseExercise[] }[];
  }
).chapters.flatMap((c) => c.exercises);
const currentIndex = JSON.parse(
  readFileSync('content/c/primer6-learning/index-1.0.0.json', 'utf8'),
) as { lessons: [string, string, string, string, string, string[]][] };
const currentSources = currentExercises.map((e) => e.referenceSource);
const c6Editor = (page: Page) => page.getByLabel('完整 C 源码 · main.c', { exact: true });
const currentPackage = { id: 'content.c.primer6', version: '2.0.0' };
async function history(page: Page) {
  bundlePath();
  await routeHistoricalApp(page, new URL(test.info().project.use.baseURL as string).origin);
  await page.route('**/content/course/course-bundle-*.json', (r) =>
    r.fulfill({ status: 404, body: 'Real pre-RESET six-course fallback' }),
  );
}
function emptyLearning(data: StorageSnapshot) {
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals', 'aliases'] as const)
    expect(data[store]).toEqual([]);
}
async function clearCurrent(page: Page) {
  await page.goto('/#/settings?panel=data');
  await currentLocalReady(page);
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}
// Historical titles identify the original six gates. Scope48 records the
// approved RESET/current-404 replacement; no legacy UI is used for normal C6.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(installC6Packets);
  test.info().annotations.push({
    type: 'current-contract',
    description:
      '21.6 scope48: current404/44, RESET replaces old32-course compatibility; original title retained.',
  });
});

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
  if ((await editorValue(preference)) !== 'hide') await preference.selectOption('hide');
  await expect(page.getByTestId('practice-editor-layout')).toHaveAttribute(
    'data-blocks-visible',
    'no',
  );
  await expect(code(page)).toBeEditable();
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  if (assertEmpty) {
    expect(await editorValue(code(page))).not.toContain('printf(');
    expect(await editorValue(code(page))).not.toBe(answers.get(id));
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
  await expectEditorValue(code(page), text);
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(code(page)).toBeEditable();
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
    await editorValue(casePanel.getByRole('textbox', { name: '当前执行的 C 代码', exact: true })),
  );
  const stdout = result
    .trace!.steps.flatMap((step) =>
      step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
    )
    .join('');
  expect(stdout).toBe('-5\n');
  await controls.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
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
  assertNoExecutionPersistence(
    saved.data as Awaited<ReturnType<typeof currentSnapshot>>,
    currentSources,
    currentExercises,
  );
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
        const targeted = ['lesson.c6.s2.1', 'exercise.c6.s2.1'].includes(value.subjectRef.id);
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

test('fresh archive: 404 page-end completions and 44 real code answers across 176 groups retain durable deduplicated rewards', async ({
  page,
}, info) => {
  test.setTimeout(900_000);
  const folder = await directory(info, 'fresh-current-404');
  expect(await page.context().storageState({ indexedDB: true })).toEqual({
    cookies: [],
    origins: [],
  });
  await page.goto('/#/courses');
  await currentLocalReady(page);
  await expect(page.locator('.c6-node-list > li')).toHaveCount(19);
  await expect.poll(async () => (await currentSnapshot(page)).settings.goalTemplate).not.toBeNull();
  const initial = await archive(page);
  expect(initial.databaseVersion).toBe(12);
  expect(initial.stores).toHaveLength(23);
  expect(initial.data.meta.activePackageRef).toEqual(currentPackage);
  emptyLearning(initial.data);
  expect(currentIndex.lessons).toHaveLength(404);
  expect(currentExercises).toHaveLength(44);
  for (const lesson of currentIndex.lessons) await confirmCurrentLesson(page, lesson[0]);
  const read = await currentSnapshot(page);
  expect(read.progress.filter((p) => p.eventType === 'lesson.completed')).toHaveLength(404);
  expect(read.progress.filter((p) => p.eventType === 'lesson.study-confirmed')).toHaveLength(404);
  expect(read.receipts).toHaveLength(404);
  const runs = [];
  for (const subject of currentExercises) {
    await openCurrentAnswer(page, subject.ref.id);
    await submitCurrent(page);
    const run = await assertCurrentJudge(page, subject, 'passed');
    runs.push({ request: run.request, caseKeys: run.result.cases.map((c) => c.caseKey) });
  }
  const completed = await currentSnapshot(page);
  expect(runs.flatMap((r) => r.caseKeys)).toHaveLength(176);
  expect(completed.progress.filter((p) => p.eventType === 'lesson.completed')).toHaveLength(404);
  expect(completed.progress.filter((p) => p.eventType === 'exercise.passed')).toHaveLength(44);
  expect(completed.receipts).toHaveLength(448);
  expect(completed.dailyFacts).toHaveLength(448);
  expect(c6RewardGroups.filter((g) => g.lessonIds.length)).toHaveLength(28);
  expect(c6RewardGroups.filter((g) => g.exerciseIds.length)).toHaveLength(19);
  expect(posted(completed, 'reward.lesson.first-completion')).toBe(560);
  expect(posted(completed, 'reward.exercise.first-pass')).toBe(190);
  expect(posted(completed, 'reward.daily-goal.once')).toBe(5);
  expect(posted(completed)).toBe(755);
  expect(completed.ledger).toHaveLength(48);
  assertNoExecutionPersistence(completed, currentSources, currentExercises);
  await page.goto('/#/');
  await page.reload();
  await currentLocalReady(page);
  await expect(page.getByRole('progressbar', { name: 'C 课程完成进度' })).toHaveAttribute(
    'value',
    '404',
  );
  const refreshed = await currentSnapshot(page);
  assertLearningEqual(completed, refreshed);
  await openCurrentAnswer(page, currentExercises[0].ref.id);
  await submitCurrent(page);
  await assertCurrentJudge(page, currentExercises[0], 'passed');
  const repeated = await currentSnapshot(page);
  expect(repeated.ledger).toEqual(completed.ledger);
  expect(repeated.dailyFacts).toEqual(completed.dailyFacts);
  expect(repeated.receipts).toHaveLength(449);
  await page.goto('/#/cases');
  await page.getByText('基础语法与更多案例', { exact: true }).click();
  await currentLocalReady(page);
  const caseLinks = page.locator('.case-grid .case-card .card-link[href^="#/visualize/"]');
  await expect(caseLinks).toHaveCount(7);
  const ids = await caseLinks.evaluateAll((links) =>
    links.map((l) => decodeURIComponent((l as HTMLAnchorElement).hash.split('/visualize/')[1])),
  );
  expect(ids.sort()).toEqual(current.cases.map((c) => c.id).sort());
  const once = await viewAndConfirmCase(page, folder, 'current-case-first');
  expect(posted(once.saved.data)).toBe(760);
  expect(once.saved.data.ledger).toHaveLength(49);
  await page.reload();
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await ready(page);
  const caseRefresh = await currentSnapshot(page);
  assertLearningEqual(once.saved.data as Awaited<ReturnType<typeof currentSnapshot>>, caseRefresh);
  const twice = await viewAndConfirmCase(page, folder, 'current-case-repeat');
  expect(twice.run.identity.runId).not.toBe(once.run.identity.runId);
  expect(twice.saved.data.ledger).toEqual(once.saved.data.ledger);
  expect(twice.saved.data.dailyFacts).toEqual(once.saved.data.dailyFacts);
  expect(
    twice.saved.data.receipts.filter((r) => r.eventType === 'case.view-confirmed'),
  ).toHaveLength(2);
  await record(folder, 'current-complete', {
    initial,
    read,
    completed,
    refreshed,
    repeated,
    runs,
    groups: 176,
    caseDirectoryIds: ids,
    caseRuns: [once.run, twice.run],
    final: twice.saved,
  });
});

test('P05 upgrade: six genuinely completed old lessons retain their exact records, points and opened-day targets while becoming 6 of 32', async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  const folder = await directory(info, 'six-genuine-reset');
  await history(page);
  await page.goto('/#/courses');
  await ready(page);
  await expect(page.locator('[data-course-lesson]')).toHaveCount(6);
  await openGoals(page);
  await saveTargets(page, { exercise: 6, lesson: 6, case: 1 });
  const runs = [];
  for (const [i, lesson] of legacy.lessons.entries())
    runs.push(...(await complete(page, legacy, lesson, folder, `old-${i + 1}`)));
  expect(runs).toHaveLength(24);
  const old = await currentSnapshot(page);
  expect(posted(old)).toBe(180);
  expect(old.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(6);
  expect(old.goals[0].targets).toEqual({ exercise: 6, lesson: 6, case: 1 });
  noExecutionPersistence(old);
  const fresh = await context.newPage();
  await fresh.goto('/#/courses');
  await currentLocalReady(fresh);
  await expect(fresh.locator('.c6-node-list > li')).toHaveCount(19);
  await expect
    .poll(async () => (await currentSnapshot(fresh)).settings.goalTemplate)
    .not.toBeNull();
  const reset = await currentSnapshot(fresh);
  expect(reset.meta.generation).not.toBe(old.meta.generation);
  expect(reset.meta.activePackageRef).toEqual(currentPackage);
  emptyLearning(reset);
  expect(reset.courseActivities).toEqual([]);
  expect(reset.courseDrafts).toEqual([]);
  expect(reset.settings.goalTemplate?.targets).toEqual({ exercise: 1, lesson: 1, case: 0 });
  const { goalTemplate: oldGoal, ...oldPreferences } = old.settings;
  const { goalTemplate: newGoal, ...newPreferences } = reset.settings;
  void oldGoal;
  void newGoal;
  expect(newPreferences).toEqual(oldPreferences);
  expect(reset.avatar).toEqual(old.avatar);
  expect(reset.appearance).toEqual(old.appearance);
  await completeCurrentFirstGroup(fresh);
  await assertCurrentJudge(fresh, currentExercises[0], 'passed');
  const earned = await currentSnapshot(fresh);
  expect(posted(earned)).toBe(35);
  expect(
    earned.progress.some(
      (p) => p.subjectRef.id.startsWith('lesson.c.') || p.subjectRef.id.startsWith('exercise.c.'),
    ),
  ).toBe(false);
  await fresh.reload();
  await currentLocalReady(fresh);
  assertLearningEqual(earned, await currentSnapshot(fresh));
  await openCurrentAnswer(fresh, currentExercises[0].ref.id);
  await submitCurrent(fresh);
  await assertCurrentJudge(fresh, currentExercises[0], 'passed');
  const repeat = await currentSnapshot(fresh);
  expect(repeat.ledger).toEqual(earned.ledger);
  expect(repeat.dailyFacts).toEqual(earned.dailyFacts);
  assertNoExecutionPersistence(repeat, currentSources, currentExercises);
  await record(folder, 'reset', { old, reset, earned, repeat, runs });
  await fresh.close();
});

test('P05 native quota and goal bounds: a real new pass saves atomically on retry, 32 is valid and 33 or all-zero is refused without rewriting today', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const folder = await directory(info, 'current-quota-goal-bounds');
  await installCurrentReceiptFault(page);
  await confirmCurrentLesson(page, 'lesson.c6.s2.1');
  await confirmCurrentLesson(page, 'lesson.c6.s2.2.1');
  await openCurrentAnswer(page, currentExercises[0].ref.id);
  const before = await currentSnapshot(page);
  await armCurrentReceiptFault(page);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict').filter({ hasText: /^通过$/ })).toBeVisible();
  await expect(save(page)).toHaveAttribute('data-save-status', 'unsaved');
  await assertCurrentJudge(page, currentExercises[0], 'passed');
  const failed = await currentSnapshot(page);
  assertLearningEqual(before, failed);
  const attempted = (await currentReceiptFault(page)).attempted.at(-1)!;
  expect(attempted.eventType).toBe('exercise.passed');
  const count = await currentJudgeCount(page);
  await c6Editor(page).fill('int main(void) { return 0; }');
  await page.goto('/#/');
  await save(page).getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await currentLocalReady(page);
  const retried = await currentSnapshot(page);
  const received = retried.receipts.find((r) => r.eventId === attempted.eventId)!;
  expect(received).toBeTruthy();
  const { committedRevision: a, ...wanted } = attempted;
  const { committedRevision: b, ...actual } = received;
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(0);
  expect(actual).toEqual(wanted);
  expect(await currentJudgeCount(page)).toBe(count);
  expect(posted(retried)).toBe(35);
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
    expect((await currentSnapshot(page)).settings).toEqual(retried.settings);
  }
  await saveTargets(page, { exercise: 32, lesson: 32, case: 7 });
  const maximum = await currentSnapshot(page);
  expect(maximum.settings.goalTemplate?.targets).toEqual({ exercise: 32, lesson: 32, case: 7 });
  assertLearningEqual(retried, maximum);
  expect(maximum.goals).toEqual(retried.goals);
  await page.reload();
  await currentLocalReady(page);
  expect((await currentSnapshot(page)).settings.goalTemplate).toEqual(
    maximum.settings.goalTemplate,
  );
  assertNoExecutionPersistence(maximum, currentSources, currentExercises);
  await record(folder, 'quota', { before, failed, attempted, retried, maximum });
});

test('P05 multiple tabs: package CAS invalidates an accepted old run and a later native clear cannot revive it or mint a pass', async ({
  page,
  context,
}, info) => {
  test.setTimeout(90_000);
  const folder = await directory(info, 'real-old-accepted-reset-clear');
  await history(page);
  const echo = legacy.exercises.find((e) => e.id === 'exercise.c.echo')!;
  await openAnswer(page, echo.id);
  await fillAnswer(page, legacy, echo);
  await panel(page).getByRole('button', { name: '运行本组', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  await expect(page.getByTestId('practice-run-only')).toBeVisible();
  const wire = await observedCaseSetExecute(page);
  const req = JSON.parse(Buffer.from(wire.requestBytes!).toString('utf8')) as ExecuteRequest;
  const res = await decodeResult(Uint8Array.from(wire.responseBytes!).buffer, req);
  expect(res.producer).toBe('rust');
  expect(res.judgeResult?.status).toBe('met');
  expect(res.terminal.status).toBe('completed');
  expect(req.packageRef).toEqual({ id: 'content.c.p0', version: '1.0.1' });
  await record(folder, 'actual-old-packet', {
    request: req,
    response: JSON.parse(Buffer.from(wire.responseBytes!).toString('utf8')),
    moduleSeen: wire.moduleSeen,
    terminated: wire.terminated,
  });
  const old = await currentSnapshot(page);
  expect(old.progress).toEqual([]);
  expect(old.ledger).toEqual([]);
  const other = await context.newPage();
  await other.goto('/#/courses');
  await currentLocalReady(other);
  const switched = await currentSnapshot(other);
  expect(switched.meta.generation).not.toBe(old.meta.generation);
  emptyLearning(switched);
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
    'data-save-state',
    'unsaved',
  );
  emptyLearning(await currentSnapshot(other));
  await clearCurrent(other);
  const cleared = await currentSnapshot(other);
  expect(cleared.meta.generation).not.toBe(switched.meta.generation);
  emptyLearning(cleared);
  const oldRetry = save(page).getByRole('button', { name: '重试未保存操作', exact: true });
  if (await oldRetry.count()) await oldRetry.click();
  emptyLearning(await currentSnapshot(other));
  await other.reload();
  await currentLocalReady(other);
  const reloaded = await currentSnapshot(other);
  expect(reloaded.meta.generation).toBe(cleared.meta.generation);
  emptyLearning(reloaded);
  await record(folder, 'tabs', { old, switched, cleared, reloaded });
  await other.close();
});

test('P05 partial old archive: confirmation-only and pass-only histories remain partial while an uncommitted old accepted event cannot become a new pass', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  const folder = await directory(info, 'real-old-partial-unsaved-reset');
  await installQuota(page);
  await history(page);
  const lesson = legacy.lessons.find((l) => l.id === 'lesson.c.variables-output')!;
  const expression = legacy.exercises.find((e) => e.id === 'exercise.c.two-x-plus-three')!;
  const branch = legacy.exercises.find((e) => e.id === 'exercise.c.nonnegative')!;
  await openLesson(page, lesson);
  await openAnswer(page, expression.id);
  await fillAnswer(page, legacy, expression);
  let offset = await executeCount(page);
  await submit(page);
  const passOnly = await captureRuns(page, legacy, expression, offset, folder, 'old-pass-only');
  await openAnswer(page, branch.id);
  await fillAnswer(page, legacy, branch);
  const before = await currentSnapshot(page);
  expect(before.progress.filter((p) => p.eventType === 'lesson.completed')).toEqual([]);
  expect(
    before.progress.filter((p) => p.eventType === 'exercise.passed').map((p) => p.subjectRef.id),
  ).toEqual([expression.id]);
  expect(
    before.progress.some(
      (p) => p.eventType === 'lesson.study-confirmed' && p.subjectRef.id === lesson.id,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    (window as unknown as { __p05PassQuota: QuotaFault }).__p05PassQuota.armed = true;
  });
  offset = await executeCount(page);
  await submit(page, 'unsaved');
  const pendingRuns = await captureRuns(page, legacy, branch, offset, folder, 'old-unsaved');
  const pending = await currentSnapshot(page);
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(pending[key]).toEqual(before[key]);
  const attempted = await page.evaluate(() =>
    (window as unknown as { __p05PassQuota: QuotaFault }).__p05PassQuota.attempted.at(-1)!,
  );
  expect(attempted.eventType).toBe('exercise.passed');
  const fresh = await context.newPage();
  await fresh.goto('/#/');
  await currentLocalReady(fresh);
  const reset = await currentSnapshot(fresh);
  expect(reset.meta.generation).not.toBe(before.meta.generation);
  emptyLearning(reset);
  expect(reset.receipts.some((r) => r.eventId === attempted.eventId)).toBe(false);
  await save(page).getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await expect(save(page)).toHaveAttribute('data-save-status', 'unsaved');
  emptyLearning(await currentSnapshot(fresh));
  await expect(fresh.getByRole('progressbar', { name: 'C 课程完成进度' })).toHaveAttribute(
    'value',
    '0',
  );
  await completeCurrentFirstGroup(fresh);
  await assertCurrentJudge(fresh, currentExercises[0], 'passed');
  const currentEarned = await currentSnapshot(fresh);
  expect(posted(currentEarned)).toBe(35);
  expect(currentEarned.receipts.some((r) => r.eventId === attempted.eventId)).toBe(false);
  await record(folder, 'partial-reset', {
    before,
    pending,
    attempted,
    reset,
    currentEarned,
    passOnly,
    pendingRuns,
  });
  await fresh.close();
});

test('P05 native corruption: foreign-package and damaged versions of genuinely earned progress remain stored but cannot grant current completion or new rewards', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const folder = await directory(info, 'current-native-damaged-foreign');
  await completeCurrentFirstGroup(page);
  await assertCurrentJudge(page, currentExercises[0], 'passed');
  const earned = await currentSnapshot(page);
  expect(posted(earned)).toBe(35);
  const changed = await damageExistingProgress(page, 'foreign-package');
  expect(changed.length).toBeGreaterThanOrEqual(3);
  const foreign = await currentSnapshot(page);
  await page.goto('/#/lessons/lesson.c6.s2.1');
  await page.reload();
  await expect(page.getByTestId('reading-end')).toBeAttached();
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read', 'false');
  const ignored = await currentSnapshot(page);
  expect(ignored.progress).toEqual(foreign.progress);
  expect(ignored.ledger).toEqual(earned.ledger);
  expect(ignored.receipts).toEqual(earned.receipts);
  const corrupted = await damageExistingProgress(page, 'malformed-row');
  expect(corrupted).toHaveLength(1);
  const malformed = await currentSnapshot(page);
  await page.reload();
  await expect(page.getByTestId('reading-end')).toBeAttached();
  await expect(save(page)).toContainText('损坏记录');
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read', 'false');
  const retained = await currentSnapshot(page);
  expect(retained.progress).toEqual(malformed.progress);
  expect(retained.ledger).toEqual(earned.ledger);
  expect(retained.receipts).toEqual(earned.receipts);
  expect(retained.meta.generation).toBe(earned.meta.generation);
  await record(folder, 'corruption', {
    earned,
    changed,
    foreign,
    ignored,
    corrupted,
    malformed,
    retained,
  });
});
