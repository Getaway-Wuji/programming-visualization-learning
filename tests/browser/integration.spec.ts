import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { APIResponse, Page, Response } from '@playwright/test';
import type { ContentPackage } from '../../web/src/content/types';
import type { CaseExecutionCatalog } from '../../web/src/content/case-learning';
import { openBlockKeyboardEditor } from './block-ui';
import type { C6TeachingNode } from '../../web/src/content/c6-teaching-types';
import { currentSnapshot, currentLocalReady } from './current-practice-observation';
import { C6_RESET_STORES, C6_RESET_CLEAR_STORES } from '../../web/src/storage/c6-reset';
import { openIndependentEchoRepair } from './current-course-helpers';

const wasmPattern = /\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/;
const frozenBytes = readFileSync(
  new URL('../../shared/contracts/02.1-内容样例.json', import.meta.url),
);
const teaching = JSON.parse(
  readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8'),
) as {
  chapters: { nodes: C6TeachingNode[] }[];
};
const currentLesson = teaching.chapters
  .flatMap((c) => c.nodes)
  .find((n) => n.sourceNodeId === 'c6.s2.1')!;
const reviewedCases = JSON.parse(
  readFileSync(
    new URL('../../content/c/primer6-learning/cases-1.0.0.json', import.meta.url),
    'utf8',
  ),
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
    await expect(
      pageId.startsWith('C6-')
        ? page.locator('.c6-course-page, .c6-workbench').first()
        : page.locator(`[data-page-id="${pageId}"]`),
    ).toBeVisible();
    await expect(page.locator('main h1')).toBeVisible();
    const url = new URL(page.url());
    expect(url.search).toBe('');
    expect(url.hash || '#/').toBe(`#${path}`);
    routes.push({ pageId, hash: url.hash || '#/' });
  };
  const algorithmCatalog = reviewedCases.catalogs.find(
    (item) => item.subject.id === 'case.c.bubble-sort',
  )!;
  const algorithm = algorithmCatalog.subject;
  const algorithmProgram = algorithmCatalog.program;

  await page.goto('/');
  await routeReady('C6-HOME', '/');
  expect(requests.some((entry) => wasmPattern.test(new URL(entry.url).pathname))).toBe(false);
  expect(await page.evaluate(() => window.__integrationObservation.workers.length)).toBe(0);
  await expect(page.getByRole('link', { name: /登录|注册|排行榜/ })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: 'C 语言课程' })
    .click();
  await routeReady('C6-DIRECTORY', '/courses');
  const fetchedBytes = await publicSampleResponse.body();
  expect(fetchedBytes.equals(frozenBytes)).toBe(true);
  const fetched = JSON.parse(fetchedBytes.toString('utf8')) as ContentPackage;
  expect(fetched).toMatchObject({
    purpose: 'contract-fixture',
    contractVersion: '1.0.0',
    packageVersion: '1.0.0',
    packageId: 'content.c.p0',
  });
  await currentLocalReady(page);
  await expect(page.getByRole('region', { name: '正文章节' }).getByRole('link')).toHaveCount(17);
  await expect(page.getByRole('region', { name: '参考资料' }).getByRole('link')).toHaveCount(2);
  await page.locator('a[href="#/courses/c6.ch02"]').click();
  await routeReady('C6-CHAPTER', '/courses/c6.ch02');
  await page.locator('a[href="#/lessons/lesson.c6.s2.1"]').click();
  await routeReady('C6-READING', '/lessons/lesson.c6.s2.1');
  await page
    .getByRole('navigation', { name: '当前位置' })
    .getByRole('link', { name: '课程目录', exact: true })
    .click();
  await routeReady('C6-DIRECTORY', '/courses');
  await page.goBack();
  await routeReady('C6-READING', '/lessons/lesson.c6.s2.1');
  await page.goForward();
  await routeReady('C6-DIRECTORY', '/courses');
  await page.goBack();
  await routeReady('C6-READING', '/lessons/lesson.c6.s2.1');
  const lessonSample = page.locator('.c6-teaching-reading');
  await expect(lessonSample).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(currentLesson.titleDisplay);
  const rendered = await lessonSample.locator('pre code').allTextContents();
  const fences = [...currentLesson.body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
  expect(fences.length).toBeGreaterThan(0);
  for (const fence of fences)
    expect(rendered.some((text) => text.trim() === fence[1].trim())).toBe(true);
  await expect(page.getByRole('button', { name: '我已读完本节', exact: true })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath('integrated-lesson-reference.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: '完成配套执行练习', exact: true }).click();
  await routeReady('C6-PRACTICE', '/practice/exercise.c6.s2.1');
  await expect(page.getByLabel('完整 C 源码 · main.c', { exact: true })).toBeEditable();
  await expect(page.getByRole('button', { name: '判定全部四组', exact: true })).toBeEnabled();
  await expect(page.getByTestId('engine-connection')).toHaveCount(0);
  const passivePractice = await page.evaluate(() => window.__integrationObservation);
  expect(passivePractice.compileCalls).toBe(0);
  expect(passivePractice.workers).toEqual([]);
  expect(requests.filter((entry) => wasmPattern.test(new URL(entry.url).pathname))).toHaveLength(0);
  // Native editing intentionally creates editor history. Keep that explicit
  // branch isolated from the main passive browsing/build-probe archive.
  const repairContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const repairPage = await repairContext.newPage();
  const repairRequests: typeof requests = [];
  repairPage.on('request', (request) =>
    repairRequests.push({
      url: request.url(),
      method: request.method(),
      hasBody: request.postData() !== null,
    }),
  );
  await observeIntegration(repairPage);
  await openIndependentEchoRepair(repairPage);
  const practiceSample = repairPage.getByTestId('practice-execution');
  await expect(practiceSample).toHaveAttribute('data-state', 'ready');
  const blocks = practiceSample.getByRole('region', { name: '积木工作区', exact: true });
  await repairPage.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('show');
  await openBlockKeyboardEditor(repairPage);
  await expect(
    blocks.getByRole('combobox', { name: '添加积木类型', exact: true }).locator('option'),
  ).toHaveCount(20);
  await expect(blocks.getByRole('combobox', { name: '积木列表', exact: true })).toBeVisible();
  await expect(blocks.locator('.blocklySvg')).toBeVisible();
  await expect(
    repairPage.getByRole('textbox', { name: '编辑 C 代码', exact: true }),
  ).not.toHaveValue('');
  await expect(repairPage.getByRole('button', { name: '准备代码', exact: true })).toBeEnabled();
  await expect(repairPage.getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
  const editObservation = await repairPage.evaluate(() => window.__integrationObservation);
  expect(editObservation.workers.length).toBeGreaterThan(0);
  for (const worker of editObservation.workers) {
    expect(['prepare-case', 'analyze-code']).toContain(worker.requestKind);
    expect(worker.terminated).toBe(true);
    expect(worker.resultKeys).not.toContain('trace');
    expect(worker.resultKeys).not.toContain('judgeResult');
  }
  await repairPage.getByRole('link', { name: '查看本次复盘', exact: true }).click();
  await expect(repairPage).toHaveURL(/#\/practice\/exercise\.c\.bug-semicolon\/review$/);
  await expect(repairPage.getByTestId('engine-connection')).toHaveCount(0);
  await expect(repairPage.getByTestId('practice-feedback')).toContainText('还没有可复盘的运行');
  await expect(repairPage.getByTestId('code-panel')).toHaveCount(0);
  await expect(repairPage.getByTestId('animation-panel')).toHaveCount(0);
  await expect(repairPage.getByRole('button', { name: '播放', exact: true })).toHaveCount(0);
  expect((await repairPage.evaluate(() => window.__integrationObservation)).workers).toEqual(
    editObservation.workers,
  );
  await repairPage.screenshot({
    path: testInfo.outputPath('integrated-empty-review.png'),
    fullPage: true,
  });
  await repairPage.getByRole('link', { name: '返回练习工作区', exact: true }).click();
  await expect(practiceSample).toHaveAttribute('data-state', 'ready');
  await expect(repairPage.getByTestId('engine-connection')).toHaveCount(0);
  const edited = (await currentSnapshot(repairPage)) as unknown as Record<string, unknown>;
  for (const name of C6_RESET_CLEAR_STORES.filter((name) => name !== 'editHistory'))
    expect(edited[name]).toEqual([]);
  const histories = edited.editHistory as { scope: { exerciseRef: { id: string } } }[];
  expect(histories.length).toBeGreaterThan(0);
  for (const history of histories)
    expect(history.scope.exerciseRef.id).toBe('exercise.c.bug-semicolon');
  await testInfo.attach('isolated-native-edit-and-empty-review', {
    body: JSON.stringify({ repairRequests, editObservation, edited }),
    contentType: 'application/json',
  });
  await repairContext.close();

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
  await currentLocalReady(page);
  const archive = await currentSnapshot(page);
  expect(Object.keys(archive).sort()).toEqual([...C6_RESET_STORES].sort());
  expect(archive.meta.dbVersion).toBe(10);
  for (const name of C6_RESET_CLEAR_STORES)
    expect((archive as unknown as Record<string, unknown>)[name]).toEqual([]);
  await expect(page.getByTestId('engine-connection')).toHaveCount(0);
  verifyProbes(await page.evaluate(() => window.__integrationObservation), 1);
  expect(pageErrors).toEqual([]);
  const origin = new URL(page.url()).origin;
  for (const request of [...requests, ...repairRequests]) {
    const url = new URL(request.url);
    expect(url.origin).toBe(origin);
    expect(url.search).toBe('');
    expect(request.method).toBe('GET');
    expect(request.hasBody).toBe(false);
    expect(url.pathname).not.toMatch(
      /\/(?:execute|submission|reward|progress|login|session)(?:\/|$)/i,
    );
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
