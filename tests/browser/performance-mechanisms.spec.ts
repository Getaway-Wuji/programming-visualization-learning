import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type {
  ExecuteRequest,
  ExecuteResult,
  TraceObject,
  TraceState,
} from '../../web/src/engine/protocol';
import {
  projectTraceStep,
  validateTraceRelationships,
} from '../../web/src/engine/trace-validation';
import type { ExecutionVariant } from './harness/execution';
import { observeExceptionMetadata } from './performance-exception-observer';

const label = process.env.TASK_EVIDENCE_LABEL ?? `mechanisms-${randomUUID()}`;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(label))
  throw new Error('TASK_EVIDENCE_LABEL must be a single safe directory label.');

const thirty = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30,
];
const samples: {
  variant: ExecutionVariant;
  before: number[];
  index: number;
  previous: number;
}[] = [
  { variant: 'array-first-30', before: thirty, index: 0, previous: 1 },
  { variant: 'array-tail-30', before: thirty, index: 29, previous: 30 },
  { variant: 'array-single', before: [7], index: 0, previous: 7 },
];
const scope =
  'PF-01 engine mechanism evidence from finite authored /checks fixtures. Real Rust prepare-case and execute Workers, complete accepted trace and full forward/inverse recovery. This is not product custom-code support, a production UI run click, a cold-Module sample, or a 500ms click-to-paint measurement. No learning facts are issued.';

function cells(object: TraceObject): (number | null)[] {
  return Array.from({ length: object.length }, (_, index) => {
    return object.cells.find((cell) => cell.index === index)?.value ?? object.defaultValue;
  });
}

function array(state: TraceState): TraceObject {
  const found = state.objects.filter((object) => object.name === 'values');
  expect(found).toHaveLength(1);
  expect(found[0].kind).toBe('int-array');
  return found[0];
}

function verify(result: ExecuteResult, request: ExecuteRequest, sample: (typeof samples)[number]) {
  expect(result.producer).toBe('rust');
  expect(result.identity).toEqual(request.identity);
  expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
  expect(result.judgeResult).toBeNull();
  expect(result.stats?.fuelUsed).toBeGreaterThan(0);
  expect(request).toMatchObject({
    mode: 'case',
    judge: null,
    remainingMs: 1000,
    input: { values: { x: 3 }, random: null },
    budgetRef: { id: 'budget.p0', version: '1.0.0' },
  });
  expect(request.source.bindingMap.map((mapping) => mapping.bindingKey)).toEqual(['param.x']);
  expect(result.resolvedBindings.map((binding) => binding.bindingKey)).toEqual(['param.x']);

  // This checks every supplied state, cell, observation, checkpoint, terminal
  // and the complete inverse. It consumes Rust deltas and never evaluates C.
  const validation = validateTraceRelationships(result, request);
  let relationshipYields = 0;
  while (!validation.next().done) relationshipYields++;

  const trace = result.trace;
  expect(trace).not.toBeNull();
  if (!trace) throw new Error('A complete real Rust trace is required.');
  expect(trace.completeness).toBe('complete');
  expect(trace.steps.length).toBeGreaterThan(0);
  expect(trace.initialState).toMatchObject({
    frames: [],
    scopes: [],
    objects: [],
    control: { phase: 'ready' },
    allocator: { liveBytes: 0 },
    output: '',
    counters: { arrayWrites: 0, scalarWrites: 0, swaps: 0, comparisons: 0 },
  });

  const states = [trace.initialState];
  for (const step of trace.steps) states.push(projectTraceStep(states.at(-1)!, step));
  for (const checkpoint of trace.checkpoints)
    expect(states[checkpoint.cursor]).toEqual(checkpoint.state);

  const arrayWrites = trace.steps.flatMap((step, at) => {
    return step.changes.flatMap((change) => {
      if (change.op !== 'cell' || step.kind !== 'value.write') return [];
      const object = states[at].objects.find((object) => object.id === change.objectId);
      return object?.kind === 'int-array' ? [{ step, at, change, object }] : [];
    });
  });
  expect(arrayWrites).toHaveLength(1);
  const write = arrayWrites[0];
  expect(write.object.name).toBe('values');
  expect(write.object.length).toBe(sample.before.length);
  expect(write.change).toEqual({
    op: 'cell',
    objectId: write.object.id,
    index: sample.index,
    before: sample.previous,
    after: 103,
  });
  const before = states[write.at];
  const after = states[write.at + 1];
  expect(cells(array(before))).toEqual(sample.before);
  const expectedAfter = sample.before.slice();
  expectedAfter[sample.index] = 103;
  expect(cells(array(after))).toEqual(expectedAfter);
  expect(after.counters.arrayWrites).toBe(before.counters.arrayWrites + 1);

  const sourceBytes = new TextEncoder().encode(request.source.text);
  const source = (range: { start: number; end: number }) =>
    new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes.subarray(range.start, range.end));
  const writeText = `values[${sample.index}] = x + 100`;
  expect(request.source.text).toContain(`${writeText};`);
  const location = write.step.location;
  expect(location.kind).toBe('source');
  if (location.kind !== 'source') throw new Error('A source-mapped write is required.');
  const writeNode = result.nodeMap.find((node) => node.nodeId === location.nodeId);
  expect(writeNode?.kind).toBe('assignment');
  if (!writeNode) throw new Error('The write must resolve to an actual Rust node.');
  // Rust statement-node ranges include the terminating semicolon.
  expect(source(writeNode.byteRange)).toBe(`${writeText};`);
  if (location.byteRange) expect(source(location.byteRange)).toBe(`${writeText};`);
  const binding = result.resolvedBindings[0];
  const declaration = result.nodeMap.find((node) => node.nodeId === binding.declarationNodeId);
  expect(declaration?.kind).toBe('declaration');
  if (!declaration) throw new Error('The original x binding must resolve.');
  expect(source(declaration.byteRange)).toMatch(/^int x = 3;?$/);

  const beforeReturn = states.at(-2)!;
  const terminal = states.at(-1)!;
  expect(trace.steps.at(-1)?.kind).toBe('program.return');
  expect(cells(array(beforeReturn))).toEqual(expectedAfter);
  const x = beforeReturn.objects.find((object) => object.name === 'x');
  expect(x?.id).toBeDefined();
  expect(x?.declarationNodeId).toBe(binding.declarationNodeId);
  expect(cells(x!)).toEqual([5]);
  expect(terminal).toMatchObject({
    frames: [],
    scopes: [],
    objects: [],
    control: { phase: 'returned', returnValue: 0, nextNodeId: null, activeFrameId: null },
    allocator: { liveBytes: 0 },
    output: '5\n',
    counters: { arrayWrites: sample.before.length + 1, scalarWrites: 2 },
  });
  expect(result.terminal.cursor).toBe(trace.steps.length);
  expect(result.stats?.peakVirtualBytes).toBe(4 + 4 * sample.before.length);

  // Keep each inverse state as evidence and compare every cursor with its
  // forward state, including complete object/scope/frame/output restoration.
  const reversed = [{ cursor: trace.steps.length, state: terminal }];
  let restored = terminal;
  for (let at = trace.steps.length - 1; at >= 0; at--) {
    restored = projectTraceStep(restored, trace.steps[at], true);
    expect(restored).toEqual(states[at]);
    reversed.push({ cursor: at, state: restored });
  }
  expect(restored).toEqual(trace.initialState);
  return {
    relationshipYields,
    allSteps: trace.steps.length,
    allCheckpoints: trace.checkpoints.length,
    target: {
      seq: write.step.seq,
      location: write.step.location,
      byteRange: writeNode.byteRange,
      source: source(writeNode.byteRange),
      change: write.change,
      beforeCursor: write.at,
      afterCursor: write.at + 1,
      beforeValues: cells(array(before)),
      afterValues: cells(array(after)),
    },
    forward: states.map((state, cursor) => ({ cursor, state })),
    inverse: reversed,
    completeForwardAndInverse: true,
  };
}

for (const sample of samples) {
  test(`PF-01 mechanism ${sample.variant} has a complete real Rust trace`, async ({
    page,
  }, info) => {
    const parent = join('.artifacts', '11.4', label, info.project.name, 'mechanisms');
    const directory = join(parent, sample.variant);
    await mkdir(parent, { recursive: true });
    // Refuse an existing sample directory before performing any execution.
    await mkdir(directory);
    const save = async (name: string, value: unknown) => {
      const path = join(directory, `${name}.json`);
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
      await info.attach(`${sample.variant}-${name}`, { path, contentType: 'application/json' });
    };
    await observeExceptionMetadata(page);
    try {
      await page.goto('/checks/');
      await expect
        .poll(() => page.evaluate(() => typeof window.executionChecks?.get))
        .toBe('function');
      const opened = await page.evaluate(
        (variant) => window.executionChecks.open('case.c.assignment', variant),
        sample.variant,
      );
      const actual = await page.evaluate(async () => {
        const triggeredAt = performance.now();
        const result = await window.executionChecks.run();
        const settledAt = performance.now();
        return {
          triggeredAt,
          settledAt,
          summary: result,
          run: window.executionChecks.get(),
          inspect: window.executionChecks.inspect(),
          lifecycle: window.__performanceExceptionAudit,
          userAgent: navigator.userAgent,
        };
      });
      await save('actual', {
        evidenceKind: '11.4-PF-01-authored-engine-mechanism',
        scope,
        sample,
        browserVersion: page.context().browser()?.version(),
        opened,
        ...actual,
      });
      expect(actual.run.request.source.text).toBe(opened.source);
      expect(actual.run.catalog.program.sourceExample).toContain('values[');
      expect(actual.inspect).toMatchObject({
        state: 'accepted',
        activeWorkers: 0,
        commitCount: 1,
        committed: { producer: 'rust', status: 'completed', output: '5\n' },
      });
      expect(actual.lifecycle.workers.map((worker) => worker.kind)).toEqual([
        'prepare-case',
        'execute',
      ]);
      expect(actual.lifecycle.maximumActive).toBe(1);
      expect(actual.lifecycle.moduleCount).toBe(1);
      for (const worker of actual.lifecycle.workers) {
        expect(worker.moduleId).toBe(1);
        expect(worker.responseBytes).toBeGreaterThan(0);
        expect(worker.terminatedAt).not.toBeNull();
        expect(worker.messagesAfterTermination).toBe(0);
      }
      await save('verification', {
        scope,
        ...verify(actual.run.result, actual.run.request, sample),
      });
    } catch (error) {
      await save('failure', {
        scope,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await page.evaluate(() => window.executionChecks?.close()).catch(() => {});
    }
  });
}
