import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { ExerciseEntity, LessonEntity, ProgramEntity } from '../../web/src/content/types';
import type { Receipt, StorageSnapshot } from '../../web/src/storage/model';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { blockOptions, blockWorkspace, selectBlock, showPracticeBlocks } from './block-ui';
import { observeCaseSetExecution } from './case-set-observation';

const reviewed = JSON.parse(
  readFileSync(new URL('../../content/c/p0/course-1.0.1.json', import.meta.url), 'utf8'),
) as { lessons: LessonEntity[]; exercises: ExerciseEntity[]; programs: ProgramEntity[] };
const echo = 'exercise.c.echo';
const panel = (page: Page) => page.getByTestId('practice-execution');
const source = (page: Page) =>
  page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
const action = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
const completion = (page: Page) => page.getByTestId('lesson-completion');
const saved = (page: Page) => page.getByTestId('learning-save-status');

/** Observe the native archive without creating learning facts or execution fixtures. */
async function snapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(Array.from(db.objectStoreNames), 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const rows = await Promise.all(
        Array.from(tx.objectStoreNames).map(async (name) => {
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

function unchangedFacts(before: StorageSnapshot, after: StorageSnapshot) {
  for (const key of ['progress', 'receipts', 'dailyFacts', 'ledger', 'goals'] as const)
    expect(after[key]).toEqual(before[key]);
}

async function ready(page: Page, id = echo) {
  await page.goto(`/#/practice/${id}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await showPracticeBlocks(page);
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  await expect(saved(page)).toHaveAttribute('data-save-status', 'ready');
  await expect(
    page.getByTestId('practice-mode').getByRole('button', { name: '独立练习', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
}

async function mode(page: Page, name: '独立练习' | '改错练习') {
  const button = page.getByTestId('practice-mode').getByRole('button', { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await showPracticeBlocks(page);
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
}

async function unique(page: Page, pattern: RegExp) {
  const ids = await blockOptions(page, pattern);
  expect(ids).toHaveLength(1);
  return ids[0];
}

async function add(page: Page, kind: string) {
  const before = new Set(await blockOptions(page, /./));
  await blockWorkspace(page)
    .getByRole('combobox', { name: '添加积木类型', exact: true })
    .selectOption(kind);
  await blockWorkspace(page).getByRole('button', { name: '添加积木', exact: true }).click();
  await expect
    .poll(async () => (await blockOptions(page, /./)).filter((id) => !before.has(id)).length)
    .toBe(1);
  return (await blockOptions(page, /./)).find((id) => !before.has(id))!;
}

async function connect(page: Page, child: string, parent: string, slot: string) {
  await selectBlock(page, child);
  await blockWorkspace(page)
    .getByRole('combobox', { name: '连接到积木', exact: true })
    .selectOption(parent);
  await blockWorkspace(page)
    .getByRole('combobox', { name: '连接位置', exact: true })
    .selectOption(slot);
  await blockWorkspace(page).getByRole('button', { name: '连接选中积木', exact: true }).click();
  await expect(blockWorkspace(page).locator('.block-notice')).toHaveText('积木已连接。');
}

/** Start with the production empty answer; create every answer block through native controls. */
async function buildEcho(page: Page) {
  await expect(
    page.getByTestId('practice-mode').getByRole('button', { name: '独立练习', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await blockOptions(page, /^\d+\. 输出 ·/)).toEqual([]);
  const input = await unique(page, /^\d+\. 声明整数 · x$/);
  const print = await add(page, 'print');
  await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  await connect(page, print, input, '$next');
  const read = await add(page, 'variable');
  await blockWorkspace(page).getByRole('textbox', { name: '变量名称', exact: true }).fill('x');
  await connect(page, read, print, 'ARG0');
  await expect(page.getByTestId('block-issues')).toHaveCount(0);
  await expect(source(page)).toHaveValue(/printf\("%d\\n", x\)/);
  await expect(action(page, '运行本组')).toBeEnabled();
  return { input, print, read, text: await source(page).inputValue() };
}

async function confirmLesson(page: Page) {
  await page.goto('/#/lessons/lesson.c.variables-output');
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await expect(saved(page)).toHaveAttribute('data-save-status', 'ready');
  await page.getByRole('button', { name: '确认已学习', exact: true }).click();
  await expect(saved(page)).toHaveAttribute('data-save-status', 'ready');
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
  await page.getByRole('link', { name: '进入练习工作区', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await showPracticeBlocks(page);
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
}

async function executes(page: Page) {
  return page.evaluate(
    () => window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
  );
}

async function capture(page: Page, info: TestInfo, label: string, extra: unknown = {}) {
  const records = await page.evaluate(() =>
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
    process.env.TASK_EVIDENCE_TASK ?? 'P0.5-07',
    'browser-experience',
    process.env.P07_CAPTURE_RUN ?? 'initial',
    info.project.name,
    label,
  );
  await mkdir(directory, { recursive: true });
  const runs = [];
  for (const [index, record] of records.entries()) {
    expect(record.moduleSeen).toBe(true);
    expect(record.requestBase64).toBeTruthy();
    expect(record.responseBase64).toBeTruthy();
    const requestBytes = Buffer.from(record.requestBase64!, 'base64');
    const responseBytes = Buffer.from(record.responseBase64!, 'base64');
    const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
    const result = await decodeResult(Uint8Array.from(responseBytes).buffer, request);
    expect(result.producer).toBe('rust');
    expect(request.remainingMs).toBeGreaterThan(0);
    expect(request.remainingMs).toBeLessThanOrEqual(1000);
    const prefix = `${index + 1}-${request.identity.testCaseKey}`;
    await writeFile(join(directory, `${prefix}.request.json`), requestBytes);
    await writeFile(join(directory, `${prefix}.result.json`), responseBytes);
    await writeFile(join(directory, `${prefix}.catalog.json`), record.catalogJson!);
    runs.push({ request, result });
  }
  await writeFile(
    join(directory, 'native-ui.json'),
    JSON.stringify(
      {
        browser: info.project.name,
        state: await panel(page).getAttribute('data-state'),
        feedback: await page.getByTestId('practice-feedback').innerText(),
        completion: await completion(page).innerText(),
        archive: await snapshot(page),
        runs: runs.map(({ request, result }) => ({
          identity: request.identity,
          terminal: result.terminal,
          judgeResult: result.judgeResult,
        })),
        extra,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: join(directory, 'screen.png'), fullPage: true });
  await info.attach(label, {
    path: join(directory, 'native-ui.json'),
    contentType: 'application/json',
  });
  return runs;
}

test('all six independent exercises start with only course inputs and reveal hints or correction drafts only by explicit choice', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  const samples = [];
  for (const exercise of reviewed.exercises) {
    await ready(page, exercise.id);
    const before = await snapshot(page);
    const program = reviewed.programs.find((item) => item.id === exercise.programRef.id)!;
    expect(await blockOptions(page, /./)).toHaveLength(program.bindings.length + 1);
    await expect(source(page)).not.toHaveValue(/printf|\bif\s*\(|\bwhile\s*\(|\bfor\s*\(/);
    const empty = await source(page).inputValue();
    const hints = page.getByTestId('practice-hints');
    await expect(hints.locator('ol li')).toHaveCount(0);
    await expect(hints.getByRole('button', { name: '查看第 1 层提示', exact: true })).toBeVisible();
    await expect(hints.getByRole('button', { name: '查看第 2 层提示', exact: true })).toHaveCount(
      0,
    );
    const initialHints = await hints.innerText();
    for (const tier of [1, 2, 3]) {
      await hints.getByRole('button', { name: `查看第 ${tier} 层提示`, exact: true }).click();
      await expect(hints.locator('ol li')).toHaveCount(tier);
      await expect(hints).not.toHaveText(initialHints);
    }
    await expect(page.getByRole('link', { name: '查看课程示例', exact: true })).toHaveAttribute(
      'href',
      `#/lessons/${exercise.lessonRef.id}`,
    );
    await expect(page.getByRole('link', { name: '查看课程示例', exact: true })).toHaveAttribute(
      'target',
      '_blank',
    );
    await expect(source(page)).toHaveValue(empty);
    expect(await executes(page)).toBe(0);
    await mode(page, '改错练习');
    await expect(source(page)).toHaveValue(/printf/);
    const correction = await source(page).inputValue();
    await mode(page, '独立练习');
    await expect(source(page)).toHaveValue(empty);
    unchangedFacts(before, await snapshot(page));
    samples.push({ id: exercise.id, empty, correction, hints: await hints.innerText() });
  }
  await capture(page, info, 'six-empty-answers-and-active-help', samples);
});

test('an answer built from empty native blocks runs one group without saving and submits all real tests before the saved completion checklist advances', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await confirmLesson(page);
  await expect(completion(page)).toHaveAttribute('data-state', 'incomplete');
  await expect(page.getByTestId('lesson-exercise-check')).toHaveAttribute('data-saved', 'no');
  const draft = await buildEcho(page);
  const before = await snapshot(page);
  await page.getByTestId('lesson-next-step').click();
  await expect(page).toHaveURL(/#\/practice\/exercise\.c\.echo#practice-answer$/);
  await expect(page.locator('#practice-answer')).toBeFocused();
  await expect(page.locator('#practice-answer')).toBeInViewport();
  await expect(source(page)).toHaveValue(draft.text);
  await action(page, '运行本组').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  await expect(page.getByTestId('practice-feedback').getByRole('heading', { level: 3 })).toHaveText(
    '本组运行结果',
  );
  expect(await executes(page)).toBe(1);
  unchangedFacts(before, await snapshot(page));
  await expect(page.getByTestId('practice-pass-save')).toHaveCount(0);
  await expect(completion(page)).toHaveAttribute('data-state', 'incomplete');
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await expect(completion(page)).toHaveAttribute('data-state', 'completed');
  await expect(completion(page)).toContainText('小节已完成并保存');
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
  await expect(page.getByTestId('lesson-exercise-check')).toHaveAttribute('data-saved', 'yes');
  await expect(page.getByTestId('lesson-next-step')).toBeVisible();
  await expect(
    completion(page).locator(`a[href="#/lessons/${reviewed.lessons[1].id}"]`),
  ).toBeVisible();
  expect(await executes(page)).toBe(4);
  const finished = await snapshot(page);
  expect(finished.progress.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(1);
  expect(finished.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(1);
  const runs = await capture(page, info, 'from-empty-run-submit-complete', {
    draft,
    before,
    finished,
  });
  expect(runs).toHaveLength(4);
  expect(runs.slice(1).map((run) => run.request.identity.testCaseKey)).toEqual(
    reviewed.exercises[0].tests.map((item) => item.caseKey),
  );
  for (const run of runs) expect(run.result.terminal.status).toBe('completed');
  for (const run of runs.slice(1)) expect(run.result.judgeResult?.status).toBe('met');
  await page.reload();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(completion(page)).toHaveAttribute('data-state', 'completed');
  await expect(source(page)).not.toHaveValue(/printf/);
  expect(await snapshot(page)).toEqual(finished);
});

interface ExperienceFault {
  armed: boolean;
  attempted: Receipt[];
}

async function passFault(page: Page) {
  await page.addInitScript(() => {
    const state: ExperienceFault = { armed: false, attempted: [] };
    Object.assign(window, { __experiencePassFault: state });
    const nativeAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'receipts' && (value as Receipt)?.eventType === 'exercise.passed') {
        state.attempted.push(structuredClone(value as Receipt));
        if (state.armed) {
          state.armed = false;
          throw new DOMException(
            'Isolated native exercise receipt write fault',
            'QuotaExceededError',
          );
        }
      }
      return key === undefined ? nativeAdd.call(this, value) : nativeAdd.call(this, value, key);
    };
  });
}

test('a real pass remains visibly unsaved after a native receipt fault; explicit retry reuses that event and repeated submission cannot repeat awards', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await passFault(page);
  await confirmLesson(page);
  await buildEcho(page);
  const before = await snapshot(page);
  await page.evaluate(() => {
    (window as unknown as { __experiencePassFault: ExperienceFault }).__experiencePassFault.armed =
      true;
  });
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
    'data-save-state',
    'unsaved',
  );
  await expect(saved(page)).toHaveAttribute('data-save-status', 'unsaved');
  await expect(completion(page)).toHaveAttribute('data-state', 'incomplete');
  await expect(page.getByTestId('lesson-exercise-check')).toHaveAttribute('data-saved', 'no');
  unchangedFacts(before, await snapshot(page));
  const original = await page.evaluate(
    () =>
      (window as unknown as { __experiencePassFault: ExperienceFault }).__experiencePassFault
        .attempted[0],
  );
  const workers = await executes(page);
  await saved(page).getByRole('button', { name: '重试未保存操作', exact: true }).click();
  await expect(saved(page)).toHaveAttribute('data-save-status', 'ready');
  await expect(completion(page)).toHaveAttribute('data-state', 'completed');
  expect(await executes(page)).toBe(workers);
  const retried = await snapshot(page);
  const receipt = retried.receipts.find((row) => row.eventType === 'exercise.passed')!;
  const originalFields: Partial<Receipt> = { ...original };
  const receivedFields: Partial<Receipt> = { ...receipt };
  delete originalFields.committedRevision;
  delete receivedFields.committedRevision;
  expect(receivedFields).toEqual(originalFields);
  await action(page, '提交练习').click();
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  const repeated = await snapshot(page);
  expect(repeated.ledger).toEqual(retried.ledger);
  expect(repeated.dailyFacts).toEqual(retried.dailyFacts);
  expect(repeated.progress.map((row) => ({ ...row, lastAt: null }))).toEqual(
    retried.progress.map((row) => ({ ...row, lastAt: null })),
  );
  expect(repeated.receipts.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(2);
  await expect(page.getByRole('button', { name: '完成小节', exact: true })).toHaveCount(0);
  await capture(page, info, 'native-save-retry-and-repeat', {
    before,
    original,
    retried,
    repeated,
  });
});

test('independent and correction answers keep separate native drafts while invalid edits and switching modes withdraw the current run', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await ready(page);
  const draft = await buildEcho(page);
  const before = await snapshot(page);
  const [example] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('link', { name: '查看课程示例', exact: true }).click(),
  ]);
  await expect(example.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await expect(example.locator('pre.sample-source').first()).toBeVisible();
  await expect(example.locator('textarea,[contenteditable="true"]')).toHaveCount(0);
  await example.getByTestId('lesson-next-step').click();
  await expect(example).toHaveURL(
    /#\/lessons\/lesson\.c\.variables-output#lesson-study-confirmation$/,
  );
  await expect(example.locator('#lesson-study-confirmation')).toBeFocused();
  await expect(example.locator('#lesson-study-confirmation')).toBeInViewport();
  await example.close();
  await page.bringToFront();
  await expect(source(page)).toHaveValue(draft.text);
  await expect(
    page.getByTestId('practice-mode').getByRole('button', { name: '独立练习', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await executes(page)).toBe(0);
  unchangedFacts(before, await snapshot(page));
  await action(page, '运行本组').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  await selectBlock(page, draft.read);
  await blockWorkspace(page).getByRole('button', { name: '断开选中积木', exact: true }).click();
  await expect(page.getByTestId('block-issues')).toBeVisible();
  await expect(action(page, '运行本组')).toBeDisabled();
  await expect(action(page, '提交练习')).toBeDisabled();
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await mode(page, '改错练习');
  const print = await unique(page, /^\d+\. 输出 ·/);
  await selectBlock(page, print);
  const correction = '%d separate-correction-draft\\n';
  await blockWorkspace(page)
    .getByRole('textbox', { name: '输出格式', exact: true })
    .fill(correction);
  await expect(source(page)).toHaveValue(/separate-correction-draft/);
  await mode(page, '独立练习');
  expect(await blockOptions(page, /./)).toContain(draft.read);
  await expect(page.getByTestId('block-issues')).toBeVisible();
  await expect(action(page, '提交练习')).toBeDisabled();
  await connect(page, draft.read, draft.print, 'ARG0');
  await expect(source(page)).toHaveValue(draft.text);
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await mode(page, '改错练习');
  await selectBlock(page, print);
  await expect(
    blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }),
  ).toHaveValue(correction);
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  expect(await executes(page)).toBe(1);
  unchangedFacts(before, await snapshot(page));
  await capture(page, info, 'separate-drafts-and-invalidation', { draft, correction, before });
});

interface ExperienceGate {
  armed: boolean;
  held: number;
  release(): void;
}

async function gateRun(page: Page) {
  await page.addInitScript(() => {
    const pending: (() => void)[] = [];
    const gate: ExperienceGate = {
      armed: false,
      held: 0,
      release() {
        pending.splice(0).forEach((deliver) => deliver());
        gate.held = 0;
      },
    };
    Object.assign(window, { __experienceRunGate: gate });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private execute = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (!this.execute || !gate.armed || !this.onmessage) return;
          const handler = this.onmessage;
          gate.armed = false;
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

test('cancelling one held genuine run rejects its late result and a fresh one-group run recovers without learning effects', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await gateRun(page);
  await ready(page);
  await buildEcho(page);
  const before = await snapshot(page);
  await page.evaluate(() => {
    (window as unknown as { __experienceRunGate: ExperienceGate }).__experienceRunGate.armed = true;
  });
  await action(page, '运行本组').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __experienceRunGate: ExperienceGate }).__experienceRunGate.held,
      ),
    )
    .toBe(1);
  await panel(page).getByRole('button', { name: /取消/ }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'cancelled');
  await page.evaluate(() => {
    (window as unknown as { __experienceRunGate: ExperienceGate }).__experienceRunGate.release();
  });
  await page.waitForTimeout(100);
  await expect(panel(page)).toHaveAttribute('data-state', 'cancelled');
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await action(page, '运行本组').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  expect(await executes(page)).toBe(2);
  unchangedFacts(before, await snapshot(page));
  const runs = await capture(page, info, 'run-cancel-stale-recovery', { before });
  expect(runs).toHaveLength(2);
  expect(runs[0].request.identity.runId).not.toBe(runs[1].request.identity.runId);
  await expect(completion(page)).toHaveAttribute('data-state', 'incomplete');
});
