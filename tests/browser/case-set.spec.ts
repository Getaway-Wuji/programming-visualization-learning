import { editorValue, expectEditorValue } from './editor-value';
import { expectedSourceLine } from './source-highlight';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { InputValues } from '../../web/src/content/types';
import type {
  ByteRange,
  ExecuteRequest,
  ExecuteResult,
  ExecutionLocation,
  TraceObject,
  TraceState,
  TraceStep,
} from '../../web/src/engine/protocol';
import { caseSetIds, caseSetSamples, type CaseSetSample } from '../fixtures/case-set';
import type { ObservedWorker } from './vertical-observation';
import {
  observeCaseSetExecution,
  observedCaseSetExecute as observedExecute,
} from './case-set-observation';

const captureRoot = fileURLToPath(
  new URL(
    `../../.artifacts/${process.env.TASK_EVIDENCE_TASK ? `${process.env.TASK_EVIDENCE_TASK}/regression/case-set/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}` : '08.4'}/browser-captures/`,
    import.meta.url,
  ),
);
const panel = (page: Page) => page.getByTestId('case-execution');
const controls = (page: Page) => page.getByTestId('player-controls');
const button = (page: Page, name: string) =>
  controls(page).getByRole('button', { name, exact: true });
const source = (page: Page) =>
  panel(page).getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

interface CellView {
  index: string;
  value: string;
  read: string;
  write: string;
}
interface VisibleSnapshot {
  cursor: number;
  viewCursor: number;
  status: string;
  kind: string;
  output: string;
  events: string;
  scalars: {
    id: string;
    name: string;
    scope: string;
    value: string;
    read: string;
    write: string;
  }[];
  arrays: { id: string; name: string; length: string; storageLength: string; cells: CellView[] }[];
  counters: Record<string, string>;
  marks: { start: number; end: number; utf16Start: number; utf16End: number }[];
  terminalMarkCount: number;
}
declare global {
  interface Window {
    __caseSetAudit: {
      read: () => VisibleSnapshot;
      observer: MutationObserver | null;
      frames: VisibleSnapshot[];
    };
  }
}

/** Observe only rendered DOM. This does not call the player, replace a result,
 * execute C, or use the production presentation/source projection helpers. */
async function observeViews(page: Page) {
  await page.addInitScript(() => {
    const read = (): VisibleSnapshot => {
      const root = document.querySelector('[data-testid="trace-view"]')!;
      const attr = (element: Element, key: string) => element.getAttribute(`data-${key}`) ?? '';
      const counters = root.querySelector('[data-testid="step-counters"]')!;
      return {
        cursor: Number(
          document.querySelector('[data-testid="player-controls"]')?.getAttribute('data-cursor'),
        ),
        viewCursor: Number(root.getAttribute('data-cursor')),
        status:
          document
            .querySelector('[data-testid="player-controls"]')
            ?.getAttribute('data-player-status') ?? '',
        kind:
          root.querySelector('[data-testid="step-summary"]')?.getAttribute('data-step-kind') ?? '',
        output:
          root.querySelector('[data-testid="step-output"]')?.getAttribute('data-output') ?? '',
        events: root.querySelector('[data-testid="step-events"]')?.textContent ?? '',
        scalars: Array.from(root.querySelectorAll('[data-testid="trace-variable"]'), (item) => ({
          id: attr(item, 'object-id'),
          name: attr(item, 'name'),
          scope: attr(item, 'scope-id'),
          value: attr(item, 'value'),
          read: attr(item, 'read'),
          write: attr(item, 'write'),
        })),
        arrays: Array.from(root.querySelectorAll('[data-testid="trace-array"]'), (item) => ({
          id: attr(item, 'object-id'),
          name: attr(item, 'name'),
          length: attr(item, 'logical-length'),
          storageLength: attr(item, 'storage-length'),
          cells: Array.from(item.querySelectorAll('[data-testid="trace-array-cell"]'), (cell) => ({
            index: attr(cell, 'index'),
            value: attr(cell, 'value'),
            read: attr(cell, 'read'),
            write: attr(cell, 'write'),
          })),
        })),
        counters: {
          comparisons: attr(counters, 'comparisons'),
          scalarWrites: attr(counters, 'scalar-writes'),
          arrayWrites: attr(counters, 'array-writes'),
          swaps: attr(counters, 'swaps'),
        },
        marks: Array.from(
          document.querySelectorAll('[data-testid="source-step-highlight"]'),
          (mark) => ({
            start: Number(mark.getAttribute('data-byte-start')),
            end: Number(mark.getAttribute('data-byte-end')),
            utf16Start: Number(mark.getAttribute('data-start')),
            utf16End: Number(mark.getAttribute('data-end')),
          }),
        ),
        terminalMarkCount: document.querySelectorAll('[data-testid="source-terminal-highlight"]')
          .length,
      };
    };
    window.__caseSetAudit = { read, observer: null, frames: [] };
  });
}

interface Run {
  worker: ObservedWorker;
  request: ExecuteRequest;
  result: ExecuteResult;
  states: TraceState[];
  finalOutput: string;
  initialView: VisibleSnapshot;
}

/** Independent test oracle: apply the records supplied by Rust, never the C. */
function statesFromChanges(result: ExecuteResult): TraceState[] {
  const state = structuredClone(result.trace!.initialState);
  const states = [structuredClone(state)];
  for (const step of result.trace!.steps) {
    for (const change of step.changes) {
      switch (change.op) {
        case 'record': {
          const table = state[change.table];
          if (change.before !== null) table.splice(change.index, 1);
          if (change.after !== null)
            (table as (typeof change.after)[]).splice(
              change.index,
              0,
              structuredClone(change.after),
            );
          break;
        }
        case 'cell': {
          const object = state.objects.find((object) => object.id === change.objectId)!;
          object.cells = object.cells.filter((cell) => cell.index !== change.index);
          if (change.after !== object.defaultValue && change.after !== null)
            object.cells.push({ index: change.index, value: change.after });
          object.cells.sort((left, right) => left.index - right.index);
          break;
        }
        case 'output':
          state.output += change.append;
          break;
        case 'control':
          state.control = structuredClone(change.after);
          break;
        case 'allocator':
          state.allocator = structuredClone(change.after);
          break;
        case 'counters':
          state.counters = structuredClone(change.after);
          break;
      }
    }
    states.push(structuredClone(state));
  }
  return states;
}

function rangeFor(run: Run, location: ExecutionLocation): ByteRange | null {
  let range: ByteRange | undefined;
  let edge: 'start' | 'whole' | 'end';
  if (location.kind === 'synthetic') {
    if (location.reason !== 'implicit-return' || !location.anchorNodeId) return null;
    range = run.result.nodeMap.find((node) => node.nodeId === location.anchorNodeId)?.byteRange;
    edge = 'end';
  } else {
    range =
      location.byteRange ??
      run.result.nodeMap.find((node) => node.nodeId === location.nodeId)?.byteRange;
    edge = location.byteRange ? 'whole' : (location.edge ?? 'whole');
  }
  if (!range || edge === 'whole' || range.start === range.end) return range ?? null;
  const characters = Array.from(
    Buffer.from(run.request.source.text).subarray(range.start, range.end).toString('utf8'),
  );
  const size = Buffer.byteLength(edge === 'start' ? characters[0] : characters.at(-1)!);
  return edge === 'start'
    ? { start: range.start, end: range.start + size }
    : { start: range.end - size, end: range.end };
}

function cellsFor(object: TraceObject, count: number, step?: TraceStep): CellView[] {
  return Array.from({ length: count }, (_, index) => ({
    index: String(index),
    value: String(
      object.cells.find((cell) => cell.index === index)?.value ??
        object.defaultValue ??
        'uninitialized',
    ),
    read: String(
      step?.observations.some(
        (event) => event.kind === 'read' && event.objectId === object.id && event.index === index,
      ) ?? false,
    ),
    write: String(
      step?.changes.some(
        (change) =>
          (change.op === 'cell' && change.objectId === object.id && change.index === index) ||
          (change.op === 'record' &&
            change.table === 'objects' &&
            change.id === object.id &&
            step.kind === 'value.initialize' &&
            change.after !== null),
      ) ?? false,
    ),
  }));
}

function assertFrame(run: Run, frame: VisibleSnapshot, cursor: number) {
  const state = run.states[cursor];
  const step = run.result.trace!.steps[cursor - 1];
  expect(frame.cursor).toBe(cursor);
  expect(frame.viewCursor).toBe(cursor);
  expect(frame.kind).toBe(step?.kind ?? '');
  expect(frame.output).toBe(state.output);
  expect(frame.scalars).toEqual(
    state.objects
      .filter((object) => object.kind === 'int')
      .map((object) => {
        const { value, read, write } = cellsFor(object, 1, step)[0];
        return { id: object.id, name: object.name, scope: object.scopeId, value, read, write };
      }),
  );
  const declaration = run.result.resolvedBindings.find(
    (binding) => binding.bindingKey === 'param.values',
  )?.declarationNodeId;
  expect(frame.arrays).toEqual(
    state.objects
      .filter((object) => object.kind === 'int-array')
      .map((object) => {
        const length =
          object.declarationNodeId === declaration
            ? (run.request.input.values.values as readonly number[]).length
            : object.length;
        return {
          id: object.id,
          name: object.name,
          length: String(length),
          storageLength: String(object.length),
          cells: cellsFor(object, length, step),
        };
      }),
  );
  expect(frame.counters).toEqual(
    Object.fromEntries(Object.entries(state.counters).map(([key, value]) => [key, String(value)])),
  );
  const expectedRange = expectedSourceLine(
    run.request.source.text,
    step ? rangeFor(run, step.location) : null,
  );
  if (!expectedRange) expect(frame.marks).toEqual([]);
  else {
    expect(frame.marks.length).toBeGreaterThan(0);
    expect({
      start: Math.min(...frame.marks.map((mark) => mark.start)),
      end: Math.max(...frame.marks.map((mark) => mark.end)),
    }).toEqual(expectedRange);
    const bytes = Buffer.from(run.request.source.text);
    expect(Math.min(...frame.marks.map((mark) => mark.utf16Start))).toBe(
      bytes.subarray(0, expectedRange.start).toString('utf8').length,
    );
    expect(Math.max(...frame.marks.map((mark) => mark.utf16End))).toBe(
      bytes.subarray(0, expectedRange.end).toString('utf8').length,
    );
  }
  expect(frame.terminalMarkCount).toBe(0);
  for (const event of step?.observations ?? [])
    if (event.kind === 'evaluate' && ['<', '<=', '>', '>=', '==', '!='].includes(event.operator))
      expect(frame.events).toContain(
        `比较 ${event.operands.join(` ${event.operator} `)} → ${event.value}`,
      );
}

const readFrame = (page: Page) => page.evaluate(() => window.__caseSetAudit.read());
async function openCase(page: Page, caseId: string) {
  await page.goto(`/#/visualize/${caseId}`);
  await expect(page.getByTestId('input-panel')).toBeVisible();
  await expect(page.locator(`[data-learning-subject="${caseId}"]`)).toContainText(
    '尚无已保存的学习记录',
  );
  await expect
    .poll(async () => {
      const settings = (await storageSnapshot(page)).stores.settings[0] as {
        goalTemplate?: unknown;
      };
      return Boolean(settings?.goalTemplate);
    })
    .toBe(true);
}

async function prepareRun(page: Page, sample: CaseSetSample): Promise<Run> {
  for (const [key, value] of Object.entries(sample.values))
    await page
      .getByTestId(`input-field-${key}`)
      .fill(Array.isArray(value) ? (value.length ? value.join(', ') : '[]') : String(value));
  await panel(page).getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(source(page)).toHaveAttribute('readonly', '');
  await panel(page).getByRole('button', { name: '运行示例', exact: true }).click();
  try {
    await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  } catch (error) {
    // Preserve a real failed run for timing diagnosis; never retry or grant more time.
    const failed = (await observedExecute(page).catch(() => null)) as
      (ObservedWorker & { timing?: unknown }) | null;
    const target = join(captureRoot, '..', 'receive-diagnostics', `${sample.key}-${Date.now()}`);
    await mkdir(target, { recursive: true });
    if (failed?.requestBytes && failed.responseBytes) {
      await writeFile(join(target, 'request.json'), Buffer.from(failed.requestBytes));
      await writeFile(join(target, 'result.json'), Buffer.from(failed.responseBytes));
      const actual = JSON.parse(
        Buffer.from(failed.responseBytes).toString('utf8'),
      ) as ExecuteResult;
      await writeFile(
        join(target, 'diagnostic.json'),
        JSON.stringify(
          {
            key: sample.key,
            timing: failed.timing,
            rustStats: actual.stats,
            rustTerminal: actual.terminal,
            resultBytes: failed.responseBytes.length,
            displayedState: await panel(page).getAttribute('data-state'),
            displayedDiagnostics: await panel(page).innerText(),
          },
          null,
          2,
        ),
      );
    }
    throw error;
  }
  await expect(controls(page)).toHaveAttribute('data-player-status', 'ready');
  await expect(page.getByTestId('execution-output')).toHaveText(sample.stdout);
  const worker = await observedExecute(page);
  expect(worker).toMatchObject({
    kind: 'execute',
    moduleSeen: true,
    responseOk: true,
    terminated: true,
  });
  expect(worker.operationId).toBe(worker.responseOperationId);
  expect(new URL(worker.url).origin).toBe(new URL(page.url()).origin);
  const request = JSON.parse(Buffer.from(worker.requestBytes!).toString('utf8')) as ExecuteRequest;
  const result = JSON.parse(Buffer.from(worker.responseBytes!).toString('utf8')) as ExecuteResult;
  const catalog = JSON.parse(worker.catalogJson!) as {
    subject: { id: string };
    program: { id: string };
  };
  expect(request.mode).toBe('case');
  expect(catalog.subject.id).toBe(sample.caseId);
  expect(request.programRef?.id).toBe(catalog.program.id);
  expect(request.subjectRef?.id).toBe(sample.caseId);
  expect(request.input.values).toEqual(sample.values);
  expect(request.input.random).toBeNull();
  expect(request.source.text).toBe(await editorValue(source(page)));
  expect(result.identity).toEqual(request.identity);
  expect(result.producer).toBe('rust');
  expect(result.judgeResult).toBeNull();
  expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
  expect(result.trace?.completeness).toBe('complete');
  expect(result.terminal.cursor).toBe(result.trace!.steps.length);
  await expect(controls(page)).toHaveAttribute('data-length', String(result.trace!.steps.length));
  const finalOutput =
    result.trace!.initialState.output +
    result
      .trace!.steps.flatMap((step) =>
        step.changes.filter((change) => change.op === 'output').map((change) => change.append),
      )
      .join('');
  expect(finalOutput).toBe(sample.stdout);
  // Maximum-size matrix entries validate the real result and initial display;
  // only the designated representatives materialize each reversible state.
  const states = sample.walk
    ? statesFromChanges(result)
    : [structuredClone(result.trace!.initialState)];
  await controls(page).getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
  const initialView = await readFrame(page);
  const run = { worker, request, result, states, finalOutput, initialView };
  assertFrame(run, initialView, 0);
  return run;
}

/** Exact DB8 records and keys from all sixteen stores, plus browser key/value stores. */
async function storageSnapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const names = Array.from(db.objectStoreNames).sort();
      const tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const stores = Object.fromEntries(
        await Promise.all(
          names.map(async (name) => {
            const records = await new Promise<unknown[]>((resolve, reject) => {
              const request = tx.objectStore(name).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return [name, records];
          }),
        ),
      );
      const storeKeys = Object.fromEntries(
        await Promise.all(
          names.map(async (name) => {
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
              const request = tx.objectStore(name).getAllKeys();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return [name, keys];
          }),
        ),
      );
      await done;
      return {
        database: { name: db.name, version: db.version, storeNames: names },
        stores,
        storeKeys,
        local: Object.entries(localStorage).sort(),
        session: Object.entries(sessionStorage).sort(),
      };
    } finally {
      db.close();
    }
  });
}

async function walkAndRecover(page: Page, run: Run, sample: CaseSetSample, testInfo: TestInfo) {
  const length = run.result.trace!.steps.length;
  const forwardCursors = [0];
  const reverseCursors = [length];
  let finalArrayObserved: number[] | null = null;
  await expect(button(page, '后退')).toBeDisabled();
  await page.getByTestId('player-workspace').focus();
  for (let cursor = 1; cursor <= length; cursor++) {
    await page.keyboard.press('ArrowRight');
    const frame = await readFrame(page);
    assertFrame(run, frame, cursor);
    forwardCursors.push(frame.cursor);
    // The return destroys locals; inspect the final live array immediately before it.
    if (sample.finalArray && cursor === length - 1) {
      const array = frame.arrays.find((array) => array.name === 'values');
      expect(array).toBeDefined();
      finalArrayObserved = array!.cells.map((cell) => Number(cell.value));
      expect(finalArrayObserved).toEqual(sample.finalArray);
    }
    if (cursor === length - 1) {
      const target = join(captureRoot, testInfo.project.name, sample.key);
      await mkdir(target, { recursive: true });
      await page
        .getByTestId('player-workspace')
        .screenshot({ path: join(target, 'screenshot.png') });
    }
  }
  await expect(button(page, '前进')).toBeDisabled();
  for (let cursor = length - 1; cursor >= 0; cursor--) {
    await page.keyboard.press('ArrowLeft');
    const frame = await readFrame(page);
    assertFrame(run, frame, cursor);
    reverseCursors.push(frame.cursor);
  }
  // Status reflects manual pause, while every restored program field is identical.
  expect({ ...(await readFrame(page)), status: run.initialView.status }).toEqual(run.initialView);
  return {
    forwardCursors,
    reverseCursors,
    finalArrayObserved,
    allStatesChecked: true,
    sourceRangesChecked: true,
  };
}

async function playAtAllRates(page: Page, run: Run) {
  // All genuine executions for this case finished first. Never fake execution's deadline clock.
  const time = Date.now();
  await page.clock.install({ time });
  await page.clock.pauseAt(time + 1000);
  const rates = [];
  const length = run.result.trace!.steps.length;
  for (const rate of [0.25, 0.5, 1, 1.5, 2, 4]) {
    await controls(page)
      .getByRole('combobox', { name: '播放速度', exact: true })
      .selectOption(String(rate));
    await button(page, '重播').click();
    const initial = await readFrame(page);
    assertFrame(run, initial, 0);
    expect(initial.status).toBe('playing');
    const periodMs = Math.ceil(500 / rate);
    await button(page, '暂停').click();
    const paused = await readFrame(page);
    assertFrame(run, paused, 0);
    expect(paused.status).toBe('paused');
    await page.clock.runFor(periodMs * 2);
    expect(await readFrame(page)).toEqual(paused);
    await button(page, '播放').click();
    const resumed = await readFrame(page);
    assertFrame(run, resumed, 0);
    expect(resumed.status).toBe('playing');
    await page.evaluate(() => {
      const audit = window.__caseSetAudit;
      audit.observer?.disconnect();
      audit.frames = [audit.read()];
      audit.observer = new MutationObserver(() => {
        const frame = audit.read();
        if (frame.cursor !== audit.frames.at(-1)?.cursor) audit.frames.push(frame);
      });
      audit.observer.observe(document.querySelector('[data-testid="player-workspace"]')!, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
    });
    await page.clock.runFor(periodMs * length + 20);
    const frames = await page.evaluate(() => {
      window.__caseSetAudit.observer?.disconnect();
      return window.__caseSetAudit.frames;
    });
    expect(frames.map((frame) => frame.cursor)).toEqual(
      Array.from({ length: length + 1 }, (_, cursor) => cursor),
    );
    for (const frame of frames) assertFrame(run, frame, frame.cursor);
    const end = await readFrame(page);
    expect(end.status).toBe('ended');
    expect(end.output).toBe(run.finalOutput);
    rates.push({
      rate,
      periodMs,
      pause: {
        cursor: paused.cursor,
        status: paused.status,
        heldMs: periodMs * 2,
        unchanged: true,
      },
      resumed: true,
      cursors: frames.map((frame) => frame.cursor),
      endCursor: end.cursor,
      endStatus: end.status,
      stdout: end.output,
      allStatesChecked: true,
    });
  }
  return rates;
}

async function saveCapture(
  page: Page,
  run: Run,
  sample: CaseSetSample,
  testInfo: TestInfo,
  before: Awaited<ReturnType<typeof storageSnapshot>>,
  walk: Awaited<ReturnType<typeof walkAndRecover>> | null,
  rates: Awaited<ReturnType<typeof playAtAllRates>>,
  captureKey = sample.key,
) {
  const after = await storageSnapshot(page);
  expect(Object.keys(before.stores).sort()).toEqual([
    'achievements',
    'aliases',
    'appearance',
    'appearanceAssets',
    'avatar',
    'courseActivities',
    'courseDrafts',
    'customDrafts',
    'dailyFacts',
    'editHistory',
    'goals',
    'knowledgeMarks',
    'ledger',
    'meta',
    'progress',
    'receipts',
    'reviewCards',
    'settings',
    'weaknesses',
  ]);
  expect(before.database).toEqual({
    name: 'c-viz-learning',
    version: 10,
    storeNames: Object.keys(before.stores).sort(),
  });
  expect(Object.keys(before.storeKeys).sort()).toEqual(before.database.storeNames);
  expect(after).toEqual(before);
  const requestBytes = Buffer.from(run.worker.requestBytes!);
  const resultBytes = Buffer.from(run.worker.responseBytes!);
  const displayedSource = await editorValue(source(page));
  const values = JSON.parse(
    (await page.getByTestId('execution-input').locator('code').first().textContent())!,
  ) as InputValues;
  const steps = Number(
    (await page.getByTestId('execution-steps').textContent())?.match(/有效轨迹：(\d+)\s*步/u)?.[1],
  );
  expect(values).toEqual(sample.values);
  expect(steps).toBe(run.result.trace!.steps.length);
  const ui = {
    captureVersion: '18-block-quality-browser-capture@1',
    evidenceLevel: 'production-ui-real-worker',
    key: sample.key,
    captureKey,
    caseId: sample.caseId,
    project: testInfo.project.name,
    browserVersion: page.context().browser()?.version(),
    route: new URL(page.url()).hash,
    displayedSource,
    readOnly: await source(page).evaluate((element) => (element as HTMLTextAreaElement).readOnly),
    values,
    stdout: await page.getByTestId('execution-output').textContent(),
    terminal: await panel(page).getAttribute('data-state'),
    steps,
    identity: run.request.identity,
    sourceKind: 'public-content-original',
    initialCursor: run.initialView.cursor,
    initialView: run.initialView,
    walk,
    rates,
    replay: walk ? { cycles: rates.length, initialRestored: true, noNewExecution: true } : null,
    storage: {
      databaseName: before.database.name,
      databaseVersion: before.database.version,
      storeNames: Object.keys(before.stores),
      beforeSha256: sha256(JSON.stringify(before)),
      afterSha256: sha256(JSON.stringify(after)),
      unchanged: true,
      scope: 'native-DB9-seventeen-stores-records-and-keys+localStorage+sessionStorage',
    },
    worker: {
      kind: run.worker.kind,
      moduleSeen: run.worker.moduleSeen,
      responseOk: run.worker.responseOk,
      terminated: run.worker.terminated,
      operationId: run.worker.operationId,
      responseOperationId: run.worker.responseOperationId,
      url: run.worker.url,
    },
    requestByteLength: requestBytes.length,
    resultByteLength: resultBytes.length,
    requestSha256: sha256(requestBytes),
    resultSha256: sha256(resultBytes),
    catalogSha256: sha256(run.worker.catalogJson!),
    sourceSha256: sha256(displayedSource),
  };
  const target = join(captureRoot, testInfo.project.name, captureKey);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'request.json'), requestBytes);
  await writeFile(join(target, 'result.json'), resultBytes);
  await writeFile(join(target, 'catalog.json'), run.worker.catalogJson!);
  await writeFile(join(target, 'source.c'), displayedSource);
  await writeFile(join(target, 'storage-before.json'), JSON.stringify(before, null, 2) + '\n');
  await writeFile(join(target, 'storage-after.json'), JSON.stringify(after, null, 2) + '\n');
  await writeFile(join(target, 'ui.json'), JSON.stringify(ui, null, 2) + '\n');
  await testInfo.attach(sample.key, { body: JSON.stringify(ui), contentType: 'application/json' });
}

for (const caseId of caseSetIds) {
  test(`minimal case set uses genuine Rust, exact input and reversible playback: ${caseId}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await observeCaseSetExecution(page);
    await observeViews(page);
    await openCase(page, caseId);
    const before = await storageSnapshot(page);
    const samples = caseSetSamples
      .filter((sample) => sample.caseId === caseId)
      .toSorted((left, right) => {
        const priority = (sample: CaseSetSample) =>
          sample.key.endsWith('-maximum') ? -1 : sample.walk ? 1 : 0;
        return priority(left) - priority(right);
      });
    expect(samples.filter((sample) => sample.walk)).toHaveLength(1);
    let executeCount = 0;
    const identities = new Set<string>();
    for (const sample of samples) {
      if (executeCount > 0) {
        // Keep large raw evidence from earlier samples out of this run's
        // receive deadline. Each input gets an independent real document;
        // replay still uses the representative's one accepted trajectory.
        await page.goto('about:blank');
        await openCase(page, caseId);
        expect(await storageSnapshot(page)).toEqual(before);
      }
      const run = await prepareRun(page, sample);
      executeCount++;
      expect(identities.has(run.request.identity.runId)).toBe(false);
      identities.add(run.request.identity.runId);
      const walk = sample.walk ? await walkAndRecover(page, run, sample, testInfo) : null;
      const rates = sample.walk ? await playAtAllRates(page, run) : [];
      expect(
        await page.evaluate(
          () =>
            window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute')
              .length,
        ),
      ).toBe(1);
      await saveCapture(page, run, sample, testInfo, before, walk, rates);
    }
    expect(await storageSnapshot(page)).toEqual(before);
  });
}

test('binary input refuses unsorted and invalid drafts before preparing, preserves order and recovers', async ({
  page,
}, testInfo) => {
  await observeCaseSetExecution(page);
  await observeViews(page);
  await openCase(page, 'case.c.binary-search-first');
  const before = await storageSnapshot(page);
  const rejected = [];
  for (const draft of [
    { values: '3, 1, 2', target: '1', message: '非递减' },
    { values: '1, 2, 3', target: '1000', message: '999' },
    { values: '1, 2.5, 3', target: '1', message: '十进制整数' },
    { values: Array.from({ length: 31 }, (_, at) => at).join(', '), target: '1', message: '30' },
  ]) {
    await page.getByTestId('input-field-values').fill(draft.values);
    await page.getByTestId('input-field-target').fill(draft.target);
    await expect(page.getByTestId('input-errors')).toContainText(draft.message);
    await expect(
      panel(page).getByRole('button', { name: '应用输入并准备', exact: true }),
    ).toBeDisabled();
    await expect(
      panel(page).getByRole('button', { name: '准备运行样例', exact: true }),
    ).toBeDisabled();
    await expectEditorValue(page.getByTestId('input-field-values'), draft.values);
    expect(
      await page.evaluate(() =>
        window.__verticalObservation.workers.filter((worker) =>
          ['prepare-case', 'execute'].includes(worker.kind),
        ),
      ),
    ).toEqual([]);
    rejected.push({ ...draft, workers: 0 });
  }
  const sample = caseSetSamples.find((sample) => sample.key === 'search-duplicate')!;
  const recovered = await prepareRun(page, sample);
  expect(recovered.request.input.values.values).toEqual([-2, 0, 0, 4, 8]);
  expect(await storageSnapshot(page)).toEqual(before);
  await saveCapture(page, recovered, sample, testInfo, before, null, [], 'binary-input-recovery');
  await testInfo.attach('08.4-binary-input-rejection-and-recovery', {
    body: JSON.stringify({
      rejected,
      recovery: {
        producer: recovered.result.producer,
        values: recovered.request.input.values,
        stdout: recovered.finalOutput,
        identity: recovered.request.identity,
      },
      storageUnchanged: true,
    }),
    contentType: 'application/json',
  });
});

test('all four demonstration and three algorithm catalog links open the correct real input workspace', async ({
  page,
}, testInfo) => {
  await page.goto('/#/cases');
  await page.getByText('基础语法与更多案例', { exact: true }).click();
  await expect(page.locator('.case-card a[href^="#/visualize/case.c."]')).toHaveCount(7);
  const visited = [];
  for (const caseId of caseSetIds) {
    const link = page.locator(`.case-card a[href="#/visualize/${caseId}"]`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`#/visualize/${caseId.replaceAll('.', '\\.')}$`, 'u'));
    await expect(page.getByTestId('input-panel')).toBeVisible();
    await expect(panel(page)).toHaveAttribute('data-state', 'ready');
    await expect(panel(page).getByRole('button', { name: '运行示例', exact: true })).toBeEnabled();
    await expectEditorValue(
      page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }),
      '',
      { not: true },
    );
    visited.push({ caseId, route: new URL(page.url()).hash });
    await page.getByRole('link', { name: '返回案例目录', exact: true }).click();
    await expect(page).toHaveURL(/#\/cases$/u);
    await page.getByText('基础语法与更多案例', { exact: true }).click();
  }
  await testInfo.attach('08.4-seven-catalog-links', {
    body: JSON.stringify(visited),
    contentType: 'application/json',
  });
});
