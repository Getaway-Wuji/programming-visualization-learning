import { assertMysqlMeta } from './mysql-meta';
import { isMysqlPackage, isMysqlProgress, isMysqlSubject } from '../mysql-course/identities';
import {
  COLLECTION_STORES,
  DB_VERSION,
  SCHEMA_VERSION,
  STORE_NAMES,
  THEME_IDS,
  recordKey,
} from './model';
import { assertC6Meta } from './c6-reset';
import { assertPythonMeta } from './python3-meta';
import { assertJavaMeta } from './java-meta';
import { assertCppMeta } from './cpp-course-meta';
import { assertRustMeta } from './rust2018-meta';
import { isRustPackage, isRustProgress, isRustSubject } from '../rust2018-course/identities';
import { isCppPackage, isCppProgress, isCppSubject } from '../cpp-course/identities';
import { isJavaPackage, isJavaProgress, isJavaSubject } from '../java/identities';
import { isPythonPackage, isPythonProgress, isPythonSubject } from '../python3/identities';
import { hasC6RewardEvidence, isC6TopicRewardSubject } from '../c6-learning/rewards';
import {
  challengePackage,
  challengePolicy,
  challengeQuestion,
  challengeSource,
} from '../challenges/rules';
import type {
  Alias,
  ContentEventType,
  EventType,
  GoalTargets,
  PublicRef,
  StorageRecords,
  StorageSnapshot,
  StoreName,
} from './model';

export type StorageValidationCode = 'S_RECORD_INVALID' | 'S_DATE_INVALID' | 'S_VERSION_UNKNOWN';
export class StorageValidationError extends Error {
  readonly code: StorageValidationCode;
  constructor(code: StorageValidationCode = 'S_RECORD_INVALID') {
    super(code);
    this.name = 'StorageValidationError';
    this.code = code;
  }
}
function requireRule(
  condition: unknown,
  code: StorageValidationCode = 'S_RECORD_INVALID',
): asserts condition {
  if (!condition) throw new StorageValidationError(code);
}
type Row = Record<string, unknown>;
function row(value: unknown, fields: readonly string[]): Row {
  requireRule(value !== null && typeof value === 'object' && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  requireRule(prototype === Object.prototype || prototype === null);
  const keys = Reflect.ownKeys(value);
  requireRule(
    keys.length === fields.length &&
      keys.every((key) => typeof key === 'string' && fields.includes(key)),
  );
  // A row is plain data. Accessors cannot run application code during validation.
  requireRule(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => 'value' in descriptor && descriptor.enumerable,
    ),
  );
  return value as Row;
}
function list(value: unknown): unknown[] {
  requireRule(Array.isArray(value));
  requireRule(Reflect.ownKeys(value).length === value.length + 1);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireRule(descriptor && 'value' in descriptor && descriptor.enumerable);
  }
  return value;
}
const entityPattern = /^[a-z][a-z0-9]*(\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isEntityId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 96 && entityPattern.test(value);
}
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && versionPattern.test(value);
}
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}
export function isSafeUint(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function isPositiveInt(value: unknown): value is number {
  return isSafeUint(value) && value > 0;
}
export function assertPublicRef(value: unknown): asserts value is PublicRef {
  const ref = row(value, ['id', 'version']);
  requireRule(isEntityId(ref.id) && isVersion(ref.version));
}
export function isUtcTime(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(
      value,
    )
  )
    return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
export function isLocalDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isUtcTime(`${value}T00:00:00.000Z`)
  );
}
const dateFormatterCacheLimit = 32;
const validTimeZones = new Map<string, true>();
const localDateFormatters = new Map<string, Intl.DateTimeFormat>();
function rememberDateFormatter<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= dateFormatterCacheLimit) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value)) return false;
  if (validTimeZones.has(value)) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return rememberDateFormatter(validTimeZones, value, true);
  } catch {
    return false;
  }
}
export function localDateAt(at: string, timeZone: string): string {
  requireRule(isUtcTime(at) && isTimeZone(timeZone), 'S_DATE_INVALID');
  const formatter =
    localDateFormatters.get(timeZone) ??
    rememberDateFormatter(
      localDateFormatters,
      timeZone,
      new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    );
  const parts = formatter.formatToParts(new Date(at));
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)?.value;
  const date = `${part('year')?.padStart(4, '0')}-${part('month')}-${part('day')}`;
  requireRule(isLocalDate(date), 'S_DATE_INVALID');
  return date;
}
export function assertGoalTargets(value: unknown): asserts value is GoalTargets {
  const targets = row(value, ['exercise', 'lesson', 'case']);
  requireRule(Object.values(targets).every((value) => isSafeUint(value) && value <= 100));
  requireRule(Object.values(targets).some((value) => (value as number) > 0));
}
const eventResults: Record<EventType, string> = {
  'lesson.started': 'started',
  'lesson.study-confirmed': 'confirmed',
  'exercise.attempt-evaluated': 'failed',
  'exercise.passed': 'passed',
  'lesson.completed': 'completed',
  'case.view-confirmed': 'confirmed',
  'daily-goal.achieved': 'achieved',
  'challenge.answered': 'correct',
};
const contentEvents = Object.keys(eventResults).filter(
  (type) => type !== 'daily-goal.achieved' && type !== 'challenge.answered',
);
const dailyEvents = ['exercise.passed', 'lesson.completed', 'case.view-confirmed'];
const sourceEvents = {
  'reward.exercise.first-pass': 'exercise.passed',
  'reward.lesson.first-completion': 'lesson.completed',
  'reward.case.first-view': 'case.view-confirmed',
  'reward.daily-goal.once': 'daily-goal.achieved',
  'reward.challenge.first-answer': 'challenge.answered',
} as const;
const categories = [
  'wrong-answer',
  'teaching-goal-unmet',
  'program-error',
  'cancelled',
  'resource-limit',
  'infrastructure-failure',
];
const progressFields = [
  'eventType',
  'result',
  'subjectRef',
  'packageRef',
  'learningRevision',
  'firstAt',
  'lastAt',
];
const receiptFields = [
  'eventId',
  'eventType',
  'subjectRef',
  'packageRef',
  'learningRevision',
  'result',
  'goalVersion',
  'occurredAt',
  'localDate',
  'committedRevision',
];
function hasType(type: unknown, choices: readonly string[]): type is string {
  return typeof type === 'string' && choices.includes(type);
}
function assertAttempt(value: Row) {
  requireRule(hasType(value.resultCategory, categories));
  requireRule(
    value.failedCaseKey === null ||
      (typeof value.failedCaseKey === 'string' &&
        value.failedCaseKey.length <= 96 &&
        /^[a-z][a-z0-9-]*$/.test(value.failedCaseKey)),
  );
}
function eventRow(value: unknown, fields: readonly string[], receipt: boolean): Row {
  requireRule(value !== null && typeof value === 'object');
  const typeDescriptor = Object.getOwnPropertyDescriptor(value, 'eventType');
  requireRule(typeDescriptor && 'value' in typeDescriptor);
  const type: unknown = typeDescriptor.value;
  requireRule(hasType(type, receipt ? Object.keys(eventResults) : contentEvents));
  const valueRow = row(
    value,
    type === 'exercise.attempt-evaluated'
      ? [...fields, 'resultCategory', 'failedCaseKey']
      : type === 'challenge.answered'
        ? [...fields, 'eventContractVersion', 'answerKind']
        : fields,
  );
  requireRule(
    type === 'challenge.answered'
      ? valueRow.result === 'correct' || valueRow.result === 'incorrect'
      : valueRow.result === eventResults[type as EventType],
  );
  if (type === 'challenge.answered') {
    assertPublicRef(valueRow.subjectRef);
    assertPublicRef(valueRow.packageRef);
    const question = challengeQuestion(valueRow.subjectRef.id);
    requireRule(
      question &&
        valueRow.subjectRef.version === question.ref.version &&
        valueRow.eventContractVersion === '1.1.0' &&
        valueRow.learningRevision === 1 &&
        sameRef(valueRow.packageRef, challengePackage),
    );
    requireRule(question.choices.includes(valueRow.answerKind as never));
    requireRule(
      valueRow.result === (valueRow.answerKind === question.anchorKind ? 'correct' : 'incorrect'),
    );
  }
  if (type === 'exercise.attempt-evaluated') assertAttempt(valueRow);
  if (type !== 'daily-goal.achieved') {
    assertPublicRef(valueRow.subjectRef);
    assertPublicRef(valueRow.packageRef);
    requireRule(
      isPythonPackage(valueRow.packageRef) ||
        isJavaPackage(valueRow.packageRef) ||
        isCppPackage(valueRow.packageRef) ||
        isRustPackage(valueRow.packageRef) ||
        isMysqlPackage(valueRow.packageRef)
        ? valueRow.learningRevision === 1 &&
            valueRow.subjectRef.version === '1.0.0' &&
            (isPythonPackage(valueRow.packageRef)
              ? isPythonSubject(type, valueRow.subjectRef.id)
              : isJavaPackage(valueRow.packageRef)
                ? isJavaSubject(type, valueRow.subjectRef.id)
                : isCppPackage(valueRow.packageRef)
                  ? isCppSubject(type, valueRow.subjectRef.id)
                  : isRustPackage(valueRow.packageRef)
                    ? isRustSubject(type, valueRow.subjectRef.id)
                    : isMysqlSubject(type, valueRow.subjectRef.id))
        : valueRow.subjectRef.id.startsWith(`${type.split('.')[0]}.`),
    );
    requireRule(isPositiveInt(valueRow.learningRevision));
  }
  return valueRow;
}
function dated(value: Row, timeField = 'occurredAt') {
  requireRule(isLocalDate(value.localDate) && isUtcTime(value[timeField]), 'S_DATE_INVALID');
}

/** Structural and row-local rules only; public content provenance is checked by its owner. */
export function assertRecord<S extends StoreName>(
  store: S,
  value: unknown,
): asserts value is StorageRecords[S] {
  switch (store) {
    case 'appearance': {
      const current = row(value, [
        'preset',
        'themeOverrides',
        'blockWorkspace',
        'layout',
        'background',
      ]);
      requireRule(hasType(current.preset, THEME_IDS));
      requireRule(hasType(current.blockWorkspace, ['auto', 'show', 'hide']));
      const overrides = row(current.themeOverrides, THEME_IDS);
      for (const id of THEME_IDS) {
        const override = row(overrides[id], ['accentColor']);
        requireRule(
          override.accentColor === null ||
            (typeof override.accentColor === 'string' &&
              /^#[0-9A-F]{6}$/.test(override.accentColor)),
        );
      }
      const layout = row(current.layout, ['sidebar', 'workbenchMode', 'splitRatios']);
      requireRule(
        hasType(layout.sidebar, ['expanded', 'collapsed']) &&
          hasType(layout.workbenchMode, ['standard', 'focus']),
      );
      const ratios = row(layout.splitRatios, ['practice', 'visualize', 'review']);
      requireRule(Object.values(ratios).every((n) => isSafeUint(n) && n >= 30 && n <= 70));
      const background = row(current.background, [
        'assetId',
        'visible',
        'fit',
        'position',
        'overlayOpacity',
      ]);
      requireRule(
        (background.assetId === null || background.assetId === 'background') &&
          typeof background.visible === 'boolean',
      );
      requireRule(background.assetId !== null || background.visible === false);
      requireRule(
        hasType(background.fit, ['cover', 'contain', 'tile']) &&
          hasType(background.position, ['center', 'top', 'bottom']),
      );
      requireRule(isSafeUint(background.overlayOpacity) && background.overlayOpacity <= 90);
      return;
    }
    case 'appearanceAssets': {
      const asset = row(value, ['assetId', 'mimeType', 'byteLength', 'width', 'height', 'blob']);
      requireRule(
        asset.assetId === 'background' &&
          hasType(asset.mimeType, ['image/png', 'image/jpeg', 'image/webp']),
      );
      requireRule(isPositiveInt(asset.byteLength) && asset.byteLength <= 5_242_880);
      requireRule(
        isPositiveInt(asset.width) &&
          asset.width <= 4096 &&
          isPositiveInt(asset.height) &&
          asset.height <= 4096,
      );
      requireRule(
        typeof Blob !== 'undefined' &&
          asset.blob instanceof Blob &&
          asset.blob.size === asset.byteLength &&
          asset.blob.type === asset.mimeType,
      );
      return;
    }
    case 'meta': {
      const descriptor =
        value && typeof value === 'object'
          ? Object.getOwnPropertyDescriptor(value, 'schemaVersion')
          : undefined;
      if (descriptor && 'value' in descriptor && descriptor.value === '10.0.0') {
        assertC6Meta(value);
        return;
      }
      if (descriptor && 'value' in descriptor && descriptor.value === '11.0.0') {
        assertPythonMeta(value);
        return;
      }
      if (descriptor && 'value' in descriptor && descriptor.value === '12.0.0') {
        assertJavaMeta(value);
        return;
      }
      if (descriptor && 'value' in descriptor && descriptor.value === '13.0.0') {
        assertCppMeta(value);
        return;
      }
      if (descriptor && 'value' in descriptor && descriptor.value === '15.0.0') {
        assertMysqlMeta(value);
        return;
      }
      if (descriptor && 'value' in descriptor && descriptor.value === '14.0.0') {
        assertRustMeta(value);
        return;
      }
      const valueRow = row(value, [
        'schemaVersion',
        'dbVersion',
        'generation',
        'revision',
        'timeZone',
        'createdAt',
        'activePackageRef',
      ]);
      requireRule(
        valueRow.schemaVersion === SCHEMA_VERSION && valueRow.dbVersion === DB_VERSION,
        'S_VERSION_UNKNOWN',
      );
      requireRule(isUuid(valueRow.generation) && isSafeUint(valueRow.revision));
      requireRule(isUtcTime(valueRow.createdAt) && isTimeZone(valueRow.timeZone), 'S_DATE_INVALID');
      assertPublicRef(valueRow.activePackageRef);
      return;
    }
    case 'settings': {
      const valueRow = row(value, ['theme', 'reducedMotion', 'playbackRate', 'goalTemplate']);
      requireRule(
        hasType(valueRow.theme, ['system', 'light', 'dark']) &&
          hasType(valueRow.reducedMotion, ['system', 'on', 'off']),
      );
      requireRule(
        typeof valueRow.playbackRate === 'number' &&
          [0.25, 0.5, 1, 1.5, 2, 4].includes(valueRow.playbackRate),
      );
      if (valueRow.goalTemplate !== null) {
        const template = row(valueRow.goalTemplate, ['revision', 'targets']);
        requireRule(isPositiveInt(template.revision));
        assertGoalTargets(template.targets);
      }
      return;
    }
    case 'avatar': {
      const valueRow = row(value, ['presetId', 'accentColor']);
      requireRule(isEntityId(valueRow.presetId) && valueRow.presetId.startsWith('avatar.'));
      requireRule(
        typeof valueRow.accentColor === 'string' && /^#[0-9A-F]{6}$/.test(valueRow.accentColor),
      );
      return;
    }
    case 'progress': {
      const valueRow = eventRow(value, progressFields, false);
      requireRule(isUtcTime(valueRow.firstAt) && isUtcTime(valueRow.lastAt), 'S_DATE_INVALID');
      requireRule(valueRow.firstAt <= valueRow.lastAt);
      return;
    }
    case 'dailyFacts': {
      const valueRow = row(value, [
        'eventType',
        'subjectRef',
        'canonicalSubjectId',
        'occurredAt',
        'localDate',
      ]);
      requireRule(hasType(valueRow.eventType, dailyEvents));
      assertPublicRef(valueRow.subjectRef);
      requireRule(isEntityId(valueRow.canonicalSubjectId));
      const prefix = `${valueRow.eventType.split('.')[0]}.`;
      requireRule(
        (valueRow.subjectRef.id.startsWith(prefix) &&
          valueRow.canonicalSubjectId.startsWith(prefix)) ||
          (valueRow.subjectRef.version === '1.0.0' &&
            (isPythonSubject(valueRow.eventType, valueRow.subjectRef.id) ||
              isJavaSubject(valueRow.eventType, valueRow.subjectRef.id) ||
              isCppSubject(valueRow.eventType, valueRow.subjectRef.id) ||
              isRustSubject(valueRow.eventType, valueRow.subjectRef.id) ||
              isMysqlSubject(valueRow.eventType, valueRow.subjectRef.id)) &&
            valueRow.canonicalSubjectId === valueRow.subjectRef.id),
      );
      dated(valueRow);
      return;
    }
    case 'goals': {
      const valueRow = row(value, ['localDate', 'goalVersion', 'targets', 'achievedAt']);
      requireRule(isLocalDate(valueRow.localDate), 'S_DATE_INVALID');
      requireRule(isPositiveInt(valueRow.goalVersion));
      if (valueRow.targets !== null) assertGoalTargets(valueRow.targets);
      if (valueRow.achievedAt !== null) {
        requireRule(valueRow.targets !== null);
        requireRule(isUtcTime(valueRow.achievedAt), 'S_DATE_INVALID');
      }
      return;
    }
    case 'ledger': {
      const valueRow = row(value, [
        'sourceId',
        'subjectId',
        'localDate',
        'occurredAt',
        'status',
        'points',
        'policyRef',
      ]);
      requireRule(hasType(valueRow.sourceId, Object.keys(sourceEvents)));
      dated(valueRow);
      if (valueRow.sourceId === 'reward.daily-goal.once') {
        requireRule(valueRow.subjectId === `local-goal.${valueRow.localDate}`);
      } else {
        requireRule(isEntityId(valueRow.subjectId));
        const event = sourceEvents[valueRow.sourceId as keyof typeof sourceEvents];
        requireRule(
          valueRow.subjectId.startsWith(`${event.split('.')[0]}.`) ||
            isC6TopicRewardSubject(valueRow.sourceId, valueRow.subjectId) ||
            isPythonSubject(event, valueRow.subjectId as string) ||
            isJavaSubject(event, valueRow.subjectId as string) ||
            isCppSubject(event, valueRow.subjectId as string) ||
            isRustSubject(event, valueRow.subjectId as string) ||
            isMysqlSubject(event, valueRow.subjectId as string),
        );
      }
      if (valueRow.sourceId === challengeSource) {
        requireRule(
          challengeQuestion(valueRow.subjectId as string) &&
            valueRow.status === 'posted' &&
            (valueRow.points === 2 || valueRow.points === -1),
        );
        assertPublicRef(valueRow.policyRef);
        requireRule(sameRef(valueRow.policyRef, challengePolicy));
      } else if (valueRow.status === 'pending')
        requireRule(valueRow.points === null && valueRow.policyRef === null);
      else {
        requireRule(valueRow.status === 'posted' && isSafeUint(valueRow.points));
        assertPublicRef(valueRow.policyRef);
      }
      return;
    }
    case 'receipts': {
      const valueRow = eventRow(value, receiptFields, true);
      requireRule(
        isUuid(valueRow.eventId) &&
          isPositiveInt(valueRow.goalVersion) &&
          isPositiveInt(valueRow.committedRevision),
      );
      dated(valueRow);
      if (valueRow.eventType === 'daily-goal.achieved') {
        const subject = row(valueRow.subjectRef, ['id', 'version']);
        requireRule(
          subject.id === `local-goal.${valueRow.localDate}` &&
            subject.version === String(valueRow.goalVersion),
        );
        requireRule(valueRow.packageRef === null && valueRow.learningRevision === null);
      }
      return;
    }
    case 'aliases': {
      const valueRow = row(value, [
        'fromRef',
        'toRef',
        'fromAcceptedPriorVersions',
        'kind',
        'learningRevision',
        'manifestRef',
      ]);
      assertPublicRef(valueRow.fromRef);
      assertPublicRef(valueRow.toRef);
      assertPublicRef(valueRow.manifestRef);
      requireRule(
        hasType(valueRow.kind, ['lesson', 'exercise', 'case']) &&
          isPositiveInt(valueRow.learningRevision),
      );
      requireRule(
        valueRow.fromRef.id !== valueRow.toRef.id &&
          valueRow.fromRef.id.startsWith(`${valueRow.kind}.`) &&
          valueRow.toRef.id.startsWith(`${valueRow.kind}.`),
      );
      const prior = list(valueRow.fromAcceptedPriorVersions);
      requireRule(prior.every(isVersion) && new Set(prior).size === prior.length);
      return;
    }
  }
  throw new StorageValidationError();
}
export function validateRecord<S extends StoreName>(
  store: S,
  value: unknown,
): value is StorageRecords[S] {
  try {
    assertRecord(store, value);
    return true;
  } catch {
    return false;
  }
}
function canonicalSubjectId(aliases: Alias[], subjectId: string): string {
  const seen = new Set<string>();
  let current = subjectId;
  for (let count = 0; count <= 32; count++) {
    requireRule(!seen.has(current));
    seen.add(current);
    const alias = aliases.find((alias) => alias.toRef.id === current);
    if (!alias) return current;
    current = alias.fromRef.id;
  }
  throw new StorageValidationError();
}
function sameRef(first: PublicRef, second: PublicRef) {
  return first.id === second.id && first.version === second.version;
}
function checkRelations(snapshot: StorageSnapshot) {
  const { meta, progress, dailyFacts, goals, ledger, receipts, aliases } = snapshot;
  requireRule(new Set(aliases.map((alias) => alias.toRef.id)).size === aliases.length);
  for (const event of [...progress, ...receipts]) {
    if (event.packageRef && isPythonPackage(event.packageRef))
      requireRule(meta.dbVersion >= 11 && isPythonProgress(event));
    if (event.packageRef && isJavaPackage(event.packageRef))
      requireRule(meta.dbVersion >= 12 && isJavaProgress(event));
    if (event.packageRef && isCppPackage(event.packageRef))
      requireRule(meta.dbVersion >= 13 && isCppProgress(event));
    if (event.packageRef && isRustPackage(event.packageRef))
      requireRule(meta.dbVersion >= 14 && isRustProgress(event));
    if (event.packageRef && isMysqlPackage(event.packageRef))
      requireRule(meta.dbVersion >= 15 && isMysqlProgress(event));
  }
  for (const alias of aliases) {
    canonicalSubjectId(aliases, alias.toRef.id);
    const next = aliases.find((next) => next.fromRef.id === alias.toRef.id);
    if (next)
      requireRule(
        next.kind === alias.kind &&
          next.learningRevision === alias.learningRevision &&
          (alias.toRef.version === next.fromRef.version ||
            next.fromAcceptedPriorVersions.includes(alias.toRef.version)),
      );
  }
  const assertDate = (at: string, localDate: string) =>
    requireRule(localDateAt(at, meta.timeZone) === localDate, 'S_DATE_INVALID');
  for (const fact of dailyFacts) {
    assertDate(fact.occurredAt, fact.localDate);
    requireRule(canonicalSubjectId(aliases, fact.subjectRef.id) === fact.canonicalSubjectId);
    requireRule(goals.some((goal) => goal.localDate === fact.localDate));
    requireRule(
      progress.some(
        (item) => item.eventType === fact.eventType && sameRef(item.subjectRef, fact.subjectRef),
      ),
    );
  }
  for (const goal of goals)
    if (goal.achievedAt !== null) {
      assertDate(goal.achievedAt, goal.localDate);
      const facts = dailyFacts.filter((fact) => fact.localDate === goal.localDate);
      requireRule(
        goal.targets !== null &&
          (Object.entries(goal.targets) as [keyof GoalTargets, number][]).every(
            ([kind, count]) =>
              facts.filter((fact) => fact.eventType.startsWith(`${kind}.`)).length >= count,
          ),
      );
      requireRule(
        ledger.some(
          (entry) =>
            entry.sourceId === 'reward.daily-goal.once' &&
            entry.localDate === goal.localDate &&
            entry.occurredAt === goal.achievedAt,
        ),
      );
    }
  for (const entry of ledger) {
    assertDate(entry.occurredAt, entry.localDate);
    if (isC6TopicRewardSubject(entry.sourceId, entry.subjectId)) requireRule(meta.dbVersion >= 10);
    // The declared synthetic predecessor preserves old awards, without inventing
    // current daily goals, facts or completion. This is never reward authorization.
    const legacy =
      entry.status === 'posted' &&
      entry.policyRef.id === 'legacy.fixture' &&
      entry.policyRef.version === '0.9.0';
    if (entry.sourceId === challengeSource) {
      const first = receipts
        .filter((r) => r.eventType === 'challenge.answered' && r.subjectRef.id === entry.subjectId)
        .sort((a, b) => a.committedRevision - b.committedRevision)[0];
      requireRule(
        first?.eventType === 'challenge.answered' &&
          first.occurredAt === entry.occurredAt &&
          first.localDate === entry.localDate &&
          entry.points === (first.result === 'correct' ? 2 : -1),
      );
    } else if (entry.sourceId === 'reward.daily-goal.once') {
      requireRule(
        legacy ||
          goals.some(
            (goal) => goal.localDate === entry.localDate && goal.achievedAt === entry.occurredAt,
          ),
      );
    } else {
      requireRule(canonicalSubjectId(aliases, entry.subjectId) === entry.subjectId);
      requireRule(
        meta.dbVersion >= 10 &&
          (entry.sourceId === 'reward.lesson.first-completion' ||
            entry.sourceId === 'reward.exercise.first-pass')
          ? hasC6RewardEvidence(snapshot, entry) ||
              (meta.dbVersion >= 11 &&
                progress.some(
                  (item) =>
                    (isPythonProgress(item) ||
                      (meta.dbVersion >= 12 && isJavaProgress(item)) ||
                      (meta.dbVersion >= 13 && isCppProgress(item)) ||
                      (meta.dbVersion >= 14 && isRustProgress(item)) ||
                      (meta.dbVersion >= 15 && isMysqlProgress(item))) &&
                    item.eventType === sourceEvents[entry.sourceId] &&
                    item.subjectRef.id === entry.subjectId &&
                    item.firstAt <= entry.occurredAt,
                ))
          : legacy ||
              progress.some(
                (item) =>
                  item.eventType === sourceEvents[entry.sourceId] &&
                  canonicalSubjectId(aliases, item.subjectRef.id) === entry.subjectId,
              ),
      );
    }
  }
  for (const receipt of receipts) {
    assertDate(receipt.occurredAt, receipt.localDate);
    requireRule(receipt.committedRevision <= meta.revision);
    const goal = goals.find((goal) => goal.localDate === receipt.localDate);
    requireRule(goal && goal.goalVersion === receipt.goalVersion);
    if (receipt.eventType === 'challenge.answered') {
      requireRule(
        ledger.some((e) => e.sourceId === challengeSource && e.subjectId === receipt.subjectRef.id),
      );
    } else if (receipt.eventType === 'daily-goal.achieved') {
      requireRule(goal.achievedAt === receipt.occurredAt);
    } else {
      requireRule(
        progress.some(
          (item) =>
            item.eventType === receipt.eventType &&
            sameRef(item.subjectRef, receipt.subjectRef) &&
            item.learningRevision === receipt.learningRevision,
        ),
      );
    }
  }
}
/** Validate the nine-store read projection; this never authorizes a learning fact or import. */
export function assertSnapshot(value: unknown): asserts value is StorageSnapshot {
  const root = row(value, STORE_NAMES);
  assertRecord('meta', root.meta);
  assertRecord('settings', root.settings);
  assertRecord('avatar', root.avatar);
  assertRecord('appearance', root.appearance);
  const assets = list(root.appearanceAssets);
  for (const asset of assets) assertRecord('appearanceAssets', asset);
  requireRule(assets.length === (root.appearance.background.assetId === null ? 0 : 1));
  for (const store of COLLECTION_STORES) {
    const rows = list(root[store]);
    const keys = new Set<string>();
    for (const valueRow of rows) {
      assertRecord(store, valueRow);
      const key = JSON.stringify(recordKey(store, root.meta.generation, valueRow));
      requireRule(!keys.has(key));
      keys.add(key);
    }
  }
  checkRelations(value as StorageSnapshot);
}
export function validateSnapshot(value: unknown): value is StorageSnapshot {
  try {
    assertSnapshot(value);
    return true;
  } catch {
    return false;
  }
}

// Exported only for controlled migrations, which must reject complete unknown shapes.
export const validationInternals = { row, list, requireRule };
export type { ContentEventType };
