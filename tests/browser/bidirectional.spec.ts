import { currentEditorRegression } from './current-editor-regression';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { generateBlockSource } from '../../web/src/blocks/generator';
import { correctBlockProgram } from '../../web/src/blocks/starters';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import {
  decodeResult,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../web/src/engine/protocol';
import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { blockOptions, blockWorkspace, selectBlock } from './block-ui';
import { observeCaseSetExecution } from './case-set-observation';
import { decodeC6Response, type C6Request } from '../../web/src/engine/c6-protocol';
import { engineBuild as c6Build } from '../../web/src/generated/c6-teaching/engine-build';

const content = JSON.parse(
  readFileSync('content/c/primer6-learning/supplements-1.0.0.json', 'utf8'),
).practice as CoursePractice;
const bugQuestions = JSON.parse(readFileSync('content/c/bugs/questions-1.0.0.json', 'utf8'))
  .questions as { exerciseRef: { id: string }; baseExerciseRef: { id: string } }[];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const echo = 'exercise.c.bug-semicolon';
const panel = (page: Page) => page.getByTestId('practice-execution');
const editor = (page: Page) => page.getByTestId('draft-code-editor');
const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const action = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
const submit = (page: Page) => action(page, '提交练习');

test.beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));
test.beforeEach(async ({ page }) => observeCaseSetExecution(page));
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && (await panel(page).count()))
    await capture(
      page,
      info,
      'failed-' + createHash('sha256').update(info.title).digest('hex').slice(0, 10),
    );
});

function prepared(id: string) {
  const catalog = exerciseCatalog(content, id);
  const input = catalog.subject.tests[0].input;
  const values = Object.fromEntries(
    Object.keys(input)
      .sort()
      .map((key) => [key, input[key]]),
  );
  const source = JSON.parse(
    decoder.decode(
      prepare_input(JSON.stringify(catalog), encoder.encode(JSON.stringify(values)), 1000),
    ),
  ).source as PreparedSource;
  return { catalog, source };
}

/** A test-authored C answer is typed through the real code UI. This does not
 * insert Blockly nodes or supply an AST/result to the production converter. */
function answer(id: string) {
  const { catalog, source } = prepared(id);
  return generateBlockSource(
    correctBlockProgram(
      bugQuestions.find((q) => q.exerciseRef.id === id)!.baseExerciseRef.id,
      catalog.program.bindings,
    ),
    source,
    catalog.program.bindings,
  ).text;
}
function bodySource(body: string, id = echo) {
  const { source } = prepared(id);
  const end = Math.max(...source.bindingMap.map((binding) => binding.byteRange.end));
  return `${source.text.slice(0, end)}\n${body}\n}\n`;
}

async function open(page: Page, id = echo) {
  await page.goto(`/#/practice/${id}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('show');
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  if (await action(page, '编辑 C 并同步积木').isVisible())
    await action(page, '编辑 C 并同步积木').click();
  await expect(code(page)).toBeEditable();
  await fillSynced(page, answer(id));
}
async function fillSynced(page: Page, text: string) {
  await code(page).fill(text);
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(code(page)).toHaveValue(text);
  await expect(submit(page)).toBeEnabled();
}
async function count(page: Page, kind: 'execute' | 'analyze-code') {
  return page.evaluate(
    (kind) => window.__verticalObservation.workers.filter((worker) => worker.kind === kind).length,
    kind,
  );
}
async function archive(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const transaction = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const rows = await Promise.all(
        names.map(async (name) => {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const request = transaction.objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return [name, values] as const;
        }),
      );
      await done;
      return Object.fromEntries(rows);
    } finally {
      db.close();
    }
  });
}
function sameLearning(before: Record<string, unknown[]>, after: Record<string, unknown[]>) {
  for (const key of ['progress', 'ledger', 'dailyFacts', 'receipts', 'goals'])
    expect(after[key]).toEqual(before[key]);
}

interface Run {
  request: ExecuteRequest;
  result: ExecuteResult;
}
async function capture(page: Page, info: TestInfo, label: string) {
  const captures = await page.evaluate(() =>
    window.__verticalObservation.workers
      .filter((worker) => worker.kind === 'execute' || worker.kind === 'analyze-code')
      .map((worker) => {
        const record = worker as typeof worker & {
          captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
        };
        return {
          kind: worker.kind,
          moduleSeen: worker.moduleSeen,
          operationId: worker.operationId,
          responseOperationId: worker.responseOperationId,
          catalogJson: worker.catalogJson,
          ...record.captureEncoded(),
        };
      }),
  );
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '13.2',
    'browser-bidirectional',
    process.env.TASK_EVIDENCE_LABEL ?? 'initial',
    info.project.name,
    label,
  );
  await mkdir(directory, { recursive: true });
  const runs: Run[] = [];
  for (const [index, value] of captures.entries()) {
    expect(value.moduleSeen).toBe(true);
    if (!value.requestBase64 || !value.responseBase64) {
      // Only a superseded analysis may disappear before producing bytes.
      expect(value.kind).toBe('analyze-code');
      continue;
    }
    expect(value.operationId).toBe(value.responseOperationId);
    const requestBytes = Buffer.from(value.requestBase64, 'base64');
    const responseBytes = Buffer.from(value.responseBase64, 'base64');
    await writeFile(join(directory, `${index + 1}-${value.kind}.request.json`), requestBytes);
    await writeFile(join(directory, `${index + 1}-${value.kind}.result.json`), responseBytes);
    if (value.kind === 'execute') {
      const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
      const result = await decodeResult(Uint8Array.from(responseBytes).buffer, request);
      expect(result.producer).toBe('rust');
      expect(request.remainingMs).toBeGreaterThan(0);
      expect(request.remainingMs).toBeLessThanOrEqual(1000);
      runs.push({ request, result });
      await writeFile(join(directory, `${index + 1}-catalog.json`), value.catalogJson!);
    }
  }
  const evidence = {
    label,
    browser: info.project.name,
    phase: await panel(page).getAttribute('data-state'),
    sync: (await editor(page).count()) ? await editor(page).getAttribute('data-sync') : null,
    source: (await code(page).count())
      ? await code(page).inputValue()
      : await page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }).inputValue(),
    archive: await archive(page),
    captures: captures.map(({ requestBase64, responseBase64, ...value }) => ({
      ...value,
      requestBytes: requestBase64 ? Buffer.from(requestBase64, 'base64').length : null,
      responseBytes: responseBase64 ? Buffer.from(responseBase64, 'base64').length : null,
    })),
    runs: runs.map((run) => ({
      identity: run.request.identity,
      terminal: run.result.terminal,
      judgeResult: run.result.judgeResult,
    })),
  };
  await writeFile(join(directory, 'native-ui.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: join(directory, 'screen.png'), fullPage: true });
  await info.attach(label, {
    path: join(directory, 'native-ui.json'),
    contentType: 'application/json',
  });
  return runs;
}

for (const exercise of content.exercises)
  test(`code-origin answer passes every real test and preserves input/control identity: ${exercise.id}`, async ({
    page,
  }, info) => {
    await open(page, exercise.id);
    const before = await archive(page);
    const text = answer(exercise.id);
    await fillSynced(page, text);
    expect(await blockOptions(page, /^\d+\. 输出 ·/)).not.toHaveLength(0);
    sameLearning(before, await archive(page));
    if (exercise.id === echo) {
      await action(page, '运行本组').click();
      await expect(panel(page)).toHaveAttribute('data-state', 'ran');
      sameLearning(before, await archive(page));
    }
    const firstSubmissionIndex = await count(page, 'execute');
    await submit(page).click();
    await expect(panel(page)).toHaveAttribute('data-state', 'passed');
    await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    const saved = await archive(page);
    expect(saved.ledger.length).toBeGreaterThan(before.ledger.length);
    await expect(code(page)).toHaveValue(text);
    const runs = await capture(page, info, exercise.id);
    const submission = runs.slice(firstSubmissionIndex);
    expect(submission).toHaveLength(exercise.tests.length);
    expect(submission.map((run) => run.request.identity.testCaseKey)).toEqual(
      exercise.tests.map((test) => test.caseKey),
    );
    expect(new Set(submission.map((run) => run.request.identity.submissionId)).size).toBe(1);
    expect(new Set(submission.map((run) => run.request.identity.sourceRevision)).size).toBe(
      exercise.tests.length,
    );
    const mappingIds = submission[0].request.source.blockMap
      .map((mapping) => mapping.blockId)
      .sort();
    for (const [index, run] of submission.entries()) {
      expect(run.request.input.values).toEqual(exercise.tests[index].input);
      expect(run.result.terminal.status).toBe('completed');
      expect(run.result.terminal.exitCode).toBe(0);
      expect(run.result.judgeResult?.status).toBe('met');
      const output = run.result.trace?.steps
        .flatMap((step) =>
          step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
        )
        .join('');
      expect(output).toBe(exercise.tests[index].expectedStdout);
      expect(run.request.source.blockMap.map((mapping) => mapping.blockId).sort()).toEqual(
        mappingIds,
      );
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
    if (exercise.id === 'exercise.c.bug-zero-branch') {
      const coverage = submission
        .flatMap((run) => run.result.judgeResult!.coverage)
        .filter((item) => item.visits > 0);
      expect(new Set(coverage.map((item) => item.siteKey)).size).toBe(1);
      expect(new Set(coverage.map((item) => item.branch))).toEqual(new Set(['then', 'else']));
    }
    if (exercise.id === echo) {
      await submit(page).click();
      await expect(panel(page)).toHaveAttribute('data-state', 'passed');
      await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
        'data-save-state',
        'saved',
      );
      const repeated = await archive(page);
      expect(repeated.ledger).toEqual(saved.ledger);
      expect(repeated.dailyFacts).toEqual(saved.dailyFacts);
      await capture(page, info, `${exercise.id}-repeat-no-reward`);
    }
  });

test('a single code-origin source reconstructs every one of the twenty visible block kinds and runs in Rust', async ({
  page,
}, info) => {
  await page.goto('/#/c6/program/teach.c6.ch01.welcome?node=c6.ch01');
  const text =
    '#include <stdio.h>\nint main(){int x=3;int y; y=1; int a[3]={7,-2,0}; {int z=1; z=z+1;} if(x>=0 && !(x<0)){y=a[0];}else{} while(0){continue;break;} for(int i=0;i<1;i=i+1){a[i]=i;} printf("%d\\n",+x); return 0;}';
  await page.getByLabel('完整 C 源码 · main.c', { exact: true }).fill(text);
  await page.getByRole('button', { name: '同步到积木', exact: true }).click();
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  for (const label of [
    '主程序',
    '整数',
    '声明整数',
    '读取变量',
    '变量赋值',
    '一元运算',
    '算术运算',
    '比较',
    '逻辑运算',
    '条件分支',
    'while 循环',
    'for 循环',
    '跳出循环',
    '继续下轮',
    '声明数组',
    '读取数组',
    '写入数组',
    '输出',
    '返回',
    '独立作用域',
  ]) {
    expect(
      await blockOptions(page, new RegExp(`^\\d+\\. ${label}(?: ·|$)`)),
      label,
    ).not.toHaveLength(0);
  }
  await page.getByRole('button', { name: '运行当前代码', exact: true }).click();
  await expect(page.locator('.c6-trace')).toHaveAttribute('data-cursor', '0');
  await page.getByRole('button', { name: '到本次末尾', exact: true }).click();
  await expect(page.getByLabel('当前游标标准输出', { exact: true })).toHaveText('3');
  await expect(page.getByLabel('完整 C 源码 · main.c', { exact: true })).toHaveValue(text);
  const packets = await page.evaluate(() =>
    window.__verticalObservation.workers
      .filter((w) => w.moduleSeen && w.responseOk)
      .map((w) => ({
        ...(
          w as typeof w & { captureEncoded(): { requestBase64: string; responseBase64: string } }
        ).captureEncoded(),
        terminated: w.terminated,
      })),
  );
  expect(packets).toHaveLength(2);
  for (const packet of packets) {
    expect(packet.terminated).toBe(true);
    const request = JSON.parse(
      Buffer.from(packet.requestBase64, 'base64').toString('utf8'),
    ) as C6Request;
    expect(request.source).toBe(text);
    const result = await decodeC6Response(
      Uint8Array.from(Buffer.from(packet.responseBase64, 'base64')).buffer,
      request,
      c6Build.wasmSha256,
    );
    if ('editVersion' in result) expect(result.status).toBe('mapped');
    else if ('terminal' in result) expect(result.terminal.status).toBe('completed');
    else throw new Error('Unexpected judge response for current C6 program');
  }
  await info.attach('all-twenty-current-c6-real-packets', {
    body: gzipSync(JSON.stringify(packets)),
    contentType: 'application/gzip',
  });
  await info.attach('all-twenty-current-c6-source', { body: text, contentType: 'text/plain' });
});

test('invalid, unmapped and protected-input drafts keep exact text, disable execution and recover through real submission', async ({
  page,
}, info) => {
  await open(page);
  const valid = bodySource('printf("%d\\n", x); return 0;');
  await fillSynced(page, valid);
  const boundedRevision = await editor(page).getAttribute('data-document-revision');
  const boundedAnalyses = await count(page, 'analyze-code');
  await code(page).fill('x'.repeat(32769));
  await expect(code(page)).toHaveValue(valid);
  await expect(editor(page).getByRole('alert')).toContainText('32 KiB');
  await expect(editor(page)).toHaveAttribute('data-document-revision', boundedRevision!);
  expect(await count(page, 'analyze-code')).toBe(boundedAnalyses);
  const before = await archive(page);
  const executions = await count(page, 'execute');
  const cases = [
    { name: 'temporary-parse-error', text: bodySource('if ('), status: 'invalid' },
    {
      name: 'empty-statement',
      text: bodySource('; printf("%d\\n", x);return 0;'),
      status: 'unmapped',
    },
    {
      name: 'for-array-target',
      text: bodySource('int a[1]={0};for(a[0]=0;a[0]<1;a[0]=a[0]+1){}printf("%d\\n",x);return 0;'),
      status: 'unmapped',
    },
    {
      name: 'underscore-name',
      text: bodySource('int _local=1;printf("%d\\n",x);return 0;'),
      status: 'unmapped',
    },
    {
      name: 'raw-tab-format',
      text: bodySource('printf("\t%d\\n",x);return 0;'),
      status: 'unmapped',
    },
    { name: 'renamed-input', text: valid.replace(/\bx\b/g, 'renamed'), status: 'invalid' },
    {
      name: 'shadowed-input-reference',
      text: bodySource('{int x=9;printf("%d\\n",x);}return 0;'),
      status: 'invalid',
    },
  ];
  for (const entry of cases) {
    await code(page).fill(entry.text);
    await expect(editor(page), entry.name).toHaveAttribute('data-sync', entry.status);
    await expect(code(page)).toHaveValue(entry.text);
    await expect(submit(page)).toBeDisabled();
    await expect(action(page, '运行本组')).toBeDisabled();
    await expect(page.getByTestId('historical-blocks-notice')).toContainText('上次有效结构');
    if (entry.status === 'unmapped') {
      const revision = await editor(page).getAttribute('data-document-revision');
      await editor(page)
        .getByRole('button', { name: /^定位问题：第/ })
        .first()
        .click();
      const selection = await code(page).evaluate((area: HTMLTextAreaElement) => ({
        start: area.selectionStart,
        end: area.selectionEnd,
      }));
      expect(selection.end).toBeGreaterThan(selection.start);
      await expect(code(page)).toBeFocused();
      await expect(code(page)).toBeInViewport();
      await expect(code(page)).toHaveValue(entry.text);
      await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
    }
    expect(await count(page, 'execute')).toBe(executions);
  }
  sameLearning(before, await archive(page));
  await code(page).fill(bodySource('if ('));
  await code(page).fill(valid);
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(code(page)).toHaveValue(valid);
  await submit(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await capture(page, info, 'invalid-unmapped-binding-recovery');
});

test('native block selection and code pointer selection preserve an accepted run and document revision', async ({
  page,
}, info) => {
  const id = 'exercise.c.bug-zero-branch';
  await open(page, id);
  const text = bodySource('if (1) {\n \t// 仅选区注释😀\n\nprintf("%d\\n", x);\n}\nreturn 0;', id);
  await fillSynced(page, text);
  await action(page, '运行本组').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  const documentRevision = await editor(page).getAttribute('data-document-revision');
  const analyses = await count(page, 'analyze-code');
  const executions = await count(page, 'execute');
  const prints = await blockOptions(page, /^\d+\. 输出 ·/);
  expect(prints).toHaveLength(1);
  const shape = blockWorkspace(page)
    .locator(
      `.block-canvas .blocklyBlockCanvas [data-id=${JSON.stringify(prints[0])}] .blocklyText`,
    )
    .filter({ hasText: /^输出格式$/ })
    .first();
  await shape.scrollIntoViewIfNeeded();
  const bounds = await shape.boundingBox();
  if (!bounds) throw new Error('A native rendered output block is required');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByTestId('code-block-highlight')).toContainText('printf');
  const selection = await code(page).evaluate((area: HTMLTextAreaElement) => ({
    start: area.selectionStart,
    end: area.selectionEnd,
  }));
  expect(text.slice(selection.start, selection.end)).toContain('printf');
  await code(page).scrollIntoViewIfNeeded();
  const target = await code(page).evaluate((area: HTMLTextAreaElement) => {
    const at = area.value.indexOf('printf') + 2;
    const start = area.value.lastIndexOf('\n', at) + 1;
    const row = area.value.slice(0, at).split('\n').length - 1;
    const style = getComputedStyle(area);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const width = context.measureText('M').width;
    const rect = area.getBoundingClientRect();
    return {
      x: rect.left + parseFloat(style.paddingLeft) + (at - start + 0.5) * width - area.scrollLeft,
      y:
        rect.top +
        parseFloat(style.paddingTop) +
        (row + 0.5) * parseFloat(style.lineHeight) -
        area.scrollTop,
    };
  });
  await page.mouse.click(target.x, target.y);
  await expect(
    blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true }),
  ).toHaveValue(prints[0]);
  // This is a real textarea selection, spanning adjacent whitespace, comment,
  // and newline trivia inside an if. It must not select that if or main.
  await code(page).evaluate((area: HTMLTextAreaElement) => {
    const start = area.value.indexOf(' \t// 仅选区注释😀');
    const end = area.value.indexOf('printf');
    area.focus();
    area.setSelectionRange(start, end);
    area.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await code(page).press('Shift+ArrowLeft');
  await expect(page.getByTestId('code-block-highlight')).toHaveCount(0);
  await expect(
    blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true }),
  ).toHaveValue(prints[0]);
  await expect(editor(page)).toHaveAttribute('data-document-revision', documentRevision!);
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  expect(await count(page, 'execute')).toBe(executions);
  expect(await count(page, 'analyze-code')).toBe(analyses);
  await capture(page, info, 'native-selection-preserves-run');
});

test('native block field edits preserve comments, unaffected bytes and a single explicit return through repeated round trips', async ({
  page,
}, info) => {
  await open(page);
  const text = bodySource(
    '// 句前保留😀\nprintf(/* 输出内部保留😀 */"%d\\n", x); // 同行尾注保留\nreturn 0;',
  );
  await fillSynced(page, text);
  const prefix = text.slice(0, text.indexOf('printf'));
  for (const format of ['[%d]\\n', '%d\\n', '%d 次数\\n', '%d\\n']) {
    const prints = await blockOptions(page, /^\d+\. 输出 ·/);
    expect(prints).toHaveLength(1);
    await selectBlock(page, prints[0]);
    await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill(format);
    await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
    const result = await code(page).inputValue();
    expect(result.startsWith(prefix)).toBe(true);
    expect(result.match(/句前保留😀/g)).toHaveLength(1);
    expect(result.match(/输出内部保留😀/g)).toHaveLength(1);
    expect(result.match(/同行尾注保留/g)).toHaveLength(1);
    expect(result.match(/\breturn\b/g)).toHaveLength(1);
    await expect(submit(page)).toBeEnabled();
  }
  await expect(code(page)).toHaveValue(/printf\("%d\\n", x\)/);
  await submit(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await capture(page, info, 'comments-and-return-roundtrip');
});

test('invalid code remains intact across editor folding, theme change, settings return and answer-mode switching', async ({
  page,
}, info) => {
  await open(page);
  // This case starts from a durable display preference. Recover a concurrent
  // initial history/settings conflict through the same public control first.
  await expect(page.getByTestId('editor-history')).toHaveAttribute('data-save-state', 'ready');
  const preference = page.getByTestId('block-preference-save-status');
  await expect(preference).not.toHaveAttribute('data-save-state', 'saving');
  const retryPreference = page.getByRole('button', { name: '重新读取并保存选择', exact: true });
  const recoveredPreference = await retryPreference.isVisible();
  if (recoveredPreference) await retryPreference.click();
  await expect(preference).toHaveAttribute('data-save-state', /^(ready|saved)$/);
  await expect(page.getByTestId('theme-mode-toggle')).toBeEnabled();
  await info.attach('display-preference-precondition', {
    body: Buffer.from(
      JSON.stringify({
        recoveredPreference,
        status: await preference.getAttribute('data-save-state'),
      }),
    ),
    contentType: 'application/json',
  });
  const valid = bodySource('printf("%d\\n",x);return 0;');
  await fillSynced(page, valid);
  const invalid = bodySource('if ( /* 尚未写完的😀草稿 */');
  await code(page).fill(invalid);
  await expect(editor(page)).toHaveAttribute('data-sync', 'invalid');
  const revision = await editor(page).getAttribute('data-document-revision');
  const analyses = await count(page, 'analyze-code');
  const before = await archive(page);
  await action(page, '收起代码编辑').click();
  await expect(editor(page)).toHaveCount(0);
  await action(page, '编辑 C 并同步积木').click();
  await expect(code(page)).toHaveValue(invalid);
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  await page.getByTestId('theme-mode-toggle').click();
  await expect(code(page)).toHaveValue(invalid);
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  expect(await count(page, 'analyze-code')).toBe(analyses);
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '本地设置', exact: true })
    .click();
  await expect(page.getByTestId('appearance-settings')).toBeVisible();
  await page.getByTestId('theme-cute').click();
  await page.getByTestId('save-appearance').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
  await page.goBack();
  await expect(code(page)).toHaveValue(invalid);
  await expect(editor(page)).toHaveAttribute('data-sync', 'invalid');
  const display = page.getByRole('combobox', { name: '积木显示', exact: true });
  await display.selectOption('hide');
  await expect(page.getByTestId('practice-editor-layout')).toHaveAttribute(
    'data-blocks-visible',
    'no',
  );
  await expect(code(page)).toHaveValue(invalid);
  await display.selectOption('show');
  await expect(page.getByTestId('practice-editor-layout')).toHaveAttribute(
    'data-blocks-visible',
    'yes',
  );
  await expect(code(page)).toHaveValue(invalid);
  await expect(editor(page)).toHaveAttribute('data-sync', 'invalid');
  await expect(submit(page)).toBeDisabled();
  expect(await count(page, 'execute')).toBe(0);
  sameLearning(before, await archive(page));
  await fillSynced(page, valid);
  await capture(page, info, 'invalid-draft-presentation-and-visibility');
});

test('a synchronized native field edit keeps its undo and redo history, source comments and no learning side effects', async ({
  page,
}, info) => {
  await open(page);
  const text = bodySource(
    '// 撤销前保留😀\nprintf(/* 内部注释保留😀 */"%d\\n", x); // 尾部注释保留\nreturn 0;',
  );
  await fillSynced(page, text);
  const before = await archive(page);
  const initialRevision = Number(await editor(page).getAttribute('data-document-revision'));
  const prints = await blockOptions(page, /^\d+\. 输出 ·/);
  expect(prints).toHaveLength(1);
  await selectBlock(page, prints[0]);
  await blockWorkspace(page)
    .getByRole('textbox', { name: '输出格式', exact: true })
    .fill('[%d]\\n');
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  const changed = await code(page).inputValue();
  expect(changed).toContain('printf("[%d]\\n", x)');
  await expect(editor(page)).toHaveAttribute('data-document-revision', String(initialRevision + 1));
  const undo = blockWorkspace(page).getByRole('button', { name: '撤销', exact: true });
  const redo = blockWorkspace(page).getByRole('button', { name: '重做', exact: true });
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  let revision = initialRevision + 1;
  for (let cycle = 0; cycle < 2; cycle++) {
    await undo.click();
    await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
    await expect(code(page)).toHaveValue(/printf\("%d\\n", x\)/);
    await expect(editor(page)).toHaveAttribute('data-document-revision', String(++revision));
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
    await expect(code(page)).toHaveValue(changed);
    await expect(editor(page)).toHaveAttribute('data-document-revision', String(++revision));
    await expect(undo).toBeEnabled();
    const current = await code(page).inputValue();
    for (const comment of ['撤销前保留😀', '内部注释保留😀', '尾部注释保留'])
      expect(current.split(comment)).toHaveLength(2);
    expect(current.match(/\breturn\b/g)).toHaveLength(1);
  }
  expect(await count(page, 'execute')).toBe(0);
  sameLearning(before, await archive(page));
  expect(await capture(page, info, 'synchronized-native-undo-redo')).toHaveLength(0);
});

test('folding and reanalysis retain the last test result identity while the first-input editing draft stays separate', async ({
  page,
}, info) => {
  const id = 'exercise.c.bug-sum-initial';
  const catalog = exerciseCatalog(content, id);
  const lastTest = catalog.subject.tests.at(-1)!;
  expect(lastTest.input).not.toEqual(catalog.subject.tests[0].input);
  await open(page, id);
  const draft = answer(id);
  await fillSynced(page, draft);
  await submit(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  const before = await archive(page);
  const accepted = await capture(page, info, 'retained-result-before-folding');
  expect(accepted).toHaveLength(catalog.subject.tests.length);
  const last = accepted.at(-1)!;
  expect(last.request.identity.testCaseKey).toBe(lastTest.caseKey);
  expect(last.request.input.values).toEqual(lastTest.input);
  expect(last.request.source.text).not.toBe(draft);
  const retained = page.getByTestId('practice-retained-case');
  const input = page.getByTestId('practice-input').locator('code');
  const readonly = page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
  const revealExecutedSource = async () => {
    const details = page.getByTestId('executed-source-details');
    await expect(details).toBeVisible();
    if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
    await expect(
      details.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }),
    ).toHaveValue(last.request.source.text);
  };
  await revealExecutedSource();
  await expect(editor(page).locator('p.source-position > code')).toHaveText(
    JSON.stringify(catalog.subject.tests[0].input),
  );
  await expect(retained).toContainText(lastTest.caseKey);
  await expect(input).toHaveText(JSON.stringify(lastTest.input));
  const revision = await editor(page).getAttribute('data-document-revision');
  const executions = await count(page, 'execute');
  await action(page, '收起代码编辑').click();
  await expect(readonly).toHaveAttribute('readonly', '');
  await expect(readonly).toHaveValue(last.request.source.text);
  await expect(retained).toContainText(lastTest.caseKey);
  await action(page, '编辑 C 并同步积木').click();
  await expect(code(page)).toHaveValue(draft);
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  await expect(input).toHaveText(JSON.stringify(lastTest.input));
  await revealExecutedSource();
  const analyses = await count(page, 'analyze-code');
  await action(page, '准备代码').click();
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(code(page)).toHaveValue(draft);
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(editor(page)).toHaveAttribute('data-document-revision', revision!);
  await expect(retained).toContainText(lastTest.caseKey);
  await expect(input).toHaveText(JSON.stringify(lastTest.input));
  await revealExecutedSource();
  expect(await count(page, 'analyze-code')).toBe(analyses + 1);
  expect(await count(page, 'execute')).toBe(executions);
  await action(page, '收起代码编辑').click();
  await expect(readonly).toHaveValue(last.request.source.text);
  await page.getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await expect(page.locator('[data-mode="exercise-review"]')).toBeVisible();
  await expect(page.getByRole('button', { name: '提交练习', exact: true })).toHaveCount(0);
  await expect(code(page)).toHaveCount(0);
  await expect(readonly).toHaveValue(last.request.source.text);
  await expect(retained).toContainText(lastTest.caseKey);
  await expect(input).toHaveText(JSON.stringify(lastTest.input));
  await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
  await action(page, '编辑 C 并同步积木').click();
  await expect(code(page)).toHaveValue(draft);
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  await expect(retained).toContainText(lastTest.caseKey);
  const after = await capture(page, info, 'retained-result-after-folding-and-reanalysis');
  expect(after).toHaveLength(accepted.length);
  expect(after.at(-1)!.request.identity).toEqual(last.request.identity);
  expect(after.at(-1)!.request.source).toEqual(last.request.source);
  sameLearning(before, await archive(page));
});

// Original regression identities; the carrier mapping is explicit in each annotation.
test('code-origin answer passes every real test and preserves input/control identity: exercise.c.echo', async ({
  page,
}, info) => {
  await currentEditorRegression(page, info, 0);
});
test('code-origin answer passes every real test and preserves input/control identity: exercise.c.two-x-plus-three', async ({
  page,
}, info) => {
  await currentEditorRegression(page, info, 1);
});
test('code-origin answer passes every real test and preserves input/control identity: exercise.c.nonnegative', async ({
  page,
}, info) => {
  await currentEditorRegression(page, info, 2);
});
test('code-origin answer passes every real test and preserves input/control identity: exercise.c.two-loop-sums', async ({
  page,
}, info) => {
  await currentEditorRegression(page, info, 3);
});
test('code-origin answer passes every real test and preserves input/control identity: exercise.c.increment-at-index', async ({
  page,
}, info) => {
  await currentEditorRegression(page, info, 4);
});
test('code-origin answer passes every real test and preserves input/control identity: exercise.c.array-sum', async ({
  page,
}, info) => {
  await currentEditorRegression(page, info, 5);
});
