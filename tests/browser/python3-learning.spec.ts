import { editorValue, expectEditorValue } from './editor-value';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { PythonArticle } from '../../web/src/python3/content-types';
import { openCurrentAnswer, submitCurrent } from './current-course-helpers';
import { watch } from './achievement-helpers';

const activeRelease = JSON.parse(
  readFileSync(
    'content/build/' +
      JSON.parse(readFileSync('content/build/python3-course-current.json', 'utf8')).releaseFile,
    'utf8',
  ),
) as { manifestFile: string };
const activeManifest = JSON.parse(
  readFileSync('content/python3/course/' + activeRelease.manifestFile, 'utf8'),
) as { chunks: { articleSourceOrder: number; file: string }[] };

const course = JSON.parse(
  readFileSync('content/python3/course/article-01-1.0.0.json', 'utf8'),
) as PythonArticle;
const greeting = course.nodes.find((node) => node.questionId === 'py3.practice.greeting')!;
const sample = JSON.parse(readFileSync('tests/fixtures/python3-reference.json', 'utf8')) as Record<
  string,
  string
>;
const practice = '/#/python/practice/py3.practice.greeting';
const lesson = '/#/python/article/1/' + greeting.platformRef.id;
const code = (page: Page) => page.getByRole('textbox', { name: 'Python 代码', exact: true });

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

test('published Python course loads one article, saves reading independently and restores real judge and draft', async ({
  page,
}) => {
  const assets: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes('/content/python3/course/') &&
      new URL(request.url()).pathname.endsWith('.json')
    )
      assets.push(new URL(request.url()).pathname.split('/').at(-1)!);
  });
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Python 课程', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Python 3 课程', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Python 测验（来源参考）' })).toHaveCount(1);
  expect(assets).toEqual([activeRelease.manifestFile]);
  await page.getByRole('link', { name: 'Python 3 教程', exact: true }).click();
  await page.getByRole('link', { name: greeting.titleDisplay, exact: true }).first().click();
  await expect(
    page.getByRole('heading', { name: greeting.titleDisplay, exact: true }),
  ).toBeVisible();
  expect(assets).toEqual([
    activeRelease.manifestFile,
    activeManifest.chunks.find((entry) => entry.articleSourceOrder === 1)!.file,
  ]);
  await page.keyboard.press('End');
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read-today', 'true');
  await page.keyboard.press('End');
  const read = await archive(page);
  expect(read.version).toBe(15);
  expect(Object.keys(read.rows)).toHaveLength(29);
  expect(read.rows.pythonActivities.values).toHaveLength(1);
  expect(
    read.rows.ledger.values.filter((row) => row.subjectId === greeting.platformRef.id),
  ).toHaveLength(1);
  expect(
    read.rows.dailyFacts.values.filter((row) => row.subjectRef?.id === greeting.platformRef.id),
  ).toHaveLength(1);

  await page.getByRole('link', { name: '打开练习', exact: true }).click();
  await code(page).fill(sample.greeting);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存到本机。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText('判题结果已保存到本机。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /第 [1-4] 组 · 通过/ })).toHaveCount(4);
  await expect(page.getByTestId('python-output')).toHaveText('你好，小林');
  await page.getByRole('button', { name: '回到开头', exact: true }).click();
  await expect(page.getByTestId('python-output')).toHaveText('（当前无输出）');
  await page.getByRole('button', { name: '到最后一步', exact: true }).click();
  await expect(page.getByTestId('python-output')).toHaveText('你好，小林');
  await page.getByRole('link', { name: '查看本地复盘记录' }).click();
  await page.reload();
  await expect(page.getByText('四组全部通过', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '再次练习', exact: true }).click();
  await expectEditorValue(code(page), sample.greeting);
  await expect(page.getByText('此题已通过并保存在本机。')).toBeVisible();
  const after = await archive(page);
  expect(after.rows.pythonActivities.values).toHaveLength(2);
  expect(after.rows.pythonDrafts.values[0].source).toBe(sample.greeting);
  expect(
    after.rows.ledger.values.filter((row) => row.subjectId === 'py3.practice.greeting'),
  ).toHaveLength(1);
});

test('real Blockly round trip preserves if/else and loop semantics and retains unsupported original code', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#/python/workbench');
  const source =
    'i = 3\nfor n in range(i):\n    if n % 2:\n        print(n)\n    else:\n        pass\nwhile i:\n    i = i-1\nprint(i)\n';
  await code(page).fill(source);
  await page.getByRole('button', { name: '运行代码' }).click();
  await expect(page.getByTestId('python-output')).toHaveText('1\n0');
  await page.getByRole('button', { name: '积木', exact: true }).click();
  await expect(page.locator('.python-block-canvas .blocklySvg')).toBeVisible();
  await page.getByRole('button', { name: '应用积木到代码', exact: true }).click();
  await expect(page.getByRole('button', { name: '运行代码' })).toBeEnabled();
  await page.getByRole('button', { name: '代码', exact: true }).click();
  expect(await editorValue(code(page))).toContain('else:\n        pass');
  await page.getByRole('button', { name: '运行代码' }).click();
  await expect(page.getByTestId('python-output')).toHaveText('1\n0');
  await page.getByRole('button', { name: '积木', exact: true }).click();
  const literal = page
    .locator('.python-block-canvas')
    .getByRole('button', { name: 'Edit text: 3', exact: true });
  await literal.click();
  await page.locator('input.blocklyHtmlInput').fill('4');
  await page.locator('input.blocklyHtmlInput').press('Enter');
  await expect(page.getByText(/积木修改尚未应用/)).toBeVisible();
  await page.getByRole('button', { name: '应用积木到代码', exact: true }).click();
  await page.getByRole('button', { name: '运行代码' }).click();
  await expect(page.getByTestId('python-output')).toHaveText('1\n3\n0');
  await page.getByRole('button', { name: '代码', exact: true }).click();
  const unsupported = '# keep this exactly\nx = [1]\nprint(x[0])\n';
  await code(page).fill(unsupported);
  await page.getByRole('button', { name: '积木', exact: true }).click();
  await expect(page.getByText(/代码原稿已保留/)).toBeVisible();
  await expectEditorValue(code(page), unsupported);
  expect(errors).toEqual([]);
});

test('native draft quota failure and tab conflict preserve editable source and permit explicit retry', async ({
  page,
  context,
}) => {
  await page.goto(practice);
  await expectEditorValue(code(page), 'pass\n');
  const other = await context.newPage();
  await other.goto(practice);
  await expectEditorValue(code(other), 'pass\n');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'pythonDrafts') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('injected storage quota', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  await code(page).fill(sample.greeting);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('S_QUOTA');
  await expectEditorValue(code(page), sample.greeting);
  expect((await archive(page)).rows.pythonDrafts.values).toHaveLength(0);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存到本机。')).toBeVisible();
  await code(other).fill('print(123)');
  await other.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('另一页面更新了草稿');
  await expectEditorValue(code(other), 'print(123)');
  other.once('dialog', (dialog) => void dialog.accept());
  await other.getByRole('button', { name: '以当前代码保存' }).click();
  await expect(other.getByText('草稿已保存到本机。')).toBeVisible();
  await other.reload();
  await expectEditorValue(code(other), 'print(123)');
});

test('editing during a live judge invalidates the old result and its save proof', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      setTimeout(() => Reflect.apply(send, this, args), 200);
    };
  });
  await page.goto(practice);
  await code(page).fill(sample.greeting);
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText('正在判题', { exact: true })).toBeVisible();
  await code(page).fill("print('changed')");
  await expect(page.getByRole('button', { name: '提交判题', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByTestId('python-output')).toHaveText('changed');
  await expect(page.getByRole('heading', { name: '判题结果' })).toHaveCount(0);
  expect((await archive(page)).rows.pythonActivities.values).toHaveLength(0);
});

test('native DB10 upgrade preserves real C exercise and C++ algorithm observation records before Python use', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  await openCurrentAnswer(page, 'exercise.c6.s10.1.1');
  await submitCurrent(page);
  await watch(page, 'functions');
  const hanoi = await page.context().newPage();
  await watch(hanoi, 'hanoi');
  await hanoi.close();
  const original = await archive(page);
  expect(
    original.rows.progress.values.some(
      (r) => r.eventType === 'exercise.passed' && r.subjectRef?.id === 'exercise.c6.s10.1.1',
    ),
  ).toBe(true);
  expect(JSON.stringify(original.rows.achievements.values)).toContain('observation.stack.hanoi');
  const prior = Object.fromEntries(
    Object.entries(original.rows).filter(
      ([name]) =>
        !name.startsWith('python') &&
        !name.startsWith('java') &&
        !name.startsWith('cpp') &&
        !name.startsWith('rust') &&
        !name.startsWith('mysql'),
    ),
  );
  prior.meta.values[0] = {
    ...prior.meta.values[0],
    schemaVersion: '10.0.0',
    dbVersion: 10,
    activeCatalogSetRef: { id: 'catalog-set.c.primer6', version: '2.0.0' },
  };
  const context = await browser.newContext({ baseURL });
  const migrated = await context.newPage();
  try {
    await migrated.route('**/python-migration-fixture', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Migration fixture</title>' }),
    );
    await migrated.goto('/python-migration-fixture');
    await migrated.evaluate(async (payload) => {
      const rows = JSON.parse(payload) as TestRows;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning', 10);
        request.onupgradeneeded = () => {
          for (const [name, stored] of Object.entries(rows)) {
            const store = request.result.createObjectStore(name);
            stored.keys.forEach((key, index) => store.add(stored.values[index], key));
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });
    }, JSON.stringify(prior));
    expect((await archive(migrated)).version).toBe(10);
    await migrated.goto(lesson);
    await expect(migrated.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
    const upgraded = await archive(migrated);
    expect(upgraded.version).toBe(15);
    expect(upgraded.rows.pythonActivities.values).toEqual([]);
    expect(upgraded.rows.pythonDrafts.values).toEqual([]);
    for (const [name, rows] of Object.entries(prior)) {
      if (name === 'meta') continue;
      expect(upgraded.rows[name], name).toEqual(rows);
    }
    expect(upgraded.rows.meta.values[0]).toMatchObject({
      ...prior.meta.values[0],
      dbVersion: 15,
      schemaVersion: '15.0.0',
      activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp-rust-mysql', version: '1.0.0' },
    });
    const readingEnd = migrated.getByTestId('reading-end');
    await expect(readingEnd).toBeAttached();
    await migrated.bringToFront();
    await expect(async () => {
      await migrated.keyboard.press('End');
      await expect(readingEnd).toHaveAttribute('data-read-today', 'true', { timeout: 800 });
    }).toPass({ timeout: 8000 });
    await migrated.getByRole('link', { name: '打开练习', exact: true }).click();
    await code(migrated).fill(sample.greeting);
    await migrated.getByRole('button', { name: '保存草稿' }).click();
    await expect(migrated.getByText('草稿已保存到本机。')).toBeVisible();
    await migrated.getByRole('button', { name: '提交判题' }).click();
    await expect(migrated.getByText('判题结果已保存到本机。')).toBeVisible();
    await migrated.getByRole('link', { name: '查看本地复盘记录' }).click();
    await migrated.reload();
    await expect(migrated.getByText('四组全部通过', { exact: true })).toBeVisible();
    const final = await archive(migrated);
    for (const name of ['courseActivities', 'courseDrafts', 'achievements'])
      expect(final.rows[name]).toEqual(prior[name]);
    const oldRewardKeys = new Set(prior.ledger.keys.map((key) => JSON.stringify(key)));
    expect(
      final.rows.ledger.values.filter((_, i) =>
        oldRewardKeys.has(JSON.stringify(final.rows.ledger.keys[i])),
      ),
    ).toEqual(prior.ledger.values);
    await info.attach('native-upgrade-and-final-archive', {
      body: JSON.stringify({ prior, upgraded, final }),
      contentType: 'application/json',
    });
  } finally {
    await context.close();
  }
});

test('explicit clear changes the generation, clears both Python stores and rejects a pending judge', async ({
  page,
  context,
}) => {
  await page.goto(practice);
  await code(page).fill(sample.greeting);
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
  await expectEditorValue(code(page), 'pass\n');
  const after = await archive(page);
  expect(after.rows.pythonDrafts.values).toEqual([]);
  expect(after.rows.pythonActivities.values).toEqual([]);
  expect(after.rows.ledger.values).toEqual([]);
  await code(page).fill(sample.greeting);
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText('判题结果已保存到本机。')).toBeVisible();
});

test('a real Python failure creates one topic and review, a passing attempt closes the error', async ({
  page,
}) => {
  await page.goto(practice);
  await code(page).fill("print('wrong')");
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText('判题结果已保存到本机。')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('link', { name: '查看本地复盘记录' }).click();
  await expect(page.getByText('输出与预期不符 · 第 1 组')).toBeVisible();
  await expect(page.getByRole('button', { name: '记得', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '记得', exact: true }).click();
  await expect
    .poll(async () => (await archive(page)).rows.reviewCards.values[0]?.reviewCount)
    .toBe(1);
  await page.goto('/#/weaknesses');
  await expect(page.locator('[data-weakness-id="py3.knowledge.greeting"]')).toHaveAttribute(
    'data-recommended',
    'yes',
  );
  await page.goto(practice);
  await code(page).fill(sample.greeting);
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText('判题结果已保存到本机。')).toBeVisible();
  await expect
    .poll(async () => (await archive(page)).rows.reviewCards.values[0]?.state)
    .toBe('repaired');
});

test('snapshot preview and four local download formats retain the same Python run and cursor', async ({
  page,
}, info) => {
  await page.goto('/#/python/workbench');
  await page.getByRole('button', { name: '运行代码' }).click();
  await expect(page.getByTestId('python-output')).toHaveText('0\n1\n3\n6');
  await expect(
    page
      .getByTestId('python-trace')
      .locator('dt')
      .filter({ hasText: /^total$/u }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: '上一步' }).click();
  const cursor = Number(await page.getByTestId('python-trace').getAttribute('data-cursor'));
  const output = await page.getByTestId('python-output').textContent();
  await page.getByRole('button', { name: '预览当前快照' }).click();
  await expect(page.getByRole('dialog', { name: 'Python 快照预览' })).toBeVisible();
  const signatures = { PNG: '89504e470d0a1a0a', ZIP: '504b0304' };
  for (const format of ['JSON', 'PNG', 'MD', 'ZIP'] as const) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 ' + format }).click();
    const downloaded = await download;
    const path = await downloaded.path();
    const bytes = readFileSync(path);
    if (format === 'JSON') {
      const snapshot = JSON.parse(bytes.toString('utf8'));
      expect(snapshot.formatVersion).toBe('3.0.0');
      expect(snapshot.runtime.language).toBe('python');
      expect(snapshot.position.cursor).toBe(cursor);
      expect(snapshot.currentState.output).toBe(output);
    } else if (format === 'MD') {
      expect(bytes.toString('utf8')).toContain('当前步骤 ' + cursor + '/');
    } else expect(bytes.toString('hex').startsWith(signatures[format])).toBe(true);
    await info.attach('python-snapshot-' + format.toLowerCase(), {
      body: bytes,
      contentType: 'application/octet-stream',
    });
    await expect(page.getByText('已交给浏览器下载。')).toBeVisible();
  }
  await page.getByRole('button', { name: '关闭预览' }).click();
});

test('a new day records another reading without awarding the same Python lesson twice', async ({
  page,
}) => {
  const today = new Date();
  await page.clock.setFixedTime(today);
  await page.goto(lesson);
  await expect(page.getByTestId('reading-end')).toBeAttached();
  await page.keyboard.press('End');
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read-today', 'true');
  await page.clock.setFixedTime(new Date(today.getTime() + 24 * 60 * 60 * 1000));
  await page.reload();
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read-today', 'false');
  await page.keyboard.press('End');
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read-today', 'true');
  const current = await archive(page);
  expect(
    current.rows.dailyFacts.values.filter((row) => row.subjectRef?.id === greeting.platformRef.id),
  ).toHaveLength(2);
  expect(
    current.rows.ledger.values.filter((row) => row.subjectId === greeting.platformRef.id),
  ).toHaveLength(1);
});

test('a failed judge save rolls back activity and reward and retries once from the same accepted result', async ({
  page,
}) => {
  await page.goto(practice);
  await code(page).fill(sample.greeting);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'receipts' && value?.subjectRef?.id === 'py3.practice.greeting') {
        IDBObjectStore.prototype.add = add;
        throw new DOMException('injected quota failure', 'QuotaExceededError');
      }
      return add.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText('四组全部通过', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('S_QUOTA');
  const failed = await archive(page);
  expect(failed.rows.pythonActivities.values).toEqual([]);
  expect(failed.rows.ledger.values).toEqual([]);
  expect(failed.rows.receipts.values).toEqual([]);
  await page.getByRole('button', { name: '重试保存结果' }).click();
  await expect(page.getByText('判题结果已保存到本机。')).toBeVisible();
  const saved = await archive(page);
  expect(saved.rows.pythonActivities.values).toHaveLength(1);
  expect(saved.rows.ledger.values).toHaveLength(1);
  expect(saved.rows.receipts.values).toHaveLength(1);
});
