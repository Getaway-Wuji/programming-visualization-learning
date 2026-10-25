import { expect, test, type Page } from '@playwright/test';
import type { ExecuteResult } from '../../web/src/engine/protocol';
import type {} from './harness/execution';

type Fault = 'identity' | 'fixture' | 'trace' | 'utf8' | 'duplicate' | 'operation' | 'oversize';
interface WorkerAudit {
  kind: string;
  terminated: boolean;
  module: number;
  responses: number;
  rustResults: number;
}
interface ExecutionAudit {
  workers: WorkerAudit[];
  compileCalls: number;
  maxActive: number;
  hold: boolean;
  held: number;
  fault: Fault | null;
  release: () => void;
  storageWrites: string[];
}
declare global {
  interface Window {
    __executionAudit: ExecutionAudit;
  }
}

async function observe(page: Page) {
  await page.addInitScript(() => {
    let pending: (() => void)[] = [];
    const modules: WebAssembly.Module[] = [];
    const audit: ExecutionAudit = {
      workers: [],
      compileCalls: 0,
      maxActive: 0,
      hold: false,
      held: 0,
      fault: null,
      release() {
        const work = pending;
        pending = [];
        audit.held = 0;
        work.forEach((run) => run());
      },
      storageWrites: [],
    };
    window.__executionAudit = audit;
    const nativeCompile = WebAssembly.compile.bind(WebAssembly);
    WebAssembly.compile = async (bytes) => {
      audit.compileCalls++;
      return nativeCompile(bytes);
    };
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      audit.storageWrites.push(`${key}:${value}`);
      return write.call(this, key, value);
    };
    const nativePut = IDBObjectStore.prototype.put;
    const nativeAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.put = function (value, key) {
      audit.storageWrites.push(JSON.stringify(value));
      return key === undefined ? nativePut.call(this, value) : nativePut.call(this, value, key);
    };
    IDBObjectStore.prototype.add = function (value, key) {
      audit.storageWrites.push(JSON.stringify(value));
      return key === undefined ? nativeAdd.call(this, value) : nativeAdd.call(this, value, key);
    };
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      if (value && typeof value === 'object')
        return `{${Object.keys(value)
          .sort()
          .map(
            (key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(',')}}`;
      return JSON.stringify(value);
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private audit: WorkerAudit;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.audit = { kind: '', terminated: false, module: 0, responses: 0, rustResults: 0 };
        audit.workers.push(this.audit);
        audit.maxActive = Math.max(
          audit.maxActive,
          audit.workers.filter((worker) => !worker.terminated).length,
        );
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          this.audit.responses++;
          const data = event.data as Record<string, unknown>;
          if (!data || !(data.buffer instanceof ArrayBuffer)) return;
          let result: ExecuteResult | undefined;
          try {
            const decoded = JSON.parse(new TextDecoder().decode(data.buffer)) as ExecuteResult;
            if (decoded.kind === 'result') result = decoded;
          } catch {
            /* An actual malformed response is checked by the client. */
          }
          if (result?.producer === 'rust') this.audit.rustResults++;
          if (this.audit.kind !== 'execute' || (!audit.hold && !audit.fault)) return;
          const handler = this.onmessage;
          if (!handler) return;
          event.stopImmediatePropagation();
          let message = data;
          const fault = audit.fault;
          audit.fault = null;
          if (fault) {
            let buffer: ArrayBuffer;
            if (fault === 'utf8') buffer = new Uint8Array([255]).buffer;
            else if (fault === 'oversize') buffer = new ArrayBuffer(16_777_217);
            else if (fault === 'operation') {
              buffer = data.buffer;
              message = { ...data, operationId: 'wrong-operation' };
            } else {
              if (!result) throw new Error('A real Rust result is required before mutation.');
              if (fault === 'identity') result.identity.contextRevision++;
              if (fault === 'fixture') {
                (result as unknown as Record<string, unknown>).producer = 'fixture';
                result.stats = null;
              }
              if (fault === 'trace') {
                const change = result.trace?.steps
                  .flatMap((step) => step.changes)
                  .find((change) => change.op === 'output');
                if (!change || change.op !== 'output')
                  throw new Error('Missing real output mutation point.');
                change.beforeBytes++;
              }
              const encoded = canonical(result);
              buffer = new TextEncoder().encode(
                fault === 'duplicate'
                  ? encoded.replace('{"budgetRef":', '{"budgetRef":null,"budgetRef":')
                  : encoded,
              ).buffer;
            }
            message = { ...message, buffer };
          }
          const deliver = () => handler.call(this, new MessageEvent('message', { data: message }));
          if (audit.hold) {
            audit.hold = false;
            audit.held++;
            pending.push(deliver);
          } else deliver();
        });
      }
      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        const data = message as Record<string, unknown>;
        if (data && typeof data.kind === 'string') this.audit.kind = data.kind;
        if (data?.module instanceof WebAssembly.Module) {
          let index = modules.indexOf(data.module);
          if (index < 0) index = modules.push(data.module) - 1;
          this.audit.module = index + 1;
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      terminate() {
        this.audit.terminated = true;
        super.terminate();
      }
    };
  });
}

async function checks(page: Page) {
  await page.goto('/checks/');
  await expect
    .poll(() => page.evaluate(() => typeof window.executionChecks?.open))
    .toBe('function');
}
const panel = (page: Page) => page.getByTestId('case-execution');
const run = (page: Page) => panel(page).getByRole('button', { name: '运行示例', exact: true });

test('hard cancellation releases an actual busy Rust Worker and a fresh run recovers', async ({
  page,
}) => {
  await observe(page);
  await checks(page);
  await page.evaluate(() => window.executionChecks.open('case.c.assignment', 'resource'));
  const id = await page.evaluate(() => window.executionChecks.start());
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__executionAudit.workers.some(
          (worker) => worker.kind === 'execute' && !worker.terminated,
        ),
      ),
    )
    .toBe(true);
  const result = await page.evaluate(async (id) => {
    window.executionChecks.cancel();
    return window.executionChecks.wait(id);
  }, id);
  expect(result).toMatchObject({
    producer: 'adapter',
    status: 'cancelled',
    steps: null,
    stats: null,
    judge: null,
  });
  expect(
    await page.evaluate(() => window.__executionAudit.workers.every((worker) => worker.terminated)),
  ).toBe(true);
  await page.evaluate(() => window.executionChecks.open());
  expect(await page.evaluate(() => window.executionChecks.run())).toMatchObject({
    producer: 'rust',
    status: 'completed',
    output: '5\n',
  });
});

test('all seven public cases return real Rust trajectories with their displayed source and no judge or learning claim', async ({
  page,
}, testInfo) => {
  await observe(page);
  await checks(page);
  const observations = [];
  for (const [id, output] of [
    ['case.c.assignment', '5\n'],
    ['case.c.branch', '0\n'],
    ['case.c.loops', '15\n15\n'],
    ['case.c.array-traversal', '4\n'],
    ['case.c.bubble-sort', '1 2 3\n'],
    ['case.c.selection-sort', '1 2 3\n'],
    ['case.c.binary-search-first', '1\n'],
  ]) {
    const prepared = await page.evaluate((id) => window.executionChecks.open(id), id);
    expect(prepared.source).toContain('int main(void)');
    expect(prepared.bindings).toBeGreaterThan(0);
    const answer = await page.evaluate(() => window.executionChecks.run());
    expect(answer).toMatchObject({
      producer: 'rust',
      status: 'completed',
      exitCode: 0,
      output,
      completeness: 'complete',
      judge: null,
    });
    expect(answer.steps).toBeGreaterThan(1);
    expect(answer.cursor).toBe(answer.steps);
    expect(answer.nodeCount).toBeGreaterThan(1);
    expect(answer.bindingCount).toBe(prepared.bindings);
    expect(answer.stats!.fuelUsed).toBeLessThanOrEqual(1_000_000);
    expect(answer.stats!.rustMicros).toBeGreaterThanOrEqual(0);
    observations.push({ id, ...answer });
  }
  const audit = await page.evaluate(() => ({
    workers: window.__executionAudit.workers,
    maxActive: window.__executionAudit.maxActive,
  }));
  expect(audit.maxActive).toBe(1);
  expect(audit.workers.every((worker) => worker.terminated)).toBe(true);
  expect(
    audit.workers
      .filter((worker) => worker.kind === 'execute')
      .every((worker) => worker.rustResults === 1),
  ).toBe(true);
  await testInfo.attach('seven-real-public-cases', {
    body: JSON.stringify({ observations, audit }),
    contentType: 'application/json',
  });
});

test('changed public source changes the result while Rust runtime errors keep an honest prefix and the next run recovers', async ({
  page,
}) => {
  await observe(page);
  await checks(page);
  await page.evaluate(() => window.executionChecks.open('case.c.assignment', 'changed'));
  expect(await page.evaluate(() => window.executionChecks.run())).toMatchObject({
    producer: 'rust',
    status: 'completed',
    output: '10\n',
  });
  for (const [variant, code] of [
    ['division', 'E_DIV_ZERO'],
    ['uninitialized', 'E_UNINITIALIZED'],
  ] as const) {
    await page.evaluate(
      (variant) => window.executionChecks.open('case.c.assignment', variant),
      variant,
    );
    const failure = await page.evaluate(() => window.executionChecks.run());
    expect(failure).toMatchObject({
      producer: 'rust',
      status: 'program-error',
      exitCode: null,
      output: '',
      completeness: 'prefix',
      judge: null,
    });
    expect(failure.codes).toContain(code);
    expect(failure.steps).toBeGreaterThan(0);
  }
  await page.evaluate(() => window.executionChecks.open());
  expect(await page.evaluate(() => window.executionChecks.run())).toMatchObject({
    producer: 'rust',
    status: 'completed',
    output: '5\n',
  });
});

test('one cached Module serves fresh terminated Workers and late cancel cannot rewrite an accepted result', async ({
  page,
}) => {
  await observe(page);
  await checks(page);
  await page.evaluate(() => window.executionChecks.open());
  const first = await page.evaluate(() => window.executionChecks.run());
  await page.evaluate(() => window.executionChecks.cancel());
  expect(await page.evaluate(() => window.executionChecks.inspect())).toMatchObject({
    state: 'accepted',
    commitCount: 1,
    committed: { identity: first.identity },
  });
  const second = await page.evaluate(() => window.executionChecks.run());
  expect(second.identity.runId).not.toBe(first.identity.runId);
  expect(second.identity.submissionId).not.toBe(first.identity.submissionId);
  const audit = await page.evaluate(() => ({
    workers: window.__executionAudit.workers,
    compileCalls: window.__executionAudit.compileCalls,
    maxActive: window.__executionAudit.maxActive,
  }));
  expect(audit.compileCalls).toBe(1);
  expect(audit.workers).toHaveLength(3);
  expect(
    audit.workers.every(
      (worker) => worker.terminated && worker.module === audit.workers[0]!.module,
    ),
  ).toBe(true);
  expect(audit.maxActive).toBe(1);
});

test('queued real old results cannot survive cancel, superseding run or context invalidation', async ({
  page,
}) => {
  await observe(page);
  await checks(page);
  await page.evaluate(() => window.executionChecks.open());
  for (const action of ['cancel', 'invalidate', 'supersede'] as const) {
    await page.evaluate(() => {
      window.__executionAudit.hold = true;
    });
    const job = await page.evaluate(() => window.executionChecks.start());
    await expect.poll(() => page.evaluate(() => window.__executionAudit.held)).toBe(1);
    if (action === 'invalidate') await page.evaluate(() => window.executionChecks.invalidate());
    else if (action === 'cancel') await page.evaluate(() => window.executionChecks.cancel());
    else
      expect(await page.evaluate(() => window.executionChecks.run())).toMatchObject({
        producer: 'rust',
        status: 'completed',
      });
    const old = await page.evaluate((id) => window.executionChecks.wait(id), job);
    expect(old).toMatchObject({
      producer: 'adapter',
      status: 'cancelled',
      steps: null,
      stats: null,
      judge: null,
    });
    const current = await page.evaluate(() => window.executionChecks.inspect());
    await page.evaluate(() => window.__executionAudit.release());
    expect(await page.evaluate(() => window.executionChecks.inspect())).toEqual(current);
  }
});

test('current Worker malformed buffers, identity mismatches, fixture origins and invalid transitions fail without fake completion and recover', async ({
  page,
}) => {
  await observe(page);
  await checks(page);
  await page.evaluate(() => window.executionChecks.open());
  for (const fault of [
    'identity',
    'fixture',
    'trace',
    'utf8',
    'duplicate',
    'operation',
    'oversize',
  ] as const) {
    await page.evaluate((fault) => {
      window.__executionAudit.fault = fault;
    }, fault);
    const result = await page.evaluate(() => window.executionChecks.run());
    expect(result).toMatchObject({
      producer: 'adapter',
      status: 'infrastructure-failure',
      steps: null,
      stats: null,
      judge: null,
    });
    expect(
      result.codes.some((code) => ['E_PROTOCOL_INVALID', 'E_TRACE_INVALID'].includes(code)),
    ).toBe(true);
    expect(await page.evaluate(() => window.executionChecks.run())).toMatchObject({
      producer: 'rust',
      status: 'completed',
      output: '5\n',
    });
  }
});

test('the original one-second deadline includes asynchronous validation and rejects a real late successful buffer', async ({
  page,
}) => {
  await observe(page);
  await checks(page);
  await page.evaluate(() => window.executionChecks.open('case.c.assignment', 'normal', 1100));
  const result = await page.evaluate(() => window.executionChecks.run());
  expect(result).toMatchObject({
    producer: 'adapter',
    status: 'resource-limit',
    codes: ['E_DEADLINE'],
    steps: null,
    stats: null,
    judge: null,
  });
  await expect
    .poll(() => page.evaluate(() => window.executionChecks.inspect().commitCount))
    .toBe(0);
  expect(await page.evaluate(() => window.executionChecks.inspect())).toMatchObject({
    state: 'expired',
    activeWorkers: 0,
    committed: null,
  });
});

test('public developer marker stays in temporary execution and never enters requests, console, browser storage or Cache API', async ({
  page,
}, testInfo) => {
  await observe(page);
  const requests: {
    url: string;
    method: string;
    body: string | null;
    headers: Record<string, string>;
  }[] = [];
  const logs: string[] = [];
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
      headers: request.headers(),
    }),
  );
  page.on('console', (message) => logs.push(message.text()));
  await checks(page);
  const prepared = await page.evaluate(() =>
    window.executionChecks.open('case.c.assignment', 'markup'),
  );
  expect(prepared.source).toContain('CVIZ-07.1-PUBLIC-AUDIT');
  expect(await page.evaluate(() => window.executionChecks.run())).toMatchObject({
    producer: 'rust',
    status: 'completed',
    output: 'CVIZ-07.1-PUBLIC-AUDIT <b>safe text</b>\n5\n',
  });
  const stored = await page.evaluate(async () => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    writes: window.__executionAudit.storageWrites,
    cookie: document.cookie,
    caches: await caches.keys(),
    databases: await indexedDB.databases(),
  }));
  expect(
    requests.every(
      (request) =>
        request.method === 'GET' &&
        request.body === null &&
        new URL(request.url).origin === new URL(page.url()).origin,
    ),
  ).toBe(true);
  for (const value of [requests, logs, stored, page.url()])
    expect(JSON.stringify(value)).not.toContain('CVIZ-07.1-PUBLIC-AUDIT');
  expect(stored.caches).toEqual([]);
  expect(stored.databases).toEqual([]);
  await testInfo.attach('runtime-content-boundary', {
    body: JSON.stringify({
      requestCount: requests.length,
      consoleCount: logs.length,
      storageWrites: stored.writes.length,
      cacheNames: stored.caches,
      databases: stored.databases,
    }),
    contentType: 'application/json',
  });
});

test('the visible case runs the exact read-only source and exposes real terminal, steps, output and ready playback', async ({
  page,
}, testInfo) => {
  await observe(page);
  await page.goto('/#/visualize/case.c.assignment');
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(panel(page).getByRole('textbox', { name: '当前执行的 C 代码' })).toHaveValue(
    /int x = 3;/,
  );
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('execution-terminal')).toContainText(/正常|完成/);
  await expect(page.getByTestId('execution-output')).toHaveText('5\n');
  await expect(page.getByTestId('execution-steps')).toContainText(/\d+/);
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-player-status', 'ready');
  await expect(
    page.getByTestId('player-controls').getByRole('button', { name: '播放', exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', '0');
  await expect(page.getByTestId('source-location')).toContainText('初始');
  await expect(page.getByTestId('case-view-confirmation')).toHaveAttribute(
    'data-view-state',
    'incomplete',
  );
  await expect(page.getByRole('button', { name: '确认已观看', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('real-case-execution.png'), fullPage: true });
});

test('visible module failure is distinct from program completion and retry uses real Rust', async ({
  page,
}) => {
  await page.route(/\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/, (route) =>
    route.fulfill({ status: 404, contentType: 'application/wasm', body: 'Missing public module' }),
  );
  await page.goto('/#/visualize/case.c.assignment');
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'infrastructure-failure');
  await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(panel(page)).toContainText('E_MODULE_LOAD');
  await expect(page.getByTestId('execution-steps')).toContainText('有效轨迹：0 步');
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await expect(page.getByTestId('execution-output')).toHaveText('（无输出）');
  await page.unroute(/\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/);
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('execution-output')).toHaveText('5\n');
});

test('switching visible cases discards a queued real result before the next case runs', async ({
  page,
}) => {
  await observe(page);
  await page.goto('/#/visualize/case.c.assignment');
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => {
    window.__executionAudit.hold = true;
  });
  await run(page).click();
  await expect.poll(() => page.evaluate(() => window.__executionAudit.held)).toBe(1);
  await page.evaluate(() => {
    location.hash = '#/visualize/case.c.selection-sort';
  });
  await expect(page.locator('main h1')).toHaveText('选择排序');
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => window.__executionAudit.release());
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('execution-output')).toHaveText('1 2 3\n');
});

test('clearing local data in a peer tab invalidates an already accepted real trajectory', async ({
  page,
  context,
}) => {
  await page.goto('/#/visualize/case.c.assignment');
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await run(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'completed');
  await page
    .getByTestId('player-controls')
    .getByRole('button', { name: '播放', exact: true })
    .click();
  await expect(page.getByTestId('player-controls')).toHaveAttribute(
    'data-player-status',
    'playing',
  );
  const settings = await context.newPage();
  await settings.goto('/#/settings?panel=data');
  await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await settings
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(settings.getByTestId('learning-save-status')).toContainText('本地数据已清除');
  // The existing page boundary remounts on the new local-data generation.
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  await expect(page.getByTestId('code-panel').locator('textarea')).toHaveValue(/int x = 3;/);
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-cursor', '');
  await page.waitForTimeout(650);
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
});
