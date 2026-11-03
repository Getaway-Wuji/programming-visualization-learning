import config from '../../../content/achievements/catalog-1.0.0.json';
import c6Config from '../../../content/achievements/catalog-2.0.0.json';
import type { Ref, StorageSnapshot, ContentReceipt, Progress } from '../storage/model';
import type { LearningCatalog } from '../learning/types';
import { reviewedDurableSnapshot } from '../learning/reviewed-release';
import { isCompatibleLearningHistory } from '../learning/domain';
import { sameRef } from '../learning/catalog';
import { StorageError } from '../storage/errors';
import {
  assertPublicRef,
  isPositiveInt,
  isUuid,
  isUtcTime,
  validationInternals,
} from '../storage/validation';

export const achievementCatalog = config;
export const c6AchievementCatalog = c6Config;
export interface AchievementEvidence {
  kind: 'exercise' | 'observation';
  eventId: string;
  subjectRef: Ref;
  learningRevision: number;
  occurredAt: string;
}
export interface Achievement {
  achievementVersion: '1.0.0' | '2.0.0';
  generation: string;
  revision: number;
  catalogRef: Ref;
  badgeRef: Ref;
  packageRef: Ref;
  unlockedAt: string | null;
  evidence: AchievementEvidence[];
}
const { row, list } = validationInternals;
function requireRule(ok: unknown): asserts ok {
  if (!ok) throw new StorageError('S_RECORD_INVALID');
}
export function assertAchievementEvidence(v: unknown): asserts v is AchievementEvidence {
  const r = row(v, ['kind', 'eventId', 'subjectRef', 'learningRevision', 'occurredAt']);
  assertPublicRef(r.subjectRef);
  requireRule(
    ['exercise', 'observation'].includes(r.kind as string) &&
      isUuid(r.eventId) &&
      r.learningRevision === 1 &&
      isUtcTime(r.occurredAt),
  );
}
export function assertAchievement(v: unknown, catalog = config): asserts v is Achievement {
  const config = catalog;
  const r = row(v, [
    'achievementVersion',
    'generation',
    'revision',
    'catalogRef',
    'badgeRef',
    'packageRef',
    'unlockedAt',
    'evidence',
  ]);
  for (const k of ['catalogRef', 'badgeRef', 'packageRef']) assertPublicRef(r[k]);
  requireRule(
    r.achievementVersion === config.ref.version &&
      isUuid(r.generation) &&
      isPositiveInt(r.revision),
  );
  if (!sameRef(r.catalogRef as Ref, config.ref) || !sameRef(r.packageRef as Ref, config.packageRef))
    throw new StorageError('S_VERSION_UNKNOWN');
  const badge = config.badges.find((b) => sameRef(b, r.badgeRef as Ref));
  if (!badge) throw new StorageError('S_VERSION_UNKNOWN');
  requireRule(
    Array.isArray(r.evidence) &&
      r.evidence.length > 0 &&
      r.evidence.length <= badge.requirements.length,
  );
  list(r.evidence);
  const subjects = new Set<string>(),
    events = new Set<string>();
  for (const e of r.evidence) {
    assertAchievementEvidence(e);
    requireRule(
      badge.requirements.some(
        (q) =>
          q.kind === e.kind &&
          sameRef(q, e.subjectRef) &&
          q.learningRevision === e.learningRevision,
      ),
    );
    requireRule(!subjects.has(e.subjectRef.id) && !events.has(e.eventId));
    subjects.add(e.subjectRef.id);
    events.add(e.eventId);
  }
  const complete = r.evidence.length === badge.requirements.length;
  requireRule(
    complete
      ? isUtcTime(r.unlockedAt) &&
          r.unlockedAt ===
            r.evidence
              .map((e) => e.occurredAt)
              .sort()
              .at(-1)
      : r.unlockedAt === null,
  );
}

/** Only reviewed, compatible, durable pass receipts are sources. A progress row alone is insufficient. */
export function achievementPassSources(
  snapshot: StorageSnapshot,
  catalog: LearningCatalog,
): AchievementEvidence[] {
  const events = snapshot.receipts
    .filter(
      (r): r is Extract<ContentReceipt, { eventType: 'exercise.passed' }> =>
        r.eventType === 'exercise.passed',
    )
    .sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) || a.committedRevision - b.committedRevision,
    );
  const progress = events.map(
    (r) => ({ ...r, firstAt: r.occurredAt, lastAt: r.occurredAt }) as Progress,
  );
  const approved = new Set(reviewedDurableSnapshot({ ...snapshot, progress }, catalog).progress);
  const out: AchievementEvidence[] = [];
  for (const [i, r] of events.entries()) {
    const e = approved.has(progress[i])
      ? catalog.exercises.find((e) =>
          isCompatibleLearningHistory(progress[i], e, 'exercise', snapshot.aliases),
        )
      : undefined;
    if (e)
      out.push({
        kind: 'exercise',
        eventId: r.eventId,
        subjectRef: { ...e.ref },
        learningRevision: e.learningRevision,
        occurredAt: r.occurredAt,
      });
  }
  return out;
}
export function mergeAchievements(
  previous: readonly Achievement[],
  sources: readonly AchievementEvidence[],
  generation: string,
  catalog = config,
): Achievement[] {
  const config = catalog;
  requireRule(isUuid(generation));
  for (const p of previous) {
    assertAchievement(p, config);
    requireRule(p.generation === generation);
  }
  requireRule(new Set(previous.map((p) => p.badgeRef.id)).size === previous.length);
  const byEvent = new Map<string, string>();
  for (const e of [...previous.flatMap((p) => p.evidence), ...sources]) {
    assertAchievementEvidence(e);
    const payload = JSON.stringify([
      e.kind,
      e.subjectRef.id,
      e.subjectRef.version,
      e.learningRevision,
      e.occurredAt,
    ]);
    requireRule(!byEvent.has(e.eventId) || byEvent.get(e.eventId) === payload);
    byEvent.set(e.eventId, payload);
  }
  const rows = previous.map((p) => structuredClone(p));
  for (const badge of config.badges) {
    let current = rows.find((p) => p.badgeRef.id === badge.id);
    for (const q of badge.requirements) {
      if (current?.evidence.some((e) => sameRef(e.subjectRef, q))) continue;
      const e = sources.find(
        (e) =>
          e.kind === q.kind &&
          sameRef(e.subjectRef, q) &&
          e.learningRevision === q.learningRevision,
      );
      if (!e) continue;
      if (!current) {
        current = {
          achievementVersion: config.ref.version === '2.0.0' ? '2.0.0' : '1.0.0',
          generation,
          revision: 1,
          catalogRef: { ...config.ref },
          badgeRef: { id: badge.id, version: badge.version },
          packageRef: { ...config.packageRef },
          unlockedAt: null,
          evidence: [],
        };
        rows.push(current);
      } else {
        requireRule(current.revision < Number.MAX_SAFE_INTEGER);
        current.revision++;
      }
      current.evidence.push(structuredClone(e));
      current.evidence.sort(
        (a, b) =>
          badge.requirements.findIndex((q) => q.id === a.subjectRef.id) -
          badge.requirements.findIndex((q) => q.id === b.subjectRef.id),
      );
      if (current.evidence.length === badge.requirements.length)
        current.unlockedAt = current.evidence
          .map((e) => e.occurredAt)
          .sort()
          .at(-1)!;
    }
  }
  for (const p of rows) assertAchievement(p, config);
  if (rows.length > 100 || new TextEncoder().encode(JSON.stringify(rows)).length > 131072)
    throw new StorageError('S_QUOTA');
  return rows;
}
