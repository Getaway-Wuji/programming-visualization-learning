import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import type { ContentPackage } from '../../web/src/content/types';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';

const course = JSON.parse(
  readFileSync('content/c/p05/course-1.0.0.json', 'utf8'),
) as ContentPackage;
const solutions = JSON.parse(
  readFileSync('tests/fixtures/p05-reference-solutions.json', 'utf8'),
) as { solutions: { exerciseRef: { id: string }; source: string }[] };
const folder = `.artifacts/15.1/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const graph = (page: Page) => page.getByTestId('knowledge-map');
const node = (page: Page, key: string) =>
  graph(page).locator(`[data-knowledge-node="knowledge.c.${key}"]`);
const panel = (page: Page) => page.getByTestId('practice-execution');
const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const ready = (page: Page) =>
  expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    p05CourseRelease.registered ? 'ready' : /^(ready|unsaved)$/,
  );
async function archive(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('c-viz-learning');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const entries = await Promise.all(
        names.map(async (name) => [
          name,
          await new Promise<unknown>((resolve, reject) => {
            const store = tx.objectStore(name);
            const req = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
              ? store.get('current')
              : store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          }),
        ]),
      );
      await done;
      return Object.fromEntries(entries) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}
async function home(page: Page) {
  await page.goto('/#/');
  await expect(graph(page)).toHaveAttribute('data-state', 'ready');
  await ready(page);
}
async function confirm(page: Page, id: string) {
  await page.goto(`/#/lessons/${id}`);
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await ready(page);
  const start = page.getByRole('button', { name: '开始本节学习', exact: true });
  if (await start.isEnabled()) {
    await start.click();
    await ready(page);
  }
  await page.getByRole('button', { name: /^(确认已学习|确认今日复习)$/ }).click();
  await ready(page);
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
}
async function openAnswer(page: Page, exerciseId: string) {
  const subject = course.exercises.find((item) => item.id === exerciseId)!;
  const program = course.programs.find((item) => item.id === subject.programRef.id)!;
  const input = Object.fromEntries(
    Object.entries(subject.tests[0].input).sort(([a], [b]) => a.localeCompare(b)),
  );
  const source = JSON.parse(
    new TextDecoder().decode(
      prepare_input(
        JSON.stringify({
          packageRef: { id: course.packageId, version: course.packageVersion },
          subject,
          program: {
            ...program,
            sourceExample: solutions.solutions.find((item) => item.exerciseRef.id === exerciseId)!
              .source,
          },
          inputSpec: course.inputSpecs.find((item) => item.id === program.inputRef.id)!,
          judgeProfile: course.judgeProfiles.find((item) => item.id === subject.judgeRef.id)!,
        }),
        new TextEncoder().encode(JSON.stringify(input)),
        1000,
      ),
    ),
  ) as { source: { text: string } };
  await page.goto(`/#/practice/${exerciseId}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await ready(page);
  await expect(code(page)).toBeEditable();
  await code(page).fill(source.source.text);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
}
async function submit(page: Page, saved = true) {
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
    'data-save-state',
    saved ? 'saved' : 'unsaved',
  );
  if (saved) await ready(page);
}
async function capture(page: Page, name: string) {
  const actual = await observedCaseSetExecute(page);
  expect(actual.moduleSeen).toBe(true);
  expect(actual.responseOk).toBe(true);
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/${name}.json.gz`, gzipSync(JSON.stringify(actual)), { flag: 'wx' });
}

test.beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));

test('15.1 common: empty graph, every exact lesson destination and selection are read-only', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await home(page);
  // The existing goal bootstrap is independent of graph readiness. Capture the
  // readonly baseline only after that native settings transaction completes.
  await expect.poll(async () => (await archive(page)).settings.goalTemplate).not.toBeNull();
  const before = await archive(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('0 / 10 已点亮');
  await expect(graph(page).locator('[data-knowledge-edge]')).toHaveCount(11);
  await expect(graph(page).locator('[data-knowledge-node][data-state="unlearned"]')).toHaveCount(
    10,
  );
  for (const knowledge of course.knowledgePoints) {
    const button = graph(page).locator(`[data-knowledge-node="${knowledge.id}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const detail = page.getByTestId('knowledge-detail');
    await expect(detail.getByRole('heading', { level: 3 })).toHaveText(knowledge.title);
    const related = course.chapters
      .flatMap((chapter) => chapter.lessonRefs)
      .map((ref) => course.lessons.find((lesson) => lesson.id === ref.id)!)
      .filter((lesson) => lesson.knowledgeRefs.some((ref) => ref.id === knowledge.id));
    await expect(detail.getByRole('link')).toHaveCount(related.length);
    for (const lesson of related)
      await expect(
        detail.getByRole('link', { name: `${lesson.title} 学习 →`, exact: true }),
      ).toHaveAttribute('href', `#/lessons/${lesson.id}`);
    await detail.getByRole('link').first().click();
    await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('main h1')).toHaveText(related[0].title);
    await page.goBack();
    await expect(graph(page)).toHaveAttribute('data-state', 'ready');
  }
  expect(await archive(page)).toEqual(before);
  expect(await page.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
  await mkdir(folder, { recursive: true });
  await writeFile(
    `${folder}/no-side-effects.json`,
    JSON.stringify({ before, after: await archive(page), workers: 0 }, null, 2),
  );
});

test('15.1 common: keyboard selection, three widths and refresh preserve empty state', async ({
  page,
}) => {
  await home(page);
  await node(page, 'sorting').focus();
  await page.keyboard.press('Enter');
  await expect(node(page, 'sorting')).toBeFocused();
  await expect(page.getByTestId('knowledge-detail')).toContainText('结合数组和循环');
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await graph(page).scrollIntoViewIfNeeded();
    if (width === 390) {
      await page
        .getByRole('combobox', { name: '选择知识点', exact: true })
        .selectOption('knowledge.c.variables');
      await expect(page.getByTestId('knowledge-detail')).toContainText('变量与作用域');
      await expect(node(page, 'variables')).toHaveAttribute('aria-pressed', 'true');
    }
    await node(page, 'binary-search').click();
    await expect(page.getByTestId('knowledge-detail')).toContainText('首次匹配');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${folder}/empty-${width}.png`, fullPage: true });
  }
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('0 / 10 已点亮');
});

test('15.1 formal: real completion lights only related nodes and both-end edges, refresh/repeat/clear restore correctly', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  await home(page);
  const other = await context.newPage();
  await home(other);
  await confirm(page, 'lesson.c.first-program');
  await home(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('0 / 10 已点亮');
  await openAnswer(page, 'exercise.c.first-output');
  await submit(page);
  await capture(page, 'first-program');
  await home(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('2 / 10 已点亮');
  await expect(graph(page).locator('[data-knowledge-edge][data-lit="yes"]')).toHaveCount(0);
  await confirm(page, 'lesson.c.variables-output');
  await openAnswer(page, 'exercise.c.echo');
  await submit(page);
  await capture(page, 'variables-output');
  await home(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('4 / 10 已点亮');
  for (const key of ['entry', 'variables', 'input', 'output'])
    await expect(node(page, key)).toHaveAttribute('data-state', 'lit');
  await expect(node(page, 'expressions')).toHaveAttribute('data-state', 'unlearned');
  await expect(graph(page).locator('[data-knowledge-edge][data-lit="yes"]')).toHaveCount(3);
  await expect(other.getByTestId('knowledge-lit-count')).toHaveText('4 / 10 已点亮');
  const saved = await archive(page);
  expect(saved.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(2);
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('4 / 10 已点亮');
  await node(page, 'variables').click();
  await expect(page.getByTestId('knowledge-detail')).toContainText('已完成 1/10 节');
  await page
    .getByTestId('knowledge-detail')
    .getByRole('link', { name: '变量和输出 复习 →', exact: true })
    .click();
  await ready(page);
  expect(await archive(page)).toEqual(saved);
  await openAnswer(page, 'exercise.c.echo');
  await submit(page);
  expect((await archive(page)).ledger).toEqual(saved.ledger);
  await home(page);
  await mkdir(folder, { recursive: true });
  await graph(page).screenshot({ path: `${folder}/lit-1440.png` });
  await writeFile(`${folder}/saved-completion.json`, JSON.stringify(await archive(page), null, 2));
  await page.goto('/#/settings?panel=data');
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(other.getByTestId('knowledge-lit-count')).toHaveText('0 / 10 已点亮');
  expect((await archive(other)).progress).toEqual([]);
  await other.reload();
  await ready(other);
  await expect(other.getByTestId('knowledge-lit-count')).toHaveText('0 / 10 已点亮');
});

test('15.1 formal: failed native transaction keeps graph unlearned until original event retry is acknowledged', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    const control = { armed: false };
    Object.assign(window, { __knowledgeQuota: control });
    const native = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (
        control.armed &&
        this.name === 'receipts' &&
        (value as { eventType?: string })?.eventType === 'exercise.passed'
      ) {
        control.armed = false;
        throw new DOMException('15.1 isolated native quota failure', 'QuotaExceededError');
      }
      return key === undefined ? native.call(this, value) : native.call(this, value, key);
    };
  });
  await confirm(page, 'lesson.c.variables-output');
  await openAnswer(page, 'exercise.c.echo');
  await page.evaluate(() => {
    (window as unknown as { __knowledgeQuota: { armed: boolean } }).__knowledgeQuota.armed = true;
  });
  await submit(page, false);
  const failed = await archive(page);
  expect(failed.progress.filter((row) => row.eventType === 'lesson.completed')).toEqual([]);
  await page.goto('/#/');
  await expect(graph(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('knowledge-storage-note')).toContainText('暂不用于点亮');
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('0 / 10 已点亮');
  await mkdir(folder, { recursive: true });
  await graph(page).screenshot({ path: `${folder}/failed-save.png` });
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重试未保存操作', exact: true })
    .click();
  await ready(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('4 / 10 已点亮');
  const saved = await archive(page);
  expect(saved.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(1);
  expect(
    saved.ledger.filter((row) => row.sourceId === 'reward.lesson.first-completion'),
  ).toHaveLength(1);
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('4 / 10 已点亮');
  expect((await archive(page)).ledger).toEqual(saved.ledger);
});

test('15.1 formal: real original-course completion survives the reviewed 32-lesson upgrade without rewriting history', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.route(`**/${p05CourseRelease.file}`, (route) =>
    route.fulfill({ status: 404, body: 'Explicit whole original-course fallback' }),
  );
  await confirm(page, 'lesson.c.variables-output');
  await openAnswer(page, 'exercise.c.echo');
  await submit(page);
  await home(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('4 / 10 已点亮');
  const old = await archive(page);
  expect(old.progress.find((row) => row.eventType === 'lesson.completed')?.packageRef).toEqual({
    id: 'content.c.p0',
    version: '1.0.1',
  });
  await page.unroute(`**/${p05CourseRelease.file}`);
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('4 / 10 已点亮');
  await node(page, 'variables').click();
  await expect(page.getByTestId('knowledge-detail')).toContainText('已完成 1/10 节');
  const upgraded = await archive(page);
  expect(upgraded.progress).toEqual(old.progress);
  expect(upgraded.ledger).toEqual(old.ledger);
});

test('15.1 common: unavailable storage is pending confirmation and recovers without a fake completion', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const native = indexedDB.open.bind(indexedDB);
    let blocked = true;
    Object.assign(window, {
      __knowledgeRestoreStorage: () => {
        blocked = false;
      },
    });
    indexedDB.open = (...args: Parameters<IDBFactory['open']>) => {
      if (blocked)
        throw new DOMException('15.1 isolated storage permission fault', 'SecurityError');
      return native(...args);
    };
  });
  await page.goto('/#/');
  await expect(graph(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('学习记录待确认');
  await expect(graph(page).locator('[data-knowledge-node][data-state="unknown"]')).toHaveCount(10);
  await expect(graph(page)).not.toContainText('0 / 10 已点亮');
  await page.evaluate(() =>
    (window as unknown as { __knowledgeRestoreStorage(): void }).__knowledgeRestoreStorage(),
  );
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重新读取档案', exact: true })
    .click();
  await ready(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('0 / 10 已点亮');
  expect((await archive(page)).progress).toEqual([]);
});

test('15.1 common: unavailable reading fails locally and normal course retry restores the map', async ({
  page,
}) => {
  await page.route('**/content/**/*.json', (route) =>
    /\/(course|review|reading)\//.test(route.request().url())
      ? route.fulfill({ status: 404, body: 'Explicit unavailable course' })
      : route.continue(),
  );
  await page.goto('/#/');
  await expect(graph(page)).toHaveAttribute('data-state', 'failed');
  await expect(graph(page)).toContainText('知识图谱暂不可用');
  await expect(graph(page).locator('[data-knowledge-node]')).toHaveCount(0);
  await page.unroute('**/content/**/*.json');
  await graph(page).getByRole('button', { name: '重新读取课程', exact: true }).click();
  await expect(graph(page)).toHaveAttribute('data-state', 'ready');
  await ready(page);
  await expect(page.getByTestId('knowledge-lit-count')).toHaveText('0 / 10 已点亮');
  expect((await archive(page)).progress).toEqual([]);
});
