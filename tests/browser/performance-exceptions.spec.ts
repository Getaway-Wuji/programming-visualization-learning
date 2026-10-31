import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type {} from './harness/execution';
import { observeExceptionMetadata } from './performance-exception-observer';
import { waitForPhase2Archive } from './phase2-ready';

const wasmPattern = /\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/;

async function checks(page: Page) {
  await page.goto('/checks/');
  await expect
    .poll(() => page.evaluate(() => typeof window.executionChecks?.open))
    .toBe('function');
}

async function evidence(page: Page, info: TestInfo, label: string, value: unknown) {
  const directory = join(
    '.artifacts',
    '11.4',
    process.env.TASK_EVIDENCE_LABEL ?? 'exceptions',
    info.project.name,
    label,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'metadata.json');
  await writeFile(
    path,
    JSON.stringify(
      {
        evidenceKind: '11.4-native-engine-lifecycle-metadata',
        browserVersion: page.context().browser()?.version(),
        userAgent: await page.evaluate(() => navigator.userAgent),
        scope:
          'Public developer /checks examples and native engine lifecycle. API cancellation is not evidence of a production UI cancel click. No learning capability is available in this harness.',
        ...((value ?? {}) as Record<string, unknown>),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  await info.attach(label, { path, contentType: 'application/json' });
}

test('a genuine dead loop naturally reaches a bounded resource terminal and a normal new run recovers', async ({
  page,
}, info) => {
  await observeExceptionMetadata(page);
  await checks(page);
  await page.evaluate(() => window.executionChecks.open('case.c.assignment', 'resource'));
  const failed = await page.evaluate(async () => {
    const triggeredAt = performance.now();
    const result = await window.executionChecks.run();
    return {
      triggeredAt,
      settledAt: performance.now(),
      producer: result.producer,
      status: result.status,
      codes: result.codes,
      completeness: result.completeness,
      steps: result.steps,
      judge: result.judge,
      outputLength: result.output?.length ?? null,
      inspect: window.executionChecks.inspect(),
    };
  });
  await evidence(page, info, 'natural-resource-terminal', {
    fault:
      'Existing public developer resource variant while (1) { ; }; no cancel, timer change, fake buffer or source endpoint is added.',
    failed,
    workers: await page.evaluate(() => window.__performanceExceptionAudit.workers),
  });
  expect(failed).toMatchObject({
    status: 'resource-limit',
    judge: null,
    inspect: { activeWorkers: 0, cachedModules: 1 },
  });
  // DEC 06.4/07.1 require discarding a prefix when the inherited deadline
  // expires before complete validation. This is a PF-05 failure sample, not
  // a legitimate normal workload or evidence of 500ms/Rust-prefix acceptance.
  if (failed.producer === 'rust') {
    expect(failed).toMatchObject({
      completeness: 'prefix',
      outputLength: 0,
      inspect: { state: 'accepted', commitCount: 1 },
    });
    expect(
      failed.codes.some((code) =>
        ['E_FUEL_LIMIT', 'E_STEP_LIMIT', 'E_RESULT_LIMIT'].includes(code),
      ),
    ).toBe(true);
  } else {
    expect(failed).toMatchObject({
      producer: 'adapter',
      codes: ['E_DEADLINE'],
      completeness: null,
      steps: null,
      outputLength: null,
      inspect: { state: 'expired', commitCount: 0, committed: null },
    });
  }
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.executionChecks.inspect().commitCount)).toBe(
    failed.inspect.commitCount,
  );
  expect(
    await page.evaluate(() =>
      window.__performanceExceptionAudit.workers.every(
        (worker) => worker.terminatedAt !== null && worker.messagesAfterTermination === 0,
      ),
    ),
  ).toBe(true);
  await page.evaluate(() => window.executionChecks.open());
  const recovered = await page.evaluate(() => window.executionChecks.run());
  expect(recovered).toMatchObject({ producer: 'rust', status: 'completed', output: '5\n' });
  expect(await page.evaluate(() => window.executionChecks.inspect().activeWorkers)).toBe(0);
  await evidence(page, info, 'natural-resource-recovered', {
    failedStatus: failed.status,
    recovered: {
      producer: recovered.producer,
      status: recovered.status,
      runId: recovered.identity.runId,
      steps: recovered.steps,
    },
    workers: await page.evaluate(() => window.__performanceExceptionAudit.workers),
  });
});

test('cold Module download cancellation settles within 100ms and terminates its unposted Worker without late creation', async ({
  page,
}, info) => {
  await observeExceptionMetadata(page);
  await checks(page);
  let arrived!: () => void;
  const requested = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished!: () => void;
  const completed = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route(wasmPattern, async (route) => {
    arrived();
    await gate;
    try {
      await route.continue();
    } catch {
      // The native AbortController may already have cancelled this request.
    } finally {
      finished();
    }
  });
  const opening = page.evaluate(async () => {
    try {
      await window.executionChecks.open();
      return { outcome: 'unexpected-success', settledAt: performance.now() };
    } catch (error) {
      return {
        outcome: error instanceof Error ? error.message : 'unknown-failure',
        settledAt: performance.now(),
      };
    }
  });
  let cancelled:
    | { handledAt: number; stableAt: number; activeWorkers: number; cachedModules: number }
    | undefined;
  let outcome: Awaited<typeof opening> | undefined;
  try {
    await requested;
    const waiting = await page.evaluate(() => window.__performanceExceptionAudit.workers);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      postedAt: null,
      moduleId: null,
      responseAt: null,
      terminatedAt: null,
    });
    cancelled = await page.evaluate(() => {
      const handledAt = performance.now();
      window.executionChecks.cancel();
      const inspect = window.executionChecks.inspect();
      if (inspect.state !== 'cancelled' || inspect.activeWorkers !== 0)
        throw new Error('Cancellation did not synchronously invalidate the loading operation.');
      return {
        handledAt,
        stableAt: performance.now(),
        activeWorkers: inspect.activeWorkers,
        cachedModules: inspect.cachedModules,
      };
    });
    outcome = await opening;
  } finally {
    release();
  }
  await completed;
  await page.unroute(wasmPattern);
  await evidence(page, info, 'cold-download-cancel', { cancelled, outcome });
  expect(outcome?.outcome).toBe('E_CANCELLED');
  expect(cancelled).toMatchObject({ activeWorkers: 0, cachedModules: 0 });
  expect(outcome!.settledAt - cancelled!.handledAt).toBeLessThanOrEqual(100);
  expect(cancelled!.stableAt - cancelled!.handledAt).toBeLessThanOrEqual(100);
  const stopped = await page.evaluate(() => window.__performanceExceptionAudit.workers);
  expect(stopped).toHaveLength(1);
  expect(stopped[0]).toMatchObject({ postedAt: null, moduleId: null, responseAt: null });
  expect(stopped[0].terminatedAt).not.toBeNull();
  await page.evaluate(() => window.executionChecks.open());
  expect(await page.evaluate(() => window.executionChecks.run())).toMatchObject({
    producer: 'rust',
    status: 'completed',
    output: '5\n',
  });
  expect(await page.evaluate(() => window.__performanceExceptionAudit.maximumActive)).toBe(1);
  expect(
    await page.evaluate(() =>
      window.__performanceExceptionAudit.workers.every((worker) => worker.terminatedAt !== null),
    ),
  ).toBe(true);
});

test('an already dispatched real Worker cancels within 100ms and cannot commit a late success', async ({
  page,
}, info) => {
  await observeExceptionMetadata(page);
  await checks(page);
  await page.evaluate(() => window.executionChecks.open('case.c.assignment', 'resource'));
  const observation = await page.evaluate(async () => {
    const audit = window.__performanceExceptionAudit;
    const dispatched = new Promise<void>((resolve) => {
      audit.nextExecute = resolve;
    });
    const beforeCommits = window.executionChecks.inspect().commitCount;
    const runId = window.executionChecks.start();
    await dispatched;
    const running = window.executionChecks.inspect();
    const worker = audit.workers.at(-1)!;
    if (running.state !== 'running' || running.activeWorkers !== 1 || worker.kind !== 'execute')
      throw new Error('The cancellation sample must have a genuine dispatched active Worker.');
    const handledAt = performance.now();
    window.executionChecks.cancel();
    const result = await window.executionChecks.wait(runId);
    const settledAt = performance.now();
    const stable = window.executionChecks.inspect();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const late = window.executionChecks.inspect();
    return {
      handledAt,
      settledAt,
      elapsedMs: settledAt - handledAt,
      beforeCommits,
      result: { producer: result.producer, status: result.status, steps: result.steps },
      stable: {
        state: stable.state,
        activeWorkers: stable.activeWorkers,
        commitCount: stable.commitCount,
      },
      late: { state: late.state, activeWorkers: late.activeWorkers, commitCount: late.commitCount },
      workers: audit.workers,
    };
  });
  await evidence(page, info, 'dispatched-worker-cancel', { observation });
  expect(observation.elapsedMs).toBeLessThanOrEqual(100);
  expect(observation.result).toEqual({ producer: 'adapter', status: 'cancelled', steps: null });
  expect(observation.stable).toEqual({ state: 'cancelled', activeWorkers: 0, commitCount: 0 });
  expect(observation.late).toEqual(observation.stable);
  expect(observation.workers.every((worker) => worker.terminatedAt !== null)).toBe(true);
  expect(observation.workers.at(-1)?.messagesAfterTermination).toBe(0);
  await page.evaluate(() => window.executionChecks.open());
  expect(await page.evaluate(() => window.executionChecks.run())).toMatchObject({
    producer: 'rust',
    status: 'completed',
  });
});

test('fifty alternating real executions and cancellations keep one Worker and record available heap trends', async ({
  page,
}, info) => {
  await observeExceptionMetadata(page);
  await checks(page);
  await page.evaluate(() => window.executionChecks.open());
  const observation = await page.evaluate(async () => {
    const audit = window.__performanceExceptionAudit;
    const heap = () => {
      const memory = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
        }
      ).memory;
      return memory
        ? {
            used: memory.usedJSHeapSize,
            total: memory.totalJSHeapSize,
            limit: memory.jsHeapSizeLimit,
          }
        : null;
    };
    const samples = [{ after: 0, at: performance.now(), heap: heap() }];
    const rounds = [];
    let expectedCommits = 0;
    for (let index = 0; index < 50; index++) {
      const cancelled = index % 2 === 1;
      const beforeWorkers = audit.workers.length;
      let dispatched: Promise<void> | undefined;
      if (cancelled)
        dispatched = new Promise<void>((resolve) => {
          audit.nextExecute = resolve;
        });
      const runId = window.executionChecks.start();
      let handledAt: number | null = null;
      if (dispatched) {
        await dispatched;
        const running = window.executionChecks.inspect();
        if (running.activeWorkers !== 1 || running.state !== 'running')
          throw new Error(`Round ${index + 1} was not dispatched before cancellation.`);
        handledAt = performance.now();
        window.executionChecks.cancel();
      }
      const result = await window.executionChecks.wait(runId);
      const settledAt = performance.now();
      if (!cancelled) expectedCommits++;
      const inspect = window.executionChecks.inspect();
      const active = audit.workers.filter((worker) => worker.terminatedAt === null).length;
      const worker = audit.workers.at(-1)!;
      rounds.push({
        round: index + 1,
        cancelled,
        runId,
        workerId: worker.id,
        newWorkers: audit.workers.length - beforeWorkers,
        producer: result.producer,
        status: result.status,
        steps: result.steps,
        elapsedCancelMs: handledAt === null ? null : settledAt - handledAt,
        active,
        activeWorkers: inspect.activeWorkers,
        cachedModules: inspect.cachedModules,
        commitCount: inspect.commitCount,
        expectedCommits,
      });
      if ((index + 1) % 5 === 0)
        samples.push({ after: index + 1, at: performance.now(), heap: heap() });
      // Yield without retaining a result or Worker so native queued events may
      // settle. The harness itself keeps bounded summaries until close().
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const beforeLate = window.executionChecks.inspect().commitCount;
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    return {
      rounds,
      samples,
      workers: audit.workers,
      maximumActive: audit.maximumActive,
      compileCalls: audit.compileCalls,
      moduleCount: audit.moduleCount,
      beforeLate,
      afterLate: window.executionChecks.inspect().commitCount,
      finalInspect: window.executionChecks.inspect(),
    };
  });
  await evidence(page, info, 'fifty-alternating', {
    observation,
    memoryInterpretation:
      'performance.memory is optional and coarse. No forced GC occurs. The observer retains only metadata, WeakMap Module IDs and no raw buffers/Worker objects. /checks intentionally keeps job summaries and a last result; these samples describe trend and lifecycle bounds, not proof of zero retained trajectories, subscriptions, timers or absence of every host leak.',
  });
  expect(observation.rounds).toHaveLength(50);
  expect(observation.maximumActive).toBe(1);
  expect(observation.compileCalls).toBe(1);
  expect(observation.moduleCount).toBe(1);
  expect(new Set(observation.rounds.map((round) => round.workerId)).size).toBe(50);
  expect(new Set(observation.rounds.map((round) => round.runId)).size).toBe(50);
  for (const round of observation.rounds) {
    expect(round).toMatchObject({
      newWorkers: 1,
      active: 0,
      activeWorkers: 0,
      cachedModules: 1,
      commitCount: round.expectedCommits,
      producer: round.cancelled ? 'adapter' : 'rust',
      status: round.cancelled ? 'cancelled' : 'completed',
    });
    if (round.cancelled) {
      expect(round.steps).toBeNull();
      expect(round.elapsedCancelMs).toBeLessThanOrEqual(100);
    } else expect(round.steps).toBeGreaterThan(0);
  }
  expect(observation.beforeLate).toBe(25);
  expect(observation.afterLate).toBe(25);
  expect(observation.workers.every((worker) => worker.terminatedAt !== null)).toBe(true);
  expect(observation.workers.every((worker) => worker.messagesAfterTermination === 0)).toBe(true);
});

test('a failed inner Blockly lazy module reaches the page boundary and an explicit reload recovers', async ({
  page,
}, info) => {
  const blockPattern = /\/assets\/BlockWorkspace-[^/]+\.js$/;
  const failedRequests: string[] = [];
  await page.route(blockPattern, async (route) => {
    failedRequests.push(route.request().url());
    await route.fulfill({ status: 404, contentType: 'text/javascript', body: 'missing' });
  });
  await page.goto('/#/practice/exercise.c.echo');
  await waitForPhase2Archive(page);
  await page
    .getByTestId('block-workspace-preference')
    .getByRole('combobox', { name: '积木显示', exact: true })
    .selectOption('show');
  await expect(page.getByRole('alert')).toContainText('页面加载失败');
  // Browsers may retry a failed module fetch. Every attempt is faulted and
  // they must all address the same inner lazy module.
  expect(failedRequests.length).toBeGreaterThanOrEqual(1);
  expect(new Set(failedRequests).size).toBe(1);
  await expect(page.getByRole('region', { name: '积木工作区', exact: true })).toHaveCount(0);
  await page.unroute(blockPattern);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('region', { name: '积木工作区', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await evidence(page, info, 'inner-blockly-lazy-recovery', {
    scope:
      'Production inner BlockWorkspace JavaScript 404; native visible page recovery button reload after removing that fault. No Rust or learning result is synthesized.',
    failedRequests,
    recovered: true,
  });
});
