import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { expectEditorValue } from './editor-value';

const settings = '/#/settings?panel=data';
const sql = (page: Page) => page.getByRole('textbox', { name: 'SQL 源码', exact: true });
const ready = (page: Page) =>
  expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
async function savedSql(page: Page, source: string) {
  await page.goto('/#/mysql/workbench');
  await expect(sql(page)).toBeVisible();
  await sql(page).fill(source);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('SQL 和数据库草稿已保存到此浏览器。', { exact: true })).toBeVisible();
}
async function meta(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = database.transaction(['meta'], 'readonly');
      return await new Promise<{ generation: string; revision: number }>((resolve, reject) => {
        const request = tx.objectStore('meta').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

test('settings downloads a complete local archive, previews it, cancels and restores saved SQL', async ({
  page,
}) => {
  const originalSql = 'SELECT 1; -- archived SQL';
  await savedSql(page, originalSql);
  await page.goto(settings);
  await ready(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载完整档案备份', exact: true }).click();
  const download = await downloadPromise;
  const contents = await readFile((await download.path())!);
  const archive = JSON.parse(contents.toString('utf8'));
  expect(Object.keys(archive.stores)).toHaveLength(29);
  expect(archive.stores.mysqlDrafts[0].value.source).toBe(originalSql);
  await savedSql(page, 'SELECT 2; -- later SQL');
  await page.goto(settings);
  await ready(page);
  const before = await meta(page);
  await page
    .getByLabel('选择本地备份文件（JSON，最大 48 MiB）')
    .setInputFiles({ name: '学习档案.json', mimeType: 'application/json', buffer: contents });
  await expect(page.getByRole('heading', { name: '恢复前核对', exact: true })).toBeVisible();
  expect(await meta(page)).toEqual(before);
  await page.getByRole('button', { name: '恢复这份备份…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认覆盖当前学习档案' })).toBeVisible();
  await page.getByRole('button', { name: '取消恢复', exact: true }).click();
  expect(await meta(page)).toEqual(before);
  await page.getByRole('button', { name: '恢复这份备份…', exact: true }).click();
  await page.getByRole('button', { name: '确认用此备份覆盖当前档案', exact: true }).click();
  await expect(
    page.getByText('备份已恢复。六语言记录、草稿与偏好已重新读取，旧的运行和待保存操作已失效。', {
      exact: true,
    }),
  ).toBeVisible();
  const after = await meta(page);
  expect(after.generation).not.toBe(before.generation);
  expect(after.revision).toBeGreaterThan(before.revision);
  await page.goto('/#/mysql/workbench');
  await expectEditorValue(sql(page), originalSql);
  await page.reload();
  await expectEditorValue(sql(page), originalSql);
});

test('a malformed imported archive leaves the saved local profile unchanged', async ({ page }) => {
  await page.goto(settings);
  await ready(page);
  // Fresh profiles open today's goal after the first ready snapshot. Wait for
  // that normal bootstrap write before checking that import itself writes none.
  await expect.poll(async () => (await meta(page)).revision).toBeGreaterThan(0);
  const before = await meta(page);
  await page.getByLabel('选择本地备份文件（JSON，最大 48 MiB）').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{bad-json'),
  });
  await expect(page.getByText(/无法读取这份完整备份/)).toBeVisible();
  expect(await meta(page)).toEqual(before);
  await expect(page.getByRole('button', { name: '恢复这份备份…', exact: true })).toHaveCount(0);
});
