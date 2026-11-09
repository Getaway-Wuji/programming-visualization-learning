import type { MysqlResponse } from '../engine/mysql-types';
import { applyMysqlLearningEvent } from './domain';
import {
  mysqlExercise,
  mysqlPackageRef,
  isMysqlDocument,
  isMysqlLesson,
} from '../mysql-course/identities';
import type { LearningReceiptSummary } from './types';
import type { SaveResult, StorageClient, StorageMutation } from '../storage/client';
import type { StorageSnapshot } from '../storage/model';
import {
  assertMysqlDraftInput,
  mysqlAttemptCategory,
  type MysqlDraftInput,
  type MysqlAttempt,
  type MysqlCourseActivity,
  type PrepareMysqlCourse,
} from '../storage/mysql-course';
import { StorageError } from '../storage/errors';
import { localDateAt, isSafeUint } from '../storage/validation';
import { canonicalMysqlJson } from '../engine/mysql-data';

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

export class MysqlLearningSession {
  private occurrences = new WeakMap<
    MysqlResponse,
    { at: string; generation: string; epoch: number }
  >();
  constructor(private readonly hooks: SessionHooks) {}

  private readCourse(storage: StorageClient) {
    return storage.readMysqlCourse();
  }

  private commitCourse(
    storage: StorageClient,
    generation: string,
    revision: number,
    prepare: PrepareMysqlCourse,
  ) {
    return storage.commitMysqlCourse(generation, revision, prepare);
  }

  private meta(epoch: number, generation?: string) {
    const state = this.hooks.current();
    if (state.epoch !== epoch || (generation && generation !== state.snapshot?.meta.generation))
      throw new StorageError('S_GENERATION_STALE');
    if (!state.writable || !state.snapshot || state.snapshot.meta.dbVersion < 15)
      throw new StorageError('S_STORAGE_UNAVAILABLE');
    return state.snapshot.meta;
  }

  async read(epoch: number) {
    const { generation } = this.meta(epoch);
    const current = await this.readCourse(this.hooks.storage());
    this.meta(epoch, generation);
    if (current.snapshot.meta.generation !== generation)
      throw new StorageError('S_GENERATION_STALE');
    return current.rows;
  }

  async readActivities(epoch: number) {
    return (await this.read(epoch)).activities;
  }
  async readDraft(id: string, epoch: number) {
    if (!isMysqlDocument(id)) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    return (await this.read(epoch)).drafts.find((draft) => draft.documentId === id) ?? null;
  }

  recordLesson(id: string, epoch: number, at = this.hooks.clock()) {
    if (!isMysqlLesson(id)) return Promise.reject(new StorageError('S_CONTENT_INCOMPATIBLE'));
    return this.record(id, epoch, at, null);
  }

  async recordJudge(id: string, response: MysqlResponse, epoch: number, revision: string) {
    if (!mysqlExercise(id)) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const { generation } = this.meta(epoch);
    const { currentMysqlExecution } = await import('../engine/mysql-client');
    const guard = () => {
      this.meta(epoch, generation);
      const proof = currentMysqlExecution(response);
      if (
        proof?.request.operation !== 'judge' ||
        proof.request.profile !== id ||
        proof.request.sourceRevision !== revision ||
        proof.request.runId !== response.identity.runId ||
        response.identity.sourceRevision !== revision ||
        response.operation !== 'judge'
      )
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
    };
    guard();
    const result = response.judgement;
    if (
      !result ||
      response.status !== 'completed' ||
      !result.complete ||
      result.cases.length !== 4 ||
      new Set(result.cases.map((group) => group.index)).size !== 4 ||
      result.cases.some(
        (group) =>
          !Number.isInteger(group.index) ||
          group.index < 0 ||
          group.index > 3 ||
          group.status === 'limited' ||
          group.reason === 'limited',
      )
    )
      return null;
    const first = result.cases.find((group) => !group.passed);
    if (result.passed !== !first) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const occurrence = this.occurrences.get(response) ?? {
      at: this.hooks.clock(),
      generation,
      epoch,
    };
    if (occurrence.generation !== generation || occurrence.epoch !== epoch)
      throw new StorageError('S_GENERATION_STALE');
    this.occurrences.set(response, occurrence);
    const attempt: MysqlAttempt = {
      eventId: response.identity.runId,
      at: occurrence.at,
      status: first ? 'failed' : 'passed',
      caseCount: 4,
      failedCaseKey: first ? `case-${first.index + 1}` : null,
      category:
        first && first.reason !== 'passed' && first.reason !== 'limited'
          ? mysqlAttemptCategory(first.reason)
          : null,
      reason:
        first && first.reason !== 'passed' && first.reason !== 'limited' ? first.reason : null,
    };
    if (first && attempt.reason === null) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    return this.record(id, epoch, occurrence.at, attempt, guard);
  }

  private async record(
    id: string,
    epoch: number,
    at: string,
    attempt: MysqlAttempt | null,
    guard = () => {},
  ) {
    const { generation } = this.meta(epoch);
    if (this.hooks.current().rollback) throw new StorageError('S_DATE_INVALID');
    const eventId = attempt?.eventId ?? crypto.randomUUID();
    return this.hooks.run(async () => {
      this.meta(epoch, generation);
      guard();
      await this.hooks.openDay(generation, at);
      this.meta(epoch, generation);
      guard();
      const storage = this.hooks.storage();
      const current = await this.readCourse(storage);
      this.meta(epoch, generation);
      guard();
      const saved = await this.commitCourse(
        storage,
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
            packageRef: mysqlPackageRef,
            subjectRef: { id, version: '1.0.0' },
            learningRevision: 1,
          };
          const operations = this.hooks.rewards(
            applyMysqlLearningEvent(snapshot, {
              generation,
              receipt,
            }),
          );
          const base = {
            activityVersion: '1.0.0' as const,
            generation,
            subjectRef: receipt.subjectRef,
            revision: snapshot.meta.revision + 1,
          };
          const previous = rows.activities.find((row) => row.subjectRef.id === id);
          const firstAt = (eventType: 'lesson.study-confirmed' | 'lesson.completed') =>
            operations.find((op) => op.store === 'progress' && op.value.eventType === eventType)
              ?.value;
          let activity: MysqlCourseActivity;
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

  async saveDraft(id: string, input: MysqlDraftInput, expectedDraft: number | null, epoch: number) {
    if (!isMysqlDocument(id)) throw new StorageError('S_CONTENT_INCOMPATIBLE');
    if (expectedDraft !== null && (!isSafeUint(expectedDraft) || expectedDraft === 0))
      throw new StorageError('S_RECORD_INVALID');
    // Capture both inputs synchronously before the queue can yield to another edit.
    assertMysqlDraftInput(input);
    const captured = structuredClone(input);
    const capturedJson = canonicalMysqlJson(captured);
    const { generation } = this.meta(epoch);
    return this.hooks.run(async () => {
      this.meta(epoch, generation);
      const storage = this.hooks.storage();
      const { snapshot } = await this.readCourse(storage);
      this.meta(epoch, generation);
      const saved = await this.commitCourse(
        storage,
        generation,
        snapshot.meta.revision,
        (state) => {
          this.meta(epoch, generation);
          const prior = state.rows.drafts.find((row) => row.documentId === id);
          if ((prior?.revision ?? null) !== expectedDraft)
            throw new StorageError('S_REVISION_CONFLICT');
          if (
            prior &&
            canonicalMysqlJson({ source: prior.source, session: prior.session }) === capturedJson
          )
            return { operations: [] };
          return {
            operations: [],
            draft: {
              draftVersion: '1.0.0',
              generation,
              documentId: id,
              ...captured,
              revision: state.snapshot.meta.revision + 1,
              updatedAt: this.hooks.clock(),
            },
          };
        },
      );
      await this.hooks.saved(saved, generation, epoch);
      const current = await this.read(epoch);
      const savedDraft = current.drafts.find((row) => row.documentId === id);
      if (
        !savedDraft ||
        canonicalMysqlJson({ source: savedDraft.source, session: savedDraft.session }) !==
          capturedJson
      )
        throw new StorageError('S_REVISION_CONFLICT');
      return savedDraft;
    });
  }
}
