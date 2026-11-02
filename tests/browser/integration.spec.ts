import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { APIResponse, Page, Response } from '@playwright/test';
import type { ContentPackage } from '../../web/src/content/types';
import type { CaseExecutionCatalog } from '../../web/src/content/case-learning';
import { openBlockKeyboardEditor } from './block-ui';

const wasmPattern = /\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/;
const frozenBytes = readFileSync(
  new URL('../../shared/contracts/02.1-内容样例.json', import.meta.url),
);
const frozen = JSON.parse(frozenBytes.toString('utf8')) as ContentPackage;
const reviewedCourse = JSON.parse(
  readFileSync(new URL('../../content/c/p0/course-1.0.1.json', import.meta.url), 'utf8'),
) as ContentPackage;
const reviewedCases = JSON.parse(
  readFileSync(new URL('../../content/c/p0/case-view-1.0.1.json', import.meta.url), 'utf8'),
) as { catalogs: CaseExecutionCatalog[] };

interface IntegratedProbe {
  url: string;
  terminated: boolean;
  moduleToken: number;
  requestKeys: string[];
  requestKind?: string;
  checkId?: string;
  nonce?: number;
  workerInstanceId?: string;
  maximumPages?: number;
  resultKeys: string[];
  build?: {
    kind: string;
    probeVersion: string;
    engineVersion: string;
    nonce: number;
    interpreterReady: boolean;
  };
}

interface IntegrationObservation {
  compileCalls: number;
  storageWrites: number;
  databaseOpens: number;
  databaseNames: string[];
  securityPolicyViolations: number;
  maximumActiveWorkers: number;
  workers: IntegratedProbe[];
}

declare global {
  interface Window {
    __integrationObservation: IntegrationObservation;
  }
}

// Passive observations of native compilation and the real production Worker.
// Every observed buffer comes from Rust; this test never supplies a response.
async function observeIntegration(page: Page) {
  await page.addInitScript(() => {
    const observation: IntegrationObservation = {
      compileCalls: 0,
      storageWrites: 0,
      databaseOpens: 0,
      databaseNames: [],
      securityPolicyViolations: 0,
      maximumActiveWorkers: 0,
      workers: [],
    };
    window.__integrationObservation = observation;
    document.addEventListener('securitypolicyviolation', () => {
      observation.securityPolicyViolations += 1;
    });
    const modules: WebAssembly.Module[] = [];
    const nativeCompile = WebAssembly.compile.bind(WebAssembly);
    WebAssembly.compile = (bytes: BufferSource) => {
      observation.compileCalls += 1;
      return nativeCompile(bytes);
    };
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      observation.storageWrites += 1;
      nativeSetItem.call(this, key, value);
    };
    const nativeOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name: string, version?: number) => {
      observation.databaseOpens += 1;
      observation.databaseNames.push(name);
      return nativeOpen(name, version);
    };

    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private probe: IntegratedProbe;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.probe = {
          url: String(url),
          terminated: false,
          moduleToken: 0,
          requestKeys: [],
          resultKeys: [],
        };
        observation.workers.push(this.probe);
        observation.maximumActiveWorkers = Math.max(
          observation.maximumActiveWorkers,
          observation.workers.filter((worker) => !worker.terminated).length,
        );
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (typeof event.data !== 'object' || event.data === null) return;
          const value = event.data as Record<string, unknown>;
          if (typeof value.workerInstanceId === 'string')
            this.probe.workerInstanceId = value.workerInstanceId;
          if (typeof value.maximumPages === 'number') this.probe.maximumPages = value.maximumPages;
          if (!(value.buffer instanceof ArrayBuffer)) return;
          const decoded: unknown = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(value.buffer),
          );
          if (typeof decoded !== 'object' || decoded === null) return;
          this.probe.resultKeys = Object.keys(decoded).sort();
          this.probe.build = decoded as IntegratedProbe['build'];
        });
      }

      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        if (typeof message === 'object' && message !== null) {
          const value = message as Record<string, unknown>;
          this.probe.requestKeys = Object.keys(value).sort();
          if (typeof value.kind === 'string') this.probe.requestKind = value.kind;
          if (typeof value.checkId === 'string') this.probe.checkId = value.checkId;
          if (typeof value.nonce === 'number') this.probe.nonce = value.nonce;
          if (value.module instanceof WebAssembly.Module) {
            let position = modules.indexOf(value.module);
            if (position === -1) position = modules.push(value.module) - 1;
            this.probe.moduleToken = position + 1;
          }
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }

      terminate() {
        this.probe.terminated = true;
        super.terminate();
      }
    };
  });
}

async function readySample(page: Page, scope: 'fixture' | 'case-view' = 'case-view') {
  const sample = page.getByTestId('content-sample');
  await expect(sample).toHaveAttribute('data-state', 'ready');
  if (scope === 'case-view') {
    await expect(sample).toHaveAttribute('data-content-scope', 'case-view');
    await expect(sample).toContainText('已审核案例 · 独立观看');
    await expect(sample).toContainText(`内容版本 ${reviewedCases.catalogs[0].packageRef.version}`);
  } else {
    await expect(sample).toContainText('标准内容样例 · 尚未正式发布');
    await expect(sample).toContainText('内容版本 1.0.0');
  }
  await expect(sample.locator('textarea, [contenteditable="true"]')).toHaveCount(0);
  return sample;
}

async function checkModule(page: Page) {
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  const connection = page.getByTestId('engine-connection');
  await expect(connection).toHaveAttribute('data-state', /^(?:idle|ready)$/);
  await connection.getByRole('button', { name: '检查执行模块', exact: true }).click();
  await expect(connection).toHaveAttribute('data-state', 'ready');
  await expect(connection).toContainText('构建检查不执行 C');
  await expect(connection).toContainText('案例页可运行内容样例');
}

function verifyProbes(observation: IntegrationObservation, count: number) {
  expect(observation.compileCalls).toBe(1);
  expect(observation.storageWrites).toBe(0);
  expect(observation.databaseOpens).toBeGreaterThan(0);
  expect(observation.databaseNames.every((name) => name === 'c-viz-learning')).toBe(true);
  expect(observation.securityPolicyViolations).toBe(0);
  expect(observation.maximumActiveWorkers).toBe(1);
  expect(observation.workers).toHaveLength(count);
  expect(new Set(observation.workers.map((worker) => worker.workerInstanceId)).size).toBe(count);
  expect(new Set(observation.workers.map((worker) => worker.checkId)).size).toBe(count);
  for (const worker of observation.workers) {
    expect(worker.url).toMatch(/\/assets\/probe\.worker-[^/]+\.js$/);
    expect(worker.terminated).toBe(true);
    expect(worker.moduleToken).toBe(1);
    expect(worker.workerInstanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(worker.checkId).toMatch(/^[0-9a-f-]{36}$/);
    expect(worker.maximumPages).toBe(2048);
    expect(worker.requestKeys).toEqual(['checkId', 'kind', 'module', 'nonce']);
    expect(worker.requestKind).toBe('build-check');
    expect(worker.resultKeys).toEqual([
      'engineVersion',
      'interpreterReady',
      'kind',
      'nonce',
      'probeVersion',
    ]);
    expect(worker.build).toEqual({
      kind: 'build-probe',
      probeVersion: '1.0.0',
      engineVersion: '0.1.0',
      nonce: worker.nonce,
      interpreterReady: false,
    });
  }
}

async function inspectHeaders(
  response: APIResponse | Response,
  mime: RegExp,
  cache: 'no-cache' | 'public, max-age=31536000, immutable',
) {
  const headers = await response.headers();
  expect(response.status()).toBe(200);
  expect(headers['content-type']).toMatch(mime);
  expect(headers['cache-control']).toBe(cache);
  expect(headers['x-content-type-options']).toBe('nosniff');
  const policy = headers['content-security-policy'];
  expect(policy).toBeTruthy();
  const directives = new Map(
    policy.split(';').map((entry) => {
      const [name, ...values] = entry.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
  expect(directives.get('default-src')).toEqual(["'none'"]);
  expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  expect(directives.get('script-src')).not.toContain("'unsafe-eval'");
  expect(directives.get('worker-src')).toEqual(["'self'"]);
  expect(directives.get('connect-src')).toEqual(["'self'"]);
  for (const directive of ['base-uri', 'object-src', 'frame-ancestors', 'form-action']) {
    expect(directives.get(directive)).toEqual(["'none'"]);
  }
  return {
    url: response.url(),
    status: response.status(),
    mime: headers['content-type'],
    cache: headers['cache-control'],
    nosniff: headers['x-content-type-options'],
    policy,
  };
}

test('continuous public learning navigation integrates reviewed reading, validated samples and real Rust module checks without passive learning writes', async ({
  page,
  browser,
  request,
}, testInfo) => {
  await observeIntegration(page);
  const headerChecks: Awaited<ReturnType<typeof inspectHeaders>>[] = [];
  headerChecks.push(
    await inspectHeaders(await request.get('/'), /^text\/html(?:;|$)/i, 'no-cache'),
  );
  const publicSampleResponse = await request.get('/content/sample/02.1-content-1.0.0.json');
  headerChecks.push(
    await inspectHeaders(publicSampleResponse, /^application\/json(?:;|$)/i, 'no-cache'),
  );
  const manifestResponse = await request.get('/content/sample/manifest.json');
  headerChecks.push(
    await inspectHeaders(manifestResponse, /^application\/json(?:;|$)/i, 'no-cache'),
  );
  expect(await manifestResponse.json()).toMatchObject({
    purpose: 'contract-fixture',
    publicationVerified: false,
    rustCValidation: false,
  });
  const requests: { url: string; method: string; hasBody: boolean }[] = [];
  const pageErrors: string[] = [];
  const routes: { pageId: string; hash: string }[] = [];
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      hasBody: request.postData() !== null,
    }),
  );
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const routeReady = async (pageId: string, path: string) => {
    await expect(page.locator(`[data-page-id="${pageId}"]`)).toBeVisible();
    await expect(page.locator('main h1')).toBeVisible();
    const url = new URL(page.url());
    expect(url.search).toBe('');
    expect(url.hash || '#/').toBe(`#${path}`);
    routes.push({ pageId, hash: url.hash || '#/' });
  };
  const lesson = reviewedCourse.lessons.find((item) => item.id === 'lesson.c.variables-output')!;
  const exercise = reviewedCourse.exercises.find((item) => item.id === 'exercise.c.echo')!;
  const example = frozen.programs.find((item) => item.id === 'program.c.echo')!;
  const algorithmCatalog = reviewedCases.catalogs.find(
    (item) => item.subject.id === 'case.c.bubble-sort',
  )!;
  const algorithm = algorithmCatalog.subject;
  const algorithmProgram = algorithmCatalog.program;

  await page.goto('/');
  await routeReady('PAGE-01', '/');
  expect(requests.some((entry) => wasmPattern.test(new URL(entry.url).pathname))).toBe(false);
  expect(await page.evaluate(() => window.__integrationObservation.workers.length)).toBe(0);
  await expect(page.getByRole('link', { name: /登录|注册|排行榜/ })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: 'C 语言课程' })
    .click();
  await routeReady('PAGE-02', '/courses');
  const fetchedBytes = await publicSampleResponse.body();
  expect(fetchedBytes.equals(frozenBytes)).toBe(true);
  const fetched = JSON.parse(fetchedBytes.toString('utf8')) as ContentPackage;
  expect(fetched).toMatchObject({
    purpose: 'contract-fixture',
    contractVersion: '1.0.0',
    packageVersion: '1.0.0',
    packageId: 'content.c.p0',
  });
  await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');

  // The catalog links to lessons; their breadcrumb provides the chapter route.
  await page.locator('[data-course-lesson] a[href="#/lessons/lesson.c.variables-output"]').click();
  await routeReady('PAGE-03', '/lessons/lesson.c.variables-output');
  await page
    .getByRole('navigation', { name: '当前位置' })
    .getByRole('link', { name: '变量与表达式' })
    .click();
  await routeReady('PAGE-02', '/courses/chapter.c.values');
  await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('[data-course-lesson]')).toHaveCount(2);
  await page.goBack();
  await routeReady('PAGE-03', '/lessons/lesson.c.variables-output');
  await page.goForward();
  await routeReady('PAGE-02', '/courses/chapter.c.values');
  await page.locator('[data-course-lesson] a[href="#/lessons/lesson.c.variables-output"]').click();
  await routeReady('PAGE-03', '/lessons/lesson.c.variables-output');
  const lessonSample = page.getByTestId('lesson-reading');
  await expect(lessonSample).toHaveAttribute('data-state', 'ready');
  for (const objective of lesson.teaching.objectives)
    await expect(lessonSample).toContainText(objective);
  for (const prose of lesson.teaching.explanation
    .split('```')
    .filter((_, index) => index % 2 === 0)) {
    if (prose.trim()) await expect(lessonSample).toContainText(prose);
  }
  expect(await lessonSample.getByLabel(`${example.title}参考源码`).textContent()).toBe(
    example.sourceExample,
  );
  await expect(page.getByRole('button', { name: '确认已学习', exact: true })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath('integrated-lesson-reference.png'),
    fullPage: true,
  });

  await page.getByRole('link', { name: '进入练习工作区', exact: true }).click();
  await routeReady('PAGE-04', '/practice/exercise.c.echo');
  const practiceSample = page.getByTestId('practice-execution');
  await expect(practiceSample).toHaveAttribute('data-state', 'ready');
  await expect(practiceSample).toContainText(exercise.prompt);
  const blocks = practiceSample.getByRole('region', { name: '积木工作区', exact: true });
  await expect(blocks).toBeVisible();
  await openBlockKeyboardEditor(page);
  await expect(
    blocks.getByRole('combobox', { name: '添加积木类型', exact: true }).locator('option'),
  ).toHaveCount(20);
  await expect(blocks.getByRole('combobox', { name: '积木列表', exact: true })).toBeVisible();
  await expect(blocks.locator('.blocklySvg')).toBeVisible();
  await expect(page.getByTestId('code-panel')).toBeVisible();
  await expect(page.getByTestId('code-panel').locator('textarea')).not.toHaveValue('');
  await expect(page.getByRole('button', { name: '准备代码', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
  await expect(page.getByTestId('engine-connection')).toHaveCount(0);
  const passivePractice = await page.evaluate(() => window.__integrationObservation);
  expect(passivePractice.compileCalls).toBe(0);
  expect(passivePractice.workers).toEqual([]);
  expect(requests.filter((entry) => wasmPattern.test(new URL(entry.url).pathname))).toHaveLength(0);

  await page.getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await routeReady('PAGE-06', '/practice/exercise.c.echo/review');
  await expect(page.getByTestId('engine-connection')).toHaveCount(0);
  await expect(page.getByTestId('practice-feedback')).toContainText('还没有可复盘的运行');
  await expect(page.getByTestId('code-panel')).toHaveCount(0);
  await expect(page.getByTestId('animation-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__integrationObservation.workers.length)).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath('integrated-empty-review.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
  await routeReady('PAGE-04', '/practice/exercise.c.echo');
  await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('engine-connection')).toHaveCount(0);

  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '算法与演示' })
    .click();
  await routeReady('PAGE-05', '/cases');
  await readySample(page, 'fixture');
  await page.locator('main a[href="#/visualize/case.c.bubble-sort"]').click();
  await routeReady('PAGE-06', '/visualize/case.c.bubble-sort');
  const caseSample = await readySample(page);
  for (const objective of algorithm.teaching.objectives)
    await expect(caseSample).toContainText(objective);
  await expect(caseSample).toContainText(algorithm.teaching.explanation);
  expect(await caseSample.locator('pre').first().textContent()).toBe(
    algorithmProgram.sourceExample,
  );
  await expect(page.getByTestId('code-panel').locator('textarea')).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('code-panel').locator('textarea')).not.toHaveValue('');
  await expect(page.getByRole('button', { name: '运行示例', exact: true })).toBeEnabled();
  await expect(page.getByTestId('input-panel')).toBeVisible();
  for (const label of ['播放', '前进', '后退', '重播']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
  }
  await checkModule(page);
  const cold = await page.evaluate(() => window.__integrationObservation);
  verifyProbes(cold, 1);
  expect(requests.filter((entry) => wasmPattern.test(new URL(entry.url).pathname))).toHaveLength(1);
  await checkModule(page);
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', '');
  const warm = await page.evaluate(() => window.__integrationObservation);
  verifyProbes(warm, 2);
  expect(requests.filter((entry) => wasmPattern.test(new URL(entry.url).pathname))).toHaveLength(1);
  const wasmUrl = requests.find((entry) => wasmPattern.test(new URL(entry.url).pathname))!.url;
  expect(wasmUrl).toMatch(/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.wasm$/);
  headerChecks.push(
    await inspectHeaders(
      await request.get(wasmUrl),
      /^application\/wasm(?:;|$)/i,
      'public, max-age=31536000, immutable',
    ),
  );
  const mainScripts = await page
    .locator('script[src]')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).src));
  expect(mainScripts.length).toBeGreaterThan(0);
  for (const scriptUrl of new Set([...mainScripts, warm.workers[0].url])) {
    expect(scriptUrl).toMatch(/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.js$/);
    headerChecks.push(
      await inspectHeaders(
        await request.get(scriptUrl),
        /^(?:text|application)\/javascript(?:;|$)/i,
        'public, max-age=31536000, immutable',
      ),
    );
  }

  await page.reload();
  await routeReady('PAGE-06', '/visualize/case.c.bubble-sort');
  await readySample(page);
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', '');
  expect(await page.evaluate(() => window.__integrationObservation.workers.length)).toBe(0);
  await checkModule(page);
  const refreshed = await page.evaluate(() => window.__integrationObservation);
  verifyProbes(refreshed, 1);
  expect(refreshed.workers[0].workerInstanceId).not.toBe(warm.workers[1].workerInstanceId);
  expect(requests.filter((entry) => wasmPattern.test(new URL(entry.url).pathname))).toHaveLength(2);
  await page.screenshot({
    path: testInfo.outputPath('integrated-case-reference-and-probe.png'),
    fullPage: true,
  });

  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '本地设置' })
    .click();
  await routeReady('PAGE-07', '/settings');
  await page.getByRole('tab', { name: '本地数据', exact: true }).click();
  // The recovery/clear flow is available; navigation itself still writes no facts.
  await expect(page.getByRole('button', { name: '清除本地数据', exact: true })).toBeEnabled();
  await expect(page.getByRole('tabpanel')).toContainText('学习档案保存在当前浏览器');
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('c-viz-learning', 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const names = ['progress', 'dailyFacts', 'goals', 'ledger', 'receipts', 'aliases'];
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
      return { storeNames: Array.from(db.objectStoreNames).sort(), businessCounts };
    } finally {
      db.close();
    }
  });
  expect(counts.storeNames).toEqual([
    'aliases',
    'appearance',
    'appearanceAssets',
    'avatar',
    'dailyFacts',
    'goals',
    'ledger',
    'meta',
    'progress',
    'receipts',
    'settings',
  ]);
  expect(counts.businessCounts).toEqual([0, 0, 0, 0, 0, 0]);
  await expect(page.getByTestId('engine-connection')).toHaveCount(0);
  verifyProbes(await page.evaluate(() => window.__integrationObservation), 1);
  expect(pageErrors).toEqual([]);
  const origin = new URL(page.url()).origin;
  for (const request of requests) {
    const url = new URL(request.url);
    expect(url.origin).toBe(origin);
    expect(url.search).toBe('');
    expect(request.method).toBe('GET');
    expect(request.hasBody).toBe(false);
    expect(url.pathname).not.toMatch(/execute|submission|reward|progress|login|session/i);
  }
  await testInfo.attach('browser-version', { body: browser.version(), contentType: 'text/plain' });
  await testInfo.attach('continuous-integration-observations', {
    body: JSON.stringify(
      {
        routes,
        requests,
        headerChecks,
        content: {
          purpose: fetched.purpose,
          contractVersion: fetched.contractVersion,
          packageVersion: fetched.packageVersion,
          originalBytesMatched: true,
        },
        cold,
        passivePractice,
        warm,
        refreshed,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
