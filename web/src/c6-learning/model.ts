import type { Ref } from '../storage/model';
import type { LearningCommand } from '../learning/types';
export type C6LearningCommand = LearningCommand & { readonly learnVersion: '2.0.0' };
import { StorageError } from '../storage/errors';
import { isPositiveInt, isUtcTime, isUuid, validationInternals } from '../storage/validation';
import type { C6LearningIndex } from './index';
import { isC6SourceNode } from './index';
import { c6LearningRelease } from './release.generated';

export interface C6Attempt {
  eventId: string;
  at: string;
  sourceRevision: string;
  sourceSha256: string;
  requestSha256: string;
  resultSha256: string;
  engineBuildSha256: string;
  profileRef: Ref;
  status: 'passed' | 'failed' | 'incomplete';
  caseKeys: string[];
  failedCaseKey: string | null;
  failure: 'wrong-answer' | 'teaching-goal-unmet' | 'program-error' | null;
}
interface ActivityBase {
  activityVersion: '2.0.0';
  generation: string;
  subjectRef: Ref;
  revision: number;
  lastEventId: string;
  firstAt: string;
  lastAt: string;
}
export type C6CourseActivity = ActivityBase &
  (
    | { kind: 'lesson'; startedAt: string; readAt: string | null; completedAt: string | null }
    | { kind: 'exercise'; firstPass: C6Attempt | null; latestAttempt: C6Attempt }
  );
export interface C6CourseDraft {
  draftVersion: '2.0.0';
  generation: string;
  documentId: string;
  nodeRef: Ref;
  exerciseRef: Ref | null;
  sourceRevision: string;
  source: string;
  input: string;
  revision: number;
  updatedAt: string;
}
export interface C6CourseRows {
  activities: C6CourseActivity[];
  drafts: C6CourseDraft[];
}
const { row } = validationInternals;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const opaque = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(v);
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
function check(value: unknown): asserts value {
  if (!value) throw new StorageError('S_RECORD_INVALID');
}
function version(value: unknown, field: string): void {
  if (value && typeof value === 'object') {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (
      descriptor &&
      'value' in descriptor &&
      typeof descriptor.value === 'string' &&
      descriptor.value !== '2.0.0'
    )
      throw new StorageError('S_VERSION_UNKNOWN');
  }
}
function dense(value: unknown, limit: number): asserts value is unknown[] {
  check(
    Array.isArray(value) &&
      value.length <= limit &&
      Reflect.ownKeys(value).length === value.length + 1,
  );
  for (let i = 0; i < value.length; ++i) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    check(descriptor && 'value' in descriptor && descriptor.enumerable);
  }
}
function ref(value: unknown): Ref {
  const r = row(value, ['id', 'version']);
  check(opaque(r.id) && r.version === '2.0.0');
  return r as unknown as Ref;
}
export function assertC6Attempt(value: unknown, profileId: string): asserts value is C6Attempt {
  const r = row(value, [
    'eventId',
    'at',
    'sourceRevision',
    'sourceSha256',
    'requestSha256',
    'resultSha256',
    'engineBuildSha256',
    'profileRef',
    'status',
    'caseKeys',
    'failedCaseKey',
    'failure',
  ]);
  const profile = row(r.profileRef, ['id', 'version']);
  check(
    isUuid(r.eventId) &&
      isUtcTime(r.at) &&
      opaque(r.sourceRevision) &&
      hash(r.sourceSha256) &&
      hash(r.requestSha256) &&
      hash(r.resultSha256) &&
      r.engineBuildSha256 === c6LearningRelease.engineBuildSha256 &&
      profile.id === profileId &&
      profile.version === '1.0.0' &&
      ['passed', 'failed', 'incomplete'].includes(String(r.status)) &&
      Array.isArray(r.caseKeys) &&
      Reflect.ownKeys(r.caseKeys).length === r.caseKeys.length + 1 &&
      r.caseKeys.length <= 4 &&
      r.caseKeys.every((key, i) => key === `case-${i + 1}`) &&
      (r.failedCaseKey === null || r.caseKeys.includes(r.failedCaseKey)) &&
      (r.failure === null ||
        ['wrong-answer', 'teaching-goal-unmet', 'program-error'].includes(String(r.failure))),
  );
  check(
    r.status !== 'passed' ||
      (r.caseKeys.length === 4 && r.failedCaseKey === null && r.failure === null),
  );
}
export function assertC6CourseActivity(
  value: unknown,
  index: C6LearningIndex,
  generation: string,
  revision: number,
): asserts value is C6CourseActivity {
  version(value, 'activityVersion');
  const kind =
    value && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, 'kind')?.value
      : undefined;
  check(kind === 'lesson' || kind === 'exercise');
  const r = row(value, [
    'activityVersion',
    'generation',
    'subjectRef',
    'revision',
    'lastEventId',
    'firstAt',
    'lastAt',
    'kind',
    ...(kind === 'lesson'
      ? ['startedAt', 'readAt', 'completedAt']
      : ['firstPass', 'latestAttempt']),
  ]);
  const subject = ref(r.subjectRef);
  check(
    r.activityVersion === '2.0.0' &&
      r.generation === generation &&
      isPositiveInt(r.revision) &&
      r.revision <= revision &&
      isUuid(r.lastEventId) &&
      isUtcTime(r.firstAt) &&
      isUtcTime(r.lastAt) &&
      r.firstAt <= r.lastAt,
  );
  if (kind === 'lesson') {
    check(
      index.lessons.some((l) => l[0] === subject.id) &&
        isUtcTime(r.startedAt) &&
        r.firstAt <= r.startedAt &&
        r.startedAt <= r.lastAt,
    );
    for (const key of ['readAt', 'completedAt'])
      check(r[key] === null || (isUtcTime(r[key]) && r.firstAt <= r[key] && r[key] <= r.lastAt));
    check(r.completedAt === null || r.readAt !== null);
  } else {
    const exercise = index.exercises.find((e) => e[0] === subject.id);
    check(exercise);
    assertC6Attempt(r.latestAttempt, exercise[3]);
    check(r.latestAttempt.at <= r.lastAt && r.latestAttempt.at >= r.firstAt);
    if (r.firstPass !== null) {
      assertC6Attempt(r.firstPass, exercise[3]);
      check(
        r.firstPass.status === 'passed' &&
          r.firstPass.at <= r.lastAt &&
          r.firstPass.at >= r.firstAt,
      );
    }
    check(r.latestAttempt.status !== 'passed' || r.firstPass !== null);
  }
}
export function assertC6CourseDraft(
  value: unknown,
  index: C6LearningIndex,
  generation: string,
  revision: number,
): asserts value is C6CourseDraft {
  version(value, 'draftVersion');
  const r = row(value, [
    'draftVersion',
    'generation',
    'documentId',
    'nodeRef',
    'exerciseRef',
    'sourceRevision',
    'source',
    'input',
    'revision',
    'updatedAt',
  ]);
  const node = ref(r.nodeRef);
  check(
    r.draftVersion === '2.0.0' &&
      r.generation === generation &&
      opaque(r.documentId) &&
      opaque(r.sourceRevision) &&
      typeof r.source === 'string' &&
      new TextEncoder().encode(r.source).length <= 32768 &&
      typeof r.input === 'string' &&
      r.input.length <= 256 &&
      [...r.input].every((c) => c.charCodeAt(0) <= 127) &&
      isPositiveInt(r.revision) &&
      r.revision <= revision &&
      isUtcTime(r.updatedAt) &&
      isC6SourceNode(index, node.id),
  );
  if (r.exerciseRef !== null) {
    const exerciseRef = ref(r.exerciseRef);
    check(index.exercises.some((e) => e[0] === exerciseRef.id && e[1] === node.id));
  }
}
export function assertC6CourseRows(
  rows: C6CourseRows,
  index: C6LearningIndex,
  generation: string,
  revision: number,
): void {
  row(rows, ['activities', 'drafts']);
  dense(rows.activities, 871);
  dense(rows.drafts, 64);
  for (const r of rows.activities) assertC6CourseActivity(r, index, generation, revision);
  for (const r of rows.drafts) assertC6CourseDraft(r, index, generation, revision);
  check(
    bytes(rows.activities) <= 2097152 &&
      rows.drafts.reduce((n, d) => n + new TextEncoder().encode(d.source).length, 0) <= 2097152,
  );
  check(
    new Set(rows.activities.map((r) => r.subjectRef.id)).size === rows.activities.length &&
      new Set(rows.drafts.map((r) => r.documentId)).size === rows.drafts.length,
  );
}
