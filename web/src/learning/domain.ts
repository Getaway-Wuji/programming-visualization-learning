import { c6LearningCatalog, type C6LearningCatalog, type C6LearningIndex } from '../c6-learning';
import type { C6LearningCommand } from '../c6-learning/model';
import type { StorageMutation } from '../storage/client';
import { StorageError } from '../storage/errors';
import { recordKey } from '../storage/model';
import type {
  Alias,
  AliasKind,
  ContentEventType,
  DailyEventType,
  GoalTargets,
  Progress,
  Ref,
  RewardSourceId,
  StorageSnapshot,
} from '../storage/model';
import {
  assertRecord,
  assertSnapshot,
  isUuid,
  localDateAt,
  validationInternals,
} from '../storage/validation';
import { createLearningCatalog, sameRef } from './catalog';
import type {
  LearningAttempt,
  LearningCatalog,
  LearningCatalogEntity,
  LearningCommand,
  LearningProjection,
} from './types';

const { row } = validationInternals;
const requireRule: typeof validationInternals.requireRule = validationInternals.requireRule;
const inputTypes = [
  'lesson.started',
  'lesson.study-confirmed',
  'exercise.attempt-evaluated',
  'exercise.passed',
  'case.view-confirmed',
];
const sourceIds: Record<DailyEventType, RewardSourceId> = {
  'exercise.passed': 'reward.exercise.first-pass',
  'lesson.completed': 'reward.lesson.first-completion',
  'case.view-confirmed': 'reward.case.first-view',
};
function kindOf(eventType: ContentEventType): AliasKind {
  return eventType.split('.')[0] as AliasKind;
}
type LearningGraph = LearningCatalog | C6LearningCatalog;
function entities(catalog: LearningGraph, kind: AliasKind) {
  return kind === 'lesson'
    ? catalog.lessons
    : kind === 'exercise'
      ? catalog.exercises
      : catalog.cases;
}
/** Identity controls unique award/day keys; it never proves version compatibility. */
export function canonicalLearningId(aliases: readonly Alias[], id: string): string {
  const seen = new Set<string>();
  let current = id;
  for (let count = 0; count <= 32; count++) {
    requireRule(!seen.has(current));
    seen.add(current);
    const previous = aliases.find((alias) => alias.toRef.id === current);
    if (!previous) return current;
    current = previous.fromRef.id;
  }
  throw new StorageError('S_RECORD_INVALID');
}
/** Match the active entity first; every required forward edge checks its declared source. */
export function isCompatibleLearningHistory(
  progress: Progress,
  current: LearningCatalogEntity,
  kind: AliasKind,
  aliases: readonly Alias[],
): boolean {
  if (
    /^(lesson|exercise)\.c6\./u.test(current.ref.id) &&
    (progress.packageRef.id !== 'content.c.primer6' || progress.packageRef.version !== '2.0.0')
  )
    return false;
  if (kindOf(progress.eventType) !== kind || progress.learningRevision !== current.learningRevision)
    return false;
  let mapped: Ref = progress.subjectRef;
  const seen = new Set<string>();
  for (let count = 0; count <= 32; count++) {
    if (seen.has(mapped.id)) return false;
    seen.add(mapped.id);
    if (
      mapped.id === current.ref.id &&
      (mapped.version === current.ref.version ||
        current.acceptedPriorVersions.includes(mapped.version))
    )
      return true;
    const alias = aliases.find((alias) => alias.fromRef.id === mapped.id);
    if (!alias) return false;
    if (
      alias.kind !== kind ||
      alias.learningRevision !== progress.learningRevision ||
      (mapped.version !== alias.fromRef.version &&
        !alias.fromAcceptedPriorVersions.includes(mapped.version))
    )
      return false;
    mapped = alias.toRef;
  }
  return false;
}
function hasProgress(
  snapshot: StorageSnapshot,
  eventType: ContentEventType,
  entity: LearningCatalogEntity,
): boolean {
  return snapshot.progress.some(
    (value) =>
      value.eventType === eventType &&
      isCompatibleLearningHistory(value, entity, kindOf(eventType), snapshot.aliases),
  );
}
function lessonCompleted(
  snapshot: StorageSnapshot,
  catalog: LearningGraph,
  lesson: LearningCatalog['lessons'][number],
): boolean {
  return (
    hasProgress(snapshot, 'lesson.study-confirmed', lesson) &&
    (catalog.purpose === 'c6-course-practice' || lesson.requiredExerciseRefs.length > 0) &&
    lesson.requiredExerciseRefs.every((ref) => {
      const exercise = catalog.exercises.find((value) => sameRef(value.ref, ref));
      return !!exercise && hasProgress(snapshot, 'exercise.passed', exercise);
    })
  );
}
function countsAt(snapshot: StorageSnapshot, date: string): GoalTargets {
  const facts = snapshot.dailyFacts.filter((value) => value.localDate === date);
  return {
    exercise: facts.filter((value) => value.eventType === 'exercise.passed').length,
    lesson: facts.filter((value) => value.eventType === 'lesson.completed').length,
    case: facts.filter((value) => value.eventType === 'case.view-confirmed').length,
  };
}

/** Pure transaction recipe for commands already verified by the trusted adapter. */
export function applyLearningEvent(
  snapshot: StorageSnapshot,
  command: LearningCommand,
  catalog: LearningCatalog,
  approvedHistory?: (snapshot: StorageSnapshot) => readonly Progress[],
): StorageMutation[] {
  createLearningCatalog(catalog);
  return applyEvent(snapshot, command, catalog, approvedHistory);
}

/** LEARN2 course entry; the LEARN1 constructor remains unchanged. */
export function applyC6LearningEvent(
  snapshot: StorageSnapshot,
  command: C6LearningCommand,
  index: C6LearningIndex,
): StorageMutation[] {
  const catalog = c6LearningCatalog(index);
  row(command, ['learnVersion', 'generation', 'receipt']);
  requireRule(command.learnVersion === '2.0.0');
  if (
    snapshot.meta.schemaVersion !== '10.0.0' ||
    !sameRef(snapshot.meta.activePackageRef, index.packageRef) ||
    command.receipt.eventType === 'case.view-confirmed'
  )
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return applyEvent(
    snapshot,
    { generation: command.generation, receipt: command.receipt },
    catalog,
    undefined,
    index,
  );
}
function applyEvent(
  snapshot: StorageSnapshot,
  command: LearningCommand,
  catalog: LearningGraph,
  approvedHistory?: (snapshot: StorageSnapshot) => readonly Progress[],
  c6Index?: C6LearningIndex,
): StorageMutation[] {
  assertSnapshot(snapshot);
  row(command, ['generation', 'receipt']);
  requireRule(isUuid(command.generation));
  if (command.generation !== snapshot.meta.generation) throw new StorageError('S_GENERATION_STALE');
  requireRule(command.receipt !== null && typeof command.receipt === 'object');
  const typeDescriptor = Object.getOwnPropertyDescriptor(command.receipt, 'eventType');
  requireRule(
    typeDescriptor && 'value' in typeDescriptor && inputTypes.includes(typeDescriptor.value),
  );
  row(command.receipt, [
    'eventId',
    'eventType',
    'subjectRef',
    'packageRef',
    'learningRevision',
    'result',
    'goalVersion',
    'occurredAt',
    'localDate',
    ...(typeDescriptor.value === 'exercise.attempt-evaluated'
      ? ['resultCategory', 'failedCaseKey']
      : []),
  ]);
  assertRecord('receipts', { ...command.receipt, committedRevision: 1 });
  const receipt = command.receipt;
  if (
    (catalog.purpose === 'lesson-reading' &&
      !['lesson.started', 'lesson.study-confirmed'].includes(receipt.eventType)) ||
    (catalog.purpose === 'course-practice' &&
      ![
        'lesson.started',
        'lesson.study-confirmed',
        'exercise.passed',
        'exercise.attempt-evaluated',
      ].includes(receipt.eventType)) ||
    (catalog.purpose === 'case-view' && receipt.eventType !== 'case.view-confirmed')
  )
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  requireRule(inputTypes.includes(receipt.eventType));
  if (localDateAt(receipt.occurredAt, snapshot.meta.timeZone) !== receipt.localDate)
    throw new StorageError('S_DATE_INVALID');
  const goal = snapshot.goals.find((value) => value.localDate === receipt.localDate);
  if (!goal || goal.goalVersion !== receipt.goalVersion) throw new StorageError('S_DATE_INVALID');
  const entity = entities(catalog, kindOf(receipt.eventType)).find((value) =>
    sameRef(value.ref, receipt.subjectRef),
  );
  if (
    !entity ||
    entity.learningRevision !== receipt.learningRevision ||
    !sameRef(catalog.packageRef, receipt.packageRef)
  )
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  if (receipt.eventType === 'exercise.attempt-evaluated' && receipt.failedCaseKey !== null) {
    const exercise = catalog.exercises.find((value) => sameRef(value.ref, receipt.subjectRef));
    requireRule(exercise?.caseKeys.includes(receipt.failedCaseKey));
  }

  const next = structuredClone(snapshot);
  const learningView = (value: StorageSnapshot): StorageSnapshot =>
    approvedHistory ? { ...value, progress: [...approvedHistory(value)] } : value;
  const operations: StorageMutation[] = [];
  const touched = new Set<string>();
  const stage = (operation: StorageMutation) => {
    const key = JSON.stringify([
      operation.store,
      recordKey(operation.store, command.generation, operation.value as never),
    ]);
    requireRule(!touched.has(key));
    touched.add(key);
    operations.push(operation);
  };
  const mergeProgress = (progress: Progress) => {
    const previous = next.progress.find(
      (value) =>
        value.eventType === progress.eventType &&
        sameRef(value.subjectRef, progress.subjectRef) &&
        value.learningRevision === progress.learningRevision,
    );
    if (!previous) {
      next.progress.push(progress);
      stage({ store: 'progress', mode: 'add', value: progress });
      return;
    }
    // A foreign-package row sharing the physical key cannot be silently
    // relabeled or borrowed to authorize a new fact.
    if (approvedHistory && !approvedHistory(next).includes(previous))
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
    const merged = {
      ...previous,
      firstAt: previous.firstAt < progress.firstAt ? previous.firstAt : progress.firstAt,
      lastAt: previous.lastAt > progress.lastAt ? previous.lastAt : progress.lastAt,
    } as Progress;
    if (
      merged.eventType === 'exercise.attempt-evaluated' &&
      progress.eventType === 'exercise.attempt-evaluated' &&
      progress.lastAt >= previous.lastAt
    ) {
      merged.resultCategory = progress.resultCategory;
      merged.failedCaseKey = progress.failedCaseKey;
    }
    if (JSON.stringify(merged) !== JSON.stringify(previous)) {
      next.progress[next.progress.indexOf(previous)] = merged;
      stage({ store: 'progress', mode: 'put', value: merged });
    }
  };
  const pending = (sourceId: RewardSourceId, subjectId: string) => {
    const exists = next.ledger.some(
      (value) =>
        value.sourceId === sourceId &&
        (sourceId === 'reward.daily-goal.once'
          ? value.localDate === receipt.localDate
          : value.subjectId === subjectId),
    );
    if (exists) return;
    const value = {
      sourceId,
      subjectId,
      localDate: receipt.localDate,
      occurredAt: receipt.occurredAt,
      status: 'pending' as const,
      points: null,
      policyRef: null,
    };
    next.ledger.push(value);
    stage({ store: 'ledger', mode: 'add', value });
  };
  const daily = (eventType: DailyEventType, subjectRef: Ref) => {
    const canonicalSubjectId = canonicalLearningId(next.aliases, subjectRef.id);
    if (
      !next.dailyFacts.some(
        (value) =>
          value.localDate === receipt.localDate &&
          value.eventType === eventType &&
          value.canonicalSubjectId === canonicalSubjectId,
      )
    ) {
      const value = {
        eventType,
        subjectRef: { ...subjectRef },
        canonicalSubjectId,
        occurredAt: receipt.occurredAt,
        localDate: receipt.localDate,
      };
      next.dailyFacts.push(value);
      stage({ store: 'dailyFacts', mode: 'add', value });
    }
    if (!c6Index || eventType === 'case.view-confirmed') {
      pending(sourceIds[eventType], canonicalSubjectId);
    } else {
      const group = c6Index.rewardGroups.find((g) =>
        (eventType === 'lesson.completed' ? g.lessonRefs : g.exerciseRefs).some((ref) =>
          sameRef(ref, subjectRef),
        ),
      );
      requireRule(group);
      if (eventType === 'exercise.passed') {
        pending(group.exerciseReward.sourceId, group.exerciseReward.subjectId);
      } else if (
        group.lessonRefs.length > 0 &&
        group.lessonRefs.every((ref) => {
          const lesson = catalog.lessons.find((entry) => sameRef(entry.ref, ref));
          return !!lesson && lessonCompleted(next, catalog, lesson);
        })
      ) {
        pending(group.lessonReward.sourceId, group.lessonReward.subjectId);
      }
    }
  };
  const occurredAt = receipt.occurredAt;
  mergeProgress({
    eventType: receipt.eventType,
    result: receipt.result,
    subjectRef: { ...receipt.subjectRef },
    packageRef: { ...receipt.packageRef },
    learningRevision: receipt.learningRevision,
    firstAt: occurredAt,
    lastAt: occurredAt,
    ...(receipt.eventType === 'exercise.attempt-evaluated'
      ? { resultCategory: receipt.resultCategory, failedCaseKey: receipt.failedCaseKey }
      : {}),
  } as Progress);
  if (receipt.eventType === 'exercise.passed' || receipt.eventType === 'case.view-confirmed')
    daily(receipt.eventType, receipt.subjectRef);
  if (receipt.eventType === 'lesson.study-confirmed' || receipt.eventType === 'exercise.passed') {
    const lessonRef =
      receipt.eventType === 'lesson.study-confirmed'
        ? receipt.subjectRef
        : catalog.exercises.find((value) => sameRef(value.ref, receipt.subjectRef))!.lessonRef;
    const lesson = catalog.lessons.find((value) => sameRef(value.ref, lessonRef))!;
    if (lessonCompleted(learningView(next), catalog, lesson)) {
      mergeProgress({
        eventType: 'lesson.completed',
        result: 'completed',
        subjectRef: { ...lesson.ref },
        packageRef: { ...catalog.packageRef },
        learningRevision: lesson.learningRevision,
        firstAt: occurredAt,
        lastAt: occurredAt,
      });
      daily('lesson.completed', lesson.ref);
    }
  }
  const currentGoal = next.goals.find((value) => value.localDate === receipt.localDate)!;
  const counts = countsAt(next, receipt.localDate);
  if (
    currentGoal.achievedAt === null &&
    currentGoal.targets !== null &&
    Object.entries(currentGoal.targets).every(
      ([kind, target]) => counts[kind as keyof GoalTargets] >= target,
    ) &&
    operations.some((value) => value.store === 'dailyFacts')
  ) {
    currentGoal.achievedAt = receipt.occurredAt;
    stage({ store: 'goals', mode: 'put', value: currentGoal });
    pending('reward.daily-goal.once', `local-goal.${receipt.localDate}`);
  }
  // The storage client appends the one root receipt and advances revision atomically.
  assertSnapshot(next);
  return operations;
}

/** Read-only current predicates and complete history; reads never create learning facts. */
export function projectLearning(
  snapshot: StorageSnapshot,
  catalog: LearningCatalog,
  approvedHistory?: readonly Progress[],
): LearningProjection {
  createLearningCatalog(catalog);
  return projectGraph(snapshot, catalog, approvedHistory);
}
export function projectC6Learning(
  snapshot: StorageSnapshot,
  index: C6LearningIndex,
  cases: LearningCatalog['cases'] = [],
): LearningProjection {
  if (
    snapshot.meta.schemaVersion !== '10.0.0' ||
    !sameRef(snapshot.meta.activePackageRef, index.packageRef)
  )
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return projectGraph(snapshot, { ...c6LearningCatalog(index), cases });
}
function projectGraph(
  snapshot: StorageSnapshot,
  catalog: LearningGraph,
  approvedHistory?: readonly Progress[],
): LearningProjection {
  assertSnapshot(snapshot);
  // Validate the intact archive first. Filtering history for current course
  // predicates must not break ledger/receipt relations or alter stored rows.
  if (approvedHistory) snapshot = { ...snapshot, progress: [...approvedHistory] };
  const historyFor = (entity: LearningCatalogEntity) => {
    const canonical = canonicalLearningId(snapshot.aliases, entity.ref.id);
    return structuredClone(
      snapshot.progress.filter(
        (value) => canonicalLearningId(snapshot.aliases, value.subjectRef.id) === canonical,
      ),
    );
  };
  const reachableAt = (date: string, targets: GoalTargets) =>
    (['exercise', 'lesson', 'case'] as const).every((kind) => {
      const available = new Set([
        ...entities(catalog, kind).map((entity) =>
          canonicalLearningId(snapshot.aliases, entity.ref.id),
        ),
        ...snapshot.dailyFacts
          .filter((fact) => fact.localDate === date && fact.eventType.startsWith(`${kind}.`))
          .map((fact) => fact.canonicalSubjectId),
      ]);
      return targets[kind] <= available.size;
    });
  return {
    lessons: catalog.lessons.map((lesson) => {
      const studyConfirmed = hasProgress(snapshot, 'lesson.study-confirmed', lesson);
      const completed = lessonCompleted(snapshot, catalog, lesson);
      return {
        id: lesson.ref.id,
        ref: { ...lesson.ref },
        started: hasProgress(snapshot, 'lesson.started', lesson) || studyConfirmed || completed,
        studyConfirmed,
        completed,
        history: historyFor(lesson),
      };
    }),
    exercises: catalog.exercises.map((exercise) => {
      const attempts = snapshot.progress.filter(
        (value): value is LearningAttempt =>
          value.eventType === 'exercise.attempt-evaluated' &&
          isCompatibleLearningHistory(value, exercise, 'exercise', snapshot.aliases),
      );
      attempts.sort((first, second) => second.lastAt.localeCompare(first.lastAt));
      return {
        id: exercise.ref.id,
        ref: { ...exercise.ref },
        passed: hasProgress(snapshot, 'exercise.passed', exercise),
        latestAttempt: attempts[0] ? structuredClone(attempts[0]) : null,
        history: historyFor(exercise),
      };
    }),
    cases: catalog.cases.map((value) => ({
      id: value.ref.id,
      ref: { ...value.ref },
      viewConfirmed: hasProgress(snapshot, 'case.view-confirmed', value),
      history: historyFor(value),
    })),
    history: structuredClone(snapshot.progress),
    ledger: {
      totalPoints: snapshot.ledger
        .reduce(
          (total, value) => total + (value.status === 'posted' ? BigInt(value.points) : 0n),
          0n,
        )
        .toString(),
      pending: structuredClone(snapshot.ledger.filter((value) => value.status === 'pending')),
      history: structuredClone(snapshot.ledger),
    },
    goals: snapshot.goals.map((value) => {
      const counts = countsAt(snapshot, value.localDate);
      return {
        ...structuredClone(value),
        counts,
        remaining:
          value.targets === null
            ? null
            : {
                exercise: Math.max(0, value.targets.exercise - counts.exercise),
                lesson: Math.max(0, value.targets.lesson - counts.lesson),
                case: Math.max(0, value.targets.case - counts.case),
              },
        reachable: value.targets === null ? null : reachableAt(value.localDate, value.targets),
      };
    }),
    settings: structuredClone(snapshot.settings),
    avatar: structuredClone(snapshot.avatar),
  };
}
