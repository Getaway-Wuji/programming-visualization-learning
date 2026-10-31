import { randomUUID } from 'node:crypto';
import type {} from './harness/editor-history';
import { expect, test, type Page } from '@playwright/test';
import type { EditorSnapshot } from '../../web/src/storage/editor-history';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { blockOptions, blockWorkspace, selectBlock, showPracticeBlocks } from './block-ui';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';

test('13.4 native partition: atomic count/byte eviction, two writers, faults, corruption and clear barrier', async ({
  page,
  context,
}, info) => {
  test.setTimeout(90000);
  const name = `c-viz-learning.test.${randomUUID()}`;
  await page.goto('/checks/');
  const initial = await page.evaluate((name) => window.historyHarness.open(name), name);
  const second = await context.newPage();
  await second.goto('/checks/');
  await second.evaluate((name) => window.historyHarness.open(name), name);
  const writes = await Promise.all([
    page.evaluate(() => window.historyHarness.batch(51)),
    second.evaluate(() => window.historyHarness.batch(51)),
  ]);
  expect(writes.flat().every((r) => r.ok)).toBe(true);
  const retained = await page.evaluate(() => window.historyHarness.history());
  expect(retained.ok).toBe(true);
  if (!retained.ok) throw new Error(retained.code);
  expect(retained.value).toHaveLength(100);
  expect(new Set(retained.value.map((r) => r.sequence)).size).toBe(100);
  expect(retained.value[0].sequence).toBe(3);
  const oldest = retained.value[0];
  await page.evaluate(() => window.historyHarness.batch(1));
  const stale = await page.evaluate(
    (id) => window.historyHarness.save('late', '{}', id, 1, true),
    oldest.entryId,
  );
  expect(stale).toMatchObject({ ok: true, value: { record: null } });
  for (const kind of ['quota', 'abort'] as const) {
    const before = await page.evaluate(() => window.historyHarness.history());
    expect(await page.evaluate((kind) => window.historyHarness.fault(kind), kind)).toMatchObject({
      ok: false,
      code: kind === 'quota' ? 'S_QUOTA' : 'S_ABORTED',
    });
    expect(await page.evaluate(() => window.historyHarness.history())).toEqual(before);
  }
  const large = await page.evaluate(() => window.historyHarness.batch(10, 950000));
  expect(large.every((r) => r.ok)).toBe(true);
  const bounded = await page.evaluate(() => window.historyHarness.history());
  if (!bounded.ok) throw new Error(bounded.code);
  const bytes = Buffer.byteLength(bounded.value.map((r) => JSON.stringify(r)).join(''));
  expect(bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(bounded.value).toHaveLength(8);
  expect(await page.evaluate(() => window.historyHarness.read())).toEqual(initial);
  await page.evaluate(() => window.historyHarness.corrupt());
  expect(await page.evaluate(() => window.historyHarness.history())).toEqual({
    ok: false,
    code: 'S_RECORD_INVALID',
  });
  expect(await page.evaluate(() => window.historyHarness.read())).toEqual(initial);
  const cleared = await page.evaluate(() => window.historyHarness.clear());
  expect(cleared.meta.generation).not.toBe(initial.meta.generation);
  expect(await second.evaluate(() => window.historyHarness.save('old generation'))).toMatchObject({
    ok: false,
    code: 'S_GENERATION_STALE',
  });
  await second.close();
  await page.evaluate((name) => window.historyHarness.open(name), name);
  expect(await page.evaluate(() => window.historyHarness.history())).toEqual({
    ok: true,
    value: [],
  });
  await info.attach('native-count-bytes-isolation', {
    body: JSON.stringify({
      initial,
      retained: retained.value.map((r) => ({ id: r.entryId, sequence: r.sequence })),
      bytes,
      byteRetained: bounded.value.length,
      cleared,
    }),
    contentType: 'application/json',
  });
});

test('13.4 native DB2 migration preserves the eleven old projections; damaged known meta is clearable and future meta is untouched', async ({
  page,
}) => {
  await page.goto('/checks/');
  for (const kind of ['valid', 'damaged', 'future'] as const) {
    const name = `c-viz-learning.test.${randomUUID()}`;
    await page.evaluate((name) => window.historyHarness.open(name), name);
    const before = await page.evaluate((kind) => window.historyHarness.seedV2(kind), kind);
    const after = await page.evaluate(() => window.historyHarness.reopen());
    if (kind === 'valid') {
      expect(after).toEqual({
        ok: true,
        value: {
          ...before,
          meta: { ...before.meta, schemaVersion: '7.0.0', dbVersion: 7, revision: 8 },
        },
      });
      expect(await page.evaluate(() => window.historyHarness.history())).toEqual({
        ok: true,
        value: [],
      });
    } else if (kind === 'damaged') {
      expect(after).toEqual({ ok: false, code: 'S_RECORD_INVALID' });
      const recovery = await page.evaluate(() => window.historyHarness.recover());
      expect(recovery).toMatchObject({ ok: true, value: { canClear: true, writable: false } });
      await page.evaluate(() => window.historyHarness.clear());
    } else {
      expect(after).toEqual({ ok: false, code: 'S_VERSION_UNKNOWN' });
      const unchanged = await page.evaluate(async (name) => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open(name);
          r.onsuccess = () => resolve(r.result);
        });
        const meta = await new Promise<unknown>((resolve) => {
          const r = db.transaction('meta').objectStore('meta').get('current');
          r.onsuccess = () => resolve(r.result);
        });
        const value = { version: db.version, names: [...db.objectStoreNames], meta };
        db.close();
        return value;
      }, name);
      expect(unchanged.version).toBe(2);
      expect(unchanged.names).toHaveLength(11);
      expect(unchanged.meta).toEqual(before.meta);
    }
  }
});

const history = (page: Page) => page.getByTestId('editor-history');
const editor = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const panel = (page: Page) => page.getByTestId('practice-execution');
async function readyHistory(page: Page) {
  await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
}
async function savedRows(page: Page): Promise<EditorSnapshot[]> {
  await readyHistory(page);
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    try {
      return await new Promise<EditorSnapshot[]>((resolve) => {
        const r = db.transaction('editHistory').objectStore('editHistory').getAll();
        r.onsuccess = () =>
          resolve(r.result.sort((a: EditorSnapshot, b: EditorSnapshot) => a.sequence - b.sequence));
      });
    } finally {
      db.close();
    }
  });
}
async function open(page: Page) {
  await page.goto('/#/practice/exercise.c.first-output');
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await readyHistory(page);
  await history(page).locator('summary').click();
}
async function restore(page: Page, id: string) {
  const before = (await savedRows(page)).at(-1)?.sequence ?? 0;
  await page.getByRole('combobox', { name: '历史版本', exact: true }).selectOption(id);
  await history(page).getByRole('button', { name: '恢复所选版本', exact: true }).click();
  await expect
    .poll(async () =>
      (await savedRows(page)).some(
        (r) =>
          r.reason === 'restore' &&
          r.restoredFrom === id &&
          r.sequence > before &&
          r.state !== 'pending',
      ),
    )
    .toBe(true);
  await readyHistory(page);
}
test('13.4 real editor: code history survives refresh, invalid drafts stay exact, old Rust runs clear and current locks still apply', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await open(page);
  const original = await editor(page).inputValue();
  const valid = original.replace('return 0;', 'printf("History");\n    return 0;');
  expect(valid).not.toBe(original);
  await editor(page).fill(valid);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  const validId = (await savedRows(page)).find((r) => r.codeText === valid)!.entryId;
  const invalid = `${valid}\nint`;
  await editor(page).fill(invalid);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'invalid');
  const invalidId = (await savedRows(page)).find((r) => r.codeText === invalid)!.entryId;
  const locked = valid.replace('printf(', 'while (0) {}\n  printf(');
  await editor(page).fill(locked);
  await expect(page.getByTestId('block-permission-blocked')).toBeVisible();
  const lockedId = (await savedRows(page)).find((r) => r.codeText === locked)!.entryId;
  await restore(page, validId);
  await expect(editor(page)).toHaveValue(valid);
  await panel(page).getByRole('button', { name: '运行本组', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'ran');
  const worker = await observedCaseSetExecute(page);
  const request = JSON.parse(Buffer.from(worker.requestBytes!).toString()) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(worker.responseBytes!).buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.terminal.status).toBe('completed');
  await restore(page, invalidId);
  await expect(editor(page)).toHaveValue(invalid);
  await expect(page.getByTestId('player-controls')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: '运行本组', exact: true })).toBeDisabled();
  await restore(page, lockedId);
  await expect(page.getByTestId('block-permission-blocked')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeDisabled();
  await page.reload();
  await expect(editor(page)).toHaveValue(original);
  await readyHistory(page);
  await history(page).locator('summary').click();
  await restore(page, invalidId);
  await expect(editor(page)).toHaveValue(invalid);
  await info.attach('real-history-rust', {
    body: JSON.stringify({
      request,
      result,
      versions: (await savedRows(page)).map((row) => ({ ...row, workspaceJson: undefined })),
    }),
    contentType: 'application/json',
  });
});

test('13.4 native block value/add/delete and drag endpoints restore exact canvas and remain usable at three widths', async ({
  page,
}, info) => {
  await open(page);
  const source = (await editor(page).inputValue()).replace(
    'return 0;',
    'printf("history start");\n    return 0;',
  );
  await editor(page).fill(source);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await showPracticeBlocks(page, { readOnly: false });
  const outputs = await blockOptions(page, /^\d+\. 输出 ·/);
  await selectBlock(page, outputs[0]);
  await blockWorkspace(page)
    .getByRole('textbox', { name: '输出格式', exact: true })
    .fill('history value');
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  const valueRow = (await savedRows(page)).filter((r) => r.reason === 'blocks').at(-1)!;
  expect(valueRow.codeText).toContain('history value');
  const workspace = blockWorkspace(page);
  await workspace
    .getByRole('combobox', { name: '添加积木类型', exact: true })
    .selectOption('integer');
  await workspace.getByRole('button', { name: '添加积木', exact: true }).click();
  await readyHistory(page);
  const added = (await savedRows(page)).filter((r) => r.state === 'invalid').at(-1)!;
  expect(added).toBeDefined();
  const loose = JSON.parse(added.workspaceJson).blocks.blocks.find(
    (block: { type: string }) => block.type === 'cv_integer',
  );
  const native = workspace
    .locator(`.block-canvas .blocklyBlockCanvas [data-id=${JSON.stringify(loose.id)}]`)
    .first();
  await native.scrollIntoViewIfNeeded();
  const rect = await native.boundingBox();
  if (!rect) throw new Error('Native block absent');
  await page.mouse.move(rect.x + 15, rect.y + 12);
  await page.mouse.down();
  await page.mouse.move(rect.x + 120, rect.y + 80, { steps: 16 });
  await page.mouse.up();
  await expect
    .poll(async () => (await savedRows(page)).filter((r) => r.reason === 'move').length)
    .toBeGreaterThan(0);
  const moved = (await savedRows(page)).filter((r) => r.reason === 'move').at(-1)!;
  expect(moved.workspaceJson).not.toBe(added.workspaceJson);
  const integers = await blockOptions(page, /^\d+\. 整数 ·/);
  await selectBlock(
    page,
    integers.find((id) => id === loose.id)!,
  );
  await workspace.getByRole('button', { name: '删除选中积木', exact: true }).click();
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  const deleted = (await savedRows(page)).filter((r) => r.reason === 'blocks').at(-1)!;
  expect(deleted.workspaceJson).not.toBe(moved.workspaceJson);
  await restore(page, valueRow.entryId);
  await expect(editor(page)).toHaveValue(valueRow.codeText);
  await restore(page, moved.entryId);
  const restored = (await savedRows(page)).filter((r) => r.reason === 'restore').at(-1)!;
  expect(restored.workspaceJson).toBe(moved.workspaceJson);
  const widths = [];
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await history(page).scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      outside: [...document.querySelectorAll('*')]
        .map((el) => ({
          tag: el.tagName,
          class: el.getAttribute('class'),
          ancestors: [
            ...(function* (e) {
              for (let n = e.parentElement; n; n = n.parentElement) yield n;
            })(el),
          ]
            .slice(0, 8)
            .map(
              (n) =>
                n.tagName +
                '.' +
                n.classList.value +
                ':' +
                getComputedStyle(n).overflow +
                ':' +
                getComputedStyle(n).position,
            ),
          right: el.getBoundingClientRect().right,
        }))
        .filter((el) => el.right > innerWidth + 1)
        .slice(0, 20),
    }));
    if (bounds.scroll > width + 1) {
      const overflowing = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('*')]
          .filter((el) => el.scrollWidth > el.clientWidth + 2)
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            client: el.clientWidth,
            scroll: el.scrollWidth,
            overflow: getComputedStyle(el).overflow,
            position: getComputedStyle(el).position,
          }))
          .filter((e) => e.tag !== 'g')
          .slice(0, 30),
      );
      await page.screenshot({ path: '.artifacts/13.4/overflow-full.png', fullPage: true });
      await info.attach('overflow', {
        body: JSON.stringify(overflowing),
        contentType: 'application/json',
      });
      expect(bounds.scroll, JSON.stringify(overflowing)).toBeLessThanOrEqual(width + 1);
    }
    await expect(history(page).getByRole('button', { name: '恢复所选版本' })).toBeVisible();
    await page.screenshot({ path: `.artifacts/13.4/history-${width}.png` });
    widths.push(width);
  }
  await info.attach('native-block-history', {
    body: JSON.stringify({ added, moved, restored, widths }),
    contentType: 'application/json',
  });
});

test('13.4 production save failure stays visible, explicit retry preserves IDs and clear removes history across tabs', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const native = IDBObjectStore.prototype.put;
    (window as unknown as { failHistory: boolean }).failHistory = false;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (
        this.name === 'editHistory' &&
        (window as unknown as { failHistory: boolean }).failHistory
      ) {
        (window as unknown as { failHistory: boolean }).failHistory = false;
        throw new DOMException('QA injection', 'QuotaExceededError');
      }
      return native.call(this, value, key);
    };
  });
  await open(page);
  const text = `${await editor(page).inputValue()}\nint`;
  await page.evaluate(() => {
    (window as unknown as { failHistory: boolean }).failHistory = true;
  });
  await editor(page).fill(text);
  await expect(history(page)).toHaveAttribute('data-save-state', 'unsaved');
  await expect(history(page)).toContainText('浏览器空间不足');
  await expect(editor(page)).toHaveValue(text);
  const selected = await page.getByRole('combobox', { name: '历史版本', exact: true }).inputValue();
  await history(page).getByRole('button', { name: '重试保存历史', exact: true }).click();
  await readyHistory(page);
  expect((await savedRows(page)).some((r) => r.entryId === selected && r.codeText === text)).toBe(
    true,
  );
  const settings = await context.newPage();
  await settings.goto('/#/settings?panel=data');
  await expect(settings.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    p05CourseRelease.registered ? 'ready' : /^(ready|unsaved)$/,
  );
  await settings.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await expect(settings.getByRole('dialog')).toContainText('编辑历史');
  await settings.getByRole('dialog').getByRole('button', { name: '确认清除', exact: true }).click();
  await expect(settings.getByTestId('learning-save-status')).toContainText('本地数据已清除');
  if ((await history(page).getAttribute('open')) === null)
    await history(page).locator('summary').click();
  await expect(editor(page)).not.toHaveValue(text);
  const fresh = await savedRows(page);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]).toMatchObject({ reason: 'initial', documentRevision: 1 });
  expect(fresh[0].entryId).not.toBe(selected);
  expect(fresh[0].codeText).not.toBe(text);
  const remaining = await settings.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    try {
      return await new Promise<number>((resolve) => {
        const r = db.transaction('editHistory').objectStore('editHistory').count();
        r.onsuccess = () => resolve(r.result);
      });
    } finally {
      db.close();
    }
  });
  expect(remaining).toBe(1);
});
