import { expectEditorValue } from './editor-value';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import type { CaseExecutionCatalog } from '../../web/src/content/case-learning';

const samplePath = '/content/sample/02.1-content-1.0.0.json';
const samplePattern = /\/content\/sample\/02\.1-content-1\.0\.0\.json$/;
const wasmPattern = /\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/;
const workerPattern = /\/assets\/probe\.worker-[^/]+\.js$/;
// Retained low-level diagnostics run in the actual current app's internal QA
// entry. They are no longer controls on student-facing case pages.
const referencePath = '/checks/adapters.html#/visualize/case.c.assignment';
const visualPath = '/checks/adapters.html#/visualize/case.c.bubble-sort';
const fixturePath = '/checks/adapters.html#/cases';
const reviewedCases = JSON.parse(
  readFileSync(
    new URL('../../content/c/primer6-learning/cases-1.0.0.json', import.meta.url),
    'utf8',
  ),
) as { catalogs: CaseExecutionCatalog[] };

interface BuildValue {
  kind: string;
  probeVersion: string;
  engineVersion: string;
  nonce: number;
  interpreterReady: boolean;
}

interface WorkerObservation {
  url: string;
  requestKind?: string;
  terminated: boolean;
  moduleToken: number;
  nonce?: number;
  instanceId?: string;
  maximumPages?: number;
  build?: BuildValue;
  resultKeys: string[];
}

interface AdapterAudit {
  compileCalls: number;
  holdNextCompile: boolean;
  heldCompiles: number;
  releaseCompiles: () => void;
  storageWrites: number;
  databaseOpens: number;
  databaseNames: string[];
  workers: WorkerObservation[];
  maximumActiveWorkers: number;
}

interface ContentFixture {
  purpose: string;
  cases: {
    id: string;
    programRef: { id: string; version: string };
    teaching: { objectives: string[]; explanation: string };
  }[];
}

declare global {
  interface Window {
    __adapterAudit: AdapterAudit;
  }
}

// Observe real native compilation and Worker messages. The interception never
// creates a Rust response, executes C, or passes source/input to a test endpoint.
async function observeAdapter(page: Page) {
  await page.addInitScript(() => {
    const modules: WebAssembly.Module[] = [];
    let releases: (() => void)[] = [];
    const audit: AdapterAudit = {
      compileCalls: 0,
      holdNextCompile: false,
      heldCompiles: 0,
      releaseCompiles() {
        const pending = releases;
        releases = [];
        pending.forEach((release) => release());
      },
      storageWrites: 0,
      databaseOpens: 0,
      databaseNames: [],
      workers: [],
      maximumActiveWorkers: 0,
    };
    window.__adapterAudit = audit;
    const nativeCompile = WebAssembly.compile.bind(WebAssembly);
    WebAssembly.compile = async (bytes: BufferSource) => {
      audit.compileCalls += 1;
      const hold = audit.holdNextCompile;
      audit.holdNextCompile = false;
      const module = await nativeCompile(bytes);
      if (hold) {
        audit.heldCompiles += 1;
        await new Promise<void>((resolve) => releases.push(resolve));
      }
      return module;
    };

    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      audit.storageWrites += 1;
      nativeSetItem.call(this, key, value);
    };
    const nativeOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name: string, version?: number) => {
      audit.databaseOpens += 1;
      audit.databaseNames.push(name);
      return nativeOpen(name, version);
    };

    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private observation: WorkerObservation;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.observation = {
          url: String(url),
          terminated: false,
          moduleToken: 0,
          resultKeys: [],
        };
        audit.workers.push(this.observation);
        audit.maximumActiveWorkers = Math.max(
          audit.maximumActiveWorkers,
          audit.workers.filter((worker) => !worker.terminated).length,
        );
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (typeof event.data !== 'object' || event.data === null) return;
          const value = event.data as Record<string, unknown>;
          if (typeof value.workerInstanceId === 'string') {
            this.observation.instanceId = value.workerInstanceId;
          }
          if (typeof value.maximumPages === 'number') {
            this.observation.maximumPages = value.maximumPages;
          }
          if (typeof value.memory === 'object' && value.memory !== null) {
            const memory = value.memory as Record<string, unknown>;
            if (typeof memory.maximumPages === 'number') {
              this.observation.maximumPages = memory.maximumPages;
            }
          }
          if (!(value.buffer instanceof ArrayBuffer)) return;
          try {
            const decoded: unknown = JSON.parse(new TextDecoder().decode(value.buffer));
            if (typeof decoded !== 'object' || decoded === null) return;
            const record = decoded as Record<string, unknown>;
            this.observation.resultKeys = Object.keys(record).sort();
            if (record.kind === 'build-probe') {
              this.observation.build = decoded as BuildValue;
            }
          } catch {
            // Malformed infrastructure responses remain the adapter's concern.
          }
        });
      }

      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        if (typeof message === 'object' && message !== null) {
          const value = message as Record<string, unknown>;
          if (typeof value.kind === 'string') this.observation.requestKind = value.kind;
          const module = Object.values(value).find(
            (entry): entry is WebAssembly.Module => entry instanceof WebAssembly.Module,
          );
          if (module) {
            let index = modules.indexOf(module);
            if (index === -1) index = modules.push(module) - 1;
            this.observation.moduleToken = index + 1;
          }
          if (typeof value.nonce === 'number') this.observation.nonce = value.nonce;
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }

      terminate() {
        this.observation.terminated = true;
        super.terminate();
      }
    };
  });
}

function connection(page: Page) {
  return page.getByTestId('engine-connection');
}

function checkButton(page: Page) {
  return connection(page)
    .getByRole('button', { name: /检查执行模块|重新检查|重试/ })
    .first();
}

async function caseReady(page: Page) {
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await expectEditorValue(page.getByTestId('code-panel').locator('textarea'), '', { not: true });
  await expect(page.getByRole('button', { name: '运行示例', exact: true })).toBeEnabled();
}

async function freshPage(page: Page, path: string) {
  await page.goto('/');
  await page.reload();
  await page.goto(path);
  await expect(page.locator('main h1')).toBeVisible();
  if (path.startsWith('/#/visualize/')) await caseReady(page);
}

async function checked(page: Page) {
  await caseReady(page);
  await checkButton(page).click();
  await expect(connection(page)).toHaveAttribute('data-state', 'ready');
  await expect(connection(page)).toContainText('构建检查不执行 C');
}

async function completeRoute(route: Route) {
  try {
    await route.continue();
  } catch {
    // Cancelling a fetch or terminating a Worker may already abort this request.
  }
}

async function noLearningWrites(page: Page) {
  const observation = await page.evaluate(() => ({
    storageWrites: window.__adapterAudit.storageWrites,
    databaseNames: window.__adapterAudit.databaseNames,
  }));
  expect(observation.storageWrites).toBe(0);
  expect(observation.databaseNames.every((name) => name === 'c-viz-learning')).toBe(true);
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('c-viz-learning');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const names = [
        'progress',
        'dailyFacts',
        'goals',
        'ledger',
        'receipts',
        'aliases',
        'editHistory',
        'knowledgeMarks',
        'reviewCards',
        'achievements',
        'customDrafts',
        'weaknesses',
        'courseActivities',
        'courseDrafts',
        'pythonActivities',
        'pythonDrafts',
      ].filter((name) => db.objectStoreNames.contains(name));
      const tx = db.transaction(names, 'readonly');
      const businessCounts = await Promise.all(
        names.map(
          (name) =>
            new Promise<number>((resolve, reject) => {
              const req = tx.objectStore(name).count();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            }),
        ),
      );
      return {
        version: db.version,
        storeNames: Array.from(db.objectStoreNames).sort(),
        businessCounts,
      };
    } finally {
      db.close();
    }
  });
  expect([9, 10, 11]).toContain(counts.version);
  expect(counts.storeNames).toEqual(
    [
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
      'pythonActivities',
      'pythonDrafts',
      'receipts',
      'reviewCards',
      'settings',
      'weaknesses',
    ].filter(
      (name) =>
        (counts.version >= 10 || !['courseActivities', 'courseDrafts'].includes(name)) &&
        (counts.version >= 11 || !['pythonActivities', 'pythonDrafts'].includes(name)),
    ),
  );
  expect(counts.businessCounts).toEqual(Array(12 + 2 * (counts.version - 9)).fill(0));
}

test('reviewed case reference matches its execution release while the frozen package remains unpublished', async ({
  page,
  request,
}, testInfo) => {
  await observeAdapter(page);
  const response = await request.get(samplePath);
  expect(response.status()).toBe(200);
  const fixture = (await response.json()) as ContentFixture;
  expect(fixture.purpose).toBe('contract-fixture');
  const assignment = reviewedCases.catalogs.find(
    (item) => item.subject.id === 'case.c.assignment',
  )!;
  const requests: { url: string; method: string }[] = [];
  page.on('request', (entry) => requests.push({ url: entry.url(), method: entry.method() }));
  await page.goto('/#/visualize/case.c.assignment');
  const sample = page.getByTestId('content-sample');
  await expect(sample).toHaveAttribute('data-state', 'ready');
  await expect(sample).toHaveAttribute('data-content-scope', 'case-view');
  await expect(sample.getByRole('heading', { name: '案例讲解', exact: true })).toBeVisible();
  for (const objective of assignment.subject.teaching.objectives)
    await expect(sample).toContainText(objective);
  await expect(sample).toContainText(assignment.subject.teaching.explanation);
  expect(await sample.getByLabel(`${assignment.program.title}参考源码`).textContent()).toBe(
    assignment.program.sourceExample,
  );
  await expect(sample.locator('textarea, [contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByTestId('code-panel').locator('textarea')).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await expectEditorValue(page.getByTestId('code-panel').locator('textarea'), '', { not: true });
  await expect(page.getByRole('button', { name: '运行示例', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '确认已学习' })).toHaveCount(0);
  // Case teaching and execution share the bundled reviewed projection. The old
  // unpublished fixture is independently checked through its directory below.
  expect(requests.filter((entry) => samplePattern.test(new URL(entry.url).pathname))).toHaveLength(
    0,
  );
  expect(requests.every((entry) => entry.method === 'GET')).toBe(true);
  expect(requests.every((entry) => new URL(entry.url).origin === new URL(page.url()).origin)).toBe(
    true,
  );
  expect(
    requests.some((entry) =>
      /\/(?:execute|submission|reward|progress)(?:\/|$)/i.test(new URL(entry.url).pathname),
    ),
  ).toBe(false);
  const preparation = await page.evaluate(() => ({
    workers: window.__adapterAudit.workers,
    compileCalls: window.__adapterAudit.compileCalls,
    maximumActiveWorkers: window.__adapterAudit.maximumActiveWorkers,
  }));
  expect(preparation).toEqual({ workers: [], compileCalls: 0, maximumActiveWorkers: 0 });
  expect(requests.filter((entry) => wasmPattern.test(new URL(entry.url).pathname))).toHaveLength(0);
  for (const entry of requests.filter((entry) =>
    /reward|progress/i.test(new URL(entry.url).pathname),
  )) {
    expect(new URL(entry.url).pathname).toMatch(/^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/);
  }
  await testInfo.attach('published-source-preparation-without-execution', {
    body: JSON.stringify({ requests, preparation }),
    contentType: 'application/json',
  });
  await noLearningWrites(page);
  await page.screenshot({
    path: testInfo.outputPath('standard-content-sample.png'),
    fullPage: true,
  });
});

test('HTTP, duplicate JSON key, unknown version and missing reference reject the complete package and recover', async ({
  page,
  request,
}) => {
  const response = await request.get(samplePath);
  const raw = await response.text();
  const fixture = JSON.parse(raw) as ContentFixture;
  const directorySummary = '已读取 4 个语法演示和 3 个算法案例样例';
  const missingReference = structuredClone(fixture);
  missingReference.cases.find((item) => item.id === 'case.c.assignment')!.programRef.id =
    'program.c.missing';
  const badPackages = [
    { status: 404, body: 'Not found' },
    {
      status: 200,
      body: raw.replace(
        '"contractVersion": "1.0.0"',
        '"contractVersion": "1.0.0", "contractVersion": "1.0.0"',
      ),
    },
    { status: 200, body: raw.replace('"contractVersion": "1.0.0"', '"contractVersion": "9.0.0"') },
    {
      status: 200,
      body: JSON.stringify(missingReference),
    },
  ];
  for (const bad of badPackages) {
    expect(bad.body).not.toBe(raw);
    await page.route(samplePattern, (route) =>
      route.fulfill({ ...bad, contentType: 'application/json' }),
    );
    // The directory retains the actual repository and retry boundary. Reviewed
    // independent case pages no longer consume or display this fixture package.
    await freshPage(page, fixturePath);
    const sample = page.getByTestId('content-sample');
    await expect(sample).toHaveAttribute('data-state', 'failed');
    await expect(sample.getByRole('alert')).toBeVisible();
    await expect(sample).not.toContainText(directorySummary);
    await expect(sample.locator('pre')).toHaveCount(0);
    await expect(page.getByTestId('code-panel')).toHaveCount(0);
    await expect(page.getByTestId('case-execution')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '确认已学习' })).toHaveCount(0);
    await page.unroute(samplePattern);
    await sample.getByRole('button', { name: /重试|重新加载/ }).click();
    await expect(sample).toHaveAttribute('data-state', 'ready');
    await expect(sample).toContainText(directorySummary);
    await expect(sample).toContainText('标准内容样例 · 尚未正式发布');
  }
});

test('on-demand cold and warm checks call real Rust in separate terminated workers using one Module', async ({
  page,
}, testInfo) => {
  await observeAdapter(page);
  const wasmRequests: string[] = [];
  page.on('request', (entry) => {
    if (wasmPattern.test(new URL(entry.url()).pathname)) wasmRequests.push(entry.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  expect(wasmRequests).toEqual([]);
  expect(await page.evaluate(() => window.__adapterAudit.workers.length)).toBe(0);
  await page.goto(referencePath);
  await expect(connection(page)).toHaveAttribute('data-state', 'idle');
  expect(wasmRequests).toEqual([]);
  await checked(page);
  const cold = await page.evaluate(() => ({
    workers: window.__adapterAudit.workers,
    compileCalls: window.__adapterAudit.compileCalls,
    maximumActiveWorkers: window.__adapterAudit.maximumActiveWorkers,
  }));
  expect(wasmRequests).toHaveLength(1);
  expect(cold.compileCalls).toBe(1);
  expect(cold.workers).toHaveLength(1);
  await checked(page);
  const warm = await page.evaluate(() => ({
    workers: window.__adapterAudit.workers,
    compileCalls: window.__adapterAudit.compileCalls,
    maximumActiveWorkers: window.__adapterAudit.maximumActiveWorkers,
  }));
  expect(wasmRequests).toHaveLength(1);
  expect(warm.compileCalls).toBe(1);
  expect(warm.workers).toHaveLength(2);
  expect(warm.maximumActiveWorkers).toBe(1);
  expect(warm.workers[0].moduleToken).toBeGreaterThan(0);
  expect(warm.workers[1].moduleToken).toBe(warm.workers[0].moduleToken);
  expect(warm.workers[0].instanceId).toBeTruthy();
  expect(warm.workers[1].instanceId).not.toBe(warm.workers[0].instanceId);
  for (const worker of warm.workers) {
    expect(worker.terminated).toBe(true);
    expect(worker.maximumPages).toBe(2048);
    expect(worker.build).toEqual({
      kind: 'build-probe',
      probeVersion: '1.0.0',
      nonce: worker.nonce,
      engineVersion: '0.1.0',
      interpreterReady: false,
    });
    expect(worker.resultKeys).not.toContain('trace');
  }
  await expect(page.getByRole('button', { name: '提交练习', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '运行程序', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '运行示例', exact: true })).toBeEnabled();
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await expectEditorValue(page.getByTestId('code-panel').locator('textarea'), '', { not: true });
  await expect(page.getByTestId('execution-output')).toHaveCount(0);
  await noLearningWrites(page);
  await testInfo.attach('real-adapter-observations', {
    body: JSON.stringify({ cold, warm }),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: testInfo.outputPath('engine-connected-without-interpreter.png'),
    fullPage: true,
  });
});

test('missing WASM, invalid WASM and failed Worker show infrastructure feedback and retry successfully', async ({
  page,
}) => {
  await observeAdapter(page);
  for (const fault of ['missing', 'invalid', 'worker'] as const) {
    const pattern = fault === 'worker' ? workerPattern : wasmPattern;
    await page.route(pattern, async (route) => {
      if (fault === 'worker') return route.abort('failed');
      if (fault === 'invalid') {
        const original = await route.fetch();
        expect(original.status()).toBe(200);
        const bytes = await original.body();
        bytes[0] = bytes[0]! ^ 0xff;
        return route.fulfill({ status: 200, contentType: 'application/wasm', body: bytes });
      }
      return route.fulfill({
        status: 404,
        contentType: 'application/wasm',
        body: 'Not found',
      });
    });
    await freshPage(page, visualPath);
    await checkButton(page).click();
    await expect(connection(page)).toHaveAttribute('data-state', 'failed');
    await expect(connection(page).getByRole('alert')).toBeVisible();
    await expect(connection(page)).toContainText(/模块|WASM|Worker|加载|连接/);
    await expect(page.getByRole('button', { name: '运行示例', exact: true })).toBeEnabled();
    await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('execution-output')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
    await page.unroute(pattern);
    await checked(page);
    expect(await page.evaluate(() => window.__adapterAudit.maximumActiveWorkers)).toBe(1);
    expect(
      await page.evaluate(() => window.__adapterAudit.workers.every((worker) => worker.terminated)),
    ).toBe(true);
    await noLearningWrites(page);
  }
});

test('cancelling a delayed download rejects the old load and a new check starts cleanly', async ({
  page,
}) => {
  await observeAdapter(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const arrived = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let completed!: () => void;
  const finished = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route(wasmPattern, async (route) => {
    requested();
    await gate;
    await completeRoute(route);
    completed();
  });
  await page.goto(visualPath);
  await caseReady(page);
  await checkButton(page).click();
  await arrived;
  await expect(connection(page)).toHaveAttribute('data-state', 'loading');
  try {
    await connection(page).getByRole('button', { name: '取消检查' }).click();
    await expect(connection(page)).toHaveAttribute('data-state', 'cancelled');
    expect(await page.evaluate(() => window.__adapterAudit.workers.length)).toBe(0);
  } finally {
    release();
  }
  await finished;
  await page.unroute(wasmPattern);
  await expect(connection(page)).toHaveAttribute('data-state', 'cancelled');
  await checked(page);
  expect(await page.evaluate(() => window.__adapterAudit.compileCalls)).toBe(1);
  expect(await page.evaluate(() => window.__adapterAudit.workers.length)).toBe(1);
});

test('an old real compilation cannot replace the Module or state of a newer accepted check', async ({
  page,
}) => {
  await observeAdapter(page);
  await page.goto(visualPath);
  await caseReady(page);
  await page.evaluate(() => {
    window.__adapterAudit.holdNextCompile = true;
  });
  await checkButton(page).click();
  await expect.poll(() => page.evaluate(() => window.__adapterAudit.heldCompiles)).toBe(1);
  await connection(page).getByRole('button', { name: '取消检查' }).click();
  await expect(connection(page)).toHaveAttribute('data-state', 'cancelled');
  await checked(page);
  const accepted = await page.evaluate(() => ({
    workers: window.__adapterAudit.workers.length,
    moduleToken: window.__adapterAudit.workers[0].moduleToken,
  }));
  await page.evaluate(() => window.__adapterAudit.releaseCompiles());
  await checked(page);
  await expect(connection(page)).toHaveAttribute('data-state', 'ready');
  const after = await page.evaluate(() => ({
    workers: window.__adapterAudit.workers,
    compileCalls: window.__adapterAudit.compileCalls,
  }));
  expect(accepted.workers).toBe(1);
  expect(after.compileCalls).toBe(2);
  expect(after.workers).toHaveLength(2);
  expect(after.workers[1].moduleToken).toBe(accepted.moduleToken);
  expect(after.workers.every((worker) => worker.terminated)).toBe(true);
});

test('the total deadline includes loading and a late resource cannot turn timeout into success', async ({
  page,
}) => {
  await observeAdapter(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const arrived = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let completed!: () => void;
  const finished = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route(wasmPattern, async (route) => {
    requested();
    await gate;
    await completeRoute(route);
    completed();
  });
  await page.goto(visualPath);
  await caseReady(page);
  await checkButton(page).click();
  await arrived;
  try {
    await expect(connection(page)).toHaveAttribute('data-state', 'timed-out', { timeout: 2500 });
    await expect(connection(page)).toContainText(/超时|超过|时限/);
    expect(await page.evaluate(() => window.__adapterAudit.workers.length)).toBe(0);
  } finally {
    release();
  }
  await finished;
  await page.unroute(wasmPattern);
  await expect(connection(page)).toHaveAttribute('data-state', 'timed-out');
  await checked(page);
  expect(await page.evaluate(() => window.__adapterAudit.compileCalls)).toBe(1);
});

test('cancelling or switching cases terminates an already created Worker and never exposes its old result', async ({
  page,
}) => {
  await observeAdapter(page);
  await page.goto(visualPath);
  await caseReady(page);
  for (const action of ['cancel', 'switch'] as const) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested!: () => void;
    const arrived = new Promise<void>((resolve) => {
      requested = resolve;
    });
    let completed!: () => void;
    const finished = new Promise<void>((resolve) => {
      completed = resolve;
    });
    await page.route(workerPattern, async (route) => {
      requested();
      await gate;
      await completeRoute(route);
      completed();
    });
    const before = await page.evaluate(() => window.__adapterAudit.workers.length);
    await checkButton(page).click();
    await arrived;
    await expect(connection(page)).toHaveAttribute('data-state', 'loading');
    expect(await page.evaluate(() => window.__adapterAudit.workers.length)).toBe(before + 1);
    try {
      if (action === 'cancel') {
        await connection(page).getByRole('button', { name: '取消检查' }).click();
        await expect(connection(page)).toHaveAttribute('data-state', 'cancelled');
      } else {
        await page.evaluate(() => {
          location.hash = '#/visualize/case.c.selection-sort';
        });
        await expect(page.locator('main h1')).toHaveText('选择排序');
        await expect(connection(page)).toHaveAttribute('data-state', 'idle');
      }
      expect(
        await page.evaluate(() =>
          window.__adapterAudit.workers.every((worker) => worker.terminated),
        ),
      ).toBe(true);
    } finally {
      release();
    }
    await finished;
    await page.unroute(workerPattern);
    await expect(connection(page)).toHaveAttribute(
      'data-state',
      action === 'cancel' ? 'cancelled' : 'idle',
    );
    await checked(page);
    expect(await page.evaluate(() => window.__adapterAudit.workers.length)).toBe(before + 2);
    expect(await page.evaluate(() => window.__adapterAudit.maximumActiveWorkers)).toBe(1);
    await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
    await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', '');
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
  }
  await noLearningWrites(page);
});
