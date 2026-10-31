import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CourseReading } from '../../web/src/content/reading';
import { createLearningAuthority } from '../../web/src/learning/authority';
import { applyLearningEvent, projectLearning } from '../../web/src/learning/domain';
import {
  hasReviewedCourseAssembly,
  reviewedCasePackage,
  reviewedCourseHistory,
  reviewedCoursePredecessors,
  reviewedCourseSnapshot,
} from '../../web/src/learning/reviewed-release';
import { LearningService } from '../../web/src/learning/service';
import { prepareReviewedCourseSwitch, type StorageClient } from '../../web/src/storage/client';
import { StorageError } from '../../web/src/storage/errors';
import type { Progress, StorageSnapshot } from '../../web/src/storage/model';
import { assertSnapshot } from '../../web/src/storage/validation';
import {
  applyP05Operations,
  p05At,
  p05CaseCatalog,
  p05Catalog,
  p05Command,
  p05Date,
  p05Empty,
  p05Generation,
  p05Package,
} from '../fixtures/p05-learning';

vi.mock('../../web/src/content/case-learning', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  caseLearningCatalog: (ref?: { id: string }) =>
    ref?.id === 'content.c.p05' ? p05CaseCatalog() : reviewedCoursePredecessors.cases,
}));

function legacy(completed = true): StorageSnapshot {
  const snapshot = p05Empty(reviewedCasePackage);
  snapshot.settings.goalTemplate = { revision: 3, targets: { exercise: 6, lesson: 6, case: 1 } };
  snapshot.goals = [
    {
      localDate: p05Date,
      goalVersion: 3,
      targets: { exercise: 6, lesson: 6, case: 1 },
      achievedAt: null,
    },
  ];
  if (completed) {
    for (const kind of ['lessons', 'exercises'] as const) {
      for (const entity of reviewedCoursePredecessors.course[kind]) {
        snapshot.progress.push({
          eventType: kind === 'lessons' ? 'lesson.study-confirmed' : 'exercise.passed',
          subjectRef: { ...entity.ref },
          packageRef: { ...reviewedCoursePredecessors.course.packageRef },
          learningRevision: 1,
          firstAt: p05At,
          lastAt: p05At,
          result: kind === 'lessons' ? 'confirmed' : 'passed',
        } as Progress);
        if (kind === 'lessons')
          snapshot.progress.push({
            eventType: 'lesson.completed',
            subjectRef: { ...entity.ref },
            packageRef: { ...reviewedCoursePredecessors.course.packageRef },
            learningRevision: 1,
            firstAt: p05At,
            lastAt: p05At,
            result: 'completed',
          });
        snapshot.ledger.push({
          sourceId:
            kind === 'lessons' ? 'reward.lesson.first-completion' : 'reward.exercise.first-pass',
          subjectId: entity.ref.id,
          localDate: p05Date,
          occurredAt: p05At,
          status: 'posted',
          points: kind === 'lessons' ? 20 : 10,
          policyRef: { id: 'reward.policy.p0', version: '1.0.0' },
        });
      }
    }
  }
  assertSnapshot(snapshot);
  return snapshot;
}

/** Lifecycle/recipe model only. Browser acceptance must verify native transaction durability. */
function serviceModel(snapshot = legacy()) {
  let data = structuredClone(snapshot);
  const check = (generation: string, revision?: number) => {
    if (data.meta.generation !== generation) throw new StorageError('S_GENERATION_STALE');
    if (revision !== undefined && data.meta.revision !== revision)
      throw new StorageError('S_REVISION_CONFLICT');
  };
  const fake = {
    read: vi.fn(async () => structuredClone(data)),
    commit: vi.fn<StorageClient['commit']>(async (generation, recipe, revision) => {
      check(generation, revision);
      applyP05Operations(data, recipe(structuredClone(data)));
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    commitOnce: vi.fn<StorageClient['commitOnce']>(async (command, recipe) => {
      check(command.generation);
      const existing = data.receipts.find((receipt) => receipt.eventId === command.receipt.eventId);
      if (existing) {
        const { committedRevision, ...summary } = existing;
        if (JSON.stringify(summary) !== JSON.stringify(command.receipt))
          throw new StorageError('S_EVENT_ID_REUSED');
        return { saved: true, revision: committedRevision, replayed: true };
      }
      const operations = recipe(structuredClone(data));
      applyP05Operations(data, operations);
      if (!operations.length) data.meta.revision++;
      data.receipts.push({ ...command.receipt, committedRevision: data.meta.revision });
      assertSnapshot(data);
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    settleRewards: vi.fn<StorageClient['settleRewards']>(async (generation, recipe) => {
      check(generation);
      applyP05Operations(data, recipe(structuredClone(data)));
      return { saved: true, revision: data.meta.revision, replayed: false };
    }),
    switchReviewedCourseRelease: vi.fn<StorageClient['switchReviewedCourseRelease']>(
      async (generation, revision) => {
        data.meta = prepareReviewedCourseSwitch(data.meta, generation, revision);
        return { saved: true, revision: data.meta.revision, replayed: false };
      },
    ),
    switchReviewedCaseRelease: vi.fn<StorageClient['switchReviewedCaseRelease']>(async () => ({
      saved: true,
      revision: data.meta.revision,
      replayed: false,
    })),
    close: vi.fn(),
    timeZoneFallback: false,
  };
  return {
    fake,
    client: fake as unknown as StorageClient,
    get data() {
      return structuredClone(data);
    },
    replace(next: StorageSnapshot) {
      data = structuredClone(next);
    },
  };
}
function newService(source = serviceModel(), readingReady?: Promise<void>) {
  const catalog = p05Catalog();
  const oldReading = JSON.parse(
    readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
  ) as CourseReading;
  const reading = {
    ...oldReading,
    packageRef: catalog.packageRef,
    catalog: { ...catalog, purpose: 'lesson-reading' },
  } as CourseReading;
  const service = new LearningService({
    openStorage: async () => source.client,
    loadReading: async () => {
      if (readingReady) await readingReady;
      return reading;
    },
    loadPractice: async () => catalog,
    clock: () => p05At,
  });
  return { service, source, catalog };
}

describe('P0.5-09 exact predecessor compatibility', () => {
  it('an existing P05 archive recovers a transient publication mismatch after its delayed verified catalog loads without minting facts', async () => {
    const warm = p05Empty();
    warm.settings.goalTemplate = { revision: 1, targets: { exercise: 1, lesson: 1, case: 0 } };
    let resolveReading!: () => void;
    const reading = new Promise<void>((resolve) => {
      resolveReading = resolve;
    });
    const t = newService(serviceModel(warm), reading);
    // Native storage rejects downgrading an existing P05 archive to the
    // independent old-case package while the current catalog is still loading.
    t.source.fake.switchReviewedCaseRelease.mockRejectedValue(
      new StorageError('S_CONTENT_INCOMPATIBLE'),
    );
    const before = t.source.data;
    await t.service.start();
    expect(t.service.getState()).toMatchObject({
      status: 'unsaved',
      errorCode: 'S_CONTENT_INCOMPATIBLE',
    });
    resolveReading();
    await vi.waitFor(() => expect(t.service.getState().practiceStatus).toBe('ready'));
    await t.service.refresh({ preserveOutcome: true });
    expect(t.service.getState()).toMatchObject({
      status: 'ready',
      errorCode: null,
      pendingCount: 0,
      capabilities: { learning: true },
    });
    for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'] as const)
      expect(t.source.data[key]).toEqual(before[key]);
    expect(t.source.fake.commitOnce).not.toHaveBeenCalled();
    t.service.dispose();
  });
  it('pins the actual immutable old course/reading/practice/authorization/case bytes', () => {
    const manifest = JSON.parse(
      readFileSync('content/learning/p05-predecessors-1.0.0.json', 'utf8'),
    ) as { sources: { path: string; sha256: string }[] };
    expect(manifest.sources).toHaveLength(5);
    for (const source of manifest.sources)
      expect(createHash('sha256').update(readFileSync(source.path)).digest('hex')).toBe(
        source.sha256,
      );
  });
  it('requires the complete new course and matching seven cases', () => {
    expect(hasReviewedCourseAssembly(p05Catalog(), p05CaseCatalog())).toBe(true);
    expect(hasReviewedCourseAssembly(p05Catalog(), reviewedCoursePredecessors.cases)).toBe(false);
    expect(
      hasReviewedCourseAssembly(
        { ...p05Catalog(), exercises: p05Catalog().exercises.slice(1) },
        p05CaseCatalog(),
      ),
    ).toBe(false);
    const current = p05Catalog();
    const broken = {
      ...current,
      lessons: current.lessons.map((lesson, index) =>
        index === 0 ? { ...lesson, acceptedPriorVersions: [] } : lesson,
      ),
    };
    expect(hasReviewedCourseAssembly(broken, p05CaseCatalog())).toBe(false);
  });
  it.each(['1.0.1', '1.0.2'])(
    'switches only the reviewed %s predecessor meta using generation and revision CAS',
    (version) => {
      const old = p05Empty({ id: 'content.c.p0', version }).meta;
      old.revision = 19;
      const before = structuredClone(old);
      expect(prepareReviewedCourseSwitch(old, p05Generation, 19)).toEqual({
        ...before,
        revision: 20,
        activePackageRef: p05Package,
      });
      expect(old).toEqual(before);
    },
  );
  it('rejects fixture/foreign packages, stale CAS and stale generations; current release is idempotent', () => {
    for (const ref of [
      { id: 'content.c.p0', version: '1.0.0' },
      { id: 'content.c.p0', version: '1.1.0' },
      { id: 'content.foreign', version: '1.0.1' },
      { id: 'content.c.p05', version: '9.0.0' },
    ])
      expect(() => prepareReviewedCourseSwitch(p05Empty(ref).meta, p05Generation, 0)).toThrow(
        'S_CONTENT_INCOMPATIBLE',
      );
    const current = p05Empty().meta;
    expect(prepareReviewedCourseSwitch(current, p05Generation, 0)).toBe(current);
    expect(() => prepareReviewedCourseSwitch(current, p05Generation, 1)).toThrow(
      'S_REVISION_CONFLICT',
    );
    expect(() =>
      prepareReviewedCourseSwitch(current, '09000000-0000-4000-8000-000000000002', 0),
    ).toThrow('S_GENERATION_STALE');
    const maximum = p05Empty(reviewedCasePackage).meta;
    maximum.revision = Number.MAX_SAFE_INTEGER;
    expect(() => prepareReviewedCourseSwitch(maximum, p05Generation, maximum.revision)).toThrow(
      'S_RECORD_INVALID',
    );
  });
  it('projects six old completed subjects as six of 32 and does not complete any of the new 26', () => {
    const snapshot = legacy();
    const before = structuredClone(snapshot);
    const projection = projectLearning(
      reviewedCourseSnapshot(snapshot, p05Catalog(), p05CaseCatalog()),
      p05Catalog(),
    );
    expect(projection.lessons).toHaveLength(32);
    expect(projection.exercises).toHaveLength(32);
    expect(projection.lessons.filter((lesson) => lesson.completed)).toHaveLength(6);
    expect(projection.exercises.filter((exercise) => exercise.passed)).toHaveLength(6);
    expect(
      projection.lessons.slice(6).every((lesson) => !lesson.completed && !lesson.studyConfirmed),
    ).toBe(true);
    expect(projection.exercises.slice(6).every((exercise) => !exercise.passed)).toBe(true);
    expect(projection.ledger.totalPoints).toBe('180');
    expect(snapshot).toEqual(before);
  });
  it.each(['only-confirmed', 'only-passed'])(
    'keeps %s history partial when moving chapter ownership',
    (mode) => {
      const snapshot = legacy();
      snapshot.progress = snapshot.progress.filter((row) =>
        mode === 'only-confirmed'
          ? row.eventType === 'lesson.study-confirmed'
          : row.eventType === 'exercise.passed',
      );
      snapshot.ledger = [];
      const projection = projectLearning(
        reviewedCourseSnapshot(snapshot, p05Catalog(), p05CaseCatalog()),
        p05Catalog(),
      );
      expect(projection.lessons.filter((lesson) => lesson.completed)).toHaveLength(0);
      expect(projection.lessons.filter((lesson) => lesson.studyConfirmed)).toHaveLength(
        mode === 'only-confirmed' ? 6 : 0,
      );
      expect(projection.exercises.filter((exercise) => exercise.passed)).toHaveLength(
        mode === 'only-passed' ? 6 : 0,
      );
    },
  );
  it('rejects foreign provenance, unaudited entity versions/revisions and new subjects forged under the old package', () => {
    const original = legacy().progress[0];
    for (const row of [
      { ...original, packageRef: { id: 'content.foreign', version: '1.0.1' } },
      { ...original, packageRef: { id: 'content.c.p0', version: '1.0.0' } },
      { ...original, learningRevision: 2 },
      { ...original, subjectRef: { ...original.subjectRef, version: '1.0.0' } },
      { ...original, subjectRef: p05Catalog().lessons[6].ref },
      { ...original, packageRef: p05Package },
    ])
      expect(reviewedCourseHistory(row as Progress, p05Catalog(), p05CaseCatalog())).toBe(false);
  });
  it('retains both real old case versions through their own exact package edges', () => {
    const sorted = p05CaseCatalog().cases.find((item) => item.acceptedPriorVersions.length === 2)!;
    const row = {
      eventType: 'case.view-confirmed',
      subjectRef: { id: sorted.ref.id, version: '1.0.1' },
      packageRef: reviewedCoursePredecessors.course.packageRef,
      learningRevision: 1,
      firstAt: p05At,
      lastAt: p05At,
      result: 'confirmed',
    } as Progress;
    expect(reviewedCourseHistory(row, p05Catalog(), p05CaseCatalog())).toBe(true);
    expect(
      reviewedCourseHistory(
        {
          ...row,
          subjectRef: { ...row.subjectRef, version: '1.0.2' },
          packageRef: reviewedCasePackage,
        },
        p05Catalog(),
        p05CaseCatalog(),
      ),
    ).toBe(true);
    expect(
      reviewedCourseHistory(
        { ...row, subjectRef: { ...row.subjectRef, version: '1.0.2' } },
        p05Catalog(),
        p05CaseCatalog(),
      ),
    ).toBe(false);
  });
  it('does not reaward an old stable subject after a real new-version pass; new subjects earn only their own right', () => {
    const snapshot = legacy();
    snapshot.meta = prepareReviewedCourseSwitch(snapshot.meta, p05Generation, 0);
    const repeated = p05Command(0, 'exercise.passed');
    repeated.receipt.goalVersion = 3;
    const oldAgain = applyLearningEvent(
      reviewedCourseSnapshot(snapshot, p05Catalog(), p05CaseCatalog()),
      repeated,
      p05Catalog(),
    );
    expect(oldAgain.filter((operation) => operation.store === 'ledger')).toEqual([]);
    const first = p05Command(6, 'exercise.passed');
    first.receipt.goalVersion = 3;
    const newPass = applyLearningEvent(
      reviewedCourseSnapshot(snapshot, p05Catalog(), p05CaseCatalog()),
      first,
      p05Catalog(),
    );
    expect(newPass.filter((operation) => operation.store === 'ledger')).toEqual([
      {
        store: 'ledger',
        mode: 'add',
        value: {
          sourceId: 'reward.exercise.first-pass',
          subjectId: 'exercise.c.first-output',
          localDate: p05Date,
          occurredAt: p05At,
          status: 'pending',
          points: null,
          policyRef: null,
        },
      },
    ]);
    expect(newPass.filter((operation) => operation.store === 'progress')).toHaveLength(1);
  });
});

describe('P0.5-09 service upgrade and old receipt replay model', () => {
  it('changes only package meta at upgrade and preserves template, opened date, rows and ledger', async () => {
    const t = newService();
    const before = t.source.data;
    await t.service.start();
    await t.service.reloadReading();
    await t.service.refresh();
    const after = t.source.data;
    expect(after).toEqual({
      ...before,
      meta: { ...before.meta, revision: before.meta.revision + 1, activePackageRef: p05Package },
    });
    expect(t.service.getState().goalConfiguration?.limits).toEqual({
      exercise: 32,
      lesson: 32,
      case: 7,
    });
    expect(
      t.service.getState().projection!.lessons.filter((lesson) => lesson.completed),
    ).toHaveLength(6);
    expect(t.source.fake.switchReviewedCourseRelease).toHaveBeenCalledOnce();
    t.service.dispose();
  });
  it('preserves the previous package on a failed switch and explicitly retries without opening a day', async () => {
    const source = serviceModel();
    source.fake.switchReviewedCourseRelease.mockRejectedValue(new StorageError('S_QUOTA'));
    const t = newService(source);
    const before = source.data;
    await t.service.start();
    await t.service.reloadReading();
    expect(source.data).toEqual(before);
    expect(t.service.getState().lastSaved).toBe(false);
    expect(t.service.getState().capabilities.learning).toBe(false);
    source.fake.switchReviewedCourseRelease.mockImplementation(async (generation, revision) => {
      const next = source.data;
      next.meta = prepareReviewedCourseSwitch(next.meta, generation, revision);
      source.replace(next);
      return { saved: true, revision: next.meta.revision, replayed: false };
    });
    await t.service.refresh();
    expect(source.data.meta.activePackageRef).toEqual(p05Package);
    expect(source.data.receipts).toEqual(before.receipts);
    expect(source.data.goals).toEqual(before.goals);
    t.service.dispose();
  });
  it('replays only a previously committed exact old receipt after the epoch changes', async () => {
    const source = serviceModel();
    const oldCatalog = reviewedCoursePredecessors.course;
    let current = oldCatalog;
    const oldReading = JSON.parse(
      readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
    ) as CourseReading;
    const service = new LearningService({
      openStorage: async () => source.client,
      loadReading: async () =>
        ({
          ...oldReading,
          catalog: { ...current, purpose: 'lesson-reading' },
          packageRef: current.packageRef,
        }) as CourseReading,
      loadPractice: async () => current,
      clock: () => p05At,
    });
    await service.start();
    await service.reloadReading();
    const authority = createLearningAuthority(oldCatalog, () => true);
    const make = () =>
      authority.issue({
        eventContractVersion: '1.0.0',
        eventType: 'lesson.started',
        result: 'started',
        subjectRef: oldCatalog.lessons[0].ref,
        packageRef: oldCatalog.packageRef,
        learningRevision: 1,
      });
    const committed = await service.capture(make());
    await service.commitCommand(committed);
    const neverSaved = await service.capture(make());
    current = p05Catalog();
    await service.reloadReading();
    await service.refresh();
    const before = source.data;
    expect((await service.commitCommand(committed)).replayed).toBe(true);
    expect(source.data).toEqual(before);
    await expect(service.commitCommand(neverSaved)).rejects.toThrow('S_GENERATION_STALE');
    expect(source.data).toEqual(before);
    service.dispose();
  });
});
