import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { ready, code, panel, observeCaseSetExecution } from './notebook-helpers';
import { openIndependentRepair as openAnswer } from './current-course-helpers';
import { observedCaseSetExecute } from './case-set-observation';
declare global {
  interface Window {
    practiceQA: { requests: unknown[]; responses: unknown[]; timings: number[] };
  }
}
const folder = `.artifacts/19.2/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const root = (p: Page) => p.getByTestId('generated-practice'),
  editor = (p: Page) => p.getByTestId('generated-source'),
  result = (p: Page) => p.getByTestId('generated-assessment');
test.beforeAll(() => mkdir(folder, { recursive: true }));
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.practiceQA = { requests: [], responses: [], timings: [] };
    window.Worker = class extends Original {
      started = 0;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('practice-worker'))
          this.addEventListener('message', (e) => {
            if (e.data?.buffer instanceof ArrayBuffer) {
              window.practiceQA.responses.push(JSON.parse(new TextDecoder().decode(e.data.buffer)));
              window.practiceQA.timings.push(performance.now() - this.started);
            }
          });
      }
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const m = message as { buffer?: ArrayBuffer; buildId?: string };
        if (m.buffer && m.buildId) {
          try {
            const wire = JSON.parse(new TextDecoder().decode(m.buffer));
            if (wire.generatorVersion) {
              window.practiceQA.requests.push(wire);
              this.started = performance.now();
            }
          } catch {
            /* Other engine packet. */
          }
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
});
async function open(p: Page) {
  await p.goto('/#/generated-practice');
  await expect(root(p)).toBeVisible();
  await expect(p.getByTestId('generated-recommendation')).toHaveAttribute(
    'data-state',
    /^(ready|failed)$/,
  );
}
async function gen(p: Page, knowledge = 'knowledge.c.expressions', difficulty = '1', seed = '42') {
  await p.getByLabel('知识', { exact: true }).selectOption(knowledge);
  await p.getByLabel('难度', { exact: true }).selectOption(difficulty);
  await p.getByLabel('种子', { exact: true }).fill(seed);
  await p.getByRole('button', { name: '生成题目', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-status', 'generated');
}
async function reference(p: Page) {
  await p.getByText('查看已验证的参考解', { exact: true }).click();
  await p.getByRole('button', { name: '用参考解替换当前草稿', exact: true }).click();
}
async function capture(p: Page, name: string) {
  await writeFile(
    `${folder}/${name}.json.gz`,
    gzipSync(JSON.stringify(await p.evaluate(() => window.practiceQA))),
    { flag: 'wx' },
  );
}
async function stores(p: Page) {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const names = Array.from(db.objectStoreNames),
      tx = db.transaction(names, 'readonly'),
      done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    const rows = await Promise.all(
      names.map(async (n) => {
        const s = tx.objectStore(n);
        const a = s.getAllKeys(),
          b = s.getAll();
        return [
          n,
          await new Promise((resolve) => {
            a.onsuccess = () => resolve(a.result);
          }),
          await new Promise((resolve) => {
            b.onsuccess = () => resolve(b.result);
          }),
        ];
      }),
    );
    await done;
    db.close();
    return rows;
  });
}
for (const [knowledge, name] of [
  ['knowledge.c.expressions', '表达式'],
  ['knowledge.c.conditions', '条件'],
  ['knowledge.c.loops', '循环'],
])
  for (const difficulty of ['1', '2'])
    test(`19.2 candidate actual Rust ${name} difficulty ${difficulty} all inputs, wrong repair and reverse`, async ({
      page,
    }) => {
      await open(page);
      await gen(page, knowledge, difficulty, difficulty === '1' ? '0' : '4294967295');
      await editor(page).fill('#include <stdio.h>\nint main(){printf("999\\n");return 0;}');
      await page.getByRole('button', { name: '提交全部输入', exact: true }).click();
      await expect(result(page)).toHaveAttribute('data-verdict', 'unmet');
      await reference(page);
      await expect(result(page)).toHaveCount(0);
      await page.getByRole('button', { name: '提交全部输入', exact: true }).click();
      await expect(result(page)).toHaveAttribute('data-verdict', 'passed');
      await expect(result(page)).toHaveAttribute('data-complete', 'true');
      const initial = await page.getByTestId('generated-state').getAttribute('data-state');
      const slider = page.getByRole('slider', { name: '执行位置' });
      await slider.fill((await slider.getAttribute('max')) ?? '0');
      await expect(root(page)).not.toHaveAttribute('data-cursor', '0');
      await slider.fill('0');
      expect(await page.getByTestId('generated-state').getAttribute('data-state')).toBe(initial);
      await page.getByLabel('观察视图').selectOption('memory');
      await page.getByLabel('观察视图').selectOption('stack');
      const qa = await page.evaluate(() => window.practiceQA);
      expect(qa.requests).toHaveLength(3);
      expect(qa.responses).toHaveLength(3);
      expect(Math.max(...qa.timings)).toBeLessThan(1000);
      for (const req of qa.requests as Record<string, unknown>[]) {
        expect(Object.keys(req).sort()).toEqual(
          (req.operation === 'generate'
            ? ['generatorVersion', 'requestId', 'operation', 'knowledgeId', 'difficulty', 'seed']
            : [
                'generatorVersion',
                'requestId',
                'operation',
                'knowledgeId',
                'difficulty',
                'seed',
                'problemId',
                'attemptId',
                'sourceRevision',
                'source',
              ]
          ).sort(),
        );
      }
      await capture(page, `domain-${knowledge.split('.').at(-1)}-${difficulty}`);
    });
test('19.2 candidate strict seed, raw input, preview scope, program error, edits and refresh', async ({
  page,
}) => {
  await open(page);
  await gen(page, 'knowledge.c.expressions', '2', '00042');
  await expect(page.getByText('C · 难度2 · 种子42', { exact: true })).toBeVisible();
  await reference(page);
  await page.getByLabel('试运行输入', { exact: true }).fill('1 2');
  await page.getByRole('button', { name: '试运行一个输入', exact: true }).click();
  await expect(page.getByTestId('generated-status')).toContainText('E_GEN_INPUT');
  await expect(result(page)).toHaveCount(0);
  await page.getByLabel('试运行输入', { exact: true }).fill('  -12\n');
  await page.getByRole('button', { name: '试运行一个输入', exact: true }).click();
  await expect(result(page)).toHaveAttribute('data-complete', 'false');
  await expect(result(page)).toContainText('单次试运行不表示整题通过');
  await editor(page).fill('int main( {');
  await expect(result(page)).toHaveCount(0);
  await page.getByRole('button', { name: '提交全部输入', exact: true }).click();
  await expect(result(page)).toHaveAttribute('data-verdict', 'rejected');
  await expect(result(page)).toContainText('其余输入未检查');
  await editor(page).fill('int main(){while(1){}return 0;}');
  await page.getByRole('button', { name: '提交全部输入', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-status', /^(assessed|failed)$/);
  await expect(page.getByRole('heading', { name: '全部输入通过', exact: true })).toHaveCount(0);
  await page.getByLabel('种子', { exact: true }).fill('4294967296');
  await page.getByRole('button', { name: '生成题目', exact: true }).click();
  await expect(page.getByTestId('generated-status')).toContainText('E_GEN_SEED');
  await expect(editor(page)).toHaveCount(0);
  await gen(page);
  await page.reload();
  await expect(editor(page)).toHaveCount(0);
  await expect(root(page)).toHaveAttribute('data-status', 'idle');
  await capture(page, 'strict-input');
});
test('19.2 candidate real module load failure and cancellation recover without stale results', async ({
  page,
}) => {
  let mode = 'fail';
  await page.route(/c_viz_practice_bg.*\.wasm$/, async (route) => {
    if (mode === 'fail') await route.abort();
    else if (mode === 'delay') {
      await new Promise((r) => setTimeout(r, 350));
      await route.continue();
    } else await route.continue();
  });
  await open(page);
  await page.getByRole('button', { name: '生成题目', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-status', 'failed');
  await expect(editor(page)).toHaveCount(0);
  mode = 'delay';
  await page.getByRole('button', { name: '生成题目', exact: true }).click();
  await page.getByRole('button', { name: '取消本次操作', exact: true }).click();
  await expect(page.getByTestId('generated-status')).toContainText('E_CANCELLED');
  await page.waitForTimeout(400);
  await expect(editor(page)).toHaveCount(0);
  mode = 'ok';
  await gen(page);
  await page.getByRole('button', { name: '清空本次加练', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(result(page)).toHaveCount(0);
  await gen(page);
  await capture(page, 'module-recovery');
});
test('19.2 candidate responsive widths and representative minimal theme keep controls usable', async ({
  page,
}) => {
  await open(page);
  await gen(page, 'knowledge.c.loops', '2');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: '生成题目', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${folder}/generated-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/settings');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'minimal');
  await page.goto('/#/generated-practice');
  await gen(page);
  await page.screenshot({ path: `${folder}/minimal-1440.png`, fullPage: true });
  await reference(page);
  await page.getByRole('button', { name: '提交全部输入', exact: true }).click();
  await expect(result(page)).toHaveAttribute('data-verdict', 'passed');
  await page.getByRole('slider', { name: '执行位置' }).fill('4');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ['basic', 'memory', 'stack']) {
      await page.getByLabel('观察视图').selectOption(mode);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.screenshot({ path: `${folder}/result-${width}.png`, fullPage: true });
  }
});
test('19.2 formal empty evidence and whole keyed DB stay unchanged by transient practice', async ({
  page,
}) => {
  await page.goto('/#/');
  await ready(page);
  await open(page);
  await expect(page.getByTestId('generated-recommendation')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('generated-recommendation')).toContainText('暂无待复习');
  const before = await stores(page);
  expect(before).toHaveLength(19);
  await gen(page);
  await reference(page);
  await page.getByRole('button', { name: '提交全部输入', exact: true }).click();
  await expect(result(page)).toHaveAttribute('data-verdict', 'passed');
  await page.getByRole('button', { name: '清空本次加练', exact: true }).click();
  expect(await stores(page)).toEqual(before);
  await writeFile(
    `${folder}/keyed-db-unchanged.json`,
    JSON.stringify({ before, after: await stores(page) }),
    { flag: 'wx' },
  );
});
test('19.2 formal confirmed manual evidence recommends only supported exact knowledge and preserves original links', async ({
  page,
}) => {
  await page.goto('/#/lessons/lesson.c6.s2.2.2');
  await ready(page);
  await expect(page.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
  await page.locator('[data-knowledge-mark="knowledge.c6.s2.2.2"]').click();
  await expect(page.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
  await open(page);
  await expect(page.getByTestId('generated-recommendation')).toContainText('手动自评');
  const before = await stores(page);
  await page.getByRole('button', { name: '采用此知识建议' }).click();
  await expect(page.getByLabel('知识', { exact: true })).toHaveValue('knowledge.c.variables');
  await expect(page.getByRole('link', { name: /原课程：/ })).toHaveAttribute(
    'href',
    '#/lessons/lesson.c6.s2.2.2',
  );
  await page.getByLabel('知识', { exact: true }).selectOption('knowledge.c.conditions');
  await expect(page.getByRole('link', { name: /原课程：/ })).toHaveAttribute(
    'href',
    '#/lessons/lesson.c6.s7.1',
  );
  await page.getByRole('button', { name: '采用此知识建议' }).click();
  await expect(page.getByRole('link', { name: /原课程：/ })).toHaveAttribute(
    'href',
    '#/lessons/lesson.c6.s2.2.2',
  );
  await gen(page, 'knowledge.c.variables');
  const qa = await page.evaluate(() => window.practiceQA);
  expect(qa.requests).toHaveLength(1);
  expect(Object.keys(qa.requests[0] as object)).toHaveLength(6);
  await capture(page, 'manual-minimal-payload');
  await page.getByRole('link', { name: /原课程：/ }).click();
  await expect(page).toHaveURL(/#\/lessons\/lesson\.c6\.s2\.2\.2$/);
  await expect(page.locator('.c6-reading-page')).toBeVisible();
  expect(await stores(page)).toEqual(before);
  await open(page);
  await page.getByRole('link', { name: '核对学习依据 →' }).click();
  await expect(page.getByRole('link', { name: '生成一道同类加练题 →' })).toBeVisible();
});
test('19.2 formal actual exercise failure supplies explainable recommendation without sending history', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await page.goto('/#/');
  await ready(page);
  await openAnswer(page, 'exercise.c.bug-parenthesis');
  const source = await code(page).inputValue();
  await code(page).fill(source.replace(/printf\([^;]+;/, 'printf("%d\\n", x + 1);'));
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  await expect(page.getByTestId('practice-attempt-save')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  const actual = await observedCaseSetExecute(page);
  expect(actual.moduleSeen && actual.responseOk && actual.terminated).toBe(true);
  await writeFile(
    `${folder}/real-failure-current-source.json.gz`,
    gzipSync(JSON.stringify(actual)),
    { flag: 'wx' },
  );
  await open(page);
  await expect(page.getByTestId('generated-recommendation')).toContainText('真实练习错误');
  await page.getByRole('button', { name: '采用此知识建议' }).click();
  await page.getByRole('button', { name: '生成题目', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-status', 'generated');
  await capture(page, 'automatic-minimal-payload');
});
test('19.2 formal unsupported marked knowledge has honest original-course fallback', async ({
  page,
}) => {
  await page.goto('/#/lessons/lesson.c6.s10.1.1');
  await ready(page);
  await expect(page.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
  await page.locator('[data-knowledge-mark="knowledge.c6.s10.1.1"]').click();
  await expect(page.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
  await open(page);
  await expect(page.getByTestId('generated-recommendation')).toContainText('尚未提供的题型');
  await expect(page.getByRole('button', { name: '采用此知识建议' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '复习队列 →' })).toBeVisible();
});
