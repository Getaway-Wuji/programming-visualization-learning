import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { ExerciseEntity } from '../../web/src/content/types';
import {
  decodeResult,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../web/src/engine/protocol';
import { observeCaseSetExecution } from './case-set-observation';
import { blockWorkspace, correctStarter, wrongEcho } from './block-ui';

const reviewed = JSON.parse(
  readFileSync(new URL('../../content/c/p0/course-1.0.1.json', import.meta.url), 'utf8'),
) as { exercises: ExerciseEntity[] };
const exercises = reviewed.exercises;
const resource = '**/content/practice/course-practice-1.0.0.json';
const practicePath = (id: string) => `/#/practice/${encodeURIComponent(id)}`;
const panel = (page: Page) => page.getByTestId('practice-execution');
const feedback = (page: Page) => page.getByTestId('practice-feedback');
const submit = (page: Page) => panel(page).getByRole('button', { name: '提交练习', exact: true });

// The existing temporary-judgement regressions stay explicitly outside 09.4
// authorization. Native nine-store equality remains meaningful for this scope.
test.beforeEach(async ({ context }) => {
  await context.route('**/content/learning/course-learning-*.json', (route) =>
    route.fulfill({ status: 503, body: 'isolated learning authorization unavailable' }),
  );
});

interface NativeSnapshot {
  stores: Record<string, unknown[]>;
  local: Record<string, string>;
  session: Record<string, string>;
}

/** Read all eleven production stores; never seed exercise-passed rows. */
async function archive(page: Page): Promise<NativeSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const transaction = db.transaction(names, 'readonly');
      const complete = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const stores = Object.fromEntries(
        await Promise.all(
          names.map(async (name) => {
            const rows = await new Promise<unknown[]>((resolve, reject) => {
              const request = transaction.objectStore(name).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return [name, rows];
          }),
        ),
      );
      await complete;
      return {
        stores,
        local: Object.fromEntries(Object.entries(localStorage)),
        session: Object.fromEntries(Object.entries(sessionStorage)),
      };
    } finally {
      db.close();
    }
  });
}

async function initialized(page: Page) {
  await page.goto('/#/settings?panel=display');
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  const initial = await archive(page);
  expect(Object.keys(initial.stores).sort()).toEqual([
    'aliases',
    'appearance',
    'appearanceAssets',
    'avatar',
    'dailyFacts',
    'goals',
    'ledger',
    'meta',
    'progress',
    'receipts',
    'settings',
  ]);
  expect(initial.stores.appearanceAssets).toEqual([]);
  expect(initial.stores.appearance).toHaveLength(1);
  return initial;
}

async function open(page: Page, id: string) {
  await page.goto(practicePath(id));
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(blockWorkspace(page)).toBeVisible();
  await expect(submit(page)).toBeEnabled();
  await expect(
    page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }),
  ).not.toHaveValue('');
}

async function complete(page: Page, expected: 'passed' | 'unmet') {
  await prepare(page);
  await submit(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', expected);
  await expect(feedback(page)).toBeVisible();
}

async function prepare(page: Page) {
  await panel(page).getByRole('button', { name: '准备代码', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(submit(page)).toBeEnabled();
  await expect(
    page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }),
  ).not.toHaveValue('');
}

async function noAcceptedResult(page: Page) {
  await expect(feedback(page)).toBeVisible();
  await expect(feedback(page).getByRole('heading', { level: 3 })).toHaveText('本次提交与反馈');
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await expect(page.getByTestId('source-step-highlight')).toHaveCount(0);
}

interface Capture {
  id: number;
  operationId: string | null;
  responseOperationId: string | null;
  moduleSeen: boolean;
  terminated: boolean;
  requestBase64: string | null;
  responseBase64: string | null;
  catalogJson: string | null;
  timing: { postMessageAt: number | null; responseAt: number | null; terminatedAt: number | null };
}
interface Run {
  capture: Capture;
  request: ExecuteRequest;
  result: ExecuteResult;
}

async function observed(page: Page): Promise<Run[]> {
  // Deferred base64 extraction runs after acceptance, preserving the product's 1000ms deadline.
  const captures = await page.evaluate(() =>
    window.__verticalObservation.workers
      .filter((worker) => worker.kind === 'execute')
      .map((worker) => {
        const record = worker as typeof worker & {
          captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
          timing: Capture['timing'];
        };
        return {
          id: record.id,
          operationId: record.operationId,
          responseOperationId: record.responseOperationId,
          moduleSeen: record.moduleSeen,
          terminated: record.terminated,
          catalogJson: record.catalogJson,
          timing: record.timing,
          ...record.captureEncoded(),
        };
      }),
  );
  return Promise.all(
    captures
      .filter((capture) => capture.responseBase64)
      .map(async (capture) => {
        expect(capture.requestBase64).toBeTruthy();
        expect(capture.moduleSeen).toBe(true);
        expect(capture.operationId).toBe(capture.responseOperationId);
        const request = JSON.parse(
          Buffer.from(capture.requestBase64!, 'base64').toString('utf8'),
        ) as ExecuteRequest;
        const bytes = Uint8Array.from(Buffer.from(capture.responseBase64!, 'base64'));
        const result = await decodeResult(bytes.buffer, request);
        return { capture, request, result };
      }),
  );
}

async function executeCount(page: Page) {
  return page.evaluate(
    () => window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
  );
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  exercise: ExerciseEntity,
  label: string,
  skip = 0,
) {
  const runs = (await observed(page)).slice(skip);
  const path = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '09.4',
    'browser-practice-regression',
    testInfo.project.name,
    exercise.id,
    label,
  );
  await mkdir(path, { recursive: true });
  for (const [index, run] of runs.entries()) {
    const prefix = `${index + 1}-${run.request.identity.testCaseKey}`;
    await writeFile(
      join(path, `${prefix}.request.json`),
      Buffer.from(run.capture.requestBase64!, 'base64'),
    );
    await writeFile(
      join(path, `${prefix}.result.json`),
      Buffer.from(run.capture.responseBase64!, 'base64'),
    );
    await writeFile(join(path, `${prefix}.catalog.json`), run.capture.catalogJson!);
  }
  await writeFile(
    join(path, 'ui.json'),
    JSON.stringify(
      {
        exerciseId: exercise.id,
        state: await panel(page).getAttribute('data-state'),
        feedback: await feedback(page).innerText(),
        source: await page
          .getByRole('textbox', { name: '当前执行的 C 代码', exact: true })
          .inputValue(),
        workers: runs.map(({ request, result, capture }) => ({
          identity: request.identity,
          remainingMs: request.remainingMs,
          terminal: result.terminal,
          judgeResult: result.judgeResult,
          stats: result.stats,
          timing: capture.timing,
        })),
      },
      null,
      2,
    ),
  );
  await testInfo.attach(`${exercise.id}-${label}`, {
    path: join(path, 'ui.json'),
    contentType: 'application/json',
  });
  return runs;
}

function validSubmission(runs: Run[], exercise: ExerciseEntity, passed: boolean) {
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.length).toBeLessThanOrEqual(exercise.tests.length);
  const requests = runs.map((run) => run.request);
  expect(new Set(requests.map((request) => request.identity.submissionId)).size).toBe(1);
  expect(new Set(requests.map((request) => request.identity.contextId)).size).toBe(1);
  expect(new Set(requests.map((request) => request.identity.runId)).size).toBe(runs.length);
  expect(new Set(requests.map((request) => request.identity.sourceRevision)).size).toBe(
    runs.length,
  );
  expect(requests.map((request) => request.identity.testCaseKey)).toEqual(
    exercise.tests.slice(0, runs.length).map((item) => item.caseKey),
  );
  for (const [index, { request, result, capture }] of runs.entries()) {
    const expected = exercise.tests[index];
    expect(request.mode).toBe('exercise-test');
    expect(request.subjectRef).toEqual({ id: exercise.id, version: exercise.version });
    expect(request.input.values).toEqual(expected.input);
    expect(request.judge?.expectedStdout).toBe(expected.expectedStdout);
    expect(request.remainingMs).toBeGreaterThan(0);
    expect(request.remainingMs).toBeLessThanOrEqual(1000);
    if (index) {
      expect(request.remainingMs).toBeLessThan(requests[index - 1].remainingMs);
      expect(capture.timing.postMessageAt!).toBeGreaterThanOrEqual(
        runs[index - 1].capture.timing.terminatedAt!,
      );
    }
    expect(result.producer).toBe('rust');
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
    expect(result.stats?.rustMicros).toBeGreaterThanOrEqual(0);
    expect(result.judgeResult?.caseKey).toBe(expected.caseKey);
    expect(result.trace?.completeness).toBe('complete');
    const checks = result.judgeResult!.checks;
    for (const key of ['input-bindings', 'stdout-exact', 'exit-zero', 'teaching-target']) {
      expect(checks.some((check) => check.key === key)).toBe(true);
    }
    if (passed || index < runs.length - 1) expect(result.judgeResult?.status).toBe('met');
  }
  if (passed) expect(runs).toHaveLength(exercise.tests.length);
  else expect(runs.at(-1)!.result.judgeResult?.status).toBe('unmet');
}

for (const exercise of exercises) {
  test(`${exercise.id}: real Rust rejects an incorrect answer and accepts all frozen tests with explanation and no learning writes`, async ({
    page,
  }, testInfo) => {
    await observeCaseSetExecution(page);
    const requests: { url: string; method: string; body: string | null }[] = [];
    page.on('request', (request) =>
      requests.push({ url: request.url(), method: request.method(), body: request.postData() }),
    );
    const before = await initialized(page);
    await open(page, exercise.id);
    // The published starter intentionally fails one boundary in each exercise.
    await complete(page, 'unmet');
    const failed = await capture(page, testInfo, exercise, 'incorrect');
    validSubmission(failed, exercise, false);
    await expect(feedback(page)).toContainText(/未满足|未通过/);
    await expect(feedback(page)).toContainText(/教学|目标|检查/);
    const failureCase = failed.at(-1)!.request.identity.testCaseKey!;
    await expect(feedback(page)).toContainText(failureCase);
    expect(await archive(page)).toEqual(before);

    const count = failed.length;
    await correctStarter(page, exercise.id);
    await noAcceptedResult(page);
    await complete(page, 'passed');
    const passed = await capture(page, testInfo, exercise, 'correct', count);
    validSubmission(passed, exercise, true);
    expect(passed[0].request.identity.submissionId).not.toBe(
      failed[0].request.identity.submissionId,
    );
    expect(passed[0].request.identity.contextRevision).toBeGreaterThan(
      failed[0].request.identity.contextRevision,
    );
    await expect(feedback(page)).toContainText(/通过|满足/);
    await expect(feedback(page)).toContainText(exercise.tests.at(-1)!.caseKey);
    await expect(page.getByTestId('practice-retained-case')).toContainText(
      exercise.tests.at(-1)!.caseKey,
    );
    await expect(page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true })).toHaveValue(
      passed.at(-1)!.request.source.text,
    );
    await expect(
      page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }),
    ).toHaveAttribute('readonly', '');
    await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
    if (exercise.id === 'exercise.c.nonnegative') {
      const coverage = passed
        .flatMap((run) => run.result.judgeResult!.coverage)
        .filter((item) => item.visits > 0);
      const sites = new Set(coverage.map((item) => item.siteKey));
      expect(sites.size).toBe(1);
      expect(new Set(coverage.map((item) => item.branch))).toEqual(new Set(['then', 'else']));
      for (const run of passed) {
        const branch = run.result.judgeResult!.coverage[0];
        const mapping = run.request.source.blockMap.find((item) => item.blockId === branch.siteKey);
        const node = run.result.nodeMap.find((item) => item.nodeId === branch.nodeId);
        expect(node?.kind).toBe('if');
        expect(mapping?.byteRange).toEqual(node?.byteRange);
      }
    }
    expect(await archive(page)).toEqual(before);
    expect(
      requests.some((request) => new URL(request.url).pathname.includes('/content/practice/')),
    ).toBe(true);
    for (const request of requests) {
      const url = new URL(request.url);
      expect(url.origin).toBe('http://127.0.0.1:4178');
      expect(url.search).toBe('');
      expect(request.method).toBe('GET');
      expect(request.body).toBeNull();
      expect(url.pathname.endsWith('/course-1.0.1.json')).toBe(false);
    }
  });
}

test('same exercise review and return preserve one accepted trace and cursor; edit, leaving and refresh destroy it', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  const before = await initialized(page);
  const exercise = exercises[0];
  await open(page, exercise.id);
  await correctStarter(page, exercise.id);
  await complete(page, 'passed');
  const count = await executeCount(page);
  const source = await page
    .getByRole('textbox', { name: '当前执行的 C 代码', exact: true })
    .inputValue();
  const controls = page.getByTestId('player-controls');
  await controls.getByRole('button', { name: '前进', exact: true }).click();
  const cursor = await controls.getAttribute('data-cursor');
  await panel(page).getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/practice/${exercise.id}/review$`));
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  await expect(page.getByTestId('trace-view')).toBeInViewport({ ratio: 0.75 });
  expect(await executeCount(page)).toBe(count);
  await expect(page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true })).toHaveValue(
    source,
  );
  await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(controls).toHaveAttribute('data-cursor', cursor!);
  expect(await executeCount(page)).toBe(count);
  await wrongEcho(page);
  await noAcceptedResult(page);
  await panel(page).getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await noAcceptedResult(page);
  await expect(page.getByText(/还没有可复盘的运行/)).toBeVisible();
  expect(await executeCount(page)).toBe(count);
  await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
  await correctStarter(page, exercise.id);
  await complete(page, 'passed');
  await page.goto('/#/courses');
  await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');
  await open(page, exercise.id);
  await noAcceptedResult(page);
  await correctStarter(page, exercise.id);
  await complete(page, 'passed');
  await page.reload();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await noAcceptedResult(page);
  await page.goto(`${practicePath(exercise.id)}/review`);
  await noAcceptedResult(page);
  await expect(page.getByText(/还没有可复盘的运行/)).toBeVisible();
  expect(await archive(page)).toEqual(before);
});

test('another page clearing local data destroys the accepted practice session and never restores it passively', async ({
  page,
  context,
}) => {
  await observeCaseSetExecution(page);
  const before = await initialized(page);
  await open(page, exercises[0].id);
  await correctStarter(page, exercises[0].id);
  await complete(page, 'passed');
  const count = await executeCount(page);
  const settings = await context.newPage();
  await settings.goto('/#/settings?panel=data');
  await expect(settings.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await settings
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(settings.getByTestId('learning-save-status')).toContainText('本地数据已清除');
  await noAcceptedResult(page);
  const cleared = await archive(page);
  expect(cleared.stores.meta).not.toEqual(before.stores.meta);
  for (const name of ['progress', 'receipts', 'ledger', 'dailyFacts'])
    expect(cleared.stores[name]).toEqual([]);
  await page.waitForTimeout(250);
  expect(await executeCount(page)).toBe(count);
  expect(await archive(page)).toEqual(cleared);
});

interface PracticeGate {
  holdNext: boolean;
  held: number;
  release(): void;
}
declare global {
  interface Window {
    __practiceGate: PracticeGate;
  }
}

async function gateOneRealResponse(page: Page) {
  await page.addInitScript(() => {
    const pending: (() => void)[] = [];
    const gate: PracticeGate = {
      holdNext: false,
      held: 0,
      release() {
        pending.splice(0).forEach((deliver) => deliver());
        gate.held = 0;
      },
    };
    window.__practiceGate = gate;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private execute = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (!this.execute || !gate.holdNext || !this.onmessage) return;
          const handler = this.onmessage;
          gate.holdNext = false;
          gate.held++;
          event.stopImmediatePropagation();
          pending.push(() => handler.call(this, event));
        });
      }
      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        this.execute = (message as { kind?: string })?.kind === 'execute';
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
}

test('cancel drops a held real result and a fresh visible submission recovers', async ({
  page,
}, testInfo) => {
  await observeCaseSetExecution(page);
  await gateOneRealResponse(page);
  const before = await initialized(page);
  await open(page, exercises[0].id);
  await correctStarter(page, exercises[0].id);
  await prepare(page);
  await page.evaluate(() => {
    window.__practiceGate.holdNext = true;
  });
  await submit(page).click();
  await expect.poll(() => page.evaluate(() => window.__practiceGate.held)).toBe(1);
  await panel(page).getByRole('button', { name: /取消/ }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'cancelled');
  const count = await executeCount(page);
  await page.evaluate(() => window.__practiceGate.release());
  await page.waitForTimeout(100);
  await expect(panel(page)).toHaveAttribute('data-state', 'cancelled');
  expect(await executeCount(page)).toBe(count);
  await complete(page, 'passed');
  expect(await archive(page)).toEqual(before);
  await testInfo.attach('cancel-fault-scope', {
    body: 'Held one unchanged real Rust Worker response before its production handler, cancelled through the UI, then released that stale response. No fabricated result or learning history was injected.',
    contentType: 'text/plain',
  });
});

test('a withheld real result expires under the original submission deadline and retry receives a new identity', async ({
  page,
}, testInfo) => {
  await observeCaseSetExecution(page);
  await gateOneRealResponse(page);
  const before = await initialized(page);
  await open(page, exercises[0].id);
  await correctStarter(page, exercises[0].id);
  await prepare(page);
  await page.evaluate(() => {
    window.__practiceGate.holdNext = true;
  });
  await submit(page).click();
  await expect.poll(() => page.evaluate(() => window.__practiceGate.held)).toBe(1);
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  await expect(panel(page)).toContainText(/E_DEADLINE|超过|超时|截止/);
  await page.evaluate(() => window.__practiceGate.release());
  await page.waitForTimeout(100);
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  const stale = await page.evaluate(() => {
    const worker = window.__verticalObservation.workers.find((worker) => worker.kind === 'execute');
    if (!worker) throw new Error('No real execute request was observed.');
    const encoded = (
      worker as typeof worker & { captureEncoded(): { requestBase64: string | null } }
    ).captureEncoded().requestBase64;
    if (!encoded) throw new Error('No real execute request bytes were observed.');
    return (JSON.parse(atob(encoded)) as ExecuteRequest).identity;
  });
  await complete(page, 'passed');
  const recovered = (await observed(page)).at(-1)!.request.identity;
  expect(recovered.submissionId).not.toBe(stale.submissionId);
  expect(recovered.runId).not.toBe(stale.runId);
  expect(await archive(page)).toEqual(before);
  await testInfo.attach('deadline-fault-scope', {
    body: 'A real response was withheld past the unchanged production submission deadline. Its bytes were released only after visible expiry; recovery used a fresh public UI submission.',
    contentType: 'text/plain',
  });
});

test('a missing practice release fails closed and its visible retry loads only the approved projection', async ({
  page,
}, testInfo) => {
  const before = await initialized(page);
  await page.route(resource, (route) => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto(practicePath(exercises[0].id));
  await page.reload();
  await expect(panel(page)).toHaveAttribute('data-state', 'failed');
  await expect(submit(page)).toHaveCount(0);
  expect(await archive(page)).toEqual(before);
  await page.unroute(resource);
  await panel(page).getByRole('button', { name: /重试/ }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  expect(await archive(page)).toEqual(before);
  await testInfo.attach('projection-fault-scope', {
    body: 'Only the practice projection GET was replaced with an isolated HTTP 404; visible retry used its normal approved bytes.',
    contentType: 'text/plain',
  });
});
