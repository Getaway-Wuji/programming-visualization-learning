import { expect, test } from '@playwright/test';
import type {} from './c6-learning-harness';

test.beforeEach(async ({ page }) => {
  await page.goto('/c6-learning-harness.html');
  await page.waitForFunction(() => Boolean(window.c6LearningChecks));
});
test('a blocked RESET reports the blocker, cancels its late upgrade and permits an explicit retry', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const name = `c-viz-c6-check.${crypto.randomUUID()}`;
    try {
      return await window.c6LearningChecks.blockedReset(name);
    } finally {
      await window.c6LearningChecks.cleanup(name);
    }
  });
  expect(result).toMatchObject({
    blocked: 'S_UPGRADE_BLOCKED',
    beforeVersion: 9,
    afterCancelVersion: 9,
    progress: [],
  });
  expect(result.generation).not.toBe('00000000-0000-4000-8000-000000000001');
});
test('native DB9 reset removes every populated learning store and preserves actual preference/blob data', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const checks = window.c6LearningChecks,
      name = `c-viz-c6-check.${crypto.randomUUID()}`;
    try {
      const seeded = await checks.seed(name);
      const generation = await checks.upgrade(name);
      const rows = await checks.read(name, 10);
      const asset = rows.appearanceAssets.values[0] as { blob: Blob };
      const sha = async (blob: Blob) =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
          (n) => n.toString(16).padStart(2, '0'),
        ).join('');
      return {
        stores: Object.keys(rows).sort(),
        generation,
        meta: rows.meta.values[0],
        settings: rows.settings.values[0],
        avatar: rows.avatar.values[0],
        appearance: rows.appearance.values[0],
        assetKey: rows.appearanceAssets.keys[0],
        assetBytes: asset.blob.size,
        expectedBytes: seeded.blobBytes,
        assetSha: await sha(asset.blob),
        expectedSha: seeded.blobSha,
        learningCounts: Object.entries(rows)
          .filter(
            ([name]) =>
              !['meta', 'settings', 'avatar', 'appearance', 'appearanceAssets'].includes(name),
          )
          .map(([, row]) => row.values.length),
      };
    } finally {
      await checks.cleanup(name);
    }
  });
  expect(result.stores).toHaveLength(19);
  expect(result.meta).toMatchObject({
    schemaVersion: '10.0.0',
    dbVersion: 10,
    generation: result.generation,
    activePackageRef: { id: 'content.c.primer6', version: '2.0.0' },
    activeCatalogSetRef: { id: 'catalog-set.c.primer6', version: '2.0.0' },
  });
  expect(result.generation).not.toBe('00000000-0000-4000-8000-000000000001');
  expect(result.settings).toMatchObject({ theme: 'dark', playbackRate: 2, goalTemplate: null });
  expect(result.avatar).toMatchObject({ accentColor: '#123456' });
  expect(result.appearance).toMatchObject({
    preset: 'soft',
    background: { visible: true, assetId: 'background' },
  });
  expect(result.assetKey).toEqual([result.generation, 'background']);
  expect(result.assetBytes).toBe(result.expectedBytes);
  expect(result.assetSha).toBe(result.expectedSha);
  expect(result.learningCounts).toEqual(Array(14).fill(0));
});

test('a failed preference check rolls back the version, all rows and new stores; repair then retry succeeds', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const checks = window.c6LearningChecks,
      name = `c-viz-c6-check.${crypto.randomUUID()}`;
    try {
      await checks.seed(name, { badPreference: true });
      const before = await checks.read(name, 9);
      const code = await checks.upgrade(name).then(
        () => 'unexpected',
        (e: { code: string }) => e.code,
      );
      const after = await checks.read(name, 9);
      await checks.repairPreference(name);
      await checks.upgrade(name);
      return {
        code,
        same: JSON.stringify(before) === JSON.stringify(after),
        oldStores: Object.keys(after).length,
        newStores: Object.keys(await checks.read(name, 10)).length,
      };
    } finally {
      await checks.cleanup(name);
    }
  });
  expect(result).toEqual({ code: 'S_RECORD_INVALID', same: true, oldStores: 17, newStores: 19 });
});

test('refresh and repeated activation preserve the current generation and newly saved rows', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const checks = window.c6LearningChecks,
      name = `c-viz-c6-check.${crypto.randomUUID()}`;
    try {
      await checks.seed(name);
      await checks.upgrade(name);
      await checks.saveNewSentinel(name);
      const before = await checks.read(name, 10);
      await checks.upgrade(name);
      const after = await checks.read(name, 10);
      return {
        same: JSON.stringify(before) === JSON.stringify(after),
        rows: after.courseActivities.values,
      };
    } finally {
      await checks.cleanup(name);
    }
  });
  expect(result).toEqual({ same: true, rows: [{ currentCourseData: true }] });
});

test('unknown layouts and an unchanged generation abort without clearing the legacy records', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const checks = window.c6LearningChecks,
      prefix = `c-viz-c6-check.${crypto.randomUUID()}`;
    const output: unknown[] = [];
    for (const kind of ['layout', 'generation']) {
      const name = `${prefix}.${kind}`;
      try {
        await checks.seed(name, { unknownStore: kind === 'layout' });
        const before = await checks.read(name, 9);
        const code = await checks
          .upgrade(name, kind === 'generation' ? checks.oldGeneration : crypto.randomUUID())
          .then(
            () => 'unexpected',
            (e: { code: string }) => e.code,
          );
        output.push({
          code,
          same: JSON.stringify(before) === JSON.stringify(await checks.read(name, 9)),
        });
      } finally {
        await checks.cleanup(name);
      }
    }
    return output;
  });
  expect(result).toEqual([
    { code: 'S_MIGRATION_UNSUPPORTED', same: true },
    { code: 'S_GENERATION_STALE', same: true },
  ]);
});

test('the native versionchange closes an old connection and a DB9 reopen cannot write after DB10 activation', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const checks = window.c6LearningChecks,
      name = `c-viz-c6-check.${crypto.randomUUID()}`;
    try {
      await checks.seed(name);
      await checks.holdOldConnection(name);
      await checks.upgrade(name);
      const oldCanWrite = checks.oldConnectionCanWrite(name);
      const reopen = await checks.read(name, 9).then(
        () => 'unexpected',
        (e: DOMException) => e.name,
      );
      return { oldCanWrite, reopen };
    } finally {
      await checks.cleanup(name);
    }
  });
  expect(result).toEqual({ oldCanWrite: false, reopen: 'VersionError' });
});

test('new empty databases and each supported historical physical layout become the 19-store active layout', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const checks = window.c6LearningChecks,
      output: number[] = [];
    for (let version = 0; version <= 9; ++version) {
      const name = `c-viz-c6-check.${crypto.randomUUID()}`;
      try {
        if (version) await checks.seed(name, { version });
        await checks.upgrade(name);
        output.push(Object.keys(await checks.read(name, 10)).length);
      } finally {
        await checks.cleanup(name);
      }
    }
    return output;
  });
  expect(result).toEqual(Array(10).fill(19));
});

test('the actual StorageClient activates DB10 and retains its active catalog after explicit clear', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const checks = window.c6LearningChecks,
      name = `c-viz-c6-check.${crypto.randomUUID()}`;
    try {
      await checks.seed(name);
      const first = await checks.openCurrent(name);
      await checks.saveCurrentDraft(name);
      const repeated = await checks.openCurrent(name);
      const before = await checks.read(name, 10);
      const cleared = await checks.openCurrent(name, true);
      const after = await checks.read(name, 10);
      return {
        first: first.meta,
        repeated: repeated.meta,
        preserved: before.courseDrafts.values,
        cleared: cleared.meta,
        empty: after.courseDrafts.values,
        defaultTheme: cleared.settings.theme,
      };
    } finally {
      await checks.cleanup(name);
    }
  });
  expect(result.first.dbVersion).toBe(10);
  expect(result.first.generation).toBe(result.repeated.generation);
  expect(result.preserved).toHaveLength(1);
  expect(result.preserved[0]).toMatchObject({
    draftVersion: '2.0.0',
    source: 'native current invalid draft',
  });
  expect(result.cleared.schemaVersion).toBe('10.0.0');
  expect(result.cleared.activePackageRef).toEqual({ id: 'content.c.primer6', version: '2.0.0' });
  expect(result.cleared.generation).not.toBe(result.first.generation);
  expect(result.empty).toEqual([]);
  expect(result.defaultTheme).toBe('light');
});

test('unknown future course rows stay read-only and cannot be cleared; known-format corruption can be explicitly cleared', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const checks = window.c6LearningChecks,
      names = [false, true].map(() => `c-viz-c6-check.${crypto.randomUUID()}`);
    try {
      const known = await checks.damagedCourseRecovery(names[0], false),
        future = await checks.damagedCourseRecovery(names[1], true);
      const retained = (await checks.read(names[1], 10)).courseDrafts.values;
      return { known, future, retained };
    } finally {
      for (const name of names) await checks.cleanup(name);
    }
  });
  expect(result.known).toMatchObject({
    writable: false,
    canClear: true,
    errorCode: 'S_RECORD_INVALID',
    snapshot: null,
    clear: '10.0.0',
  });
  expect(result.future).toMatchObject({
    writable: false,
    canClear: false,
    errorCode: 'S_VERSION_UNKNOWN',
    snapshot: null,
    clear: 'S_VERSION_UNKNOWN',
    write: 'S_VERSION_UNKNOWN',
  });
  expect(result.retained).toHaveLength(1);
  expect(result.retained[0]).toMatchObject({
    draftVersion: '3.0.0',
    futurePayload: 'must remain until supported',
  });
});

test('actual Rust proofs, reading, group reward and invalid drafts persist atomically; forged/stale evidence and CAS conflicts fail', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const name = `c-viz-c6-check.${crypto.randomUUID()}`;
    try {
      return await window.c6LearningChecks.courseFlow(name);
    } finally {
      await window.c6LearningChecks.cleanup(name);
    }
  });
  const beforeLesson = result.before.activities.find((a) => a.kind === 'lesson');
  const afterLesson = result.after.activities.find((a) => a.kind === 'lesson');
  expect(beforeLesson?.kind === 'lesson' && beforeLesson.completedAt).toBeTruthy();
  const { revision: beforeRevision, lastEventId: beforeEvent, ...beforeContent } = beforeLesson!;
  const { revision: afterRevision, lastEventId: afterEvent, ...afterContent } = afterLesson!;
  expect(afterContent).toEqual(beforeContent);
  // A later genuine pass can update tracking metadata after automatic reading
  // already completed this lesson. The completed content and dates stay fixed.
  expect(afterRevision).toBe(beforeRevision + (afterEvent === beforeEvent ? 0 : 1));
  expect(result.receiptIds).toContain(beforeEvent);
  expect(result.receiptIds).toContain(afterEvent);
  expect(afterLesson?.kind === 'lesson' && afterLesson.completedAt).toBeTruthy();
  const exercise = result.after.activities.find((a) => a.kind === 'exercise');
  expect(exercise?.kind === 'exercise' && exercise.firstPass?.caseKeys).toEqual([
    'case-1',
    'case-2',
    'case-3',
    'case-4',
  ]);
  expect(result.after.drafts[0].source).toBe('int main( { invalid draft\n');
  expect(result.ledger.map((l) => l.sourceId)).toEqual(['reward.exercise.first-pass']);
  expect(result.receiptCount).toBe(2);
  expect(result.proof?.resultSha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(result.first.replayed).toBe(false);
  expect(result.replay.replayed).toBe(true);
  expect(result.forged).toBe('S_CONTENT_INCOMPATIBLE');
  expect(result.conflict).toBe('S_REVISION_CONFLICT');
  expect(result.rollback).toBe('S_RECORD_INVALID');
  expect(result.rollbackRevision).toBe(result.savedRevision);
  expect(result.invalidated).toBe('S_GENERATION_STALE');
  expect(result.staleFact).toBe('S_GENERATION_STALE');
});

test('64 complete 32KiB drafts keep the 2MiB boundary, reject excess atomically and can free one slot without losing current data', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const name = `c-viz-c6-check.${crypto.randomUUID()}`;
    try {
      return await window.c6LearningChecks.draftQuota(name);
    } finally {
      await window.c6LearningChecks.cleanup(name);
    }
  });
  expect(result).toMatchObject({
    excess: 'S_QUOTA',
    count: 64,
    sourceBytes: 2097152,
    writable: true,
    finalCount: 64,
  });
  expect(result.untouchedRevision).toBe(result.originalRevision);
});
