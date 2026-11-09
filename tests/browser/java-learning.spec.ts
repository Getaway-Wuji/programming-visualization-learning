import { expectEditorValue } from './editor-value';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { JavaArticle } from '../../web/src/java/content-types';
import { openCurrentAnswer, submitCurrent } from './current-course-helpers';
import { watch } from './achievement-helpers';

const course = JSON.parse(
  readFileSync('content/java/course/article-17-1.0.0.json', 'utf8'),
) as JavaArticle;
const section = course.nodes.find((node) => node.questionId === 'java.practice.utf16-length')!;
const samples = JSON.parse(readFileSync('tests/fixtures/java-reference.json', 'utf8')) as Record<
  string,
  string
>;
const python = JSON.parse(readFileSync('tests/fixtures/python3-reference.json', 'utf8')) as Record<
  string,
  string
>;
const practice = '/#/java/practice/java.practice.utf16-length';
const lesson = '/#/java/article/17/' + section.platformRef.id;
const workbench = '/#/java/workbench';
const code = (page: Page) => page.getByRole('textbox', { name: 'Java 代码', exact: true });
const body = (source: string) =>
  'public class Main { public static void main(String[] args) { ' + source + ' } }';
const emptyProgram =
  'public class Main {\n    public static void main(String[] args) {\n    }\n}\n';
const savedDraft = '草稿已保存到本机。';
const savedJudge = '判题结果已保存到本机。';

interface TestRow {
  [key: string]: unknown;
  subjectRef?: { id: string };
}
type TestRows = Record<string, { keys: IDBValidKey[]; values: TestRow[] }>;
async function archive(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stores = Array.from(db.objectStoreNames);
      const tx = db.transaction(stores);
      const load = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const rows: TestRows = Object.fromEntries(
        await Promise.all(
          stores.map(async (store) => {
            const table = tx.objectStore(store);
            const [keys, values] = await Promise.all([
              load(table.getAllKeys()),
              load(table.getAll()),
            ]);
            return [store, { keys, values: values as TestRow[] }];
          }),
        ),
      );
      return { version: db.version, rows };
    } finally {
      db.close();
    }
  });
}

test('course assets load lazily and reading, judge, review and draft persist independently', async ({
  page,
}) => {
  const assets: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/content/java/course/'))
      assets.push(new URL(request.url()).pathname.split('/').at(-1)!);
  });
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Java 课程', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Java 课程', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Java 测验（来源参考）' })).toHaveCount(1);
  expect(assets).toEqual(['manifest-1.0.0.json']);
  await page.getByRole('link', { name: 'Java String 类', exact: true }).click();
  await page.getByRole('link', { name: section.titleDisplay, exact: true }).first().click();
  await expect(
    page.getByRole('heading', { name: section.titleDisplay, exact: true, level: 1 }),
  ).toBeVisible();
  expect(assets).toEqual(['manifest-1.0.0.json', 'article-17-1.0.0.json']);
  await page.keyboard.press('End');
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read-today', 'true');
  await page.keyboard.press('End');
  const read = await archive(page);
  expect(read.version).toBe(15);
  expect(Object.keys(read.rows)).toHaveLength(29);
  expect(read.rows.javaActivities.values).toHaveLength(1);
  expect(
    read.rows.dailyFacts.values.filter((item) => item.subjectRef?.id === section.platformRef.id),
  ).toHaveLength(1);
  await page.getByRole('link', { name: '打开练习' }).click();
  await code(page).fill(body('System.out.println(42);'));
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText(savedJudge)).toBeVisible();
  await expect(page.getByRole('button', { name: /第 [1-4] 组 · 未通过/ })).toHaveCount(4);
  await code(page).fill(samples['utf16-length']);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(savedDraft)).toBeVisible();
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText(savedJudge)).toBeVisible();
  await expect(page.getByRole('button', { name: /第 [1-4] 组 · 通过/ })).toHaveCount(4);
  await expect(page.getByTestId('java-output')).toHaveText('3');
  await page.getByRole('button', { name: '回到开头' }).click();
  await expect(page.getByTestId('java-output')).toHaveText('（当前无输出）');
  await page.getByRole('button', { name: '到最后一步' }).click();
  await expect(page.getByTestId('java-output')).toHaveText('3');
  await page.getByRole('link', { name: '查看本地复盘记录' }).click();
  await page.reload();
  await expect(page.getByText('四组全部通过', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '再次练习' }).click();
  await expectEditorValue(code(page), samples['utf16-length']);
  await expect(page.getByText('此题已通过并保存在本机。')).toBeVisible();
  const final = await archive(page);
  expect(final.rows.javaActivities.values).toHaveLength(2);
  expect(final.rows.javaDrafts.values[0].source).toBe(samples['utf16-length']);
  expect(
    final.rows.ledger.values.filter((row) => row.subjectId === 'java.practice.utf16-length'),
  ).toHaveLength(1);
});

test('Java Blockly updates source and output while an unmapped program stays intact', async ({
  page,
}) => {
  await page.goto(workbench);
  const original = body(
    'int n = 3; int sum = 0; while (n > 0) { if (n != 2) { sum = sum + n; } else { sum = sum + 0; } n = n - 1; } System.out.println(sum);',
  );
  await code(page).fill(original);
  await page.getByRole('button', { name: '运行代码' }).click();
  await expect(page.getByTestId('java-output')).toHaveText('4');
  await page.getByRole('button', { name: '积木', exact: true }).click();
  await expect(page.locator('.python-block-canvas .blocklySvg')).toBeVisible();
  await page
    .locator('.python-block-canvas')
    .getByRole('button', { name: 'Edit text: 3', exact: true })
    .click();
  await page.locator('input.blocklyHtmlInput').fill('4');
  await page.locator('input.blocklyHtmlInput').press('Enter');
  await expect(page.getByText(/积木修改尚未应用/u)).toBeVisible();
  await page.getByRole('button', { name: '应用积木到代码' }).click();
  await page.getByRole('button', { name: '代码', exact: true }).click();
  await expectEditorValue(code(page), /public class Main.*while/su);
  await page.getByRole('button', { name: '运行代码' }).click();
  await expect(page.getByTestId('java-output')).toHaveText('8');
  const unmapped = body('int[] a = new int[1]; a[0] = 9; System.out.println(a[0]);');
  await code(page).fill(unmapped);
  await page.getByRole('button', { name: '积木', exact: true }).click();
  await expect(page.getByText(/原稿已保留/u)).toBeVisible();
  await expectEditorValue(code(page), unmapped);
  await page.getByRole('button', { name: '运行代码' }).click();
  await expect(page.getByTestId('java-output')).toHaveText('9');
});

test('Java and Python workbench drafts have independent identities', async ({ page }) => {
  await page.goto(workbench);
  const source = body('System.out.println(19);');
  await code(page).fill(source);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(savedDraft)).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: 'Python 课程', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Python 学习', exact: true })
    .getByRole('link', { name: '工作台', exact: true })
    .click();
  const pythonEditor = page.getByRole('textbox', { name: 'Python 代码', exact: true });
  await pythonEditor.fill('print(8)\n');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(savedDraft)).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: 'Java 课程', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Java 学习', exact: true })
    .getByRole('link', { name: '工作台', exact: true })
    .click();
  await expectEditorValue(code(page), source);
  const data = await archive(page);
  expect(data.rows.javaDrafts.values[0].source).toBe(source);
  expect(data.rows.pythonDrafts.values[0].source).toBe('print(8)\n');
});

test('editing during submission revokes the stale Java result', async ({ page }) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      setTimeout(() => Reflect.apply(send, this, args), 180);
    };
  });
  await page.goto(practice);
  await code(page).fill(samples['utf16-length']);
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText('正在判题', { exact: true })).toBeVisible();
  await code(page).fill(body('System.out.println(37);'));
  await page.getByRole('button', { name: '运行代码' }).click();
  await expect(page.getByTestId('java-output')).toHaveText('37');
  await expect(page.getByRole('heading', { name: '判题结果' })).toHaveCount(0);
  expect((await archive(page)).rows.javaActivities.values).toHaveLength(0);
});

test('native DB11 upgrade preserves real C, Python and C++ rows, then saves Java', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  await openCurrentAnswer(page, 'exercise.c6.s10.1.1');
  await submitCurrent(page);
  await watch(page, 'hanoi');
  await page.goto('/#/python/practice/py3.practice.greeting');
  await page.getByRole('textbox', { name: 'Python 代码' }).fill(python.greeting);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(savedDraft)).toBeVisible();
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText(savedJudge)).toBeVisible();
  const original = await archive(page);
  expect(original.rows.courseActivities.values.length).toBeGreaterThan(0);
  expect(original.rows.pythonDrafts.values[0].source).toBe(python.greeting);
  expect(original.rows.pythonActivities.values.length).toBeGreaterThan(0);
  expect(JSON.stringify(original.rows.achievements.values)).toContain('observation.stack.hanoi');
  const prior = Object.fromEntries(
    Object.entries(original.rows).filter(
      ([name]) =>
        !name.startsWith('java') &&
        !name.startsWith('cpp') &&
        !name.startsWith('rust') &&
        !name.startsWith('mysql'),
    ),
  );
  prior.meta.values[0] = {
    ...prior.meta.values[0],
    schemaVersion: '11.0.0',
    dbVersion: 11,
    activeCatalogSetRef: { id: 'catalog-set.c-python', version: '1.0.0' },
  };
  const context = await browser.newContext({ baseURL });
  try {
    const migrated = await context.newPage();
    await migrated.route('**/java-migration-fixture', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>DB11 fixture</title>' }),
    );
    await migrated.goto('/java-migration-fixture');
    await migrated.evaluate(async (payload: unknown) => {
      const rows = payload as TestRows;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning', 11);
        request.onupgradeneeded = () => {
          for (const [name, rowsForStore] of Object.entries(rows)) {
            const store = request.result.createObjectStore(name);
            rowsForStore.keys.forEach((key, index) => store.add(rowsForStore.values[index], key));
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });
    }, prior as unknown);
    expect((await archive(migrated)).version).toBe(11);
    await migrated.goto(lesson);
    await expect(migrated.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
    const upgraded = await archive(migrated);
    expect(upgraded.version).toBe(15);
    expect(upgraded.rows.javaActivities.values).toEqual([]);
    expect(upgraded.rows.javaDrafts.values).toEqual([]);
    for (const [name, stored] of Object.entries(prior))
      if (name !== 'meta') expect(upgraded.rows[name], name).toEqual(stored);
    expect(upgraded.rows.meta.values[0]).toEqual({
      ...prior.meta.values[0],
      dbVersion: 15,
      schemaVersion: '15.0.0',
      activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp-rust-mysql', version: '1.0.0' },
    });
    await migrated.bringToFront();
    const readingEnd = migrated.getByTestId('reading-end');
    await expect(readingEnd).toBeAttached();
    await expect(async () => {
      await migrated.keyboard.press('End');
      await expect(readingEnd).toHaveAttribute('data-read-today', 'true', { timeout: 800 });
    }).toPass({ timeout: 8000 });
    await migrated.getByRole('link', { name: '打开练习' }).click();
    await code(migrated).fill(samples['utf16-length']);
    await migrated.getByRole('button', { name: '保存草稿' }).click();
    await expect(migrated.getByText(savedDraft)).toBeVisible();
    await migrated.getByRole('button', { name: '提交判题' }).click();
    await expect(migrated.getByText(savedJudge)).toBeVisible();
    await migrated.getByRole('link', { name: '查看本地复盘记录' }).click();
    await expect(migrated).toHaveURL(/#\/java\/review$/u);
    await migrated.reload();
    await expect(migrated.getByText('四组全部通过')).toBeVisible();
    const final = await archive(migrated);
    for (const name of [
      'courseActivities',
      'courseDrafts',
      'pythonActivities',
      'pythonDrafts',
      'achievements',
    ])
      expect(final.rows[name]).toEqual(prior[name]);
    await info.attach('native-DB11-DB15', {
      body: JSON.stringify({ prior, upgraded, final }),
      contentType: 'application/json',
    });
  } finally {
    await context.close();
  }
});

test('snapshot exports the selected cursor, Java source and source attribution', async ({
  page,
}) => {
  await page.goto('/#/java/example/17/' + section.platformRef.id);
  await page.getByRole('button', { name: '运行代码' }).click();
  await expect(page.getByTestId('java-output')).toHaveText('3');
  await page.getByRole('button', { name: '回到开头' }).click();
  await page.getByRole('button', { name: '预览当前快照' }).click();
  const dialog = page.getByRole('dialog', { name: 'Java 快照预览' });
  await expect(dialog.getByRole('heading', { name: '第 0 步快照' })).toBeVisible();
  for (const type of ['json', 'png', 'md', 'zip']) {
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '下载 ' + type.toUpperCase() }).click(),
    ]);
    expect(file.suggestedFilename()).toMatch(new RegExp('^Java-第0步-.+\\.' + type + '$', 'u'));
    const bytes = readFileSync((await file.path())!);
    if (type === 'json') {
      const json = JSON.parse(bytes.toString('utf8'));
      expect(json.formatVersion).toBe('3.1.0');
      expect(json.runtime.language).toBe('java');
      expect(json.source.text).toBe(samples['utf16-length']);
      expect(json.origin.sourceUrl).toContain('https://www.runoob.com/java/java-string.html');
      expect(json.position.cursor).toBe(0);
      expect(json.currentState.output).toBe('');
    } else if (type === 'md') expect(bytes.toString('utf8')).toContain('Java 学习笔记');
    else if (type === 'png') expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    else expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  }
});

test('mobile task and workspace panels switch without horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(practice);
  await expect(code(page)).toBeVisible();
  await page.getByRole('button', { name: '题目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '题目', exact: true })).toBeVisible();
  await expect(code(page)).toBeHidden();
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await expect(code(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Java draft quota failure and tab conflict preserve editable source and permit explicit retry', async ({
  page,
  context,
}) => {
  await page.goto(practice);
  await expectEditorValue(code(page), emptyProgram);
  const other = await context.newPage();
  await other.goto(practice);
  await expectEditorValue(code(other), emptyProgram);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'javaDrafts') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('injected storage quota', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  await code(page).fill(samples['utf16-length']);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('S_QUOTA');
  await expectEditorValue(code(page), samples['utf16-length']);
  expect((await archive(page)).rows.javaDrafts.values).toHaveLength(0);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存到本机。')).toBeVisible();
  await code(other).fill(body('System.out.println(123);'));
  await other.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('另一页面更新了草稿');
  await expectEditorValue(code(other), body('System.out.println(123);'));
  other.once('dialog', (dialog) => void dialog.accept());
  await other.getByRole('button', { name: '以当前代码保存' }).click();
  await expect(other.getByText('草稿已保存到本机。')).toBeVisible();
  await other.reload();
  await expectEditorValue(code(other), body('System.out.println(123);'));
});

test('explicit clear changes the generation, clears both Java stores and rejects a pending judge', async ({
  page,
  context,
}) => {
  await page.goto(practice);
  await code(page).fill(samples['utf16-length']);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存到本机。')).toBeVisible();
  const old = await archive(page);
  const settings = await context.newPage();
  await settings.goto('/#/settings?panel=data');
  await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await expect(
    settings.getByRole('heading', { name: '确认清除本地数据', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      setTimeout(() => Reflect.apply(send, this, args), 650);
    };
  });
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText('正在判题', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect
    .poll(async () => (await archive(page)).rows.meta.values[0].generation)
    .not.toBe(old.rows.meta.values[0].generation);
  await expectEditorValue(code(page), emptyProgram);
  const after = await archive(page);
  expect(after.rows.javaDrafts.values).toEqual([]);
  expect(after.rows.javaActivities.values).toEqual([]);
  expect(after.rows.ledger.values).toEqual([]);
  await code(page).fill(samples['utf16-length']);
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText('判题结果已保存到本机。')).toBeVisible();
});

test('a Java failure maps to its own review and weakness topic', async ({ page }) => {
  await page.goto(practice);
  await code(page).fill(body('System.out.println(42);'));
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(savedDraft)).toBeVisible();
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText(savedJudge)).toBeVisible();
  await page.getByRole('link', { name: '查看本地复盘记录' }).click();
  await expect(page.getByText('输出与预期不符 · 第 1 组')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Java 复习卡' })).toBeVisible();
  await page.goto('/#/weaknesses');
  const weakness = page.locator('[data-weakness-id="java.knowledge.utf16-length"]');
  await expect(weakness).toHaveAttribute('data-recommended', 'yes');
  await expect(weakness.getByRole('link', { name: /复习关联基础课程/u })).toHaveAttribute(
    'href',
    lesson.slice(1),
  );
});

test('Java playback pauses at a source breakpoint and reverses a frame and array', async ({
  page,
}) => {
  await page.goto(workbench);
  const source = [
    'public class Main {',
    '    static void set(int[] a) {',
    '        a[0] = 19;',
    '    }',
    '    public static void main(String[] args) {',
    '        int[] values = new int[1];',
    '        set(values);',
    '        System.out.println(values[0]);',
    '    }',
    '}',
  ].join('\n');
  await code(page).fill(source);
  await page.getByRole('button', { name: '运行代码' }).click();
  const trace = page.getByTestId('java-trace');
  await expect(page.getByTestId('java-output')).toHaveText('19');
  await trace.getByRole('button', { name: '回到开头' }).click();
  for (let i = 0; i < 20; i++) {
    await trace.getByRole('button', { name: '下一步' }).click();
    if ((await trace.locator('.python-source-mark').textContent())?.startsWith('a[0] = 19')) break;
  }
  await expect(trace.locator('.python-source-mark')).toHaveText('a[0] = 19;');
  await trace.getByRole('button', { name: '设为断点' }).click();
  await trace.getByRole('button', { name: '回到开头' }).click();
  await trace.getByRole('button', { name: '播放', exact: true }).click();
  await expect(trace.getByRole('button', { name: '移除本行断点' })).toBeVisible({
    timeout: 12000,
  });
  await expect(trace.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect(trace.getByText('调用帧 #2')).toBeVisible();
  await expect(trace.getByText('[19]', { exact: true })).toBeVisible();
  await trace.getByRole('button', { name: '上一步' }).click();
  await expect(trace.getByText('[0]', { exact: true })).toBeVisible();
  await trace.getByRole('button', { name: '回到开头' }).click();
  await expect(trace.getByText('当前没有活动调用帧。')).toBeVisible();
  await expect(trace.getByText('数组 #2')).toHaveCount(0);
  await trace.getByRole('button', { name: '到最后一步' }).click();
  await expect(page.getByTestId('java-output')).toHaveText('19');
});
