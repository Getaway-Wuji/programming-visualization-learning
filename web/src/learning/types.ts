import type { ReceiptSummary } from '../storage/client';
import type {
  Avatar,
  Goal,
  GoalTargets,
  LedgerEntry,
  Progress,
  Ref,
  Settings,
} from '../storage/model';

export interface LearningCatalogEntity {
  readonly ref: Ref;
  readonly learningRevision: number;
  readonly acceptedPriorVersions: readonly string[];
}
export interface LearningLesson extends LearningCatalogEntity {
  readonly requiredExerciseRefs: readonly Ref[];
}
export interface LearningExercise extends LearningCatalogEntity {
  readonly lessonRef: Ref;
  readonly caseKeys: readonly string[];
}
export type LearningCase = LearningCatalogEntity;
/** A validated public-content projection, with fixture provenance retained. */
export interface LearningCatalog {
  readonly purpose:
    'publishable' | 'contract-fixture' | 'lesson-reading' | 'course-practice' | 'case-view';
  readonly packageRef: Ref;
  readonly lessons: readonly LearningLesson[];
  readonly exercises: readonly LearningExercise[];
  readonly cases: readonly LearningCase[];
}
export type LearningInputEventType =
  | 'lesson.started'
  | 'lesson.study-confirmed'
  | 'exercise.attempt-evaluated'
  | 'exercise.passed'
  | 'case.view-confirmed';
export type LearningReceiptSummary = Extract<ReceiptSummary, { eventType: LearningInputEventType }>;
/** Internal command: only the trusted adapter may construct this from live evidence. */
export interface LearningCommand {
  readonly generation: string;
  readonly receipt: LearningReceiptSummary;
}
export type LearningAttempt = Extract<Progress, { eventType: 'exercise.attempt-evaluated' }>;
export interface LessonLearningState {
  id: string;
  ref: Ref;
  started: boolean;
  studyConfirmed: boolean;
  completed: boolean;
  history: Progress[];
}
export interface ExerciseLearningState {
  id: string;
  ref: Ref;
  passed: boolean;
  latestAttempt: LearningAttempt | null;
  history: Progress[];
}
export interface CaseLearningState {
  id: string;
  ref: Ref;
  viewConfirmed: boolean;
  history: Progress[];
}
export interface GoalLearningState extends Goal {
  counts: GoalTargets;
  remaining: GoalTargets | null;
  reachable: boolean | null;
}
export interface LearningProjection {
  lessons: LessonLearningState[];
  exercises: ExerciseLearningState[];
  cases: CaseLearningState[];
  /** Includes removed entities and incompatible versions/revisions. */
  history: Progress[];
  ledger: {
    totalPoints: string;
    pending: LedgerEntry[];
    history: LedgerEntry[];
  };
  goals: GoalLearningState[];
  settings: Settings;
  avatar: Avatar;
}
