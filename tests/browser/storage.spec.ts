import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { HarnessResult, RawDump, StorageAudit } from './harness/storage';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { defaultAppearance } from '../../web/src/storage/model';
import { upgradeV1Snapshot, type LegacyStorageSnapshot } from '../../web/src/storage/v1-migration';

// SAVE collections are keyed facts, with no insertion-order promise. Compare all
// row contents while respecting the native compound-key read order separately.
function normalized<T extends StorageSnapshot | LegacyStorageSnapshot>(snapshot: T): T {
  const copy = structuredClone(snapshot);
  for (const name of [
    'progress',
    'dailyFacts',
    'goals',
    'ledger',
    'receipts',
    'aliases',
  ] as const) {
    (copy[name] as unknown[]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return copy;
}

const storeNames = [
  'meta',
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
];
const referenceScenarios = JSON.parse(
  readFileSync(new URL('../../shared/contracts/02.3-迁移与并发场景.json', import.meta.url), 'utf8'),
) as {
  purpose: string;
  legacyFixture: {
    schemaVersion: string;
    generation: string;
    timeZone: string;
    createdAt: string;
    packageRef: { id: string; version: string };
    theme: string;
    confirmations: unknown[];
    passes: unknown[];
    rewards: { points: number }[];
  };
};

function value<T>(answer: HarnessResult<T>): T {
  expect(answer.ok, answer.ok ? undefined : `${answer.error.code}: ${answer.error.message}`).toBe(
    true,
  );
  if (!answer.ok) throw new Error(answer.error.message);
  return answer.value;
}
function failure(answer: HarnessResult<unknown>, code: string) {
  expect(answer.ok).toBe(false);
  if (answer.ok) throw new Error('Expected an unsaved infrastructure result');
  expect(answer.error.code).toBe(code);
  expect(answer.error.saved).toBe(false);
}
function rows(dump: RawDump, store: string) {
  const found = dump.stores.find((entry) => entry.name === store);
  expect(found).toBeDefined();
  return found!.rows;
}
async function opened(page: Page, kind: 'test' | 'reference' = 'test') {
  const name = `c-viz-learning.${kind}.${randomUUID()}`;
  const answer = await page.evaluate((name) => window.storageHarness.open(name), name);
  return { name, snapshot: value(answer) };
}
function assertSavedAfterComplete(audit: StorageAudit) {
  const savedAt = audit.events.findLastIndex((event) => event.phase === 'saved-result');
  const receipt = audit.events.findLast(
    (event) => event.phase === 'request-success' && event.store === 'receipts',
  );
  expect(receipt).toBeDefined();
  const completedAt = audit.events.findIndex(
    (event) => event.phase === 'complete' && event.transaction === receipt!.transaction,
  );
  expect(completedAt).toBeGreaterThan(-1);
  expect(savedAt).toBeGreaterThan(completedAt);
  expect(
    audit.events
      .filter((event) => event.phase === 'transaction' && event.mode === 'readwrite')
      .some(
        (event) =>
          JSON.stringify(event.scope?.toSorted()) === JSON.stringify(storeNames.toSorted()),
      ),
  ).toBe(true);
  expect(audit.localStorageWrites).toBe(0);
  expect(
    audit.opens.every(
      (name) =>
        name.startsWith('c-viz-learning.test.') || name.startsWith('c-viz-learning.reference.'),
    ),
  ).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/checks/');
  await expect.poll(() => page.evaluate(() => typeof window.storageHarness?.open)).toBe('function');
});
test.afterEach(async ({ context }) => {
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    await page.evaluate(async () => {
      await window.storageHarness?.dispose();
    });
  }
});

test('new native IndexedDB has twelve out-of-line stores, one saved default set and a nondestructive availability probe', async ({
  page,
}) => {
  const { name, snapshot } = await opened(page);
  expect(snapshot.meta).toMatchObject({
    schemaVersion: '9.0.0',
    dbVersion: 9,
    revision: 0,
    timeZone: 'Asia/Shanghai',
    activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
  });
  expect(snapshot.meta.generation).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(snapshot.settings).toEqual({
    theme: 'light',
    reducedMotion: 'system',
    playbackRate: 1,
    goalTemplate: null,
  });
  expect(snapshot.avatar).toEqual({ presetId: 'avatar.basic.01', accentColor: '#168A72' });
  expect(snapshot.appearance).toEqual(defaultAppearance());
  expect(snapshot.appearanceAssets).toEqual([]);
  for (const store of ['progress', 'dailyFacts', 'goals', 'ledger', 'receipts', 'aliases'] as const)
    expect(snapshot[store]).toEqual([]);
  const before = await page.evaluate(() => window.storageHarness.rawDump());
  expect(before.version).toBe(9);
  expect(before.stores.map((store) => store.name).toSorted()).toEqual(
    [
      ...storeNames,
      'editHistory',
      'knowledgeMarks',
      'reviewCards',
      'achievements',
      'customDrafts',
      'weaknesses',
    ].toSorted(),
  );
  for (const store of before.stores) {
    expect(store.keyPath).toBeNull();
    expect(store.autoIncrement).toBe(false);
    if (['meta', 'settings', 'avatar', 'appearance'].includes(store.name))
      expect(store.rows.map((row) => row.key)).toEqual(['current']);
  }
  expect(value(await page.evaluate(() => window.storageHarness.probe()))).toEqual({
    available: true,
  });
  expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(before);
  expect(value(await page.evaluate((name) => window.storageHarness.open(name), name))).toEqual(
    snapshot,
  );
  const audit = await page.evaluate(() => window.storageHarness.audit);
  expect(audit.localStorageWrites).toBe(0);
  expect(audit.opens).not.toContain('c-viz-learning');
});

test('synthetic receipt and unique reward survive refresh and closing/reopening a page without producing new facts', async ({
  page,
  context,
}, testInfo) => {
  const { name } = await opened(page);
  const eventId = randomUUID();
  expect(
    value(await page.evaluate((eventId) => window.storageHarness.commitEvent(eventId), eventId)),
  ).toMatchObject({ saved: true, replayed: false, revision: 1 });
  const persisted = value(await page.evaluate(() => window.storageHarness.read()));
  const raw = await page.evaluate(() => window.storageHarness.rawDump());
  expect(rows(raw, 'receipts')[0]!.key).toEqual([persisted.meta.generation, eventId]);
  expect(rows(raw, 'ledger')[0]!.key).toEqual([
    persisted.meta.generation,
    'reward.exercise.first-pass',
    'exercise.c.echo',
  ]);
  assertSavedAfterComplete(await page.evaluate(() => window.storageHarness.audit));
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.storageHarness?.open)).toBe('function');
  expect(value(await page.evaluate((name) => window.storageHarness.open(name), name))).toEqual(
    persisted,
  );
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/checks/');
  await expect
    .poll(() => reopened.evaluate(() => typeof window.storageHarness?.open))
    .toBe('function');
  expect(value(await reopened.evaluate((name) => window.storageHarness.open(name), name))).toEqual(
    persisted,
  );
  expect(await reopened.evaluate(() => window.storageHarness.rawDump())).toEqual(raw);
  await testInfo.attach('native-idb-refresh-reopen', {
    body: JSON.stringify({
      name,
      snapshot: persisted,
      raw,
      evidenceKind: 'synthetic storage primitive, not real learning',
    }),
    contentType: 'application/json',
  });
});

test('same receipt retries return the original revision and different IDs cannot duplicate the stable reward key', async ({
  page,
}) => {
  await opened(page);
  const eventId = randomUUID();
  const first = value(await page.evaluate((id) => window.storageHarness.commitEvent(id), eventId));
  const retry = value(await page.evaluate((id) => window.storageHarness.commitEvent(id), eventId));
  expect(retry).toEqual({ ...first, replayed: true });
  const another = value(
    await page.evaluate((id) => window.storageHarness.commitEvent(id), randomUUID()),
  );
  expect(another).toEqual({ saved: true, replayed: false, revision: first.revision + 1 });
  const snapshot = value(await page.evaluate(() => window.storageHarness.read()));
  expect(snapshot.receipts).toHaveLength(2);
  expect(snapshot.progress).toHaveLength(1);
  expect(snapshot.dailyFacts).toHaveLength(1);
  expect(snapshot.ledger).toHaveLength(1);
  expect(snapshot.ledger[0]).toMatchObject({ status: 'pending', points: null, policyRef: null });
});

test('reusing an event ID with changed subject version, learning revision, occurrence time or goal version is rejected without changes', async ({
  page,
}) => {
  await opened(page);
  const eventId = randomUUID();
  value(await page.evaluate((id) => window.storageHarness.commitEvent(id), eventId));
  const before = await page.evaluate(() => window.storageHarness.rawDump());
  const variants = [
    { subjectRef: { id: 'exercise.c.echo', version: '1.0.1' } },
    { learningRevision: 2 },
    { occurredAt: '2026-10-15T02:01:00.000Z' },
    { goalVersion: 2 },
  ];
  for (const overrides of variants) {
    failure(
      await page.evaluate(
        ({ eventId, overrides }) => window.storageHarness.commitEvent(eventId, overrides),
        { eventId, overrides },
      ),
      'S_EVENT_ID_REUSED',
    );
    expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(before);
  }
});

test('a real transaction aborted after a successful receipt request rolls back all stores and reports unsaved, then exact retry succeeds', async ({
  page,
}) => {
  await opened(page);
  const before = await page.evaluate(() => window.storageHarness.rawDump());
  const eventId = randomUUID();
  failure(
    await page.evaluate(
      (id) => window.storageHarness.commitEvent(id, {}, 'abort-after-success'),
      eventId,
    ),
    'S_ABORTED',
  );
  expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(before);
  const audit = await page.evaluate(() => window.storageHarness.audit);
  const request = audit.events.find(
    (entry) => entry.phase === 'request-success' && entry.store === 'receipts',
  );
  expect(request).toBeDefined();
  expect(
    audit.events.some(
      (entry) => entry.phase === 'abort' && entry.transaction === request!.transaction,
    ),
  ).toBe(true);
  expect(audit.events.some((entry) => entry.phase === 'saved-result')).toBe(false);
  expect(
    value(await page.evaluate((id) => window.storageHarness.commitEvent(id), eventId)),
  ).toMatchObject({ saved: true, replayed: false, revision: 1 });
  assertSavedAfterComplete(await page.evaluate(() => window.storageHarness.audit));
});

test('injected quota and storage-disabled API faults are unsaved and never erase existing data', async ({
  page,
}, testInfo) => {
  const { name } = await opened(page);
  const before = await page.evaluate(() => window.storageHarness.rawDump());
  const eventId = randomUUID();
  failure(
    await page.evaluate((id) => window.storageHarness.commitEvent(id, {}, 'quota'), eventId),
    'S_QUOTA',
  );
  expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(before);
  failure(
    await page.evaluate((name) => window.storageHarness.unavailable(name), name),
    'S_STORAGE_UNAVAILABLE',
  );
  expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(before);
  value(await page.evaluate((id) => window.storageHarness.commitEvent(id), eventId));
  expect(value(await page.evaluate(() => window.storageHarness.read())).ledger).toHaveLength(1);
  await testInfo.attach('fault-evidence-scope', {
    body: 'SecurityError and QuotaExceededError were injected at native API boundaries. This does not test real private-mode restrictions, physical disk exhaustion or actual browser quota exhaustion.',
    contentType: 'text/plain',
  });
});

test('writing with a stale generation fails even without an invalidation notification', async ({
  page,
}) => {
  const { snapshot } = await opened(page);
  await page.evaluate(
    (generation) => window.storageHarness.patchMeta({ generation }),
    randomUUID(),
  );
  const before = await page.evaluate(() => window.storageHarness.rawDump());
  failure(
    await page.evaluate(
      ({ eventId, generation }) =>
        window.storageHarness.commitEvent(eventId, {}, undefined, generation),
      { eventId: randomUUID(), generation: snapshot.meta.generation },
    ),
    'S_GENERATION_STALE',
  );
  expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(before);
});

test('unknown semantic versions, invalid meta and missing meta preserve the native archive instead of reinitializing it', async ({
  page,
}) => {
  const { name } = await opened(page);
  value(await page.evaluate((id) => window.storageHarness.commitEvent(id), randomUUID()));
  const original = value(await page.evaluate(() => window.storageHarness.read()));
  for (const patch of [{ schemaVersion: '10.0.0' }, { schemaVersion: '9.0.0', generation: '' }]) {
    await page.evaluate((patch) => window.storageHarness.patchMeta(patch), patch);
    const before = await page.evaluate(() => window.storageHarness.rawDump());
    failure(
      await page.evaluate((name) => window.storageHarness.open(name), name),
      patch.schemaVersion === '10.0.0' ? 'S_VERSION_UNKNOWN' : 'S_RECORD_INVALID',
    );
    expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(before);
    expect(rows(before, 'ledger')).toHaveLength(1);
  }
  await page.evaluate((meta) => window.storageHarness.patchMeta(meta), original.meta);
  await page.evaluate(() => window.storageHarness.removeMeta());
  const missing = await page.evaluate(() => window.storageHarness.rawDump());
  failure(
    await page.evaluate((name) => window.storageHarness.open(name), name),
    'S_RECORD_INVALID',
  );
  expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(missing);
});

test('versionchange closes the current connection, and future physical versions remain intact and reject the old client', async ({
  page,
}) => {
  const { name } = await opened(page);
  value(await page.evaluate((id) => window.storageHarness.commitEvent(id), randomUUID()));
  const before = await page.evaluate(() => window.storageHarness.rawDump());
  // The raw future-version open would stay blocked if the product adapter kept its connection alive.
  await page.evaluate(() => window.storageHarness.futureVersion());
  const future = await page.evaluate(() => window.storageHarness.rawDump());
  expect(future).toEqual({ ...before, version: 10 });
  const closed = await page.evaluate(() => window.storageHarness.read());
  expect(closed.ok).toBe(false);
  if (!closed.ok) expect(closed.error.saved).toBe(false);
  failure(
    await page.evaluate((name) => window.storageHarness.open(name), name),
    'S_VERSION_UNKNOWN',
  );
  expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(future);
});

test('a queued native open can be cancelled while another connection blocks deletion, and late open does not leak a connection', async ({
  page,
}) => {
  await opened(page);
  expect(await page.evaluate(() => window.storageHarness.beginBlockedCancellation())).toEqual({
    blocked: true,
  });
  failure(await page.evaluate(() => window.storageHarness.cancelBlocked()), 'S_ABORTED');
  expect(await page.evaluate(() => window.storageHarness.releaseBlocked())).toEqual({
    released: true,
  });
});

test('frozen synthetic reference 0.9 migrates atomically to SAVE1 without inventing day facts, receipts or completion rewards', async ({
  page,
}, testInfo) => {
  expect(referenceScenarios.purpose).toBe('contract-fixture');
  const name = `c-viz-learning.reference.${randomUUID()}`;
  await page.evaluate(({ name, legacy }) => window.storageHarness.seedReference(name, legacy), {
    name,
    legacy: referenceScenarios.legacyFixture,
  });
  const migrated = value(await page.evaluate(() => window.storageHarness.migrate()));
  expect(migrated.meta).toMatchObject({
    schemaVersion: '1.0.0',
    dbVersion: 1,
    revision: 1,
    generation: referenceScenarios.legacyFixture.generation,
    timeZone: referenceScenarios.legacyFixture.timeZone,
    createdAt: referenceScenarios.legacyFixture.createdAt,
    activePackageRef: referenceScenarios.legacyFixture.packageRef,
  });
  expect(migrated.settings.theme).toBe('dark');
  expect(migrated.progress.map((row) => row.eventType).toSorted()).toEqual([
    'exercise.passed',
    'lesson.study-confirmed',
  ]);
  expect(migrated.ledger).toHaveLength(1);
  expect(migrated.ledger[0]).toMatchObject({
    status: 'posted',
    points: referenceScenarios.legacyFixture.rewards[0]!.points,
    policyRef: { id: 'legacy.fixture', version: '0.9.0' },
  });
  for (const store of ['dailyFacts', 'goals', 'receipts', 'aliases'] as const)
    expect(migrated[store]).toEqual([]);
  const once = await page.evaluate(() => window.storageHarness.rawDump());
  expect(normalized(value(await page.evaluate(() => window.storageHarness.migrate())))).toEqual(
    normalized(migrated),
  );
  expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(once);
  expect(
    normalized(value(await page.evaluate((name) => window.storageHarness.open(name), name))),
  ).toEqual(normalized(upgradeV1Snapshot(migrated)));
  await testInfo.attach('reference-migration-not-published-legacy', {
    body: JSON.stringify({
      evidenceKind: 'frozen synthetic 0.9 predecessor; no historical product release claimed',
      migrated,
    }),
    contentType: 'application/json',
  });
});

test('interrupting reference migration after a native row request succeeds preserves every original row and supports controlled retry', async ({
  page,
}) => {
  const name = `c-viz-learning.reference.${randomUUID()}`;
  const before = await page.evaluate(
    ({ name, legacy }) => window.storageHarness.seedReference(name, legacy),
    { name, legacy: referenceScenarios.legacyFixture },
  );
  const interrupted = await page.evaluate(() =>
    window.storageHarness.migrate('abort-after-success'),
  );
  expect(interrupted.ok).toBe(false);
  if (!interrupted.ok) expect(interrupted.error.saved).toBe(false);
  expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(before);
  expect(rows(before, 'meta')[0]!.value).toEqual(referenceScenarios.legacyFixture);
  const audit = await page.evaluate(() => window.storageHarness.audit);
  const written = audit.events.find(
    (event) => event.phase === 'request-success' && event.store === 'progress',
  );
  expect(written).toBeDefined();
  expect(
    audit.events.some(
      (event) => event.phase === 'abort' && event.transaction === written!.transaction,
    ),
  ).toBe(true);
  expect(value(await page.evaluate(() => window.storageHarness.migrate())).meta.schemaVersion).toBe(
    '1.0.0',
  );
});

test('invalid reference predecessors reject without rewriting the original native rows', async ({
  page,
}) => {
  const original = referenceScenarios.legacyFixture;
  const cases = [
    { ...original, schemaVersion: '0.8.0' },
    { ...original, rewards: original.rewards.map((row) => ({ ...row, points: -1 })) },
    { ...original, passes: [...original.passes, ...original.passes] },
  ];
  for (const legacy of cases) {
    const name = `c-viz-learning.reference.${randomUUID()}`;
    const before = await page.evaluate(
      ({ name, legacy }) => window.storageHarness.seedReference(name, legacy),
      { name, legacy },
    );
    const rejected = await page.evaluate(() => window.storageHarness.migrate());
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.saved).toBe(false);
    expect(await page.evaluate(() => window.storageHarness.rawDump())).toEqual(before);
    expect(rows(before, 'meta')[0]!.value).toEqual(legacy);
    await page.evaluate(() => window.storageHarness.dispose());
  }
});
