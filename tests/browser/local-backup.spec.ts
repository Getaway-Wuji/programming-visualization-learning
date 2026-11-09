import type {} from './harness/mysql-storage';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/checks/mysql-storage.html');
  await page.waitForFunction(() => Boolean(window.mysqlStorageHarness));
});

test('full archive preserves all stored rows, native keys and Blob bytes across new generations', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    await h.seedBackup(name);
    const opened = await h.open(name);
    if (!opened.ok) throw new Error(opened.code);
    const id = opened.value.id;
    const session = h.session();
    session.transaction = { active: true, base: structuredClone(session.database) };
    const saved = await h.save(id, { source: 'SELECT 保存的草稿', session }, null);
    if (!saved.ok) throw new Error(saved.code);
    const backup = await h.backup(id);
    if (!backup.ok) throw new Error(backup.code);
    const prepared = await h.prepareBackup(id, backup.value);
    if (!prepared.ok) throw new Error(prepared.code);
    const before = await h.dump(name);
    const current = await h.read(id);
    if (!current.ok) throw new Error(current.code);
    const original = current.value.snapshot.meta;
    const restored = await h.restoreBackup(
      id,
      prepared.value.token,
      original.generation,
      original.revision,
    );
    if (!restored.ok) throw new Error(restored.code);
    const after = await h.dump(name);
    const read = await h.read(id);
    const stale = await h.save(
      id,
      { source: 'late old write', session },
      null,
      restored.value.meta.revision,
      original.generation,
    );
    return {
      before,
      after,
      original,
      restored: restored.value,
      read,
      stale,
      summary: prepared.value.summary,
      text: backup.value,
      afterStale: await h.dump(name),
    };
  }, `c-viz-learning.test.mysql-storage.backup-${randomUUID()}`);
  expect(result.restored.meta.generation).not.toBe(result.original.generation);
  expect(result.restored.meta.revision).toBe(result.original.revision + 1);
  expect(result.read.ok).toBe(true);
  expect(result.summary.background).toBe(true);
  expect(result.summary.storeCounts.mysqlDrafts).toBe(1);
  expect(result.text).not.toContain('apiKey');
  const normalize = (data: unknown) =>
    JSON.parse(
      JSON.stringify(data).replaceAll(result.restored.meta.generation, result.original.generation),
    );
  for (const store of result.before.stores) {
    const after = result.after.stores.find((s) => s.name === store.name)!;
    if (store.name === 'meta')
      expect(normalize(after.values)).toEqual([
        { ...(store.values[0] as object), revision: result.restored.meta.revision },
      ]);
    else expect(normalize(after)).toEqual(store);
  }
  expect(result.stale).toMatchObject({ ok: false, code: 'S_GENERATION_STALE' });
  expect(result.afterStale).toEqual(result.after);
});

for (const failure of ['quota', 'abort-after-success'] as const)
  test(`restore rolls back every store on ${failure}`, async ({ page }) => {
    const result = await page.evaluate(
      async ({ name, failure }) => {
        const h = window.mysqlStorageHarness;
        await h.seedBackup(name);
        const opened = await h.open(name);
        if (!opened.ok) throw new Error(opened.code);
        const { id } = opened.value;
        const saved = await h.save(id, { source: 'SELECT 1;', session: h.session() }, null);
        if (!saved.ok) throw new Error(saved.code);
        const backup = await h.backup(id);
        if (!backup.ok) throw new Error(backup.code);
        const prepared = await h.prepareBackup(id, backup.value);
        if (!prepared.ok) throw new Error(prepared.code);
        const current = await h.read(id);
        if (!current.ok) throw new Error(current.code);
        const before = await h.dump(name);
        h.failBackup(failure);
        const meta = current.value.snapshot.meta;
        const restored = await h.restoreBackup(
          id,
          prepared.value.token,
          meta.generation,
          meta.revision,
        );
        return { before, restored, after: await h.dump(name) };
      },
      { name: `c-viz-learning.test.mysql-storage.backup-${randomUUID()}`, failure },
    );
    expect(result.restored).toMatchObject({
      ok: false,
      code: failure === 'quota' ? 'S_QUOTA' : 'S_ABORTED',
    });
    expect(result.after).toEqual(result.before);
  });

test('new writes after preview prevent an old confirmation from overwriting the archive', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    const opened = await h.open(name);
    if (!opened.ok) throw new Error(opened.code);
    const { id, snapshot } = opened.value;
    const backup = await h.backup(id);
    if (!backup.ok) throw new Error(backup.code);
    const prepared = await h.prepareBackup(id, backup.value);
    if (!prepared.ok) throw new Error(prepared.code);
    await h.save(id, { source: 'new work after preview', session: h.session() }, null);
    const before = await h.dump(name);
    const restored = await h.restoreBackup(
      id,
      prepared.value.token,
      snapshot.meta.generation,
      snapshot.meta.revision,
    );
    return { before, restored, after: await h.dump(name) };
  }, `c-viz-learning.test.mysql-storage.backup-${randomUUID()}`);
  expect(result.restored).toMatchObject({ ok: false, code: 'S_REVISION_CONFLICT' });
  expect(result.after).toEqual(result.before);
});

test('a valid confirmed backup repairs corrupt records in a known DB15 archive', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    const opened = await h.open(name);
    if (!opened.ok) throw new Error(opened.code);
    const { id, snapshot } = opened.value;
    const backup = await h.backup(id);
    if (!backup.ok) throw new Error(backup.code);
    const prepared = await h.prepareBackup(id, backup.value);
    if (!prepared.ok) throw new Error(prepared.code);
    await h.corruptBackupProgress(name);
    const damaged = await h.recovered(id);
    const restored = await h.restoreBackup(
      id,
      prepared.value.token,
      snapshot.meta.generation,
      snapshot.meta.revision,
    );
    return { damaged, restored, recovered: await h.recovered(id) };
  }, `c-viz-learning.test.mysql-storage.backup-${randomUUID()}`);
  expect(result.damaged.writable).toBe(false);
  expect(result.restored.ok).toBe(true);
  expect(result.recovered.writable).toBe(true);
  expect(result.recovered.issues).toEqual([]);
});
