import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ContentPackage, ExerciseEntity } from '../../web/src/content/types';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
import type { AnalysisRequest, ValidAnalysisResult } from '../../web/src/blocks/analysis-types';
import {
  decodeResult,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../web/src/engine/protocol';
import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import type { StorageSnapshot } from '../../web/src/storage/model';
import {
  observeCaseSetExecution,
  type CaseSetWorkerTechnical,
  type CaseSetWorkerTiming,
} from './case-set-observation';

const source = JSON.parse(
  readFileSync('content/c/p05/course-1.0.0.json', 'utf8'),
) as ContentPackage;
const references = JSON.parse(
  readFileSync('tests/fixtures/p05-reference-solutions.json', 'utf8'),
) as {
  solutions: { exerciseRef: { id: string; version: string }; source: string }[];
};
const solutions = new Map(
  references.solutions.map((entry) => [entry.exerciseRef.id, entry.source]),
);
const panel = (page: Page) => page.getByTestId('practice-execution');
const editor = (page: Page) => page.getByTestId('draft-code-editor');
const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const sameRange = (left: { start: number; end: number }, right: { start: number; end: number }) =>
  left.start === right.start && left.end === right.end;

test.beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));

/** Native readonly observations, including the real current generation. No learning rows are seeded. */
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(database.objectStoreNames);
      const transaction = database.transaction(names, 'readonly');
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
      return {
        version: database.version,
        names,
        data: Object.fromEntries(rows) as unknown as StorageSnapshot,
      };
    } finally {
      database.close();
    }
  });
}
function noLearning(data: StorageSnapshot) {
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'] as const)
    expect(data[store]).toEqual([]);
}
/** Real Rust preparation changes public input declarations only. The answer is then typed through the editor. */
function preparedReference(exercise: ExerciseEntity) {
  const program = source.programs.find((entry) => entry.id === exercise.programRef.id)!;
  const catalog = {
    packageRef: { id: source.packageId, version: source.packageVersion },
    subject: exercise,
    program: { ...program, sourceExample: solutions.get(exercise.id)! },
    inputSpec: source.inputSpecs.find((entry) => entry.id === program.inputRef.id),
    judgeProfile: source.judgeProfiles.find((entry) => entry.id === exercise.judgeRef.id),
  };
  const input = exercise.tests[0].input;
  const values = Object.fromEntries(
    Object.keys(input)
      .sort()
      .map((key) => [key, input[key]]),
  );
  return (
    JSON.parse(
      new TextDecoder().decode(
        prepare_input(
          JSON.stringify(catalog),
          new TextEncoder().encode(JSON.stringify(values)),
          1000,
        ),
      ),
    ) as { source: { text: string } }
  ).source.text;
}
async function openAnswer(page: Page, id: string) {
  await page.goto(`/#/practice/${encodeURIComponent(id)}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('learning-save-status')).not.toHaveAttribute(
    'data-save-status',
    'loading',
  );
  // The candidate has no learning authority. Open the ordinary code editor
  // without making any preference-save command a prerequisite for this gate.
  if (!(await code(page).isVisible())) {
    try {
      await panel(page)
        .getByRole('button', { name: '编辑 C 并同步积木', exact: true })
        .click({ timeout: 2000 });
    } catch (error) {
      // The real presentation recommendation can open the editor while the
      // click is waiting, removing this button. Accept that transition only
      // when the ordinary editor is now visible; other click failures remain.
      if (!(await code(page).isVisible())) throw error;
    }
  }
  await expect(code(page)).toBeEditable();
  await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
  const empty = await code(page).inputValue();
  expect(empty).toContain('main');
  expect(empty).not.toContain('printf(');
  return empty;
}
async function workerOffset(page: Page) {
  return page.evaluate(() => window.__verticalObservation.workers.length);
}
interface Capture {
  kind: string;
  catalogJson: string | null;
  operationId: string | null;
  responseOperationId: string | null;
  responseOk: boolean | null;
  moduleSeen: boolean;
  terminated: boolean;
  timing: CaseSetWorkerTiming | null;
  technical: CaseSetWorkerTechnical | null;
  requestBase64: string | null;
  responseBase64: string | null;
}
async function rawCaptures(page: Page, offset: number): Promise<Capture[]> {
  return page.evaluate(
    (first) =>
      window.__verticalObservation.workers
        .slice(first)
        .filter((worker) => ['execute', 'analyze-code'].includes(worker.kind))
        .map((worker) => {
          const observed = worker as typeof worker & {
            timing?: CaseSetWorkerTiming;
            technical?: CaseSetWorkerTechnical | null;
            captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
          };
          return {
            kind: worker.kind,
            catalogJson: worker.catalogJson,
            operationId: worker.operationId,
            responseOperationId: worker.responseOperationId,
            responseOk: worker.responseOk,
            moduleSeen: worker.moduleSeen,
            terminated: worker.terminated,
            timing: observed.timing ?? null,
            technical: observed.technical ?? null,
            ...observed.captureEncoded(),
          };
        }),
    offset,
  );
}
interface RealGroup {
  exerciseId: string;
  caseKey: string;
  worker: number;
  terminal: string;
  judge: string | undefined;
  fuel: number | null;
  steps: number | null;
  blockMapCount: number;
  checkedAstNodes: number;
  mappedRangesInRealAst: number;
  sourceRevision: number;
  remainingMs: number;
  protocolVersion: string;
  requestSha256: string;
  resultSha256: string;
  catalogSha256: string;
}
async function inspectCaptures(
  captures: Capture[],
  exercise: ExerciseEntity,
  folder: string,
  prefix: string,
  strict: boolean,
): Promise<RealGroup[]> {
  const analyses: { request: AnalysisRequest; result: ValidAnalysisResult }[] = [];
  const executions: {
    request: ExecuteRequest;
    result: ExecuteResult;
    worker: number;
    requestSha256: string;
    resultSha256: string;
    catalogSha256: string;
  }[] = [];
  for (const [index, capture] of captures.entries()) {
    const name = `${prefix}-worker-${String(index + 1).padStart(3, '0')}-${capture.kind}`;
    const requestBytes = capture.requestBase64
      ? Buffer.from(capture.requestBase64, 'base64')
      : null;
    const resultBytes = capture.responseBase64
      ? Buffer.from(capture.responseBase64, 'base64')
      : null;
    if (requestBytes)
      await writeFile(join(folder, `${name}.request.json`), requestBytes, { flag: 'wx' });
    if (resultBytes)
      await writeFile(join(folder, `${name}.result.json`), resultBytes, { flag: 'wx' });
    if (capture.catalogJson)
      await writeFile(join(folder, `${name}.catalog.json`), capture.catalogJson, { flag: 'wx' });
    await writeFile(
      join(folder, `${name}.metadata.json`),
      JSON.stringify({ ...capture, requestBase64: undefined, responseBase64: undefined }, null, 2) +
        '\n',
      { flag: 'wx' },
    );
    if (!requestBytes || !resultBytes) continue;
    const request = JSON.parse(requestBytes.toString('utf8')) as AnalysisRequest | ExecuteRequest;
    if (capture.kind === 'analyze-code') {
      const result = JSON.parse(resultBytes.toString('utf8')) as ValidAnalysisResult;
      if (result.kind === 'analysisResult' && result.status === 'valid')
        analyses.push({ request: request as AnalysisRequest, result });
    } else {
      let result: ExecuteResult;
      try {
        result = await decodeResult(Uint8Array.from(resultBytes).buffer, request as ExecuteRequest);
      } catch (error) {
        if (strict) throw error;
        await writeFile(
          join(folder, `${name}.decode-error.json`),
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n',
          { flag: 'wx' },
        );
        continue;
      }
      executions.push({
        request: request as ExecuteRequest,
        result,
        worker: index + 1,
        requestSha256: digest(requestBytes),
        resultSha256: digest(resultBytes),
        catalogSha256: digest(capture.catalogJson!),
      });
      if (strict) {
        expect(capture.moduleSeen).toBe(true);
        expect(capture.responseOk).toBe(true);
        expect(capture.terminated).toBe(true);
        expect(capture.responseOperationId).toBe(capture.operationId);
      }
    }
  }
  const groups: RealGroup[] = [];
  if (strict) expect(executions).toHaveLength(exercise.tests.length);
  for (const [index, execution] of executions.entries()) {
    const { request, result } = execution;
    const analysis = analyses.findLast(
      (candidate) =>
        candidate.request.sourceText === request.source.text &&
        candidate.request.refs.programRef.id === request.programRef?.id &&
        candidate.request.refs.packageRef.id === request.packageRef.id,
    );
    const ranges = analysis?.result.checkedAst.nodes.map((node) => node.byteRange) ?? [];
    const mappedRangesInRealAst = request.source.blockMap.filter((entry) =>
      ranges.some((range) => sameRange(range, entry.byteRange)),
    ).length;
    const group = {
      exerciseId: exercise.id,
      caseKey: request.identity.testCaseKey ?? '',
      worker: execution.worker,
      terminal: result.terminal.status,
      judge: result.judgeResult?.status,
      fuel: result.stats?.fuelUsed ?? null,
      steps: result.trace?.steps.length ?? null,
      blockMapCount: request.source.blockMap.length,
      checkedAstNodes: ranges.length,
      mappedRangesInRealAst,
      sourceRevision: request.identity.sourceRevision,
      remainingMs: request.remainingMs,
      protocolVersion: request.protocolVersion,
      requestSha256: execution.requestSha256,
      resultSha256: execution.resultSha256,
      catalogSha256: execution.catalogSha256,
    };
    groups.push(group);
    if (!strict) continue;
    const expected = exercise.tests[index];
    expect(request.packageRef).toEqual({ id: 'content.c.p05', version: '1.0.0' });
    expect(request.subjectRef).toEqual({ id: exercise.id, version: exercise.version });
    expect(request.mode).toBe('exercise-test');
    expect(request.identity.testCaseKey).toBe(expected.caseKey);
    expect(request.input.values).toEqual(expected.input);
    expect(request.remainingMs).toBeGreaterThan(0);
    expect(request.remainingMs).toBeLessThanOrEqual(1000);
    expect(result.producer).toBe('rust');
    expect(result.identity).toEqual(request.identity);
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
    expect(result.judgeResult?.status).toBe('met');
    expect(result.stats!.fuelUsed).toBeLessThanOrEqual(1_000_000);
    expect(result.trace!.steps.length).toBeLessThanOrEqual(20_000);
    const stdout = result
      .trace!.steps.flatMap((step) =>
        step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
      )
      .join('');
    expect(stdout).toBe(expected.expectedStdout);
    expect(
      analysis,
      'Every execution source must have a captured real Rust analysis of those same bytes.',
    ).toBeTruthy();
    expect(request.source.blockMap.length).toBeGreaterThan(0);
    expect(request.source.blockMap.some((entry) => entry.blockId.startsWith('block.code.'))).toBe(
      true,
    );
    expect(mappedRangesInRealAst).toBe(request.source.blockMap.length);
    if (exercise.id === 'exercise.c.bubble-sort' && expected.caseKey === 'maximum')
      expect(request.source.blockMap.length).toBeGreaterThan(2);
  }
  return groups;
}

test('P05 review candidate: normal code editing and real AST maps temporarily pass all 32 exercises and 140 groups without granting any learning record', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  expect(info.retry).toBe(0);
  expect(p05CourseRelease.enabled).toBe(true);
  expect(p05CourseRelease.registered).toBe(false);
  const label = process.env.TASK_EVIDENCE_LABEL ?? `temporary-${Date.now()}`;
  expect(label).toMatch(/^[A-Za-z0-9_.-]+$/);
  const folder = join('.artifacts/P0.5-09/browser', label, info.project.name, 'temporary-32');
  await mkdir(join('.artifacts/P0.5-09/browser', label, info.project.name), { recursive: true });
  await mkdir(folder, { recursive: false });
  await observeCaseSetExecution(page);
  await page.goto('/#/courses');
  await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.course-grid > .chapter-card')).toHaveCount(8);
  await expect(page.locator('[data-course-lesson]')).toHaveCount(32);
  await expect(page.getByTestId('learning-save-status')).not.toHaveAttribute(
    'data-save-status',
    'loading',
  );
  const initial = await snapshot(page);
  noLearning(initial.data);
  expect(initial.version).toBe(2);
  expect(initial.names).toHaveLength(11);
  const groups: RealGroup[] = [];
  const subjects: {
    exerciseId: string;
    empty: string;
    phase: string | null;
    saveState: string | null;
    documentRevision: string | null;
    groups: RealGroup[];
  }[] = [];
  for (const [index, exercise] of source.exercises.entries()) {
    const prefix = `exercise-${String(index + 1).padStart(2, '0')}`;
    const offset = await workerOffset(page);
    try {
      const empty = await openAnswer(page, exercise.id);
      const answer = preparedReference(exercise);
      await code(page).fill(answer);
      await expect(code(page)).toHaveValue(answer);
      await expect(editor(page)).toHaveAttribute('data-sync', 'synced');
      await panel(page).getByRole('button', { name: '准备代码', exact: true }).click();
      await expect(panel(page)).toHaveAttribute('data-state', 'ready');
      await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
      await expect(panel(page)).toHaveAttribute('data-state', 'passed');
      await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
        'data-save-state',
        /^(unavailable|unsaved)$/,
      );
      const current = await snapshot(page);
      noLearning(current.data);
      const captures = await rawCaptures(page, offset);
      const runs = await inspectCaptures(captures, exercise, folder, prefix, true);
      groups.push(...runs);
      const subject = {
        exerciseId: exercise.id,
        empty,
        phase: await panel(page).getAttribute('data-state'),
        saveState: await page.getByTestId('practice-pass-save').getAttribute('data-save-state'),
        documentRevision: await editor(page).getAttribute('data-document-revision'),
        groups: runs,
      };
      subjects.push(subject);
      await writeFile(
        join(folder, `${prefix}-summary.json`),
        JSON.stringify({ ...subject, archive: current }, null, 2) + '\n',
        { flag: 'wx' },
      );
    } catch (error) {
      const captures = await rawCaptures(page, offset);
      // If a strict proof assertion failed after raw files were written, keep the
      // second diagnostic collection under a fresh prefix instead of overwriting it.
      const partial = await inspectCaptures(captures, exercise, folder, `${prefix}-failed`, false);
      await writeFile(
        join(folder, `${prefix}-failure.json`),
        JSON.stringify(
          {
            exerciseId: exercise.id,
            message: error instanceof Error ? error.message : String(error),
            completedSubjects: subjects,
            completedGroups: groups,
            currentGroups: partial,
            archive: await snapshot(page),
            ui: await panel(page).innerText(),
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
      throw error;
    }
  }
  expect(subjects).toHaveLength(32);
  expect(groups).toHaveLength(140);
  const final = await snapshot(page);
  noLearning(final.data);
  expect(final.data.meta.generation).toBe(initial.data.meta.generation);
  await writeFile(
    join(folder, 'temporary-course-evidence.json'),
    JSON.stringify(
      {
        evidenceKind: 'preregistration-real-browser-execution-no-learning-authority',
        browserVersion: page.context().browser()?.version(),
        initial,
        final,
        subjects,
        groups,
        maxFuel: Math.max(...groups.map((group) => group.fuel ?? 0)),
        maximumBubble: groups.find(
          (group) => group.exerciseId === 'exercise.c.bubble-sort' && group.caseKey === 'maximum',
        ),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
});
