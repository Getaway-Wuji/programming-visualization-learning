import type { Ref } from '../storage/model';
import {
  assertPublicRef,
  isLocalDate,
  isPositiveInt,
  isSafeUint,
  isUtcTime,
  isUuid,
  localDateAt,
  validationInternals,
} from '../storage/validation';
import { StorageError } from '../storage/errors';
export const intervals = [0, 1, 3, 7, 14, 30, 60] as const;
export const ratingLabels = { again: '重学', hard: '吃力', good: '记得', easy: '熟练' } as const;
export type Rating = keyof typeof ratingLabels;
export interface ReviewSource {
  kind: 'exercise' | 'knowledge';
  packageRef: Ref;
  subjectRef: Ref;
  lessonRef: Ref;
  learningRevision: number;
  sourceVersion: number;
  sourceAt: string;
  state: 'active' | 'repaired' | 'familiar';
}
export interface ReviewCommand {
  commandId: string;
  cardId: string;
  expectedVersion: number;
  sourceVersion: number;
  mode: 'rate' | 'correct' | 'restart';
  rating: Rating | null;
  targetReviewId: string | null;
  at: string;
  localDate: string;
}
export interface ReviewEvaluation {
  reviewId: string;
  at: string;
  localDate: string;
  rating: Rating;
  baseLevel: number;
  baseDueDate: string;
  baseCount: number;
}
export interface ReviewCard extends Omit<ReviewSource, 'state'> {
  cardVersion: '1.0.0';
  algorithm: 'calendar-box-1';
  generation: string;
  cardId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  state: ReviewSource['state'] | 'unavailable';
  level: number;
  reviewCount: number;
  dueDate: string;
  lastReview: ReviewEvaluation | null;
  lastCommand: ReviewCommand | null;
}
export const cardIdFor = (
  s: Pick<ReviewSource, 'kind' | 'packageRef' | 'subjectRef' | 'learningRevision'>,
) =>
  JSON.stringify([
    s.kind,
    s.packageRef.id,
    s.packageRef.version,
    s.subjectRef.id,
    s.subjectRef.version,
    s.learningRevision,
  ]);
const { row } = validationInternals;
const level = (n: unknown) => isSafeUint(n) && n <= 6;
const rating = (r: unknown): r is Rating => typeof r === 'string' && Object.hasOwn(ratingLabels, r);
function requireRule(ok: unknown): asserts ok {
  if (!ok) throw new StorageError('S_RECORD_INVALID');
}
export function assertReviewCommand(v: unknown): asserts v is ReviewCommand {
  const r = row(v, [
    'commandId',
    'cardId',
    'expectedVersion',
    'sourceVersion',
    'mode',
    'rating',
    'targetReviewId',
    'at',
    'localDate',
  ]);
  requireRule(
    isUuid(r.commandId) &&
      typeof r.cardId === 'string' &&
      r.cardId.length <= 1024 &&
      isPositiveInt(r.expectedVersion) &&
      isPositiveInt(r.sourceVersion) &&
      isUtcTime(r.at) &&
      isLocalDate(r.localDate),
  );
  requireRule(['rate', 'correct', 'restart'].includes(r.mode as string));
  requireRule(
    r.mode === 'restart'
      ? r.rating === null && r.targetReviewId === null
      : rating(r.rating) &&
          (r.mode === 'correct' ? isUuid(r.targetReviewId) : r.targetReviewId === null),
  );
}
export function assertReviewCard(v: unknown): asserts v is ReviewCard {
  const r = row(v, [
    'cardVersion',
    'algorithm',
    'generation',
    'cardId',
    'kind',
    'packageRef',
    'subjectRef',
    'lessonRef',
    'learningRevision',
    'sourceVersion',
    'sourceAt',
    'revision',
    'createdAt',
    'updatedAt',
    'state',
    'level',
    'reviewCount',
    'dueDate',
    'lastReview',
    'lastCommand',
  ]);
  requireRule(
    r.cardVersion === '1.0.0' &&
      r.algorithm === 'calendar-box-1' &&
      isUuid(r.generation) &&
      ['exercise', 'knowledge'].includes(r.kind as string),
  );
  for (const k of ['packageRef', 'subjectRef', 'lessonRef']) assertPublicRef(r[k]);
  requireRule(
    isPositiveInt(r.learningRevision) &&
      isPositiveInt(r.sourceVersion) &&
      isPositiveInt(r.revision) &&
      isUtcTime(r.sourceAt) &&
      isUtcTime(r.createdAt) &&
      isUtcTime(r.updatedAt) &&
      r.createdAt <= r.updatedAt &&
      level(r.level) &&
      isSafeUint(r.reviewCount) &&
      isLocalDate(r.dueDate) &&
      ['active', 'repaired', 'familiar', 'unavailable'].includes(r.state as string),
  );
  requireRule(cardIdFor(r as unknown as ReviewCard) === r.cardId);
  if (r.lastReview !== null) {
    const e = row(r.lastReview, [
      'reviewId',
      'at',
      'localDate',
      'rating',
      'baseLevel',
      'baseDueDate',
      'baseCount',
    ]);
    requireRule(
      isUuid(e.reviewId) &&
        isUtcTime(e.at) &&
        isLocalDate(e.localDate) &&
        rating(e.rating) &&
        level(e.baseLevel) &&
        isLocalDate(e.baseDueDate) &&
        isSafeUint(e.baseCount) &&
        e.baseCount < Number.MAX_SAFE_INTEGER &&
        r.reviewCount === e.baseCount + 1,
    );
    const plan = scheduled(e.baseLevel as number, e.rating as Rating, e.localDate as string);
    requireRule(r.level === plan.level && r.dueDate === plan.dueDate && r.state === 'active');
  }
  if (r.lastCommand !== null) {
    assertReviewCommand(r.lastCommand);
    requireRule(
      r.lastCommand.cardId === r.cardId &&
        r.lastCommand.sourceVersion === r.sourceVersion &&
        r.lastCommand.expectedVersion + 1 === r.revision,
    );
  }
}
/** Gregorian calendar arithmetic on a date, never a duration added to a zoned instant. */
export function addReviewDays(date: string, days: number): string {
  if (!isLocalDate(date) || !isSafeUint(days) || days > 60)
    throw new StorageError('S_DATE_INVALID');
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const out = d.toISOString().slice(0, 10);
  if (!isLocalDate(out)) throw new StorageError('S_DATE_INVALID');
  return out;
}
export function scheduled(baseLevel: number, value: Rating, date: string) {
  requireRule(level(baseLevel) && rating(value));
  const nextLevel =
    value === 'again'
      ? 0
      : value === 'hard'
        ? Math.max(1, baseLevel)
        : Math.min(6, baseLevel + (value === 'easy' ? 2 : 1));
  const days =
    value === 'again'
      ? 1
      : value === 'hard'
        ? Math.max(1, Math.ceil(intervals[nextLevel] / 2))
        : intervals[nextLevel];
  return { level: nextLevel, days, dueDate: addReviewDays(date, days) };
}
export function synchronizeCards(
  previous: readonly ReviewCard[],
  sources: readonly ReviewSource[],
  generation: string,
  at: string,
  zone: string,
): ReviewCard[] {
  requireRule(isUuid(generation) && isUtcTime(at));
  const next = previous.map((c) => structuredClone(c)),
    found = new Set<string>();
  for (const source of sources) {
    const id = cardIdFor(source);
    requireRule(!found.has(id));
    found.add(id);
    const index = next.findIndex((c) => c.cardId === id),
      old = next[index];
    if (old && old.sourceVersion > source.sourceVersion)
      throw new StorageError('S_REVISION_CONFLICT');
    if (old?.sourceVersion === source.sourceVersion && old.state !== 'unavailable') continue;
    const card: ReviewCard = {
      ...source,
      cardVersion: '1.0.0',
      algorithm: 'calendar-box-1',
      generation,
      cardId: id,
      revision: (old?.revision ?? 0) + 1,
      createdAt: old?.createdAt ?? at,
      updatedAt: at,
      level: 0,
      reviewCount: old?.reviewCount ?? 0,
      dueDate: localDateAt(source.sourceAt, zone),
      lastReview: null,
      lastCommand: null,
    };
    assertReviewCard(card);
    if (old) next[index] = card;
    else next.push(card);
  }
  for (const card of next)
    if (!found.has(card.cardId) && card.state !== 'unavailable') {
      card.state = 'unavailable';
      card.revision++;
      card.updatedAt = at;
      card.lastCommand = null;
      card.lastReview = null;
    }
  return next;
}
export function applyReviewCommand(
  cards: readonly ReviewCard[],
  cmd: ReviewCommand,
  zone: string,
): ReviewCard[] {
  assertReviewCommand(cmd);
  if (localDateAt(cmd.at, zone) !== cmd.localDate) throw new StorageError('S_DATE_INVALID');
  const next = cards.map((c) => structuredClone(c)),
    c = next.find((c) => c.cardId === cmd.cardId);
  if (!c) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  const replay = next.find((r) => r.lastCommand?.commandId === cmd.commandId);
  if (replay) {
    if (
      !Object.keys(cmd).every(
        (key) =>
          replay.lastCommand![key as keyof ReviewCommand] === cmd[key as keyof ReviewCommand],
      )
    )
      throw new StorageError('S_EVENT_ID_REUSED');
    return next;
  }
  if (c.revision !== cmd.expectedVersion || c.sourceVersion !== cmd.sourceVersion)
    throw new StorageError('S_REVISION_CONFLICT');
  if (cmd.at < c.updatedAt) throw new StorageError('S_DATE_INVALID');
  if (c.state !== 'active' && !(cmd.mode === 'restart' && c.state === 'repaired'))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  if (cmd.mode === 'restart') {
    c.state = 'active';
    c.level = 0;
    c.dueDate = cmd.localDate;
    c.lastReview = null;
  } else {
    if (cmd.mode === 'rate' && c.dueDate > cmd.localDate) throw new StorageError('S_DATE_INVALID');
    const e: ReviewEvaluation =
      cmd.mode === 'correct'
        ? (() => {
            if (!c.lastReview || c.lastReview.reviewId !== cmd.targetReviewId)
              throw new StorageError('S_REVISION_CONFLICT');
            return { ...c.lastReview, rating: cmd.rating! };
          })()
        : {
            reviewId: cmd.commandId,
            at: cmd.at,
            localDate: cmd.localDate,
            rating: cmd.rating!,
            baseLevel: c.level,
            baseDueDate: c.dueDate,
            baseCount: c.reviewCount,
          };
    const plan = scheduled(e.baseLevel, e.rating, e.localDate);
    c.level = plan.level;
    c.dueDate = plan.dueDate;
    c.reviewCount = e.baseCount + 1;
    c.lastReview = e;
  }
  c.revision++;
  c.updatedAt = cmd.at;
  c.lastCommand = structuredClone(cmd);
  assertReviewCard(c);
  return next;
}
export function reviewGroups(cards: readonly ReviewCard[], today: string) {
  if (!isLocalDate(today)) throw new StorageError('S_DATE_INVALID');
  const sorted = [...cards].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.cardId.localeCompare(b.cardId),
  );
  return {
    due: sorted.filter((c) => c.state === 'active' && c.dueDate <= today),
    future: sorted.filter((c) => c.state === 'active' && c.dueDate > today),
    paused: sorted.filter((c) => c.state !== 'active'),
  };
}
