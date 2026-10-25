import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { createLearningAuthority } from '../../web/src/learning/authority';
import { LearningService } from '../../web/src/learning/service';
import { applyLearningEvent, projectLearning } from '../../web/src/learning/domain';
import { hasReviewedCaseAssembly, reviewedSnapshot } from '../../web/src/learning/reviewed-release';
import { caseLearningCatalog } from '../../web/src/content/case-learning';
import type { CourseReading } from '../../web/src/content/reading';
import type { Progress, StorageSnapshot } from '../../web/src/storage/model';
import { createMeta, emptySnapshot, recordKey } from '../../web/src/storage/model';
import type { StorageClient, StorageMutation } from '../../web/src/storage/client';
import { StorageError } from '../../web/src/storage/errors';

const reading = JSON.parse(
  readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
) as CourseReading;
const course = createLearningCatalog({ ...reading.catalog, purpose: 'course-practice' });
const at = '2026-10-25T02:00:00.000Z';
function snapshot() {
  const value = emptySnapshot(
    createMeta({
      generation: '12345678-1234-4234-8234-123456789abc',
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
    }),
  );
  value.settings.goalTemplate = { revision: 1, targets: { exercise: 1, lesson: 1, case: 0 } };
  value.goals = [{ localDate: '2026-10-25', goalVersion: 1, targets: null, achievedAt: null }];
  return value;
}
function history(id: string, packageVersion = '1.0.1', version = '1.0.1'): Progress {
  return {
    eventType: 'case.view-confirmed',
    result: 'confirmed',
    subjectRef: { id, version },
    packageRef: { id: 'content.c.p0', version: packageVersion },
    learningRevision: 1,
    firstAt: at,
    lastAt: at,
  };
}
/** Service lifecycle model only; native transaction coverage is in reviewed-case-release.spec.ts. */
function modelClient(data = snapshot()) {
  const apply = (operations: StorageMutation[]) => {
    for (const op of operations) {
      if (['settings', 'avatar', 'appearance'].includes(op.store))
        Object.assign(data, { [op.store]: structuredClone(op.value) });
      else {
        const rows = data[op.store] as unknown[];
        const key = recordKey(op.store, data.meta.generation, op.value as never);
        const index = rows.findIndex(
          (row) =>
            JSON.stringify(recordKey(op.store, data.meta.generation, row as never)) ===
            JSON.stringify(key),
        );
        if (index < 0) rows.push(structuredClone(op.value));
        else rows[index] = structuredClone(op.value);
      }
    }
  };
  const fake = {
    read: vi.fn(async () => structuredClone(data)),
    close: vi.fn(),
    timeZoneFallback: false,
    commit: vi.fn(
      async (_generation: string, prepare: (s: StorageSnapshot) => StorageMutation[]) => {
        const ops = prepare(structuredClone(data));
        apply(ops);
        if (ops.length) data.meta.revision++;
        return { saved: true as const, revision: data.meta.revision, replayed: false };
      },
    ),
    switchReviewedCaseRelease: vi.fn(async (_generation: string, revision: number) => {
      if (data.meta.revision !== revision) throw new StorageError('S_REVISION_CONFLICT');
      if (data.meta.activePackageRef.version !== '1.0.2') {
        data.meta.activePackageRef = { id: 'content.c.p0', version: '1.0.2' };
        data.meta.revision++;
      }
      return { saved: true as const, revision: data.meta.revision, replayed: false };
    }),
    commitOnce: vi.fn(
      async (
        command: { receipt: { eventId: string } },
        prepare: (s: StorageSnapshot) => StorageMutation[],
      ) => {
        const existing = data.receipts.find((row) => row.eventId === command.receipt.eventId);
        if (existing)
          return { saved: true as const, revision: existing.committedRevision, replayed: true };
        apply(prepare(structuredClone(data)));
        data.meta.revision++;
        return { saved: true as const, revision: data.meta.revision, replayed: false };
      },
    ),
  };
  return { data, fake, client: fake as unknown as StorageClient };
}
async function serviceFor(model: ReturnType<typeof modelClient>) {
  const service = new LearningService({
    openStorage: async () => model.client,
    loadReading: async () => reading,
    loadPractice: async () => course,
    clock: () => at,
  });
  await service.start();
  await vi.waitFor(() => expect(service.getState().readingStatus).toBe('ready'));
  await service.refresh({ preserveOutcome: true });
  return service;
}

describe('reviewed case release compatibility and service lifecycle', () => {
  it('retains reviewed old viewing and rejects fixture, foreign package, wrong revision and unreviewed versions', () => {
    const data = snapshot();
    const good = history('case.c.bubble-sort');
    const foreign = {
      ...history('case.c.selection-sort'),
      packageRef: { id: 'content.foreign', version: '1.0.1' },
    };
    data.progress = [
      good,
      foreign,
      history('case.c.selection-sort', '1.0.0'),
      { ...history('case.c.selection-sort'), learningRevision: 2 },
      history('case.c.selection-sort', '1.0.2', '1.0.1'),
    ];
    const before = structuredClone(data);
    const filtered = reviewedSnapshot(data, course, caseLearningCatalog());
    expect(filtered.progress).toEqual([good]);
    expect(data).toEqual(before);
    expect(hasReviewedCaseAssembly(course, caseLearningCatalog())).toBe(true);
    const projection = projectLearning(filtered, { ...course, cases: caseLearningCatalog().cases });
    expect(projection.cases.find((row) => row.id === good.subjectRef.id)?.viewConfirmed).toBe(true);
    expect(projection.cases.find((row) => row.id === foreign.subjectRef.id)?.viewConfirmed).toBe(
      false,
    );
  });

  it('a current repeat of an old viewed sorting ID creates no second first-view reward or same-day fact', () => {
    const data = snapshot();
    data.meta.activePackageRef.version = '1.0.2';
    data.progress = [history('case.c.bubble-sort')];
    data.dailyFacts = [
      {
        eventType: 'case.view-confirmed',
        subjectRef: { id: 'case.c.bubble-sort', version: '1.0.1' },
        canonicalSubjectId: 'case.c.bubble-sort',
        localDate: '2026-10-25',
        occurredAt: at,
      },
    ];
    data.ledger = [
      {
        sourceId: 'reward.case.first-view',
        subjectId: 'case.c.bubble-sort',
        localDate: '2026-10-25',
        occurredAt: at,
        status: 'pending',
        points: null,
        policyRef: null,
      },
    ];
    const operations = applyLearningEvent(
      reviewedSnapshot(data, course, caseLearningCatalog()),
      {
        generation: data.meta.generation,
        receipt: {
          eventId: '00000000-0000-4000-8000-000000000001',
          eventType: 'case.view-confirmed',
          result: 'confirmed',
          packageRef: caseLearningCatalog().packageRef,
          subjectRef: { id: 'case.c.bubble-sort', version: '1.0.2' },
          learningRevision: 1,
          occurredAt: at,
          localDate: '2026-10-25',
          goalVersion: 1,
        },
      },
      caseLearningCatalog(),
    );
    expect(operations.map((op) => op.store)).toEqual(['progress']);
  });

  it('switches legacy marker only after verified assembly, preserving existing learning and settings', async () => {
    const model = modelClient();
    model.data.progress = [history('case.c.bubble-sort')];
    const before = structuredClone(model.data);
    const service = await serviceFor(model);
    expect(model.fake.switchReviewedCaseRelease).toHaveBeenCalledOnce();
    expect(model.data.meta).toEqual({
      ...before.meta,
      revision: before.meta.revision + 1,
      activePackageRef: { id: 'content.c.p0', version: '1.0.2' },
    });
    expect({ ...model.data, meta: before.meta }).toEqual(before);
    expect(
      service.getState().projection?.cases.find((row) => row.id === 'case.c.bubble-sort')
        ?.viewConfirmed,
    ).toBe(true);
    service.dispose();
  });

  it('keeps an atomic-switch failure visible and retries only on explicit action', async () => {
    const model = modelClient();
    model.fake.switchReviewedCaseRelease.mockRejectedValueOnce(new StorageError('S_QUOTA'));
    const service = await serviceFor(model);
    expect(model.data.meta.activePackageRef.version).toBe('1.0.0');
    expect(service.getState()).toMatchObject({
      lastSaved: false,
      pendingCount: 1,
      errorCode: 'S_QUOTA',
    });
    await service.refresh({ preserveOutcome: true });
    expect(model.fake.switchReviewedCaseRelease).toHaveBeenCalledOnce();
    await service.retryPending();
    expect(model.data.meta.activePackageRef.version).toBe('1.0.2');
    expect(service.getState().pendingCount).toBe(0);
    service.dispose();
  });

  it('preserves the independent reviewed case release and history when course reading fails', async () => {
    const model = modelClient();
    model.data.progress = [history('case.c.bubble-sort')];
    const service = new LearningService({
      openStorage: async () => model.client,
      loadReading: async () => {
        throw new Error('READING_UNAVAILABLE');
      },
      clock: () => at,
    });
    await service.start();
    await vi.waitFor(() => expect(service.getState().readingStatus).toBe('failed'));
    await service.refresh({ preserveOutcome: true });
    expect(model.data.meta.activePackageRef.version).toBe('1.0.2');
    expect(
      service.getState().projection?.cases.find((row) => row.id === 'case.c.bubble-sort')
        ?.viewConfirmed,
    ).toBe(true);
    expect(model.data.progress).toEqual([history('case.c.bubble-sort')]);
    service.dispose();
  });

  it('invalidates a captured but uncommitted fact after another tab changes active package', async () => {
    const model = modelClient();
    model.data.meta.activePackageRef.version = '1.0.2';
    const service = await serviceFor(model);
    const authority = createLearningAuthority(course, () => true);
    const command = await service.capture(
      authority.issue({
        eventContractVersion: '1.0.0',
        eventType: 'lesson.started',
        result: 'started',
        packageRef: course.packageRef,
        subjectRef: course.lessons[0].ref,
        learningRevision: 1,
      }),
    );
    model.data.meta.activePackageRef = { id: 'content.foreign', version: '1.0.0' };
    model.data.meta.revision++;
    const epoch = service.getState().sessionEpoch;
    await service.refresh({ preserveOutcome: true });
    expect(service.getState().sessionEpoch).toBeGreaterThan(epoch);
    await expect(service.commitCommand(command)).rejects.toMatchObject({
      code: 'S_GENERATION_STALE',
    });
    expect(model.data.progress).toEqual([]);
    service.dispose();
  });
});
