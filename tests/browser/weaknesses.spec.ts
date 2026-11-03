import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { archive, ready, submit, panel, code, observeCaseSetExecution } from './notebook-helpers';
import {
  openIndependentRepair as openAnswer,
  confirmCurrentLesson as confirm,
} from './current-course-helpers';
import { routeHistoricalApp } from './legacy-app';
import { observedCaseSetExecute } from './case-set-observation';
import type {} from './harness/editor-history';
const folder = `.artifacts/19.1/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const status = (p: Page) => p.getByTestId('weakness-status');
const variable = (p: Page) => p.locator('[data-weakness-id="knowledge.c6.s2.2.2"]');
test.beforeAll(() => mkdir(folder, { recursive: true }));
test('19.1 native DB8 upgrade preserves every original store key and row and adds only the new empty partition', async ({
  page,
}) => {
  await routeHistoricalApp(page, new URL(test.info().project.use.baseURL as string).origin);
  await page.goto('/#/custom-code');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toHaveText('草稿已保存到当前浏览器。');
  await markLegacy(page);
  const name = 'c-viz-learning.test.weakness-migration8';
  const original = await page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    const names = Array.from(db.objectStoreNames).filter((n) => n !== 'weaknesses');
    const tx = db.transaction(names, 'readonly'),
      all: Record<string, { keys: IDBValidKey[]; values: unknown[] }> = {};
    for (const n of names) {
      const store = tx.objectStore(n);
      all[n] = { keys: [], values: [] };
      const keys = store.getAllKeys(),
        values = store.getAll();
      keys.onsuccess = () => {
        all[n].keys = keys.result;
      };
      values.onsuccess = () => {
        all[n].values = values.result;
      };
    }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
    const meta = all.meta.values[0] as Record<string, unknown>;
    meta.schemaVersion = '8.0.0';
    meta.dbVersion = 8;
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(name, 8);
      r.onupgradeneeded = () => {
        for (const n of names) {
          const store = r.result.createObjectStore(n);
          all[n].values.forEach((v, i) => store.put(v, all[n].keys[i]));
        }
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    return all;
  }, name);
  expect(original.customDrafts.values).toHaveLength(1);
  await page.unroute('**/*');
  await page.goto('/checks/');
  await page.waitForFunction(() => Boolean(window.historyHarness));
  await page.evaluate((name) => window.historyHarness.open(name), name);
  const after = await page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
    });
    const names = Array.from(db.objectStoreNames),
      tx = db.transaction(names, 'readonly'),
      all: Record<string, { keys: IDBValidKey[]; values: unknown[] }> = {};
    for (const n of names) {
      const store = tx.objectStore(n);
      all[n] = { keys: [], values: [] };
      const k = store.getAllKeys(),
        v = store.getAll();
      k.onsuccess = () => {
        all[n].keys = k.result;
      };
      v.onsuccess = () => {
        all[n].values = v.result;
      };
    }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    const version = db.version;
    db.close();
    return { version, all };
  }, name);
  expect(after.version).toBe(9);
  expect(Object.keys(after.all)).toHaveLength(17);
  expect(after.all.weaknesses).toEqual({ keys: [], values: [] });
  for (const n of Object.keys(original))
    if (n !== 'meta') expect(after.all[n], n).toEqual(original[n]);
  expect(after.all.meta).toEqual({
    keys: original.meta.keys,
    values: [
      {
        ...(original.meta.values[0] as object),
        schemaVersion: '9.0.0',
        dbVersion: 9,
        revision: (original.meta.values[0] as { revision: number }).revision + 1,
      },
    ],
  });
  await writeFile(`${folder}/db8-upgrade.json`, JSON.stringify({ original, after }, null, 2), {
    flag: 'wx',
  });
});
async function open(p: Page) {
  await p.goto('/#/weaknesses');
  await expect(p.getByRole('heading', { name: '薄弱点与学习依据', exact: true })).toBeVisible();
  await ready(p);
  await expect(status(p)).toHaveAttribute('data-state', 'ready');
}
async function fail(p: Page) {
  await openAnswer(p, 'exercise.c.bug-parenthesis');
  const text = await code(p).inputValue();
  await code(p).fill(text.replace(/printf\([^;]+;/, 'printf("%d\\n", x + 1);'));
  await expect(p.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await panel(p).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(p)).toHaveAttribute('data-state', 'unmet');
  await expect(p.getByTestId('practice-attempt-save')).toHaveAttribute('data-save-state', 'saved');
}
async function mark(p: Page) {
  await p.goto('/#/lessons/lesson.c6.s2.2.2');
  await ready(p);
  await expect(p.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
  await p.locator('[data-knowledge-mark="knowledge.c6.s2.2.2"]').click();
  await expect(p.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
}
async function capture(p: Page, name: string, worker = false) {
  await writeFile(
    `${folder}/${name}.json.gz`,
    gzipSync(
      JSON.stringify({
        rows: await archive(p),
        worker: worker ? await observedCaseSetExecute(p) : null,
      }),
    ),
    { flag: 'wx' },
  );
}
test('19.1 candidate screen preserves honest unavailable-source state and course fallback', async ({
  page,
}) => {
  await page.goto('/#/weaknesses');
  await expect(page.getByRole('heading', { name: '薄弱点与学习依据', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '继续原课程 →', exact: true })).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-state', /^(ready|failed)$/);
  await expect(page.getByText(/暂停、回退/)).toBeVisible();
});
test('19.1 empty data, persisted summary refresh and three responsive widths are honest', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId('weakness-empty')).toContainText('暂无可确认');
  const before = await archive(page);
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-state', 'ready');
  expect(await archive(page)).toEqual(before);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${folder}/empty-${width}.png`, fullPage: true });
  }
  await capture(page, 'empty');
});
test('19.1 two real Rust failures explain recurrence, repair closes and another failure reopens without duplicate rewards', async ({
  page,
}) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  await confirm(page, 'lesson.c6.s5.1');
  await openAnswer(page, 'exercise.c.bug-parenthesis');
  await submit(page);
  await fail(page);
  await open(page);
  await expect(variable(page)).toContainText('近30天未修复失败 1 次');
  await fail(page);
  await open(page);
  await expect(variable(page)).toContainText('最近通过后有2次真实失败');
  await variable(page).getByText('查看最近依据（最多3条）', { exact: true }).click();
  await expect(variable(page)).toContainText('自动证据');
  await expect(variable(page)).toContainText('答案不符');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${folder}/actual-evidence-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture(page, 'two-real-failures', true);
  const before = await archive(page);
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-state', 'ready');
  expect(await archive(page)).toEqual(before);
  await openAnswer(page, 'exercise.c.bug-parenthesis');
  await submit(page);
  await open(page);
  await expect(variable(page)).toHaveCount(0);
  await page.getByRole('checkbox', { name: '显示已修复与历史', exact: true }).check();
  await expect(variable(page)).toContainText('现有证据已修复');
  const repaired = await archive(page);
  await fail(page);
  await open(page);
  await expect(variable(page)).toContainText('近30天未修复失败 1 次');
  expect((await archive(page)).ledger).toEqual(repaired.ledger);
  await capture(page, 'reopened', true);
});
test('19.1 manual evidence stays distinct, cancellation and peer synchronization preserve true facts', async ({
  page,
  context,
}) => {
  await mark(page);
  await open(page);
  await expect(variable(page)).toContainText('手动自评');
  const before = await archive(page);
  const peer = await context.newPage();
  await open(peer);
  await expect(variable(peer)).toContainText('手动自评');
  expect((await archive(peer)).receipts).toEqual(before.receipts);
  expect((await archive(peer)).ledger).toEqual(before.ledger);
  await mark(page);
  await open(peer);
  await expect(variable(peer)).toHaveCount(0);
  await peer.getByRole('checkbox', { name: '显示已修复与历史', exact: true }).check();
  await expect(variable(peer)).toContainText('已修复、已取消或超出');
  await capture(peer, 'manual-cancel');
});
test('19.1 native quota rolls back summary, explicit retry and peer clear cannot resurrect old evidence', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const control = { armed: false };
    Object.assign(window, { __weakQuota: control });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'weaknesses' && control.armed)
        throw new DOMException('19.1 controlled quota', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await mark(page);
  const before = await archive(page);
  await page.evaluate(() => {
    (window as unknown as { __weakQuota: { armed: boolean } }).__weakQuota.armed = true;
  });
  await page.goto('/#/weaknesses');
  await expect(status(page)).toHaveAttribute('data-state', 'failed');
  await expect(status(page)).toContainText('S_QUOTA');
  expect(await archive(page)).toEqual(before);
  await page.evaluate(() => {
    (window as unknown as { __weakQuota: { armed: boolean } }).__weakQuota.armed = false;
  });
  await page.getByRole('button', { name: '重新归纳本地证据', exact: true }).click();
  await expect(status(page)).toHaveAttribute('data-state', 'ready');
  await expect(variable(page)).toContainText('手动自评');
  const peer = await context.newPage();
  await peer.goto('/#/settings?panel=data');
  await ready(peer);
  await peer.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await peer
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(variable(page)).toHaveCount(0);
  await page.reload();
  await open(page);
  expect((await archive(page)).receipts).toEqual([]);
  expect(
    ((await archive(page)) as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks,
  ).toEqual([]);
  await capture(page, 'cleared');
});
test('19.1 corrupt or future summary remains preserved, never looks like no weakness, courses still work', async ({
  page,
}) => {
  await mark(page);
  await open(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction('weaknesses', 'readwrite');
    const r = tx.objectStore('weaknesses').get('current');
    r.onsuccess = () =>
      tx.objectStore('weaknesses').put({ ...r.result, weaknessVersion: '99.0.0' }, 'current');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  const before = await archive(page);
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-state', 'failed');
  await expect(status(page)).toContainText('S_VERSION_UNKNOWN');
  await expect(page.getByTestId('weakness-empty')).toHaveCount(0);
  expect(await archive(page)).toEqual(before);
  await page.getByRole('link', { name: '继续原课程 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '课程目录', exact: true })).toBeVisible();
});
test('19.1 peer clear while the native summary acknowledgement is held rejects the old generation', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const control = { armed: false, wrote: false, held: [] as (() => void)[] };
    Object.assign(window, { __weakAck: control });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'weaknesses' && control.armed) control.wrote = true;
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const tx = transaction.apply(this, args);
      if (
        control.armed &&
        control.wrote &&
        tx.mode === 'readonly' &&
        tx.objectStoreNames.length === 1 &&
        tx.objectStoreNames[0] === 'meta'
      ) {
        control.armed = false;
        Object.defineProperty(tx, 'oncomplete', {
          set(handler: (event: Event) => void) {
            tx.addEventListener('complete', (event) =>
              control.held.push(() => handler.call(tx, event)),
            );
          },
          configurable: true,
        });
      }
      return tx;
    };
  });
  await mark(page);
  await page.evaluate(() => {
    (window as unknown as { __weakAck: { armed: boolean } }).__weakAck.armed = true;
  });
  await page.goto('/#/weaknesses');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __weakAck: { held: unknown[] } }).__weakAck.held.length,
      ),
    )
    .toBe(1);
  const old = await archive(page),
    peer = await context.newPage();
  await peer.goto('/#/settings?panel=data');
  await ready(peer);
  await peer.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await peer
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await page.evaluate(() => {
    for (const release of (
      window as unknown as { __weakAck: { held: (() => void)[] } }
    ).__weakAck.held.splice(0))
      release();
  });
  await expect(status(page)).toHaveAttribute('data-state', 'ready');
  await expect(variable(page)).toHaveCount(0);
  const after = await archive(page);
  expect(after.meta.generation).not.toBe(old.meta.generation);
  expect(after.receipts).toEqual([]);
  expect((after as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks).toEqual([]);
  await capture(page, 'late-ack-clear');
});
test('19.1 two tabs concurrently derive one bounded summary without duplicating the manual source', async ({
  page,
  context,
}) => {
  await mark(page);
  const peer = await context.newPage();
  await Promise.all([open(page), open(peer)]);
  await expect(variable(page)).toContainText('手动自评');
  await expect(variable(peer)).toContainText('手动自评');
  const snapshot = await archive(page);
  const summaries = (
    snapshot as unknown as {
      weaknesses: { rows: { knowledgeRef: { id: string }; evidence: { sourceId: string }[] }[] }[];
    }
  ).weaknesses;
  expect(summaries).toHaveLength(1);
  const row = summaries[0].rows.find((r) => r.knowledgeRef.id === 'knowledge.c6.s2.2.2')!;
  expect(row.evidence).toHaveLength(1);
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-state', 'ready');
  expect((await archive(page)).receipts).toEqual(snapshot.receipts);
  await capture(page, 'concurrent-summary');
});
test('19.1 passive real playback, C workbench diagnostics and read-only advanced examples do not invent weaknesses', async ({
  page,
}) => {
  await page.goto('/#/visualize/case.c.assignment');
  await ready(page);
  await page.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  const before = await archive(page);
  await page
    .getByTestId('player-controls')
    .getByRole('button', { name: '前进', exact: true })
    .click();
  await page
    .getByTestId('player-controls')
    .getByRole('button', { name: '后退', exact: true })
    .click();
  expect((await archive(page)).receipts).toEqual(before.receipts);
  await page.goto('/#/custom-code');
  await page.getByRole('button', { name: '编辑代码', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'C 代码', exact: true })
    .fill('int main(){int x;return x;}');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute(
    'data-status',
    /ready|rejected/,
  );
  expect((await archive(page)).receipts).toEqual(before.receipts);
  await open(page);
  await expect(page.getByTestId('weakness-empty')).toBeVisible();
  await capture(page, 'no-inference');
});
test('19.1 two distinct real challenge mistakes qualify, replay stays one per question, later correct resolves', async ({
  page,
}) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  const answer = async (id: string, correct = false) => {
    await page.goto(`/#/visualize/${id}`);
    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: '运行示例', exact: true }).click();
    await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
    await page.getByRole('button', { name: '预测挑战', exact: true }).click();
    await page
      .getByRole('group', { name: '本次挑战题目', exact: true })
      .getByRole('button')
      .nth(0)
      .click();
    await page
      .locator(`[data-answer-kind="${correct ? 'value.initialize' : 'object.declare'}"]`)
      .click();
    await expect(page.getByTestId('challenge-feedback')).toContainText('本次答案已保存');
  };
  await answer('case.c.assignment');
  await answer('case.c.assignment');
  await open(page);
  await expect(page.locator('[data-weakness-id="knowledge.c6.s3.2"]')).toContainText('有1道挑战题');
  const reward = await archive(page);
  await answer('case.c.branch');
  await open(page);
  await expect(page.locator('[data-weakness-id="knowledge.c6.s3.2"]')).toContainText(
    '达到卡壳规则',
  );
  await capture(page, 'challenge-stall', true);
  await answer('case.c.assignment', true);
  await open(page);
  await expect(page.locator('[data-weakness-id="knowledge.c6.s3.2"]')).not.toContainText(
    '达到卡壳规则',
  );
  await expect(page.locator('[data-weakness-id="knowledge.c6.s3.2"]')).toContainText('有1道挑战题');
  const after = await archive(page);
  expect(after.ledger.filter((l) => l.subjectId === 'challenge.c.assignment.initialize')).toEqual(
    reward.ledger.filter((l) => l.subjectId === 'challenge.c.assignment.initialize'),
  );
  await capture(page, 'challenge-repaired', true);
});

async function markLegacy(p: Page) {
  await p.goto('/#/lessons/lesson.c.variables-output');
  await ready(p);
  await expect(p.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
  await p.locator('[data-knowledge-mark="knowledge.c.variables"]').click();
  await expect(p.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
}
