import type { JavaResponse } from '../engine/java-types';
import { applyJavaLearningEvent } from '../learning/domain';
import type { LearningReceiptSummary } from '../learning/types';
import type { SaveResult, StorageClient, StorageMutation } from '../storage/client';
import type { StorageSnapshot } from '../storage/model';
import type { JavaAttempt, JavaCourseActivity } from '../storage/java-course';
import { StorageError } from '../storage/errors';
import { localDateAt } from '../storage/validation';
import { isJavaDocument, isJavaLesson, javaExercise, javaPackageRef } from './identities';

interface SessionHooks {
  current: () => {
    epoch: number;
    snapshot: StorageSnapshot | null;
    writable: boolean;
    rollback: boolean;
  };
  storage: () => StorageClient;
  run: <T>(action: () => Promise<T>) => Promise<T>;
  openDay: (generation: string, at: string) => Promise<void>;
  saved: (result: SaveResult, generation: string, epoch: number) => Promise<SaveResult>;
  rewards: (operations: StorageMutation[]) => StorageMutation[];
  clock: () => string;
}

export class JavaLearningSession {
  private occurrences = new WeakMap<
    JavaResponse,
    { at: string; generation: string; epoch: number }
  >();
  constructor(private readonly hooks: SessionHooks) {}

  private meta(epoch: number, generation?: string) {
    const state = this.hooks.current();
    if (state.epoch !== epoch || (generation && generation !== state.snapshot?.meta.generation))
      throw new StorageError('S_GENERATION_STALE');
    if (!state.writable || state.snapshot?.meta.dbVersion !== 12)
      throw new StorageError('S_STORAGE_UNAVAILABLE');
    return state.snapshot.meta;
  }

  async read(epoch: number) {
    const { generation } = this.meta(epoch);
    const current = await this.hooks.storage().readJavaCourse();
    this.meta(epoch, generation);
    if (current.snapshot.meta.generation !== generation)
      throw new StorageError('S_GENERATION_STALE');
    return current.rows;
  }

  recordLesson(id: string, epoch: number) {
    if (!isJavaLesson(id)) return Promise.reject(new StorageError('S_CONTENT_INCOMPATIBLE'));
    const at = this.hooks.clock();
    return this.record(id, epoch, at, null);
  }

  async recordJudge(id: string, response: JavaResponse, epoch: number, revision: string) {
    if (!javaExercise(id)) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const { generation } = this.meta(epoch);
    const { currentJavaExecution } = await import('../engine/java-client');
    const guard = () => {
      this.meta(epoch, generation);
      const proof = currentJavaExecution(response);
      if (
        proof?.request.operation.kind !== 'judge' ||
        proof.request.operation.profileRef.id !== id ||
        proof.request.sourceRevision !== revision
      )
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
    };
    guard();
    const result = response.result;
    if (
      result.kind !== 'judge' ||
      result.profileRef.id !== id ||
      result.status === 'incomplete' ||
      result.cases.length !== 4 ||
      result.cases.some(({ packet }) => ['limited', 'cancelled'].includes(packet.terminal.status))
    )
      return null;
    const first = result.cases.find(
      (c) => c.packet.terminal.status !== 'completed' || !c.stdoutMatches || !c.observationMatches,
    );
    if ((result.status === 'passed') !== !first) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const occurrence = this.occurrences.get(response) ?? {
      at: this.hooks.clock(),
      generation,
      epoch,
    };
    if (occurrence.generation !== generation || occurrence.epoch !== epoch)
      throw new StorageError('S_GENERATION_STALE');
    this.occurrences.set(response, occurrence);
    const attempt: JavaAttempt = {
      eventId: response.runId,
      at: occurrence.at,
      status: result.status,
      caseCount: result.cases.length,
      failedCaseKey: first ? 'case-' + first.caseKey : null,
      category: !first
        ? null
        : first.packet.terminal.status !== 'completed'
          ? 'program-error'
          : first.stdoutMatches
            ? 'teaching-goal-unmet'
            : 'wrong-answer',
    };
    return this.record(id, epoch, occurrence.at, attempt, guard);
  }

  private async record(
    id: string,
    epoch: number,
    at: string,
    attempt: JavaAttempt | null,
    guard = () => {},
  ) {
    const { generation } = this.meta(epoch);
    if (this.hooks.current().rollback) throw new StorageError('S_DATE_INVALID');
    const eventId = attempt?.eventId ?? crypto.randomUUID();
    return this.hooks.run(async () => {
      this.meta(epoch, generation);
      guard();
      await this.hooks.openDay(generation, at);
      const storage = this.hooks.storage();
      const current = await storage.readJavaCourse();
      const saved = await storage.commitJavaCourse(
        generation,
        current.snapshot.meta.revision,
        ({ snapshot, rows }) => {
          this.meta(epoch, generation);
          guard();
          const localDate = localDateAt(at, snapshot.meta.timeZone);
          const goal = snapshot.goals.find((g) => g.localDate === localDate);
          if (!goal) throw new StorageError('S_DATE_INVALID');
          if (
            !attempt &&
            snapshot.dailyFacts.some(
              (fact) =>
                fact.localDate === localDate &&
                fact.eventType === 'lesson.completed' &&
                fact.subjectRef.id === id,
            )
          )
            return { operations: [] };
          const event = !attempt
            ? ({ eventType: 'lesson.study-confirmed', result: 'confirmed' } as const)
            : attempt.status === 'passed'
              ? ({ eventType: 'exercise.passed', result: 'passed' } as const)
              : ({
                  eventType: 'exercise.attempt-evaluated',
                  result: 'failed',
                  resultCategory: attempt.category!,
                  failedCaseKey: attempt.failedCaseKey,
                } as const);
          const receipt: LearningReceiptSummary = {
            ...event,
            eventId,
            goalVersion: goal.goalVersion,
            occurredAt: at,
            localDate,
            packageRef: javaPackageRef,
            subjectRef: { id, version: '1.0.0' },
            learningRevision: 1,
          };
          const operations = this.hooks.rewards(
            applyJavaLearningEvent(snapshot, { generation, receipt }),
          );
          const base = {
            activityVersion: '2.2.0' as const,
            generation,
            subjectRef: receipt.subjectRef,
            revision: snapshot.meta.revision + 1,
          };
          const previous = rows.activities.find((row) => row.subjectRef.id === id);
          const firstAt = (eventType: 'lesson.study-confirmed' | 'lesson.completed') =>
            operations.find((op) => op.store === 'progress' && op.value.eventType === eventType)
              ?.value;
          let activity: JavaCourseActivity;
          if (attempt) {
            const old = previous?.kind === 'exercise' ? previous : null;
            const firstPass =
              attempt.status === 'passed' && (!old?.firstPass || attempt.at < old.firstPass.at)
                ? attempt
                : (old?.firstPass ?? null);
            activity = {
              ...base,
              kind: 'exercise',
              latestAttempt: old && old.latestAttempt.at > attempt.at ? old.latestAttempt : attempt,
              firstPass,
            };
          } else {
            const old = previous?.kind === 'lesson' ? previous : null;
            const recorded = (
              type: 'lesson.study-confirmed' | 'lesson.completed',
              fallback: string,
            ) => {
              const row = firstAt(type);
              return row && 'firstAt' in row ? row.firstAt : fallback;
            };
            activity = {
              ...base,
              kind: 'lesson',
              readAt: recorded('lesson.study-confirmed', old?.readAt ?? at),
              completedAt: recorded('lesson.completed', old?.completedAt ?? at),
            };
          }
          return { receipt, operations, activities: [activity] };
        },
      );
      return this.hooks.saved(saved, generation, epoch);
    });
  }

  async saveDraft(id: string, source: string, expectedDraft: number | null, epoch: number) {
    if (!isJavaDocument(id)) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const { generation } = this.meta(epoch);
    return this.hooks.run(async () => {
      const storage = this.hooks.storage();
      const { snapshot } = await storage.readJavaCourse();
      const saved = await storage.commitJavaCourse(generation, snapshot.meta.revision, (state) => {
        this.meta(epoch, generation);
        const prior = state.rows.drafts.find((row) => row.documentId === id);
        if ((prior?.revision ?? null) !== expectedDraft)
          throw new StorageError('S_REVISION_CONFLICT');
        if (prior?.source === source) return { operations: [] };
        return {
          operations: [],
          draft: {
            draftVersion: '2.2.0',
            generation,
            documentId: id,
            source,
            revision: state.snapshot.meta.revision + 1,
            updatedAt: this.hooks.clock(),
          },
        };
      });
      await this.hooks.saved(saved, generation, epoch);
      const current = await this.read(epoch);
      const savedDraft = current.drafts.find((row) => row.documentId === id);
      if (savedDraft?.source !== source) throw new StorageError('S_REVISION_CONFLICT');
      return savedDraft;
    });
  }
}
