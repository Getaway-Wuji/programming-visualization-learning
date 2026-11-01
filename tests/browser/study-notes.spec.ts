import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import {
  confirm,
  openAnswer,
  panel,
  code,
  ready as learningReady,
  observeCaseSetExecution,
} from './notebook-helpers';
import { native, clear } from './achievement-helpers';
import type { SnapshotDocument } from '../../web/src/snapshot-export/types';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { decodeMemoryResult, type MemoryRequest } from '../../web/src/engine/memory-protocol';
import { engineBuild as memoryBuild } from '../../web/src/generated/memory/engine-build';
import { PlayerModel } from '../../web/src/player/model';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
const folder = `.artifacts/20.1/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
test.beforeAll(() => mkdir(folder, { recursive: true }));
const notes = async (p: Page) => {
  await p.goto('/#/study-notes');
  await expect(p.getByRole('heading', { name: '学习笔记', exact: true })).toBeVisible();
  await ready(p);
};
async function ready(p: Page) {
  await learningReady(p);
  await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
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
      values: Record<string, unknown> = {};
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    await Promise.all(
      names.map(async (n) => {
        const store = tx.objectStore(n);
        const keys = store.getAllKeys(),
          rows = store.getAll();
        const read = <T>(r: IDBRequest<T>) =>
          new Promise<T>((resolve, reject) => {
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
        values[n] = { keys: await read(keys), rows: await read(rows) };
      }),
    );
    await done;
    db.close();
    return {
      stores: values,
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    };
  });
}
async function evidence(name: string, value: unknown) {
  await writeFile(`${folder}/${name}.json.gz`, gzipSync(JSON.stringify(value)), { flag: 'wx' });
}
async function sameAfter(p: Page, name: string, before: Awaited<ReturnType<typeof raw>>) {
  const after = await raw(p);
  expect(Object.keys(after.stores)).toHaveLength(17);
  expect(after).toEqual(before);
  await evidence(name, { before, after });
}
async function selectType(p: Page, name: string) {
  await p
    .getByRole('group', { name: '内容类型', exact: true })
    .getByRole('checkbox', { name, exact: true })
    .check();
}
test('20.1 candidate capture engineering smoke keeps the original download and adds only transient snapshots', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await page.goto('/#/memory?example=nodes&view=memory');
  await expect(page.getByRole('button', { name: '运行样例', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByRole('button', { name: '加入本次笔记', exact: true })).toBeEnabled();
  await page.getByRole('slider', { name: '执行步骤', exact: true }).fill('4');
  await page.getByRole('button', { name: '加入本次笔记', exact: true }).click();
  await expect(page.getByTestId('snapshot-export-status')).toContainText('已加入本次笔记');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载状态文件（JSON）', exact: true }).click();
  const d = await downloading,
    doc = JSON.parse(await readFile((await d.path())!, 'utf8')) as SnapshotDocument;
  expect(doc.position.cursor).toBe(4);
  expect(doc.runtime.language).toBe('cpp');
  await page.getByRole('link', { name: '查看学习笔记', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本次快照 · 1/8 份' })).toBeVisible();
  await evidence('capture-engineering', doc);
});
async function makePreview(p: Page) {
  await p.getByRole('button', { name: '生成笔记预览', exact: true }).click();
  await expect(p.getByTestId('notes-preview')).toBeVisible();
}

test('20.1 defaults to zero personal selections and handles empty and invalid ranges without storage writes', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ai/')) calls.push(r.url());
  });
  await notes(page);
  const before = await raw(page);
  await expect(page.getByRole('group', { name: '内容类型' }).locator('input:checked')).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: '生成笔记预览' })).toBeDisabled();
  for (const kind of ['学习记录', '错题', '解析', '快照']) await selectType(page, kind);
  await expect(page.getByTestId('notes-empty')).toBeVisible();
  await page.getByLabel('开始日期', { exact: true }).fill('2026-11-02');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-11-01');
  await expect(page.getByRole('alert')).toContainText('日期范围无效');
  await page.getByLabel('开始日期', { exact: true }).fill('');
  await page.getByLabel('结束日期', { exact: true }).fill('');
  await expect(page.getByTestId('notes-empty')).toBeVisible();
  expect(calls).toEqual([]);
  await sameAfter(page, 'empty-native', before);
  await page.screenshot({ path: `${folder}/empty.png`, fullPage: true });
});

test('20.1 real C attempt and learning receipts are filtered and never substituted by current reference code', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await confirm(page, 'lesson.c.variables-output');
  await openAnswer(page, 'exercise.c.echo');
  const original = await code(page).inputValue();
  await code(page).fill(original.replace(/printf\([^;]+;/, `printf("%d", x);`));
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  await learningReady(page);
  await notes(page);
  const before = await raw(page);
  await selectType(page, '错题');
  const row = page.locator('[data-note-kind="mistake"]');
  await expect(row).toHaveCount(1);
  await row.getByRole('checkbox').check();
  await makePreview(page);
  await expect(page.getByTestId('notes-preview')).toContainText('答案不符');
  await expect(page.getByTestId('notes-preview')).toContainText('未保存当时的作答源码');
  await expect(page.getByTestId('notes-preview').getByLabel('笔记源码')).toHaveCount(0);
  await selectType(page, '解析');
  await expect(page.getByTestId('notes-preview')).toHaveCount(0);
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  const analysis = page.locator('[data-note-kind="analysis"]');
  await analysis.first().getByRole('checkbox').check();
  await makePreview(page);
  await expect(page.getByTestId('notes-preview')).toContainText('不是历史作答');
  const date = await row.locator('small').innerText();
  const day = date.match(/\d{4}-\d\d-\d\d/)![0];
  await page.getByLabel('开始日期', { exact: true }).fill(day);
  await page.getByLabel('结束日期', { exact: true }).fill(day);
  await expect(row).toHaveCount(1);
  await page
    .getByRole('combobox', { name: '章节', exact: true })
    .selectOption('chapter.c.expressions');
  await expect(row).toHaveCount(0);
  await page.getByRole('combobox', { name: '章节', exact: true }).selectOption('');
  await expect(row).toHaveCount(1);
  await sameAfter(page, 'real-c-choices-native', before);
});

for (const kind of ['c', 'cpp'] as const)
  test(`20.1 real ${kind} capture preview agrees with original Rust cursor and preserves all 17 stores`, async ({
    page,
  }) => {
    await observeCaseSetExecution(page);
    await page.goto(
      kind === 'c' ? '/#/visualize/case.c.bubble-sort' : '/#/memory?example=nodes&view=memory',
    );
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
    await expect.poll(async () => (await native(page)).settings.goalTemplate).not.toBeNull();
    const add = page.getByRole('button', { name: '加入本次笔记', exact: true });
    await expect(add).toBeDisabled();
    await page
      .getByRole('button', { name: kind === 'c' ? '运行示例' : '运行样例', exact: true })
      .click();
    await expect(add).toBeEnabled();
    if (kind === 'c') {
      await page.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
      for (let i = 0; i < 4; i++)
        await page
          .getByTestId('player-controls')
          .getByRole('button', { name: '前进', exact: true })
          .click();
    } else await page.getByRole('slider', { name: '执行步骤', exact: true }).fill('4');
    const before = await raw(page);
    await add.click();
    await expect(page.getByTestId('snapshot-export-status')).toContainText('已加入本次笔记');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载状态文件（JSON）', exact: true }).click();
    const download = await downloading;
    const path = await download.path();
    const doc = JSON.parse(await readFile(path!, 'utf8')) as SnapshotDocument;
    const encoded = await page.evaluate(() => {
      const w = window.__verticalObservation.workers.findLast((w) => w.moduleSeen && w.responseOk)!;
      return (
        w as unknown as { captureEncoded: () => { requestBase64: string; responseBase64: string } }
      ).captureEncoded();
    });
    const request = JSON.parse(Buffer.from(encoded.requestBase64, 'base64').toString()) as
        ExecuteRequest | MemoryRequest,
      bytes = Uint8Array.from(Buffer.from(encoded.responseBase64, 'base64')).buffer;
    if ('execVersion' in request) {
      const result = await decodeMemoryResult(bytes, request, memoryBuild.wasmSha256);
      const player = new MemoryPlayer();
      player.accept(result);
      player.seek(4);
      expect(doc.currentState).toEqual(player.snapshot().state);
      expect(doc.currentStep).toEqual(result.trace!.steps[3]);
    } else {
      const result = await decodeResult(bytes, request);
      const player = new PlayerModel();
      player.acceptValidated(player.begin(result.identity), result);
      player.seek(4);
      expect(doc.currentState).toEqual(player.snapshot().state);
      expect(doc.currentStep).toEqual(result.trace!.steps[3]);
    }
    expect(doc.source.sha256).toBe(createHash('sha256').update(doc.source.text).digest('hex'));
    await page.getByRole('link', { name: '查看学习笔记', exact: true }).click();
    await ready(page);
    await expect(page.getByRole('heading', { name: '本次快照 · 1/8 份' })).toBeVisible();
    await selectType(page, '快照');
    const row = page.locator('[data-note-kind="snapshot"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(kind === 'c' ? ' · C' : 'C++');
    await row.getByRole('checkbox').check();
    await makePreview(page);
    const preview = page.getByTestId('notes-preview');
    await expect(preview).toContainText('步骤 4/');
    await preview.getByText('完整捕获状态与输入（只读）', { exact: true }).click();
    const state = JSON.parse(await preview.locator('details').last().locator('pre').innerText());
    expect(state.currentState).toEqual(doc.currentState);
    expect(state.currentStep).toEqual(doc.currentStep);
    expect(state.position).toEqual(doc.position);
    expect(state.input).toEqual(doc.input);
    const high = preview.locator('.note-code-highlight');
    const lines = await preview.locator('.note-code-line').evaluateAll((rows) =>
      rows.map((row) => ({
        top: row.getBoundingClientRect().top,
        height: row.getBoundingClientRect().height,
      })),
    );
    expect(lines.length).toBe(doc.source.text.split('\n').length);
    for (let i = 1; i < lines.length; i++)
      expect(lines[i].top).toBeGreaterThanOrEqual(lines[i - 1].top + lines[i - 1].height - 0.1);
    const range = doc.position.highlighted.range;
    if (range) expect(await high.count()).toBe(range.end.line - range.start.line + 1);
    await preview.getByRole('button', { name: '预览完整状态图片', exact: true }).click();
    await expect(preview.locator('img')).toBeVisible();
    expect(await preview.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(
      1440,
    );
    await evidence(`snapshot-${kind}`, { doc, encoded, previewState: state });
    await sameAfter(page, `snapshot-${kind}-native`, before);
    await page.screenshot({ path: `${folder}/snapshot-${kind}.png`, fullPage: true });
    await page.reload();
    await ready(page);
    await expect(page.getByRole('heading', { name: '本次快照 · 0/8 份' })).toBeVisible();
    await expect(page.getByTestId('notes-preview')).toHaveCount(0);
  });

test('20.1 real C++ pointer failure retains C++ explanation and original version', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await page.goto('/#/bugs/memory/exercise.cpp.bug-uninitialized-pointer');
  await learningReady(page);
  await page.getByRole('button', { name: '提交全部4组', exact: true }).click();
  await expect(page.getByTestId('memory-bug-session')).toHaveAttribute('data-state', 'unmet');
  await expect(page.getByTestId('memory-bug-session')).toHaveAttribute('data-save-state', 'saved');
  await notes(page);
  const before = await raw(page);
  await selectType(page, '解析');
  const row = page.locator('[data-note-kind="analysis"]');
  await expect(row).toHaveCount(1);
  await row.getByRole('checkbox').check();
  await makePreview(page);
  await expect(page.getByTestId('notes-preview')).toContainText('C++');
  await expect(page.getByTestId('notes-preview').getByLabel('笔记源码')).toContainText(
    'int *p = &x',
  );
  await sameAfter(page, 'cpp-pointer-native', before);
});

test('20.1 peer data changes invalidate selections and peer clear removes session captures', async ({
  page,
  context,
}) => {
  await confirm(page, 'lesson.c.variables-output');
  await notes(page);
  await selectType(page, '学习记录');
  await page.locator('[data-note-kind="learning"]').first().getByRole('checkbox').check();
  await makePreview(page);
  const other = await context.newPage();
  await confirm(other, 'lesson.c.expressions');
  await page.bringToFront();
  await expect(page.getByTestId('notes-preview')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '内容类型' }).locator('input:checked')).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    location.hash = '/memory?example=nodes&view=memory';
  });
  await page.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(page.getByRole('button', { name: '加入本次笔记', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '加入本次笔记', exact: true }).click();
  await expect(page.getByTestId('snapshot-export-status')).toContainText('已加入');
  await page.getByRole('link', { name: '查看学习笔记', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('heading', { name: '本次快照 · 1/8 份' })).toBeVisible();
  await clear(other);
  await page.bringToFront();
  await expect(page.getByRole('heading', { name: '本次快照 · 0/8 份' })).toBeVisible();
  await expect(page.getByTestId('notes-preview')).toHaveCount(0);
});

test('20.1 three representative widths keep filters and preview inside the page with keyboard labels', async ({
  page,
}) => {
  await notes(page);
  const before = await raw(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('combobox', { name: '章节', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${folder}/width-${width}.png`, fullPage: true });
  }
  await sameAfter(page, 'widths-native', before);
});
