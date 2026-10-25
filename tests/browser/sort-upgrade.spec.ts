import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { expect, test, type Page } from '@playwright/test';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

interface UpgradeWrite {
  store: string;
  mode: 'add' | 'put' | 'delete' | 'clear';
  value: unknown;
}
declare global {
  interface Window {
    __sortUpgradeWrites: UpgradeWrite[];
  }
}

let moduleCode = '';
test.beforeAll(async () => {
  // Reuse the storage-only entry and keep this extra bundle entirely in memory.
  const output = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./harness/reviewed-case-release.ts', import.meta.url)),
        formats: ['es'],
      },
    },
  });
  const result = (Array.isArray(output) ? output[0] : output) as Rollup.RollupOutput;
  const entry = result.output.find((item) => item.type === 'chunk' && item.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Storage-only fixture entry missing');
  moduleCode = entry.code;
});

const panel = (page: Page) => page.getByTestId('case-execution');
const controls = (page: Page) => page.getByTestId('player-controls');
const coverage = (page: Page) => page.getByTestId('case-view-coverage');

async function ready(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
}

/** Read the real database without creating facts, receipts or execution evidence. */
async function snapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const transaction = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const rows = await Promise.all(
        names.map(async (name) => [
          name,
          await new Promise<unknown>((resolve, reject) => {
            const store = transaction.objectStore(name);
            const request = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
              ? store.get('current')
              : store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
        ]),
      );
      await done;
      return Object.fromEntries(rows) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}

/** Deliberately synthetic legacy archive fixture, never a new learning event.
 * It models two old, already-rewarded confirmations through native IDB before
 * the formal app loads. The subsequent executions and confirmations are real. */
async function oldArchiveFixture(page: Page) {
  await page.route('**/checks/sort-upgrade-storage.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: moduleCode }),
  );
  await page.goto('/checks/');
  return page.evaluate(async () => {
    const moduleUrl = '/checks/sort-upgrade-storage.js';
    const { openStorage, recordKey } = (await import(
      moduleUrl
    )) as typeof import('./harness/reviewed-case-release');
    const client = await openStorage({
      recovery: true,
      activePackageRef: { id: 'content.c.p0', version: '1.0.1' },
      timeZone: 'Asia/Shanghai',
    });
    try {
      const initial = await client.read();
      if (initial.meta.revision !== 0 || initial.progress.length !== 0)
        throw new Error('This legacy fixture requires a fresh, isolated browser archive');
      const occurredAt = new Date().toISOString();
      const parts = new Intl.DateTimeFormat('en', {
        timeZone: initial.meta.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(occurredAt));
      const datePart = (type: string) => parts.find((part) => part.type === type)!.value;
      const localDate = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
      const targets = { exercise: 1, lesson: 1, case: 0 };
      const legacy = structuredClone(initial);
      legacy.settings.goalTemplate = { revision: 1, targets };
      legacy.goals = [{ localDate, goalVersion: 1, targets, achievedAt: null }];
      for (const id of ['case.c.bubble-sort', 'case.c.selection-sort']) {
        const subjectRef = { id, version: '1.0.1' };
        legacy.progress.push({
          eventType: 'case.view-confirmed',
          result: 'confirmed',
          subjectRef,
          packageRef: { id: 'content.c.p0', version: '1.0.1' },
          learningRevision: 1,
          firstAt: occurredAt,
          lastAt: occurredAt,
        });
        legacy.dailyFacts.push({
          eventType: 'case.view-confirmed',
          subjectRef,
          canonicalSubjectId: id,
          occurredAt,
          localDate,
        });
        legacy.ledger.push({
          sourceId: 'reward.case.first-view',
          subjectId: id,
          occurredAt,
          localDate,
          status: 'posted',
          points: 5,
          policyRef: { id: 'reward.policy.p0', version: '1.0.0' },
        });
      }
      // Direct fixture insertion preserves the actual old revision-zero marker.
      // A normal learning commit would advance it and mint a different scenario.
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = db.transaction(
          ['settings', 'goals', 'progress', 'dailyFacts', 'ledger'],
          'readwrite',
        );
        const done = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
        });
        transaction.objectStore('settings').put(legacy.settings, 'current');
        for (const goal of legacy.goals)
          transaction
            .objectStore('goals')
            .add(goal, recordKey('goals', legacy.meta.generation, goal));
        for (const row of legacy.progress)
          transaction
            .objectStore('progress')
            .add(row, recordKey('progress', legacy.meta.generation, row));
        for (const row of legacy.dailyFacts)
          transaction
            .objectStore('dailyFacts')
            .add(row, recordKey('dailyFacts', legacy.meta.generation, row));
        for (const row of legacy.ledger)
          transaction
            .objectStore('ledger')
            .add(row, recordKey('ledger', legacy.meta.generation, row));
        await done;
      } finally {
        db.close();
      }
      return { kind: 'synthetic-legacy-archive-fixture', localDate, before: await client.read() };
    } finally {
      client.close();
    }
  });
}

async function observeFormalWrites(page: Page) {
  await page.addInitScript(() => {
    window.__sortUpgradeWrites = [];
    const capture = (store: IDBObjectStore, mode: UpgradeWrite['mode'], value: unknown) => {
      if (store.transaction.db.name === 'c-viz-learning')
        window.__sortUpgradeWrites.push({ store: store.name, mode, value: structuredClone(value) });
    };
    const nativeAdd = IDBObjectStore.prototype.add;
    const nativePut = IDBObjectStore.prototype.put;
    const nativeDelete = IDBObjectStore.prototype.delete;
    const nativeClear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.add = function (value, key) {
      capture(this, 'add', value);
      return key === undefined ? nativeAdd.call(this, value) : nativeAdd.call(this, value, key);
    };
    IDBObjectStore.prototype.put = function (value, key) {
      capture(this, 'put', value);
      return key === undefined ? nativePut.call(this, value) : nativePut.call(this, value, key);
    };
    IDBObjectStore.prototype.delete = function (key) {
      capture(this, 'delete', key);
      return nativeDelete.call(this, key);
    };
    IDBObjectStore.prototype.clear = function () {
      capture(this, 'clear', null);
      return nativeClear.call(this);
    };
  });
}

async function presentCurrentFrame(page: Page) {
  const array = page.getByTestId('trace-array');
  const core =
    (await array.count()) > 0
      ? array
      : page.getByTestId('trace-view').getByLabel('当前变量', { exact: true });
  await core.scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

function expectOldRowsAndBalance(before: StorageSnapshot, after: StorageSnapshot) {
  for (const key of [
    'settings',
    'avatar',
    'appearance',
    'appearanceAssets',
    'goals',
    'aliases',
    'dailyFacts',
    'ledger',
  ] as const)
    expect(after[key]).toEqual(before[key]);
  for (const old of before.progress) expect(after.progress).toContainEqual(old);
  expect(after.ledger.reduce((sum, row) => sum + (row.points ?? 0), 0)).toBe(10);
  expect(after.meta.generation).toBe(before.meta.generation);
  expect(after.meta.timeZone).toBe(before.meta.timeZone);
  expect(after.meta.createdAt).toBe(before.meta.createdAt);
  expect(after.meta.activePackageRef).toEqual({ id: 'content.c.p0', version: '1.0.2' });
}

test('old rewarded sorting history survives the reviewed upgrade and genuine repeated confirmations without duplicate points or daily facts', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const fixture = await oldArchiveFixture(page);
  expect(fixture.before.meta).toMatchObject({
    revision: 0,
    activePackageRef: { id: 'content.c.p0', version: '1.0.1' },
  });
  expect(fixture.before.progress).toHaveLength(2);
  expect(fixture.before.dailyFacts).toHaveLength(2);
  expect(fixture.before.ledger).toHaveLength(2);
  expect(fixture.before.receipts).toEqual([]);
  await observeCaseSetExecution(page);
  await observeFormalWrites(page);
  const runs = [];
  for (const [index, id] of ['case.c.bubble-sort', 'case.c.selection-sort'].entries()) {
    await page.goto(`/#/visualize/${id}`);
    await ready(page);
    await expect(panel(page)).toHaveAttribute('data-state', 'ready');
    const history = page.locator(`[data-learning-subject="${id}"]`);
    await expect(history).toBeVisible();
    await expect(history).toContainText('当前内容兼容的历史记录：已确认观看');
    if (index === 0) {
      const upgraded = await snapshot(page);
      expect(upgraded.meta).toEqual({
        ...fixture.before.meta,
        revision: 1,
        activePackageRef: { id: 'content.c.p0', version: '1.0.2' },
      });
      expect({ ...upgraded, meta: fixture.before.meta }).toEqual(fixture.before);
      const initializationWrites = await page.evaluate(() => window.__sortUpgradeWrites);
      // Opening storage first probes writability with the unchanged meta. The
      // separately controlled package CAS then writes exactly the new meta.
      expect(initializationWrites.map((write) => write.store)).toEqual(['meta', 'meta']);
      expect(initializationWrites.map((write) => write.value)).toEqual([
        fixture.before.meta,
        upgraded.meta,
      ]);
    }
    await page.getByTestId('input-field-values').fill('[]');
    await panel(page).getByRole('button', { name: '应用输入并准备', exact: true }).click();
    await expect(panel(page)).toHaveAttribute('data-state', 'ready');
    await panel(page).getByRole('button', { name: '运行示例', exact: true }).click();
    await expect(panel(page)).toHaveAttribute('data-state', 'completed');
    const worker = await observedCaseSetExecute(page);
    expect(worker).toMatchObject({ moduleSeen: true, responseOk: true, terminated: true });
    expect(worker.responseOperationId).toBe(worker.operationId);
    const request = JSON.parse(
      Buffer.from(worker.requestBytes!).toString('utf8'),
    ) as ExecuteRequest;
    const result = await decodeResult(Uint8Array.from(worker.responseBytes!).buffer, request);
    expect(request.subjectRef).toEqual({ id, version: '1.0.2' });
    expect(request.packageRef).toEqual({ id: 'content.c.p0', version: '1.0.2' });
    expect(request.learningRevision).toBe(1);
    expect(request.input.values).toEqual({ values: [] });
    expect(result.producer).toBe('rust');
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(result.trace?.completeness).toBe('complete');
    expect(result.identity).toEqual(request.identity);
    await expect(
      panel(page).getByRole('textbox', { name: '当前执行的 C 代码', exact: true }),
    ).toHaveValue(request.source.text.replace(/\r\n?/gu, '\n'));
    const length = result.trace!.steps.length;
    await expect(controls(page)).toHaveAttribute('data-cursor', '0');
    await expect(coverage(page)).toHaveAttribute('data-total', String(length));
    await presentCurrentFrame(page);
    for (let cursor = 1; cursor <= length; cursor++) {
      await controls(page).getByRole('button', { name: '前进', exact: true }).click();
      await expect(controls(page)).toHaveAttribute('data-cursor', String(cursor));
      await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', String(cursor));
      await presentCurrentFrame(page);
      await expect(coverage(page)).toHaveAttribute('data-covered', String(cursor));
    }
    const confirmation = page.getByTestId('case-view-confirmation');
    await expect(confirmation).toHaveAttribute('data-view-state', 'ready');
    await confirmation.getByRole('button', { name: '确认已观看', exact: true }).click();
    await expect(confirmation).toHaveAttribute('data-view-state', 'saved');
    await ready(page);
    const after = await snapshot(page);
    expectOldRowsAndBalance(fixture.before, after);
    expect(after.progress).toHaveLength(2 + index + 1);
    expect(after.receipts).toHaveLength(index + 1);
    const receipt = after.receipts.find((row) => row.subjectRef.id === id)!;
    expect(receipt).toMatchObject({
      eventType: 'case.view-confirmed',
      result: 'confirmed',
      subjectRef: request.subjectRef,
      packageRef: request.packageRef,
      learningRevision: 1,
      localDate: fixture.localDate,
    });
    expect(after.progress).toContainEqual({
      eventType: 'case.view-confirmed',
      result: 'confirmed',
      subjectRef: request.subjectRef,
      packageRef: request.packageRef,
      learningRevision: 1,
      firstAt: receipt.occurredAt,
      lastAt: receipt.occurredAt,
    });
    runs.push({
      request,
      result,
      fullyPresentedCursors: Array.from({ length: length + 1 }, (_, cursor) => cursor),
      after,
    });
  }
  const writes = await page.evaluate(() => window.__sortUpgradeWrites);
  expect(writes.filter((write) => !['meta', 'progress', 'receipts'].includes(write.store))).toEqual(
    [],
  );
  expect(writes.filter((write) => ['delete', 'clear'].includes(write.mode))).toEqual([]);
  expect(writes.filter((write) => write.store === 'progress')).toHaveLength(2);
  expect(writes.filter((write) => write.store === 'receipts')).toHaveLength(2);
  expect(
    await page.evaluate(
      () =>
        window.__verticalObservation.workers.filter((worker) => worker.kind === 'execute').length,
    ),
  ).toBe(2);
  await info.attach('explicit-old-archive-fixture-and-genuine-sort-confirmations', {
    body: JSON.stringify({ fixture, runs, writes, final: await snapshot(page) }),
    contentType: 'application/json',
  });
});
