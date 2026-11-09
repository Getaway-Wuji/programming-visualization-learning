import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openCurrentAnswer, submitCurrent } from './current-course-helpers';
import { watch } from './achievement-helpers';
import type { RustManifest } from '../../web/src/rust2018-course/repository';

interface Profile {
  id: string;
  lesson: string;
  source: string;
  cases: { input: string; expected: string }[];
}
const profiles = JSON.parse(
  readFileSync('shared/contracts/rust2018-profiles-1.0.0.json', 'utf8'),
) as Profile[];
const manifest = JSON.parse(
  readFileSync('content/rust2018/course/manifest-1.0.0.json', 'utf8'),
) as RustManifest;
const formatted = profiles.find((row) => row.lesson === 'rust.book.root01.02.02')!;
const shadow = profiles.find((row) => row.lesson === 'rust.book.root03.01.02')!;
const borrowed = profiles.find((row) => row.lesson === 'rust.book.root04.02.01')!;
const workbench = '/#/rust/workbench';
const practice = '/#/rust/practice/' + formatted.id;
const editor = (page: Page) => page.getByRole('textbox', { name: 'Rust 源码', exact: true });
const input = (page: Page) => page.getByRole('textbox', { name: 'Rust 输入', exact: true });
const trace = (page: Page) => page.getByTestId('rust-trace');
const saved = '草稿已保存到此浏览器。';
const judged = '判题结果已记入本地复盘。';
const ready = (page: Page) =>
  expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');

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
              wait(store.getAll()) as Promise<Record<string, unknown>[]>,
            ]);
            const encoded = await Promise.all(
              values.map(async (value) =>
                value.blob instanceof Blob
                  ? {
                      ...value,
                      blob: {
                        type: value.blob.type,
                        bytes: Array.from(new Uint8Array(await value.blob.arrayBuffer())),
                      },
                    }
                  : value,
              ),
            );
            return [name, { keys, values: encoded }];
          }),
        ),
      );
      return { version: db.version, rows };
    } finally {
      db.close();
    }
  });
}

async function readToEnd(page: Page) {
  await ready(page);
  const end = page.getByTestId('reading-end');
  await expect(end).toBeAttached();
  await page.bringToFront();
  await expect(async () => {
    await page.keyboard.press('End');
    await expect(end).toHaveAttribute('data-read-today', 'true', { timeout: 800 });
  }).toPass({ timeout: 10000 });
}

async function finish(page: Page, expected: string) {
  await expect(trace(page)).toBeVisible();
  await page.getByRole('button', { name: '到最后一步', exact: true }).click();
  await expect.poll(() => page.getByTestId('rust-output').textContent()).toBe(expected);
}

test('public Rust catalog preserves every book node, parent guides and independent reading self-checks', async ({
  page,
}) => {
  await page.goto('/#/');
  await ready(page);
  await page.getByRole('link', { name: 'Rust 课程', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Rust 课程', exact: true })).toBeVisible();
  const catalog = page.getByRole('region', { name: '教材目录', exact: true });
  const links = catalog.locator('a[href^="#/rust/lesson/"]');
  await expect(links).toHaveCount(388);
  expect(await links.evaluateAll((rows) => rows.map((row) => row.getAttribute('href')))).toEqual(
    manifest.catalog.map((node) => '#/rust/lesson/' + node.id),
  );
  await expect(page.getByText(/目录来源为《Rust权威指南》/u)).toContainText('Steve Klabnik');
  await expect(page.getByRole('progressbar', { name: 'Rust 阅读进度' })).toHaveAttribute(
    'max',
    '299',
  );
  await page.getByRole('searchbox', { name: '搜索目录' }).fill('Hello, World!');
  await catalog.getByRole('link', { name: 'Hello, World!', exact: true }).click();
  await expect(page).toHaveURL(/rust\.book\.root01\.02$/u);
  await expect(page.getByRole('heading', { name: 'Hello, World!', exact: true })).toBeVisible();
  await expect(page.getByTestId('reading-end')).toHaveCount(0);
  await page.keyboard.press('End');
  expect((await archive(page)).rows.rustActivities.values).toEqual([]);

  const readingId = 'rust.book.root01.01.01';
  await page.goto('/#/rust/lesson/' + readingId);
  await expect(page.getByRole('heading', { name: '阅读示例', exact: true })).toBeVisible();
  await expect(page.getByText(/工具链安装与宿主链接器不在浏览器解释器权限内/u)).toBeVisible();
  await expect(page.getByRole('heading', { name: '理解自检', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '运行并观察' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '打开练习' })).toHaveCount(0);
  await page.getByText('核对答案', { exact: true }).click();
  await expect(page.getByText(/检查当前系统的链接器及构建工具配置/u)).toBeVisible();
  await readToEnd(page);
  const first = await archive(page);
  expect(first.rows.rustActivities.values).toHaveLength(1);
  expect(first.rows.rustActivities.values[0].kind).toBe('lesson');
  await page.keyboard.press('End');
  await page.reload();
  await readToEnd(page);
  const repeated = await archive(page);
  expect(repeated.rows.rustActivities).toEqual(first.rows.rustActivities);
  expect(repeated.rows.ledger).toEqual(first.rows.ledger);
  expect(
    repeated.rows.dailyFacts.values.filter(
      (row) => (row.subjectRef as { id: string }).id === readingId,
    ),
  ).toHaveLength(1);
  await page.getByRole('link', { name: 'Rust 目录', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索目录' }).fill('没有这一个Rust小节');
  await expect(page.getByText('没有匹配的小节。')).toBeVisible();
});

test('Rust reading, actual four-group judgement, selected replay and refreshed review remain independent', async ({
  page,
}) => {
  await page.goto('/#/rust/lesson/' + formatted.lesson);
  await readToEnd(page);
  const read = await archive(page);
  expect(read.rows.rustActivities.values.map((row) => row.kind)).toEqual(['lesson']);
  expect(read.rows.ledger.values.filter((row) => row.subjectId === formatted.id)).toHaveLength(0);
  await page.getByRole('link', { name: '打开练习', exact: true }).click();
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText(judged)).toBeVisible();
  await expect(page.getByText('尚未全部通过', { exact: true })).toBeVisible();
  await editor(page).fill(formatted.source);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(saved)).toBeVisible();
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText(judged)).toBeVisible();
  await expect(page.getByText('四组均通过', { exact: true })).toBeVisible();
  const accepted = await archive(page);
  expect(accepted.version).toBe(15);
  expect(accepted.rows.rustActivities.values).toHaveLength(2);
  expect(accepted.rows.rustDrafts.values[0].source).toBe(formatted.source);
  expect(accepted.rows.ledger.values.filter((row) => row.subjectId === formatted.id)).toHaveLength(
    1,
  );
  for (const group of [1, 3]) {
    const button = page.getByRole('button', { name: `复盘第 ${group + 1} 组 · 通过`, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await finish(page, formatted.cases[group].expected);
    await page.getByRole('button', { name: '回到开头', exact: true }).click();
    await expect(page.getByTestId('rust-output')).toHaveText('暂无输出');
  }
  const replayed = await archive(page);
  for (const name of ['rustActivities', 'ledger', 'dailyFacts'])
    expect(replayed.rows[name], name).toEqual(accepted.rows[name]);
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText(judged)).toBeVisible();
  expect((await archive(page)).rows.ledger).toEqual(accepted.rows.ledger);
  await page.getByRole('link', { name: '查看本地复盘', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Rust 判题复盘' })).toBeVisible();
  await expect(page.getByText('四组均通过', { exact: true })).toBeVisible();
  await expect(page.getByText('已有首次通过记录')).toBeVisible();
  await page.locator(`a[href="#/rust/practice/${formatted.id}"]`).click();
  await expect(editor(page)).toHaveValue(formatted.source);
});

test('Rust examples execute the current source and exact input and invalidate obsolete output', async ({
  page,
}) => {
  await page.goto('/#/rust/example/' + shadow.lesson);
  await expect(editor(page)).toHaveValue(shadow.source);
  await input(page).fill(shadow.cases[2].input);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await finish(page, shadow.cases[2].expected);
  await page.getByRole('button', { name: '回到开头', exact: true }).click();
  await expect(trace(page)).toHaveAttribute('data-cursor', '0');
  await expect(page.getByText('当前没有活动变量。', { exact: true })).toBeVisible();
  await expect(page.getByText('当前没有活动调用帧。', { exact: true })).toBeVisible();
  await input(page).fill(shadow.cases[3].input);
  await expect(trace(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出 JSON', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await finish(page, shadow.cases[3].expected);
  await editor(page).fill(shadow.source.replace('n + 2', 'n + 5'));
  await expect(trace(page)).toHaveCount(0);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await finish(page, '42\n14\n');
  await page
    .getByRole('navigation', { name: 'Rust 学习', exact: true })
    .getByRole('link', { name: 'C++', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'C++ 源码', exact: true })).toBeEditable();
  await expect(trace(page)).toHaveCount(0);
  await page.goto('/#/rust/example/' + shadow.lesson);
  await expect(editor(page)).toHaveValue(shadow.source);
  await expect(trace(page)).toHaveCount(0);
});

test('Rust mutable borrowing appears in the real stack, reverses atomically and pauses at a source breakpoint', async ({
  page,
}) => {
  await page.goto('/#/rust/example/' + borrowed.lesson);
  await input(page).fill(borrowed.cases[2].input);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(trace(page)).toBeVisible();
  const loan = trace(page).getByText(/借用 #\d+ · .*可变借用，目标暂不能直接读写/u);
  for (let step = 0; step < 70 && !(await loan.count()); step++)
    await trace(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(loan).toBeVisible();
  await expect(
    trace(page)
      .getByRole('listitem')
      .filter({ hasText: /bump · 帧 #/u }),
  ).toBeVisible();
  const cursor = await trace(page).getAttribute('data-cursor');
  await trace(page).getByRole('button', { name: '上一步', exact: true }).click();
  await expect(loan).toHaveCount(0);
  await trace(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(trace(page)).toHaveAttribute('data-cursor', cursor!);
  await expect(loan).toBeVisible();
  await trace(page).getByRole('button', { name: '回到开头', exact: true }).click();
  await trace(page).getByRole('spinbutton', { name: '断点行', exact: true }).fill('1');
  await trace(page).getByRole('combobox', { name: '播放速度', exact: true }).selectOption('4');
  await trace(page).getByRole('button', { name: '播放', exact: true }).click();
  await expect(trace(page).locator('.rust-active-line')).toContainText('第 1 行', {
    timeout: 12000,
  });
  await expect(trace(page).getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await finish(page, borrowed.cases[2].expected);
  await expect(loan).toHaveCount(0);
  await trace(page).getByRole('button', { name: '回到开头', exact: true }).click();
  await expect(page.getByText('当前没有活动变量。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('rust-output')).toHaveText('暂无输出');
});

test('Rust moved ownership and independent String clones reverse with the same object identities', async ({
  page,
}) => {
  await page.goto(workbench);
  await editor(page).fill(
    'fn main(){let original=String::from("Rust🙂");let copied=original.clone();let moved=original;println!("{} {}",copied,moved);}',
  );
  await input(page).fill('');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(trace(page)).toBeVisible();
  const moved = trace(page).getByRole('row').filter({ hasText: '已移动，不能再读取' });
  for (let step = 0; step < 45 && !(await moved.count()); step++)
    await trace(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(moved).toContainText('original');
  const objects = trace(page).getByRole('row').filter({ hasText: '"Rust🙂"' });
  await expect(objects).toHaveCount(2);
  const identities = await objects.allTextContents();
  const cursor = await trace(page).getAttribute('data-cursor');
  await trace(page).getByRole('button', { name: '上一步', exact: true }).click();
  await expect(moved).toHaveCount(0);
  await expect(
    trace(page)
      .getByRole('row')
      .filter({ hasText: /original.*有效/u }),
  ).toBeVisible();
  await trace(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(trace(page)).toHaveAttribute('data-cursor', cursor!);
  await expect(moved).toContainText('original');
  expect(await objects.allTextContents()).toEqual(identities);
  await finish(page, 'Rust🙂 Rust🙂\n');
  await expect(objects).toHaveCount(0);
  await trace(page)
    .getByRole('checkbox', { name: '显示已结束生命周期的对象', exact: true })
    .check();
  await expect(objects).toHaveCount(2);
  await expect(objects.first()).toContainText('已释放');
  await trace(page).getByRole('button', { name: '回到开头', exact: true }).click();
  await expect(objects).toHaveCount(0);
  await expect(page.getByText('当前没有活动变量。', { exact: true })).toBeVisible();
});

for (const scenario of [
  {
    code: 'E_MOVED',
    source:
      'fn main() {\n    let text = String::from("字🙂");\n    let moved = text;\n    println!("{}", text);\n}',
    token: 'text',
    line: 4,
  },
  {
    code: 'E_BORROW_CONFLICT',
    source:
      'fn f(a: &mut i32, b: &i32) { *a = *b; }\nfn main() {\n    let mut value = 1;\n    f(&mut value, &value);\n}',
    token: '&value',
    line: 4,
  },
]) {
  test(`Rust ${scenario.code} locates its actual source range without displaying a stale trace`, async ({
    page,
  }) => {
    await page.goto(workbench);
    await editor(page).fill(scenario.source);
    await page.getByRole('button', { name: '运行', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: scenario.code })).toBeVisible();
    await expect(trace(page)).toHaveCount(0);
    await page
      .getByRole('button', { name: new RegExp(`^定位第 ${scenario.line} 行`, 'u') })
      .click();
    const selection = await editor(page).evaluate((element: HTMLTextAreaElement) => ({
      selected: element.value.slice(element.selectionStart, element.selectionEnd),
      prefix: element.value.slice(0, element.selectionStart),
      focused: document.activeElement === element,
    }));
    expect(selection.selected).toBe(scenario.token);
    expect(selection.prefix.split('\n')).toHaveLength(scenario.line);
    expect(selection.focused).toBe(true);
  });
}

test('Rust Blockly changes the same executable source and preserves unsupported code', async ({
  page,
}) => {
  await page.goto(workbench);
  await editor(page).fill('fn main(){let n=3;println!("{}",n);}');
  await page.getByRole('button', { name: '切换到积木', exact: true }).click();
  const canvas = page.getByLabel('Rust Blockly 积木画布', { exact: true });
  await expect(canvas.locator('.blocklySvg')).toBeVisible();
  await canvas.getByRole('button', { name: 'Edit text: 3', exact: true }).click();
  await page.locator('input.blocklyHtmlInput').fill('8');
  await page.locator('input.blocklyHtmlInput').press('Enter');
  await page.getByRole('button', { name: '应用积木到代码', exact: true }).click();
  await expect(editor(page)).toHaveValue(/let n = 8;/u);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await finish(page, '8\n');
  const unsupported = 'fn main(){let s=String::from("原稿🙂");println!("{}",s);}';
  await editor(page).fill(unsupported);
  await expect(trace(page)).toHaveCount(0);
  await page.getByRole('button', { name: '切换到积木', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/保留/u);
  await expect(editor(page)).toHaveValue(unsupported);
  await expect(canvas).toHaveCount(0);
});

test('Rust quota and multi-tab conflicts retain edits and permit an explicit draft retry', async ({
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
      if (this.name === 'rustDrafts') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('test quota', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  const first = 'fn main(){println!("first");}';
  const second = 'fn main(){println!("second");}';
  await editor(page).fill(first);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('S_QUOTA');
  await expect(editor(page)).toHaveValue(first);
  expect((await archive(page)).rows.rustDrafts.values).toEqual([]);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(saved)).toBeVisible();
  await editor(other).fill(second);
  await other.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('另一页面更新了草稿');
  await expect(editor(other)).toHaveValue(second);
  await other.getByRole('button', { name: '以当前代码保存', exact: true }).click();
  await expect(other.getByText(saved)).toBeVisible();
  await other.reload();
  await expect(editor(other)).toHaveValue(second);
});

test('clearing local data invalidates a pending Rust verdict and its prior generation draft', async ({
  page,
  context,
}) => {
  await page.goto(practice);
  await editor(page).fill(formatted.source);
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
      const message = args[0];
      if (message && typeof message === 'object' && Object.hasOwn(message, 'remaining'))
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
  await expect(editor(page)).not.toHaveValue(formatted.source);
  await expect(trace(page)).toHaveCount(0);
  const after = await archive(page);
  for (const name of ['rustActivities', 'rustDrafts', 'ledger'])
    expect(after.rows[name].values, name).toEqual([]);
  await editor(page).fill(formatted.source);
  await page.getByRole('button', { name: '提交判题', exact: true }).click();
  await expect(page.getByText(judged)).toBeVisible();
  await expect(page.getByText('四组均通过', { exact: true })).toBeVisible();
});

function pngRecord(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    expect(offset + length + 12).toBeLessThanOrEqual(bytes.length);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
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
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    files[name] = bytes.subarray(start, start + size);
    offset = start + size;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}

test('all Rust exports preserve Unicode source, exact input, selected cursor and the full real state', async ({
  page,
}) => {
  await page.goto('/#/rust/example/' + borrowed.lesson);
  const source = '// 字🙂，原始源码保持逐字一致\n' + borrowed.source;
  const actualInput = borrowed.cases[3].input;
  await editor(page).fill(source);
  await input(page).fill(actualInput);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await finish(page, borrowed.cases[3].expected);
  const cursor = Number(await trace(page).getAttribute('data-cursor'));
  const expected = {
    language: 'rust',
    edition: '2018',
    origin: {
      documentId: borrowed.lesson,
      packageRef: { id: 'content.rust2018.book', version: '1.0.0' },
    },
    source: { text: source, sha256: createHash('sha256').update(source).digest('hex') },
    input: actualInput,
    position: { cursor, length: cursor },
    state: {
      output: borrowed.cases[3].expected,
      frames: [],
      bindings: [],
      loans: [],
      temporaries: [],
    },
  };
  for (const format of ['JSON', 'Markdown', 'PNG', 'ZIP']) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出 ' + format, exact: true }).click(),
    ]);
    const bytes = readFileSync((await download.path())!);
    const checkJson = (value: Record<string, unknown>) => {
      expect(value).toMatchObject(expected);
      expect(Object.keys(value.state as object).sort()).toEqual(
        [
          'frames',
          'bindings',
          'objects',
          'loans',
          'temporaries',
          'control',
          'allocator',
          'output',
        ].sort(),
      );
    };
    const checkMarkdown = (value: Buffer) => {
      const text = value.toString('utf8');
      expect(text).toContain('Rust 2018 · 步骤 ' + cursor);
      expect(text).toContain(source);
      expect(text).toContain(actualInput);
      expect(text).toContain(borrowed.cases[3].expected);
      const record = /\n(`{3,})json\n([\s\S]+)\n\1\n?$/u.exec(text);
      expect(record).not.toBeNull();
      const document = JSON.parse(record![2]) as Record<string, unknown>;
      checkJson(document);
      return document;
    };
    if (format === 'JSON') checkJson(JSON.parse(bytes.toString('utf8')));
    if (format === 'Markdown') checkMarkdown(bytes);
    if (format === 'PNG') checkJson(pngRecord(bytes));
    if (format === 'ZIP') {
      const files = zipEntries(bytes);
      expect(Object.keys(files)).toEqual(['snapshot.json', 'notes.md', 'snapshot.png']);
      const json = JSON.parse(files['snapshot.json'].toString('utf8'));
      checkJson(json);
      expect(checkMarkdown(files['notes.md'])).toEqual(json);
      expect(pngRecord(files['snapshot.png'])).toEqual(json);
    }
  }
});

test('native DB13 upgrade preserves actual four-language records, original keys and background Blob bytes', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150000);
  await openCurrentAnswer(page, 'exercise.c6.s10.1.1');
  await submitCurrent(page);
  await watch(page, 'hanoi');
  const cpp = (
    JSON.parse(readFileSync('content/cpp/course/exercises-1.0.0.json', 'utf8')) as Profile[]
  ).find((row) => row.lesson === 'cpp.book.5-2')!;
  for (const target of [
    {
      path: '/#/python/practice/py3.practice.greeting',
      label: 'Python 代码',
      source: (
        JSON.parse(readFileSync('tests/fixtures/python3-reference.json', 'utf8')) as Record<
          string,
          string
        >
      ).greeting,
      saved: '草稿已保存到本机。',
      judged: '判题结果已保存到本机。',
    },
    {
      path: '/#/java/practice/java.practice.utf16-length',
      label: 'Java 代码',
      source: (
        JSON.parse(readFileSync('tests/fixtures/java-reference.json', 'utf8')) as Record<
          string,
          string
        >
      )['utf16-length'],
      saved: '草稿已保存到本机。',
      judged: '判题结果已保存到本机。',
    },
    { path: '/#/cpp/practice/' + cpp.id, label: 'C++ 源码', source: cpp.source, saved, judged },
  ]) {
    await page.goto(target.path);
    await page.getByRole('textbox', { name: target.label, exact: true }).fill(target.source);
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText(target.saved)).toBeVisible();
    await page.getByRole('button', { name: '提交判题', exact: true }).click();
    await expect(page.getByText(target.judged)).toBeVisible();
  }
  const original = await archive(page);
  for (const name of ['courseActivities', 'pythonActivities', 'javaActivities', 'cppActivities'])
    expect(original.rows[name].values.length, name).toBeGreaterThan(0);
  expect(JSON.stringify(original.rows.achievements.values)).toContain('observation.stack.hanoi');
  const prior = Object.fromEntries(
    Object.entries(original.rows).filter(
      ([name]) => !name.startsWith('rust') && !name.startsWith('mysql'),
    ),
  );
  prior.meta.values[0] = {
    ...prior.meta.values[0],
    dbVersion: 13,
    schemaVersion: '13.0.0',
    activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp', version: '1.0.0' },
  };
  const context = await browser.newContext({ baseURL });
  try {
    const migrated = await context.newPage();
    await migrated.route('**/rust-db13', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Native DB13 fixture</title>' }),
    );
    await migrated.goto('/rust-db13');
    await migrated.evaluate(async (payload: unknown) => {
      const rows = payload as Rows;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      canvas.getContext('2d')!.fillRect(0, 0, 1, 1);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!), 'image/png'),
      );
      const appearance = rows.appearance.values[0];
      appearance.background = {
        ...(appearance.background as object),
        assetId: 'background',
        visible: true,
      };
      rows.appearanceAssets = {
        keys: [[rows.meta.values[0].generation as string, 'background']],
        values: [
          {
            assetId: 'background',
            mimeType: 'image/png',
            byteLength: blob.size,
            width: 1,
            height: 1,
            blob,
          },
        ],
      };
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning', 13);
        request.onupgradeneeded = () => {
          for (const [name, table] of Object.entries(rows)) {
            const store = request.result.createObjectStore(name);
            table.keys.forEach((key, index) => store.add(table.values[index], key));
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });
    }, prior as unknown);
    const before = await archive(migrated);
    expect(before.version).toBe(13);
    await migrated.goto('/#/rust/lesson/' + formatted.lesson);
    await ready(migrated);
    const upgraded = await archive(migrated);
    expect(upgraded.version).toBe(15);
    for (const [name, table] of Object.entries(before.rows))
      if (name !== 'meta') expect(upgraded.rows[name], name).toEqual(table);
    expect(upgraded.rows.meta.values[0]).toEqual({
      ...before.rows.meta.values[0],
      dbVersion: 15,
      schemaVersion: '15.0.0',
      activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp-rust-mysql', version: '1.0.0' },
    });
    expect(upgraded.rows.rustDrafts.values).toEqual([]);
    expect(upgraded.rows.rustActivities.values).toEqual([]);
    await migrated.goto(practice);
    await editor(migrated).fill(formatted.source);
    await migrated.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(migrated.getByText(saved)).toBeVisible();
    await migrated.getByRole('button', { name: '提交判题', exact: true }).click();
    await expect(migrated.getByText(judged)).toBeVisible();
    await migrated.reload();
    await expect(editor(migrated)).toHaveValue(formatted.source);
    const final = await archive(migrated);
    for (const name of [
      'courseActivities',
      'courseDrafts',
      'pythonActivities',
      'pythonDrafts',
      'javaActivities',
      'javaDrafts',
      'cppActivities',
      'cppDrafts',
      'appearance',
      'appearanceAssets',
    ])
      expect(final.rows[name], name).toEqual(before.rows[name]);
    await info.attach('native-DB13-to-DB15-four-language-and-Blob', {
      body: JSON.stringify({ before, upgraded, final }),
      contentType: 'application/json',
    });
  } finally {
    await context.close();
  }
});
