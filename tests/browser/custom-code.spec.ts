import { expectEditorValue } from './editor-value';
import type {} from './harness/editor-history';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
const captureFolder = `.artifacts/${process.env.TASK_EVIDENCE_TASK ?? '17.3'}/custom-code/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
test.beforeAll(() => mkdir(captureFolder, { recursive: true }));
async function ready(page: Page) {
  await page.goto('/#/custom-code');
  await expect(page.getByRole('heading', { name: 'C 代码工作台', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
}
async function source(page: Page, text: string) {
  await page.getByRole('button', { name: '编辑代码', exact: true }).click();
  await page.getByRole('textbox', { name: 'C 代码', exact: true }).fill(text);
}
async function run(page: Page) {
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute(
    'data-status',
    /ready|rejected/,
  );
}
async function end(page: Page) {
  const slider = page.getByRole('slider', { name: '执行步骤', exact: true });
  await slider.fill((await slider.getAttribute('max'))!);
}
async function rows(page: Page, name = 'c-viz-learning') {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const result = await new Promise<Record<string, unknown[]>>((resolve, reject) => {
      const all: Record<string, unknown[]> = {};
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, 'readonly');
      for (const n of names) {
        const r = tx.objectStore(n).getAll();
        r.onsuccess = () => {
          all[n] = r.result;
        };
      }
      tx.oncomplete = () => resolve(all);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return result;
  }, name);
}
test('arbitrary C source executes, input edits invalidate, all three views share the cursor', async ({
  page,
}) => {
  await ready(page);
  const text =
    '#include <stdio.h>\nint triple(int n){return n*3;}\nint main(){int n;scanf("%d",&n);int a[2]={2,4};printf("%d",triple(n)+a[1]);return 0;}';
  await source(page, text);
  await page.getByRole('textbox', { name: '整数输入', exact: true }).fill('5');
  await run(page);
  await end(page);
  await expect(page.getByTestId('custom-output')).toHaveText('19');
  const cursor = await page.getByTestId('custom-code-page').getAttribute('data-cursor');
  for (const label of ['内存视图', '调用栈视图', '基础视图']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-cursor', cursor!);
  }
  await page.getByRole('textbox', { name: '整数输入', exact: true }).fill('6');
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-status', 'idle');
  await expect(page.getByTestId('custom-output')).toHaveCount(0);
  await run(page);
  await end(page);
  await expect(page.getByTestId('custom-output')).toHaveText('22');
  await source(page, text.replace('*3', '*4'));
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-cursor', '0');
  await run(page);
  await end(page);
  await expect(page.getByTestId('custom-output')).toHaveText('28');
});
test('invalid original draft saves, refresh restores only source, later valid source recovers', async ({
  page,
}) => {
  await ready(page);
  const text = '// 未完成的原文 😀\nint main( {';
  await source(page, text);
  await page.getByRole('textbox', { name: '整数输入' }).fill('42');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toHaveText('草稿已保存到当前浏览器。');
  await run(page);
  await expect(page.getByTestId('custom-diagnostic')).toBeVisible();
  await page.getByRole('button', { name: '定位错误源码' }).click();
  await expectEditorValue(page.getByRole('textbox', { name: 'C 代码', exact: true }), text);
  await page.reload();
  await expectEditorValue(page.getByRole('textbox', { name: 'C 代码', exact: true }), text);
  await expectEditorValue(page.getByRole('textbox', { name: '整数输入', exact: true }), '7');
  await source(page, '#include <stdio.h>\nint main(){printf("ok");return 0;}');
  await run(page);
  await end(page);
  await expect(page.getByTestId('custom-output')).toHaveText('ok');
});
test('line breakpoints pause and source edits clear them; input changes retain them', async ({
  page,
}) => {
  await ready(page);
  await source(
    page,
    '#include <stdio.h>\nint main(){\n int n=2;\n n=n+1;\n printf("%d",n);\n return 0;\n}',
  );
  await page.getByRole('button', { name: '源码定位与断点', exact: true }).click();
  await page.getByRole('button', { name: '设置第 4 行断点', exact: true }).click();
  await run(page);
  await page.getByRole('combobox', { name: '播放速度' }).selectOption('4');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByTestId('debug-hit')).toContainText('第 4 行');
  const cursor = await page.getByTestId('custom-code-page').getAttribute('data-cursor');
  await page.waitForTimeout(220);
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-cursor', cursor!);
  await page.getByRole('textbox', { name: '整数输入' }).fill('9');
  await expect(page.getByRole('button', { name: '移除第 4 行断点' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await source(page, 'int main(){return 0;}');
  await page.getByRole('button', { name: '源码定位与断点', exact: true }).click();
  await expect(page.getByRole('button', { name: '清除断点', exact: true })).toHaveCount(0);
});
test('runtime error and budget limit locate honest prefixes, fresh run recovers', async ({
  page,
}) => {
  await ready(page);
  await source(page, 'int main(){int a=1;return a/0;}');
  await run(page);
  await expect(page.getByTestId('custom-diagnostic')).toContainText('E_DIV_ZERO');
  await end(page);
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await expect(page.getByRole('slider', { name: '执行步骤' })).toBeEnabled();
  await source(page, 'int main(){while(1){}}');
  await run(page);
  await expect(page.getByTestId('custom-run-status')).toContainText('预算');
  await source(page, 'int main(){return 0;}');
  await run(page);
  await expect(page.getByTestId('custom-run-status')).toHaveText('执行完成');
});
test('save quota failure preserves text, retry works and two tabs cannot overwrite', async ({
  page,
  context,
}) => {
  await ready(page);
  await source(page, 'int main(){return 1;}');
  await page.evaluate(() => {
    const native = IDBObjectStore.prototype.put;
    let once = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'customDrafts' && once) {
        once = false;
        throw new DOMException('QA', 'QuotaExceededError');
      }
      return native.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toContainText('未保存');
  await expectEditorValue(page.getByRole('textbox', { name: 'C 代码' }), 'int main(){return 1;}');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toContainText('草稿已保存');
  const peer = await context.newPage();
  await ready(peer);
  await source(page, 'int main(){return 2;}');
  await source(peer, 'int main(){return 3;}');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toContainText('草稿已保存');
  await peer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(peer.getByRole('alert')).toContainText('另一页面');
  await expectEditorValue(peer.getByRole('textbox', { name: 'C 代码' }), 'int main(){return 3;}');
  await peer.getByRole('button', { name: '载入已保存版本（替换当前文本）' }).click();
  await expectEditorValue(peer.getByRole('textbox', { name: 'C 代码' }), 'int main(){return 2;}');
});
test('clearing in settings removes saved draft and invalidates old execution across tabs', async ({
  page,
  context,
}) => {
  await ready(page);
  await source(page, 'int main(){return 123;}');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toContainText('已保存');
  await run(page);
  const oldGeneration = (await rows(page)).meta[0] as { generation: string };
  const settings = await context.newPage();
  await settings.goto('/#/settings?panel=data');
  await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await settings.getByRole('dialog').getByRole('button', { name: '确认清除', exact: true }).click();
  await expect
    .poll(async () => ((await rows(page)).meta[0] as { generation: string }).generation)
    .not.toBe(oldGeneration.generation);
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-status', 'idle');
  expect((await rows(page)).customDrafts).toEqual([]);
  await page.reload();
  await expectEditorValue(
    page.getByRole('textbox', { name: 'C 代码' }),
    'int main(){return 123;}',
    { not: true },
  );
});
test('saving and running do not mint learning facts, and narrow layout keeps input accessible', async ({
  page,
}) => {
  await ready(page);
  const before = await rows(page);
  await source(page, 'int main(){return 9;}');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toContainText('已保存');
  await run(page);
  const after = await rows(page);
  for (const n of ['ledger', 'progress', 'receipts', 'dailyFacts', 'achievements'])
    expect(after[n]).toEqual(before[n]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: '代码与输入', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '整数输入' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('actual queued Worker result cannot survive cancellation or a newer source', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    const d = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage')!;
    (window as unknown as { qaHold: boolean; qaHeld: (() => void) | null }).qaHold = true;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(this, 'onmessage', {
          get: () => d.get!.call(this),
          set: (cb: ((e: MessageEvent) => void) | null) =>
            d.set!.call(
              this,
              cb &&
                ((e: MessageEvent) => {
                  const qa = window as unknown as { qaHold: boolean; qaHeld: (() => void) | null };
                  if (e.data?.ok && qa.qaHold) {
                    qa.qaHold = false;
                    qa.qaHeld = () => cb(e);
                  } else cb(e);
                }),
            ),
        });
      }
    };
  });
  await ready(page);
  await source(page, 'int main(){return 55;}');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { qaHeld: unknown }).qaHeld));
  await page.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(page.getByTestId('custom-run-status')).toContainText('E_CANCELLED');
  await source(page, '#include <stdio.h>\nint main(){printf("fresh");return 0;}');
  await run(page);
  await end(page);
  await page.evaluate(() => (window as unknown as { qaHeld: () => void }).qaHeld());
  await expect(page.getByTestId('custom-output')).toHaveText('fresh');
});
test('native DB1 through DB7 upgrades preserve old partitions and add the draft store', async ({
  page,
}) => {
  await ready(page);
  const currentBefore = await rows(page);
  expect(currentBefore.meta[0]).toMatchObject({ schemaVersion: '15.0.0', dbVersion: 15 });
  expect(Object.keys(currentBefore)).toHaveLength(29);
  await page.goto('/checks/');
  await page.waitForFunction(() => Boolean(window.historyHarness));
  const referenceName = 'c-viz-learning.test.custom-draft-reference';
  await page.evaluate((name) => window.historyHarness.open(name), referenceName);
  const old = await rows(page, referenceName);
  expect(old.meta[0]).toMatchObject({
    schemaVersion: '9.0.0',
    dbVersion: 9,
    activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
  });
  expect(Object.keys(old)).toHaveLength(17);
  const name = 'c-viz-learning.test.custom-draft-migration';
  await page.route('**/qa-blank', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<title>migration setup</title>' }),
  );
  for (const version of [1, 2, 3, 4, 5, 6, 7]) {
    await page.goto('/qa-blank');
    await page.evaluate(
      async ({ old, version, name }) => {
        const names = [
          'meta',
          'settings',
          'avatar',
          'progress',
          'dailyFacts',
          'goals',
          'ledger',
          'receipts',
          'aliases',
          ...(version >= 2 ? ['appearance', 'appearanceAssets'] : []),
          ...(version >= 3 ? ['editHistory'] : []),
          ...(version >= 4 ? ['knowledgeMarks'] : []),
          ...(version >= 5 ? ['reviewCards'] : []),
          ...(version >= 6 ? ['achievements'] : []),
        ];
        await new Promise<void>((resolve, reject) => {
          const r = indexedDB.deleteDatabase(name);
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
          r.onblocked = () => reject(new Error('old connection not closed'));
        });
        await new Promise<void>((resolve, reject) => {
          const r = indexedDB.open(name, version);
          r.onupgradeneeded = () => {
            for (const name of names) {
              const store = r.result.createObjectStore(name);
              for (const row of old[name]) {
                const data = row as Record<string, unknown>;
                if (name === 'meta')
                  store.put(
                    { ...data, schemaVersion: version + '.0.0', dbVersion: version },
                    'current',
                  );
                else if (['settings', 'avatar', 'appearance'].includes(name))
                  store.put(row, 'current');
                else throw new Error('QA seed requires blank independent collections');
              }
            }
          };
          r.onsuccess = () => {
            r.result.close();
            resolve();
          };
          r.onerror = () => reject(r.error);
        });
      },
      { old, version, name },
    );
    await page.goto('/checks/');
    await page.waitForFunction(() => Boolean(window.historyHarness));
    await page.evaluate((name) => window.historyHarness.open(name), name);
    const after = await rows(page, name);
    expect(after.customDrafts).toEqual([]);
    for (const name of Object.keys(old).filter((n) => n !== 'meta' && n !== 'customDrafts'))
      expect(after[name], `v${version}/${name}`).toEqual(old[name]);
    expect(after.meta[0]).toMatchObject({
      schemaVersion: '9.0.0',
      dbVersion: 9,
      generation: (old.meta[0] as { generation: string }).generation,
    });
  }
  expect(await rows(page)).toEqual(currentBefore);
});

test('real editor and result remain accessible at desktop, tablet and phone widths', async ({
  page,
}) => {
  await ready(page);
  await run(page);
  await end(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1000) {
      await page.getByRole('tab', { name: '执行观察', exact: true }).click();
    }
    await expect(page.getByTestId('custom-output')).toHaveText('14\n');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${captureFolder}/view-${width}-result.png`, fullPage: true });
    if (width < 1000) {
      await page.getByRole('tab', { name: '代码与输入', exact: true }).click();
      await page.screenshot({ path: `${captureFolder}/view-${width}-code.png`, fullPage: true });
    }
  }
});

test('oversized edits remain exact and unknown draft version is isolated without rewriting it', async ({
  page,
}) => {
  await ready(page);
  await source(page, 'int main(){return 1;}');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toContainText('已保存');
  const large = 'x'.repeat(32769);
  await source(page, large);
  await expectEditorValue(page.getByRole('textbox', { name: 'C 代码', exact: true }), large);
  await expect(page.getByRole('button', { name: '运行代码', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('customDrafts', 'readwrite');
      const r = tx.objectStore('customDrafts').get('current');
      r.onsuccess = () =>
        tx.objectStore('customDrafts').put({ ...r.result, draftVersion: '2.0.0' }, 'current');
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByTestId('custom-save-status')).toContainText('无法读取草稿');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  expect((await rows(page)).customDrafts[0]).toMatchObject({
    draftVersion: '2.0.0',
    source: 'int main(){return 1;}',
  });
});

test('real C struct uses an aggregate label and its exact fields share the memory cursor', async ({
  page,
}) => {
  await ready(page);
  await source(
    page,
    'struct Pair{int a;int b;};\nint main(){struct Pair pair={0};pair.a=7;pair.b=9;return 0;}',
  );
  await run(page);
  await end(page);
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await expect(page.getByRole('region', { name: '基础视图', exact: true })).toContainText(
    '结构体，内存视图可查看字段',
  );
  await page.getByRole('button', { name: '内存视图', exact: true }).click();
  await expect(page.getByRole('cell', { name: '7', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '9', exact: true })).toBeVisible();
  const cursor = await page.getByTestId('custom-code-page').getAttribute('data-cursor');
  await page.getByRole('button', { name: '调用栈视图', exact: true }).click();
  await expect(page.getByRole('region', { name: '调用栈视图', exact: true })).toContainText(
    '结构体，内存视图可查看字段',
  );
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-cursor', cursor!);
});
