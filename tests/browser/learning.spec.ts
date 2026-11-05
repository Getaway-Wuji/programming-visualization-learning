import { expectEditorValue } from './editor-value';
import { waitForPhase2Archive } from './phase2-ready';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { StorageSnapshot } from '../../web/src/storage/model';
import type { HarnessResult } from './harness/storage';
import type { LearningProjection } from '../../web/src/learning/types';
import type {} from './harness/learning';

function value<T>(answer: HarnessResult<T>): T {
  expect(answer.ok, answer.ok ? undefined : `${answer.error.code}: ${answer.error.message}`).toBe(
    true,
  );
  if (!answer.ok) throw new Error(answer.error.message);
  return answer.value;
}
function rejected(answer: HarnessResult<unknown>, code?: string) {
  expect(answer.ok).toBe(false);
  if (answer.ok) throw new Error('Expected an unsaved learning result.');
  expect(answer.error.saved).toBe(false);
  if (code) expect(answer.error.code).toBe(code);
}
const ids = {
  lesson: 'lesson.synthetic.basics',
  first: 'exercise.synthetic.first',
  second: 'exercise.synthetic.second',
  case: 'case.synthetic.assignment',
};
async function harness(page: Page, name = isolatedName()) {
  await page.goto('/checks/');
  await expect
    .poll(() => page.evaluate(() => typeof window.learningHarness?.open))
    .toBe('function');
  const state = await page.evaluate((name) => window.learningHarness.open(name), name);
  expect(state.status).toBe('ready');
  expect(state.snapshot).not.toBeNull();
  return { name, state };
}
function lesson(projection: LearningProjection) {
  return projection.lessons.find((item) => item.id === ids.lesson)!;
}

/** Read production-origin data with native IndexedDB, without a second write adapter. */
async function productionSnapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const transaction = db.transaction(names, 'readonly');
      const complete = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const data = Object.fromEntries(
        await Promise.all(
          names.map(async (name) => {
            const singleton = ['meta', 'settings', 'avatar', 'appearance'].includes(name);
            const value = await new Promise<unknown>((resolve, reject) => {
              const request = singleton
                ? transaction.objectStore(name).get('current')
                : transaction.objectStore(name).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return [name, value];
          }),
        ),
      );
      await complete;
      return data as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}

async function readySettings(page: Page, panel = 'display') {
  await page.goto(`/#/settings?panel=${panel}`);
  await expect(page.locator('.app-shell')).not.toHaveAttribute(
    'data-learning-storage-status',
    'loading',
  );
}
async function saved(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}

test('production display settings and the retained avatar survive refresh and closing/reopening the page', async ({
  page,
  context,
}, testInfo) => {
  await readySettings(page);
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark');
  await page.getByRole('combobox', { name: '动画效果', exact: true }).selectOption('on');
  await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('1.5');
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await saved(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'minimal');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'on');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await expect(page.getByRole('tab', { name: '基础形象', exact: true })).toHaveCount(0);
  const persisted = await productionSnapshot(page);
  expect(persisted.settings).toMatchObject({
    theme: 'dark',
    reducedMotion: 'on',
    playbackRate: 1.5,
  });
  expect(persisted.avatar).toEqual({ presetId: 'avatar.basic.01', accentColor: '#168A72' });
  expect(persisted.progress).toEqual([]);
  expect(persisted.receipts).toEqual([]);
  expect(persisted.ledger).toEqual([]);

  await page.reload();
  await expectEditorValue(page.getByRole('combobox', { name: '主题', exact: true }), 'dark');
  expect(await productionSnapshot(page)).toEqual(persisted);
  await page.close();
  const reopened = await context.newPage();
  await readySettings(reopened);
  await expectEditorValue(reopened.getByRole('combobox', { name: '主题', exact: true }), 'dark');
  await expectEditorValue(reopened.getByRole('combobox', { name: '动画效果', exact: true }), 'on');
  await expectEditorValue(
    reopened.getByRole('combobox', { name: '默认播放速度', exact: true }),
    '1.5',
  );
  expect(await productionSnapshot(reopened)).toEqual(persisted);
  await reopened.getByRole('link', { name: '学习首页', exact: true }).first().click();
  await reopened.getByRole('button', { name: '积分 0，查看明细', exact: true }).click();
  await expect(
    reopened.getByRole('button', { name: '积分 0，查看明细', exact: true }),
  ).toBeVisible();
  await expect(
    reopened.getByRole('dialog').getByRole('heading', { name: '暂无积分记录', exact: true }),
  ).toBeVisible();
  const reopenedArchive = await productionSnapshot(reopened);
  expect(reopenedArchive.ledger.filter((row) => row.status === 'posted')).toEqual([]);
  expect(reopenedArchive.ledger.filter((row) => row.status === 'pending')).toEqual([]);
  await testInfo.attach('production-native-idb-settings-reopen', {
    body: JSON.stringify({
      evidenceKind: 'real production settings; no learning execution claimed',
      persisted,
    }),
    contentType: 'application/json',
  });
});

test('production save failure shows unsaved and preserves the prior settings, then a normal retry saves the draft', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    let fail = false;
    (window as unknown as { failNextSettingSave: () => void }).failNextSettingSave = () => {
      fail = true;
    };
    IDBObjectStore.prototype.put = function (value, key) {
      if (fail && this.name === 'settings') {
        fail = false;
        throw new DOMException('Isolated settings write fault', 'QuotaExceededError');
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await readySettings(page);
  await expect
    .poll(async () => (await productionSnapshot(page)).settings.goalTemplate)
    .not.toBeNull();
  const before = await productionSnapshot(page);
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark');
  await page.evaluate(() =>
    (window as unknown as { failNextSettingSave: () => void }).failNextSettingSave(),
  );
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'unsaved',
  );
  await expect(page.getByTestId('learning-save-status')).toContainText('未保存');
  expect(await productionSnapshot(page)).toEqual(before);
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await saved(page);
  expect((await productionSnapshot(page)).settings.theme).toBe('dark');
  await testInfo.attach('production-fault-evidence-scope', {
    body: 'QuotaExceededError was injected at the native settings put call. This verifies UI acknowledgment and rollback, not actual disk exhaustion or private browsing restrictions.',
    contentType: 'text/plain',
  });
});

test('an older queued save preserves a newer draft created while a completed native read awaits acknowledgment', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const property = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!;
    let hold = false;
    let release: (() => void) | undefined;
    Object.assign(window, {
      holdNextReadonlyAcknowledgment: () => {
        hold = true;
      },
      hasHeldReadonlyAcknowledgment: () => !!release,
      releaseReadonlyAcknowledgment: () => {
        const callback = release;
        release = undefined;
        callback?.();
      },
    });
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...property,
      set(this: IDBTransaction, handler: IDBTransaction['oncomplete']) {
        property.set!.call(
          this,
          handler
            ? (event: Event) => {
                // The native transaction already completed. Only delivery to the
                // application's promise is held to reproduce a focus/read overlap.
                if (hold && this.mode === 'readonly') {
                  hold = false;
                  release = () => handler.call(this, event);
                } else handler.call(this, event);
              }
            : handler,
        );
      },
    });
  });
  await readySettings(page);
  const theme = page.getByRole('combobox', { name: '主题', exact: true });
  await theme.selectOption('dark');
  await page.evaluate(() => {
    (
      window as unknown as { holdNextReadonlyAcknowledgment(): void }
    ).holdNextReadonlyAcknowledgment();
    window.dispatchEvent(new Event('focus'));
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { hasHeldReadonlyAcknowledgment(): boolean }
        ).hasHeldReadonlyAcknowledgment(),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await theme.selectOption('light');
  await page.evaluate(() =>
    (
      window as unknown as { releaseReadonlyAcknowledgment(): void }
    ).releaseReadonlyAcknowledgment(),
  );
  await expect.poll(async () => (await productionSnapshot(page)).settings.theme).toBe('dark');
  await expect(page.getByText('这次显示设置更改尚未保存。', { exact: true })).toBeVisible();
  await expectEditorValue(theme, 'light');
});

test('passive course reading, finite practice options and case previews leave all local learning data unchanged', async ({
  page,
}) => {
  await readySettings(page);
  await waitForPhase2Archive(page);
  const before = await productionSnapshot(page);
  await page.goto('/#/lessons/lesson.c6.s2.1');
  await expect(page.locator('.c6-teaching-reading')).toBeVisible();
  await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read', 'false');
  await page.goto('/#/practice/exercise.c6.s2.1');
  await expect(page.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
  await expectEditorValue(page.getByLabel('完整 C 源码 · main.c', { exact: true }), '', {
    not: true,
  });
  await page.goto('/#/visualize/case.c.bubble-sort');
  await expect(page.getByTestId('content-sample')).toHaveAttribute(
    'data-content-scope',
    'case-view',
  );
  await expect(page.getByRole('button', { name: '确认已观看', exact: true })).toBeDisabled();
  const after = await productionSnapshot(page);
  expect(after).toEqual(before);
});

test('an outdated production settings draft reports a revision conflict and cannot overwrite a newer native commit', async ({
  page,
}) => {
  await readySettings(page);
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('system');
  // Simulate a valid competing settings transaction with no invalidation hint.
  // Recovery/clearing and complete multi-tab learning races belong to 04.3.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction(['meta', 'settings'], 'readwrite');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const meta = transaction.objectStore('meta').get('current');
      meta.onsuccess = () => {
        const current = meta.result as StorageSnapshot['meta'];
        transaction
          .objectStore('meta')
          .put({ ...current, revision: current.revision + 1 }, 'current');
      };
      const settings = transaction.objectStore('settings').get('current');
      settings.onsuccess = () => {
        const current = settings.result as StorageSnapshot['settings'];
        transaction.objectStore('settings').put({ ...current, theme: 'dark' }, 'current');
      };
      await done;
    } finally {
      db.close();
    }
  });
  const newer = await productionSnapshot(page);
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'conflict',
  );
  await expect(page.getByTestId('learning-save-status')).toContainText('冲突');
  expect(await productionSnapshot(page)).toEqual(newer);
  await page.reload();
  await expectEditorValue(page.getByRole('combobox', { name: '主题', exact: true }), 'dark');
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('light');
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await saved(page);
  expect((await productionSnapshot(page)).settings.theme).toBe('light');
});

// The following cases are isolated synthetic authority checks through the same
// learning service and native IDB. They do not establish real Rust adjudication.
const isolatedName = () => `c-viz-learning.test.${randomUUID()}`;

test.afterEach(async ({ context }) => {
  for (const page of context.pages()) {
    if (!page.isClosed()) await page.evaluate(() => window.learningHarness?.dispose());
  }
});

test('the service requires private trusted facts and rejects forged flags, unknown subjects, plain commands and fixture learning', async ({
  page,
}) => {
  await harness(page);
  const before = await page.evaluate(() => window.learningHarness.nativeRows());
  rejected(
    await page.evaluate(() =>
      window.learningHarness.captureUnknown({ validated: true, passed: true }),
    ),
  );
  rejected(
    await page.evaluate(() =>
      window.learningHarness.issueUnknown({
        eventContractVersion: '1.0.0',
        eventType: 'exercise.passed',
        result: 'passed',
        subjectRef: { id: 'exercise.synthetic.first', version: '1.0.0' },
        packageRef: { id: 'content.synthetic.learning', version: '1.0.0' },
        learningRevision: 1,
        validated: true,
      }),
    ),
  );
  rejected(
    await page.evaluate(() =>
      window.learningHarness.capture('exercise.passed', 'exercise.synthetic.unknown'),
    ),
  );
  rejected(
    await page.evaluate(() =>
      window.learningHarness.issueUnknown({
        eventContractVersion: '1.0.0',
        eventType: 'lesson.completed',
        result: 'completed',
        subjectRef: { id: 'lesson.synthetic.basics', version: '1.0.0' },
        packageRef: { id: 'content.synthetic.learning', version: '1.0.0' },
        learningRevision: 1,
      }),
    ),
  );
  expect(await page.evaluate(() => window.learningHarness.nativeRows())).toEqual(before);
  const command = value(
    await page.evaluate(
      (id) => window.learningHarness.capture('exercise.passed', 'exercise.synthetic.first', id),
      randomUUID(),
    ),
  );
  rejected(await page.evaluate((command) => window.learningHarness.commitPlain(command), command));
  const capturedRows = await page.evaluate(() => window.learningHarness.nativeRows());
  await page.evaluate(() => window.learningHarness.setCurrent(false));
  rejected(await page.evaluate((id) => window.learningHarness.commit(id), command.receipt.eventId));
  expect(await page.evaluate(() => window.learningHarness.nativeRows())).toEqual(capturedRows);
  const fixtureName = isolatedName();
  const fixture = await page.evaluate(
    (name) => window.learningHarness.open(name, 'fixture'),
    fixtureName,
  );
  expect(fixture.capabilities.learning).toBe(false);
  rejected(
    await page.evaluate(() =>
      window.learningHarness.capture('exercise.passed', 'exercise.synthetic.first'),
    ),
  );
  const fixtureRows = await page.evaluate(() => window.learningHarness.nativeRows());
  expect(fixtureRows.progress).toEqual([]);
  expect(fixtureRows.receipts).toEqual([]);
  expect(fixtureRows.ledger).toEqual([]);
});

test('one authoritative native snapshot projects lesson predicates, failed attempts, pending rights and deduplicated daily counts', async ({
  page,
}, testInfo) => {
  await harness(page);
  const goal = await page.evaluate(() =>
    window.learningHarness.saveGoal({ exercise: 2, lesson: 1, case: 1 }),
  );
  expect(goal.lastSaved).toBe(true);
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('lesson.started', 'lesson.synthetic.basics'),
    ),
  );
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('lesson.study-confirmed', 'lesson.synthetic.basics'),
    ),
  );
  let state = await page.evaluate(() => window.learningHarness.state());
  expect(lesson(state.projection!)).toMatchObject({
    started: true,
    studyConfirmed: true,
    completed: false,
  });
  expect(state.projection!.ledger.pending).toEqual([]);
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('exercise.passed', 'exercise.synthetic.first'),
    ),
  );
  value(
    await page.evaluate(() =>
      window.learningHarness.learn(
        'exercise.attempt-evaluated',
        'exercise.synthetic.first',
        undefined,
        '2026-10-15T02:01:00.000Z',
        { resultCategory: 'wrong-answer', failedCaseKey: 'boundary' },
      ),
    ),
  );
  state = await page.evaluate(() => window.learningHarness.state());
  expect(state.projection!.exercises[0]).toMatchObject({
    passed: true,
    latestAttempt: { resultCategory: 'wrong-answer', failedCaseKey: 'boundary' },
  });
  expect(lesson(state.projection!).completed).toBe(false);
  value(
    await page.evaluate(() =>
      window.learningHarness.learn(
        'exercise.passed',
        'exercise.synthetic.second',
        undefined,
        '2026-10-15T02:02:00.000Z',
      ),
    ),
  );
  state = await page.evaluate(() => window.learningHarness.state());
  expect(lesson(state.projection!).completed).toBe(true);
  expect(state.projection!.ledger.pending).toHaveLength(3);
  expect(state.projection!.goals[0]).toMatchObject({
    counts: { exercise: 2, lesson: 1, case: 0 },
    achievedAt: null,
  });
  value(
    await page.evaluate(() =>
      window.learningHarness.learn(
        'case.view-confirmed',
        'case.synthetic.assignment',
        undefined,
        '2026-10-15T02:03:00.000Z',
      ),
    ),
  );
  value(
    await page.evaluate(() =>
      window.learningHarness.learn(
        'exercise.passed',
        'exercise.synthetic.first',
        undefined,
        '2026-10-15T02:04:00.000Z',
      ),
    ),
  );
  value(
    await page.evaluate(() =>
      window.learningHarness.learn(
        'case.view-confirmed',
        'case.synthetic.assignment',
        undefined,
        '2026-10-15T02:05:00.000Z',
      ),
    ),
  );
  state = await page.evaluate(() => window.learningHarness.state());
  expect(state.snapshot!.receipts).toHaveLength(8);
  expect(state.snapshot!.dailyFacts).toHaveLength(4);
  expect(state.projection!.ledger.totalPoints).toBe('0');
  expect(state.projection!.ledger.pending).toHaveLength(5);
  expect(state.projection!.goals[0]).toMatchObject({
    counts: { exercise: 2, lesson: 1, case: 1 },
    remaining: { exercise: 0, lesson: 0, case: 0 },
    achievedAt: '2026-10-15T02:03:00.000Z',
  });
  for (const entry of state.snapshot!.ledger)
    expect(entry).toMatchObject({ status: 'pending', points: null, policyRef: null });
  const rows = await page.evaluate(() => window.learningHarness.nativeRows());
  expect(
    rows.progress!.every(
      (row) => Array.isArray(row.key) && row.key[0] === state.snapshot!.meta.generation,
    ),
  ).toBe(true);
  expect(
    rows.ledger!.some(
      (row) =>
        JSON.stringify(row.key) ===
        JSON.stringify([state.snapshot!.meta.generation, 'reward.daily-goal.once', '2026-10-15']),
    ),
  ).toBe(true);
  const before = await page.evaluate(() => window.learningHarness.nativeRows());
  await page.evaluate(() => window.learningHarness.refresh());
  expect(await page.evaluate(() => window.learningHarness.nativeRows())).toEqual(before);
  await testInfo.attach('synthetic-learning-native-idb-projection', {
    body: JSON.stringify({
      evidenceKind:
        'synthetic trusted facts through unified service and native IDB; no Rust adjudication claimed',
      state,
      rows,
    }),
    contentType: 'application/json',
  });
});

test('captured commands keep the complete original receipt and day across midnight retries, and event ID reuse cannot change the result', async ({
  page,
}) => {
  await harness(page);
  const eventId = randomUUID();
  const captured = value(
    await page.evaluate(
      (id) =>
        window.learningHarness.capture(
          'exercise.passed',
          'exercise.synthetic.first',
          id,
          '2026-10-15T15:59:00.000Z',
        ),
      eventId,
    ),
  );
  expect(captured.receipt).toMatchObject({
    eventId,
    occurredAt: '2026-10-15T15:59:00.000Z',
    localDate: '2026-10-15',
    goalVersion: 1,
  });
  const first = value(await page.evaluate((id) => window.learningHarness.commit(id), eventId));
  const before = await page.evaluate(() => window.learningHarness.nativeRows());
  await page.evaluate(() => window.learningHarness.setClock('2026-10-15T16:01:00.000Z'));
  const replay = value(await page.evaluate((id) => window.learningHarness.commit(id), eventId));
  expect(replay).toEqual({ ...first, replayed: true });
  expect(await page.evaluate(() => window.learningHarness.nativeRows())).toEqual(before);
  value(
    await page.evaluate(
      (id) =>
        window.learningHarness.capture(
          'exercise.passed',
          'exercise.synthetic.first',
          id,
          '2026-10-15T15:59:30.000Z',
        ),
      eventId,
    ),
  );
  rejected(
    await page.evaluate((id) => window.learningHarness.commit(id), eventId),
    'S_EVENT_ID_REUSED',
  );
  expect(await page.evaluate(() => window.learningHarness.nativeRows())).toEqual(before);
  value(
    await page.evaluate(() =>
      window.learningHarness.learn(
        'exercise.passed',
        'exercise.synthetic.first',
        undefined,
        '2026-10-15T16:02:00.000Z',
      ),
    ),
  );
  const state = await page.evaluate(() => window.learningHarness.state());
  expect(state.snapshot!.goals.map((item) => item.localDate)).toEqual(['2026-10-15', '2026-10-16']);
  expect(state.snapshot!.dailyFacts.map((item) => item.localDate)).toEqual([
    '2026-10-15',
    '2026-10-16',
  ]);
  expect(state.snapshot!.ledger).toHaveLength(1);
});

test('goal template CAS retains the opened day and applies a changed target only to an unopened future day', async ({
  page,
}) => {
  await harness(page);
  const first = await page.evaluate(() =>
    window.learningHarness.saveGoal({ exercise: 2, lesson: 0, case: 0 }),
  );
  expect(first.lastSaved).toBe(true);
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('exercise.passed', 'exercise.synthetic.first'),
    ),
  );
  const frozen = await page.evaluate(() => window.learningHarness.state());
  expect(frozen.snapshot!.goals[0]).toMatchObject({
    goalVersion: 1,
    targets: { exercise: 2, lesson: 0, case: 0 },
    achievedAt: null,
  });
  const changed = await page.evaluate(() =>
    window.learningHarness.saveGoal({ exercise: 1, lesson: 0, case: 0 }),
  );
  expect(changed.snapshot!.settings.goalTemplate).toEqual({
    revision: 2,
    targets: { exercise: 1, lesson: 0, case: 0 },
  });
  expect(changed.snapshot!.goals).toEqual(frozen.snapshot!.goals);
  const conflict = await page.evaluate(
    (revision) => window.learningHarness.saveGoal({ exercise: 0, lesson: 0, case: 1 }, revision),
    frozen.snapshot!.meta.revision,
  );
  expect(conflict.status).toBe('conflict');
  expect(conflict.lastSaved).toBe(false);
  expect(conflict.errorCode).toBe('S_REVISION_CONFLICT');
  const durable = await page.evaluate(() => window.learningHarness.refresh());
  expect(durable.snapshot!.settings.goalTemplate).toEqual(changed.snapshot!.settings.goalTemplate);
  value(
    await page.evaluate(() =>
      window.learningHarness.learn(
        'exercise.passed',
        'exercise.synthetic.first',
        undefined,
        '2026-10-16T02:00:00.000Z',
      ),
    ),
  );
  const tomorrow = await page.evaluate(() => window.learningHarness.state());
  expect(tomorrow.snapshot!.goals[0]).toEqual(frozen.snapshot!.goals[0]);
  expect(tomorrow.snapshot!.goals[1]).toMatchObject({
    goalVersion: 2,
    targets: { exercise: 1, lesson: 0, case: 0 },
    achievedAt: '2026-10-16T02:00:00.000Z',
  });
  expect(
    tomorrow.snapshot!.ledger.filter((item) => item.sourceId === 'reward.exercise.first-pass'),
  ).toHaveLength(1);
  expect(
    tomorrow.snapshot!.ledger.filter((item) => item.sourceId === 'reward.daily-goal.once'),
  ).toHaveLength(1);
});

test('stable IDs preserve compatible history while changed learning revisions retain history without current completion, and reopening only reads', async ({
  page,
  context,
}) => {
  const { name } = await harness(page);
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('lesson.study-confirmed', 'lesson.synthetic.basics'),
    ),
  );
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('exercise.passed', 'exercise.synthetic.first'),
    ),
  );
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('exercise.passed', 'exercise.synthetic.second'),
    ),
  );
  const original = await page.evaluate(() => window.learningHarness.state());
  expect(lesson(original.projection!).completed).toBe(true);
  const rows = await page.evaluate(() => window.learningHarness.nativeRows());
  const compatible = await page.evaluate(
    (name) => window.learningHarness.open(name, 'compatible'),
    name,
  );
  expect(lesson(compatible.projection!).completed).toBe(true);
  expect(compatible.projection!.exercises.every((item) => item.passed)).toBe(true);
  expect(await page.evaluate(() => window.learningHarness.nativeRows())).toEqual(rows);
  const revised = await page.evaluate((name) => window.learningHarness.open(name, 'revised'), name);
  expect(lesson(revised.projection!)).toMatchObject({ studyConfirmed: false, completed: false });
  expect(revised.projection!.exercises.every((item) => !item.passed)).toBe(true);
  expect(revised.projection!.history).toEqual(original.projection!.history);
  expect(await page.evaluate(() => window.learningHarness.nativeRows())).toEqual(rows);
  await page.close();
  const reopened = await context.newPage();
  await harness(reopened, name);
  const restored = await reopened.evaluate(() => window.learningHarness.state());
  expect(restored.snapshot).toEqual(original.snapshot);
  expect(restored.projection).toEqual(original.projection);
  expect(await reopened.evaluate(() => window.learningHarness.nativeRows())).toEqual(rows);
});

test('posted points aggregate beyond safe-number range as exact decimal text, with pending rights excluded', async ({
  page,
}, testInfo) => {
  const { name } = await harness(page);
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('lesson.study-confirmed', 'lesson.synthetic.basics'),
    ),
  );
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('exercise.passed', 'exercise.synthetic.first'),
    ),
  );
  value(
    await page.evaluate(() =>
      window.learningHarness.learn('exercise.passed', 'exercise.synthetic.second'),
    ),
  );
  const seeded = await page.evaluate(() => window.learningHarness.seedPostedMaxima());
  expect(seeded.projection!.ledger.totalPoints).toBe('18014398509481982');
  expect(seeded.projection!.ledger.pending).toHaveLength(1);
  const native = await page.evaluate(() => window.learningHarness.nativeRows());
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => typeof window.learningHarness?.open))
    .toBe('function');
  const reopened = await page.evaluate((name) => window.learningHarness.open(name), name);
  expect(reopened.projection!.ledger.totalPoints).toBe('18014398509481982');
  expect(await page.evaluate(() => window.learningHarness.nativeRows())).toEqual(native);
  await testInfo.attach('synthetic-historical-posted-points-scope', {
    body: 'Two historical synthetic posted rows, each Number.MAX_SAFE_INTEGER, are seeded in the isolated native test DB after the unified service creates their rights. This tests exact read aggregation; no official 11.1 policy or reward settlement is claimed.',
    contentType: 'text/plain',
  });
});
