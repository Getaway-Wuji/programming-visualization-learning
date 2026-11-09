import type {} from './harness/mysql-storage';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { MysqlDraftInput } from '../../web/src/storage/mysql-course';

function name() {
  return `c-viz-learning.test.mysql-storage.${randomUUID()}`;
}
type Answer<T> = { ok: true; value: T } | { ok: false; code: string };
function value<T>(answer: Answer<T>) {
  expect(answer.ok, answer.ok ? '' : answer.code).toBe(true);
  if (!answer.ok) throw new Error(answer.code);
  return answer.value;
}
test.beforeEach(async ({ page }) => {
  await page.goto('/checks/mysql-storage.html');
  await page.waitForFunction(() => Boolean(window.mysqlStorageHarness));
});

test('DB14 adds only two empty stores and preserves all old keys, rows and Blob bytes', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    const before = await h.seed(name);
    const opened = await h.open(name);
    const after = await h.dump(name);
    if (!opened.ok) throw new Error(opened.code);
    const oldReads = await h.oldReads(opened.value.id);
    const oldWrite = await h.oldWrite(opened.value.id);
    return { before, after, oldReads, oldWrite, opened };
  }, name());
  expect(result.before.version).toBe(14);
  expect(result.before.stores).toHaveLength(27);
  expect(result.after.version).toBe(15);
  expect(result.after.stores).toHaveLength(29);
  const beforeMeta = result.before.stores.find((s) => s.name === 'meta')!.values as object[];
  for (const original of result.before.stores) {
    const upgraded = result.after.stores.find((s) => s.name === original.name)!;
    if (original.name === 'meta')
      expect(upgraded.values).toEqual([
        {
          ...beforeMeta[0],
          dbVersion: 15,
          schemaVersion: '15.0.0',
          activeCatalogSetRef: { id: 'catalog-set.c-python-java-cpp-rust-mysql', version: '1.0.0' },
        },
      ]);
    else expect(upgraded).toEqual(original);
  }
  for (const store of result.after.stores.filter((s) => s.name.startsWith('mysql'))) {
    expect(store.keys).toEqual([]);
    expect(store.values).toEqual([]);
    expect(store.keyPath).toBeNull();
    expect(store.autoIncrement).toBe(false);
    expect(store.indexes).toEqual([]);
  }
  expect(result.oldReads.map((s) => s.rows.drafts.length)).toEqual([1, 1, 1, 1, 1]);
  expect(result.oldReads.slice(1).map((s) => s.rows.activities.length)).toEqual([1, 1, 1, 1]);
  expect(result.oldWrite.rows.drafts[0]).toMatchObject({
    draftVersion: '2.2.0',
    source: 'new-rust',
  });
});

for (const version of [10, 11, 12, 13])
  test(`validated DB${version} predecessor follows the sequential chain to DB15`, async ({
    page,
  }) => {
    const answer = await page.evaluate(
      async ({ name, version }) => {
        const h = window.mysqlStorageHarness;
        const before = await h.seed(name, version);
        const opened = await h.open(name);
        const after = await h.dump(name);
        return { before, opened, after };
      },
      { name: name(), version },
    );
    const opened = value(answer.opened);
    expect(opened.snapshot.meta.dbVersion).toBe(15);
    expect(answer.after.stores).toHaveLength(29);
    for (const original of answer.before.stores.filter((s) => s.name !== 'meta'))
      expect(answer.after.stores.find((s) => s.name === original.name)).toEqual(original);
  });
test('fresh DB0 initializes DB15 without fabricating learning facts', async ({ page }) => {
  const opened = value(
    await page.evaluate((name) => window.mysqlStorageHarness.open(name), name()),
  );
  expect(opened.snapshot.meta.dbVersion).toBe(15);
  expect(opened.snapshot.progress).toEqual([]);
  expect(opened.snapshot.receipts).toEqual([]);
  expect(opened.snapshot.ledger).toEqual([]);
});

test('a blocked upgrade stops permanently and requires an explicit retry after the blocker closes', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    const before = await h.seed(name);
    await h.block(name);
    const failed = await h.open(name);
    h.unblock(name);
    const after = await h.dump(name);
    const retry = await h.open(name);
    return { before, failed, after, retry };
  }, name());
  expect(result.failed).toMatchObject({ ok: false, code: 'S_UPGRADE_BLOCKED' });
  expect(result.after).toEqual(result.before);
  expect(value(result.retry).snapshot.meta.dbVersion).toBe(15);
});
test('versionchange closes the old client and preserves its original rows through upgrade', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    const before = await h.seed(name);
    const old = await h.openOld(name);
    const opened = await h.open(name);
    return {
      before,
      opened,
      invalidations: h.invalidations(old),
      oldRead: await h.read(old),
      after: await h.dump(name),
    };
  }, name());
  expect(result.opened.ok).toBe(true);
  expect(result.invalidations).toBeGreaterThan(0);
  expect(result.oldRead.ok).toBe(false);
  for (const original of result.before.stores.filter((s) => s.name !== 'meta'))
    expect(result.after.stores.find((s) => s.name === original.name)).toEqual(original);
});
test('a future native database version is preserved without a repair or reset', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    await h.seed(name);
    await h.future(name);
    const before = await h.dump(name);
    const opened = await h.open(name);
    return { before, opened, after: await h.dump(name) };
  }, name());
  expect(result.opened).toMatchObject({ ok: false, code: 'S_VERSION_UNKNOWN' });
  expect(result.after).toEqual(result.before);
});

for (const store of ['courseDrafts', 'pythonDrafts', 'javaDrafts', 'cppDrafts', 'rustDrafts'])
  for (const kind of ['row', 'key'] as const)
    test(`invalid predecessor ${store} ${kind} aborts the whole native upgrade`, async ({
      page,
    }) => {
      const result = await page.evaluate(
        async ({ name, store, kind }) => {
          const h = window.mysqlStorageHarness;
          const before = await h.seed(name, 14, { store, kind });
          const opened = await h.open(name);
          const after = await h.dump(name);
          return { before, opened, after };
        },
        { name: name(), store, kind },
      );
      expect(result.opened.ok).toBe(false);
      expect(result.after).toEqual(result.before);
    });

for (const mode of ['index', 'extra-store', 'meta'] as const)
  test(`unknown predecessor ${mode} preserves its original layout and data`, async ({ page }) => {
    const result = await page.evaluate(
      async ({ name, mode }) => {
        const h = window.mysqlStorageHarness;
        const before = await h.seed(name, 14, { store: 'rustDrafts', kind: mode });
        const opened = await h.open(name);
        const after = await h.dump(name);
        return { before, opened, after };
      },
      { name: name(), mode },
    );
    expect(result.opened.ok).toBe(false);
    expect(result.after).toEqual(result.before);
  });
for (const fault of ['upgrade-create', 'upgrade-meta'] as const)
  test(`injected ${fault} leaves no half migration and an explicit retry succeeds`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      async ({ name, fault }) => {
        const h = window.mysqlStorageHarness;
        const before = await h.seed(name);
        h.fail(fault);
        const failed = await h.open(name);
        const after = await h.dump(name);
        const retry = await h.open(name);
        return { before, failed, after, retry };
      },
      { name: name(), fault },
    );
    expect(result.failed.ok).toBe(false);
    expect(result.after).toEqual(result.before);
    expect(value(result.retry).snapshot.meta.dbVersion).toBe(15);
  });

test('SQL and active transaction survive close/reopen and actual WASM ROLLBACK restores saved base', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    const opened = await h.open(name);
    if (!opened.ok) throw new Error(opened.code);
    const running = await h.run('BEGIN; UPDATE students SET score = score + 1 WHERE id = 1;');
    const saved = await h.save(
      opened.value.id,
      { source: 'ROLLBACK;', session: running.session },
      null,
    );
    await h.close(opened.value.id);
    const reopened = await h.open(name);
    if (!reopened.ok) throw new Error(reopened.code);
    const read = await h.read(reopened.value.id);
    if (!read.ok) throw new Error(read.code);
    const draft = read.value.rows.drafts[0];
    const rolledBack = await h.run(draft.source, draft.session);
    return { running, saved, draft, rolledBack, snapshot: read.value.snapshot };
  }, name());
  expect(result.running.status).toBe('completed');
  expect(result.running.session.transaction.active).toBe(true);
  expect(result.saved.ok).toBe(true);
  expect(result.draft.session).toEqual(result.running.session);
  expect(Object.keys(result.draft).sort()).toEqual([
    'documentId',
    'draftVersion',
    'generation',
    'revision',
    'session',
    'source',
    'updatedAt',
  ]);
  expect(result.rolledBack.status).toBe('completed');
  expect(result.rolledBack.session.transaction).toEqual({ active: false, base: null });
  expect(result.rolledBack.session.database).toEqual(result.draft.session.transaction.base);
  expect(result.snapshot.progress).toEqual([]);
  expect(result.snapshot.ledger).toEqual([]);
});

for (const fault of ['quota', 'abort-after-success'] as const)
  test(`injected ${fault} atomically preserves prior SQL/session/meta`, async ({ page }) => {
    const result = await page.evaluate(
      async ({ name, fault }) => {
        const h = window.mysqlStorageHarness;
        const opened = await h.open(name);
        if (!opened.ok) throw new Error(opened.code);
        await h.save(opened.value.id, { source: 'SELECT 1;', session: h.session() }, null);
        const before = await h.dump(name);
        const state = await h.read(opened.value.id);
        if (!state.ok) throw new Error(state.code);
        const session = h.session();
        session.transaction = { active: true, base: structuredClone(session.database) };
        h.fail(fault);
        const failed = await h.save(
          opened.value.id,
          { source: 'BEGIN;', session },
          state.value.rows.drafts[0].revision,
        );
        return { failed, before, after: await h.dump(name) };
      },
      { name: name(), fault },
    );
    expect(result.failed.ok).toBe(false);
    expect(result.after).toEqual(result.before);
  });

test('two independent pages enforce document CAS and metadata CAS without broadcasts', async ({
  page,
  context,
}) => {
  const database = name();
  const second = await context.newPage();
  await second.goto('/checks/mysql-storage.html');
  await second.waitForFunction(() => Boolean(window.mysqlStorageHarness));
  const first = value(
    await page.evaluate((name) => window.mysqlStorageHarness.open(name), database),
  );
  const other = value(
    await second.evaluate((name) => window.mysqlStorageHarness.open(name), database),
  );
  const input: MysqlDraftInput = await page.evaluate(() => ({
    source: 'SELECT 1;',
    session: window.mysqlStorageHarness.session(),
  }));
  value(
    await page.evaluate(({ id, input }) => window.mysqlStorageHarness.save(id, input, null), {
      id: first.id,
      input,
    }),
  );
  const staleDocument = await second.evaluate(
    ({ id, input }) => window.mysqlStorageHarness.save(id, { ...input, source: 'SELECT 2;' }, null),
    { id: other.id, input },
  );
  expect(staleDocument).toMatchObject({ ok: false, code: 'S_REVISION_CONFLICT' });
  const current = value(
    await second.evaluate((id) => window.mysqlStorageHarness.read(id), other.id),
  );
  const staleMeta = await second.evaluate(
    ({ id, input, revision }) => window.mysqlStorageHarness.save(id, input, revision, 0),
    { id: other.id, input, revision: current.rows.drafts[0].revision },
  );
  expect(staleMeta).toMatchObject({ ok: false, code: 'S_REVISION_CONFLICT' });
  value(
    await second.evaluate(
      ({ id, input, revision }) =>
        window.mysqlStorageHarness.save(id, { ...input, source: 'SELECT 2;' }, revision),
      { id: other.id, input, revision: current.rows.drafts[0].revision },
    ),
  );
  expect(
    value(await page.evaluate((id) => window.mysqlStorageHarness.read(id), first.id)).rows.drafts[0]
      .source,
  ).toBe('SELECT 2;');
});

test('clear atomically empties all 29 stores and late old-generation writes cannot repopulate', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    await h.seed(name);
    const opened = await h.open(name);
    if (!opened.ok) throw new Error(opened.code);
    await h.save(opened.value.id, { source: 'SELECT 1;', session: h.session() }, null);
    const before = await h.read(opened.value.id);
    if (!before.ok) throw new Error(before.code);
    const cleared = await h.clear(opened.value.id);
    const late = await h.save(
      opened.value.id,
      { source: 'late', session: h.session() },
      null,
      cleared.meta.revision,
      before.value.snapshot.meta.generation,
    );
    return { before, cleared, late, after: await h.dump(name) };
  }, name());
  expect(result.cleared.meta.dbVersion).toBe(15);
  expect(result.cleared.meta.generation).not.toBe(value(result.before).snapshot.meta.generation);
  expect(result.late).toMatchObject({ ok: false, code: 'S_GENERATION_STALE' });
  for (const store of result.after.stores)
    expect(store.values.length).toBe(
      ['meta', 'settings', 'avatar', 'appearance'].includes(store.name) ? 1 : 0,
    );
});

test('corrupt MySQL row selects read-only recovery and preserves every predecessor row and Blob', async ({
  page,
}) => {
  const result = await page.evaluate(async (name) => {
    const h = window.mysqlStorageHarness;
    await h.seed(name);
    const opened = await h.open(name);
    if (!opened.ok) throw new Error(opened.code);
    await h.corruptMysql(name);
    const before = await h.dump(name);
    const recovery = await h.recovered(opened.value.id);
    return { recovery, before, after: await h.dump(name) };
  }, name());
  expect(result.recovery.writable).toBe(false);
  expect(result.recovery.courseReadOnly).toBe(true);
  expect(result.after).toEqual(result.before);
});
