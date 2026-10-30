/** SAVE-01 6.0.0. Learning/appearance projection; history, marks and schedules are separate partitions. */
export const DB_NAME = 'c-viz-learning';
export const DB_VERSION = 6;
export const SCHEMA_VERSION = '6.0.0';
export const CORE_STORE_NAMES = [
  'meta',
  'settings',
  'avatar',
  'progress',
  'dailyFacts',
  'goals',
  'ledger',
  'receipts',
  'aliases',
] as const;
export const STORE_NAMES = [...CORE_STORE_NAMES, 'appearance', 'appearanceAssets'] as const;
export const ALL_STORE_NAMES = [
  ...STORE_NAMES,
  'editHistory',
  'knowledgeMarks',
  'reviewCards',
  'achievements',
] as const;
export type StoreName = (typeof STORE_NAMES)[number];
export const COLLECTION_STORES = [
  'progress',
  'dailyFacts',
  'goals',
  'ledger',
  'receipts',
  'aliases',
] as const;
export type CollectionStoreName = (typeof COLLECTION_STORES)[number];

export interface PublicRef {
  id: string;
  version: string;
}
export type Ref = PublicRef;
export interface LocalGoalRef {
  id: string;
  version: string;
}
export interface Meta {
  schemaVersion: typeof SCHEMA_VERSION;
  dbVersion: typeof DB_VERSION;
  generation: string;
  revision: number;
  timeZone: string;
  createdAt: string;
  activePackageRef: PublicRef;
}
export interface GoalTargets {
  exercise: number;
  lesson: number;
  case: number;
}
export interface GoalTemplate {
  revision: number;
  targets: GoalTargets;
}
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  reducedMotion: 'system' | 'on' | 'off';
  playbackRate: 0.25 | 0.5 | 1 | 1.5 | 2 | 4;
  goalTemplate: GoalTemplate | null;
}
export interface Avatar {
  presetId: string;
  accentColor: string;
}
export const THEME_IDS = ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export interface Appearance {
  preset: ThemeId;
  themeOverrides: Record<ThemeId, { accentColor: string | null }>;
  blockWorkspace: 'auto' | 'show' | 'hide';
  layout: {
    sidebar: 'expanded' | 'collapsed';
    workbenchMode: 'standard' | 'focus';
    splitRatios: { practice: number; visualize: number; review: number };
  };
  background: {
    assetId: 'background' | null;
    visible: boolean;
    fit: 'cover' | 'contain' | 'tile';
    position: 'center' | 'top' | 'bottom';
    overlayOpacity: number;
  };
}
export interface AppearanceAsset {
  assetId: 'background';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLength: number;
  width: number;
  height: number;
  blob: Blob;
}
export function defaultAppearance(): Appearance {
  return {
    preset: 'minimal',
    themeOverrides: {
      minimal: { accentColor: null },
      cute: { accentColor: null },
      glass: { accentColor: null },
      soft: { accentColor: null },
      cool: { accentColor: null },
      tech: { accentColor: null },
    },
    blockWorkspace: 'auto',
    layout: {
      sidebar: 'expanded',
      workbenchMode: 'standard',
      splitRatios: { practice: 50, visualize: 35, review: 35 },
    },
    background: {
      assetId: null,
      visible: false,
      fit: 'cover',
      position: 'center',
      overlayOpacity: 75,
    },
  };
}
export interface ContentEventResults {
  'lesson.started': 'started';
  'lesson.study-confirmed': 'confirmed';
  'exercise.attempt-evaluated': 'failed';
  'exercise.passed': 'passed';
  'lesson.completed': 'completed';
  'case.view-confirmed': 'confirmed';
}
export type ContentEventType = keyof ContentEventResults;
export type EventType = ContentEventType | 'daily-goal.achieved';
export type ResultCategory =
  | 'wrong-answer'
  | 'teaching-goal-unmet'
  | 'program-error'
  | 'cancelled'
  | 'resource-limit'
  | 'infrastructure-failure';
export interface AttemptDetails {
  resultCategory: ResultCategory;
  failedCaseKey: string | null;
}
interface ProgressBase {
  subjectRef: PublicRef;
  packageRef: PublicRef;
  learningRevision: number;
  firstAt: string;
  lastAt: string;
}
export type Progress = {
  [E in ContentEventType]: ProgressBase & {
    eventType: E;
    result: ContentEventResults[E];
  } & (E extends 'exercise.attempt-evaluated' ? AttemptDetails : object);
}[ContentEventType];
export type DailyEventType = 'exercise.passed' | 'lesson.completed' | 'case.view-confirmed';
export interface DailyFact {
  eventType: DailyEventType;
  subjectRef: PublicRef;
  canonicalSubjectId: string;
  occurredAt: string;
  localDate: string;
}
export interface Goal {
  localDate: string;
  goalVersion: number;
  targets: GoalTargets | null;
  achievedAt: string | null;
}
export type RewardSourceId =
  | 'reward.exercise.first-pass'
  | 'reward.lesson.first-completion'
  | 'reward.case.first-view'
  | 'reward.daily-goal.once';
interface LedgerBase {
  sourceId: RewardSourceId;
  subjectId: string;
  localDate: string;
  occurredAt: string;
}
export type LedgerEntry = LedgerBase &
  (
    | { status: 'pending'; points: null; policyRef: null }
    | { status: 'posted'; points: number; policyRef: PublicRef }
  );
interface ReceiptBase {
  eventId: string;
  goalVersion: number;
  occurredAt: string;
  localDate: string;
  committedRevision: number;
}
export type ContentReceipt = {
  [E in ContentEventType]: ReceiptBase & {
    eventType: E;
    result: ContentEventResults[E];
    subjectRef: PublicRef;
    packageRef: PublicRef;
    learningRevision: number;
  } & (E extends 'exercise.attempt-evaluated' ? AttemptDetails : object);
}[ContentEventType];
export type Receipt =
  | ContentReceipt
  | (ReceiptBase & {
      eventType: 'daily-goal.achieved';
      result: 'achieved';
      subjectRef: LocalGoalRef;
      packageRef: null;
      learningRevision: null;
    });
export type AliasKind = 'lesson' | 'exercise' | 'case';
export interface Alias {
  fromRef: PublicRef;
  toRef: PublicRef;
  fromAcceptedPriorVersions: string[];
  kind: AliasKind;
  learningRevision: number;
  manifestRef: PublicRef;
}
export interface StorageRecords {
  meta: Meta;
  settings: Settings;
  avatar: Avatar;
  progress: Progress;
  dailyFacts: DailyFact;
  goals: Goal;
  ledger: LedgerEntry;
  receipts: Receipt;
  aliases: Alias;
  appearance: Appearance;
  appearanceAssets: AppearanceAsset;
}
export type StorageSnapshot = Pick<
  StorageRecords,
  'meta' | 'settings' | 'avatar' | 'appearance'
> & {
  [S in CollectionStoreName]: StorageRecords[S][];
} & { appearanceAssets: AppearanceAsset[] };
export type StorageRecordKey = 'current' | (string | number)[];

export function defaultSettings(): Settings {
  return { theme: 'light', reducedMotion: 'system', playbackRate: 1, goalTemplate: null };
}
export function defaultAvatar(): Avatar {
  return { presetId: 'avatar.basic.01', accentColor: '#168A72' };
}
export function createMeta(
  input: Omit<Meta, 'schemaVersion' | 'dbVersion' | 'revision'> & {
    revision?: number;
  },
): Meta {
  return {
    schemaVersion: SCHEMA_VERSION,
    dbVersion: DB_VERSION,
    generation: input.generation,
    revision: input.revision ?? 0,
    timeZone: input.timeZone,
    createdAt: input.createdAt,
    activePackageRef: { ...input.activePackageRef },
  };
}
export function emptySnapshot(meta: Meta): StorageSnapshot {
  return {
    meta: { ...meta, activePackageRef: { ...meta.activePackageRef } },
    settings: defaultSettings(),
    avatar: defaultAvatar(),
    appearance: defaultAppearance(),
    appearanceAssets: [],
    progress: [],
    dailyFacts: [],
    goals: [],
    ledger: [],
    receipts: [],
    aliases: [],
  };
}

/** Out-of-line compound keys preserve boundaries; callers validate rows before use. */
export function recordKey<S extends StoreName>(
  store: S,
  generation: string,
  row: StorageRecords[S],
): StorageRecordKey {
  switch (store) {
    case 'meta':
    case 'settings':
    case 'avatar':
    case 'appearance':
      return 'current';
    case 'appearanceAssets':
      return [generation, (row as AppearanceAsset).assetId];
    case 'progress': {
      const value = row as Progress;
      return [
        generation,
        value.eventType,
        value.subjectRef.id,
        value.subjectRef.version,
        value.learningRevision,
      ];
    }
    case 'dailyFacts': {
      const value = row as DailyFact;
      return [generation, value.localDate, value.eventType, value.canonicalSubjectId];
    }
    case 'goals':
      return [generation, (row as Goal).localDate];
    case 'ledger': {
      const value = row as LedgerEntry;
      return [
        generation,
        value.sourceId,
        value.sourceId === 'reward.daily-goal.once' ? value.localDate : value.subjectId,
      ];
    }
    case 'receipts':
      return [generation, (row as Receipt).eventId];
    case 'aliases':
      return [generation, (row as Alias).fromRef.id];
  }
  throw new Error('Unknown SAVE store');
}
