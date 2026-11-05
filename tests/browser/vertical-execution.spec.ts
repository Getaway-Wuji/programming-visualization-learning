import { expectEditorValue, editorValue } from './editor-value';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { InputValues } from '../../web/src/content/types';
import type { ExecuteRequest, ExecuteResult } from '../../web/src/engine/protocol';
import { observedExecute, observeVerticalExecution } from './vertical-observation';
import { isolateCaseProgram, type IsolatedCaseContentCopy } from './case-content-copy';

type Variant = 'original' | 'division' | 'bounds';
interface FaultCopy extends IsolatedCaseContentCopy {
  find: string;
  replace: string;
}
interface VerticalCase {
  key: string;
  caseId: string;
  values: InputValues;
  draft: Record<string, string>;
  sourceFragments: string[];
  stdout: string;
  status: 'completed' | 'program-error';
  completeness: 'complete' | 'prefix';
  diagnosticCode: string | null;
  variant: Variant;
}
const cases: readonly VerticalCase[] = [
  {
    key: 'assignment',
    caseId: 'case.c.assignment',
    values: { x: -7 },
    draft: { x: '-7' },
    sourceFragments: ['int x = -7;', 'x = x + 2;'],
    stdout: '-5\n',
    status: 'completed',
    completeness: 'complete',
    diagnosticCode: null,
    variant: 'original',
  },
  {
    key: 'array-traversal',
    caseId: 'case.c.array-traversal',
    values: { values: [-2, 5, 5, 0] },
    draft: { values: '-2, 5, 5, 0' },
    sourceFragments: ['int n = 4;', 'int values[4] = {-2, 5, 5, 0};'],
    stdout: '8\n',
    status: 'completed',
    completeness: 'complete',
    diagnosticCode: null,
    variant: 'original',
  },
  {
    key: 'bubble-sort',
    caseId: 'case.c.bubble-sort',
    values: { values: [4, -1, 4, 0] },
    draft: { values: '4, -1, 4, 0' },
    sourceFragments: ['int n = 4;', 'int values[4] = {4, -1, 4, 0};'],
    stdout: '-1 0 4 4\n',
    status: 'completed',
    completeness: 'complete',
    diagnosticCode: null,
    variant: 'original',
  },
  {
    key: 'array-empty',
    caseId: 'case.c.array-traversal',
    values: { values: [] },
    draft: { values: '[]' },
    sourceFragments: ['int n = 0;', 'int values[1] = {0};'],
    stdout: '0\n',
    status: 'completed',
    completeness: 'complete',
    diagnosticCode: null,
    variant: 'original',
  },
  {
    key: 'assignment-div-zero',
    caseId: 'case.c.assignment',
    values: { x: -7 },
    draft: { x: '-7' },
    sourceFragments: ['int x = -7;', 'printf("%d\\n", x); x = x / 0;'],
    stdout: '-7\n',
    status: 'program-error',
    completeness: 'prefix',
    diagnosticCode: 'E_DIV_ZERO',
    variant: 'division',
  },
  {
    key: 'array-out-of-bounds',
    caseId: 'case.c.array-traversal',
    values: { values: [-2, 5, 5, 0] },
    draft: { values: '-2, 5, 5, 0' },
    sourceFragments: ['int n = 4;', 'sum = values[n];'],
    stdout: '8\n',
    status: 'program-error',
    completeness: 'prefix',
    diagnosticCode: 'E_INDEX_BOUNDS',
    variant: 'bounds',
  },
];
const captureRoot = fileURLToPath(
  new URL(
    `../../.artifacts/${process.env.TASK_EVIDENCE_TASK ? `${process.env.TASK_EVIDENCE_TASK}/regression/vertical-execution` : '07.3'}/browser-captures/`,
    import.meta.url,
  ),
);
const panel = (page: Page) => page.getByTestId('case-execution');
const code = (page: Page) =>
  panel(page).getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

async function injectPublicFaultCopy(page: Page, variant: Exclude<Variant, 'original'>) {
  const programId = variant === 'division' ? 'program.c.assignment' : 'program.c.array-sum';
  const find = variant === 'division' ? 'x = x + 2;' : '    return 0;';
  const replace =
    variant === 'division'
      ? 'printf("%d\\n", x); x = x / 0;'
      : '    sum = values[n];\n    return 0;';
  const isolation = await isolateCaseProgram(page, programId, (originalSource) => {
    if (originalSource.split(find).length !== 2)
      throw new Error('The isolated public fault must replace exactly one statement.');
    return originalSource.replace(find, replace);
  });
  return {
    getCopy: (): FaultCopy | undefined => {
      const copy = isolation.getCopy();
      return copy && { ...copy, find, replace };
    },
    restore: isolation.restore,
  };
}

async function prepareAndRun(page: Page, item: VerticalCase, reload = false) {
  if (reload) await page.reload();
  else await page.goto(`/#/visualize/${item.caseId}`);
  await expect(page.getByTestId('input-panel')).toBeVisible();
  for (const [key, value] of Object.entries(item.draft))
    await page.getByTestId(`input-field-${key}`).fill(value);
  await panel(page).getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  for (const fragment of item.sourceFragments)
    await expectEditorValue(
      code(page),
      new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  await expect(code(page)).toHaveAttribute('readonly', '');
  await panel(page).getByRole('button', { name: '运行示例', exact: true }).click();
  // Only the consumer's accepted terminal is evidence; receiving a raw Worker buffer is insufficient.
  await expect(panel(page)).toHaveAttribute('data-state', item.status);
  await expect(page.getByTestId('execution-terminal')).toHaveText(
    item.status === 'completed' ? '程序正常结束' : '程序发生错误',
  );
  await expect(page.getByTestId('execution-output')).toHaveText(item.stdout);
  if (item.diagnosticCode) {
    const diagnostic = page.getByTestId('animation-panel').getByTestId('diagnostic-item');
    await expect(diagnostic).toHaveAttribute('data-code', item.diagnosticCode);
    await expect(diagnostic).toHaveAttribute('data-stage', 'execute');
    await expect(diagnostic.getByTestId('diagnostic-gcc')).toContainText(
      `[${item.diagnosticCode}]`,
    );
    await expect(diagnostic.getByRole('button', { name: /定位问题/ })).toBeVisible();
  }
}

async function saveCapture(
  page: Page,
  item: VerticalCase,
  testInfo: TestInfo,
  fault: FaultCopy | null,
  directory = item.key,
) {
  const worker = await observedExecute(page);
  const requestBytes = Buffer.from(worker.requestBytes!);
  const resultBytes = Buffer.from(worker.responseBytes!);
  const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
  const result = JSON.parse(resultBytes.toString('utf8')) as ExecuteResult;
  const catalog = JSON.parse(worker.catalogJson!) as {
    subject: { id: string };
    program: { id: string; sourceExample: string; exampleInput: InputValues };
  };
  const displayedSource = await editorValue(code(page));
  const inputText = await page.getByTestId('execution-input').locator('code').first().textContent();
  const inputValues = JSON.parse(inputText!) as InputValues;
  const stdout = await page.getByTestId('execution-output').textContent();
  const stepsText = await page.getByTestId('execution-steps').textContent();
  const stepCount = Number(stepsText?.match(/有效轨迹：(\d+)\s*步/u)?.[1]);
  const diagnosticItems = page.getByTestId('animation-panel').getByTestId('diagnostic-item');
  const diagnosticText = await diagnosticItems.allTextContents();
  const diagnosticCodes = await diagnosticItems.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-code')),
  );
  const draft: Record<string, string> = {};
  for (const key of Object.keys(item.draft))
    draft[key] = await editorValue(page.getByTestId(`input-field-${key}`));
  const ui = {
    caseId: item.caseId,
    route: new URL(page.url()).hash,
    displayedSource,
    inputValues,
    draft,
    stdout,
    status: await panel(page).getAttribute('data-state'),
    terminalText: await page.getByTestId('execution-terminal').textContent(),
    stepsText,
    stepCount,
    diagnosticCodes,
    diagnosticText,
    readOnly: await code(page).evaluate((element) => (element as HTMLTextAreaElement).readOnly),
    runId: request.identity.runId,
    submissionId: request.identity.submissionId,
  };
  const output = result.trace
    ? result.trace.initialState.output +
      result.trace.steps
        .flatMap((step) =>
          step.changes.filter((change) => change.op === 'output').map((change) => change.append),
        )
        .join('')
    : null;
  expect(worker).toMatchObject({
    kind: 'execute',
    responseOk: true,
    moduleSeen: true,
    terminated: true,
  });
  expect(new URL(worker.url).origin).toBe(new URL(page.url()).origin);
  expect(worker.responseOperationId).toBe(worker.operationId);
  expect(catalog.subject.id).toBe(item.caseId);
  expect(request.mode).toBe('case');
  expect(request.source.text).toBe(displayedSource);
  expect(request.input.values).toEqual(item.values);
  expect(request.input.random).toBeNull();
  expect(inputValues).toEqual(request.input.values);
  expect(result.identity).toEqual(request.identity);
  expect(result.producer).toBe('rust');
  expect(result.terminal.status).toBe(item.status);
  expect(result.trace?.completeness).toBe(item.completeness);
  expect(result.terminal.cursor).toBe(result.trace?.steps.length);
  expect(stepCount).toBe(result.trace?.steps.length);
  expect(stepCount).toBeGreaterThan(1);
  expect(stdout).toBe(item.stdout);
  expect(output).toBe(stdout);
  expect(ui.status).toBe(result.terminal.status);
  expect(ui.readOnly).toBe(true);
  expect(result.judgeResult).toBeNull();
  if (item.diagnosticCode) {
    expect(result.terminal.exitCode).toBeNull();
    expect(result.terminal.diagnostics).toContainEqual(
      expect.objectContaining({
        code: item.diagnosticCode,
        origin: 'rust',
        stage: 'execute',
      }),
    );
    expect(diagnosticCodes).toContain(item.diagnosticCode);
    expect(stepsText).toContain('未完成的有效前缀');
    expect(catalog.program.sourceExample).toBe(fault?.modifiedSource);
  } else {
    expect(result.terminal.exitCode).toBe(0);
    expect(result.terminal.diagnostics).toEqual([]);
    expect(diagnosticCodes).toEqual([]);
    expect(stepsText).not.toContain('未完成');
  }
  const capture = {
    captureVersion: '07.3-browser-capture@1',
    evidenceLevel: 'production-ui-real-worker',
    dataRule: 'DEC-001 KEEP-09 public developer samples only',
    caseKey: item.key,
    caseId: item.caseId,
    project: testInfo.project.name,
    browserVersion: page.context().browser()?.version(),
    variant: item.variant,
    sourceKind: fault ? fault.sourceKind : 'public-content-original',
    publicationEvidence: fault ? false : undefined,
    provenance: fault
      ? 'public-developer-test/isolated-application-case-config-copy'
      : 'public-developer-test/original-content',
    worker: {
      id: worker.id,
      url: worker.url,
      kind: worker.kind,
      operationId: worker.operationId,
      responseOperationId: worker.responseOperationId,
      responseOk: worker.responseOk,
      terminated: worker.terminated,
      moduleSeen: worker.moduleSeen,
    },
    requestByteLength: requestBytes.length,
    resultByteLength: resultBytes.length,
    requestSha256: sha256(requestBytes),
    resultSha256: sha256(resultBytes),
    catalogSha256: sha256(worker.catalogJson!),
    sourceSha256: sha256(displayedSource),
    expected: {
      status: item.status,
      stdout: item.stdout,
      completeness: item.completeness,
      diagnosticCode: item.diagnosticCode,
    },
    fault,
  };
  const target = join(captureRoot, testInfo.project.name, directory);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'request.bin'), requestBytes);
  await writeFile(join(target, 'request.json'), requestBytes);
  await writeFile(join(target, 'result.bin'), resultBytes);
  await writeFile(join(target, 'result.json'), resultBytes);
  await writeFile(join(target, 'catalog.json'), worker.catalogJson!);
  await writeFile(join(target, 'source.c'), displayedSource);
  await writeFile(join(target, 'ui.json'), JSON.stringify(ui, null, 2) + '\n');
  await writeFile(join(target, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
  await page.screenshot({ path: join(target, 'screenshot.png'), fullPage: true });
  await testInfo.attach(item.key, {
    body: JSON.stringify(capture),
    contentType: 'application/json',
  });
  return { request, result, ui, capture };
}

for (const item of cases) {
  test(`production UI submits and presents real Rust ${item.key}`, async ({ page }, testInfo) => {
    await observeVerticalExecution(page);
    const fault =
      item.variant === 'original' ? undefined : await injectPublicFaultCopy(page, item.variant);
    await prepareAndRun(page, item);
    const captured = await saveCapture(page, item, testInfo, fault?.getCopy() ?? null);
    if (item.variant !== 'original') {
      expect(fault?.getCopy()).toBeDefined();
      await fault!.restore();
      const recovered = {
        ...item,
        key: `${item.key}-recovery`,
        variant: 'original' as const,
        status: 'completed' as const,
        completeness: 'complete' as const,
        diagnosticCode: null,
        sourceFragments:
          item.variant === 'division'
            ? ['int x = -7;', 'x = x + 2;']
            : ['int n = 4;', 'int values[4] = {-2, 5, 5, 0};'],
        stdout: item.variant === 'division' ? '-5\n' : '8\n',
      };
      await prepareAndRun(page, recovered, true);
      const recovery = await saveCapture(page, recovered, testInfo, null, `${item.key}/recovery`);
      expect(recovery.request.identity.runId).not.toBe(captured.request.identity.runId);
      expect(recovery.request.identity.submissionId).not.toBe(
        captured.request.identity.submissionId,
      );
      expect(recovery.request.identity.contextId).not.toBe(captured.request.identity.contextId);
    }
  });
}
