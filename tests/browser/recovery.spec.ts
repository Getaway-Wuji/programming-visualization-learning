import { expectEditorValue } from './editor-value';
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { HarnessResult } from './harness/storage';
import type { LearningServiceState } from '../../web/src/learning/service';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { defaultAppearance } from '../../web/src/storage/model';
import { c6LearningRelease } from '../../web/src/c6-learning/release.generated';
import type {} from './harness/recovery';

const first = 'exercise.synthetic.first';
const second = 'exercise.synthetic.second';
const caseId = 'case.synthetic.assignment';
const newName = () => `c-viz-learning.test.recovery.${randomUUID()}`;
function value<T>(answer: HarnessResult<T>): T {
  expect(answer.ok, answer.ok ? undefined : `${answer.error.code}: ${answer.error.message}`).toBe(
    true,
  );
  if (!answer.ok) throw new Error(answer.error.message);
  return answer.value;
}
function unsaved(answer: HarnessResult<unknown>, code?: string) {
  expect(answer.ok).toBe(false);
  if (answer.ok) throw new Error('Expected an unsaved recovery result.');
  expect(answer.error.saved).toBe(false);
  if (code) expect(answer.error.code).toBe(code);
}
function initial(snapshot: StorageSnapshot, production = false) {
  expect(snapshot.meta).toMatchObject({
    schemaVersion: production ? '12.0.0' : '9.0.0',
    dbVersion: production ? 12 : 9,
    revision: production ? 1 : 0,
  });
  if (production) expect(snapshot.meta.activePackageRef).toEqual(c6LearningRelease.packageRef);
  expect(snapshot.settings).toEqual({
    theme: 'light',
    reducedMotion: 'system',
    playbackRate: 1,
    goalTemplate: production ? { revision: 1, targets: { exercise: 1, lesson: 1, case: 0 } } : null,
  });
  expect(snapshot.avatar).toEqual({ presetId: 'avatar.basic.01', accentColor: '#168A72' });
  expect(snapshot.appearance).toEqual(defaultAppearance());
  expect(snapshot.appearanceAssets).toEqual([]);
  for (const store of ['progress', 'dailyFacts', 'goals', 'ledger', 'receipts', 'aliases'] as const)
    expect(snapshot[store]).toEqual([]);
}
async function opened(page: Page, name = newName(), notifications = true) {
  await page.goto('/checks/');
  await expect
    .poll(() => page.evaluate(() => typeof window.recoveryHarness?.open))
    .toBe('function');
  await page.evaluate((enabled) => window.recoveryHarness.notifications(enabled), notifications);
  const state = await page.evaluate((name) => window.recoveryHarness.open(name), name);
  expect(state.status).toBe('ready');
  expect(state.snapshot).not.toBeNull();
  return { name, state };
}
async function anotherPage(context: BrowserContext, name: string, notifications = true) {
  const page = await context.newPage();
  await opened(page, name, notifications);
  return page;
}
test.afterEach(async ({ context }) => {
  // Close every real peer connection before deleting only our random test DBs.
  for (const page of context.pages())
    if (!page.isClosed()) await page.evaluate(() => window.recoveryHarness?.close());
  for (const page of context.pages())
    if (!page.isClosed()) await page.evaluate(() => window.recoveryHarness?.dispose());
});

test('invalid display/avatar rows stay in native IDB while valid learning remains visible; confirmed local reset preserves every unrelated row', async ({
  page,
}) => {
  for (const store of ['settings', 'avatar'] as const) {
    await opened(page);
    const learned = await page.evaluate(() => window.recoveryHarness.seedStudy());
    await page.evaluate((store) => window.recoveryHarness.corrupt(store), store);
    const damaged = await page.evaluate(() => window.recoveryHarness.rawDump());
    const recovered = await page.evaluate(() => window.recoveryHarness.refresh());
    expect(recovered.recovery!.issues.some((issue) => issue.store === store)).toBe(true);
    expect(recovered.recovery!.resettable).toContain(store);
    expect(recovered.projection!.lessons[0]!.completed).toBe(true);
    expect(recovered.snapshot!.meta.generation).toBe(learned.snapshot!.meta.generation);
    if (store === 'settings') expect(recovered.snapshot!.settings.theme).toBe('light');
    else expect(recovered.snapshot!.avatar.accentColor).toBe('#168A72');
    expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(damaged);
    const reset = await page.evaluate((store) => window.recoveryHarness.reset(store), store);
    expect(reset.lastSaved).toBe(true);
    expect(reset.snapshot!.meta.generation).toBe(learned.snapshot!.meta.generation);
    const after = await page.evaluate(() => window.recoveryHarness.rawDump());
    for (const [name, rows] of Object.entries(damaged.rows))
      if (name !== 'meta' && name !== store) expect(after.rows[name]).toEqual(rows);
    expect(reset.projection!.lessons[0]!.completed).toBe(true);
  }
});

test('invalid progress and receipts are isolated without erasure and pause learning writes', async ({
  page,
}) => {
  for (const store of ['progress', 'receipts'] as const) {
    await opened(page);
    await page.evaluate(() => window.recoveryHarness.seedStudy());
    await page.evaluate((store) => window.recoveryHarness.corrupt(store), store);
    const before = await page.evaluate(() => window.recoveryHarness.rawDump());
    const recovered = await page.evaluate(() => window.recoveryHarness.refresh());
    expect(recovered.recovery!.issues.some((issue) => issue.store === store)).toBe(true);
    expect(recovered.recovery!.writable).toBe(false);
    expect(recovered.lastSaved).toBe(false);
    unsaved(
      await page.evaluate(() =>
        window.recoveryHarness.learn('exercise.passed', 'exercise.synthetic.first'),
      ),
    );
    expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
  }
});

test('an invalid ledger marks total points uncertain and cannot be converted into an empty or repaired reward history', async ({
  page,
}) => {
  await opened(page);
  await page.evaluate(() => window.recoveryHarness.seedStudy());
  await page.evaluate(() => window.recoveryHarness.corrupt('ledger'));
  const before = await page.evaluate(() => window.recoveryHarness.rawDump());
  const state = await page.evaluate(() => window.recoveryHarness.refresh());
  expect(state.recovery!.ledgerUncertain).toBe(true);
  expect(state.recovery!.writable).toBe(false);
  unsaved(
    await page.evaluate(() =>
      window.recoveryHarness.learn('exercise.passed', 'exercise.synthetic.first'),
    ),
  );
  expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
});

test('known eleven-store archives with invalid or missing meta can be explicitly cleared into a fresh generation', async ({
  page,
}) => {
  for (const kind of ['invalid', 'missing'] as const) {
    await opened(page);
    const old = await page.evaluate(() => window.recoveryHarness.seedStudy());
    await page.evaluate((kind) => window.recoveryHarness.corrupt('meta', kind), kind);
    const before = await page.evaluate(() => window.recoveryHarness.rawDump());
    const state = await page.evaluate(() => window.recoveryHarness.refresh());
    expect(state.snapshot).toBeNull();
    expect(state.recovery!.canClear).toBe(true);
    expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
    const cleared = await page.evaluate(() => window.recoveryHarness.clear());
    expect(cleared.cleared).toBe(true);
    expect(cleared.snapshot!.meta.generation).not.toBe(old.snapshot!.meta.generation);
    initial(cleared.snapshot!);
    expect((await page.evaluate(() => window.recoveryHarness.rawDump())).version).toBe(9);
  }
});

test('unknown semantic and future physical versions refuse this client clear and preserve every native row', async ({
  page,
}) => {
  for (const kind of ['semantic', 'physical'] as const) {
    const { name } = await opened(page);
    await page.evaluate(() => window.recoveryHarness.seedStudy());
    if (kind === 'semantic')
      await page.evaluate(() => window.recoveryHarness.corrupt('meta', 'future'));
    else await page.evaluate(() => window.recoveryHarness.futurePhysical());
    const before = await page.evaluate(() => window.recoveryHarness.rawDump());
    const state = await page.evaluate((name) => window.recoveryHarness.open(name), name);
    expect(state.status).toBe('readonly');
    expect(state.recovery?.canClear ?? false).toBe(false);
    const result = await page.evaluate(() => window.recoveryHarness.clear());
    expect(result.cleared).toBe(false);
    expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
  }
});

test('native quota and permission API faults leave provisional learning unsaved and retry the original command without extra rights', async ({
  page,
}, testInfo) => {
  for (const fault of ['quota', 'security'] as const) {
    await opened(page);
    const eventId = randomUUID();
    const command = value(
      await page.evaluate(
        (id) => window.recoveryHarness.capture('exercise.passed', 'exercise.synthetic.first', id),
        eventId,
      ),
    );
    const before = await page.evaluate(() => window.recoveryHarness.rawDump());
    await page.evaluate((fault) => window.recoveryHarness.fault(fault), fault);
    unsaved(
      await page.evaluate((id) => window.recoveryHarness.commit(id), eventId),
      fault === 'quota' ? 'S_QUOTA' : 'S_STORAGE_UNAVAILABLE',
    );
    const failed = await page.evaluate(() => window.recoveryHarness.state());
    expect(failed.status).toBe('unsaved');
    expect(failed.lastSaved).toBe(false);
    expect(failed.temporary).toBe(true);
    expect(failed.pendingCount).toBe(1);
    expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
    await page.evaluate(() => window.recoveryHarness.clock('2026-10-16T02:00:00.000Z'));
    const restored = await page.evaluate(() => window.recoveryHarness.retry());
    expect(restored.pendingCount).toBe(0);
    expect(restored.lastSaved).toBe(true);
    expect(restored.snapshot!.receipts).toHaveLength(1);
    expect(restored.snapshot!.receipts[0]).toMatchObject(command.receipt);
    expect(restored.snapshot!.ledger).toHaveLength(1);
    const saved = await page.evaluate(() => window.recoveryHarness.rawDump());
    await page.evaluate(() => window.recoveryHarness.retry());
    expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(saved);
  }
  await testInfo.attach('recovery-api-fault-scope', {
    body: 'QuotaExceededError and SecurityError are injected at native write boundaries. This verifies atomic rollback, provisional state and original-command retry. Actual disk exhaustion and browser private-mode restrictions are not claimed.',
    contentType: 'text/plain',
  });
});

test('a new-day goal-open failure retries the original trusted occurrence without inventing a goal version or changing the date', async ({
  page,
}) => {
  await opened(page);
  const before = await page.evaluate(() => window.recoveryHarness.rawDump());
  const eventId = randomUUID();
  await page.evaluate(() => window.recoveryHarness.clock('2026-10-16T02:00:00.000Z'));
  await page.evaluate(() => window.recoveryHarness.fault('quota', 'goals'));
  unsaved(
    await page.evaluate(
      (id) => window.recoveryHarness.capture('exercise.passed', 'exercise.synthetic.first', id),
      eventId,
    ),
    'S_QUOTA',
  );
  const failed = await page.evaluate(() => window.recoveryHarness.state());
  expect(failed).toMatchObject({
    status: 'unsaved',
    temporary: true,
    pendingCount: 1,
    lastSaved: false,
  });
  expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
  await page.evaluate(() => window.recoveryHarness.clock('2026-10-17T02:00:00.000Z'));
  const restored = await page.evaluate(() => window.recoveryHarness.retry());
  expect(restored).toMatchObject({ pendingCount: 0, lastSaved: true, temporary: false });
  expect(restored.snapshot!.receipts).toHaveLength(1);
  expect(restored.snapshot!.receipts[0]).toMatchObject({
    eventId,
    occurredAt: '2026-10-16T02:00:00.000Z',
    localDate: '2026-10-16',
  });
  expect(restored.snapshot!.goals.map((row) => row.localDate)).toEqual(['2026-10-16']);
  expect(restored.snapshot!.ledger).toHaveLength(1);
});

test('an unavailable open permits clearly temporary learning without rebinding its facts when storage returns', async ({
  page,
}, testInfo) => {
  const { name } = await opened(page);
  await page.evaluate(() => window.recoveryHarness.seedStudy());
  const before = await page.evaluate(() => window.recoveryHarness.rawDump());
  await page.evaluate(() => window.recoveryHarness.close());
  await page.evaluate(() => window.recoveryHarness.denyOpen(true));
  const temporary = await page.evaluate((name) => window.recoveryHarness.open(name), name);
  expect(temporary.temporary).toBe(true);
  expect(temporary.lastSaved).toBe(false);
  const eventId = randomUUID();
  value(
    await page.evaluate(
      (id) => window.recoveryHarness.capture('lesson.started', 'lesson.synthetic.basics', id),
      eventId,
    ),
  );
  unsaved(
    await page.evaluate((id) => window.recoveryHarness.commit(id), eventId),
    'S_STORAGE_UNAVAILABLE',
  );
  const changed = await page.evaluate(() => window.recoveryHarness.state());
  expect(changed.temporary).toBe(true);
  expect(changed.lastSaved).toBe(false);
  expect(changed.pendingCount).toBe(0);
  expect(changed.projection!.history.some((row) => row.eventType === 'lesson.started')).toBe(true);
  expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
  await page.evaluate(() => window.recoveryHarness.denyOpen(false));
  const recovered = await page.evaluate(() => window.recoveryHarness.refresh());
  expect(recovered.temporary).toBe(false);
  expect(recovered.snapshot!.settings.theme).toBe('dark');
  expect(recovered.snapshot!.progress.some((row) => row.eventType === 'lesson.started')).toBe(
    false,
  );
  unsaved(
    await page.evaluate((id) => window.recoveryHarness.commit(id), eventId),
    'S_GENERATION_STALE',
  );
  expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
  await testInfo.attach('open-security-fault-scope', {
    body: 'Storage open SecurityError is an API injection in a fresh browser context, not a claim that a particular real private-browsing configuration blocks IndexedDB.',
    contentType: 'text/plain',
  });
});

test('aborting after native learning writes and after clear writes preserves the entire previous eleven-store archive', async ({
  page,
}) => {
  await opened(page);
  await page.evaluate(() => window.recoveryHarness.seedStudy());
  const eventId = randomUUID();
  await page.evaluate(() => window.recoveryHarness.clock('2026-10-16T02:00:00.000Z'));
  value(
    await page.evaluate(
      (id) => window.recoveryHarness.capture('exercise.passed', 'exercise.synthetic.first', id),
      eventId,
    ),
  );
  const before = await page.evaluate(() => window.recoveryHarness.rawDump());
  await page.evaluate(() => {
    window.recoveryHarness.audit.length = 0;
  });
  await page.evaluate(() => window.recoveryHarness.fault('abort', 'receipts'));
  unsaved(await page.evaluate((id) => window.recoveryHarness.commit(id), eventId), 'S_ABORTED');
  expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
  expect(
    (await page.evaluate(() => window.recoveryHarness.audit)).some(
      (row) => row.phase === 'abort' && row.store === 'receipts',
    ),
  ).toBe(true);
  for (const store of ['progress', 'dailyFacts'])
    expect(
      (await page.evaluate(() => window.recoveryHarness.audit)).some(
        (row) => row.phase === 'request-success' && row.store === store,
      ),
    ).toBe(true);
  await page.evaluate(() => window.recoveryHarness.fault('abort', 'meta'));
  const cleared = await page.evaluate(() => window.recoveryHarness.clear());
  expect(cleared.cleared).toBe(false);
  expect(cleared.lastSaved).toBe(false);
  expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
  const retry = await page.evaluate(() => window.recoveryHarness.clear());
  expect(retry.cleared).toBe(true);
  initial(retry.snapshot!);
});

test('two actual same-origin pages merge same and different synthetic facts without dropped rows or duplicate first rewards', async ({
  page,
  context,
}, testInfo) => {
  const { name } = await opened(page, newName(), false);
  const peer = await anotherPage(context, name, false);
  const results = await Promise.all([
    page.evaluate(
      ({ id, subject }) => window.recoveryHarness.learn('exercise.passed', subject, id),
      { id: randomUUID(), subject: first },
    ),
    peer.evaluate(
      ({ id, subject }) => window.recoveryHarness.learn('exercise.passed', subject, id),
      { id: randomUUID(), subject: first },
    ),
  ]);
  for (const answer of results) value(answer);
  let state = await page.evaluate(() => window.recoveryHarness.refresh());
  expect(state.snapshot!.receipts).toHaveLength(2);
  expect(state.snapshot!.ledger).toHaveLength(1);
  expect(state.snapshot!.dailyFacts).toHaveLength(1);
  const more = await Promise.all([
    page.evaluate((subject) => window.recoveryHarness.learn('exercise.passed', subject), second),
    peer.evaluate(
      (subject) => window.recoveryHarness.learn('case.view-confirmed', subject),
      caseId,
    ),
  ]);
  for (const answer of more) value(answer);
  state = await page.evaluate(() => window.recoveryHarness.refresh());
  const other = await peer.evaluate(() => window.recoveryHarness.refresh());
  expect(state.snapshot).toEqual(other.snapshot);
  expect(state.snapshot!.receipts).toHaveLength(4);
  expect(state.snapshot!.progress).toHaveLength(3);
  expect(state.snapshot!.ledger).toHaveLength(3);
  expect(state.snapshot!.dailyFacts).toHaveLength(3);
  expect(state.snapshot!.progress.map((row) => row.subjectRef.id).toSorted()).toEqual(
    [first, second, caseId].toSorted(),
  );
  await testInfo.attach('actual-two-page-concurrency', {
    body: JSON.stringify({
      evidenceKind:
        'two actual pages, native IDB transactions, synthetic trusted facts; BroadcastChannel unavailable',
      snapshot: state.snapshot,
    }),
    contentType: 'application/json',
  });
});

test('clear invalidates an in-flight command and queued local settings immediately, then prevents every old operation from restoring data', async ({
  page,
}) => {
  await opened(page, newName(), false);
  const eventId = randomUUID();
  value(
    await page.evaluate(
      (id) => window.recoveryHarness.capture('exercise.passed', 'exercise.synthetic.first', id),
      eventId,
    ),
  );
  const old = await page.evaluate(() => window.recoveryHarness.state());
  await page.evaluate(() => window.recoveryHarness.hold());
  const committing = await page.evaluate((id) => window.recoveryHarness.startCommit(id), eventId);
  const dark = await page.evaluate(() => window.recoveryHarness.startSave('dark'));
  const system = await page.evaluate(() => window.recoveryHarness.startSave('system'));
  const clearing = await page.evaluate(() => window.recoveryHarness.startClear());
  const invalidated = await page.evaluate(() => window.recoveryHarness.state());
  expect(invalidated.sessionEpoch).toBeGreaterThan(old.sessionEpoch);
  await page.evaluate(() => window.recoveryHarness.release());
  const commandResult = (await page.evaluate(
    (id) => window.recoveryHarness.waitJob(id),
    committing,
  )) as HarnessResult<unknown>;
  unsaved(commandResult, 'S_GENERATION_STALE');
  await page.evaluate((id) => window.recoveryHarness.waitJob(id), dark);
  await page.evaluate((id) => window.recoveryHarness.waitJob(id), system);
  const cleared = (await page.evaluate(
    (id) => window.recoveryHarness.waitJob(id),
    clearing,
  )) as LearningServiceState;
  expect(cleared.cleared).toBe(true);
  expect(cleared.snapshot!.meta.generation).not.toBe(old.snapshot!.meta.generation);
  initial(cleared.snapshot!);
  expect(
    (await page.evaluate(() => window.recoveryHarness.audit)).some(
      (row) => row.phase === 'write-attempt' && row.store === 'settings' && row.theme === 'system',
    ),
  ).toBe(false);
});

test('a peer that misses every notification still rejects its pre-clear command instead of rebinding it to the new generation', async ({
  page,
  context,
}) => {
  const { name } = await opened(page, newName(), false);
  const peer = await anotherPage(context, name, false);
  const eventId = randomUUID();
  value(
    await page.evaluate(
      (id) => window.recoveryHarness.capture('exercise.passed', 'exercise.synthetic.first', id),
      eventId,
    ),
  );
  const old = await page.evaluate(() => window.recoveryHarness.state());
  const cleared = await peer.evaluate(() => window.recoveryHarness.clear());
  expect(cleared.cleared).toBe(true);
  expect(cleared.snapshot!.meta.generation).not.toBe(old.snapshot!.meta.generation);
  unsaved(
    await page.evaluate((id) => window.recoveryHarness.commit(id), eventId),
    'S_GENERATION_STALE',
  );
  initial((await peer.evaluate(() => window.recoveryHarness.refresh())).snapshot!);
});

async function productionSnapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction(Array.from(db.objectStoreNames), 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const data = Object.fromEntries(
        await Promise.all(
          Array.from(db.objectStoreNames).map(async (name) => {
            const store = transaction.objectStore(name);
            const result = await new Promise<unknown>((resolve, reject) => {
              const request = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
                ? store.get('current')
                : store.getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return [name, result];
          }),
        ),
      );
      await done;
      return data as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}

interface ProductionPeerAudit {
  blockedFocus: number;
  blockedVisibility: number;
  broadcasts: { generation: string; revision: number; keys: string[] }[];
  workersCreated: number;
  engineStates: string[];
}
declare global {
  interface Window {
    __recoveryProductionPeer: ProductionPeerAudit;
  }
}
async function productionPeer(context: BrowserContext) {
  const peer = await context.newPage();
  await peer.addInitScript(() => {
    const audit: ProductionPeerAudit = {
      blockedFocus: 0,
      blockedVisibility: 0,
      broadcasts: [],
      workersCreated: 0,
      engineStates: [],
    };
    window.__recoveryProductionPeer = audit;
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (
          target instanceof HTMLElement &&
          target.getAttribute('data-testid') === 'engine-connection'
        )
          audit.engineStates.push(target.getAttribute('data-state') ?? '');
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    const nativeAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this === window && type === 'focus') {
        audit.blockedFocus++;
        return;
      }
      if (this === document && type === 'visibilitychange') {
        audit.blockedVisibility++;
        return;
      }
      return nativeAdd.call(this, type, listener, options);
    };
    const NativeBroadcast = window.BroadcastChannel;
    window.BroadcastChannel = class extends NativeBroadcast {
      constructor(name: string) {
        super(name);
        if (name === 'c-viz-learning.invalidate')
          this.addEventListener('message', (event: MessageEvent<unknown>) => {
            const data = event.data as { generation: string; revision: number };
            audit.broadcasts.push({
              generation: data.generation,
              revision: data.revision,
              keys: Object.keys(data).sort(),
            });
          });
      }
    };
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        audit.workersCreated++;
        return Reflect.construct(target, args);
      },
    });
  });
  return peer;
}

test('real production BroadcastChannel updates a peer without focus refresh and discards its old draft after another page clears', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/#/settings?panel=display');
  await expect(page.getByRole('combobox', { name: '主题', exact: true })).toBeEnabled();
  const peer = await productionPeer(context);
  await peer.goto('/#/settings?panel=display');
  await expect(peer.getByRole('combobox', { name: '主题', exact: true })).toBeEnabled();
  // Finish both public catalog requests before changing the DB, so a late
  // catalog refresh cannot be mistaken for notification-based invalidation.
  await Promise.all([page.waitForLoadState('networkidle'), peer.waitForLoadState('networkidle')]);
  expect(await peer.evaluate(() => window.__recoveryProductionPeer.blockedFocus)).toBeGreaterThan(
    0,
  );
  expect(
    await peer.evaluate(() => window.__recoveryProductionPeer.blockedVisibility),
  ).toBeGreaterThan(0);
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark');
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(peer.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await expectEditorValue(peer.getByRole('combobox', { name: '主题', exact: true }), 'dark');
  await expect
    .poll(() => peer.evaluate(() => window.__recoveryProductionPeer.broadcasts.length))
    .toBeGreaterThanOrEqual(1);
  await peer.getByRole('combobox', { name: '主题', exact: true }).selectOption('light');
  await expect(peer.getByRole('button', { name: '保存显示设置', exact: true })).toBeEnabled();
  await expect(peer.getByText('这次显示设置更改尚未保存。', { exact: true })).toBeVisible();
  const old = await productionSnapshot(page);
  await page.getByRole('tab', { name: '本地数据', exact: true }).click();
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  // Current providers re-read the fresh archive after clear; the following native
  // generation/default assertions prove the clear independently of that transient notice.
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(peer.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await expectEditorValue(peer.getByRole('combobox', { name: '主题', exact: true }), 'light');
  await expect(peer.getByRole('button', { name: '保存显示设置', exact: true })).toBeDisabled();
  await expect(peer.getByText('这次显示设置更改尚未保存。', { exact: true })).toHaveCount(0);
  const cleared = await productionSnapshot(peer);
  expect(cleared.meta.generation).not.toBe(old.meta.generation);
  initial(cleared, true);
  const audit = await peer.evaluate(() => window.__recoveryProductionPeer);
  expect(audit.broadcasts.length).toBeGreaterThanOrEqual(2);
  expect(
    audit.broadcasts.every(
      (hint) => JSON.stringify(hint.keys) === JSON.stringify(['generation', 'revision']),
    ),
  ).toBe(true);
  await testInfo.attach('production-broadcast-without-focus', {
    body: JSON.stringify({
      evidenceKind:
        'two actual production pages; native BroadcastChannel hints observed; app focus/visibility listener registration suppressed only in peer',
      audit,
      oldGeneration: old.meta.generation,
      newGeneration: cleared.meta.generation,
    }),
    contentType: 'application/json',
  });
});

test('a production peer clear invalidates a pending real WASM download and its late network completion cannot revive the old check', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/#/settings?panel=data');
  await expect(page.getByRole('button', { name: '清除本地数据', exact: true })).toBeEnabled();
  const peer = await productionPeer(context);
  const wasm = /\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/;
  let release!: () => void;
  let arrived!: () => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const networkFinished = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await peer.route(wasm, async (route) => {
    arrived();
    await gate;
    try {
      await route.continue();
    } catch {
      /* Clear may already abort the actual pending fetch. */
    } finally {
      finished();
    }
  });
  await peer.goto('/checks/adapters.html#/visualize/case.c.bubble-sort');
  const engine = peer.getByTestId('engine-connection');
  await expect(engine).toHaveAttribute('data-state', 'idle');
  await Promise.all([page.waitForLoadState('networkidle'), peer.waitForLoadState('networkidle')]);
  // Prepare the confirmation before starting the check, keeping this race well
  // inside the real adapter's one-second deadline instead of using its timeout.
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认清除本地数据', exact: true });
  await expect(confirmation).toBeVisible();
  await engine.getByRole('button', { name: '检查执行模块', exact: true }).click();
  await requested;
  await expect(engine).toHaveAttribute('data-state', 'loading');
  try {
    await confirmation.getByRole('button', { name: '确认清除', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
    await expect(engine).toHaveAttribute('data-state', 'idle');
    expect(await peer.evaluate(() => window.__recoveryProductionPeer.workersCreated)).toBe(0);
    expect(await peer.evaluate(() => window.__recoveryProductionPeer.engineStates)).not.toContain(
      'timed-out',
    );
    expect(await peer.evaluate(() => window.__recoveryProductionPeer.engineStates)).not.toContain(
      'ready',
    );
  } finally {
    release();
  }
  await networkFinished;
  await peer.unroute(wasm);
  await expect(engine).toHaveAttribute('data-state', 'idle');
  expect(await peer.evaluate(() => window.__recoveryProductionPeer.workersCreated)).toBe(0);
  expect(await peer.evaluate(() => window.__recoveryProductionPeer.engineStates)).not.toContain(
    'timed-out',
  );
  expect(await peer.evaluate(() => window.__recoveryProductionPeer.engineStates)).not.toContain(
    'ready',
  );
  await engine.getByRole('button', { name: '检查执行模块', exact: true }).click();
  await expect(engine).toHaveAttribute('data-state', 'ready');
  await expect(engine).toContainText('构建检查不执行 C');
  expect(await peer.evaluate(() => window.__recoveryProductionPeer.workersCreated)).toBe(1);
  const audit = await peer.evaluate(() => window.__recoveryProductionPeer);
  expect(audit.blockedFocus).toBeGreaterThan(0);
  expect(audit.blockedVisibility).toBeGreaterThan(0);
  expect(audit.broadcasts.length).toBeGreaterThanOrEqual(1);
  initial(await productionSnapshot(peer), true);
  await testInfo.attach('production-clear-invalidates-real-module-download', {
    body: JSON.stringify({
      evidenceKind:
        'real same-origin WASM request held at the network boundary; peer clear observed through native BroadcastChannel; old request cannot create a Worker; new check uses actual Rust build probe, not a C interpreter',
      audit,
    }),
    contentType: 'application/json',
  });
});

test('production clear confirmation cancels without writes, then confirmed clear restores defaults in a fresh generation across refresh', async ({
  page,
}) => {
  await page.goto('/#/settings?panel=display');
  await expect(page.getByRole('combobox', { name: '主题', exact: true })).toBeEnabled();
  await expect
    .poll(async () => (await productionSnapshot(page)).settings.goalTemplate)
    .not.toBeNull();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark');
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await page.getByRole('tab', { name: '本地数据', exact: true }).click();
  const before = await productionSnapshot(page);
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认清除本地数据', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('进度');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await productionSnapshot(page)).toEqual(before);
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await dialog.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect
    .poll(async () => (await productionSnapshot(page)).meta.activePackageRef)
    .toEqual(c6LearningRelease.packageRef);
  const after = await productionSnapshot(page);
  expect(after.meta.generation).not.toBe(before.meta.generation);
  initial(after, true);
  await page.reload();
  await expect(page.locator('.app-shell')).not.toHaveAttribute(
    'data-learning-storage-status',
    'loading',
  );
  expect(await productionSnapshot(page)).toEqual(after);
  await page.getByRole('tab', { name: '显示设置', exact: true }).click();
  await expectEditorValue(page.getByRole('combobox', { name: '主题', exact: true }), 'light');
});

test('production home visibly marks a corrupt ledger total as unconfirmed instead of displaying zero points', async ({
  page,
}) => {
  await page.goto('/#/settings?panel=data');
  await expect(page.locator('.app-shell')).not.toHaveAttribute(
    'data-learning-storage-status',
    'loading',
  );
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction(['meta', 'ledger'], 'readwrite');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      const meta = transaction.objectStore('meta').get('current');
      meta.onsuccess = () =>
        transaction
          .objectStore('ledger')
          .put({ damaged: true }, [
            (meta.result as StorageSnapshot['meta']).generation,
            'reward.exercise.first-pass',
            'exercise.c.echo',
          ]);
      await done;
    } finally {
      db.close();
    }
  });
  await page.goto('/#/');
  await page.reload();
  await expect(
    page.getByRole('button', { name: '积分暂不可确认，查看明细', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '积分 0，查看明细', exact: true })).toHaveCount(0);
});

test('production singleton reset requires its own confirmation and leaves all unrelated stored settings and learning rows unchanged', async ({
  page,
}) => {
  await page.goto('/#/settings?panel=display');
  await expect(page.getByRole('combobox', { name: '主题', exact: true })).toBeEnabled();
  await expect
    .poll(async () => (await productionSnapshot(page)).settings.goalTemplate)
    .not.toBeNull();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark');
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  for (const store of ['settings', 'avatar'] as const) {
    await page.evaluate(async (store) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = db.transaction(store, 'readwrite');
        const done = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
        });
        const read = transaction.objectStore(store).get('current');
        read.onsuccess = () =>
          transaction.objectStore(store).put(
            {
              ...(read.result as Record<string, unknown>),
              ...(store === 'settings' ? { theme: 'broken' } : { accentColor: 'broken' }),
            },
            'current',
          );
        await done;
      } finally {
        db.close();
      }
    }, store);
    await page.goto('/#/settings?panel=data');
    await page.reload();
    const label = store === 'settings' ? '显示设置' : '旧偏好';
    const entry = page.getByRole('button', { name: `重置${label}`, exact: true });
    await expect(entry).toBeEnabled();
    const before = await productionSnapshot(page);
    await entry.click();
    const dialog = page.getByRole('dialog', { name: `确认重置${label}`, exact: true });
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(await productionSnapshot(page)).toEqual(before);
    await entry.click();
    await dialog.getByRole('button', { name: `确认重置${label}`, exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
    const after = await productionSnapshot(page);
    expect(after.meta.generation).toBe(before.meta.generation);
    for (const name of [
      'settings',
      'avatar',
      'progress',
      'dailyFacts',
      'goals',
      'ledger',
      'receipts',
      'aliases',
      'appearance',
      'appearanceAssets',
    ] as const)
      if (name !== store) expect(after[name]).toEqual(before[name]);
    if (store === 'settings')
      expect(after.settings).toEqual({
        theme: 'light',
        reducedMotion: 'system',
        playbackRate: 1,
        goalTemplate: null,
      });
    else expect(after.avatar).toEqual({ presetId: 'avatar.basic.01', accentColor: '#168A72' });
  }
});

test('actual isolated browser contexts keep native IDB through refresh and discard that isolated profile when the context closes', async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error('The current test origin must be explicit');
  const contextOptions = { baseURL };
  const name = newName();
  const transient = await browser.newContext(contextOptions);
  let originalGeneration: string;
  try {
    const page = await transient.newPage();
    await opened(page, name);
    const learned = await page.evaluate(() => window.recoveryHarness.seedStudy());
    originalGeneration = learned.snapshot!.meta.generation;
    const before = await page.evaluate(() => window.recoveryHarness.rawDump());
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => typeof window.recoveryHarness?.open))
      .toBe('function');
    const restored = await page.evaluate((name) => window.recoveryHarness.open(name), name);
    expect(restored.snapshot).toEqual(learned.snapshot);
    expect(await page.evaluate(() => window.recoveryHarness.rawDump())).toEqual(before);
  } finally {
    // Deliberately no deleteDatabase: closing the isolated context removes its storage.
    await transient.close();
  }
  const replacement = await browser.newContext(contextOptions);
  try {
    const page = await replacement.newPage();
    const fresh = await opened(page, name);
    expect(fresh.state.snapshot!.meta.generation).not.toBe(originalGeneration);
    initial(fresh.state.snapshot!);
    await page.evaluate(() => window.recoveryHarness.dispose());
  } finally {
    await replacement.close();
  }
  await testInfo.attach('actual-isolated-context-storage-lifecycle', {
    body: 'This is an actual separate browser context/profile lifetime check with working native IndexedDB. It demonstrates refresh persistence and isolation after context closure. Storage-disabled/private-mode restrictions and disk exhaustion are separately identified API injections.',
    contentType: 'text/plain',
  });
});
