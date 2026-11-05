import { chromium, expect, test, type Page } from '@playwright/test';

async function physical(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = [...db.objectStoreNames];
      const tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const stores = await Promise.all(
        names.map(async (name) => {
          const store = tx.objectStore(name);
          const keys = read(store.getAllKeys());
          const values = read(store.getAll());
          return {
            name,
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
            indexes: [...store.indexNames].map((indexName) => {
              const index = store.index(indexName);
              return {
                name: indexName,
                keyPath: index.keyPath,
                unique: index.unique,
                multiEntry: index.multiEntry,
              };
            }),
            keys: await keys,
            values: await values,
          };
        }),
      );
      await done;
      return { version: db.version, stores };
    } finally {
      db.close();
    }
  });
}

/** Generate genuine legacy evidence on its supported Chrome runtime. The
 * target Firefox still performs every migration/reset and fresh C6 operation.
 * No receipts are synthesized and no immutable historical artifact is edited.
 */
export async function archivedPredecessor(page: Page, setup: (page: Page) => Promise<void>) {
  if (test.info().project.use.browserName !== 'firefox') return setup(page);
  const baseURL = test.info().project.use.baseURL!;
  const browser = await chromium.launch({ channel: 'chrome' });
  let archive: Awaited<ReturnType<typeof physical>>;
  let finalURL: string;
  try {
    const context = await browser.newContext({
      baseURL,
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1440, height: 900 },
    });
    const producer = await context.newPage();
    await producer.clock.setFixedTime(new Date('2026-10-31T04:00:00.000Z'));
    await setup(producer);
    archive = await physical(producer);
    finalURL = producer.url();
  } finally {
    await browser.close();
  }
  test.info().annotations.push({
    type: 'genuine-legacy-chrome-archive',
    description:
      'Immutable predecessors predate Firefox support. Normal UI actions earn the actual archive in Chrome; every original physical partition is copied unchanged into Firefox before its real upgrade and current RESET checks.',
  });
  await test.info().attach('genuine-predecessor-physical-archive', {
    body: JSON.stringify(archive),
    contentType: 'application/json',
  });
  expect(archive.stores.every((store) => !store.autoIncrement)).toBe(true);
  const seedURL = new URL('/__migration-predecessor.html', baseURL).href;
  await page.route(seedURL, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Historical archive setup</title>',
    }),
  );
  try {
    await page.goto(seedURL);
    await page.evaluate<void, unknown>(async (raw) => {
      const snapshot = raw as Awaited<ReturnType<typeof physical>>;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning', snapshot.version);
        request.onupgradeneeded = () => {
          for (const store of snapshot.stores) {
            const created = request.result.createObjectStore(store.name, {
              keyPath: store.keyPath,
              autoIncrement: store.autoIncrement,
            });
            for (const index of store.indexes)
              created.createIndex(index.name, index.keyPath, {
                unique: index.unique,
                multiEntry: index.multiEntry,
              });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (db.objectStoreNames.length !== snapshot.stores.length)
          throw new Error('Unexpected target archive');
        const tx = db.transaction(
          snapshot.stores.map((store) => store.name),
          'readwrite',
        );
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        for (const store of snapshot.stores) {
          const target = tx.objectStore(store.name);
          for (let i = 0; i < store.values.length; i++) {
            if (store.keyPath === null) target.add(store.values[i], store.keys[i]);
            else target.add(store.values[i]);
          }
        }
        await done;
      } finally {
        db.close();
      }
    }, archive);
    expect(await physical(page)).toEqual(archive);
  } finally {
    await page.unroute(seedURL);
  }
  await page.goto(finalURL);
}
