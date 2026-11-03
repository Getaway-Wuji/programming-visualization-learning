import type { C6Response } from '../engine/c6-types';
import type { LearningReceiptSummary } from '../learning/types';
import type { C6LearningCommand } from './model';
import type { StorageClient, StorageMutation, SaveResult } from '../storage/client';
import type { StorageSnapshot } from '../storage/model';
import { StorageError, storageError } from '../storage/errors';
import { isUtcTime, localDateAt } from '../storage/validation';
import type { C6LearningIndex } from './index';
import { createC6CourseAuthority, type C6CourseFact, type C6RunLease } from './authority';
import type { C6Attempt, C6CourseDraft } from './model';
import { prepareC6Event } from './recipe';

interface Hooks {
  current(): {
    epoch: number;
    snapshot: StorageSnapshot | null;
    writable: boolean;
    rollback: boolean;
  };
  storage(): StorageClient;
  clock(): string;
  run<T>(action: () => Promise<T>): Promise<T>;
  openDay(generation: string, at: string): Promise<void>;
  rewards(operations: StorageMutation[]): StorageMutation[];
  saved(result: SaveResult, generation: string, epoch: number): Promise<SaveResult>;
  saving(): void;
  failed(error: unknown): void;
  pendingChanged(): void;
}
export class C6LearningSession {
  private readonly authority;
  private pending = new Map<
    C6LearningCommand,
    { epoch: number; fact: C6CourseFact | null; attempt: C6Attempt | null }
  >();
  constructor(
    readonly index: C6LearningIndex,
    private readonly hooks: Hooks,
  ) {
    this.authority = createC6CourseAuthority(index, () => {
      const state = hooks.current();
      return state.snapshot
        ? { generation: state.snapshot.meta.generation, epoch: state.epoch }
        : null;
    });
  }
  get pendingCount() {
    return this.pending.size;
  }
  clear() {
    this.pending.clear();
  }
  private check(epoch: number, generation?: string) {
    const state = this.hooks.current();
    if (state.epoch !== epoch || (generation && state.snapshot?.meta.generation !== generation))
      throw new StorageError('S_GENERATION_STALE');
    if (!state.snapshot || !state.writable) throw new StorageError('S_STORAGE_UNAVAILABLE');
    if (state.rollback) throw new StorageError('S_DATE_INVALID');
    return state.snapshot;
  }
  begin = (exerciseId: string, source: string, sourceRevision: string, epoch: number) => {
    this.check(epoch);
    return this.authority.begin(exerciseId, source, sourceRevision);
  };
  invalidate = (lease: C6RunLease) => this.authority.invalidate(lease);
  recordLesson = (lessonId: string, confirmed: boolean, epoch: number) =>
    this.hooks.run(async () => {
      if (!this.index.lessons.some((l) => l[0] === lessonId))
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
      return this.record(
        lessonId,
        confirmed ? 'lesson.study-confirmed' : 'lesson.started',
        epoch,
        null,
        null,
      );
    });
  recordJudge = (lease: C6RunLease, result: C6Response, epoch: number) => {
    this.check(epoch);
    const fact = this.authority.accept(lease, result, this.hooks.clock());
    const data = this.authority.read(fact);
    return this.hooks.run(() =>
      this.record(
        data.exerciseId,
        data.attempt.status === 'passed' ? 'exercise.passed' : 'exercise.attempt-evaluated',
        epoch,
        fact,
        data.attempt,
      ),
    );
  };
  private async record(
    subjectId: string,
    eventType: LearningReceiptSummary['eventType'],
    epoch: number,
    fact: C6CourseFact | null,
    attempt: C6Attempt | null,
  ) {
    const snapshot = this.check(epoch),
      generation = snapshot.meta.generation;
    const at = attempt?.at ?? this.hooks.clock();
    if (!isUtcTime(at)) throw new StorageError('S_DATE_INVALID');
    await this.hooks.openDay(generation, at);
    this.check(epoch, generation);
    const state = await this.hooks.storage().readC6Course();
    const date = localDateAt(at, state.snapshot.meta.timeZone);
    const goal = state.snapshot.goals.find((g) => g.localDate === date);
    if (!goal) throw new StorageError('S_DATE_INVALID');
    const command: C6LearningCommand = {
      learnVersion: '2.0.0',
      generation,
      receipt: {
        eventId: attempt?.eventId ?? crypto.randomUUID(),
        eventType,
        subjectRef: { id: subjectId, version: '2.0.0' },
        packageRef: { ...this.index.packageRef },
        learningRevision: 1,
        occurredAt: at,
        localDate: date,
        goalVersion: goal.goalVersion,
        result:
          eventType === 'lesson.started'
            ? 'started'
            : eventType === 'lesson.study-confirmed'
              ? 'confirmed'
              : eventType === 'exercise.passed'
                ? 'passed'
                : 'failed',
        ...(eventType === 'exercise.attempt-evaluated'
          ? {
              resultCategory: attempt?.failure ?? 'program-error',
              failedCaseKey: attempt?.failedCaseKey ?? null,
            }
          : {}),
      } as LearningReceiptSummary,
    };
    this.pending.set(command, { epoch, fact, attempt });
    return this.commit(command);
  }
  private async commit(command: C6LearningCommand) {
    const context = this.pending.get(command);
    if (!context) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    try {
      this.check(context.epoch, command.generation);
      if (context.fact) this.authority.read(context.fact);
      this.hooks.saving();
      const current = await this.hooks.storage().readC6Course();
      const result = await this.hooks
        .storage()
        .commitC6Course(command.generation, current.snapshot.meta.revision, (state) => {
          this.check(context.epoch, command.generation);
          if (context.fact) this.authority.read(context.fact);
          return prepareC6Event(state, command, this.index, context.attempt, this.hooks.rewards);
        });
      this.pending.delete(command);
      return await this.hooks.saved(result, command.generation, context.epoch);
    } catch (error) {
      if (
        !['S_QUOTA', 'S_STORAGE_UNAVAILABLE', 'S_ABORTED', 'S_REVISION_CONFLICT'].includes(
          storageError(error).code,
        )
      )
        this.pending.delete(command);
      this.hooks.pendingChanged();
      this.hooks.failed(error);
      throw error;
    }
  }
  retry = async () => {
    for (const command of this.pending.keys()) await this.hooks.run(() => this.commit(command));
  };
  saveDraft = (
    draft: Omit<C6CourseDraft, 'draftVersion' | 'generation' | 'revision' | 'updatedAt'>,
    expectedDocumentRevision: number,
    epoch: number,
  ) =>
    this.hooks.run(async () => {
      const snapshot = this.check(epoch),
        generation = snapshot.meta.generation;
      try {
        const current = await this.hooks.storage().readC6Course();
        this.check(epoch, generation);
        const result = await this.hooks
          .storage()
          .commitC6Course(generation, current.snapshot.meta.revision, (state) => {
            this.check(epoch, generation);
            const previous = state.rows.drafts.find((d) => d.documentId === draft.documentId);
            if ((previous?.revision ?? 0) !== expectedDocumentRevision)
              throw new StorageError('S_REVISION_CONFLICT');
            return {
              operations: [],
              draft: {
                ...draft,
                draftVersion: '2.0.0',
                generation,
                revision: state.snapshot.meta.revision + 1,
                updatedAt: this.hooks.clock(),
              },
            };
          });
        return await this.hooks.saved(result, generation, epoch);
      } catch (error) {
        this.hooks.failed(error);
        throw error;
      }
    });
  deleteDraft = (documentId: string, expectedDocumentRevision: number, epoch: number) =>
    this.hooks.run(async () => {
      const snapshot = this.check(epoch),
        generation = snapshot.meta.generation;
      const current = await this.hooks.storage().readC6Course();
      const result = await this.hooks
        .storage()
        .commitC6Course(generation, current.snapshot.meta.revision, (state) => {
          this.check(epoch, generation);
          if (
            state.rows.drafts.find((d) => d.documentId === documentId)?.revision !==
            expectedDocumentRevision
          )
            throw new StorageError('S_REVISION_CONFLICT');
          return { operations: [], deleteDraftId: documentId };
        });
      return this.hooks.saved(result, generation, epoch);
    });
}
