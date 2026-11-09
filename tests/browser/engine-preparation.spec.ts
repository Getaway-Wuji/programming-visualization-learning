import { expect, test, type Page } from '@playwright/test';
import { expectEditorValue } from './editor-value';
import { waitForEnginePreparation } from './engine-preparation-helpers';

interface PreparationProof {
  delayPostsMs: number;
  workers: { url: string; at: number }[];
  posts: { at: number; remaining: number | null }[];
  responses: number;
  executionStarted: number | null;
  deadlineDisplayed: number | null;
  terminatedAt: number[];
}
declare global {
  interface Window {
    __preparationProof: PreparationProof;
    __heldPreparationCompile: { held: boolean; release: () => void };
  }
}

async function observeRealWorkers(page: Page) {
  await page.addInitScript(() => {
    window.__preparationProof = {
      delayPostsMs: 0,
      workers: [],
      posts: [],
      responses: 0,
      executionStarted: null,
      deadlineDisplayed: null,
      terminatedAt: [],
    };
    document.addEventListener(
      'click',
      (event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (window.__preparationProof.delayPostsMs && button?.textContent === '运行代码')
          window.__preparationProof.executionStarted = performance.now();
      },
      true,
    );
    new MutationObserver(() => {
      const proof = window.__preparationProof;
      if (
        proof.executionStarted !== null &&
        proof.deadlineDisplayed === null &&
        [...document.querySelectorAll('[role="alert"]')].some((alert) =>
          alert.textContent?.includes('运行超过时间限制'),
        )
      )
        proof.deadlineDisplayed = performance.now();
    }).observe(document, { childList: true, subtree: true, characterData: true });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        window.__preparationProof.workers.push({ url: String(url), at: performance.now() });
        this.addEventListener('message', () => window.__preparationProof.responses++);
      }
      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ) {
        const row =
          message && typeof message === 'object' ? (message as Record<string, unknown>) : {};
        const value = row.remaining ?? row.remainingMs;
        window.__preparationProof.posts.push({
          at: performance.now(),
          remaining: typeof value === 'number' ? value : null,
        });
        const send = () => {
          if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
          else super.postMessage(message, transferOrOptions);
        };
        const delay = window.__preparationProof.delayPostsMs;
        if (delay) setTimeout(send, delay);
        else send();
      }
      override terminate() {
        window.__preparationProof.terminatedAt.push(performance.now());
        super.terminate();
      }
    };
  });
}

async function expectNoLearningFacts(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = [
        'progress',
        'receipts',
        'ledger',
        'pythonActivities',
        'javaActivities',
        'cppActivities',
        'rustActivities',
        'mysqlActivities',
      ];
      const tx = db.transaction(names, 'readonly');
      return await Promise.all(
        names.map(
          (name) =>
            new Promise<number>((resolve, reject) => {
              const request = tx.objectStore(name).count();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
    } finally {
      db.close();
    }
  });
  expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
}

const source = {
  python: { text: 'print(2718)\n', label: 'Python 代码', run: '运行代码', output: 'python-output' },
  java: {
    text: 'public class Main { public static void main(String[] args) { System.out.println(2718); } }\n',
    label: 'Java 代码',
    run: '运行代码',
    output: 'java-output',
  },
  mysql: {
    text: 'SELECT 2718 AS result;\n',
    label: 'SQL 源码',
    run: '运行 SQL',
    output: 'mysql-result',
  },
} as const;

async function run2718(page: Page, language: keyof typeof source) {
  const scenario = source[language];
  await waitForEnginePreparation(page);
  const code = page.getByRole('textbox', { name: scenario.label, exact: true });
  await expect(code).toBeEditable();
  await code.fill(scenario.text);
  await expectEditorValue(code, scenario.text);
  await page.getByRole('button', { name: scenario.run, exact: true }).click();
  if (language === 'mysql')
    await expect(
      page.getByTestId(scenario.output).getByRole('cell', { name: '2718', exact: true }),
    ).toBeVisible();
  else await expect(page.getByTestId(scenario.output)).toHaveText('2718');
}

test('home and reading routes do not prepare or execute an engine', async ({ page }) => {
  await observeRealWorkers(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.wasm')) requests.push(request.url());
  });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: '继续学 C', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: 'MySQL 课程', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'MySQL 课程', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: '推荐下一步', exact: true })
    .getByRole('link', { name: '开始阅读', exact: true })
    .click();
  await expect(page.getByTestId('reading-end')).toBeAttached();
  await expect(page.getByTestId('engine-preparation')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => window.__preparationProof.workers)).toEqual([]);
});

test('the independent C repair provider waits for its route engine before automatic analysis', async ({
  page,
}) => {
  await observeRealWorkers(page);
  let release = () => {};
  let observed = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route('**/c_viz_wasm_bg-*.wasm', async (route) => {
    observed();
    await held;
    await route.continue();
  });
  try {
    await page.goto('/#/practice/exercise.c.bug-semicolon');
    await entered;
    await page.waitForTimeout(2000);
    const gate = page.getByTestId('engine-preparation');
    await expect(gate).toHaveAttribute('data-engine', 'c');
    await expect(gate).toHaveAttribute('data-state', 'loading');
    await expect(page.getByTestId('practice-execution')).toHaveCount(0);
    expect(await page.evaluate(() => window.__preparationProof.workers)).toEqual([]);
    await expectNoLearningFacts(page);
    release();
    await expect(gate).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
    await expect
      .poll(() => page.evaluate(() => window.__preparationProof.responses))
      .toBeGreaterThan(0);
    await expectNoLearningFacts(page);
  } finally {
    release();
  }
});

for (const [language, duration] of [
  ['python', 1800],
  ['mysql', 2400],
] as const) {
  test(`${language} keeps a delayed real WASM download in explicit preparation without execution or rewards`, async ({
    page,
  }) => {
    await observeRealWorkers(page);
    let release = () => {};
    let observed = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      observed = resolve;
    });
    await page.route(
      language === 'python' ? '**/c_viz_python3_bg-*.wasm' : '**/c_viz_mysql_bg-*.wasm',
      async (route) => {
        observed();
        await held;
        await route.continue();
      },
    );
    try {
      await page.goto('/#/' + language + '/workbench');
      await entered;
      await page.waitForTimeout(duration);
      const gate = page.getByTestId('engine-preparation');
      await expect(gate).toHaveAttribute('data-engine', language);
      await expect(gate).toHaveAttribute('data-state', 'loading');
      await expect(gate.getByRole('status')).toContainText('当前尚未开始运行程序');
      await expect(
        page.getByRole('textbox', { name: source[language].label, exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: source[language].run, exact: true }),
      ).toHaveCount(0);
      await expect(page.getByTestId(source[language].output)).toHaveCount(0);
      expect(await page.evaluate(() => window.__preparationProof.workers)).toEqual([]);
      await expectNoLearningFacts(page);
      release();
      await run2718(page, language);
    } finally {
      release();
    }
  });
}

test('navigation cancels an older preparation and its late response cannot ready another language', async ({
  page,
}) => {
  await observeRealWorkers(page);
  await page.addInitScript(() => {
    window.__heldPreparationCompile = { held: false, release: () => {} };
    const compile = WebAssembly.compile.bind(WebAssembly);
    let holdNext = true;
    WebAssembly.compile = async (bytes) => {
      if (!holdNext) return compile(bytes);
      holdNext = false;
      // The real module compiles successfully; only its non-abortable promise delivery is held.
      const module = await compile(bytes);
      await new Promise<void>((resolve) => {
        window.__heldPreparationCompile.release = resolve;
        window.__heldPreparationCompile.held = true;
      });
      return module;
    };
  });
  let releaseJava = () => {};
  let observedJava = () => {};
  const heldJava = new Promise<void>((resolve) => {
    releaseJava = resolve;
  });
  const enteredJava = new Promise<void>((resolve) => {
    observedJava = resolve;
  });
  await page.route('**/c_viz_java_bg-*.wasm', async (route) => {
    observedJava();
    await heldJava;
    await route.continue();
  });
  try {
    await page.goto('/#/python/workbench');
    await expect.poll(() => page.evaluate(() => window.__heldPreparationCompile.held)).toBe(true);
    await expect(page.getByTestId('engine-preparation')).toHaveAttribute('data-state', 'loading');
    await page
      .getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('link', { name: 'Java 课程', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Java 学习', exact: true })
      .getByRole('link', { name: '工作台', exact: true })
      .click();
    await enteredJava;
    await expect(page.getByTestId('engine-preparation')).toHaveAttribute('data-engine', 'java');
    await page.evaluate(() => window.__heldPreparationCompile.release());
    await page.waitForTimeout(300);
    await expect(page.getByTestId('engine-preparation')).toHaveAttribute('data-state', 'loading');
    await expect(page.getByRole('textbox', { name: 'Java 代码', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Python 代码', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.__preparationProof.workers)).toEqual([]);
    await expectNoLearningFacts(page);
    releaseJava();
    await run2718(page, 'java');
  } finally {
    await page.evaluate(() => window.__heldPreparationCompile.release());
    releaseJava();
  }
});

test('a failed preparation keeps execution unavailable and retries the actual resource explicitly', async ({
  page,
}) => {
  await observeRealWorkers(page);
  let attempts = 0;
  await page.route('**/c_viz_python3_bg-*.wasm', async (route) => {
    attempts++;
    if (attempts === 1)
      await route.fulfill({
        status: 503,
        contentType: 'application/wasm',
        body: 'temporarily unavailable',
      });
    else await route.continue();
  });
  await page.goto('/#/python/workbench');
  const gate = page.getByTestId('engine-preparation');
  await expect(gate).toHaveAttribute('data-state', 'failed');
  await expect(gate.getByRole('alert')).toContainText('执行资源未能完整下载或校验');
  await expect(page.getByRole('textbox', { name: 'Python 代码', exact: true })).toHaveCount(0);
  await expectNoLearningFacts(page);
  expect(await page.evaluate(() => window.__preparationProof.workers)).toEqual([]);
  expect(attempts).toBe(1);
  await page.getByRole('button', { name: '重试加载', exact: true }).click();
  await run2718(page, 'python');
  expect(attempts).toBe(2);
});

test('after preparation a genuinely delayed Worker still hits the unchanged 1000ms execution deadline', async ({
  page,
}, info) => {
  await observeRealWorkers(page);
  await page.goto('/#/python/workbench');
  await waitForEnginePreparation(page);
  const code = page.getByRole('textbox', { name: 'Python 代码', exact: true });
  await expect(code).toBeEditable();
  await code.fill(source.python.text);
  await page.evaluate(() => {
    window.__preparationProof.delayPostsMs = 1300;
  });
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '运行超过时间限制' })).toBeVisible();
  const proof = await page.evaluate(() => window.__preparationProof);
  await info.attach('actual-worker-deadline', {
    body: JSON.stringify(proof),
    contentType: 'application/json',
  });
  expect(proof.executionStarted).not.toBeNull();
  expect(proof.deadlineDisplayed).not.toBeNull();
  const elapsed = proof.deadlineDisplayed! - proof.executionStarted!;
  expect(elapsed).toBeGreaterThanOrEqual(900);
  expect(elapsed).toBeLessThan(1800);
  expect(proof.posts.length).toBeGreaterThan(0);
  expect(proof.posts[0].remaining).toBeGreaterThan(0);
  expect(proof.posts[0].remaining).toBeLessThanOrEqual(1000);
  expect(proof.terminatedAt).toHaveLength(1);
  // The actual Worker must stop before the intentionally delayed 1300ms message is sent.
  expect(proof.terminatedAt[0] - proof.executionStarted!).toBeGreaterThanOrEqual(900);
  expect(proof.terminatedAt[0] - proof.executionStarted!).toBeLessThan(1300);
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => window.__preparationProof.responses)).toBe(0);
  await expect(page.getByTestId('python-output')).toHaveCount(0);
  await expectNoLearningFacts(page);
  await page.evaluate(() => {
    window.__preparationProof.delayPostsMs = 0;
  });
  await run2718(page, 'python');
});

test('switching compiled engine owners revalidates the previous engine and does not borrow another language module', async ({
  page,
}) => {
  await observeRealWorkers(page);
  page.on('dialog', (dialog) => dialog.accept());
  const downloads: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('.wasm')) downloads.push(path);
  });
  await page.goto('/#/python/workbench');
  await run2718(page, 'python');
  expect(downloads.filter((path) => path.includes('c_viz_python3_bg-'))).toHaveLength(1);
  for (const language of ['java', 'python'] as const) {
    const label = language === 'java' ? 'Java' : 'Python';
    await page
      .getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('link', { name: label + ' 课程', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: label + ' 学习', exact: true })
      .getByRole('link', { name: '工作台', exact: true })
      .click();
    await expect(page.getByTestId('engine-preparation')).toHaveAttribute('data-engine', language);
    await run2718(page, language);
  }
  expect(downloads.filter((path) => path.includes('c_viz_python3_bg-'))).toHaveLength(2);
  expect(downloads.filter((path) => path.includes('c_viz_java_bg-'))).toHaveLength(1);
});
