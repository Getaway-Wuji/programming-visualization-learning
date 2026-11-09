import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { MysqlManifest } from '../../web/src/mysql-course/repository';
import type { MysqlProfile, MysqlSession } from '../../web/src/engine/mysql-types';

const manifest = JSON.parse(
  readFileSync('content/mysql/course/manifest-1.0.0.json', 'utf8'),
) as MysqlManifest;
const profiles = JSON.parse(
  readFileSync('content/mysql/course/exercises-1.0.0.json', 'utf8'),
) as MysqlProfile[];
const projection = profiles.find((p) => p.id === 'mysql.exercise.projection')!;
const workbench = '/#/mysql/workbench';
const editor = (page: Page) => page.getByRole('textbox', { name: 'SQL 源码', exact: true });
const trace = (page: Page) => page.getByTestId('mysql-trace');
const result = (page: Page) => page.getByTestId('mysql-result');
const database = (page: Page) => page.getByTestId('mysql-database');
const saved = 'SQL 和数据库草稿已保存到此浏览器。';
const judged = '判题结果已记入本地复盘。';
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
      const names = Array.from(db.objectStoreNames),
        tx = db.transaction(names);
      const rows: Rows = Object.fromEntries(
        await Promise.all(
          names.map(async (name) => {
            const store = tx.objectStore(name);
            const [keys, values] = await Promise.all([
              wait(store.getAllKeys()),
              wait(store.getAll()) as Promise<Record<string, unknown>[]>,
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
const ready = (page: Page) =>
  expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
async function run(page: Page, sql?: string) {
  if (sql !== undefined) await editor(page).fill(sql);
  await page.getByRole('button', { name: '运行 SQL', exact: true }).click();
  await expect(trace(page)).toBeVisible();
  await expect
    .poll(async () => trace(page).getAttribute('data-cursor'))
    .toBe(await trace(page).getAttribute('data-length'));
}
async function cells(page: Page) {
  return result(page)
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll('td')).map((td) => td.textContent)),
    );
}
// Independent display oracle: empty or boundary-whitespace/control-bearing text is
// JSON quoted; ordinary text and exact numeric strings remain unchanged.
function show(cell: { kind: string; value?: string | number }) {
  if (cell.kind === 'null') return 'NULL';
  if (cell.kind !== 'text') return String(cell.value);
  const text = String(cell.value);
  const control = [...text].some((character) => {
    const point = character.codePointAt(0)!;
    return point <= 0x1f || point === 0x7f;
  });
  return !text.length || /^\s|\s$/u.test(text) || control ? JSON.stringify(text) : text;
}
function pngRecord(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset),
      data = bytes.subarray(offset + 8, offset + 8 + length);
    expect(offset + length + 12).toBeLessThanOrEqual(bytes.length);
    const prefix = Buffer.from('c-viz.snapshot\0\0\0\0\0');
    if (
      bytes.toString('ascii', offset + 4, offset + 8) === 'iTXt' &&
      data.subarray(0, prefix.length).equals(prefix)
    )
      return JSON.parse(data.subarray(prefix.length).toString('utf8')) as Record<string, unknown>;
    offset += length + 12;
  }
  throw new Error('PNG snapshot metadata was absent');
}
function zipEntries(bytes: Buffer) {
  const files: Record<string, Buffer> = {};
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0);
    const size = bytes.readUInt32LE(offset + 18),
      nameLength = bytes.readUInt16LE(offset + 26),
      extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString('utf8', offset + 30, offset + 30 + nameLength),
      start = offset + 30 + nameLength + extraLength;
    files[name] = bytes.subarray(start, start + size);
    offset = start + size;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}

test('MySQL public catalog preserves all numbered nodes, parent guides, source distinctions and independent automatic reading', async ({
  page,
}) => {
  await page.goto('/#/');
  await ready(page);
  await page.getByRole('link', { name: 'MySQL 课程', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'MySQL 课程', exact: true })).toBeVisible();
  const catalog = page.getByRole('region', { name: '教材目录', exact: true });
  const links = catalog.locator('a[href^="#/mysql/lesson/"]');
  await expect(links).toHaveCount(374);
  expect(await links.evaluateAll((rows) => rows.map((row) => row.getAttribute('href')))).toEqual(
    manifest.catalog.map((node) => '#/mysql/lesson/' + node.id),
  );
  await expect(page.getByRole('progressbar', { name: 'MySQL 阅读进度' })).toHaveAttribute(
    'max',
    '300',
  );
  await page.getByRole('searchbox', { name: '搜索目录', exact: true }).fill('7.1.3');
  await expect(
    catalog.getByRole('link', {
      name: '7.1.3 ' + manifest.catalog.find((n) => n.number === '7.1.3')!.title,
      exact: true,
    }),
  ).toBeVisible();
  const parent = manifest.catalog.find((node) => !node.leaf && node.coverage === 'toc-only')!;
  await page.goto('/#/mysql/lesson/' + parent.id);
  await expect(
    page.getByRole('heading', { name: parent.number + ' ' + parent.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('所附 PDF 仅含本节目录', { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId('reading-end')).toHaveCount(0);
  const reading = manifest.catalog.find((node) => node.id === 'mysql.lesson.1.1.1')!;
  await page.goto('/#/mysql/lesson/' + reading.id);
  await ready(page);
  await expect(
    page.getByRole('heading', { name: reading.number + ' ' + reading.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '理解自检', exact: true })).toBeVisible();
  await page.getByText('核对答案', { exact: true }).click();
  const end = page.getByTestId('reading-end');
  await page.bringToFront();
  await expect(async () => {
    await page.keyboard.press('End');
    await expect(end).toHaveAttribute('data-read-today', 'true', { timeout: 800 });
  }).toPass({ timeout: 10000 });
  const once = await archive(page);
  expect(once.version).toBe(15);
  expect(once.rows.mysqlActivities.values).toHaveLength(1);
  expect(once.rows.mysqlActivities.values[0].kind).toBe('lesson');
  expect(once.rows.mysqlActivities.values.some((row) => row.kind === 'exercise')).toBe(false);
  await page.reload();
  await page.keyboard.press('End');
  await expect(end).toHaveAttribute('data-read-today', 'true');
  expect((await archive(page)).rows.ledger.values).toEqual(once.rows.ledger.values);
});

for (const profile of profiles)
  test(`MySQL visible example and all four initial databases / ${profile.id}`, async ({ page }) => {
    await page.goto('/#/mysql/example/' + profile.lessonId);
    await expect(editor(page)).toHaveValue(profile.referenceSource);
    for (const group of profile.cases) {
      if (group.index)
        await page
          .getByRole('combobox', { name: '初始数据组', exact: true })
          .selectOption(String(group.index));
      await run(page);
      const expected = group.expectedResult;
      if (expected.kind === 'query')
        expect(await cells(page)).toEqual(expected.rows.map((row) => row.map(show)));
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '导出 JSON', exact: true }).click(),
      ]);
      const snapshot = JSON.parse(readFileSync((await download.path())!, 'utf8'));
      expect(snapshot.initialSession).toEqual(group.session);
      expect(snapshot.state.result).toEqual(expected);
      expect(snapshot.state.session.transaction.active).toBe(group.expectedTransactionActive);
      expect(
        snapshot.state.session.database.tables.map(
          (table: { name: string; columns: unknown; rows: { values: unknown }[] }) => ({
            name: table.name,
            columns: table.columns,
            rows: table.rows.map((row) => row.values),
          }),
        ),
      ).toEqual(group.expectedDatabase.tables);
    }
    await expect(page.locator('.blocklySvg')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        performance.getEntriesByType('resource').some((entry) => /blockly/iu.test(entry.name)),
      ),
    ).toBe(false);
  });

test('MySQL live database and query results start at the accepted end state and reverse together', async ({
  page,
}) => {
  await page.goto(workbench);
  const source =
    '-- 字🙂，原始 SQL\nUPDATE students SET score = 0 WHERE id = 1;\nSELECT id, score FROM students ORDER BY id;';
  await run(page, source);
  expect(await cells(page)).toEqual([
    ['1', '0'],
    ['2', '72'],
    ['3', 'NULL'],
    ['4', '59'],
  ]);
  const end = await database(page)
    .getByRole('region', { name: 'students 数据', exact: true })
    .innerText();
  await expect(database(page).getByRole('row').filter({ hasText: '林安' })).toContainText('0');
  await trace(page).getByRole('button', { name: '回到开头', exact: true }).click();
  await expect(result(page)).toContainText('运行 SQL 后');
  await expect(database(page).getByRole('row').filter({ hasText: '林安' })).toContainText('88');
  await expect(page.getByRole('button', { name: '运行 SQL', exact: true })).toBeDisabled();
  await trace(page).getByRole('button', { name: '下一步', exact: true }).click();
  await trace(page)
    .getByRole('button', { name: /^定位第 1 行/u })
    .click();
  const selected = await editor(page).evaluate((element: HTMLTextAreaElement) => ({
    text: element.value.slice(element.selectionStart, element.selectionEnd),
    before: element.value.slice(0, element.selectionStart),
  }));
  expect(selected.text).toBe('-- 字🙂，原始 SQL\nUPDATE students SET score = 0 WHERE id = 1');
  expect(selected.before).toBe('');
  await trace(page).getByRole('button', { name: '回到当前数据库', exact: true }).click();
  expect(
    await database(page).getByRole('region', { name: 'students 数据', exact: true }).innerText(),
  ).toBe(end);
  await trace(page)
    .getByRole('button', { name: /^定位第 3 行/u })
    .click();
  const finalSelection = await editor(page).evaluate((element: HTMLTextAreaElement) => ({
    text: element.value.slice(element.selectionStart, element.selectionEnd),
    before: element.value.slice(0, element.selectionStart),
  }));
  expect(finalSelection.text).toBe('SELECT id, score FROM students ORDER BY id');
  expect(finalSelection.before).toBe(
    '-- 字🙂，原始 SQL\nUPDATE students SET score = 0 WHERE id = 1;\n',
  );
  await editor(page).fill('SELECT id, score FROM students ORDER BY id;');
  await expect(trace(page)).toHaveCount(0);
  await expect(result(page)).toContainText('运行 SQL 后');
  await run(page);
  expect(await cells(page)).toEqual([
    ['1', '0'],
    ['2', '72'],
    ['3', 'NULL'],
    ['4', '59'],
  ]);
});

test('MySQL failing later statement retains the actual committed prefix and locates its SQL error', async ({
  page,
}) => {
  await page.goto(workbench);
  await run(
    page,
    "UPDATE students SET score = 9 WHERE id = 1;\nINSERT INTO students (id,name) VALUES (1,'重复');",
  );
  await expect(page.getByRole('status').filter({ hasText: 'E_CONSTRAINT' })).toBeVisible();
  await expect(
    page.getByText('表格保留先前已完成语句的状态，失败语句未产生部分写入。', { exact: true }),
  ).toBeVisible();
  await expect(database(page).getByRole('row').filter({ hasText: '林安' })).toContainText('9');
  await trace(page).getByRole('button', { name: '回到开头', exact: true }).click();
  await expect(database(page).getByRole('row').filter({ hasText: '林安' })).toContainText('88');
  await trace(page).getByRole('button', { name: '回到当前数据库', exact: true }).click();
  await run(page, 'SELECT score FROM students WHERE id=1;');
  expect(await cells(page)).toEqual([['9']]);
});

test('MySQL NULL, zero, empty string, empty table and exact decimal stay visibly distinct', async ({
  page,
}) => {
  await page.goto(workbench);
  await run(
    page,
    "SELECT NULL AS missing, 0 AS zero_value, '' AS empty_text, '夏禾 ' AS trailing_space, '夏禾' AS ordinary_text, AVG(score) AS average_score FROM students;",
  );
  expect(await cells(page)).toEqual([['NULL', '0', '""', '"夏禾 "', '夏禾', '73.0000']]);
  const textValues = await result(page).locator('td[data-kind="text"]').allTextContents();
  expect(textValues).toContain('"夏禾 "');
  expect(textValues).toContain('夏禾');
  expect(textValues[1]).not.toBe(textValues[2]);
  await expect(result(page).locator('td[data-kind="decimal"]')).toHaveText('73.0000');
  await expect(result(page).locator('td[data-kind="decimal"]')).toHaveCSS('text-align', 'right');
  await run(page, 'CREATE TABLE empty_notes (id INT PRIMARY KEY, title VARCHAR(64));');
  await database(page)
    .getByRole('combobox', { name: '数据表', exact: true })
    .selectOption('empty_notes');
  await expect(database(page)).toContainText('empty_notes 当前为 0 行，表结构仍然存在。');
  await expect(
    database(page).getByRole('region', { name: '字段类型与约束', exact: true }),
  ).toContainText('PRIMARY KEY');
  await run(page, 'SELECT * FROM empty_notes;');
  await expect(result(page)).toContainText('查询返回 0 行。');
  await expect(result(page).getByRole('columnheader')).toHaveCount(2);
});

test('MySQL transaction crosses requests and a refreshed atomic SQL/session draft restores without an execution proof', async ({
  page,
}) => {
  await page.goto(workbench);
  await run(page, 'BEGIN; UPDATE students SET score = 0 WHERE id=1;');
  await expect(page.getByTestId('mysql-transaction')).toContainText('事务进行中');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(saved)).toBeVisible();
  const draft = (await archive(page)).rows.mysqlDrafts.values[0];
  expect((draft.session as MysqlSession).transaction.active).toBe(true);
  await page.reload();
  await expect(editor(page)).toHaveValue('BEGIN; UPDATE students SET score = 0 WHERE id=1;');
  await expect(page.getByTestId('mysql-transaction')).toContainText('事务进行中');
  await expect(database(page).getByRole('row').filter({ hasText: '林安' })).toContainText('0');
  await expect(trace(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出 JSON', exact: true })).toHaveCount(0);
  await expect(result(page)).toContainText('运行 SQL 后');
  await run(page, 'ROLLBACK; SELECT score FROM students WHERE id=1;');
  expect(await cells(page)).toEqual([['88']]);
  await expect(page.getByTestId('mysql-transaction')).toContainText('当前无活动事务');
  await page.getByRole('button', { name: '重置数据库', exact: true }).click();
  await expect(editor(page)).toHaveValue('ROLLBACK; SELECT score FROM students WHERE id=1;');
  await expect(trace(page)).toHaveCount(0);
});

test('MySQL four-case judge ignores the modified live database and review creates no duplicate learning reward', async ({
  page,
}) => {
  await page.goto('/#/mysql/practice/' + projection.id);
  await run(page, 'DELETE FROM students;');
  await editor(page).fill(projection.referenceSource);
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText('四组均通过', { exact: true })).toBeVisible();
  await expect(page.getByText(judged, { exact: true })).toBeVisible();
  expect(await cells(page)).toEqual(
    projection.cases[0].expectedResult.rows.map((row) => row.map(show)),
  );
  const before = await archive(page);
  expect(before.rows.mysqlActivities.values).toHaveLength(1);
  await page.getByRole('button', { name: '复盘第 4 组', exact: true }).click();
  await expect(page.getByText('四组均通过', { exact: true })).toBeVisible();
  await expect(trace(page)).toBeVisible();
  expect(await cells(page)).toEqual(
    projection.cases[3].expectedResult.rows.map((row) => row.map(show)),
  );
  expect((await archive(page)).rows.mysqlActivities).toEqual(before.rows.mysqlActivities);
  expect((await archive(page)).rows.ledger).toEqual(before.rows.ledger);
  await editor(page).fill('SELECT 1;');
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText('尚未全部通过', { exact: true })).toBeVisible();
  await expect(page.getByText(judged, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(saved)).toBeVisible();
  await page.getByRole('link', { name: '本地判题记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MySQL 判题复盘', exact: true })).toBeVisible();
  await expect(page.getByText('查询结果不符', { exact: true })).toBeVisible();
  await expect(page.getByText('已有首次通过记录', { exact: true })).toBeVisible();
});

test('MySQL cancel and reset invalidate delayed requests while retaining the last accepted database', async ({
  page,
}) => {
  await page.goto(workbench);
  await run(page, 'UPDATE students SET score=7 WHERE id=1;');
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      const value = args[0];
      if (value && typeof value === 'object' && Object.hasOwn(value, 'remaining'))
        setTimeout(() => Reflect.apply(send, this, args), 350);
      else Reflect.apply(send, this, args);
    };
  });
  await editor(page).fill('DELETE FROM students;');
  await page.getByRole('button', { name: '运行 SQL', exact: true }).click();
  await expect(page.getByText('正在运行 SQL…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(database(page).getByRole('row').filter({ hasText: '林安' })).toContainText('7');
  await expect(trace(page)).toHaveCount(0);
  await run(page, 'SELECT score FROM students WHERE id=1;');
  expect(await cells(page)).toEqual([['7']]);
  await editor(page).fill('DELETE FROM students;');
  await page.getByRole('button', { name: '运行 SQL', exact: true }).click();
  await page.getByRole('button', { name: '重置数据库', exact: true }).click();
  await run(page, 'SELECT score FROM students WHERE id=1;');
  expect(await cells(page)).toEqual([['88']]);
});

test('MySQL quota and multi-tab draft conflicts preserve both SQL and database and allow explicit CAS retry', async ({
  page,
  context,
}) => {
  await page.goto(workbench);
  await expect(editor(page)).toBeEditable();
  const other = await context.newPage();
  await other.goto(workbench);
  await expect(editor(other)).toBeEditable();
  await run(page, 'UPDATE students SET score=11 WHERE id=1;');
  await run(other, 'UPDATE students SET score=22 WHERE id=1;');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'mysqlDrafts') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('test quota', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('浏览器存储空间不足');
  expect((await archive(page)).rows.mysqlDrafts.values).toEqual([]);
  await expect(database(page).getByRole('row').filter({ hasText: '林安' })).toContainText('11');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(saved)).toBeVisible();
  await other.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('另一页面更新了草稿');
  await expect(editor(other)).toHaveValue('UPDATE students SET score=22 WHERE id=1;');
  await expect(database(other).getByRole('row').filter({ hasText: '林安' })).toContainText('22');
  await other.getByRole('button', { name: '以当前 SQL 和数据库保存', exact: true }).click();
  await expect(other.getByText(saved)).toBeVisible();
  await other.reload();
  await expect(editor(other)).toHaveValue('UPDATE students SET score=22 WHERE id=1;');
  await expect(database(other).getByRole('row').filter({ hasText: '林安' })).toContainText('22');
  await expect(trace(other)).toHaveCount(0);
});

test('MySQL clear barrier discards pending judge and prior draft without accepting a late result', async ({
  page,
  context,
}) => {
  await page.goto('/#/mysql/practice/' + projection.id);
  await editor(page).fill(projection.referenceSource);
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
      const value = args[0];
      if (value && typeof value === 'object' && Object.hasOwn(value, 'remaining'))
        setTimeout(() => Reflect.apply(send, this, args), 650);
      else Reflect.apply(send, this, args);
    };
  });
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText('正在提交判题…', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect
    .poll(async () => (await archive(page)).rows.meta.values[0].generation)
    .not.toBe(before.rows.meta.values[0].generation);
  await expect(editor(page)).toHaveValue(projection.starter);
  await expect(trace(page)).toHaveCount(0);
  const after = await archive(page);
  for (const name of ['mysqlActivities', 'mysqlDrafts', 'ledger'])
    expect(after.rows[name].values, name).toEqual([]);
});

test('MySQL JSON, Markdown, PNG and ZIP contain the same Unicode SQL, initial session, selected state and transaction', async ({
  page,
}) => {
  await page.goto(workbench);
  const source =
    '-- 字🙂，SQL逐字保存\nBEGIN;\nUPDATE students SET score=0 WHERE id=1;\nSELECT AVG(score) AS average_score FROM students;';
  await run(page, source);
  const cursor = Number(await trace(page).getAttribute('data-cursor'));
  const check = (value: Record<string, unknown>) => {
    expect(value).toMatchObject({
      language: 'mysql',
      dialect: '8.0',
      source: { text: source, sha256: createHash('sha256').update(source).digest('hex') },
      position: { cursor, length: cursor },
      state: {
        session: { transaction: { active: true } },
        result: { rows: [[{ kind: 'decimal', value: '43.6667' }]] },
      },
    });
    expect(Object.keys(value.state as object).sort()).toEqual(['control', 'result', 'session']);
    expect(value).toHaveProperty('initialSession.database.tables');
    expect(value).toHaveProperty('engine.sha256');
  };
  const markdown = (bytes: Buffer) => {
    const text = bytes.toString('utf8');
    expect(text).toContain(source);
    expect(text).toContain('43.6667');
    const record = /\n(`{3,})json\n([\s\S]+)\n\1\n?$/u.exec(text)!;
    const value = JSON.parse(record[2]) as Record<string, unknown>;
    check(value);
    return value;
  };
  for (const format of ['JSON', 'Markdown', 'PNG', 'ZIP']) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出 ' + format, exact: true }).click(),
    ]);
    const bytes = readFileSync((await download.path())!);
    if (format === 'JSON') check(JSON.parse(bytes.toString('utf8')));
    if (format === 'Markdown') markdown(bytes);
    if (format === 'PNG') check(pngRecord(bytes));
    if (format === 'ZIP') {
      const files = zipEntries(bytes);
      expect(Object.keys(files)).toEqual(['snapshot.json', 'notes.md', 'snapshot.png']);
      const json = JSON.parse(files['snapshot.json'].toString('utf8'));
      check(json);
      expect(markdown(files['notes.md'])).toEqual(json);
      expect(pngRecord(files['snapshot.png'])).toEqual(json);
    }
  }
});

test('MySQL changing source during an asynchronous PNG export cancels the download', async ({
  page,
}) => {
  await page.goto(workbench);
  await run(page);
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      return encode.call(this, (value) => setTimeout(() => callback(value), 300), ...args);
    };
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  await editor(page).fill('SELECT 2;');
  await expect(trace(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
});

test('MySQL moving away and back during an asynchronous PNG export still invalidates the capture', async ({
  page,
}) => {
  await page.goto(workbench);
  await run(page);
  const last = await trace(page).getAttribute('data-cursor');
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      return encode.call(this, (value) => setTimeout(() => callback(value), 500), ...args);
    };
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  await trace(page).getByRole('button', { name: '上一步', exact: true }).click();
  await trace(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(trace(page)).toHaveAttribute('data-cursor', last!);
  await expect(page.getByRole('alert')).toContainText('当前 SQL、运行或游标已变化');
  expect(downloads).toBe(0);
});

test('MySQL desktop aligns SQL with data and phone regions scroll inside the page frame', async ({
  page,
}) => {
  await page.goto(workbench);
  await run(page);
  const sql = await page.getByRole('region', { name: 'SQL 编辑区', exact: true }).boundingBox(),
    data = await database(page).boundingBox(),
    query = await result(page).boundingBox();
  expect(sql).not.toBeNull();
  expect(data).not.toBeNull();
  expect(query).not.toBeNull();
  expect(Math.abs(sql!.y - data!.y)).toBeLessThan(2);
  expect(data!.x).toBeGreaterThan(sql!.x + sql!.width);
  expect(query!.y + 100).toBeLessThan(900);
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) {
      await page.getByRole('button', { name: '数据库表格', exact: true }).click();
      await expect(database(page)).toBeVisible();
      await expect(editor(page)).toBeHidden();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await database(page)
      .getByRole('combobox', { name: '数据表', exact: true })
      .selectOption('departments');
    await expect(
      database(page).getByRole('region', { name: 'departments 数据', exact: true }),
    ).toContainText('计算机');
  }
});
