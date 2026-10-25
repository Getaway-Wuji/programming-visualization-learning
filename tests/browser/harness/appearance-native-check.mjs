/* global crypto, indexedDB, IDBObjectStore, DOMException, structuredClone, Blob, console, AbortController, document */
import { chromium, firefox } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';

// Isolated native IndexedDB infrastructure evidence. No C execution is claimed.
const base = process.env.STORAGE_QA_URL ?? 'http://127.0.0.1:5183';
const directory = process.env.STORAGE_QA_OUTPUT ?? '.artifacts/P0.5-02/storage-native';
const fixture = JSON.parse(readFileSync('项目文档/契约/02.3-存档样例.json', 'utf8')).snapshots[1]
  .snapshot;
mkdirSync(directory, { recursive: true });
let failures = 0;
for (const kind of ['chrome', 'edge', 'firefox']) {
  const browser = await (kind === 'firefox' ? firefox : chromium).launch(
    kind === 'firefox' ? {} : { channel: kind === 'edge' ? 'msedge' : 'chrome' },
  );
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  const results = await page.evaluate(
    async ({ fixture }) => {
      const { openStorage } = await import('/src/storage/client.ts');
      const { CORE_STORE_NAMES, STORE_NAMES, defaultAppearance, recordKey } =
        await import('/src/storage/model.ts');
      const outcomes = [];
      const connections = new Set();
      const names = [];
      const ref = { id: 'content.c.p0', version: '1.0.0' };
      const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const assert = (yes, label) => {
        if (!yes) throw new Error(label);
      };
      const named = () => {
        const name = `c-viz-learning.test.appearance.${crypto.randomUUID()}`;
        names.push(name);
        return name;
      };
      const rawOpen = (name, version, upgrade) =>
        new Promise((resolve, reject) => {
          const request =
            version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
          request.onupgradeneeded = () => upgrade?.(request.result, request.transaction);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
          };
        });
      const done = (tx) =>
        new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error ?? new Error('abort'));
          tx.onerror = () => {};
        });
      const seed = async (name, value = fixture, extraIndex = false) => {
        const db = await rawOpen(name, 1, (db, tx) => {
          for (const store of CORE_STORE_NAMES) db.createObjectStore(store);
          if (extraIndex) tx.objectStore('progress').createIndex('unexpected', 'eventType');
          for (const store of CORE_STORE_NAMES) {
            const rows = ['meta', 'settings', 'avatar'].includes(store)
              ? [value[store]]
              : value[store];
            for (const row of rows)
              tx.objectStore(store).put(row, recordKey(store, value.meta.generation, row));
          }
        });
        db.close();
      };
      const dump = async (name) => {
        const db = await rawOpen(name);
        const tx = db.transaction(Array.from(db.objectStoreNames));
        const completion = done(tx);
        const rows = {};
        await Promise.all(
          Array.from(db.objectStoreNames).map(
            (store) =>
              new Promise((resolve) => {
                const values = tx.objectStore(store).getAll();
                const keys = tx.objectStore(store).getAllKeys();
                let left = 2;
                const finish = () => {
                  if (--left === 0) {
                    rows[store] = { keys: keys.result, values: values.result };
                    resolve();
                  }
                };
                values.onsuccess = finish;
                keys.onsuccess = finish;
              }),
          ),
        );
        await completion;
        const result = { version: db.version, rows };
        db.close();
        return result;
      };
      const patch = async (name, store, key, value) => {
        const db = await rawOpen(name);
        const tx = db.transaction(store, 'readwrite');
        const completion = done(tx);
        tx.objectStore(store).put(value, key);
        await completion;
        db.close();
      };
      const open = async (name, recovery = true) => {
        const client = await openStorage({
          name,
          activePackageRef: ref,
          timeZone: 'Asia/Shanghai',
          recovery,
        });
        connections.add(client);
        return client;
      };
      const rejects = async (run, code) => {
        try {
          await run();
        } catch (error) {
          assert(error.code === code, `expected ${code}, got ${error.code ?? error.name}`);
          return;
        }
        throw new Error(`expected rejection ${code}`);
      };
      const test = async (id, body) => {
        try {
          const details = await body();
          outcomes.push({ id, passed: true, details });
        } catch (error) {
          outcomes.push({ id, passed: false, error: error.message });
        }
      };
      const withFault = async (name, store, mode, run) => {
        const prototype = IDBObjectStore.prototype;
        const originalAdd = prototype.add,
          originalPut = prototype.put;
        let used = false;
        const wrap = (original) =>
          function (...args) {
            if (!used && this.name === store && this.transaction.db.name === name) {
              used = true;
              if (mode === 'quota')
                throw new DOMException('Synthetic API quota fault', 'QuotaExceededError');
              const request = original.apply(this, args);
              request.addEventListener('success', () => this.transaction.abort());
              return request;
            }
            return original.apply(this, args);
          };
        prototype.add = wrap(originalAdd);
        prototype.put = wrap(originalPut);
        try {
          await run();
          assert(used, 'fault must reach the actual native write');
        } finally {
          prototype.add = originalAdd;
          prototype.put = originalPut;
        }
      };
      try {
        await test('new-db2-six-themes-defaults', async () => {
          const name = named(),
            client = await open(name),
            state = await client.read(),
            raw = await dump(name);
          assert(
            raw.version === 2 && Object.keys(raw.rows).length === 11,
            'DB2 and eleven physical stores',
          );
          assert(
            state.settings.theme === 'light' && equal(state.appearance, defaultAppearance()),
            'new defaults',
          );
          assert(
            STORE_NAMES.every((store) => raw.rows[store]),
            'all exact stores present',
          );
          return {
            version: raw.version,
            stores: Object.keys(raw.rows),
            preset: state.appearance.preset,
          };
        });
        for (const theme of ['system', 'dark', 'light'])
          await test(`v1-full-upgrade-preserves-${theme}`, async () => {
            const name = named(),
              value = structuredClone(fixture);
            value.settings.theme = theme;
            await seed(name, value);
            const before = await dump(name);
            const client = await open(name);
            const state = await client.read();
            const after = await dump(name);
            for (const store of CORE_STORE_NAMES) {
              if (store === 'meta') continue;
              assert(equal(before.rows[store], after.rows[store]), `unchanged old store ${store}`);
            }
            const meta = {
              ...value.meta,
              schemaVersion: '2.0.0',
              dbVersion: 2,
              revision: value.meta.revision + 1,
            };
            assert(equal(state.meta, meta), 'only three version/revision fields change');
            assert(equal(state.appearance, defaultAppearance()), 'all six null overrides');
            client.close();
            const again = await open(name);
            assert(
              (await again.read()).meta.revision === meta.revision,
              'reopen does not remigrate',
            );
            return { theme, revision: state.meta.revision, oldStoresPreserved: 8 };
          });
        for (const mode of ['abort', 'quota'])
          await test(`upgrade-${mode}-native-rollback`, async () => {
            const name = named();
            await seed(name);
            const before = await dump(name);
            await withFault(name, 'appearance', mode, () =>
              rejects(() => open(name), mode === 'quota' ? 'S_QUOTA' : 'S_ABORTED'),
            );
            assert(
              equal(before, await dump(name)),
              'failed versionchange preserves complete DB1 and keys',
            );
            const client = await open(name);
            assert((await client.read()).meta.dbVersion === 2, 'controlled retry works');
          });
        for (const invalid of ['settings', 'revision', 'version', 'index'])
          await test(`bad-v1-${invalid}-never-overwritten`, async () => {
            const name = named(),
              value = structuredClone(fixture);
            if (invalid === 'settings') value.settings.theme = 'broken';
            if (invalid === 'revision') value.meta.revision = Number.MAX_SAFE_INTEGER;
            if (invalid === 'version') value.meta.schemaVersion = '3.0.0';
            await seed(name, value, invalid === 'index');
            const before = await dump(name);
            await rejects(
              () => open(name),
              invalid === 'version'
                ? 'S_VERSION_UNKNOWN'
                : invalid === 'index'
                  ? 'S_MIGRATION_UNSUPPORTED'
                  : 'S_RECORD_INVALID',
            );
            assert(equal(before, await dump(name)), 'bad predecessor preserved');
          });
        await test('real-v1-upgrade-blocked-cancel-versionchange', async () => {
          const name = named();
          await seed(name);
          const blocker = await rawOpen(name);
          let versionChanges = 0;
          blocker.onversionchange = () => {
            versionChanges++;
          };
          const controller = new AbortController();
          let blocked;
          const observed = new Promise((resolve) => {
            blocked = resolve;
          });
          const pending = openStorage({
            name,
            activePackageRef: ref,
            signal: controller.signal,
            onBlocked: () => blocked(true),
          }).then(
            (client) => {
              client.close();
              return 'unexpected-success';
            },
            (error) => error.code,
          );
          await observed;
          controller.abort();
          assert((await pending) === 'S_ABORTED', 'blocked upgrade cancellation returns aborted');
          assert(versionChanges > 0, 'existing native connection receives versionchange');
          blocker.close();
          const client = await open(name);
          assert(
            (await client.read()).meta.dbVersion === 2,
            'cancelled late open does not leak a blocker',
          );
        });
        await test('native-blob-format-decode-and-damage-isolation', async () => {
          const name = named(),
            client = await open(name),
            state = await client.read();
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          const asset = {
            assetId: 'background',
            mimeType: 'image/png',
            byteLength: blob.size,
            width: 1,
            height: 1,
            blob,
          };
          await patch(name, 'appearanceAssets', [state.meta.generation, 'background'], asset);
          await patch(name, 'appearance', 'current', {
            ...state.appearance,
            background: { ...state.appearance.background, assetId: 'background', visible: true },
          });
          let recovery = await client.readRecovery();
          assert(
            !recovery.appearanceReadOnly && recovery.snapshot.appearanceAssets.length === 1,
            'valid native PNG decodes and remains referenced',
          );
          const beforeOrdinaryWrite = await dump(name);
          await rejects(
            () =>
              client.commit(state.meta.generation, () => [
                { store: 'appearanceAssets', mode: 'put', value: asset },
              ]),
            'S_RECORD_INVALID',
          );
          assert(
            equal(beforeOrdinaryWrite, await dump(name)),
            'ordinary learning mutation cannot write an asset',
          );
          await patch(name, 'appearanceAssets', [state.meta.generation, 'background'], {
            ...asset,
            blob: new Blob(['x'.repeat(blob.size)], { type: 'image/png' }),
          });
          recovery = await client.readRecovery();
          assert(
            recovery.writable &&
              recovery.appearanceReadOnly &&
              recovery.snapshot.appearanceAssets.length === 0,
            'fake MIME and valid metadata cannot disguise bad image bytes',
          );
          assert(
            (await dump(name)).rows.appearanceAssets.values.length === 1,
            'bad original Blob preserved',
          );
        });
        await test('six-colors-switch-noop-cas', async () => {
          const name = named(),
            client = await open(name);
          const ids = ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'];
          const colors = ['#6D28D9', '#DB2777', '#0E7490', '#B45309', '#1D4ED8', '#475569'];
          for (let index = 0; index < ids.length; index++) {
            const state = await client.read(),
              appearance = structuredClone(state.appearance);
            appearance.preset = ids[index];
            appearance.themeOverrides[ids[index]].accentColor = colors[index];
            await client.commitAppearance(
              state.meta.generation,
              () => [{ store: 'appearance', mode: 'put', value: appearance }],
              state.meta.revision,
            );
          }
          let state = await client.read();
          const before = await dump(name);
          for (let index = 0; index < ids.length; index++)
            assert(
              state.appearance.themeOverrides[ids[index]].accentColor === colors[index],
              'independent color',
            );
          await client.commitAppearance(state.meta.generation, () => [], state.meta.revision);
          assert(equal(before, await dump(name)), 'valid no-op has no revision change');
          const stale = state.meta.revision;
          await client.commitAppearance(
            state.meta.generation,
            () => [{ store: 'settings', mode: 'put', value: { ...state.settings, theme: 'dark' } }],
            stale,
          );
          await rejects(
            () => client.commitAppearance(state.meta.generation, () => [], stale),
            'S_REVISION_CONFLICT',
          );
          state = await client.read();
          const appearance = { ...state.appearance, preset: 'cute' };
          await client.commitAppearance(
            state.meta.generation,
            () => [{ store: 'appearance', mode: 'put', value: appearance }],
            state.meta.revision,
          );
          assert((await client.read()).settings.theme === 'dark', 'switch does not force mode');
        });
        await test('appearance-damage-learning-ack-reset-scope', async () => {
          const name = named(),
            client = await open(name),
            initial = await client.read();
          const damaged = { ...initial.appearance, unexpected: 'retain-original' };
          await patch(name, 'appearance', 'current', damaged);
          await patch(name, 'appearanceAssets', ['foreign-generation', 'orphan'], {
            blob: new Blob(['invalid']),
          });
          let recovery = await client.readRecovery();
          assert(
            recovery.writable && recovery.appearanceReadOnly && recovery.appearanceCanReset,
            'visual damage must not disable learning',
          );
          const eventId = crypto.randomUUID(),
            subjectRef = { id: 'exercise.synthetic.appearance', version: '1.0.0' },
            at = '2026-10-24T00:00:00.000Z';
          const receipt = {
            eventId,
            eventType: 'exercise.passed',
            subjectRef,
            packageRef: ref,
            learningRevision: 1,
            result: 'passed',
            goalVersion: 1,
            occurredAt: at,
            localDate: '2026-10-24',
          };
          const saved = await client.commitOnce(
            { generation: initial.meta.generation, receipt },
            () => [
              {
                store: 'progress',
                mode: 'put',
                value: {
                  eventType: 'exercise.passed',
                  result: 'passed',
                  subjectRef,
                  packageRef: ref,
                  learningRevision: 1,
                  firstAt: at,
                  lastAt: at,
                },
              },
              {
                store: 'goals',
                mode: 'add',
                value: { localDate: '2026-10-24', goalVersion: 1, targets: null, achievedAt: null },
              },
            ],
          );
          assert(
            saved.saved && (await client.read()).receipts.length === 1,
            'native learning commit and post-ACK read succeed',
          );
          assert(
            equal((await dump(name)).rows.appearance.values[0], damaged),
            'learning did not rewrite damaged appearance',
          );
          await rejects(
            () => client.commitAppearance(initial.meta.generation, () => [], saved.revision),
            'S_RECORD_INVALID',
          );
          await rejects(
            () => client.resetAppearance(initial.meta.generation, initial.meta.revision),
            'S_REVISION_CONFLICT',
          );
          const before = await dump(name);
          await withFault(name, 'appearance', 'abort', () =>
            rejects(
              () => client.resetAppearance(initial.meta.generation, saved.revision),
              'S_ABORTED',
            ),
          );
          assert(equal(before, await dump(name)), 'reset abort is atomic');
          await client.resetAppearance(initial.meta.generation, saved.revision);
          recovery = await client.readRecovery();
          assert(recovery.writable && !recovery.appearanceReadOnly, 'reset recovered visuals');
          const after = await dump(name);
          for (const store of CORE_STORE_NAMES.filter(
            (name) => name !== 'meta' && name !== 'settings',
          ))
            assert(equal(before.rows[store], after.rows[store]), `reset keeps ${store}`);
          assert(after.rows.appearanceAssets.values.length === 0, 'all orphan resources removed');
          assert(
            equal(recovery.snapshot.appearance, defaultAppearance()),
            'six-theme defaults restored',
          );
        });
        await test('clear-atomic-new-generation-stale-writer', async () => {
          const name = named(),
            client = await open(name),
            initial = await client.read();
          let recovery = await client.readRecovery();
          const before = await dump(name);
          await withFault(name, 'appearance', 'abort', () =>
            rejects(() => client.clear(recovery.guard), 'S_ABORTED'),
          );
          assert(equal(before, await dump(name)), 'clear abort keeps previous archive');
          recovery = await client.readRecovery();
          const cleared = await client.clear(recovery.guard);
          assert(
            cleared.meta.generation !== initial.meta.generation && cleared.meta.revision === 0,
            'rotate generation',
          );
          assert(
            cleared.settings.theme === 'light' && equal(cleared.appearance, defaultAppearance()),
            'new defaults after clear',
          );
          await rejects(
            () => client.commit(initial.meta.generation, () => []),
            'S_GENERATION_STALE',
          );
        });
        await test('unknown-db2-semantic-and-future-physical-protected', async () => {
          const name = named(),
            client = await open(name),
            initial = await client.read();
          await patch(name, 'meta', 'current', { ...initial.meta, schemaVersion: '3.0.0' });
          let before = await dump(name),
            recovery = await client.readRecovery();
          assert(
            !recovery.writable && !recovery.canClear && !recovery.appearanceCanReset,
            'unknown semantic refuses all writes/clear',
          );
          await rejects(() => client.clear(recovery.guard), 'S_VERSION_UNKNOWN');
          await rejects(
            () => client.resetAppearance(initial.meta.generation, initial.meta.revision),
            'S_VERSION_UNKNOWN',
          );
          assert(equal(before, await dump(name)), 'unknown semantic untouched');
          await patch(name, 'meta', 'current', initial.meta);
          client.close();
          const future = await rawOpen(name, 3);
          future.close();
          before = await dump(name);
          await rejects(() => open(name), 'S_VERSION_UNKNOWN');
          assert(equal(before, await dump(name)), 'physical future untouched, never downgrade');
        });
      } finally {
        for (const client of connections) client.close();
        for (const name of names)
          await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('test connection leaked'));
          });
      }
      return outcomes;
    },
    { fixture },
  );
  // Two actual browser pages, notifications deliberately absent for isolated DBs.
  const peer = await context.newPage();
  await peer.goto(base);
  const name = `c-viz-learning.test.peer.${crypto.randomUUID()}`;
  try {
    const state = await page.evaluate(async (name) => {
      const { openStorage } = await import('/src/storage/client.ts');
      const client = await openStorage({
        name,
        activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
      });
      try {
        return await client.read();
      } finally {
        client.close();
      }
    }, name);
    await peer.evaluate(
      async ({ name, state }) => {
        const { openStorage } = await import('/src/storage/client.ts');
        const client = await openStorage({
          name,
          activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
        });
        try {
          const appearance = structuredClone(state.appearance);
          appearance.themeOverrides.cute.accentColor = '#DB2777';
          await client.commitAppearance(
            state.meta.generation,
            () => [{ store: 'appearance', mode: 'put', value: appearance }],
            state.meta.revision,
          );
        } finally {
          client.close();
        }
      },
      { name, state },
    );
    const code = await page.evaluate(
      async ({ name, state }) => {
        const { openStorage } = await import('/src/storage/client.ts');
        const client = await openStorage({
          name,
          activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
        });
        try {
          await client.commitAppearance(state.meta.generation, () => [], state.meta.revision);
          return 'unexpected-success';
        } catch (error) {
          return error.code;
        } finally {
          client.close();
        }
      },
      { name, state },
    );
    results.push({
      id: 'actual-two-page-cas-without-notifications',
      passed: code === 'S_REVISION_CONFLICT',
      code,
    });
  } catch (error) {
    results.push({
      id: 'actual-two-page-cas-without-notifications',
      passed: false,
      error: error.message,
    });
  }
  const report = {
    browser: kind,
    evidenceKind:
      'native isolated IndexedDB, synthetic infrastructure fixtures; no C execution claim',
    results,
  };
  writeFileSync(`${directory}/${kind}.json`, JSON.stringify(report, null, 2));
  console.log(`${kind}: ${results.filter((result) => result.passed).length}/${results.length}`);
  failures += results.filter((result) => !result.passed).length;
  await context.close();
  await browser.close();
}
process.exitCode = failures ? 1 : 0;
