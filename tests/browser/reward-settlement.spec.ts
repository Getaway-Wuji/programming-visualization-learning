import { observedC6Execution } from './c6-execution-observation';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { completeCurrentFirstGroup } from './current-course-helpers';
import { installC6Packets } from './c6-observation';
import { decodeC6Response, type C6JudgeRequest } from '../../web/src/engine/c6-protocol';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';

const status = (page: Page) => page.getByTestId('learning-save-status');
const posted = (page: Page, points: number) =>
  page.getByRole('button', { name: `积分 ${points}，查看明细`, exact: true });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(installC6Packets);
});
async function read(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const values = await Promise.all(
        names.map(async (name) => {
          const value = await new Promise<unknown>((resolve, reject) => {
            const request = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
              ? tx.objectStore(name).get('current')
              : tx.objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return [name, value];
        }),
      );
      await done;
      return Object.fromEntries(values) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}
async function genuineRights(page: Page) {
  const exercise = await completeCurrentFirstGroup(page);
  const captured = await observedC6Execution(page, 'judge');
  const requestBytes = Buffer.from(captured.request!, 'base64'),
    resultBytes = Buffer.from(captured.response!, 'base64');
  const request = JSON.parse(requestBytes.toString('utf8')) as C6JudgeRequest;
  expect(request.source).toBe(exercise.referenceSource);
  expect(request.profileRef).toEqual(exercise.profileRef);
  const result = await decodeC6Response(
    Uint8Array.from(resultBytes).buffer,
    request,
    engineBuild.wasmSha256,
  );
  if (!('cases' in result)) throw new Error('Actual current four-case judge required');
  expect(result.status).toBe('passed');
  expect(result.cases).toHaveLength(4);
  for (const [i, c] of result.cases.entries()) {
    expect(c.stdoutMatches && c.returnMatches && c.observationMatches).toBe(true);
    const output =
      c.packet.trace!.initialState.output +
      c.packet
        .trace!.steps.flatMap((s) =>
          s.changes.flatMap((c) => (c.op === 'output' ? [c.append] : [])),
        )
        .join('');
    expect(output).toBe(exercise.tests[i].expectedStdout);
  }
  await test
    .info()
    .attach('genuine-four-case-request', { body: requestBytes, contentType: 'application/json' });
  await test
    .info()
    .attach('genuine-four-case-result', { body: resultBytes, contentType: 'application/json' });
  const saved = await read(page);
  expect(saved.ledger).toHaveLength(3);
  expect(saved.ledger.every((entry) => entry.status === 'posted')).toBe(true);
  for (const entry of saved.ledger) {
    expect(entry.points).toBe(
      entry.sourceId === 'reward.exercise.first-pass'
        ? 10
        : entry.sourceId === 'reward.lesson.first-completion'
          ? 20
          : entry.sourceId === 'reward.daily-goal.once'
            ? 5
            : Number.NaN,
    );
    expect(entry.policyRef).toEqual({
      id:
        entry.sourceId === 'reward.daily-goal.once'
          ? 'reward.policy.daily-goal.p0'
          : 'reward.policy.p0',
      version: '1.0.0',
    });
  }
  expect(saved.ledger.reduce((sum, entry) => sum + (entry.points ?? 0), 0)).toBe(35);
  return saved;
}
/** Explicit compatibility simulation: downgrade only three already genuine rights to
 * pending representation. This is not evidence of a prior-version application process. */
async function priorShape(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['meta', 'ledger'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        const meta = tx.objectStore('meta').get('current');
        meta.onsuccess = () => {
          tx.objectStore('meta').put(
            { ...meta.result, revision: meta.result.revision + 1 },
            'current',
          );
          const cursor = tx.objectStore('ledger').openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            row.update({ ...row.value, status: 'pending', points: null, policyRef: null });
            row.continue();
          };
        };
      });
    } finally {
      db.close();
    }
  });
  return read(page);
}
function unchangedFacts(before: StorageSnapshot, after: StorageSnapshot) {
  for (const store of ['progress', 'receipts', 'dailyFacts', 'goals'] as const)
    expect(after[store]).toEqual(before[store]);
  expect(
    after.ledger.map(({ sourceId, subjectId, occurredAt, localDate }) => ({
      sourceId,
      subjectId,
      occurredAt,
      localDate,
    })),
  ).toEqual(
    before.ledger.map(({ sourceId, subjectId, occurredAt, localDate }) => ({
      sourceId,
      subjectId,
      occurredAt,
      localDate,
    })),
  );
}
async function evidence(info: TestInfo, value: unknown) {
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '11.2',
    'regression',
    'reward-settlement',
    process.env.TASK_EVIDENCE_LABEL ?? 'current',
    info.project.name,
    info.title.slice(0, 32),
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'synthetic-prior-shape-native-settlement.json'),
    JSON.stringify(
      {
        scope:
          'Genuine rights; explicitly simulated prior pending representation; native production settlement',
        value,
      },
      null,
      2,
    ),
  );
}

test('two pages settle simulated prior pending rights only once without new learning facts', async ({
  page,
  context,
}, info) => {
  const genuine = await genuineRights(page);
  const pending = await priorShape(page);
  const other = await context.newPage();
  await Promise.all([page.reload(), other.goto('/#/?panel=points')]);
  for (const target of [page, other])
    await expect(target.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
  await expect(posted(other, 35)).toBeVisible();
  const settled = await read(other);
  expect(settled.ledger).toEqual(genuine.ledger);
  expect(settled.meta.revision).toBe(pending.meta.revision + 1);
  unchangedFacts(pending, settled);
  await other.reload();
  await expect(other.locator('.app-shell')).toHaveAttribute(
    'data-learning-storage-status',
    'ready',
  );
  expect(await read(other)).toEqual(settled);
  await evidence(info, { genuine, pending, settled });
});

test('a second native settlement put aborts all posting and explicit retry preserves old dates', async ({
  page,
}, info) => {
  const genuine = await genuineRights(page);
  const pending = await priorShape(page);
  await page.addInitScript(() => {
    const native = IDBObjectStore.prototype.put;
    let count = 0;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'ledger' && ++count === 2)
        throw new DOMException('Isolated settlement quota failure', 'QuotaExceededError');
      return key === undefined ? native.call(this, value) : native.call(this, value, key);
    };
  });
  await page.goto('/#/?panel=points');
  await page.reload();
  await expect(page.getByRole('button', { name: '重试奖励入账', exact: true })).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-save-status', 'unsaved');
  const aborted = await read(page);
  expect(aborted).toEqual(pending);
  await expect(posted(page, 0)).toBeVisible();
  await page.getByRole('button', { name: '重试奖励入账', exact: true }).click();
  await expect(posted(page, 35)).toBeVisible();
  const settled = await read(page);
  expect(settled.ledger).toEqual(genuine.ledger);
  expect(settled.meta.revision).toBe(pending.meta.revision + 1);
  unchangedFacts(pending, settled);
  await evidence(info, { genuine, pending, aborted, settled });
});
