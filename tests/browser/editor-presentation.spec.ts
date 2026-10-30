import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import {
  decodeResult,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../web/src/engine/protocol';
import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { blockOptions, blockWorkspace, selectBlock } from './block-ui';
import { observeCaseSetExecution } from './case-set-observation';

const content = JSON.parse(
  readFileSync('web/public/content/practice/course-practice-1.2.0.json', 'utf8'),
) as CoursePractice;
const reading = JSON.parse(
  readFileSync('web/public/content/reading/course-reading-1.1.0.json', 'utf8'),
) as {
  lessons: {
    id: string;
    version: string;
    requiredExerciseRefs: { id: string; version: string }[];
  }[];
};
const guidance = JSON.parse(readFileSync('content/c/p05/practice-guidance-1.0.0.json', 'utf8')) as {
  entries: { exerciseRef: { id: string; version: string }; preferredEditor: 'code' | 'blocks' }[];
};
const echo = 'exercise.c.echo';
const panel = (page: Page) => page.getByTestId('practice-execution');
const layout = (page: Page) => page.getByTestId('practice-editor-layout');
const editor = (page: Page) => page.getByTestId('draft-code-editor');
const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const preference = (page: Page) => page.getByTestId('block-workspace-preference');
const select = (page: Page) =>
  preference(page).getByRole('combobox', { name: '积木显示', exact: true });
const prefStatus = (page: Page) => page.getByTestId('block-preference-save-status');
const action = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
type Preference = 'auto' | 'show' | 'hide';

test.beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));
test.beforeEach(async ({ page }) => observeCaseSetExecution(page));

/** These answers are authored in this test, then typed through the normal code
 * editor. Rust alone parses them, projects blocks and produces test results. */
const answers: Record<string, string> = {
  'exercise.c.echo': 'printf("%d\\n", x);\nreturn 0;',
  'exercise.c.two-x-plus-three': 'int result = x * 2 + 3;\nprintf("%d\\n", result);\nreturn 0;',
  'exercise.c.nonnegative':
    'if (x >= 0) {\n  printf("1\\n");\n} else {\n  printf("0\\n");\n}\nreturn 0;',
  'exercise.c.two-loop-sums':
    'int i = 1;\nint sumWhile = 0;\nwhile (i <= n) {\n  sumWhile = sumWhile + i;\n  i = i + 1;\n}\nint sumFor = 0;\nfor (int j = 1; j <= n; j = j + 1) {\n  sumFor = sumFor + j;\n}\nprintf("%d\\n%d\\n", sumWhile, sumFor);\nreturn 0;',
  'exercise.c.increment-at-index':
    'values[k] = values[k] + 1;\nprintf("%d\\n", values[k]);\nreturn 0;',
  'exercise.c.array-sum':
    'int sum = 0;\nfor (int i = 0; i < n; i = i + 1) {\n  sum = sum + values[i];\n}\nprintf("%d\\n", sum);\nreturn 0;',
};

function withBody(id: string, body: string) {
  const catalog = exerciseCatalog(content, id);
  const input = catalog.subject.tests[0].input;
  const values = Object.fromEntries(
    Object.keys(input)
      .sort()
      .map((key) => [key, input[key]]),
  );
  const prepared = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      prepare_input(
        JSON.stringify(catalog),
        new TextEncoder().encode(JSON.stringify(values)),
        1000,
      ),
    ),
  ).source as PreparedSource;
  const end = Math.max(...prepared.bindingMap.map((binding) => binding.byteRange.end));
  return `${prepared.text.slice(0, end)}\n${body}\n}\n`;
}

/** Read-only native archive observations never manufacture saved preferences,
 * learning facts, IDs, input bindings, ASTs or execution results. */
async function snapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames).filter((name) => name !== 'editHistory');
      const transaction = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const rows = await Promise.all(
        names.map(async (name) => {
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
      return Object.fromEntries(rows) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}
function sameLearning(before: StorageSnapshot, after: StorageSnapshot) {
  for (const key of ['progress', 'ledger', 'dailyFacts', 'receipts', 'goals', 'aliases'] as const)
    expect(after[key]).toEqual(before[key]);
}
function onlyTeachingFailure(before: StorageSnapshot, after: StorageSnapshot, count: number) {
  const attempts = after.receipts.filter((r) => r.eventType === 'exercise.attempt-evaluated');
  expect(attempts).toHaveLength(count);
  for (const r of attempts)
    expect(r).toMatchObject({
      subjectRef: { id: 'exercise.c.nonnegative' },
      result: 'failed',
      resultCategory: 'teaching-goal-unmet',
    });
  if (before.goals.length === 0) {
    expect(after.goals).toHaveLength(1);
    expect(after.goals[0]).toEqual({
      localDate: attempts[0].localDate,
      goalVersion: before.settings.goalTemplate!.revision,
      targets: before.settings.goalTemplate!.targets,
      achievedAt: null,
    });
  }
  expect(after.settings).toEqual(before.settings);
  sameLearning(before, {
    ...after,
    goals: before.goals.length === 0 ? [] : after.goals,
    progress: after.progress.filter((r) => r.eventType !== 'exercise.attempt-evaluated'),
    receipts: after.receipts.filter((r) => r.eventType !== 'exercise.attempt-evaluated'),
  });
}
function sparsePreference(before: StorageSnapshot, after: StorageSnapshot, value: Preference) {
  expect(after.appearance).toEqual({ ...before.appearance, blockWorkspace: value });
  expect(after.settings).toEqual(before.settings);
  expect(after.avatar).toEqual(before.avatar);
  expect(after.appearanceAssets).toEqual(before.appearanceAssets);
  expect(after.meta.generation).toBe(before.meta.generation);
  expect(after.meta.activePackageRef).toEqual(before.meta.activePackageRef);
  sameLearning(before, after);
}
async function counts(page: Page) {
  return page.evaluate(() => ({
    execute: window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute')
      .length,
    analysis: window.__verticalObservation.workers.filter(
      (worker) => worker.kind === 'analyze-code',
    ).length,
  }));
}
async function choose(page: Page, value: Preference) {
  await expect(select(page)).toBeEnabled();
  const changed = (await select(page).inputValue()) !== value;
  if (changed) await select(page).selectOption(value);
  await expect(select(page)).toHaveValue(value);
  if (changed) {
    await expect(prefStatus(page)).toHaveAttribute('data-save-state', /^(saved|temporary)$/);
    if ((await prefStatus(page).getAttribute('data-save-state')) === 'temporary') {
      await page.getByRole('button', { name: '重新读取并保存选择', exact: true }).click();
      await expect(prefStatus(page)).toHaveAttribute('data-save-state', 'saved');
    }
  }
  await expect.poll(async () => (await snapshot(page)).appearance.blockWorkspace).toBe(value);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}
async function open(page: Page, id = echo, mode: Preference = 'hide') {
  await page.goto(`/#/practice/${id}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(select(page)).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await choose(page, mode);
  if (mode !== 'hide' && !(await code(page).isVisible()))
    await action(page, '编辑 C 并同步积木').click();
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(code(page)).toBeEditable();
  await expect.poll(async () => (await snapshot(page)).settings.goalTemplate).not.toBeNull();
}
async function fillSynced(page: Page, text: string) {
  await code(page).fill(text);
  await expect(code(page)).toHaveValue(text);
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(action(page, '提交练习')).toBeEnabled();
}

interface Run {
  request: ExecuteRequest;
  result: ExecuteResult;
}
async function evidence(page: Page, info: TestInfo, label: string, details: unknown = null) {
  const captures = await page.evaluate(() =>
    window.__verticalObservation.workers
      .filter((worker) => worker.kind === 'execute' || worker.kind === 'analyze-code')
      .map((worker) => ({
        kind: worker.kind,
        moduleSeen: worker.moduleSeen,
        operationId: worker.operationId,
        responseOperationId: worker.responseOperationId,
        catalogJson: worker.catalogJson,
        ...(
          worker as typeof worker & {
            captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
          }
        ).captureEncoded(),
      })),
  );
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? 'P0.5-08',
    'browser-presentation',
    process.env.TASK_EVIDENCE_LABEL ?? 'initial',
    info.project.name,
    label,
  );
  await mkdir(directory, { recursive: true });
  const runs: Run[] = [];
  for (const [index, capture] of captures.entries()) {
    if (!capture.requestBase64 || !capture.responseBase64) {
      expect(capture.kind).toBe('analyze-code');
      continue;
    }
    expect(capture.moduleSeen).toBe(true);
    expect(capture.operationId).toBe(capture.responseOperationId);
    const request = Buffer.from(capture.requestBase64, 'base64');
    const response = Buffer.from(capture.responseBase64, 'base64');
    await writeFile(join(directory, `${index + 1}-${capture.kind}.request.json`), request);
    await writeFile(join(directory, `${index + 1}-${capture.kind}.result.json`), response);
    if (capture.kind === 'execute') {
      const parsed = JSON.parse(request.toString('utf8')) as ExecuteRequest;
      const result = await decodeResult(Uint8Array.from(response).buffer, parsed);
      expect(result.producer).toBe('rust');
      expect(parsed.remainingMs).toBeGreaterThan(0);
      expect(parsed.remainingMs).toBeLessThanOrEqual(1000);
      runs.push({ request: parsed, result });
      await writeFile(join(directory, `${index + 1}-catalog.json`), capture.catalogJson!);
    }
  }
  const values = {
    label,
    browser: info.project.name,
    preference: await select(page).inputValue(),
    blocksVisible: await layout(page).getAttribute('data-blocks-visible'),
    source: await code(page).inputValue(),
    documentRevision: await editor(page).getAttribute('data-document-revision'),
    archive: await snapshot(page),
    runs: runs.map((run) => ({
      identity: run.request.identity,
      terminal: run.result.terminal,
      judge: run.result.judgeResult,
    })),
    details,
  };
  const path = join(directory, 'native-ui.json');
  await writeFile(path, JSON.stringify(values, null, 2));
  await page.screenshot({ path: join(directory, 'screen.png'), fullPage: true });
  await info.attach(label, { path, contentType: 'application/json' });
  return runs;
}

for (const exercise of content.exercises)
  test(`hidden-block code answer retains real input mapping and passes all tests: ${exercise.id}`, async ({
    page,
  }, info) => {
    await open(page, exercise.id);
    await expect(layout(page)).toHaveAttribute('data-blocks-visible', 'no');
    await expect(blockWorkspace(page)).toBeHidden();
    await expect.poll(async () => (await snapshot(page)).settings.goalTemplate).not.toBeNull();
    const before = await snapshot(page);
    const answer = withBody(exercise.id, answers[exercise.id]);
    await fillSynced(page, answer);
    expect(await counts(page)).toMatchObject({ execute: 0 });
    sameLearning(before, await snapshot(page));
    await action(page, '运行本组').click();
    await expect(panel(page)).toHaveAttribute('data-state', 'ran');
    sameLearning(before, await snapshot(page));
    await action(page, '提交练习').click();
    await expect(panel(page)).toHaveAttribute('data-state', 'passed');
    await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await expect(code(page)).toHaveValue(answer);
    const saved = await snapshot(page);
    const workersBeforeVisibility = await counts(page);
    const revision = await editor(page).getAttribute('data-document-revision');
    await choose(page, 'show');
    await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
    await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
    await expect(panel(page)).toHaveAttribute('data-state', 'passed');
    await choose(page, 'hide');
    await expect(blockWorkspace(page)).toBeHidden();
    await expect(code(page)).toHaveValue(answer);
    expect(await counts(page)).toEqual(workersBeforeVisibility);
    sameLearning(saved, await snapshot(page));
    const runs = await evidence(page, info, exercise.id);
    expect(runs).toHaveLength(exercise.tests.length + 1);
    const submission = runs.slice(1);
    expect(submission.map((run) => run.request.identity.testCaseKey)).toEqual(
      exercise.tests.map((item) => item.caseKey),
    );
    expect(new Set(submission.map((run) => run.request.identity.submissionId)).size).toBe(1);
    const ids = submission[0].request.source.blockMap.map((mapping) => mapping.blockId).sort();
    expect(ids.length).toBeGreaterThan(0);
    for (const [index, run] of submission.entries()) {
      expect(run.request.input.values).toEqual(exercise.tests[index].input);
      expect(run.request.source.blockMap.map((mapping) => mapping.blockId).sort()).toEqual(ids);
      expect(run.result.terminal.status).toBe('completed');
      expect(run.result.judgeResult?.status).toBe('met');
      const stdout = run.result.trace?.steps
        .flatMap((step) =>
          step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
        )
        .join('');
      expect(stdout).toBe(exercise.tests[index].expectedStdout);
      for (const coverage of run.result.judgeResult?.coverage ?? []) {
        const mapping = run.request.source.blockMap.find(
          (item) => item.blockId === coverage.siteKey,
        );
        const node = run.result.nodeMap.find((item) => item.nodeId === coverage.nodeId);
        expect(mapping).toBeDefined();
        expect(node).toBeDefined();
        expect(mapping?.byteRange).toEqual(node?.byteRange);
      }
    }
  });

test('automatic presentation follows each lesson recommendation and explicit preferences override only visibility', async ({
  page,
}, info) => {
  const samples = [];
  const required = content.exercises.filter((e) =>
    reading.lessons.some((l) =>
      l.requiredExerciseRefs.some((r) => r.id === e.id && r.version === e.version),
    ),
  );
  expect(required).toHaveLength(32);
  for (const exercise of required) {
    await page.goto(`/#/practice/${exercise.id}`);
    await expect(panel(page)).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
    await choose(page, 'auto');
    const visible =
      guidance.entries.find(
        (g) => g.exerciseRef.id === exercise.id && g.exerciseRef.version === exercise.version,
      )!.preferredEditor === 'blocks';
    await expect(layout(page)).toHaveAttribute('data-blocks-visible', visible ? 'yes' : 'no');
    if (visible) await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
    else await expect(code(page)).toBeEditable();
    const before = await snapshot(page);
    await choose(page, visible ? 'hide' : 'show');
    await expect(layout(page)).toHaveAttribute('data-blocks-visible', visible ? 'no' : 'yes');
    await choose(page, 'auto');
    await expect(layout(page)).toHaveAttribute('data-blocks-visible', visible ? 'yes' : 'no');
    sameLearning(before, await snapshot(page));
    samples.push({ exercise: exercise.id, expectedAutoBlocks: visible });
  }
  if (!(await code(page).isVisible())) await action(page, '编辑 C 并同步积木').click();
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  expect(await counts(page)).toMatchObject({ execute: 0 });
  await evidence(page, info, 'automatic-reviewed-32-lessons', samples);
});

test('invalid and unmapped code survives hide-show, settings return and mode switching without executing historical blocks', async ({
  page,
}, info) => {
  await open(page);
  const valid = withBody(echo, answers[echo]);
  await fillSynced(page, valid);
  await action(page, '运行本组').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  const before = await snapshot(page);
  const cases = [
    { text: withBody(echo, 'if ( /* 未完成的😀草稿 */'), sync: 'invalid' },
    { text: withBody(echo, ';\nprintf("%d\\n", x);\nreturn 0;'), sync: 'unmapped' },
  ];
  for (const entry of cases) {
    await code(page).fill(entry.text);
    await expect(editor(page)).toHaveAttribute('data-sync', entry.sync);
    await expect(action(page, '运行本组')).toBeDisabled();
    await expect(action(page, '提交练习')).toBeDisabled();
    await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
    const revision = await editor(page).getAttribute('data-document-revision');
    const work = await counts(page);
    await choose(page, 'show');
    await expect(page.getByTestId('historical-blocks-notice')).toContainText('上次有效结构');
    await choose(page, 'hide');
    await expect(code(page)).toHaveValue(entry.text);
    await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
    expect(await counts(page)).toEqual(work);
    await page
      .getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('link', { name: '本地设置', exact: true })
      .click();
    await page.getByRole('tab', { name: '显示设置', exact: true }).click();
    await choose(page, 'show');
    await page.goBack();
    // The settings category changes its query string. Return through the actual
    // retained practice route without reloading the document.
    if (!page.url().includes('/practice/')) await page.goBack();
    await expect(code(page)).toHaveValue(entry.text);
    await expect(editor(page)).toHaveAttribute('data-sync', entry.sync);
    await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
    await page
      .getByTestId('practice-mode')
      .getByRole('button', { name: '改错练习', exact: true })
      .click();
    await page
      .getByTestId('practice-mode')
      .getByRole('button', { name: '独立练习', exact: true })
      .click();
    await expect(code(page)).toHaveValue(entry.text);
    await expect(action(page, '提交练习')).toBeDisabled();
    await choose(page, 'hide');
  }
  sameLearning(before, await snapshot(page));
  expect((await counts(page)).execute).toBe(1);
  await fillSynced(page, valid);
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await evidence(page, info, 'invalid-unmapped-presentation-recovery', cases);
});

test('presentation changes preserve the accepted run, cursor, document bytes and saved awards; logical edits invalidate them', async ({
  page,
}, info) => {
  await open(page);
  const text = withBody(echo, '// 原稿字节与注释😀\nprintf("%d\\n", x);\nreturn 0;');
  await fillSynced(page, text);
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  const controls = page.getByTestId('player-controls');
  await controls.getByRole('button', { name: '前进', exact: true }).click();
  const cursor = await controls.getAttribute('data-cursor');
  const revision = await editor(page).getAttribute('data-document-revision');
  const work = await counts(page);
  const before = await snapshot(page);
  for (const value of ['show', 'hide', 'auto', 'show', 'hide'] as const) {
    await choose(page, value);
    await expect(code(page)).toHaveValue(text);
    await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
    await expect(panel(page)).toHaveAttribute('data-state', 'passed');
    await expect(controls).toHaveAttribute('data-cursor', cursor!);
    expect(await counts(page)).toEqual(work);
    sameLearning(before, await snapshot(page));
  }
  await action(page, '提交练习').click();
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  const repeated = await snapshot(page);
  expect(repeated.ledger).toEqual(before.ledger);
  expect(repeated.dailyFacts).toEqual(before.dailyFacts);
  await code(page).fill(text.replace('原稿字节与注释😀', '显式逻辑修订😀'));
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(page.getByTestId('practice-stdout')).toHaveCount(0);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  expect(await editor(page).getAttribute('data-document-revision')).not.toBe(revision);
  await evidence(page, info, 'accepted-run-preserved-until-edit', { cursor, revision, work });
});

test('native block edits keep comments, coordinates and undo-redo across hide-show while sharing the same code draft', async ({
  page,
}, info) => {
  await open(page, echo, 'show');
  const text = withBody(echo, '// 保存注释😀\nprintf("%d\\n", x);\nreturn 0;');
  await fillSynced(page, text);
  const prints = await blockOptions(page, /^\d+\. 输出 ·/);
  expect(prints).toHaveLength(1);
  await selectBlock(page, prints[0]);
  await blockWorkspace(page)
    .getByRole('textbox', { name: '输出格式', exact: true })
    .fill('[%d]\\n');
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  const changed = await code(page).inputValue();
  expect(changed).toContain('printf("[%d]\\n", x)');
  const shape = () =>
    blockWorkspace(page)
      .locator(`.blocklyBlockCanvas [data-id=${JSON.stringify(prints[0])}]`)
      .first();
  const position = await shape().getAttribute('transform');
  const revision = await editor(page).getAttribute('data-document-revision');
  const work = await counts(page);
  await choose(page, 'hide');
  await expect(blockWorkspace(page)).toBeHidden();
  await choose(page, 'show');
  await expect(shape()).toHaveAttribute('transform', position!);
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  expect(await counts(page)).toEqual(work);
  const undo = blockWorkspace(page).getByRole('button', { name: '撤销', exact: true });
  const redo = blockWorkspace(page).getByRole('button', { name: '重做', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(code(page)).toHaveValue(/printf\("%d\\n", x\)/);
  await expect(code(page)).toHaveValue(/保存注释😀/);
  await expect(redo).toBeEnabled();
  await choose(page, 'hide');
  await choose(page, 'show');
  await redo.click();
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(code(page)).toHaveValue(changed);
  expect((await counts(page)).execute).toBe(0);
  await evidence(page, info, 'native-undo-redo-through-presentation', { position, revision });
});

test('display settings save only the block preference, preserve an unfinished answer and restore the preference after refresh', async ({
  page,
}, info) => {
  await open(page);
  const invalid = withBody(echo, 'while ( /* 设置往返保留😀 */');
  await code(page).fill(invalid);
  await expect(editor(page)).toHaveAttribute('data-sync', 'invalid');
  const revision = await editor(page).getAttribute('data-document-revision');
  const before = await snapshot(page);
  await page.goto('/#/settings?panel=display');
  await expect(preference(page)).toBeVisible();
  await choose(page, 'show');
  await expect(prefStatus(page)).toContainText('已保存');
  const saved = await snapshot(page);
  sparsePreference(before, saved, 'show');
  await page.goBack();
  await expect(code(page)).toHaveValue(invalid);
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  await expect(layout(page)).toHaveAttribute('data-blocks-visible', 'yes');
  await choose(page, 'hide');
  const hidden = await snapshot(page);
  await page.reload();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(select(page)).toHaveValue('hide');
  await expect(layout(page)).toHaveAttribute('data-blocks-visible', 'no');
  await expect(code(page)).toBeEditable();
  await expect(code(page)).not.toHaveValue(invalid);
  expect(await snapshot(page)).toEqual(hidden);
  await evidence(page, info, 'settings-persistence-and-ephemeral-draft-boundary', {
    before,
    saved,
    hidden,
  });
});

interface PreferenceFault {
  arm(kind: 'quota' | 'abort-after-success'): void;
}
async function installFault(page: Page) {
  await page.addInitScript(() => {
    const native = IDBObjectStore.prototype.put;
    let selected: 'quota' | 'abort-after-success' | null = null;
    Object.assign(window, {
      __preferenceFault: {
        arm(kind: 'quota' | 'abort-after-success') {
          selected = kind;
        },
      },
    });
    IDBObjectStore.prototype.put = function (value, key) {
      const fault = this.name === 'appearance' ? selected : null;
      if (fault) selected = null;
      if (fault === 'quota')
        throw new DOMException('Isolated appearance put failure', 'QuotaExceededError');
      const request = key === undefined ? native.call(this, value) : native.call(this, value, key);
      if (fault === 'abort-after-success')
        request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    };
  });
}
async function armFault(page: Page, kind: 'quota' | 'abort-after-success') {
  await page.evaluate(
    (kind) =>
      (window as unknown as { __preferenceFault: PreferenceFault }).__preferenceFault.arm(kind),
    kind,
  );
}

test('native appearance quota and transaction abort retain an honest temporary choice and explicit sparse retry', async ({
  page,
}, info) => {
  await installFault(page);
  await open(page, echo, 'show');
  const text = withBody(echo, answers[echo]);
  await fillSynced(page, text);
  const revision = await editor(page).getAttribute('data-document-revision');
  const samples = [];
  for (const kind of ['quota', 'abort-after-success'] as const) {
    const before = await snapshot(page);
    const work = await counts(page);
    await armFault(page, kind);
    await select(page).selectOption('hide');
    await expect(prefStatus(page)).toHaveAttribute('data-save-state', 'temporary');
    await expect(prefStatus(page)).toContainText('未保存');
    await expect(layout(page)).toHaveAttribute('data-blocks-visible', 'no');
    await expect(code(page)).toHaveValue(text);
    expect(await snapshot(page)).toEqual(before);
    await preference(page).getByRole('button', { name: '重新读取并保存选择', exact: true }).click();
    await expect(prefStatus(page)).toHaveAttribute('data-save-state', 'saved');
    const after = await snapshot(page);
    sparsePreference(before, after, 'hide');
    await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
    expect(await counts(page)).toEqual(work);
    samples.push({ kind, before, after });
    await choose(page, 'show');
  }
  await evidence(page, info, 'native-preference-faults-and-explicit-retry', samples);
});

test('a stale failed preference cannot overwrite peer settings and explicit retry preserves the peer changes', async ({
  page,
  context,
}, info) => {
  await installFault(page);
  await open(page, echo, 'show');
  const text = withBody(echo, answers[echo]);
  await fillSynced(page, text);
  await armFault(page, 'quota');
  await select(page).selectOption('hide');
  await expect(prefStatus(page)).toHaveAttribute('data-save-state', 'temporary');
  const before = await snapshot(page);
  const peer = await context.newPage();
  await peer.goto('/#/settings?panel=appearance');
  await expect(peer.getByTestId('appearance-settings')).toBeVisible();
  await peer.getByTestId('theme-cute').click();
  await peer.getByTestId('save-appearance').click();
  await expect(peer.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
  const peerSaved = await snapshot(peer);
  expect(peerSaved.appearance.preset).toBe('cute');
  expect(peerSaved.appearance.blockWorkspace).toBe('show');
  await page.bringToFront();
  await expect(select(page)).toHaveValue('hide');
  await expect(prefStatus(page)).toHaveAttribute('data-save-state', 'temporary');
  expect(await snapshot(page)).toEqual(peerSaved);
  await preference(page).getByRole('button', { name: '重新读取并保存选择', exact: true }).click();
  await expect(prefStatus(page)).toHaveAttribute('data-save-state', 'saved');
  const after = await snapshot(page);
  sparsePreference(peerSaved, after, 'hide');
  await expect(code(page)).toHaveValue(text);
  sameLearning(before, after);
  await evidence(page, info, 'peer-appearance-save-and-sparse-preference-retry', {
    before,
    peerSaved,
    after,
  });
  await peer.close();
});

test('a peer clear discards a failed preference and unfinished answer instead of reviving the previous generation', async ({
  page,
  context,
}, info) => {
  await installFault(page);
  await open(page, echo, 'show');
  const invalid = withBody(echo, 'if ( /* 清除前临时草稿😀 */');
  await code(page).fill(invalid);
  await expect(editor(page)).toHaveAttribute('data-sync', 'invalid');
  await armFault(page, 'quota');
  await select(page).selectOption('hide');
  await expect(prefStatus(page)).toHaveAttribute('data-save-state', 'temporary');
  const before = await snapshot(page);
  const peer = await context.newPage();
  await peer.goto('/#/settings?panel=data');
  await expect(peer.getByRole('button', { name: '清除本地数据', exact: true })).toBeEnabled();
  await peer.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await peer
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot(peer)).meta.generation)
    .not.toBe(before.meta.generation);
  await page.bringToFront();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(select(page)).toHaveValue('auto');
  await expect(
    preference(page).getByRole('button', { name: '重新读取并保存选择', exact: true }),
  ).toHaveCount(0);
  await expect(code(page)).not.toHaveValue(invalid);
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  expect((await snapshot(page)).appearance.blockWorkspace).toBe('auto');
  await evidence(page, info, 'generation-clear-discards-temporary-choice', {
    before,
    after: await snapshot(page),
  });
  await peer.close();
});

test('hidden blocks do not bypass the same teaching checks or accepted source identity', async ({
  page,
}, info) => {
  const id = 'exercise.c.nonnegative';
  await open(page, id);
  const before = await snapshot(page);
  const text = withBody(id, 'printf("%d\\n", x >= 0);\nreturn 0;');
  await fillSynced(page, text);
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  await expect(page.getByTestId('practice-pass-save')).toHaveCount(0);
  await expect(page.getByTestId('practice-attempt-save')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  onlyTeachingFailure(before, await snapshot(page), 1);
  const hidden = await counts(page);
  await choose(page, 'show');
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  await expect(code(page)).toHaveValue(text);
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  expect(await counts(page)).toEqual(hidden);
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  await expect(page.getByTestId('practice-attempt-save')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  onlyTeachingFailure(before, await snapshot(page), 2);
  const runs = await evidence(page, info, 'same-teaching-rejection-hidden-and-visible');
  expect(runs.length).toBeGreaterThanOrEqual(2);
  expect(runs.every((run) => run.result.judgeResult?.status === 'unmet')).toBe(true);
});

test('narrow-screen keyboard preference controls keep the current code editable and every action reachable', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await open(page);
  const text = withBody(echo, answers[echo]);
  await fillSynced(page, text);
  const revision = await editor(page).getAttribute('data-document-revision');
  const before = await snapshot(page);
  await select(page).focus();
  await page.keyboard.press('Home');
  await expect(select(page)).toHaveValue('auto');
  await expect.poll(async () => (await snapshot(page)).appearance.blockWorkspace).toBe('auto');
  await expect(code(page)).toBeEditable();
  await expect(code(page)).toHaveValue(text);
  await select(page).focus();
  await page.keyboard.press('End');
  await expect(select(page)).toHaveValue('hide');
  await expect.poll(async () => (await snapshot(page)).appearance.blockWorkspace).toBe('hide');
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  await action(page, '运行本组').scrollIntoViewIfNeeded();
  await expect(action(page, '运行本组')).toBeInViewport();
  await action(page, '运行本组').focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  sameLearning(before, await snapshot(page));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await evidence(page, info, 'narrow-keyboard-code-only');
});

test('a blocks-first lesson retains an incomplete block draft when hiding before the first code edit', async ({
  page,
}, info) => {
  const id = 'exercise.c.two-loop-sums';
  await page.goto(`/#/practice/${id}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(select(page)).toHaveValue('auto');
  await expect(layout(page)).toHaveAttribute('data-blocks-visible', 'yes');
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  await expect(code(page)).toHaveCount(0);
  const before = await snapshot(page);
  const initialIds = new Set(await blockOptions(page, /./));
  await blockWorkspace(page)
    .getByRole('combobox', { name: '添加积木类型', exact: true })
    .selectOption('integer');
  await blockWorkspace(page).getByRole('button', { name: '添加积木', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await blockOptions(page, /./)).filter((blockId) => !initialIds.has(blockId)).length,
    )
    .toBe(1);
  const disconnected = (await blockOptions(page, /./)).filter(
    (blockId) => !initialIds.has(blockId),
  );
  expect(disconnected).toHaveLength(1);
  await expect(page.getByTestId('block-issues')).toBeVisible();
  await expect(action(page, '运行本组')).toBeDisabled();
  await expect(action(page, '提交练习')).toBeDisabled();
  const pending = await counts(page);
  expect(pending.execute).toBe(0);

  await choose(page, 'hide');
  await expect(blockWorkspace(page)).toBeHidden();
  await expect(code(page)).toBeEditable();
  await expect(editor(page)).toHaveAttribute('data-sync', 'invalid');
  const retainedText = await code(page).inputValue();
  const revision = await editor(page).getAttribute('data-document-revision');
  await expect(action(page, '运行本组')).toBeDisabled();
  await expect(action(page, '提交练习')).toBeDisabled();
  expect(await counts(page)).toEqual(pending);

  await choose(page, 'show');
  expect(await blockOptions(page, /./)).toContain(disconnected[0]);
  await expect(editor(page)).toHaveAttribute('data-sync', 'invalid');
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  await expect(code(page)).toHaveValue(retainedText);
  await choose(page, 'hide');
  await fillSynced(page, withBody(id, answers[id]));
  sameLearning(before, await snapshot(page));
  await action(page, '提交练习').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  const runs = await evidence(page, info, 'blocks-first-incomplete-hide-code-repair', {
    disconnectedId: disconnected[0],
    invalidRevision: revision,
    retainedText,
  });
  expect(runs).toHaveLength(content.exercises.find((exercise) => exercise.id === id)!.tests.length);
  expect(runs.every((run) => run.result.judgeResult?.status === 'met')).toBe(true);
});
