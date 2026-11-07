import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openCurrentAnswer, submitCurrent } from './current-course-helpers';
import { watch } from './achievement-helpers';

const course = JSON.parse(readFileSync('content/cpp/course/exercises-1.0.0.json', 'utf8')) as {
  id: string;
  lesson: string;
  source: string;
  cases: { expected: string }[];
}[];
const profile = course.find((row) => row.lesson === 'cpp.book.5-2')!;
const lesson = '/#/cpp/lesson/' + profile.lesson;
const practice = '/#/cpp/practice/' + profile.id;
const workbench = '/#/cpp/workbench';
const editor = (page: Page) => page.getByRole('textbox', { name: 'C++ 源码', exact: true });
const ready = (page: Page) =>
  expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
const saved = '草稿已保存到此浏览器。';
const judged = '判题结果已记入本地复盘。';

test('quota and tab conflicts retain C++ edits and an explicit retry can save them', async ({
  page,
  context,
}) => {
  await page.goto(workbench);
  await expect(editor(page)).toBeEditable();
  const other = await context.newPage();
  await other.goto(workbench);
  await expect(editor(other)).toBeEditable();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'cppDrafts') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('test quota', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  await editor(page).fill('int main(){return 4;}');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('S_QUOTA');
  await expect(editor(page)).toHaveValue('int main(){return 4;}');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(saved)).toBeVisible();
  await editor(other).fill('int main(){return 8;}');
  await other.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('另一页面更新了草稿');
  await expect(editor(other)).toHaveValue('int main(){return 8;}');
  await other.getByRole('button', { name: '以当前代码保存', exact: true }).click();
  await expect(other.getByText(saved)).toBeVisible();
  await other.reload();
  await expect(editor(other)).toHaveValue('int main(){return 8;}');
});

type Rows = Record<string, { keys: IDBValidKey[]; values: Record<string, unknown>[] }>;
async function archive(page: Page) {
  return page.evaluate(async () => {
    const wait = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const db = await wait(indexedDB.open('c-viz-learning'));
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names);
      const rows: Rows = Object.fromEntries(
        await Promise.all(
          names.map(async (name) => {
            const store = tx.objectStore(name);
            const [keys, values] = await Promise.all([
              wait(store.getAllKeys()),
              wait(store.getAll()),
            ]);
            return [name, { keys, values }];
          }),
        ),
      );
      return { version: db.version, rows };
    } finally {
      db.close();
    }
  });
}

test('clearing the archive invalidates a pending C++ verdict and leaves the new generation empty', async ({
  page,
  context,
}) => {
  await page.goto(practice);
  await editor(page).fill(profile.source);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(saved)).toBeVisible();
  const before = await archive(page);
  const settings = await context.newPage();
  await settings.goto('/#/settings?panel=data');
  await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await expect(settings.getByRole('heading', { name: '确认清除本地数据' })).toBeVisible();
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      setTimeout(() => Reflect.apply(send, this, args), 650);
    };
  });
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText('正在提交判题…')).toBeVisible();
  await settings.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect
    .poll(async () => (await archive(page)).rows.meta.values[0].generation)
    .not.toBe(before.rows.meta.values[0].generation);
  await expect(editor(page)).not.toHaveValue(profile.source);
  await expect(page.getByTestId('cpp-trace')).toHaveCount(0);
  const after = await archive(page);
  expect(after.rows.cppDrafts.values).toEqual([]);
  expect(after.rows.cppActivities.values).toEqual([]);
  expect(after.rows.ledger.values).toEqual([]);
});

test('public catalog, automatic reading, four-group judgement, replay and refresh share the C++ course', async ({
  page,
}) => {
  await page.goto('/#/');
  await ready(page);
  await page.getByRole('link', { name: 'C++ 课程', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'C++ 课程', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索目录' }).fill('5.2');
  await page.getByRole('link', { name: /^5\.2 /u }).click();
  await expect(page).toHaveURL(/cpp\.book\.5-2$/u);
  const readingEnd = page.getByTestId('reading-end');
  await expect(readingEnd).toBeAttached();
  await page.bringToFront();
  await expect(async () => {
    await page.keyboard.press('End');
    await expect(readingEnd).toHaveAttribute('data-read-today', 'true', { timeout: 800 });
  }).toPass({ timeout: 8000 });
  await page.keyboard.press('End');
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read-today', 'true');
  await page.getByRole('link', { name: '打开练习' }).click();
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText(judged)).toBeVisible();
  await expect(page.getByText('尚未全部通过')).toBeVisible();
  await editor(page).fill(profile.source);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(saved)).toBeVisible();
  await page.getByRole('button', { name: '提交判题' }).click();
  await expect(page.getByText(judged)).toBeVisible();
  await expect(page.getByText('四组均通过', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复盘第 2 组 · 通过' }).click();
  await expect(page.getByRole('button', { name: '复盘第 2 组 · 通过' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '到最后一步' }).click();
  await expect(page.getByTestId('cpp-output')).toHaveText('1');
  await page.getByRole('button', { name: '回到开头' }).click();
  await expect(page.getByTestId('cpp-output')).toHaveText('暂无输出');
  await page.getByRole('link', { name: '查看本地复盘' }).click();
  await page.reload();
  await expect(page.getByText('四组均通过', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /^do.*while循环$/u }).click();
  await expect(editor(page)).toHaveValue(profile.source);
  const data = await archive(page);
  expect(data.version).toBe(14);
  expect(Object.keys(data.rows)).toHaveLength(27);
  expect(data.rows.cppActivities.values).toHaveLength(2);
  expect(data.rows.cppDrafts.values[0].source).toBe(profile.source);
  expect(data.rows.ledger.values.filter((row) => row.subjectId === profile.id)).toHaveLength(1);
  expect(
    data.rows.dailyFacts.values.filter(
      (row) => (row.subjectRef as { id: string })?.id === profile.lesson,
    ),
  ).toHaveLength(1);
});

test('Blockly applies to the same C++ source and an unsupported mapping preserves the draft', async ({
  page,
}) => {
  await page.goto(workbench);
  await ready(page);
  const source = '#include <iostream>\nint main(){int n=3; std::cout << n << std::endl;}';
  await editor(page).fill(source);
  await page.getByRole('button', { name: '切换到积木' }).click();
  const canvas = page.getByLabel('C++ Blockly 积木画布', { exact: true });
  await expect(canvas.locator('.blocklySvg')).toBeVisible();
  await canvas.getByRole('button', { name: 'Edit text: 3', exact: true }).click();
  await page.locator('input.blocklyHtmlInput').fill('8');
  await page.locator('input.blocklyHtmlInput').press('Enter');
  await page.getByRole('button', { name: '应用积木到代码' }).click();
  await expect(editor(page)).toHaveValue(/int n = 8;/u);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.getByRole('button', { name: '到最后一步' }).click();
  await expect(page.getByTestId('cpp-output')).toHaveText('8');
  const pointer = '#include <iostream>\nint main(){int n=3; int* p=&n; std::cout<<*p;}';
  await editor(page).fill(pointer);
  await expect(page.getByTestId('cpp-trace')).toHaveCount(0);
  await page.getByRole('button', { name: '切换到积木' }).click();
  await expect(page.getByRole('alert')).toContainText('保留原稿');
  await expect(editor(page)).toHaveValue(pointer);
});

test('all four exports come from the selected source, input and cursor', async ({ page }) => {
  await page.goto('/#/cpp/example/' + profile.lesson);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  for (const format of ['JSON', 'Markdown', 'PNG', 'ZIP']) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `导出 ${format}`, exact: true }).click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = readFileSync(path!);
    if (format === 'JSON')
      expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({
        language: 'cpp',
        source: { text: profile.source },
        position: { cursor: 1 },
        input: { values: [5] },
      });
    if (format === 'Markdown') expect(bytes.toString('utf8')).toContain('C++ · 步骤 1');
    if (format === 'PNG') expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    if (format === 'ZIP') expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  }
});

test('native DB12 upgrade preserves keys and authentic C, Python, Java and C++ algorithm records', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  await openCurrentAnswer(page, 'exercise.c6.s10.1.1');
  await submitCurrent(page);
  await watch(page, 'hanoi');
  for (const target of [
    {
      path: '/#/python/practice/py3.practice.greeting',
      label: 'Python 代码',
      file: 'tests/fixtures/python3-reference.json',
      name: 'greeting',
    },
    {
      path: '/#/java/practice/java.practice.utf16-length',
      label: 'Java 代码',
      file: 'tests/fixtures/java-reference.json',
      name: 'utf16-length',
    },
  ]) {
    await page.goto(target.path);
    const sources = JSON.parse(readFileSync(target.file, 'utf8')) as Record<string, string>;
    await page.getByRole('textbox', { name: target.label, exact: true }).fill(sources[target.name]);
    await page.getByRole('button', { name: '保存草稿' }).click();
    await expect(page.getByText('草稿已保存到本机。')).toBeVisible();
    await page.getByRole('button', { name: '提交判题' }).click();
    await expect(page.getByText('判题结果已保存到本机。')).toBeVisible();
  }
  const original = await archive(page);
  const prior = Object.fromEntries(
    Object.entries(original.rows).filter(
      ([name]) => !name.startsWith('cpp') && !name.startsWith('rust'),
    ),
  );
  prior.meta.values[0] = {
    ...prior.meta.values[0],
    dbVersion: 12,
    schemaVersion: '12.0.0',
    activeCatalogSetRef: { id: 'catalog-set.c-python-java', version: '1.0.0' },
  };
  expect(prior.courseActivities.values.length).toBeGreaterThan(0);
  expect(prior.pythonActivities.values.length).toBeGreaterThan(0);
  expect(prior.javaActivities.values.length).toBeGreaterThan(0);
  expect(JSON.stringify(prior.achievements.values)).toContain('observation.stack.hanoi');
  const context = await browser.newContext({ baseURL });
  try {
    const migrated = await context.newPage();
    await migrated.route('**/cpp-db12', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>DB12 fixture</title>' }),
    );
    await migrated.goto('/cpp-db12');
    await migrated.evaluate(async (payload: unknown) => {
      const rows = payload as Rows;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning', 12);
        request.onupgradeneeded = () => {
          for (const [name, table] of Object.entries(rows)) {
            const store = request.result.createObjectStore(name);
            table.keys.forEach((key, i) => store.add(table.values[i], key));
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });
    }, prior as unknown);
    expect((await archive(migrated)).version).toBe(12);
    await migrated.goto(lesson);
    await ready(migrated);
    const upgraded = await archive(migrated);
    expect(upgraded.version).toBe(14);
    for (const [name, table] of Object.entries(prior))
      if (name !== 'meta') expect(upgraded.rows[name], name).toEqual(table);
    expect(upgraded.rows.cppDrafts.values).toEqual([]);
    expect(upgraded.rows.cppActivities.values).toEqual([]);
    await migrated.goto(practice);
    await editor(migrated).fill(profile.source);
    await migrated.getByRole('button', { name: '保存草稿' }).click();
    await expect(migrated.getByText(saved)).toBeVisible();
    await migrated.getByRole('button', { name: '提交判题' }).click();
    await expect(migrated.getByText(judged)).toBeVisible();
    await migrated.reload();
    await expect(editor(migrated)).toHaveValue(profile.source);
    const final = await archive(migrated);
    for (const name of ['courseActivities', 'pythonActivities', 'javaActivities', 'achievements'])
      expect(final.rows[name]).toEqual(prior[name]);
    await info.attach('db12-to-db14', {
      body: JSON.stringify({ prior, upgraded, final }),
      contentType: 'application/json',
    });
  } finally {
    await context.close();
  }
});
