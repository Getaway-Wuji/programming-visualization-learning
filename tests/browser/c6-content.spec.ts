import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/c6-content-harness.html');
  await page.waitForFunction(() => Boolean(window.c6Content));
});

test('manifest and reference B load lazily, with no teaching identities or rewards', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/content/c/primer6/')) requests.push(request.url());
  });
  const result = await page.evaluate(async () => {
    const r = window.c6Content.repository;
    const manifest = await r.loadManifest();
    const before = r.getSnapshot().loadedChunkIds;
    const b = await r.loadChunk('chB');
    await r.loadChunk('chB');
    return {
      manifest: manifest.counts.lessons,
      before,
      loaded: r.getSnapshot().loadedChunkIds,
      nodes: b.nodes.length,
      lessons: b.lessons.length,
      activities: b.activities.length,
      knowledge: b.knowledge.length,
      reference: b.nodes.every(
        (n) => n.area === 'reference' && n.lessonRef === null && n.activityRefs.length === 0,
      ),
      compatibility: b.compatibility,
    };
  });
  expect(result).toEqual({
    manifest: 404,
    before: [],
    loaded: ['chB'],
    nodes: 93,
    lessons: 0,
    activities: 0,
    knowledge: 0,
    reference: true,
    compatibility: null,
  });
  expect(requests).toHaveLength(2);
});

test('all actual HTTP chunks pass complete closure without writing learning storage', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const before = {
      local: { ...localStorage },
      session: { ...sessionStorage },
      db: await indexedDB.databases(),
    };
    const r = window.c6Content.repository;
    const manifest = await r.loadManifest();
    const chunks = [];
    for (const entry of manifest.chunks) chunks.push(await r.loadChunk(entry.id));
    const closure = await window.c6Content.validate(manifest, chunks);
    const after = {
      local: { ...localStorage },
      session: { ...sessionStorage },
      db: await indexedDB.databases(),
    };
    return {
      closure,
      unchanged: JSON.stringify(before) === JSON.stringify(after),
      loaded: r.getSnapshot().loadedChunkIds.length,
    };
  });
  expect(result).toEqual({
    closure: {
      nodes: 650,
      lessons: 404,
      activities: 793,
      examples: 232,
      exercises: 44,
      knowledge: 421,
      referenceOnlyB: true,
    },
    unchanged: true,
    loaded: 19,
  });
});

test('complete multi-file reading programs remain present and explicitly unexecuted', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const r = window.c6Content.repository;
    const chapter = await r.loadChunk('ch17');
    return {
      count: chapter.examples.length,
      reading: chapter.examples.every(
        (e) => e.mode === 'reading-only' && e.verification.kind === 'reading-not-executed',
      ),
      bundles: chapter.examples.filter(
        (e) => e.mode === 'reading-only' && (e.companionFiles?.length ?? 0) > 0,
      ).length,
    };
  });
  expect(result.count).toBe(12);
  expect(result.reading).toBe(true);
  expect(result.bundles).toBeGreaterThan(0);
});

test('one caller cancelling does not abort another real fetch', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const r = window.c6Content.repository;
    await r.loadManifest();
    const controller = new AbortController();
    const cancelled = r.loadChunk('ch01', controller.signal).then(
      () => 'unexpected',
      (e: { code: string }) => e.code,
    );
    const other = r.loadChunk('ch02');
    controller.abort();
    return {
      cancelled: await cancelled,
      other: (await other).chunkId,
      loaded: r.getSnapshot().loadedChunkIds,
    };
  });
  expect(result.cancelled).toBe('C6_CONTENT_CANCELLED');
  expect(result.other).toBe('ch02');
  expect(result.loaded).toEqual(['ch02']);
});

test('reset cancels old generation and permits a fresh real request', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const r = window.c6Content.repository;
    await r.loadManifest();
    const old = r.loadChunk('ch03').then(
      () => 'unexpected',
      (e: { code: string }) => e.code,
    );
    r.reset();
    const empty = r.getSnapshot();
    const fresh = await r.loadChunk('ch03');
    return {
      old: await old,
      generation: empty.generation,
      empty: empty.loadedChunkIds,
      manifest: empty.manifest,
      fresh: fresh.chunkId,
      loaded: r.getSnapshot().loadedChunkIds,
    };
  });
  expect(result).toEqual({
    old: 'C6_CONTENT_CANCELLED',
    generation: 1,
    empty: [],
    manifest: null,
    fresh: 'ch03',
    loaded: ['ch03'],
  });
});

test('HTTP failure preserves a prior verified chunk and supports retry', async ({ page }) => {
  const file = await page.evaluate(async () => {
    const r = window.c6Content.repository;
    await r.loadChunk('ch01');
    return (await r.loadManifest()).chunks.find((entry) => entry.id === 'ch02')!.file;
  });
  await page.route(`**/${file}`, (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  expect(
    await page.evaluate(async () =>
      window.c6Content.repository.loadChunk('ch02').then(
        () => 'unexpected',
        (e: { code: string }) => e.code,
      ),
    ),
  ).toBe('C6_CONTENT_LOAD_FAILED');
  expect(
    await page.evaluate(() => window.c6Content.repository.getSnapshot().loadedChunkIds),
  ).toEqual(['ch01']);
  await page.unroute(`**/${file}`);
  expect(
    await page.evaluate(async () => (await window.c6Content.repository.loadChunk('ch02')).chunkId),
  ).toBe('ch02');
});

test('a changed HTTP chunk fails hash validation before entering cache', async ({ page }) => {
  const file = await page.evaluate(
    async () => (await window.c6Content.repository.loadManifest()).chunks[0].file,
  );
  await page.route(`**/${file}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).slice(0, -1) + ' ' });
  });
  expect(
    await page.evaluate(async () =>
      window.c6Content.repository.loadChunk('ch01').then(
        () => 'unexpected',
        (e: { code: string }) => e.code,
      ),
    ),
  ).toBe('C6_CONTENT_HASH');
  expect(
    await page.evaluate(() => window.c6Content.repository.getSnapshot().loadedChunkIds),
  ).toEqual([]);
});

test('HTTP redirects cannot replace pinned same-origin content', async ({ page }) => {
  const file = await page.evaluate(
    async () => (await window.c6Content.repository.loadManifest()).chunks[0].file,
  );
  await page.route(`**/${file}`, (route) =>
    route.fulfill({ status: 302, headers: { location: '/other.json' } }),
  );
  expect(
    await page.evaluate(async () =>
      window.c6Content.repository.loadChunk('ch01').then(
        () => 'unexpected',
        (e: { code: string }) => e.code,
      ),
    ),
  ).toBe('C6_CONTENT_LOAD_FAILED');
  expect(
    await page.evaluate(() => window.c6Content.repository.getSnapshot().loadedChunkIds),
  ).toEqual([]);
});
