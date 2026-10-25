import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { LearningService } from '../../web/src/learning/service';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { createLearningAuthority, type VerifiedFact } from '../../web/src/learning/authority';
import { createPracticePassAuthority } from '../../web/src/learning/practice-authority';
import { decodeCourseLearning } from '../../web/src/content/course-learning';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import type { CourseReading } from '../../web/src/content/reading';
import type { CaseSummary } from '../../web/src/practice/submission';
import type { LearningCatalog } from '../../web/src/learning/types';
import type { StorageClient, StorageMutation } from '../../web/src/storage/client';
import { StorageError } from '../../web/src/storage/errors';
import {
  createMeta,
  emptySnapshot,
  recordKey,
  type StorageSnapshot,
} from '../../web/src/storage/model';
import { assertSnapshot } from '../../web/src/storage/validation';

// This isolated reviewed-release model exercises integrity/ref validation. It
// does not register a production resource or claim actual browser persistence.
const registration = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const reading = JSON.parse(
    readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
  );
  const practiceBytes = readFileSync('web/public/content/practice/course-practice-1.0.0.json');
  const readingBytes = readFileSync('web/public/content/reading/course-reading-1.0.0.json');
  const value = {
    learningVersion: '1.0.0',
    sourceSha256: reading.sourceSha256,
    readingSha256: createHash('sha256').update(readingBytes).digest('hex'),
    practiceSha256: createHash('sha256').update(practiceBytes).digest('hex'),
    blocksBuildSha256: 'b'.repeat(64),
    capabilities: ['lesson.started', 'lesson.study-confirmed', 'exercise.passed'],
    catalog: { ...reading.catalog, purpose: 'course-practice' },
  };
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    bytes,
    release: {
      file: 'content/learning/test-reviewed-model.json',
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      readingSha256: value.readingSha256,
      practiceSha256: value.practiceSha256,
      sourceSha256: value.sourceSha256,
    },
  };
});
vi.mock('../../web/src/content/course-learning-release.generated', () => ({
  courseLearningRelease: registration.release,
}));

const reading = JSON.parse(
  readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
) as CourseReading;
const practice = JSON.parse(
  readFileSync('web/public/content/practice/course-practice-1.0.0.json', 'utf8'),
) as CoursePractice;
const catalog = createLearningCatalog({ ...reading.catalog, purpose: 'course-practice' });
const generation = '00000000-0000-4000-8000-000000000094';
function summaries(index = 0): CaseSummary[] {
  const c = exerciseCatalog(practice, practice.exercises[index].id);
  const keys = [
    'input-bindings',
    'stdout-exact',
    'exit-zero',
    'teaching-target',
    ...(c.judgeProfile.rule === 'while-for-accumulations'
      ? ['while-accumulation', 'for-accumulation']
      : []),
  ];
  return c.subject.tests.map((test, position) => ({
    identity: {
      contextId: 'accepted-context',
      contextRevision: 1,
      submissionId: 'accepted-submission',
      runId: `accepted-run-${position}`,
      sourceRevision: position + 1,
      testCaseKey: test.caseKey,
    },
    caseKey: test.caseKey,
    met: true,
    terminal: 'completed',
    checks: keys.map((key) => ({ key, status: 'met', diagnosticCodes: [] })),
    coverage:
      index === 2 && position < 2
        ? [
            {
              siteKey: 'answer.if',
              nodeId: `n${position + 1}`,
              branch: position ? 'else' : 'then',
              visits: 1,
            },
          ]
        : [],
  }));
}
function issuer(index = 0) {
  const state = { current: true, summaries: summaries(index) };
  const authority = createPracticePassAuthority(catalog, () => ({
    catalog: exerciseCatalog(practice, practice.exercises[index].id),
    summaries: state.summaries,
    current: state.current,
  }));
  return { state, issue: authority.issue };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
/** Transaction-recipe model only. Native atomicity/inter-tab tests belong to the browser suite. */
function modelClient() {
  let data = emptySnapshot(
    createMeta({
      generation,
      timeZone: 'Asia/Shanghai',
      createdAt: '2026-10-20T02:00:00.000Z',
      activePackageRef: reading.packageRef,
    }),
  );
  const apply = (operations: StorageMutation[]) => {
    for (const operation of operations) {
      if (operation.store === 'settings' || operation.store === 'avatar') {
        Object.assign(data[operation.store], operation.value);
        continue;
      }
      const rows = data[operation.store] as unknown[];
      const key = JSON.stringify(recordKey(operation.store, generation, operation.value as never));
      const index = rows.findIndex(
        (row) => JSON.stringify(recordKey(operation.store, generation, row as never)) === key,
      );
      if (index < 0) rows.push(structuredClone(operation.value));
      else rows[index] = structuredClone(operation.value);
    }
    data.meta.revision++;
  };
  const fake = {
    read: vi.fn(async () => structuredClone(data)),
    readRecovery: vi.fn(async () => ({
      snapshot: structuredClone(data),
      guard: 'model-guard',
      writable: true,
      issues: [],
      canClear: true,
      resettable: [],
      ledgerUncertain: false,
      errorCode: null,
    })),
    commit: vi.fn<StorageClient['commit']>(async (expectedGeneration, prepare) => {
      if (expectedGeneration !== data.meta.generation) throw new StorageError('S_GENERATION_STALE');
      apply(prepare(structuredClone(data)));
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    switchReviewedCaseRelease: vi.fn<StorageClient['switchReviewedCaseRelease']>(
      async (expectedGeneration, expectedRevision) => {
        if (expectedGeneration !== data.meta.generation)
          throw new StorageError('S_GENERATION_STALE');
        if (expectedRevision !== data.meta.revision) throw new StorageError('S_REVISION_CONFLICT');
        if (data.meta.activePackageRef.version !== '1.0.2') {
          data.meta.activePackageRef = { id: 'content.c.p0', version: '1.0.2' };
          data.meta.revision++;
        }
        return { saved: true, revision: data.meta.revision, replayed: false };
      },
    ),
    commitOnce: vi.fn<StorageClient['commitOnce']>(async (command, prepare) => {
      if (command.generation !== data.meta.generation) throw new StorageError('S_GENERATION_STALE');
      const old = data.receipts.find((receipt) => receipt.eventId === command.receipt.eventId);
      if (old) return { saved: true, revision: old.committedRevision, replayed: true };
      apply(prepare(structuredClone(data)));
      data.receipts.push({ ...command.receipt, committedRevision: data.meta.revision });
      assertSnapshot(data);
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    clear: vi.fn(async () => {
      data = emptySnapshot(
        createMeta({
          generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          timeZone: 'Asia/Shanghai',
          createdAt: '2026-10-20T03:00:00.000Z',
          activePackageRef: reading.packageRef,
        }),
      );
      return structuredClone(data);
    }),
    close: vi.fn(),
    timeZoneFallback: false,
  };
  return {
    fake,
    get data() {
      return data;
    },
    client: fake as unknown as StorageClient,
  };
}
async function setup(
  options: { clock?: () => string; id?: () => string; content?: LearningCatalog } = {},
) {
  const model = modelClient();
  const service = new LearningService({
    catalog: options.content ?? catalog,
    openStorage: async () => model.client,
    clock: options.clock ?? (() => '2026-10-20T02:00:00.000Z'),
    id: options.id,
  });
  await service.start();
  return { model, service };
}

describe('09.4 narrow reviewed resource and practice authority', () => {
  it('verifies exact reviewed bytes and references before exposing only the practice catalog', async () => {
    expect(await decodeCourseLearning(registration.bytes, reading)).toEqual(catalog);
    const changed = Buffer.from(registration.bytes);
    changed[0] = 32;
    await expect(decodeCourseLearning(changed, reading)).rejects.toThrow(
      'COURSE_LEARNING_INTEGRITY',
    );
    await expect(decodeCourseLearning(registration.bytes.subarray(1), reading)).rejects.toThrow(
      'COURSE_LEARNING_INTEGRITY',
    );
    await expect(
      decodeCourseLearning(registration.bytes, { ...reading, sourceSha256: 'f'.repeat(64) }),
    ).rejects.toThrow('COURSE_LEARNING_CONTENT');
    const changedCatalog = structuredClone(reading);
    (changedCatalog.catalog.lessons[0] as { learningRevision: number }).learningRevision++;
    await expect(decodeCourseLearning(registration.bytes, changedCatalog)).rejects.toThrow(
      'COURSE_LEARNING_CONTENT',
    );
    expect(createHash('sha256').update(registration.bytes).digest('hex')).toBe(
      registration.release.sha256,
    );
  });
  it.each([0, 1, 2, 3, 4, 5])(
    'accepts all exact checks of exercise %i in a synthetic summary model',
    (index) => {
      expect(issuer(index).issue()).toBeDefined();
    },
  );
  it('rejects expired, partial, foreign-identity, failed and diagnostic-bearing evidence', () => {
    for (const alter of [
      (value: ReturnType<typeof issuer>['state']) => {
        value.current = false;
      },
      (value: ReturnType<typeof issuer>['state']) => {
        value.summaries.pop();
      },
      (value: ReturnType<typeof issuer>['state']) => {
        value.summaries[1].identity.contextId = 'other';
      },
      (value: ReturnType<typeof issuer>['state']) => {
        value.summaries[0].met = false;
      },
      (value: ReturnType<typeof issuer>['state']) => {
        value.summaries[0].terminal = 'resource-limit';
      },
      (value: ReturnType<typeof issuer>['state']) => {
        value.summaries[0].checks[0].diagnosticCodes.push('J_BINDING_MISMATCH');
      },
      (value: ReturnType<typeof issuer>['state']) => {
        value.summaries[0].checks.pop();
      },
    ]) {
      const value = issuer();
      alter(value.state);
      expect(() => value.issue()).toThrow('S_CONTENT_INCOMPATIBLE');
    }
  });
  it('keeps case, failed-attempt and explicit completion issuers outside this course capability', () => {
    const authority = createLearningAuthority(catalog, () => true);
    expect(() =>
      authority.issue({
        eventContractVersion: '1.0.0',
        eventType: 'case.view-confirmed',
        result: 'confirmed',
        packageRef: catalog.packageRef,
        subjectRef: catalog.cases[0].ref,
        learningRevision: 1,
      }),
    ).toThrow('S_CONTENT_INCOMPATIBLE');
    expect(() =>
      authority.issue({
        eventContractVersion: '1.0.0',
        eventType: 'exercise.attempt-evaluated',
        result: 'failed',
        resultCategory: 'wrong-answer',
        failedCaseKey: null,
        packageRef: catalog.packageRef,
        subjectRef: catalog.exercises[0].ref,
        learningRevision: 1,
      }),
    ).toThrow('S_CONTENT_INCOMPATIBLE');
  });
});

describe('09.4 service capture/retry/clear model boundaries', () => {
  it('rejects fake tokens, generic authority tokens, stale epochs and pre-capture edits without a save', async () => {
    const { model, service } = await setup();
    const generic = createLearningAuthority(catalog, () => true).issue({
      eventContractVersion: '1.0.0',
      eventType: 'exercise.passed',
      result: 'passed',
      packageRef: catalog.packageRef,
      subjectRef: catalog.exercises[0].ref,
      learningRevision: 1,
    });
    await expect(service.recordPracticePass({} as VerifiedFact, 0)).rejects.toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
    await expect(service.recordPracticePass(generic, 0)).rejects.toThrow('S_CONTENT_INCOMPATIBLE');
    const expired = issuer();
    const token = expired.issue();
    expired.state.current = false;
    await expect(service.recordPracticePass(token, 0)).rejects.toThrow('S_CONTENT_INCOMPATIBLE');
    await expect(service.recordPracticePass(issuer().issue(), 1)).rejects.toThrow(
      'S_GENERATION_STALE',
    );
    expect(model.fake.commitOnce).not.toHaveBeenCalled();
    service.dispose();
  });
  it('retains the accepted occurrence before delayed reads so later edits cannot lose or replace it', async () => {
    const { model, service } = await setup();
    const read = deferred<StorageSnapshot>();
    model.fake.read.mockImplementationOnce(() => read.promise);
    const accepted = issuer();
    const saving = service.recordPracticePass(accepted.issue(), 0);
    accepted.state.current = false;
    accepted.state.summaries.length = 0;
    read.resolve(structuredClone(model.data));
    await expect(saving).resolves.toMatchObject({ saved: true, replayed: false });
    expect(model.data.progress.some((row) => row.eventType === 'exercise.passed')).toBe(true);
    expect(service.getState().capabilities.goalsConfigurable).toBe(false);
    service.dispose();
  });
  it('keeps the original ID/date across day-open failure, edit and midnight before retry', async () => {
    let at = '2026-10-20T15:59:59.000Z';
    const id = vi.fn(() => '00000000-0000-4000-8000-000000000095');
    const { model, service } = await setup({ clock: () => at, id });
    const accepted = issuer();
    model.fake.commit.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    await expect(service.recordPracticePass(accepted.issue(), 0)).rejects.toThrow('S_QUOTA');
    expect(service.getState()).toMatchObject({
      lastSaved: false,
      pendingCount: 1,
      temporary: true,
    });
    accepted.state.current = false;
    at = '2026-10-20T16:00:01.000Z';
    await service.retryPending();
    expect(id).toHaveBeenCalledOnce();
    expect(model.data.receipts[0]).toMatchObject({
      eventId: '00000000-0000-4000-8000-000000000095',
      occurredAt: '2026-10-20T15:59:59.000Z',
      localDate: '2026-10-20',
    });
    expect(model.data.goals).toHaveLength(1);
    expect(service.getState()).toMatchObject({
      lastSaved: true,
      pendingCount: 0,
      temporary: false,
    });
    service.dispose();
  });
  it('derives completion in the pass transaction and keeps pending rights/day facts idempotent', async () => {
    const { model, service } = await setup();
    const lesson = catalog.lessons[0];
    model.data.progress.push({
      eventType: 'lesson.study-confirmed',
      result: 'confirmed',
      subjectRef: lesson.ref,
      packageRef: catalog.packageRef,
      learningRevision: 1,
      firstAt: '2026-10-20T01:00:00.000Z',
      lastAt: '2026-10-20T01:00:00.000Z',
    });
    const token = issuer().issue();
    await service.recordPracticePass(token, 0);
    const firstRevision = model.data.meta.revision;
    await expect(service.recordPracticePass(token, 0)).resolves.toMatchObject({ replayed: true });
    expect(model.data.meta.revision).toBe(firstRevision);
    await service.recordPracticePass(issuer().issue(), 0);
    expect(model.data.progress.map((row) => row.eventType)).toContain('lesson.completed');
    expect(model.data.ledger).toHaveLength(2);
    expect(
      model.data.ledger.every(
        (entry) => entry.status === 'pending' && entry.points === null && entry.policyRef === null,
      ),
    ).toBe(true);
    expect(model.data.dailyFacts).toHaveLength(2);
    expect(service.getState().projection!.ledger.totalPoints).toBe('0');
    expect(service.getState().projection!.lessons[0].completed).toBe(true);
    const persisted = JSON.stringify(model.data);
    for (const forbidden of [
      'accepted-context',
      'accepted-submission',
      'accepted-run',
      'stdout',
      'coverage',
      'checks',
      'sourceRevision',
    ])
      expect(persisted).not.toContain(forbidden);
    service.dispose();
  });
  it('keeps a failed commit retry after edit but clear withdraws it and rejects the original token', async () => {
    const { model, service } = await setup();
    const accepted = issuer();
    const token = accepted.issue();
    model.fake.commitOnce.mockRejectedValueOnce(new StorageError('S_ABORTED'));
    await expect(service.recordPracticePass(token, 0)).rejects.toThrow('S_ABORTED');
    accepted.state.current = false;
    expect(service.getState().projection!.exercises[0].passed).toBe(true);
    expect(model.data.progress).toEqual([]);
    await service.clearLocalData();
    expect(service.getState()).toMatchObject({ pendingCount: 0, temporary: false, cleared: true });
    expect(service.getState().projection!.exercises[0].passed).toBe(false);
    await service.retryPending();
    await expect(service.recordPracticePass(token, 0)).rejects.toThrow('S_GENERATION_STALE');
    await expect(
      service.recordPracticePass(token, service.getState().sessionEpoch),
    ).rejects.toThrow('S_GENERATION_STALE');
    expect(model.data.progress).toEqual([]);
    service.dispose();
  });
  it('retries an aborted pass after leaving the editor and confirms a lost acknowledgment exactly once', async () => {
    const { model, service } = await setup();
    const accepted = issuer();
    const originalCommit = model.fake.commitOnce.getMockImplementation()!;
    model.fake.commitOnce.mockImplementationOnce(async (...args) => {
      await originalCommit(...args);
      throw new StorageError('S_ABORTED');
    });
    const token = accepted.issue();
    await expect(service.recordPracticePass(token, 0)).rejects.toThrow('S_ABORTED');
    expect(model.data.receipts).toHaveLength(1);
    accepted.state.current = false;
    accepted.state.summaries.length = 0;
    await service.retryPending();
    expect(model.data.receipts).toHaveLength(1);
    expect(model.data.dailyFacts).toHaveLength(1);
    expect(model.data.ledger).toHaveLength(1);
    expect(service.getState()).toMatchObject({
      lastSaved: true,
      pendingCount: 0,
      temporary: false,
    });
    expect(model.fake.commitOnce.mock.calls[1][0]).toBe(model.fake.commitOnce.mock.calls[0][0]);
    service.dispose();
  });
  it('never resolves a memory-only accepted pass as saved or rebinds it after storage opens', async () => {
    const model = modelClient();
    const opening = vi
      .fn<() => Promise<StorageClient>>()
      .mockRejectedValueOnce(new StorageError('S_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(model.client);
    const service = new LearningService({
      catalog,
      openStorage: opening,
      clock: () => '2026-10-20T02:00:00.000Z',
    });
    await service.start();
    const token = issuer().issue();
    await expect(service.recordPracticePass(token, 0)).rejects.toThrow('S_STORAGE_UNAVAILABLE');
    expect(service.getState()).toMatchObject({
      lastSaved: false,
      temporary: true,
      pendingCount: 0,
    });
    expect(service.getState().projection!.exercises[0].passed).toBe(true);
    await service.refresh();
    expect(service.getState().projection!.exercises[0].passed).toBe(false);
    await expect(service.recordPracticePass(token, 0)).rejects.toThrow('S_GENERATION_STALE');
    expect(model.fake.commitOnce).not.toHaveBeenCalled();
    service.dispose();
  });
  it('a content reload discards failed-save retries and makes their captured token stale', async () => {
    const model = modelClient();
    const service = new LearningService({
      catalog,
      openStorage: async () => model.client,
      loadReading: async () => reading,
      loadPractice: async () => catalog,
      clock: () => '2026-10-20T02:00:00.000Z',
    });
    await service.start();
    await service.reloadReading();
    const epoch = service.getState().sessionEpoch;
    const token = issuer().issue();
    model.fake.commitOnce.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    await expect(service.recordPracticePass(token, epoch)).rejects.toThrow('S_QUOTA');
    expect(service.getState().pendingCount).toBe(1);
    await service.reloadReading();
    expect(service.getState()).toMatchObject({
      pendingCount: 0,
      temporary: false,
      practiceStatus: 'ready',
    });
    await service.retryPending();
    await expect(
      service.recordPracticePass(token, service.getState().sessionEpoch),
    ).rejects.toThrow('S_GENERATION_STALE');
    expect(model.data.progress).toEqual([]);
    service.dispose();
  });
  it('rejects a capture delayed across clear before it can open the old day or commit', async () => {
    const { model, service } = await setup();
    const read = deferred<StorageSnapshot>();
    const old = structuredClone(model.data);
    model.fake.read.mockImplementationOnce(() => read.promise);
    const saving = service.recordPracticePass(issuer().issue(), 0);
    const rejected = expect(saving).rejects.toThrow('S_GENERATION_STALE');
    await service.clearLocalData();
    read.resolve(old);
    await rejected;
    expect(model.fake.commit).not.toHaveBeenCalled();
    expect(model.fake.commitOnce).not.toHaveBeenCalled();
    service.dispose();
  });
  it('falls back to reading-only when practice authorization fails without losing explicit reading actions', async () => {
    const model = modelClient();
    const service = new LearningService({
      loadReading: async () => reading,
      loadPractice: async () => {
        throw new Error('COURSE_LEARNING_UNAVAILABLE');
      },
      openStorage: async () => model.client,
      clock: () => '2026-10-20T02:00:00.000Z',
    });
    await service.start();
    await vi.waitFor(() => expect(service.getState().readingStatus).toBe('ready'));
    expect(service.getState()).toMatchObject({
      practiceCatalog: null,
      practiceStatus: 'failed',
      readingError: null,
    });
    await service.recordLesson(reading.lessons[0].id, true, service.getState().sessionEpoch);
    expect(model.data.progress.map((row) => row.eventType)).toEqual([
      'lesson.started',
      'lesson.study-confirmed',
    ]);
    await expect(
      service.recordPracticePass(issuer().issue(), service.getState().sessionEpoch),
    ).rejects.toThrow('S_CONTENT_INCOMPATIBLE');
    expect(service.getState().projection!.lessons[0].completed).toBe(false);
    service.dispose();
  });
});
