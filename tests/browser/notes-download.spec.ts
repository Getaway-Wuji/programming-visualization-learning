import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page, type Download } from '@playwright/test';
import { confirm, observeCaseSetExecution } from './notebook-helpers';
import { native, clear } from './achievement-helpers';
import type { SnapshotDocument } from '../../web/src/snapshot-export/types';
const label = process.env.TASK_EVIDENCE_LABEL ?? 'local',
  folder = `.artifacts/20.2/browser/${label}`;
test.beforeAll(() => mkdir(folder, { recursive: true }));
const downloadButton = (p: Page) =>
  p.getByRole('button', { name: '下载 Markdown 压缩包', exact: true });
const status = (p: Page) => p.getByTestId('notes-download-status');
async function ready(p: Page) {
  await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
}
async function notes(p: Page) {
  await p.goto('/#/study-notes');
  await ready(p);
  await expect(p.getByRole('heading', { name: '选择范围', exact: true })).toBeVisible();
}
async function raw(p: Page) {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const names = Array.from(db.objectStoreNames),
      tx = db.transaction(names, 'readonly'),
      out: Record<string, unknown> = {};
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    await Promise.all(
      names.map(async (name) => {
        const store = tx.objectStore(name),
          keys = store.getAllKeys(),
          values = store.getAll();
        const read = <T>(r: IDBRequest<T>) =>
          new Promise<T>((resolve, reject) => {
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
        out[name] = { keys: await read(keys), rows: await read(values) };
      }),
    );
    await done;
    db.close();
    return {
      stores: out,
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    };
  });
}
async function unchanged(p: Page, name: string, before: Awaited<ReturnType<typeof raw>>) {
  const after = await raw(p);
  expect(Object.keys(after.stores)).toHaveLength(17);
  expect(after).toEqual(before);
  await writeFile(`${folder}/${name}-native.json.gz`, gzipSync(JSON.stringify({ before, after })), {
    flag: 'wx',
  });
}
async function capture(p: Page, kind: 'c' | 'cpp') {
  await p.evaluate((kind) => {
    location.hash =
      kind === 'c' ? '/visualize/case.c.bubble-sort' : '/memory?example=nodes&view=memory';
  }, kind);
  await ready(p);
  await p
    .getByRole('button', { name: kind === 'c' ? '运行示例' : '运行样例', exact: true })
    .click();
  await expect(p.getByRole('button', { name: '加入本次笔记', exact: true })).toBeEnabled();
  if (kind === 'c') {
    await p.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
    for (let i = 0; i < 4; i++)
      await p
        .getByTestId('player-controls')
        .getByRole('button', { name: '前进', exact: true })
        .click();
  } else await p.getByRole('slider', { name: '执行步骤', exact: true }).fill('4');
  await p.getByRole('button', { name: '加入本次笔记', exact: true }).click();
  await expect(p.getByTestId('snapshot-export-status')).toContainText('已加入');
  const getting = p.waitForEvent('download');
  await p.getByRole('button', { name: '下载状态文件（JSON）', exact: true }).click();
  const file = await getting;
  const doc = JSON.parse(await readFile((await file.path())!, 'utf8')) as SnapshotDocument;
  await p.getByRole('link', { name: '查看学习笔记', exact: true }).click();
  await ready(p);
  return doc;
}
async function previewSnapshots(p: Page) {
  await p
    .getByRole('group', { name: '内容类型' })
    .getByRole('checkbox', { name: '快照', exact: true })
    .check();
  for (const box of await p.locator('[data-note-kind="snapshot"]').getByRole('checkbox').all())
    await box.check();
  await p.getByRole('button', { name: '生成笔记预览', exact: true }).click();
  await expect(downloadButton(p)).toBeEnabled();
}
async function prepareSnapshot(p: Page) {
  await notes(p);
  await capture(p, 'cpp');
  await previewSnapshots(p);
}
async function saved(d: Download, name: string) {
  await writeFile(`${folder}/${name}-suggested-filename.txt`, d.suggestedFilename(), {
    flag: 'wx',
  });
  const path = resolve(`${folder}/${name}.zip`);
  await d.saveAs(path);
  const target = resolve(`${folder}/${name}-extracted`);
  execFileSync('python', ['scripts/verify-notes-archive.py', path, target], { windowsHide: true });
  return {
    path,
    target,
    metadata: JSON.parse(await readFile(`${target}/notes.json`, 'utf8')),
    markdown: await readFile(`${target}/笔记.md`, 'utf8'),
  };
}
async function readMarkdown(p: Page, target: string, name: string, title: string) {
  execFileSync(
    'pwsh',
    ['-NoProfile', '-File', 'scripts/notes-markdown-reader.ps1', '-Folder', target],
    { windowsHide: true },
  );
  const reader = `notes-reader-${label}-${name}`;
  await cp(target, resolve(`.artifacts/browser-dist/${reader}`), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await p.goto(`/checks/${reader}/reader.html`);
  await expect(p.locator('h1')).toHaveText(title);
  await expect(p.locator('img[onerror],script')).toHaveCount(0);
  for (const image of await p.locator('img').all()) {
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth === 1440),
    ).toBe(true);
  }
  await p.screenshot({ path: `${folder}/${name}-markdown-reader.png`, fullPage: true });
}
type HoldState = {
  hold: boolean;
  fail: boolean;
  anchorFail: boolean;
  waiting: number;
  release: () => void;
};
async function faults(p: Page) {
  await p.addInitScript(() => {
    const state = { hold: false, fail: false, anchorFail: false, waiting: 0, release: () => {} };
    Object.assign(window, { __noteFault: state });
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (state.fail) {
        state.fail = false;
        callback(null);
        return;
      }
      if (state.hold) {
        state.waiting++;
        state.release = () => {
          state.hold = false;
          original.call(this, callback, type, quality);
        };
        return;
      }
      original.call(this, callback, type, quality);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (state.anchorFail && this.download.endsWith('.zip')) {
        state.anchorFail = false;
        throw Error('isolated download fault');
      }
      click.call(this);
    };
  });
}
const arm = (p: Page, key: 'hold' | 'fail' | 'anchorFail') =>
  p.evaluate((key) => {
    (window as unknown as { __noteFault: HoldState }).__noteFault[key] = true;
  }, key);
const release = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { __noteFault: HoldState }).__noteFault.release();
  });
async function held(p: Page) {
  await expect
    .poll(() =>
      p.evaluate(() => (window as unknown as { __noteFault: HoldState }).__noteFault.waiting),
    )
    .toBeGreaterThan(0);
}

test('20.2 explicit real learning selection downloads a readable Unicode archive without other records', async ({
  page,
}) => {
  await confirm(page, 'lesson.c.variables-output');
  await notes(page);
  await expect(page.getByTestId('notes-download')).toHaveCount(0);
  for (const name of ['学习记录', '解析'])
    await page
      .getByRole('group', { name: '内容类型' })
      .getByRole('checkbox', { name, exact: true })
      .check();
  const learning = page.locator('[data-note-kind="learning"]');
  await learning.first().getByRole('checkbox').check();
  await page.locator('[data-note-kind="analysis"]').first().getByRole('checkbox').check();
  await page.getByRole('button', { name: '生成笔记预览', exact: true }).click();
  const title = '中文复习 <img src=x onerror=alert(1)> [链接](javascript:x)';
  await page.getByLabel('笔记标题', { exact: true }).fill(title);
  const before = await raw(page),
    requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  const getting = page.waitForEvent('download');
  await downloadButton(page).click();
  const download = await getting;
  expect(download.suggestedFilename()).toContain('中文复习');
  expect(download.suggestedFilename()).not.toMatch(/[<>:"/\\|?*]/);
  await expect(status(page)).toContainText('已发起下载');
  const output = await saved(download, 'learning');
  expect(output.metadata.entries).toHaveLength(2);
  expect(output.metadata.assets).toEqual([]);
  expect(output.metadata).not.toHaveProperty('lease');
  expect(output.markdown).toContain('非历史作答');
  expect(requests).toEqual([]);
  await unchanged(page, 'learning', before);
  await readMarkdown(page, output.target, 'learning', title);
});

test('20.2 mixed real C and C++ snapshots retain source/input/state and decode as local Markdown images', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await notes(page);
  const before = await raw(page);
  const originals = [await capture(page, 'c'), await capture(page, 'cpp')];
  await previewSnapshots(page);
  await page.getByLabel('笔记标题', { exact: true }).fill('中文算法与内存 / C和C++');
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  const getting = page.waitForEvent('download');
  await downloadButton(page).click();
  const output = await saved(await getting, 'mixed-real');
  await expect(status(page)).toContainText('已发起下载');
  expect(output.metadata.entries).toHaveLength(2);
  expect(output.metadata.assets).toHaveLength(2);
  for (const entry of output.metadata.entries as {
    language: string;
    snapshot: SnapshotDocument;
  }[]) {
    const original = originals.find(
      (o) => o.runtime.identity.runId === entry.snapshot.runtime.identity.runId,
    )!;
    expect(original).toBeTruthy();
    for (const key of [
      'source',
      'input',
      'position',
      'runtime',
      'currentState',
      'currentStep',
      'types',
      'executionOutcome',
      'terminalAtCursor',
    ] as const)
      expect(entry.snapshot[key]).toEqual(original[key]);
    expect(entry.language).toBe(original.runtime.domain === 'p1-memory' ? 'cpp' : 'c');
  }
  expect(output.markdown).toContain('```c\n');
  expect(output.markdown).toContain('```cpp\n');
  expect(requests).toEqual([]);
  await unchanged(page, 'mixed-real', before);
  await page.screenshot({ path: `${folder}/download-ready.png`, fullPage: true });
  await readMarkdown(page, output.target, 'mixed-real', '中文算法与内存 / C和C++');
});

test('20.2 a real C++ pointer mistake exports its original result and missing-answer warning only', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await page.goto('/#/bugs/memory/exercise.cpp.bug-uninitialized-pointer');
  await ready(page);
  await page.getByRole('button', { name: '提交全部4组', exact: true }).click();
  await expect(page.getByTestId('memory-bug-session')).toHaveAttribute('data-state', 'unmet');
  await expect(page.getByTestId('memory-bug-session')).toHaveAttribute('data-save-state', 'saved');
  await notes(page);
  await page
    .getByRole('group', { name: '内容类型' })
    .getByRole('checkbox', { name: '错题', exact: true })
    .check();
  const row = page.locator('[data-note-kind="mistake"]');
  await expect(row).toHaveCount(1);
  await row.getByRole('checkbox').check();
  await page.getByRole('button', { name: '生成笔记预览', exact: true }).click();
  const before = await raw(page),
    getting = page.waitForEvent('download');
  await downloadButton(page).click();
  const output = await saved(await getting, 'real-mistake');
  expect(output.metadata.entries).toHaveLength(1);
  expect(output.metadata.entries[0]).toMatchObject({
    kind: 'mistake',
    language: 'cpp',
    origin: { subjectRef: { id: 'exercise.cpp.bug-uninitialized-pointer', version: '1.0.0' } },
    reference: null,
    snapshot: null,
  });
  expect(output.metadata.assets).toEqual([]);
  expect(output.markdown).toContain('程序错误');
  expect(output.markdown).toContain('未保存当时的作答源码');
  expect(output.markdown).not.toContain('```cpp');
  await unchanged(page, 'real-mistake', before);
});

for (const mode of ['cancel', 'title-aba'] as const)
  test(`20.2 pending image ${mode} revokes the old operation and allows fresh retry`, async ({
    page,
  }) => {
    await faults(page);
    await prepareSnapshot(page);
    const before = await raw(page),
      downloads: Download[] = [];
    page.on('download', (d) => downloads.push(d));
    await arm(page, 'hold');
    await downloadButton(page).click();
    await held(page);
    if (mode === 'cancel')
      await page.getByRole('button', { name: '取消笔记打包', exact: true }).click();
    else {
      await page.getByLabel('笔记标题', { exact: true }).fill('改变');
      await page.getByLabel('笔记标题', { exact: true }).fill('学习笔记');
    }
    await expect(status(page)).toContainText('未发起下载');
    await release(page);
    await expect(page.getByTestId('notes-download')).toHaveAttribute('data-phase', 'cancelled');
    expect(downloads).toHaveLength(0);
    const getting = page.waitForEvent('download');
    await downloadButton(page).click();
    await saved(await getting, mode);
    expect(downloads).toHaveLength(1);
    await unchanged(page, mode, before);
  });

for (const kind of ['fail', 'anchorFail'] as const)
  test(`20.2 ${kind} never claims saved or downloads a partial package and can recover`, async ({
    page,
  }) => {
    await faults(page);
    await prepareSnapshot(page);
    const before = await raw(page),
      downloads: Download[] = [];
    page.on('download', (d) => downloads.push(d));
    await arm(page, kind);
    await downloadButton(page).click();
    await expect(page.getByTestId('notes-download')).toHaveAttribute('data-phase', 'failed');
    await expect(status(page)).toContainText('未发起下载');
    expect(downloads).toHaveLength(0);
    const getting = page.waitForEvent('download');
    await downloadButton(page).click();
    await saved(await getting, kind);
    expect(downloads).toHaveLength(1);
    await unchanged(page, kind, before);
  });

test('20.2 an unbroadcast native revision change is rejected by the final meta-only readonly gate', async ({
  page,
}) => {
  await faults(page);
  await prepareSnapshot(page);
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await arm(page, 'hold');
  await downloadButton(page).click();
  await held(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction(['meta'], 'readwrite'),
      store = tx.objectStore('meta'),
      r = store.get('current');
    r.onsuccess = () => store.put({ ...r.result, revision: r.result.revision + 1 }, 'current');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await release(page);
  await expect(page.getByTestId('notes-download')).toHaveAttribute('data-phase', 'failed');
  expect(downloads).toHaveLength(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('notes-preview')).toHaveCount(0);
  await previewSnapshots(page);
  const before = await raw(page),
    getting = page.waitForEvent('download');
  await downloadButton(page).click();
  await saved(await getting, 'revision-retry');
  await unchanged(page, 'revision-retry', before);
});

test('20.2 peer clearing while a real image is pending releases snapshots and no late download survives', async ({
  page,
  context,
}) => {
  await faults(page);
  await prepareSnapshot(page);
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await arm(page, 'hold');
  await downloadButton(page).click();
  await held(page);
  const peer = await context.newPage();
  await clear(peer);
  await page.bringToFront();
  await expect(page.getByTestId('notes-preview')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '本次快照 · 0/8 份' })).toBeVisible();
  await release(page);
  await expect(page.getByTestId('notes-download')).toHaveCount(0);
  expect(downloads).toHaveLength(0);
});

test('20.2 download title and controls fit the representative interface at three widths', async ({
  page,
}) => {
  await prepareSnapshot(page);
  const before = await raw(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await downloadButton(page).scrollIntoViewIfNeeded();
    await expect(downloadButton(page)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${folder}/download-${width}.png`, fullPage: true });
  }
  await unchanged(page, 'widths', before);
});
