import type { C6LearningCommand } from '../../web/src/c6-learning/model';
import {
  C6_RESET_PRIOR_STORES,
  C6_RESET_STORES,
  createC6ResetMeta,
  queueC6ResetUpgrade,
} from '../../web/src/storage/c6-reset';
import { defaultAppearance, defaultAvatar, defaultSettings } from '../../web/src/storage/model';
import { createC6TeachingRepository } from '../../web/src/content/c6-teaching-repository';
import { loadC6LearningIndex } from '../../web/src/c6-learning';
import { createC6StorageActivation } from '../../web/src/storage/c6-activation';
import { openStorage } from '../../web/src/storage/client';
import { C6ExecutionClient, acceptedC6Proof } from '../../web/src/engine/c6-client';
import { createC6CourseAuthority } from '../../web/src/c6-learning/authority';
import { prepareC6Event } from '../../web/src/c6-learning/recipe';
import type { C6CourseDraft } from '../../web/src/c6-learning/model';

import { localDateAt } from '../../web/src/storage/validation';

const oldGeneration = '00000000-0000-4000-8000-000000000001';
const held = new Map<string, IDBDatabase>();
function nameAllowed(name: string) {
  if (!/^c-viz-c6-check\.[a-z0-9.-]+$/u.test(name)) throw Error('test database name required');
}
function open(
  name: string,
  version: number,
  upgrade?: (
    db: IDBDatabase,
    tx: IDBTransaction,
    oldVersion: number,
    fail: (e: unknown) => void,
  ) => void,
): Promise<IDBDatabase> {
  nameAllowed(name);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    let failure: unknown;
    request.onupgradeneeded = (event) =>
      upgrade?.(request.result, request.transaction!, event.oldVersion, (e) => {
        failure = e;
      });
    request.onerror = () => reject(failure ?? request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
const checks = {
  oldGeneration,
  async blockedReset(name: string) {
    nameAllowed(name);
    await checks.seed(name);
    const repository = createC6TeachingRepository();
    const index = await loadC6LearningIndex(await repository.loadManifest());
    const c6Activation = createC6StorageActivation(index);
    const blocker = await open(name, 9);
    let blocked = '';
    try {
      await openStorage({ name, activePackageRef: index.packageRef, c6Activation });
    } catch (error) {
      blocked = (error as { code: string }).code;
    }
    const beforeVersion = blocker.version;
    blocker.close();
    const unchanged = await open(name, 9);
    const afterCancelVersion = unchanged.version;
    unchanged.close();
    const client = await openStorage({ name, activePackageRef: index.packageRef, c6Activation });
    try {
      const state = await client.readC6Course();
      return {
        blocked,
        beforeVersion,
        afterCancelVersion,
        generation: state.snapshot.meta.generation,
        progress: state.snapshot.progress,
      };
    } finally {
      client.close();
    }
  },
  async seed(
    name: string,
    options: { version?: number; badPreference?: boolean; unknownStore?: boolean } = {},
  ) {
    const version = options.version ?? 9;
    const lengths = [0, 9, 11, 12, 13, 14, 15, 15, 16, 17];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    canvas.getContext('2d')!.fillRect(0, 0, 1, 1);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), 'image/png'),
    );
    const db = await open(name, version, (db, tx) => {
      const names = C6_RESET_PRIOR_STORES.slice(0, lengths[version]);
      for (const store of names) db.createObjectStore(store);
      if (options.unknownStore) db.createObjectStore('unknownFutureStore');
      tx.objectStore('meta').add(
        {
          schemaVersion: `${version}.0.0`,
          dbVersion: version,
          generation: oldGeneration,
          revision: 8,
          timeZone: 'Asia/Shanghai',
          createdAt: '2026-11-01T00:00:00.000Z',
          activePackageRef: { id: 'content.c.p05', version: '1.0.0' },
        },
        'current',
      );
      tx.objectStore('settings').add(
        {
          ...defaultSettings(),
          theme: options.badPreference ? 'unknown' : 'dark',
          playbackRate: 2,
          goalTemplate: { revision: 1, targets: { exercise: 1, lesson: 1, case: 0 } },
        },
        'current',
      );
      tx.objectStore('avatar').add({ ...defaultAvatar(), accentColor: '#123456' }, 'current');
      if (names.includes('appearance')) {
        const appearance = defaultAppearance();
        appearance.preset = 'soft';
        appearance.background = { ...appearance.background, visible: true, assetId: 'background' };
        tx.objectStore('appearance').add(appearance, 'current');
        tx.objectStore('appearanceAssets').add(
          {
            assetId: 'background',
            mimeType: 'image/png',
            byteLength: blob.size,
            width: 1,
            height: 1,
            blob,
          },
          [oldGeneration, 'background'],
        );
      }
      for (const store of names)
        if (!['meta', 'settings', 'avatar', 'appearance', 'appearanceAssets'].includes(store))
          tx.objectStore(store).add({ oldLearningData: true, source: 'unusable legacy payload' }, [
            oldGeneration,
            'old',
          ]);
    });
    db.close();
    const blobSha = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    return { blobBytes: blob.size, blobSha };
  },
  async upgrade(name: string, generation: string = crypto.randomUUID()) {
    const meta = createC6ResetMeta(generation, 'Asia/Shanghai', new Date().toISOString());
    const db = await open(name, 10, (db, tx, oldVersion, fail) =>
      queueC6ResetUpgrade(db, tx, oldVersion, meta, fail),
    );
    db.close();
    return generation;
  },
  async read(name: string, version: number) {
    const db = await open(name, version);
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readonly');
    const done = complete(tx);
    const records: Record<string, { values: unknown[]; keys: IDBValidKey[] }> = {};
    for (const name of names) {
      const values = tx.objectStore(name).getAll(),
        keys = tx.objectStore(name).getAllKeys();
      records[name] = { values: [], keys: [] };
      values.onsuccess = () => {
        records[name].values = values.result;
      };
      keys.onsuccess = () => {
        records[name].keys = keys.result;
      };
    }
    await done;
    db.close();
    return records;
  },
  async repairPreference(name: string) {
    const db = await open(name, 9),
      tx = db.transaction('settings', 'readwrite');
    const done = complete(tx);
    tx.objectStore('settings').put({ ...defaultSettings(), theme: 'dark' }, 'current');
    await done;
    db.close();
  },
  async saveNewSentinel(name: string) {
    const db = await open(name, 10),
      tx = db.transaction('courseActivities', 'readwrite');
    const done = complete(tx);
    tx.objectStore('courseActivities').add({ currentCourseData: true }, 'new-data');
    await done;
    db.close();
  },
  async holdOldConnection(name: string) {
    const db = await open(name, 9);
    held.set(name, db);
    db.onversionchange = () => db.close();
  },
  oldConnectionCanWrite(name: string) {
    try {
      held.get(name)!.transaction('progress', 'readwrite');
      return true;
    } catch {
      return false;
    }
  },
  async cleanup(name: string) {
    nameAllowed(name);
    held.get(name)?.close();
    held.delete(name);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },
  stores: C6_RESET_STORES,
  async openCurrent(name: string, clear = false) {
    nameAllowed(name);
    const manifest = await createC6TeachingRepository().loadManifest();
    const index = await loadC6LearningIndex(manifest);
    const client = await openStorage({
      name,
      activePackageRef: index.packageRef,
      c6Activation: createC6StorageActivation(index),
      timeZone: 'Asia/Shanghai',
      recovery: true,
    });
    try {
      if (clear) return await client.clear((await client.readRecovery()).guard);
      return await client.read();
    } finally {
      client.close();
    }
  },
  async saveCurrentDraft(name: string) {
    nameAllowed(name);
    const index = await loadC6LearningIndex(await createC6TeachingRepository().loadManifest());
    const client = await openStorage({
      name,
      activePackageRef: index.packageRef,
      c6Activation: createC6StorageActivation(index),
      recovery: true,
    });
    try {
      const current = await client.readC6Course();
      await client.commitC6Course(
        current.snapshot.meta.generation,
        current.snapshot.meta.revision,
        () => ({
          operations: [],
          draft: {
            draftVersion: '2.0.0',
            generation: current.snapshot.meta.generation,
            documentId: 'draft.c6.native-new',
            nodeRef: { id: index.lessons[0][1], version: '2.0.0' },
            exerciseRef: null,
            sourceRevision: crypto.randomUUID(),
            source: 'native current invalid draft',
            input: '',
            revision: current.snapshot.meta.revision + 1,
            updatedAt: new Date().toISOString(),
          },
        }),
      );
    } finally {
      client.close();
    }
  },
  async damagedCourseRecovery(name: string, future: boolean) {
    nameAllowed(name);
    const index = await loadC6LearningIndex(await createC6TeachingRepository().loadManifest());
    const activation = createC6StorageActivation(index);
    const first = await openStorage({
      name,
      activePackageRef: index.packageRef,
      c6Activation: activation,
      recovery: true,
    });
    const generation = (await first.readC6Course()).snapshot.meta.generation;
    first.close();
    const db = await open(name, 10),
      tx = db.transaction('courseDrafts', 'readwrite'),
      done = complete(tx);
    tx.objectStore('courseDrafts').put(
      {
        draftVersion: future ? '3.0.0' : '2.0.0',
        generation,
        documentId: 'draft.c6.damaged',
        futurePayload: 'must remain until supported',
      },
      [generation, 'draft.c6.damaged'],
    );
    await done;
    db.close();
    const client = await openStorage({
      name,
      activePackageRef: index.packageRef,
      c6Activation: activation,
      recovery: true,
    });
    try {
      const recovery = await client.readRecovery();
      let write: unknown;
      try {
        await client.commit(generation, () => []);
        write = 'unexpected-write';
      } catch (error) {
        write = error && typeof error === 'object' && 'code' in error ? error.code : String(error);
      }
      let clear: unknown;
      try {
        clear = (await client.clear(recovery.guard)).meta.schemaVersion;
      } catch (error) {
        clear = error && typeof error === 'object' && 'code' in error ? error.code : String(error);
      }
      return {
        writable: recovery.writable,
        canClear: recovery.canClear,
        errorCode: recovery.errorCode,
        snapshot: recovery.snapshot,
        clear,
        write,
      };
    } finally {
      client.close();
    }
  },
  async draftQuota(name: string) {
    nameAllowed(name);
    const index = await loadC6LearningIndex(await createC6TeachingRepository().loadManifest());
    const client = await openStorage({
      name,
      activePackageRef: index.packageRef,
      c6Activation: createC6StorageActivation(index),
      recovery: true,
    });
    try {
      let state = await client.readC6Course();
      const generation = state.snapshot.meta.generation,
        at = new Date().toISOString();
      const draft = (id: string, revision: number): C6CourseDraft => ({
        draftVersion: '2.0.0',
        generation,
        documentId: id,
        nodeRef: { id: index.lessons[0][1], version: '2.0.0' },
        exerciseRef: null,
        sourceRevision: crypto.randomUUID(),
        source: 'x'.repeat(32768),
        input: '',
        revision,
        updatedAt: at,
      });
      for (let i = 0; i < 64; ++i) {
        await client.commitC6Course(generation, state.snapshot.meta.revision, () => ({
          operations: [],
          draft: draft(`draft.c6.quota.${i}`, state.snapshot.meta.revision + 1),
        }));
        state = await client.readC6Course();
      }
      const revision = state.snapshot.meta.revision;
      let excess: unknown;
      try {
        await client.commitC6Course(generation, revision, () => ({
          operations: [],
          draft: draft('draft.c6.quota.extra', revision + 1),
        }));
      } catch (error) {
        excess = error && typeof error === 'object' && 'code' in error ? error.code : String(error);
      }
      const untouched = await client.readC6Course(),
        recovery = await client.readRecovery();
      await client.commitC6Course(generation, revision, () => ({
        operations: [],
        deleteDraftId: 'draft.c6.quota.0',
      }));
      state = await client.readC6Course();
      await client.commitC6Course(generation, state.snapshot.meta.revision, () => ({
        operations: [],
        draft: draft('draft.c6.quota.extra', state.snapshot.meta.revision + 1),
      }));
      const final = await client.readC6Course();
      return {
        excess,
        count: untouched.rows.drafts.length,
        sourceBytes: untouched.rows.drafts.reduce(
          (n, d) => n + new TextEncoder().encode(d.source).length,
          0,
        ),
        originalRevision: revision,
        untouchedRevision: untouched.snapshot.meta.revision,
        writable: recovery.writable,
        finalCount: final.rows.drafts.length,
      };
    } finally {
      client.close();
    }
  },
  async courseFlow(name: string) {
    nameAllowed(name);
    const repository = createC6TeachingRepository();
    const index = await loadC6LearningIndex(await repository.loadManifest());
    const activation = createC6StorageActivation(index);
    const storage = await openStorage({
      name,
      activePackageRef: index.packageRef,
      c6Activation: activation,
    });
    const engine = new C6ExecutionClient();
    let state = await storage.readC6Course(),
      epoch = 0;
    const generation = state.snapshot.meta.generation;
    const authority = createC6CourseAuthority(index, () => ({ generation, epoch }));
    const exercise = index.exercises[0],
      lessonId = exercise[2];
    const content = await repository.loadEntity({ id: exercise[0], version: '2.0.0' }, 'exercises');
    if (!('referenceSource' in content)) throw Error('exercise required');
    const at = new Date().toISOString(),
      date = localDateAt(at, state.snapshot.meta.timeZone);
    const command = (
      subjectId: string,
      eventType: 'lesson.study-confirmed' | 'exercise.passed',
      eventId: string = crypto.randomUUID(),
    ): C6LearningCommand =>
      ({
        learnVersion: '2.0.0',
        generation,
        receipt: {
          eventId,
          eventType,
          subjectRef: { id: subjectId, version: '2.0.0' },
          packageRef: index.packageRef,
          learningRevision: 1,
          result: eventType === 'exercise.passed' ? 'passed' : 'confirmed',
          occurredAt: at,
          localDate: date,
          goalVersion: 1,
        },
      }) as C6LearningCommand;
    const code = (error: unknown) =>
      error && typeof error === 'object' && 'code' in error ? error.code : String(error);
    try {
      await storage.commitC6Course(generation, state.snapshot.meta.revision, () => ({
        operations: [
          {
            store: 'goals',
            mode: 'add',
            value: {
              localDate: date,
              goalVersion: 1,
              targets: null,
              achievedAt: null,
            },
          },
        ],
      }));
      state = await storage.readC6Course();
      const readCommand = command(lessonId, 'lesson.study-confirmed');
      await storage.commitC6Course(generation, state.snapshot.meta.revision, (s) =>
        prepareC6Event(s, readCommand, index, null),
      );
      const before = await storage.readC6Course();
      const run = await authority.begin(exercise[0], content.referenceSource, crypto.randomUUID());
      const result = await engine.execute(run.request);
      let forged: unknown;
      try {
        authority.accept(run.lease, structuredClone(result), at);
      } catch (error) {
        forged = code(error);
      }
      const proof = acceptedC6Proof(result);
      const fact = authority.accept(run.lease, result, at);
      const accepted = authority.read(fact);
      const passCommand = command(exercise[0], 'exercise.passed', accepted.attempt.eventId);
      const first = await storage.commitC6Course(generation, before.snapshot.meta.revision, (s) =>
        prepareC6Event(s, passCommand, index, accepted.attempt),
      );
      state = await storage.readC6Course();
      const replay = await storage.commitC6Course(generation, state.snapshot.meta.revision, (s) =>
        prepareC6Event(s, passCommand, index, accepted.attempt),
      );
      const draft: C6CourseDraft = {
        draftVersion: '2.0.0',
        generation,
        documentId: 'draft.c6.browser',
        nodeRef: { id: exercise[1], version: '2.0.0' },
        exerciseRef: { id: exercise[0], version: '2.0.0' },
        source: 'int main( { invalid draft\n',
        sourceRevision: crypto.randomUUID(),
        input: '',
        revision: state.snapshot.meta.revision + 1,
        updatedAt: at,
      };
      await storage.commitC6Course(generation, state.snapshot.meta.revision, () => ({
        operations: [],
        draft,
      }));
      let conflict: unknown;
      try {
        await storage.commitC6Course(generation, state.snapshot.meta.revision, () => ({
          operations: [],
          draft,
        }));
      } catch (error) {
        conflict = code(error);
      }
      state = await storage.readC6Course();
      const savedRevision = state.snapshot.meta.revision;
      let rollback: unknown;
      try {
        await storage.commitC6Course(generation, savedRevision, (s) => ({
          operations: [],
          activities: [
            {
              ...s.rows.activities.find((a) => a.kind === 'lesson')!,
              revision: savedRevision + 1,
              readAt: null,
            } as (typeof s.rows.activities)[number],
          ],
        }));
      } catch (error) {
        rollback = code(error);
      }
      const afterRollback = await storage.readC6Course();
      const lateRun = await authority.begin(
        exercise[0],
        content.referenceSource,
        crypto.randomUUID(),
      );
      const lateResult = await engine.execute(lateRun.request);
      authority.invalidate(lateRun.lease);
      let invalidated: unknown;
      try {
        authority.accept(lateRun.lease, lateResult, at);
      } catch (error) {
        invalidated = code(error);
      }
      epoch++;
      let staleFact: unknown;
      try {
        authority.read(fact);
      } catch (error) {
        staleFact = code(error);
      }
      storage.close();
      const reopened = await openStorage({
        name,
        activePackageRef: index.packageRef,
        c6Activation: activation,
      });
      let restored;
      try {
        restored = await reopened.readC6Course();
      } finally {
        reopened.close();
      }
      return {
        before: before.rows,
        after: restored.rows,
        generation: restored.snapshot.meta.generation,
        ledger: restored.snapshot.ledger,
        receiptCount: restored.snapshot.receipts.length,
        proof,
        first,
        replay,
        forged,
        conflict,
        rollback,
        invalidated,
        staleFact,
        rollbackRevision: afterRollback.snapshot.meta.revision,
        savedRevision,
      };
    } finally {
      storage.close();
      engine.invalidate();
    }
  },
};
declare global {
  interface Window {
    c6LearningChecks: typeof checks;
  }
}
window.c6LearningChecks = checks;
