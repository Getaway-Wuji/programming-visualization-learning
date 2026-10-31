import { achievementPassSources, type AchievementEvidence } from '../achievements/model';
import { readChallengeFact, type ChallengeFact } from '../challenges/authority';
import { prepareChallengeAnswer, type ChallengeReceiptSummary } from '../challenges/domain';
import { observationSubject, type ObservationFact } from '../achievements/observation';
import { loadCourseReading, type CourseReading } from '../content/reading';
import { loadCourseLearning } from '../content/course-learning';
import { caseLearningCatalog } from '../content/case-learning';
import { openStorage as openDatabase } from '../storage/client';
import type { StorageClient, SaveResult } from '../storage/client';
import type { EditorHistoryContext, EditorSnapshotDraft } from '../storage/editor-history';
import type {
  Appearance,
  Avatar,
  GoalTargets,
  Progress,
  Ref,
  Settings,
  StorageSnapshot,
} from '../storage/model';
import { createMeta, emptySnapshot, recordKey } from '../storage/model';
import { assertAttemptFact } from './attempt-authority';
import type { KnowledgeMarkCommand } from '../storage/knowledge-marks';
import type { ReviewCommand } from '../review-scheduler/model';
import { reviewSources } from '../review-scheduler/sources';
import type { RecoveryRead } from '../storage/recovery';
import { StorageError, storageError } from '../storage/errors';
import { assertGoalTargets, assertRecord, isUtcTime, localDateAt } from '../storage/validation';
import { createLearningCatalog, sameRef } from './catalog';
import {
  applyLearningEvent,
  canonicalLearningId,
  isCompatibleLearningHistory,
  projectLearning,
} from './domain';
import type { LearningCatalog, LearningCommand, LearningProjection } from './types';
import {
  checkLearningEvent,
  readVerifiedFact,
  createLearningAuthority,
  retainAcceptedFact,
} from './authority';
import type { VerifiedFact } from './authority';
import { assertPracticePassFact } from './practice-authority';
import { isMemoryBugPassFact } from '../memory-bugs/authority';
import { assertCaseViewFact } from './case-authority';
import {
  hasReviewedCaseRelease,
  hasReviewedCourseAssembly,
  reviewedCasePackage,
  reviewedCoursePackage,
  reviewedCourseHistory,
  reviewedCourseSnapshot,
  reviewedDurableSnapshot,
  reviewedHistory,
  reviewedSnapshot,
} from './reviewed-release';
import {
  decodeProfileConfiguration,
  loadProfileConfiguration,
  type ProfileConfiguration,
} from './profile';
import {
  decodeRewardPolicy,
  loadRewardPolicy,
  postNewRewards,
  prepareRewardSettlement,
  type RewardPolicy,
} from './rewards';
import {
  assertConfiguredTargets,
  decodeGoalConfiguration,
  loadGoalConfiguration,
  decodeDailyGoalRewardPolicy,
  loadDailyGoalRewardPolicy,
  postNewDailyGoalRewards,
  prepareDailyGoalRewardSettlement,
  type GoalConfiguration,
  type DailyGoalRewardPolicy,
} from './goals';

export interface LearningServiceState {
  profileStatus?: 'loading' | 'ready' | 'failed' | 'disabled';
  profileError?: string | null;
  profileConfiguration?: ProfileConfiguration | null;
  goalStatus?: 'loading' | 'ready' | 'failed' | 'disabled';
  goalError?: string | null;
  goalConfiguration?: GoalConfiguration | null;
  clockStatus?: 'normal' | 'rollback';
  rewardStatus?: 'loading' | 'ready' | 'failed' | 'disabled';
  rewardError?: string | null;
  reading?: CourseReading | null;
  readingStatus?: 'loading' | 'ready' | 'failed';
  readingError?: string | null;
  practiceCatalog?: LearningCatalog | null;
  practiceStatus?: 'loading' | 'ready' | 'failed';
  practiceError?: string | null;
  status: 'loading' | 'ready' | 'saving' | 'unsaved' | 'conflict' | 'readonly';
  snapshot: StorageSnapshot | null;
  projection: LearningProjection | null;
  errorCode: string | null;
  lastSaved: boolean;
  capabilities: { learning: boolean; goalsConfigurable: boolean; avatarPresets: readonly string[] };
  timeZoneFallback: boolean;
  recovery: Omit<RecoveryRead, 'snapshot' | 'guard'> | null;
  temporary: boolean;
  pendingCount: number;
  sessionEpoch: number;
  cleared: boolean;
  appearanceReadOnly?: boolean;
  appearanceCanReset?: boolean;
  appearanceError?: string | null;
}
interface ServiceOptions {
  loadProfileConfig?: () => Promise<ProfileConfiguration>;
  loadGoalConfig?: () => Promise<GoalConfiguration>;
  loadDailyGoalPolicy?: () => Promise<DailyGoalRewardPolicy>;
  loadRewardPolicy?: () => Promise<RewardPolicy>;
  loadReading?: () => Promise<CourseReading>;
  loadPractice?: (reading: CourseReading) => Promise<LearningCatalog>;
  catalog?: LearningCatalog;
  openStorage?: () => Promise<StorageClient>;
  clock?: () => string;
  id?: () => string;
}
const packageRef = { id: 'content.c.p0', version: '1.0.0' };
const unavailableCatalog = (): LearningCatalog =>
  createLearningCatalog({
    purpose: 'contract-fixture',
    packageRef,
    lessons: [],
    exercises: [],
    cases: [],
  });
const initial: LearningServiceState = {
  profileStatus: 'loading',
  profileError: null,
  profileConfiguration: null,
  goalStatus: 'loading',
  goalError: null,
  goalConfiguration: null,
  clockStatus: 'normal',
  rewardStatus: 'loading',
  rewardError: null,
  reading: null,
  readingStatus: 'loading',
  readingError: null,
  practiceCatalog: null,
  practiceStatus: 'loading',
  practiceError: null,
  status: 'loading',
  snapshot: null,
  projection: null,
  errorCode: null,
  lastSaved: false,
  capabilities: { learning: false, goalsConfigurable: false, avatarPresets: ['avatar.basic.01'] },
  timeZoneFallback: false,
  recovery: null,
  temporary: false,
  pendingCount: 0,
  sessionEpoch: 0,
  cleared: false,
  appearanceReadOnly: false,
  appearanceCanReset: false,
  appearanceError: null,
};
const readonlyCodes = new Set([
  'S_VERSION_UNKNOWN',
  'S_MIGRATION_UNSUPPORTED',
  'S_RECORD_INVALID',
  'S_DATE_INVALID',
]);

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// This class and its command methods are storage internals. The public index
// exposes only state/settings capability; it never exposes a learning issuer.
export class LearningService {
  private state: LearningServiceState = initial;
  private listeners = new Set<() => void>();
  private client: StorageClient | undefined;
  private catalog: LearningCatalog;
  private rewardPolicy: RewardPolicy | undefined;
  private dailyGoalPolicy: DailyGoalRewardPolicy | undefined;
  private goalConfiguration: GoalConfiguration | undefined;
  private profileConfiguration: ProfileConfiguration | undefined;
  private readonly profileEnabled: boolean;
  private profileRequest = 0;
  private readonly goalsEnabled: boolean;
  private goalLoading: Promise<void> | undefined;
  private goalConfigurationRequest = 0;
  private observedTime = 0;
  private readonly rewardsEnabled: boolean;
  private readingRequest = 0;
  private lessonActions = new Map<string, Promise<void>>();
  private starting: Promise<void> | undefined;
  private disposed = false;
  private serial: Promise<unknown> = Promise.resolve();
  private recoveryGuard: string | undefined;
  private invalidationCleanup: (() => void) | undefined;
  private sessionListeners = new Set<() => void>();
  private pendingCommands = new Set<LearningCommand>();
  private pendingFacts = new Set<VerifiedFact>();
  private pendingChallengeFacts = new Set<ChallengeFact>();
  private challengeCaptures = new WeakMap<
    ChallengeFact,
    {
      context: EditorHistoryContext;
      eventId: string;
      at: string;
      receipt?: ChallengeReceiptSummary;
    }
  >();
  private temporarySnapshot: StorageSnapshot | undefined;
  private isolatedTemporarySnapshot: StorageSnapshot | undefined;
  private memorySession = 0;
  private memorySessionActive = false;
  private reviewedSwitchFailure: StorageError | null = null;
  private commands = new WeakMap<
    object,
    {
      fact: VerifiedFact;
      catalog: LearningCatalog;
      epoch: number;
      memoryOnly: boolean;
      memorySession: number;
      activePackageRef: Ref;
    }
  >();
  private captures = new WeakMap<
    object,
    {
      at: string;
      eventId: string;
      generation: string;
      epoch: number;
      memoryOnly: boolean;
      memorySession: number;
      activePackageRef: Ref;
      pending?: Promise<LearningCommand>;
      command?: LearningCommand;
    }
  >();
  constructor(private readonly options: ServiceOptions = {}) {
    this.rewardsEnabled = !options.catalog || !!options.loadRewardPolicy;
    this.goalsEnabled = !options.catalog || !!options.loadGoalConfig;
    this.profileEnabled = !options.catalog || !!options.loadProfileConfig;
    this.state = {
      ...initial,
      rewardStatus: this.rewardsEnabled || this.goalsEnabled ? 'loading' : 'disabled',
      goalStatus: this.goalsEnabled ? 'loading' : 'disabled',
      profileStatus: this.profileEnabled ? 'loading' : 'disabled',
    };
    this.catalog = options.catalog ? createLearningCatalog(options.catalog) : unavailableCatalog();
    if (this.catalog.purpose === 'course-practice')
      this.state = { ...this.state, practiceCatalog: this.catalog, practiceStatus: 'ready' };
  }
  private achievementObservations = new WeakMap<
    ObservationFact,
    { context: EditorHistoryContext; evidence: AchievementEvidence }
  >();
  getState = (): LearningServiceState => this.state;
  recordChallengeAnswer = (
    fact: ChallengeFact,
    expectedEpoch: number,
  ): Promise<SaveResult & { firstAnswer: boolean; points: number }> => {
    let captured: NonNullable<ReturnType<typeof this.challengeCaptures.get>>;
    try {
      if (expectedEpoch !== this.state.sessionEpoch || this.disposed)
        throw new StorageError('S_GENERATION_STALE');
      const prior = this.challengeCaptures.get(fact);
      const context = prior?.context ?? this.editorHistoryContext();
      if (!context) throw new StorageError('S_STORAGE_UNAVAILABLE');
      this.checkEditorHistory(context);
      if (!this.state.capabilities.learning || this.state.recovery?.writable === false)
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
      if (!prior && this.state.clockStatus === 'rollback') throw new StorageError('S_DATE_INVALID');
      readChallengeFact(fact, true);
      captured = prior ?? {
        context: structuredClone(context),
        eventId: (this.options.id ?? (() => crypto.randomUUID()))(),
        at: (this.options.clock ?? (() => new Date().toISOString()))(),
      };
      this.challengeCaptures.set(fact, captured);
    } catch (error) {
      return Promise.reject(storageError(error));
    }
    return this.enqueue(async () => {
      const { context } = captured;
      try {
        this.checkEditorHistory(context);
        if (!captured.receipt) {
          await this.openDay(
            context.generation,
            captured.at,
            this.caseCatalog(),
            context.activePackageRef,
          );
          this.checkEditorHistory(context);
          const snapshot = await this.storage().read();
          if (snapshot.meta.generation !== context.generation)
            throw new StorageError('S_GENERATION_STALE');
          const localDate = localDateAt(captured.at, snapshot.meta.timeZone);
          const goal = snapshot.goals.find((g) => g.localDate === localDate);
          if (!goal) throw new StorageError('S_DATE_INVALID');
          captured.receipt = {
            ...readChallengeFact(fact),
            eventId: captured.eventId,
            occurredAt: captured.at,
            localDate,
            goalVersion: goal.goalVersion,
          };
        }
        this.checkEditorHistory(context);
        const receipt = captured.receipt;
        this.publish({ status: 'saving', lastSaved: false, errorCode: null, cleared: false });
        const result = await this.storage().commitOnce(
          { generation: context.generation, receipt },
          (snapshot) => {
            this.checkEditorHistory(context);
            this.assertCurrentPackage(snapshot, context.activePackageRef);
            readChallengeFact(fact);
            return prepareChallengeAnswer(snapshot, receipt);
          },
        );
        this.pendingChallengeFacts.delete(fact);
        const saved = await this.savedRead(result, context.generation, context.epoch);
        const first = this.state.snapshot?.receipts
          .filter(
            (r) =>
              r.eventType === 'challenge.answered' && r.subjectRef.id === receipt.subjectRef.id,
          )
          .sort((a, b) => a.committedRevision - b.committedRevision)[0];
        return {
          ...saved,
          firstAnswer: first?.eventId === captured.eventId,
          points: first?.eventId === captured.eventId ? (receipt.result === 'correct' ? 2 : -1) : 0,
        };
      } catch (error) {
        const code = storageError(error).code;
        if (context.epoch === this.state.sessionEpoch) {
          if (['S_QUOTA', 'S_STORAGE_UNAVAILABLE', 'S_ABORTED'].includes(code))
            this.pendingChallengeFacts.add(fact);
          this.fail(error);
          this.publish({ pendingCount: this.pendingCount() });
          if (code === 'S_GENERATION_STALE') {
            this.invalidateSession();
            void this.refresh({ preserveOutcome: true });
          }
        }
        throw storageError(error);
      }
    });
  };
  syncAchievements = async (context: EditorHistoryContext, fact?: ObservationFact) => {
    this.checkEditorHistory(context);
    const catalog = this.state.practiceCatalog;
    if (!catalog || !this.state.capabilities.learning)
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    let observation: AchievementEvidence | undefined;
    if (fact) {
      const subjectRef = observationSubject(fact);
      if (!subjectRef) throw new StorageError('S_RECORD_INVALID');
      let captured = this.achievementObservations.get(fact);
      if (!captured) {
        if (this.state.clockStatus === 'rollback') throw new StorageError('S_DATE_INVALID');
        captured = {
          context: structuredClone(context),
          evidence: {
            kind: 'observation',
            eventId: crypto.randomUUID(),
            subjectRef,
            learningRevision: 1,
            occurredAt: (this.options.clock ?? (() => new Date().toISOString()))(),
          },
        };
        this.achievementObservations.set(fact, captured);
      }
      this.checkEditorHistory(captured.context);
      if (
        captured.context.generation !== context.generation ||
        captured.context.epoch !== context.epoch
      )
        throw new StorageError('S_GENERATION_STALE');
      observation = captured.evidence;
    }
    const result = await this.storage().syncAchievements(
      context,
      (snapshot) => achievementPassSources(snapshot, catalog),
      observation,
    );
    this.checkEditorHistory(context);
    if (result.changed) await this.refresh({ preserveOutcome: true });
    this.checkEditorHistory(context);
    return result.rows;
  };
  syncReviewCards = async (context: EditorHistoryContext, command?: ReviewCommand) => {
    this.checkEditorHistory(context);
    const reading = this.state.reading,
      catalog = this.state.practiceCatalog;
    if (!reading || !catalog || !this.state.capabilities.learning)
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    if (command && this.state.clockStatus === 'rollback') throw new StorageError('S_DATE_INVALID');
    const at = (this.options.clock ?? (() => new Date().toISOString()))();
    const result = await this.storage().syncReviewCards(
      context,
      (snapshot, marks) => reviewSources(snapshot, marks, catalog, reading),
      at,
      command,
    );
    this.checkEditorHistory(context);
    if (result.changed) await this.refresh({ preserveOutcome: true });
    this.checkEditorHistory(context);
    return result.rows;
  };
  readKnowledgeMarks = async (context: EditorHistoryContext) => {
    if (context.epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
    return this.storage().readKnowledgeMarks(context);
  };
  saveKnowledgeMark = async (context: EditorHistoryContext, command: KnowledgeMarkCommand) => {
    if (context.epoch !== this.state.sessionEpoch || this.disposed)
      throw new StorageError('S_GENERATION_STALE');
    const reading = this.state.reading,
      lesson = reading?.lessons.find(
        (l) => l.id === command.lessonRef.id && l.version === command.lessonRef.version,
      );
    if (
      !this.state.capabilities.learning ||
      !reading ||
      !lesson ||
      command.packageRef.id !== reading.packageRef.id ||
      command.packageRef.version !== reading.packageRef.version ||
      !lesson.knowledgeRefs.some(
        (k) => k.id === command.knowledgeRef.id && k.version === command.knowledgeRef.version,
      )
    )
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const rows = await this.storage().saveKnowledgeMark(context, command);
    if (context.epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
    await this.refresh({ preserveOutcome: true });
    if (
      context.epoch !== this.state.sessionEpoch ||
      this.state.snapshot?.meta.generation !== context.generation
    )
      throw new StorageError('S_GENERATION_STALE');
    return rows;
  };
  recordPracticeAttempt = (fact: VerifiedFact, expectedEpoch: number): Promise<SaveResult> => {
    try {
      if (this.disposed || expectedEpoch !== this.state.sessionEpoch)
        throw new StorageError('S_GENERATION_STALE');
      assertAttemptFact(fact);
      return this.capture(fact).then((command) => this.commitCommand(command));
    } catch (error) {
      return Promise.reject(storageError(error));
    }
  };
  editorHistoryContext = (): EditorHistoryContext | null => {
    const meta = this.state.snapshot?.meta;
    return meta && this.client && !this.disposed && this.state.status !== 'readonly'
      ? {
          generation: meta.generation,
          activePackageRef: { ...meta.activePackageRef },
          epoch: this.state.sessionEpoch,
        }
      : null;
  };
  private checkEditorHistory(context: EditorHistoryContext) {
    const current = this.editorHistoryContext();
    if (!current || context.epoch !== current.epoch || context.generation !== current.generation)
      throw new StorageError('S_GENERATION_STALE');
    if (!sameRef(context.activePackageRef, current.activePackageRef))
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
  }
  readEditorHistory = async (context: EditorHistoryContext) => {
    this.checkEditorHistory(context);
    const result = await this.storage().readEditorHistory(context);
    this.checkEditorHistory(context);
    return result;
  };
  saveEditorHistory = async (
    context: EditorHistoryContext,
    record: EditorSnapshotDraft,
    updateOnly: boolean,
  ) => {
    this.checkEditorHistory(context);
    const result = await this.storage().saveEditorHistory(context, record, updateOnly);
    this.checkEditorHistory(context);
    return result;
  };
  private caseCatalog(): LearningCatalog {
    try {
      return caseLearningCatalog(
        sameRef(this.catalog.packageRef, reviewedCoursePackage)
          ? reviewedCoursePackage
          : reviewedCasePackage,
      );
    } catch {
      // A withdrawn/unavailable course bundle cannot turn into a storage
      // outage or borrow the independent old cases for a new package.
      return createLearningCatalog({
        purpose: 'case-view',
        packageRef: this.catalog.packageRef,
        lessons: [],
        exercises: [],
        cases: [],
      });
    }
  }
  private usesReviewedCourseRelease(): boolean {
    return !this.options.catalog && hasReviewedCourseAssembly(this.catalog, this.caseCatalog());
  }
  private usesReviewedCaseRelease(): boolean {
    return (
      !this.options.catalog &&
      !sameRef(this.catalog.packageRef, reviewedCoursePackage) &&
      hasReviewedCaseRelease(this.caseCatalog())
    );
  }
  private learningSnapshot(snapshot: StorageSnapshot): StorageSnapshot {
    if (this.usesReviewedCourseRelease())
      return reviewedCourseSnapshot(snapshot, this.catalog, this.caseCatalog());
    if (!this.options.catalog && sameRef(this.catalog.packageRef, reviewedCoursePackage))
      return reviewedDurableSnapshot(snapshot, this.catalog);
    return this.usesReviewedCaseRelease()
      ? reviewedSnapshot(snapshot, this.catalog, this.caseCatalog())
      : snapshot;
  }
  private pendingCount(): number {
    return (
      this.pendingCommands.size +
      this.pendingFacts.size +
      this.pendingChallengeFacts.size +
      Number(!!this.reviewedSwitchFailure)
    );
  }
  private assertCurrentPackage(snapshot: StorageSnapshot, expected?: Ref): void {
    if (expected && !sameRef(snapshot.meta.activePackageRef, expected))
      throw new StorageError('S_GENERATION_STALE');
    if (
      !this.options.catalog &&
      sameRef(this.catalog.packageRef, reviewedCoursePackage) &&
      (!this.usesReviewedCourseRelease() ||
        !sameRef(snapshot.meta.activePackageRef, reviewedCoursePackage))
    )
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    if (
      this.usesReviewedCaseRelease() &&
      !sameRef(snapshot.meta.activePackageRef, reviewedCasePackage)
    )
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
  }
  private async ensureReviewedCaseRelease(explicitRetry: boolean): Promise<void> {
    if (this.state.recovery?.writable === false) return;
    const expanded = this.usesReviewedCourseRelease();
    if (
      !this.options.catalog &&
      sameRef(this.catalog.packageRef, reviewedCoursePackage) &&
      !expanded
    )
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    if (!expanded && !this.usesReviewedCaseRelease()) return;
    const target = expanded ? reviewedCoursePackage : reviewedCasePackage;
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    if (sameRef(snapshot.meta.activePackageRef, target)) {
      const wasPending = !!this.reviewedSwitchFailure;
      this.reviewedSwitchFailure = null;
      if (wasPending) await this.readCurrent(false);
      return;
    }
    if (this.reviewedSwitchFailure && !explicitRetry) throw this.reviewedSwitchFailure;
    try {
      if (expanded)
        await this.storage().switchReviewedCourseRelease(
          snapshot.meta.generation,
          snapshot.meta.revision,
        );
      else
        await this.storage().switchReviewedCaseRelease(
          snapshot.meta.generation,
          snapshot.meta.revision,
        );
      this.reviewedSwitchFailure = null;
      await this.readCurrent(false);
    } catch (error) {
      this.reviewedSwitchFailure = storageError(error);
      this.publish({ pendingCount: this.pendingCount() });
      throw error;
    }
  }
  private project(snapshot: StorageSnapshot): LearningProjection {
    const fullSnapshot = snapshot;
    snapshot = this.learningSnapshot(snapshot);
    // Projection may include the independent case-view release. The command
    // catalog remains unchanged, so this never grants another fact issuer.
    const catalog =
      this.goalsEnabled && !this.options.catalog
        ? createLearningCatalog({ ...this.catalog, cases: [...this.caseCatalog().cases] })
        : this.catalog;
    const projection = projectLearning(fullSnapshot, catalog, snapshot.progress);
    if (!this.goalsEnabled) return projection;
    const courseAvailable = ['publishable', 'course-practice'].includes(this.catalog.purpose);
    const lessons = courseAvailable
      ? this.catalog.lessons
      : this.catalog.purpose === 'lesson-reading'
        ? this.catalog.lessons.filter((lesson) =>
            lesson.requiredExerciseRefs.every((ref) => {
              const exercise = this.catalog.exercises.find((value) => sameRef(value.ref, ref));
              return (
                !!exercise &&
                snapshot.progress.some(
                  (row) =>
                    row.eventType === 'exercise.passed' &&
                    isCompatibleLearningHistory(row, exercise, 'exercise', snapshot.aliases),
                )
              );
            }),
          )
        : [];
    const available = {
      exercise: courseAvailable ? this.catalog.exercises : [],
      lesson: lessons,
      case: !this.options.catalog
        ? this.caseCatalog().cases
        : this.catalog.purpose === 'publishable' || this.catalog.purpose === 'case-view'
          ? this.catalog.cases
          : [],
    };
    projection.goals = projection.goals.map((goal) => ({
      ...goal,
      reachable:
        goal.targets === null
          ? null
          : (['exercise', 'lesson', 'case'] as const).every((kind) => {
              const ids = new Set([
                ...available[kind].map((entity) =>
                  canonicalLearningId(snapshot.aliases, entity.ref.id),
                ),
                ...snapshot.dailyFacts
                  .filter(
                    (fact) =>
                      fact.localDate === goal.localDate && fact.eventType.startsWith(`${kind}.`),
                  )
                  .map((fact) => fact.canonicalSubjectId),
              ]);
              return goal.targets![kind] <= ids.size;
            }),
    }));
    return projection;
  }
  private observeTime(at: string, snapshot = this.state.snapshot): void {
    if (!this.goalsEnabled || !isUtcTime(at)) return;
    const historic = snapshot
      ? snapshot.receipts.reduce(
          (latest, row) => Math.max(latest, Date.parse(row.occurredAt)),
          snapshot.progress.reduce(
            (latest, row) => Math.max(latest, Date.parse(row.lastAt)),
            Date.parse(snapshot.meta.createdAt),
          ),
        )
      : 0;
    const time = Date.parse(at);
    const previous = Math.max(this.observedTime, historic);
    this.observedTime = Math.max(previous, time);
    this.publish({ clockStatus: time + 300_000 < previous ? 'rollback' : 'normal' });
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  subscribeSessionInvalidation = (listener: () => void): (() => void) => {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  };
  private invalidateSession(): void {
    this.pendingCommands.clear();
    this.pendingFacts.clear();
    this.pendingChallengeFacts.clear();
    this.temporarySnapshot = undefined;
    this.isolatedTemporarySnapshot = undefined;
    this.memorySessionActive = false;
    this.memorySession++;
    this.publish({
      sessionEpoch: this.state.sessionEpoch + 1,
      pendingCount: this.pendingCount(),
      temporary: false,
      projection: this.state.snapshot ? this.project(this.state.snapshot) : null,
      cleared: false,
    });
    for (const listener of this.sessionListeners) listener();
  }
  private publish(patch: Partial<LearningServiceState>): void {
    if (this.disposed) return;
    this.state = freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) listener();
  }
  start = (): Promise<void> => {
    if (this.disposed) return Promise.resolve();
    if (this.starting) return this.starting;
    const pending = this.initialize();
    this.starting = pending;
    void pending.finally(() => {
      if (!this.client && this.starting === pending) this.starting = undefined;
    });
    return pending;
  };
  private async initialize(): Promise<void> {
    if (this.profileEnabled && this.state.profileStatus !== 'ready')
      void this.reloadProfileConfiguration();
    if (!this.options.catalog && this.state.readingStatus !== 'ready') void this.reloadReading();
    try {
      // Catalog loading cannot keep settings unavailable when only a public
      // resource failed. It never converts a fixture into a published package.
      const client = await (this.options.openStorage?.() ??
        openDatabase({
          // Initialize a production archive with the last reviewed assembly.
          // Even an unregistered/new reading candidate must not create a
          // fixture marker that could later bypass the exact predecessor CAS.
          activePackageRef: this.options.catalog ? packageRef : reviewedCasePackage,
          recovery: true,
        }));
      if (this.disposed) {
        client.close();
        return;
      }
      this.client = client;
      this.invalidationCleanup?.();
      this.invalidationCleanup = client.subscribeInvalidation?.(() => {
        void this.refresh({ preserveOutcome: true });
      });
      await this.refresh();
    } catch (error) {
      this.fail(error);
    }
  }
  /** Profile metadata is independent of reading/storage and never writes a profile. */
  reloadProfileConfiguration = async (): Promise<void> => {
    if (!this.profileEnabled || this.disposed) return;
    const request = ++this.profileRequest;
    this.publish({ profileStatus: 'loading', profileError: null });
    try {
      const configuration = decodeProfileConfiguration(
        await (this.options.loadProfileConfig ?? loadProfileConfiguration)(),
      );
      if (this.disposed || request !== this.profileRequest) return;
      this.profileConfiguration = configuration;
      this.publish({
        profileStatus: 'ready',
        profileError: null,
        profileConfiguration: configuration,
        capabilities: {
          ...this.state.capabilities,
          avatarPresets: configuration.avatars.map((avatar) => avatar.presetId),
        },
      });
    } catch {
      if (this.disposed || request !== this.profileRequest) return;
      this.profileConfiguration = undefined;
      this.publish({
        profileStatus: 'failed',
        profileError: 'PROFILE_CONFIGURATION_UNAVAILABLE',
        profileConfiguration: null,
        capabilities: { ...this.state.capabilities, avatarPresets: ['avatar.basic.01'] },
      });
    }
  };
  reloadReading = async (): Promise<void> => {
    if (this.disposed) return;
    const request = ++this.readingRequest;
    if (this.state.reading) this.invalidateSession();
    this.publish({
      reading: null,
      readingStatus: 'loading',
      readingError: null,
      practiceCatalog: null,
      practiceStatus: 'loading',
      practiceError: null,
    });
    try {
      const reading = await (this.options.loadReading ?? loadCourseReading)();
      if (this.disposed || request !== this.readingRequest) return;
      let practiceCatalog: LearningCatalog | null = null;
      let practiceError: string | null = null;
      try {
        practiceCatalog = createLearningCatalog(
          await (this.options.loadPractice ?? loadCourseLearning)(reading),
        );
        if (practiceCatalog.purpose !== 'course-practice')
          throw new Error('COURSE_LEARNING_CONTENT');
      } catch (error) {
        practiceCatalog = null;
        practiceError = error instanceof Error ? error.message : 'COURSE_LEARNING_UNAVAILABLE';
      }
      if (this.disposed || request !== this.readingRequest) return;
      const catalog = practiceCatalog ?? createLearningCatalog(reading.catalog);
      if (!this.options.loadGoalConfig && !sameRef(this.catalog.packageRef, catalog.packageRef)) {
        this.goalConfigurationRequest++;
        this.goalConfiguration = undefined;
        this.goalLoading = undefined;
        this.publish({ goalStatus: 'loading', goalConfiguration: null });
      }
      this.catalog = catalog;
      this.publish({
        reading,
        readingStatus: 'ready',
        readingError: null,
        practiceCatalog,
        practiceStatus: practiceCatalog ? 'ready' : 'failed',
        practiceError,
      });
      if (this.client) await this.refresh({ preserveOutcome: true });
    } catch (error) {
      if (this.disposed || request !== this.readingRequest) return;
      this.catalog = unavailableCatalog();
      this.invalidateSession();
      this.publish({
        reading: null,
        readingStatus: 'failed',
        readingError: error instanceof Error ? error.message : 'READING_UNAVAILABLE',
        practiceCatalog: null,
        practiceStatus: 'failed',
        practiceError: 'COURSE_LEARNING_READING_UNAVAILABLE',
        capabilities: {
          ...this.state.capabilities,
          learning: false,
          goalsConfigurable: !!this.goalConfiguration,
        },
      });
      // A failed reading request invalidates its session. If that happens
      // during the initial DB read, the older refresh is correctly discarded;
      // schedule the current epoch's read so storage never stays loading.
      if (this.client) await this.refresh({ preserveOutcome: true });
    }
  };

  /** Opaque practice-adapter token only; capture binds its accepted occurrence synchronously. */
  recordPracticePass = (fact: VerifiedFact, expectedEpoch: number): Promise<SaveResult> => {
    try {
      if (this.disposed || expectedEpoch !== this.state.sessionEpoch)
        throw new StorageError('S_GENERATION_STALE');
      if (!isMemoryBugPassFact(fact)) assertPracticePassFact(fact);
      const command = this.capture(fact);
      return command.then((value) => this.commitCommand(value));
    } catch (error) {
      return Promise.reject(storageError(error));
    }
  };

  /** Only the case adapter can supply this opaque, fully watched successful run. */
  recordCaseView = (fact: VerifiedFact, expectedEpoch: number): Promise<SaveResult> => {
    try {
      if (this.disposed || expectedEpoch !== this.state.sessionEpoch)
        throw new StorageError('S_GENERATION_STALE');
      assertCaseViewFact(fact);
      const command = this.capture(fact);
      return command.then((value) => this.commitCommand(value));
    } catch (error) {
      return Promise.reject(storageError(error));
    }
  };

  /** Only explicit lesson actions are public; callers cannot submit event payloads. */
  recordLesson = (id: string, confirmed: boolean, expectedEpoch: number): Promise<void> => {
    const reading = this.state.reading;
    const lesson = reading?.lessons.find((value) => value.id === id);
    if (!reading || !lesson || expectedEpoch !== this.state.sessionEpoch || this.disposed)
      return Promise.reject(new StorageError('S_CONTENT_INCOMPATIBLE'));
    const key = `${expectedEpoch}:${id}:${confirmed}`;
    const existing = this.lessonActions.get(key);
    if (existing) return existing;
    const current = () =>
      !this.disposed && this.state.reading === reading && this.state.sessionEpoch === expectedEpoch;
    const authority = createLearningAuthority(this.catalog, () => current());
    const write = async (eventType: 'lesson.started' | 'lesson.study-confirmed') => {
      if (!current()) throw new StorageError('S_GENERATION_STALE');
      const saved = this.state.projection?.lessons.find((value) => value.id === id);
      if (eventType === 'lesson.started' && saved?.started) return;
      if (eventType === 'lesson.study-confirmed' && saved?.studyConfirmed) {
        if (!this.goalsEnabled) return;
        const snapshot = this.state.snapshot;
        if (snapshot) {
          const date = localDateAt(
            (this.options.clock ?? (() => new Date().toISOString()))(),
            snapshot.meta.timeZone,
          );
          const canonical = canonicalLearningId(snapshot.aliases, id);
          const activeLesson = this.catalog.lessons.find((value) => value.ref.id === id);
          if (!activeLesson) throw new StorageError('S_CONTENT_INCOMPATIBLE');
          if (
            snapshot.receipts.some(
              (row) =>
                row.eventType === eventType &&
                row.localDate === date &&
                isCompatibleLearningHistory(
                  { ...row, firstAt: row.occurredAt, lastAt: row.occurredAt },
                  activeLesson,
                  'lesson',
                  snapshot.aliases,
                ),
            ) ||
            saved.history.some(
              (row) =>
                row.eventType === eventType &&
                isCompatibleLearningHistory(row, activeLesson, 'lesson', snapshot.aliases) &&
                localDateAt(row.lastAt, snapshot.meta.timeZone) === date,
            ) ||
            snapshot.dailyFacts.some(
              (row) =>
                row.eventType === 'lesson.completed' &&
                row.localDate === date &&
                row.canonicalSubjectId === canonical,
            )
          )
            return;
        }
      }
      const fact = authority.issue({
        eventContractVersion: '1.0.0',
        eventType,
        result: eventType === 'lesson.started' ? 'started' : 'confirmed',
        packageRef: { ...reading.packageRef },
        subjectRef: { id, version: lesson.version },
        learningRevision: lesson.learningRevision,
      } as Parameters<typeof authority.issue>[0]);
      const command = await this.capture(fact);
      await this.commitCommand(command);
    };
    const action = (async () => {
      // Capture both explicit intentions before waiting on storage. If one
      // transaction fails, retry retains the original confirmation identity.
      const outcomes = await Promise.allSettled([
        write('lesson.started'),
        ...(confirmed ? [write('lesson.study-confirmed')] : []),
      ]);
      const failure = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    })();
    this.lessonActions.set(key, action);
    void action
      .finally(() => {
        if (this.lessonActions.get(key) === action) this.lessonActions.delete(key);
      })
      .catch(() => undefined);
    return action;
  };
  refresh = async (options: { preserveOutcome?: boolean } = {}): Promise<void> => {
    if (this.disposed) return;
    if (!this.client) {
      await this.start();
      return;
    }
    await this.enqueue(async () => {
      const prior = this.state;
      const epoch = this.state.sessionEpoch;
      try {
        await this.readCurrent(false);
        await this.ensureReviewedCaseRelease(!options.preserveOutcome);
        await this.prepareGoals();
        await this.settleCurrentRewards();
        if (
          options.preserveOutcome &&
          this.state.status !== 'readonly' &&
          this.state.recovery?.writable !== false &&
          prior.snapshot?.meta.generation === this.state.snapshot?.meta.generation &&
          same(prior.snapshot?.meta.activePackageRef, this.state.snapshot?.meta.activePackageRef)
        ) {
          // A warm P05 archive can be read before its current catalog arrives.
          // The old-case publication check then rejects a downgrade. Once the
          // full current assembly is verified and nothing awaits saving, that
          // transient publication error no longer describes the archive.
          const recoveredPublication =
            prior.status === 'unsaved' &&
            prior.errorCode === 'S_CONTENT_INCOMPATIBLE' &&
            this.state.status === 'ready' &&
            this.state.readingStatus === 'ready' &&
            this.state.practiceStatus === 'ready' &&
            this.usesReviewedCourseRelease() &&
            !!this.state.snapshot &&
            sameRef(this.state.snapshot.meta.activePackageRef, reviewedCoursePackage) &&
            this.pendingCount() === 0;
          if (
            (prior.status === 'unsaved' || prior.status === 'conflict') &&
            !recoveredPublication
          ) {
            this.publish({ status: prior.status, errorCode: prior.errorCode, lastSaved: false });
          } else if (
            prior.lastSaved &&
            prior.snapshot?.meta.revision === this.state.snapshot?.meta.revision
          ) {
            this.publish({ lastSaved: true });
          }
        }
      } catch (error) {
        if (epoch !== this.state.sessionEpoch) return;
        if (storageError(error).code === 'S_STORAGE_UNAVAILABLE') {
          this.invalidationCleanup?.();
          this.invalidationCleanup = undefined;
          this.client?.close();
          this.client = undefined;
          this.starting = undefined;
          this.recoveryGuard = undefined;
          this.publish({ recovery: null });
        }
        this.fail(error);
      }
    });
  };
  /** Explicit retry also reloads an unavailable policy; no learning receipt is minted. */
  settleRewards = async (): Promise<void> => {
    if (this.disposed || (!this.rewardsEnabled && !this.goalsEnabled)) return;
    if (!this.client) {
      await this.start();
      return;
    }
    await this.enqueue(async () => {
      try {
        await this.readCurrent(false);
        await this.settleCurrentRewards();
      } catch (error) {
        this.publish({ rewardStatus: 'failed', rewardError: storageError(error).code });
        this.fail(error);
      }
    });
  };
  private async loadGoals(): Promise<void> {
    if (!this.goalsEnabled || this.disposed) return;
    const expectedVersion =
      !this.options.loadGoalConfig && sameRef(this.catalog.packageRef, reviewedCoursePackage)
        ? '1.1.0'
        : '1.0.0';
    if (
      this.goalConfiguration &&
      (this.options.loadGoalConfig || this.goalConfiguration.configRef.version === expectedVersion)
    )
      return;
    if (this.goalLoading) return this.goalLoading;
    const request = ++this.goalConfigurationRequest;
    const packageRef = { ...this.catalog.packageRef };
    this.goalConfiguration = undefined;
    this.publish({ goalStatus: 'loading', goalError: null, goalConfiguration: null });
    const loading = (async () => {
      try {
        const configuration = decodeGoalConfiguration(
          await (this.options.loadGoalConfig ?? (() => loadGoalConfiguration(packageRef)))(),
        );
        if (this.disposed || request !== this.goalConfigurationRequest) return;
        this.goalConfiguration = configuration;
        this.publish({ goalStatus: 'ready', goalError: null, goalConfiguration: configuration });
      } catch {
        if (!this.disposed && request === this.goalConfigurationRequest)
          this.publish({ goalStatus: 'failed', goalError: 'GOAL_CONFIGURATION_UNAVAILABLE' });
      }
    })();
    this.goalLoading = loading;
    try {
      await loading;
    } finally {
      if (this.goalLoading === loading) this.goalLoading = undefined;
    }
  }
  private async ensureInitialGoalTemplate(generation: string): Promise<boolean> {
    const configuration = this.goalConfiguration;
    if (!configuration) throw new StorageError('S_STORAGE_UNAVAILABLE');
    // Another tab may initialize or customize first. CAS retry only fills an
    // absent template and always keeps all settings read from that transaction.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.storage().read();
      if (current.meta.generation !== generation) throw new StorageError('S_GENERATION_STALE');
      if (current.settings.goalTemplate !== null)
        return (
          !same(current.meta, this.state.snapshot?.meta) ||
          !same(current.settings, this.state.snapshot?.settings)
        );
      try {
        await this.storage().commit(
          generation,
          (snapshot) => {
            if (snapshot.settings.goalTemplate !== null) return [];
            return [
              {
                store: 'settings',
                mode: 'put',
                value: {
                  ...snapshot.settings,
                  goalTemplate: {
                    revision: 1,
                    targets: { ...configuration.recommended },
                  },
                },
              },
            ];
          },
          current.meta.revision,
        );
        return true;
      } catch (error) {
        if (storageError(error).code !== 'S_REVISION_CONFLICT') throw error;
      }
    }
    throw new StorageError('S_REVISION_CONFLICT');
  }
  private async prepareGoals(): Promise<void> {
    if (!this.goalsEnabled) return;
    const generation = this.state.snapshot?.meta.generation;
    const epoch = this.state.sessionEpoch;
    await this.loadGoals();
    if (epoch !== this.state.sessionEpoch || this.disposed || !this.goalConfiguration) return;
    if (!generation || this.state.recovery?.writable === false) return;
    try {
      const initialized = await this.ensureInitialGoalTemplate(generation);
      if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
      if (initialized) await this.readCurrent(false, generation);
      this.publish({
        goalStatus: 'ready',
        goalError: null,
        capabilities: { ...this.state.capabilities, goalsConfigurable: true },
      });
    } catch (error) {
      this.publish({ goalStatus: 'failed', goalError: storageError(error).code });
      throw error;
    }
  }
  reloadGoalConfiguration = async (): Promise<void> => {
    if (!this.goalsEnabled || this.disposed) return;
    if (!this.client) {
      await this.start();
      return;
    }
    await this.enqueue(async () => {
      try {
        await this.readCurrent(false);
        await this.prepareGoals();
        await this.settleCurrentRewards();
      } catch (error) {
        this.fail(error);
      }
    });
  };
  private async settleCurrentRewards(): Promise<void> {
    if ((!this.rewardsEnabled && !this.goalsEnabled) || this.disposed) return;
    const generation = this.state.snapshot?.meta.generation;
    const epoch = this.state.sessionEpoch;
    let unavailable = false;
    if (this.rewardsEnabled && !this.rewardPolicy) {
      this.publish({ rewardStatus: 'loading', rewardError: null });
      try {
        const policy = decodeRewardPolicy(
          await (this.options.loadRewardPolicy ?? loadRewardPolicy)(),
        );
        if (epoch !== this.state.sessionEpoch || this.disposed) return;
        this.rewardPolicy = policy;
      } catch {
        unavailable = true;
        if (epoch === this.state.sessionEpoch)
          this.publish({ rewardStatus: 'failed', rewardError: 'REWARD_POLICY_UNAVAILABLE' });
      }
    }
    if (this.goalsEnabled && !this.dailyGoalPolicy) {
      try {
        const policy = decodeDailyGoalRewardPolicy(
          await (this.options.loadDailyGoalPolicy ?? loadDailyGoalRewardPolicy)(),
        );
        if (epoch !== this.state.sessionEpoch || this.disposed) return;
        this.dailyGoalPolicy = policy;
      } catch {
        unavailable = true;
        if (epoch === this.state.sessionEpoch)
          this.publish({
            rewardStatus: 'failed',
            rewardError: 'DAILY_GOAL_REWARD_POLICY_UNAVAILABLE',
          });
      }
    }
    if (epoch !== this.state.sessionEpoch) return;
    if (!generation || (this.state.recovery && !this.state.recovery.writable)) {
      this.publish({
        rewardStatus: 'failed',
        rewardError: this.state.recovery?.errorCode ?? 'S_RECORD_INVALID',
      });
      return;
    }
    const policy = this.rewardPolicy;
    const dailyPolicy = this.dailyGoalPolicy;
    const operations = (snapshot: StorageSnapshot) => [
      ...(policy ? prepareRewardSettlement(snapshot, policy) : []),
      ...(dailyPolicy ? prepareDailyGoalRewardSettlement(snapshot, dailyPolicy) : []),
    ];
    if (!this.state.snapshot || operations(this.state.snapshot).length === 0) {
      if (!unavailable) this.publish({ rewardStatus: 'ready', rewardError: null });
      return;
    }
    const unavailableError = this.state.rewardError;
    this.publish({ rewardStatus: 'loading', rewardError: null, lastSaved: false });
    try {
      const result = await this.storage().settleRewards(generation, operations);
      await this.savedRead(result, generation, epoch);
      this.publish(
        unavailable
          ? { rewardStatus: 'failed', rewardError: unavailableError }
          : { rewardStatus: 'ready', rewardError: null },
      );
    } catch (error) {
      if (epoch === this.state.sessionEpoch)
        this.publish({ rewardStatus: 'failed', rewardError: storageError(error).code });
      throw error;
    }
  }
  private async readCurrent(markSaved: boolean, generation?: string): Promise<void> {
    const client = this.storage();
    const epoch = this.state.sessionEpoch;
    const recovery = client.readRecovery ? await client.readRecovery() : null;
    const snapshot = recovery ? recovery.snapshot : await client.read();
    if (this.disposed) throw new StorageError('S_STORAGE_UNAVAILABLE');
    if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
    if (generation !== undefined && snapshot?.meta.generation !== generation) {
      throw new StorageError('S_GENERATION_STALE');
    }
    const previousGeneration = this.state.snapshot?.meta.generation;
    const previousPackage = this.state.snapshot?.meta.activePackageRef;
    if (
      (previousPackage &&
        snapshot &&
        previousGeneration === snapshot.meta.generation &&
        !sameRef(previousPackage, snapshot.meta.activePackageRef)) ||
      (generation === undefined &&
        ((previousGeneration && snapshot?.meta.generation !== previousGeneration) ||
          (!previousGeneration && snapshot && this.temporarySnapshot)))
    ) {
      this.observedTime = 0;
      this.invalidateSession();
    }
    this.recoveryGuard = recovery?.guard;
    if (this.memorySessionActive) {
      this.memorySessionActive = false;
      this.memorySession++;
      this.isolatedTemporarySnapshot = undefined;
    }
    const readonly = recovery !== null && !recovery.writable;
    const pending = this.pendingCount() > 0;
    if (snapshot && pending && !readonly) {
      // Merge the pending view onto the newest authoritative rows. A stale
      // temporary archive must never hide another tab's newly committed facts.
      this.temporarySnapshot = structuredClone(snapshot);
      for (const command of this.pendingCommands) this.applyTemporary(command, false);
    }
    const safeRecovery = recovery
      ? {
          issues: recovery.issues,
          canClear: recovery.canClear,
          resettable: recovery.resettable,
          ledgerUncertain: recovery.ledgerUncertain,
          writable: recovery.writable,
          errorCode: recovery.errorCode,
          appearanceReadOnly: recovery.appearanceReadOnly,
          appearanceCanReset: recovery.appearanceCanReset,
        }
      : null;
    if (snapshot && this.goalsEnabled)
      this.observeTime((this.options.clock ?? (() => new Date().toISOString()))(), snapshot);
    this.publish({
      status: readonly ? 'readonly' : pending ? 'unsaved' : 'ready',
      snapshot,
      projection: snapshot
        ? this.project(
            pending && !readonly && this.temporarySnapshot ? this.temporarySnapshot : snapshot,
          )
        : null,
      errorCode: readonly
        ? (recovery?.errorCode ?? 'S_RECORD_INVALID')
        : pending
          ? this.state.errorCode
          : null,
      lastSaved: markSaved && !readonly && !pending,
      recovery: safeRecovery,
      appearanceReadOnly: recovery?.appearanceReadOnly ?? false,
      appearanceCanReset: recovery?.appearanceCanReset ?? Boolean(snapshot),
      appearanceError: recovery?.appearanceReadOnly ? 'S_RECORD_INVALID' : null,
      temporary: pending,
      pendingCount: this.pendingCount(),
      capabilities: {
        learning:
          (this.catalog.purpose === 'publishable' ||
            this.catalog.purpose === 'lesson-reading' ||
            this.catalog.purpose === 'course-practice') &&
          (!this.usesReviewedCaseRelease() ||
            (!!snapshot && sameRef(snapshot.meta.activePackageRef, reviewedCasePackage))) &&
          (this.options.catalog !== undefined ||
            !sameRef(this.catalog.packageRef, reviewedCoursePackage) ||
            (this.usesReviewedCourseRelease() &&
              !!snapshot &&
              sameRef(snapshot.meta.activePackageRef, reviewedCoursePackage))),
        goalsConfigurable:
          !readonly &&
          (this.goalsEnabled ? !!this.goalConfiguration : this.catalog.purpose === 'publishable'),
        avatarPresets: this.profileConfiguration?.avatars.map((avatar) => avatar.presetId) ?? [
          'avatar.basic.01',
        ],
      },
      timeZoneFallback: client.timeZoneFallback,
    });
  }
  private fail(error: unknown): void {
    const code = storageError(error).code;
    const readonly = readonlyCodes.has(code);
    this.publish({
      status: code === 'S_REVISION_CONFLICT' ? 'conflict' : readonly ? 'readonly' : 'unsaved',
      errorCode: code,
      lastSaved: false,
      temporary: !readonly && code !== 'S_REVISION_CONFLICT',
      cleared: false,
      // A strict write can discover damage before the next recovery read.
      // Immediately withdraw totals/capability claims from the older cache.
      ...(readonly
        ? {
            recovery: this.state.recovery
              ? { ...this.state.recovery, writable: false, ledgerUncertain: true }
              : null,
            projection: this.state.recovery ? this.state.projection : null,
          }
        : {}),
    });
    if (readonly && this.client) void this.refresh({ preserveOutcome: true });
  }
  private storage(): StorageClient {
    if (!this.client || this.disposed) throw new StorageError('S_STORAGE_UNAVAILABLE');
    return this.client;
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.serial.then(action, action);
    this.serial = next.catch(() => undefined);
    return next;
  }
  private async savedRead(
    result: SaveResult,
    generation: string,
    epoch: number,
  ): Promise<SaveResult> {
    if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
    await this.readCurrent(true, generation);
    if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
    return result;
  }
  private async edit(
    operation: (snapshot: StorageSnapshot) => ReturnType<typeof applyLearningEvent>,
    expectedRevision: number,
  ): Promise<void> {
    const generation = this.state.snapshot?.meta.generation;
    const epoch = this.state.sessionEpoch;
    await this.enqueue(async () => {
      try {
        if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
        if (this.state.recovery && !this.state.recovery.writable)
          throw new StorageError('S_RECORD_INVALID');
        if (!generation) throw new StorageError('S_STORAGE_UNAVAILABLE');
        this.publish({ status: 'saving', lastSaved: false, errorCode: null, cleared: false });
        const result = await this.storage().commit(generation, operation, expectedRevision);
        await this.savedRead(result, generation, epoch);
      } catch (error) {
        if (epoch === this.state.sessionEpoch) this.fail(error);
      }
    });
  }
  saveDisplay = (
    value: Pick<Settings, 'theme' | 'reducedMotion' | 'playbackRate'>,
    expectedRevision: number,
  ): Promise<void> => {
    return this.edit((snapshot) => {
      if (!value || Object.keys(value).sort().join(',') !== 'playbackRate,reducedMotion,theme')
        throw new StorageError('S_RECORD_INVALID');
      const settings = { ...snapshot.settings, ...structuredClone(value) };
      assertRecord('settings', settings);
      return same(settings, snapshot.settings)
        ? []
        : [{ store: 'settings', mode: 'put', value: settings }];
    }, expectedRevision);
  };
  saveAvatar = (avatar: Avatar, expectedRevision: number): Promise<void> => {
    return this.edit((snapshot) => {
      assertRecord('avatar', avatar);
      const presets = this.profileConfiguration?.avatars.map((preset) => preset.presetId) ?? [
        'avatar.basic.01',
      ];
      if (!presets.includes(avatar.presetId)) throw new StorageError('S_CONTENT_INCOMPATIBLE');
      return same(avatar, snapshot.avatar)
        ? []
        : [{ store: 'avatar', mode: 'put', value: structuredClone(avatar) }];
    }, expectedRevision);
  };
  private async editAppearance(
    expectedRevision: number,
    save: (client: StorageClient, generation: string) => Promise<SaveResult>,
  ): Promise<void> {
    const generation = this.state.snapshot?.meta.generation;
    const epoch = this.state.sessionEpoch;
    return this.enqueue(async () => {
      try {
        if (!generation) throw new StorageError('S_STORAGE_UNAVAILABLE');
        if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
          throw new StorageError('S_RECORD_INVALID');
        this.publish({
          status: 'saving',
          lastSaved: false,
          errorCode: null,
          appearanceError: null,
        });
        const result = await save(this.storage(), generation);
        await this.savedRead(result, generation, epoch);
      } catch (error) {
        if (epoch !== this.state.sessionEpoch) return;
        // Refresh damage capabilities without converting an appearance fault into
        // an uncertain ledger or withdrawing legitimate learning write access.
        try {
          await this.readCurrent(false);
        } catch {
          /* original operation error remains */
        }
        if (epoch !== this.state.sessionEpoch) return;
        const code = storageError(error).code;
        if (code === 'S_VERSION_UNKNOWN' || code === 'S_MIGRATION_UNSUPPORTED') this.fail(error);
        else
          this.publish({
            status:
              code === 'S_REVISION_CONFLICT'
                ? 'conflict'
                : this.state.recovery?.writable === false
                  ? 'readonly'
                  : 'unsaved',
            appearanceError: code,
            errorCode: code,
            lastSaved: false,
            temporary: false,
          });
      }
    });
  }
  saveAppearance = (
    appearance: Appearance,
    expectedRevision: number,
    theme?: Settings['theme'],
  ): Promise<void> => {
    let draft: Appearance;
    try {
      assertRecord('appearance', appearance);
      draft = structuredClone(appearance);
    } catch (error) {
      return this.editAppearance(expectedRevision, async () => {
        throw error;
      });
    }
    return this.editAppearance(expectedRevision, (client, generation) =>
      client.commitAppearance(
        generation,
        (snapshot) => {
          const operations: ReturnType<typeof applyLearningEvent> = [];
          if (!same(draft, snapshot.appearance))
            operations.push({
              store: 'appearance',
              mode: 'put',
              value: structuredClone(draft),
            });
          if (theme !== undefined) {
            const settings = { ...snapshot.settings, theme };
            assertRecord('settings', settings);
            if (!same(settings, snapshot.settings))
              operations.push({ store: 'settings', mode: 'put', value: settings });
          }
          return operations;
        },
        expectedRevision,
      ),
    );
  };
  resetAppearance = (expectedRevision: number): Promise<void> => {
    return this.editAppearance(expectedRevision, (client, generation) =>
      client.resetAppearance(generation, expectedRevision),
    );
  };
  saveGoalTemplate = (targets: GoalTargets, expectedRevision: number): Promise<void> => {
    return this.edit((snapshot) => {
      if (!this.options.catalog && sameRef(this.catalog.packageRef, reviewedCoursePackage))
        this.assertCurrentPackage(snapshot);
      if (this.goalsEnabled) {
        if (!this.goalConfiguration) throw new StorageError('S_CONTENT_INCOMPATIBLE');
        try {
          assertConfiguredTargets(targets, this.goalConfiguration);
        } catch {
          throw new StorageError('S_RECORD_INVALID');
        }
      } else if (this.catalog.purpose !== 'publishable')
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
      assertGoalTargets(targets);
      const limits = this.goalConfiguration?.limits ?? {
        exercise: this.catalog.exercises.length,
        lesson: this.catalog.lessons.length,
        case: this.catalog.cases.length,
      };
      if ((Object.keys(limits) as (keyof GoalTargets)[]).some((key) => targets[key] > limits[key]))
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
      if (same(snapshot.settings.goalTemplate?.targets, targets)) return [];
      const revision = (snapshot.settings.goalTemplate?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision)) throw new StorageError('S_RECORD_INVALID');
      return [
        {
          store: 'settings',
          mode: 'put',
          value: {
            ...snapshot.settings,
            goalTemplate: { revision, targets: structuredClone(targets) },
          },
        },
      ];
    }, expectedRevision);
  };
  clearLocalData = (): Promise<void> => {
    const client = this.client;
    const guard = this.recoveryGuard;
    // Invalidate active contexts before waiting behind any earlier local write.
    this.invalidateSession();
    const epoch = this.state.sessionEpoch;
    this.publish({ status: 'saving', lastSaved: false, errorCode: null, temporary: false });
    return this.enqueue(async () => {
      try {
        if (!client || !guard || !this.state.recovery?.canClear)
          throw new StorageError('S_VERSION_UNKNOWN');
        const cleared = await client.clear(guard);
        if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
        this.observedTime = 0;
        await this.readCurrent(false, cleared.meta.generation);
        if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
        // Clear rebuilds the initial local package. Reapply the same reviewed
        // package transition used by bootstrap before offering learning again.
        await this.ensureReviewedCaseRelease(true);
        await this.prepareGoals();
        this.publish({ cleared: true, lastSaved: false, temporary: false, pendingCount: 0 });
      } catch (error) {
        if (epoch === this.state.sessionEpoch) this.fail(error);
      }
    });
  };
  resetLocalPreference = (store: 'settings' | 'avatar'): Promise<void> => {
    const client = this.client;
    const guard = this.recoveryGuard;
    const permitted = this.state.recovery?.resettable.includes(store);
    this.invalidateSession();
    const epoch = this.state.sessionEpoch;
    this.publish({ status: 'saving', lastSaved: false, errorCode: null, cleared: false });
    return this.enqueue(async () => {
      try {
        if (!client || !guard || !permitted) throw new StorageError('S_RECORD_INVALID');
        const reset = await client.resetSingleton(store, guard);
        if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
        const generation = reset.snapshot?.meta.generation;
        if (!generation) throw new StorageError('S_RECORD_INVALID');
        await this.readCurrent(true, generation);
        if (epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
      } catch (error) {
        if (epoch === this.state.sessionEpoch) this.fail(error);
      }
    });
  };
  retryPending = async (): Promise<void> => {
    const commands = [...this.pendingCommands];
    const facts = [...this.pendingFacts];
    const challenges = [...this.pendingChallengeFacts];
    await this.refresh();
    if (!this.client) await this.start();
    for (const fact of challenges) {
      if (!this.pendingChallengeFacts.has(fact)) continue;
      try {
        await this.recordChallengeAnswer(fact, this.state.sessionEpoch);
      } catch {
        return;
      }
    }
    for (const fact of facts) {
      if (!this.pendingFacts.has(fact)) continue;
      try {
        const command = await this.capture(fact);
        await this.commitCommand(command);
      } catch {
        return;
      }
    }
    for (const command of commands) {
      if (!this.pendingCommands.has(command)) continue;
      try {
        await this.commitCommand(command);
      } catch {
        return;
      }
    }
  };
  private requireLearningContent(catalog = this.catalog): void {
    if (
      catalog.purpose !== 'publishable' &&
      catalog.purpose !== 'lesson-reading' &&
      catalog.purpose !== 'course-practice' &&
      catalog.purpose !== 'case-view'
    )
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
  }
  private memorySnapshot(): StorageSnapshot {
    if (!this.isolatedTemporarySnapshot) {
      let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      try {
        new Intl.DateTimeFormat('en', { timeZone }).format();
      } catch {
        timeZone = 'UTC';
      }
      this.isolatedTemporarySnapshot = emptySnapshot(
        createMeta({
          generation: crypto.randomUUID(),
          timeZone,
          createdAt: (this.options.clock ?? (() => new Date().toISOString()))(),
          activePackageRef: this.catalog.packageRef,
        }),
      );
    }
    return this.isolatedTemporarySnapshot;
  }
  private applyTemporary(command: LearningCommand, publish = true): void {
    const memoryOnly = this.commands.get(command)?.memoryOnly === true;
    const snapshot = structuredClone(
      memoryOnly
        ? this.memorySnapshot()
        : (this.temporarySnapshot ?? this.state.snapshot ?? this.memorySnapshot()),
    );
    if (snapshot.meta.generation !== command.generation) return;
    if (snapshot.receipts.some((row) => row.eventId === command.receipt.eventId)) return;
    if (!snapshot.goals.some((goal) => goal.localDate === command.receipt.localDate)) {
      // The durable day's targets may not have reached this page's cache. A
      // temporary view never guesses those targets or claims a check-in.
      snapshot.goals.push({
        localDate: command.receipt.localDate,
        goalVersion: command.receipt.goalVersion,
        targets: null,
        achievedAt: null,
      });
    }
    for (const op of applyLearningEvent(
      snapshot,
      command,
      this.commands.get(command)?.catalog ?? this.catalog,
      (value) => this.learningSnapshot(value).progress,
    )) {
      if (op.store === 'settings' || op.store === 'avatar' || op.store === 'appearance') continue;
      const rows = snapshot[op.store] as unknown[];
      const key = recordKey(op.store, command.generation, op.value as never);
      const index = rows.findIndex((row) =>
        same(recordKey(op.store, command.generation, row as never), key),
      );
      if (index < 0) rows.push(structuredClone(op.value));
      else rows[index] = structuredClone(op.value);
    }
    snapshot.meta.revision++;
    snapshot.receipts.push({ ...command.receipt, committedRevision: snapshot.meta.revision });
    if (memoryOnly) this.isolatedTemporarySnapshot = snapshot;
    else this.temporarySnapshot = snapshot;
    if (publish)
      this.publish({
        projection: this.project(snapshot),
        temporary: true,
        pendingCount: this.pendingCount(),
        lastSaved: false,
      });
  }
  // Day snapshots open only for a trusted learning capture, never on page refresh.
  openDay = async (
    generation: string,
    at: string,
    catalog = this.catalog,
    expectedPackage?: Ref,
  ): Promise<void> => {
    this.requireLearningContent(catalog);
    if (!isUtcTime(at)) throw new StorageError('S_DATE_INVALID');
    if (this.goalsEnabled) {
      await this.loadGoals();
      if (!this.goalConfiguration) throw new StorageError('S_STORAGE_UNAVAILABLE');
      await this.ensureInitialGoalTemplate(generation);
      this.publish({ goalStatus: 'ready', goalError: null });
    }
    await this.storage().commit(generation, (snapshot) => {
      this.assertCurrentPackage(snapshot, expectedPackage);
      const date = localDateAt(at, snapshot.meta.timeZone);
      if (snapshot.goals.some((goal) => goal.localDate === date)) return [];
      return [
        {
          store: 'goals',
          mode: 'add',
          value: {
            localDate: date,
            goalVersion: snapshot.settings.goalTemplate?.revision ?? 1,
            targets: structuredClone(snapshot.settings.goalTemplate?.targets ?? null),
            achievedAt: null,
          },
        },
      ];
    });
  };
  capture = async (fact: VerifiedFact): Promise<LearningCommand> => {
    const prior = fact && typeof fact === 'object' ? this.captures.get(fact) : undefined;
    if (prior && prior.epoch !== this.state.sessionEpoch)
      throw new StorageError('S_GENERATION_STALE');
    if (prior?.memoryOnly && prior.memorySession !== this.memorySession)
      throw new StorageError('S_GENERATION_STALE');
    if (prior?.command) return prior.command;
    if (prior?.pending) return prior.pending;
    const verified = readVerifiedFact(fact);
    this.requireLearningContent(verified.catalog);
    if (verified.catalog.purpose === 'case-view') assertCaseViewFact(fact);
    else if (!same(verified.catalog, this.catalog))
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    checkLearningEvent(verified.event, verified.catalog);
    if (
      this.usesReviewedCourseRelease() &&
      !reviewedCourseHistory(
        { ...verified.event, firstAt: '', lastAt: '' } as Progress,
        this.catalog,
        this.caseCatalog(),
      )
    )
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    if (
      this.usesReviewedCaseRelease() &&
      !reviewedHistory(
        { ...verified.event, firstAt: '', lastAt: '' } as Progress,
        this.catalog,
        this.caseCatalog(),
      )
    )
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    if (this.state.recovery && !this.state.recovery.writable)
      throw new StorageError('S_RECORD_INVALID');
    const memoryOnly = !this.client;
    if (!memoryOnly && this.state.snapshot) this.assertCurrentPackage(this.state.snapshot);
    const generation = memoryOnly
      ? this.memorySnapshot().meta.generation
      : this.state.snapshot?.meta.generation;
    if (memoryOnly) this.memorySessionActive = true;
    if (!generation) throw new StorageError('S_STORAGE_UNAVAILABLE');
    // Bind occurrence metadata before the first await. The same fact token can
    // never become a new day/event during a retry or a second capture call.
    const context = prior ?? {
      at: (this.options.clock ?? (() => new Date().toISOString()))(),
      eventId: (this.options.id ?? (() => crypto.randomUUID()))(),
      generation,
      epoch: this.state.sessionEpoch,
      memoryOnly,
      memorySession: this.memorySession,
      activePackageRef: {
        ...(memoryOnly ? this.memorySnapshot() : this.state.snapshot!).meta.activePackageRef,
      },
    };
    if (!prior) this.observeTime(context.at);
    this.captures.set(fact, context);
    // The submission owner has already accepted the real result. From this
    // point editing/route departure cannot turn a retry into a different fact;
    // generation, epoch and the captured event still gate every later write.
    retainAcceptedFact(fact, context.generation);
    const pending = this.captureFresh(fact, context)
      .then((command) => {
        context.command = command;
        this.pendingFacts.delete(fact);
        return command;
      })
      .catch((error: unknown) => {
        if (
          context.epoch === this.state.sessionEpoch &&
          (!context.memoryOnly || context.memorySession === this.memorySession)
        ) {
          const code = storageError(error).code;
          if (
            ['S_QUOTA', 'S_STORAGE_UNAVAILABLE', 'S_ABORTED'].includes(code) &&
            !context.memoryOnly
          )
            this.pendingFacts.add(fact);
          this.fail(error);
          this.publish({ pendingCount: this.pendingCount() });
          if (code === 'S_GENERATION_STALE') {
            this.invalidateSession();
            void this.refresh({ preserveOutcome: true });
          }
        }
        throw storageError(error);
      })
      .finally(() => {
        context.pending = undefined;
      });
    context.pending = pending;
    return pending;
  };
  private async captureFresh(
    fact: VerifiedFact,
    context: {
      at: string;
      eventId: string;
      generation: string;
      epoch: number;
      memoryOnly: boolean;
      memorySession: number;
      activePackageRef: Ref;
    },
  ): Promise<LearningCommand> {
    const verified = readVerifiedFact(fact);
    if (context.epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
    const snapshot = context.memoryOnly
      ? structuredClone(this.memorySnapshot())
      : await this.storage().read();
    if (snapshot.meta.generation !== context.generation)
      throw new StorageError('S_GENERATION_STALE');
    if (!context.memoryOnly) this.assertCurrentPackage(snapshot, context.activePackageRef);
    if (context.epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
    const at = context.at;
    if (context.memoryOnly) {
      const date = localDateAt(at, snapshot.meta.timeZone);
      if (!snapshot.goals.some((goal) => goal.localDate === date))
        snapshot.goals.push({ localDate: date, goalVersion: 1, targets: null, achievedAt: null });
      this.isolatedTemporarySnapshot = snapshot;
    } else
      await this.openDay(snapshot.meta.generation, at, verified.catalog, context.activePackageRef);
    // Capture the opened date/version from the DB rather than guessing cached configuration.
    const current = context.memoryOnly ? snapshot : await this.storage().read();
    if (context.epoch !== this.state.sessionEpoch) throw new StorageError('S_GENERATION_STALE');
    if (current.meta.generation !== snapshot.meta.generation)
      throw new StorageError('S_GENERATION_STALE');
    if (!context.memoryOnly) this.assertCurrentPackage(current, context.activePackageRef);
    const date = localDateAt(at, current.meta.timeZone);
    const goal = current.goals.find((value) => value.localDate === date)!;
    readVerifiedFact(fact);
    const event = structuredClone(verified.event) as typeof verified.event & {
      eventContractVersion?: '1.0.0';
    };
    const summary = { ...event };
    delete (summary as { eventContractVersion?: string }).eventContractVersion;
    const command = freeze({
      generation: current.meta.generation,
      receipt: {
        ...summary,
        eventId: context.eventId,
        occurredAt: at,
        localDate: date,
        goalVersion: goal.goalVersion,
      },
    }) as LearningCommand;
    this.commands.set(command, {
      fact,
      catalog: verified.catalog,
      epoch: context.epoch,
      memoryOnly: context.memoryOnly,
      memorySession: context.memorySession,
      activePackageRef: context.activePackageRef,
    });
    return command;
  }
  commitCommand = (command: LearningCommand): Promise<SaveResult> => {
    return this.enqueue(async () => {
      const context =
        command && typeof command === 'object' ? this.commands.get(command) : undefined;
      try {
        if (!context) throw new StorageError('S_CONTENT_INCOMPATIBLE');
        if (context.epoch !== this.state.sessionEpoch) {
          if (!context.memoryOnly) {
            // Only a byte-identical receipt already committed before the switch may replay.
            const replay = await this.storage().commitOnce(command, () => {
              throw new StorageError('S_GENERATION_STALE');
            });
            return this.savedRead(replay, command.generation, this.state.sessionEpoch);
          }
          throw new StorageError('S_GENERATION_STALE');
        }
        if (context.memoryOnly && context.memorySession !== this.memorySession)
          throw new StorageError('S_GENERATION_STALE');
        if (this.state.recovery && !this.state.recovery.writable)
          throw new StorageError('S_RECORD_INVALID');
        if (context.memoryOnly) {
          readVerifiedFact(context.fact);
          this.applyTemporary(command);
          throw new StorageError('S_STORAGE_UNAVAILABLE');
        }
        this.publish({ status: 'saving', errorCode: null, lastSaved: false, cleared: false });
        const result = await this.storage().commitOnce(command, (snapshot) => {
          // An already committed receipt is checked inside storage before this
          // callback; confirming that old save does not assert current execution.
          this.requireLearningContent(context.catalog);
          this.assertCurrentPackage(snapshot, context.activePackageRef);
          readVerifiedFact(context.fact);
          if (context.catalog.purpose !== 'case-view' && !same(context.catalog, this.catalog))
            throw new StorageError('S_CONTENT_INCOMPATIBLE');
          return postNewDailyGoalRewards(
            postNewRewards(
              applyLearningEvent(
                snapshot,
                command,
                context.catalog,
                (value) => this.learningSnapshot(value).progress,
              ),
              this.rewardPolicy,
            ),
            this.dailyGoalPolicy,
          );
        });
        this.pendingCommands.delete(command);
        const confirmed = await this.savedRead(result, command.generation, context.epoch);
        if (this.pendingCommands.size === 0 && this.pendingFacts.size === 0)
          this.temporarySnapshot = undefined;
        return confirmed;
      } catch (error) {
        const code = storageError(error).code;
        if (
          context?.epoch === this.state.sessionEpoch &&
          (!context.memoryOnly || context.memorySession === this.memorySession)
        ) {
          if (
            ['S_QUOTA', 'S_STORAGE_UNAVAILABLE', 'S_ABORTED'].includes(code) &&
            !context.memoryOnly
          ) {
            this.pendingCommands.add(command);
            this.applyTemporary(command);
          }
          this.fail(error);
          if (code === 'S_GENERATION_STALE') {
            this.invalidateSession();
            void this.refresh({ preserveOutcome: true });
          }
        } else if (!context) this.fail(error);
        throw storageError(error);
      }
    });
  };
  dispose = (): void => {
    this.disposed = true;
    this.invalidationCleanup?.();
    this.invalidationCleanup = undefined;
    this.pendingCommands.clear();
    this.pendingFacts.clear();
    this.pendingChallengeFacts.clear();
    this.temporarySnapshot = undefined;
    this.isolatedTemporarySnapshot = undefined;
    this.client?.close();
    this.client = undefined;
    this.listeners.clear();
    this.sessionListeners.clear();
  };
}

export function createLearningService() {
  const service = new LearningService();
  // Deliberately no raw command, trusted authority, DB name or fixture options.
  return {
    recordChallengeAnswer: service.recordChallengeAnswer,
    editorHistoryContext: service.editorHistoryContext,
    readEditorHistory: service.readEditorHistory,
    saveEditorHistory: service.saveEditorHistory,
    readKnowledgeMarks: service.readKnowledgeMarks,
    syncReviewCards: service.syncReviewCards,
    syncAchievements: service.syncAchievements,
    saveKnowledgeMark: service.saveKnowledgeMark,
    recordPracticeAttempt: service.recordPracticeAttempt,
    recordLesson: service.recordLesson,
    recordPracticePass: service.recordPracticePass,
    recordCaseView: service.recordCaseView,
    settleRewards: service.settleRewards,
    reloadReading: service.reloadReading,
    reloadGoalConfiguration: service.reloadGoalConfiguration,
    reloadProfileConfiguration: service.reloadProfileConfiguration,
    start: service.start,
    refresh: service.refresh,
    dispose: service.dispose,
    getState: service.getState,
    subscribe: service.subscribe,
    saveDisplay: service.saveDisplay,
    saveAppearance: service.saveAppearance,
    resetAppearance: service.resetAppearance,
    saveAvatar: service.saveAvatar,
    saveGoalTemplate: service.saveGoalTemplate,
    clearLocalData: service.clearLocalData,
    resetLocalPreference: service.resetLocalPreference,
    retryPending: service.retryPending,
    subscribeSessionInvalidation: service.subscribeSessionInvalidation,
  };
}
