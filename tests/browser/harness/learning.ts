import { createLearningAuthority, type LearningEvent } from '../../../web/src/learning/authority';
import { createLearningCatalog } from '../../../web/src/learning/catalog';
import { LearningService } from '../../../web/src/learning/service';
import type { LearningCatalog, LearningCommand } from '../../../web/src/learning/types';
import { openStorage } from '../../../web/src/storage/client';
import { type GoalTargets, type StorageSnapshot } from '../../../web/src/storage/model';
import type { HarnessResult } from './storage';

/**
 * Synthetic trusted-adapter checks, kept in the separately built /checks bundle.
 * A publishable-shaped synthetic catalog is never passed to the production app.
 * Persistence uses the browser's real IndexedDB; verifier=true proves no Rust fact.
 */
export type CatalogMode = 'original' | 'compatible' | 'revised' | 'fixture';
export const syntheticIds = {
  lesson: 'lesson.synthetic.basics',
  first: 'exercise.synthetic.first',
  second: 'exercise.synthetic.second',
  case: 'case.synthetic.assignment',
} as const;
export function syntheticCatalog(mode: CatalogMode = 'original'): LearningCatalog {
  const version = mode === 'compatible' || mode === 'revised' ? '1.0.1' : '1.0.0';
  const revision = mode === 'revised' ? 2 : 1;
  const ref = (id: string) => ({ id, version });
  const base = (id: string) => ({
    ref: ref(id),
    learningRevision: revision,
    acceptedPriorVersions: mode === 'compatible' ? ['1.0.0'] : [],
  });
  return createLearningCatalog({
    purpose: mode === 'fixture' ? 'contract-fixture' : 'publishable',
    packageRef: { id: 'content.synthetic.learning', version },
    lessons: [
      {
        ...base(syntheticIds.lesson),
        requiredExerciseRefs: [ref(syntheticIds.first), ref(syntheticIds.second)],
      },
    ],
    exercises: [syntheticIds.first, syntheticIds.second].map((id) => ({
      ...base(id),
      lessonRef: ref(syntheticIds.lesson),
      caseKeys: ['normal', 'boundary'],
    })),
    cases: [base(syntheticIds.case)],
  });
}

type InputType = LearningEvent['eventType'];
type Details = { resultCategory?: string; failedCaseKey?: string | null };
export type LearningRawRows = Record<string, { key: IDBValidKey; value: unknown }[]>;
let service: LearningService | undefined;
let catalog = syntheticCatalog();
let authority = createLearningAuthority(catalog, () => true);
let databaseName = '';
let clock = '2026-10-15T02:00:00.000Z';
let nextId: string | undefined;
let current = true;
const commands = new Map<string, LearningCommand>();
const knownDatabases = new Set<string>();

function checkedName(name: string) {
  if (!/^c-viz-learning\.test\.[a-zA-Z0-9.-]+$/.test(name))
    throw new Error('Learning harness only accesses isolated test databases.');
  return name;
}
function connected() {
  if (!service) throw new Error('Learning service not opened.');
  return service;
}
async function result<T>(run: () => T | Promise<T>): Promise<HarnessResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    const source = error as { code?: unknown; saved?: unknown; message?: unknown };
    return {
      ok: false,
      error: {
        code: typeof source.code === 'string' ? source.code : 'UNCLASSIFIED',
        saved: source.saved === true,
        message: typeof source.message === 'string' ? source.message : String(error),
      },
    };
  }
}
function syntheticEvent(type: InputType, subjectId: string, details: Details = {}): LearningEvent {
  const entity = [...catalog.lessons, ...catalog.exercises, ...catalog.cases].find(
    (value) => value.ref.id === subjectId,
  );
  const event = {
    eventContractVersion: '1.0.0',
    eventType: type,
    subjectRef: entity?.ref ?? { id: subjectId, version: '1.0.0' },
    packageRef: catalog.packageRef,
    learningRevision: entity?.learningRevision ?? 1,
    result:
      type === 'lesson.started'
        ? 'started'
        : type === 'exercise.passed'
          ? 'passed'
          : type === 'exercise.attempt-evaluated'
            ? 'failed'
            : 'confirmed',
    ...(type === 'exercise.attempt-evaluated'
      ? {
          resultCategory: details.resultCategory ?? 'wrong-answer',
          failedCaseKey: details.failedCaseKey ?? null,
        }
      : {}),
  };
  return event as LearningEvent;
}

async function nativeOpen(name = databaseName) {
  checkedName(name);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export const learningHarness = {
  async open(name: string, mode: CatalogMode = 'original') {
    checkedName(name);
    service?.dispose();
    databaseName = name;
    knownDatabases.add(name);
    catalog = syntheticCatalog(mode);
    current = true;
    authority = createLearningAuthority(catalog, () => current);
    service = new LearningService({
      catalog,
      openStorage: () =>
        openStorage({ name, activePackageRef: catalog.packageRef, timeZone: 'Asia/Shanghai' }),
      clock: () => clock,
      id: () => {
        const id = nextId ?? crypto.randomUUID();
        nextId = undefined;
        return id;
      },
    });
    await service.start();
    return service.getState();
  },
  state() {
    return connected().getState();
  },
  async refresh() {
    await connected().refresh();
    return connected().getState();
  },
  async saveDisplay(
    value: Parameters<LearningService['saveDisplay']>[0],
    expectedRevision?: number,
  ) {
    const active = connected();
    await active.saveDisplay(value, expectedRevision ?? active.getState().snapshot!.meta.revision);
    return active.getState();
  },
  async saveAvatar(value: Parameters<LearningService['saveAvatar']>[0], expectedRevision?: number) {
    const active = connected();
    await active.saveAvatar(value, expectedRevision ?? active.getState().snapshot!.meta.revision);
    return active.getState();
  },
  async saveGoal(targets: GoalTargets, expectedRevision?: number) {
    const active = connected();
    await active.saveGoalTemplate(
      targets,
      expectedRevision ?? active.getState().snapshot!.meta.revision,
    );
    return active.getState();
  },
  setClock(value: string) {
    clock = value;
  },
  setCurrent(value: boolean) {
    current = value;
  },
  capture(type: InputType, subjectId: string, eventId?: string, at?: string, details?: Details) {
    return result(async () => {
      if (at) clock = at;
      nextId = eventId;
      const command = await connected().capture(
        authority.issue(syntheticEvent(type, subjectId, details)),
      );
      commands.set(command.receipt.eventId, command);
      return structuredClone(command);
    });
  },
  commit(eventId: string) {
    return result(async () => {
      const command = commands.get(eventId);
      if (!command) throw new Error('Synthetic captured command not found.');
      return connected().commitCommand(command);
    });
  },
  async learn(
    type: InputType,
    subjectId: string,
    eventId?: string,
    at?: string,
    details?: Details,
  ) {
    const captured = await learningHarness.capture(type, subjectId, eventId, at, details);
    if (!captured.ok) return captured;
    return learningHarness.commit(captured.value.receipt.eventId);
  },
  issueUnknown(event: unknown) {
    return result(() => authority.issue(event as LearningEvent));
  },
  captureUnknown(fact: unknown) {
    return result(() => connected().capture(fact as Parameters<LearningService['capture']>[0]));
  },
  commitPlain(command: unknown) {
    return result(() => connected().commitCommand(command as LearningCommand));
  },
  async seedPostedMaxima() {
    // Historical synthetic posted rows are seeded only after trusted synthetic
    // events created their rights. No production reward policy is established.
    const db = await nativeOpen();
    try {
      const transaction = db.transaction(['meta', 'ledger'], 'readwrite');
      const done = complete(transaction);
      const meta = transaction.objectStore('meta').get('current');
      meta.onsuccess = () => {
        const value = meta.result as StorageSnapshot['meta'];
        transaction.objectStore('meta').put({ ...value, revision: value.revision + 1 }, 'current');
      };
      const cursor = transaction.objectStore('ledger').openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        const value = cursor.result.value as StorageSnapshot['ledger'][number];
        if (value.sourceId === 'reward.exercise.first-pass')
          cursor.result.update({
            ...value,
            status: 'posted',
            points: Number.MAX_SAFE_INTEGER,
            policyRef: { id: 'reward.synthetic.historical', version: '1.0.0' },
          });
        cursor.result.continue();
      };
      await done;
    } finally {
      db.close();
    }
    return learningHarness.refresh();
  },
  async nativeRows(): Promise<LearningRawRows> {
    const db = await nativeOpen();
    try {
      const transaction = db.transaction(Array.from(db.objectStoreNames), 'readonly');
      const done = complete(transaction);
      const rows: LearningRawRows = Object.fromEntries(
        await Promise.all(
          Array.from(db.objectStoreNames).map(async (name) => {
            const value = await new Promise<unknown[]>((resolve, reject) => {
              const request = transaction.objectStore(name).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
              const request = transaction.objectStore(name).getAllKeys();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return [name, value.map((row, index) => ({ key: keys[index]!, value: row }))];
          }),
        ),
      );
      await done;
      return rows;
    } finally {
      db.close();
    }
  },
  async runSmoke() {
    const successful = <T>(answer: HarnessResult<T>): T => {
      if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
      return answer.value;
    };
    const name = `c-viz-learning.test.${crypto.randomUUID()}`;
    await learningHarness.open(name);
    await learningHarness.saveDisplay({ theme: 'dark', reducedMotion: 'on', playbackRate: 1.5 });
    await learningHarness.saveAvatar({ presetId: 'avatar.basic.01', accentColor: '#A246C8' });
    await learningHarness.saveGoal({ exercise: 2, lesson: 1, case: 1 });
    successful(await learningHarness.learn('lesson.study-confirmed', syntheticIds.lesson));
    const eventId = crypto.randomUUID();
    successful(await learningHarness.capture('exercise.passed', syntheticIds.first, eventId));
    const first = successful(await learningHarness.commit(eventId));
    const replay = successful(await learningHarness.commit(eventId));
    successful(await learningHarness.learn('exercise.passed', syntheticIds.second));
    successful(await learningHarness.learn('case.view-confirmed', syntheticIds.case));
    const before = learningHarness.state();
    const native = await learningHarness.nativeRows();
    const reopened = await learningHarness.open(name);
    const summary = {
      evidenceKind:
        'synthetic trusted facts through unified service and native IndexedDB; not real Rust learning',
      settings: before.snapshot!.settings,
      avatar: before.snapshot!.avatar,
      currentLessonCompleted: before.projection!.lessons[0]!.completed,
      receiptCount: before.snapshot!.receipts.length,
      pendingCount: before.projection!.ledger.pending.length,
      postedPoints: before.projection!.ledger.totalPoints,
      todayCounts: before.projection!.goals[0]!.counts,
      goalAchieved: before.projection!.goals[0]!.achievedAt !== null,
      receiptReplayPreserved: first.revision === replay.revision && replay.replayed,
      reopenedEqual: JSON.stringify(before.snapshot) === JSON.stringify(reopened.snapshot),
      nativeRowsEqual:
        JSON.stringify(native) === JSON.stringify(await learningHarness.nativeRows()),
    };
    await learningHarness.dispose();
    return summary;
  },
  async dispose() {
    service?.dispose();
    service = undefined;
    commands.clear();
    for (const name of knownDatabases) {
      checkedName(name);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Learning test DB disposal was blocked.'));
      });
    }
    knownDatabases.clear();
  },
};

declare global {
  interface Window {
    learningHarness: typeof learningHarness;
  }
}
window.learningHarness = learningHarness;
window.addEventListener('pagehide', () => service?.dispose());
