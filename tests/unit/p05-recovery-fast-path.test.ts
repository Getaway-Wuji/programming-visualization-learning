import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STORE_NAMES,
  recordKey,
  type Progress,
  type Receipt,
  type StorageSnapshot,
} from '../../web/src/storage/model';
import {
  inspectRecoveryRows,
  sameRecoveryValue,
  type RawStorageRows,
} from '../../web/src/storage/recovery';
import { assertSnapshot } from '../../web/src/storage/validation';
import { p05At, p05Catalog, p05Date, p05Empty, p05Package } from '../fixtures/p05-learning';

// Storage-only lifecycle summaries: these fixtures grant no execution/pass authority
// and are never installed into the product database or used as browser evidence.
function completedArchive(count: number): StorageSnapshot {
  const value = p05Empty();
  const catalog = p05Catalog();
  value.meta.revision = 1000;
  value.settings.goalTemplate = { revision: 1, targets: { exercise: 1, lesson: 1, case: 0 } };
  value.goals.push({
    localDate: p05Date,
    goalVersion: 1,
    targets: { exercise: 1, lesson: 1, case: 0 },
    achievedAt: p05At,
  });
  for (let index = 0; index < count; index++) {
    const lesson = catalog.lessons[index];
    const exercise = catalog.exercises.find(
      (exercise) => exercise.ref.id === lesson.requiredExerciseRefs[0].id,
    )!;
    const events: Progress[] = [
      {
        eventType: 'lesson.started',
        result: 'started',
        subjectRef: lesson.ref,
        packageRef: p05Package,
        learningRevision: 1,
        firstAt: p05At,
        lastAt: p05At,
      },
      {
        eventType: 'lesson.study-confirmed',
        result: 'confirmed',
        subjectRef: lesson.ref,
        packageRef: p05Package,
        learningRevision: 1,
        firstAt: p05At,
        lastAt: p05At,
      },
      {
        eventType: 'lesson.completed',
        result: 'completed',
        subjectRef: lesson.ref,
        packageRef: p05Package,
        learningRevision: 1,
        firstAt: p05At,
        lastAt: p05At,
      },
      {
        eventType: 'exercise.passed',
        result: 'passed',
        subjectRef: exercise.ref,
        packageRef: p05Package,
        learningRevision: 1,
        firstAt: p05At,
        lastAt: p05At,
      },
    ];
    value.progress.push(...events);
    for (const event of events) {
      if (event.eventType !== 'lesson.completed') {
        value.receipts.push({
          eventType: event.eventType,
          result: event.result,
          subjectRef: event.subjectRef,
          packageRef: event.packageRef,
          learningRevision: event.learningRevision,
          eventId: `09000000-0000-4000-8000-${String(value.receipts.length + 1).padStart(12, '0')}`,
          goalVersion: 1,
          occurredAt: p05At,
          localDate: p05Date,
          committedRevision: 1,
        } as Receipt);
      }
      if (event.eventType === 'lesson.completed' || event.eventType === 'exercise.passed') {
        value.dailyFacts.push({
          eventType: event.eventType,
          subjectRef: event.subjectRef,
          canonicalSubjectId: event.subjectRef.id,
          occurredAt: p05At,
          localDate: p05Date,
        });
        value.ledger.push({
          sourceId:
            event.eventType === 'lesson.completed'
              ? 'reward.lesson.first-completion'
              : 'reward.exercise.first-pass',
          subjectId: event.subjectRef.id,
          localDate: p05Date,
          occurredAt: p05At,
          status: 'posted',
          points: event.eventType === 'lesson.completed' ? 20 : 10,
          policyRef: { id: 'reward.policy.p0', version: '1.0.0' },
        });
      }
    }
  }
  value.ledger.push({
    sourceId: 'reward.daily-goal.once',
    subjectId: `local-goal.${p05Date}`,
    localDate: p05Date,
    occurredAt: p05At,
    status: 'posted',
    points: 5,
    policyRef: { id: 'reward.policy.p0', version: '1.0.0' },
  });
  assertSnapshot(value);
  return value;
}

function rawSnapshot(value: StorageSnapshot): RawStorageRows {
  const raw = {} as RawStorageRows;
  for (const store of STORE_NAMES) {
    const rows =
      store === 'meta' || store === 'settings' || store === 'avatar' || store === 'appearance'
        ? [value[store]]
        : value[store];
    raw[store] = {
      values: structuredClone(rows),
      keys: rows.map((row) => recordKey(store, value.meta.generation, row as never)),
    };
  }
  return raw;
}
function inspect(raw: RawStorageRows) {
  return inspectRecoveryRows(raw, (first, second) => (sameRecoveryValue(first, second) ? 0 : 1));
}
function inspectWithoutMutation(raw: RawStorageRows) {
  const before = structuredClone(raw);
  const result = inspect(raw);
  expect(raw).toEqual(before);
  if (result.snapshot) assertSnapshot(result.snapshot);
  return result;
}

afterEach(() => vi.restoreAllMocks());

describe('P0.5-09 healthy archive recovery cost and damage fallback', () => {
  for (const lessons of [1, 14, 32]) {
    it(`preserves all ${lessons}-lesson summaries with one bounded date-validation pass`, () => {
      const value = completedArchive(lessons);
      const raw = rawSnapshot(value);
      const before = structuredClone(raw);
      // Call through to the native implementation; count work instead of setting a
      // machine-dependent wall-clock threshold or weakening any date validation.
      const formatter = vi.spyOn(Intl, 'DateTimeFormat');
      const result = inspect(raw);
      const constructions = formatter.mock.calls.length;
      formatter.mockRestore();
      const datedRows = value.dailyFacts.length + value.ledger.length + value.receipts.length + 1;
      expect(constructions).toBeGreaterThanOrEqual(datedRows * 2);
      expect(constructions).toBeLessThanOrEqual(datedRows * 2 + 10);
      expect(result).toEqual({
        snapshot: value,
        issues: [],
        canClear: true,
        resettable: [],
        ledgerUncertain: false,
        writable: true,
        errorCode: null,
        appearanceReadOnly: false,
        appearanceCanReset: true,
      });
      expect(raw).toEqual(before);
      result.snapshot!.ledger[0].occurredAt = '2026-10-26T02:00:00.000Z';
      expect(raw).toEqual(before);
    });
  }

  for (const reversedGoals of [false, true]) {
    it(`preserves prior day grouping and legacy-award order with ${reversedGoals ? 'reversed' : 'ascending'} goals`, () => {
      const value = completedArchive(2);
      const priorAt = '2026-10-26T02:00:00.000Z';
      const priorDate = '2026-10-26';
      const priorSubjects = new Set(value.progress.slice(0, 4).map((event) => event.subjectRef.id));
      value.meta.createdAt = priorAt;
      for (const event of value.progress) {
        if (priorSubjects.has(event.subjectRef.id)) {
          event.firstAt = priorAt;
          event.lastAt = priorAt;
        }
      }
      for (const event of [...value.dailyFacts, ...value.receipts]) {
        if (priorSubjects.has(event.subjectRef.id)) {
          event.occurredAt = priorAt;
          event.localDate = priorDate;
        }
      }
      for (const entry of value.ledger) {
        if (priorSubjects.has(entry.subjectId)) {
          entry.occurredAt = priorAt;
          entry.localDate = priorDate;
        }
      }
      value.goals.unshift({
        localDate: priorDate,
        goalVersion: 1,
        targets: { exercise: 1, lesson: 1, case: 0 },
        achievedAt: priorAt,
      });
      const daily = value.ledger.at(-1)!;
      if (daily.status !== 'posted') throw new Error('Fixture requires a posted daily award.');
      value.ledger.push(
        {
          ...daily,
          subjectId: `local-goal.${priorDate}`,
          localDate: priorDate,
          occurredAt: priorAt,
        },
        {
          ...daily,
          subjectId: 'local-goal.2026-10-25',
          localDate: '2026-10-25',
          occurredAt: '2026-10-25T02:00:00.000Z',
          policyRef: { id: 'legacy.fixture', version: '0.9.0' },
        },
      );
      if (reversedGoals) value.goals.reverse();
      assertSnapshot(value);
      const raw = rawSnapshot(value);
      // These compound keys contain only ASCII strings. Match native IndexedDB
      // lexicographic key order, where daily awards precede exercise/lesson awards.
      for (const store of ['ledger', 'dailyFacts'] as const) {
        const sorted = raw[store].keys
          .map((key, index) => ({ key, value: raw[store].values[index] }))
          .sort((first, second) => {
            const left = first.key as string[];
            const right = second.key as string[];
            for (let index = 0; index < left.length; index++) {
              if (left[index] < right[index]) return -1;
              if (left[index] > right[index]) return 1;
            }
            return 0;
          });
        raw[store] = {
          keys: sorted.map((entry) => entry.key),
          values: sorted.map((entry) => entry.value),
        };
      }
      const nativeLedger = raw.ledger.values as StorageSnapshot['ledger'];
      const nativeFacts = raw.dailyFacts.values as StorageSnapshot['dailyFacts'];
      expect(nativeLedger.slice(0, 3).map((entry) => entry.localDate)).toEqual([
        '2026-10-25',
        '2026-10-26',
        '2026-10-27',
      ]);
      const expectedLedger = [
        ...nativeLedger.filter((entry) => entry.sourceId !== 'reward.daily-goal.once'),
        ...value.goals.flatMap((goal) =>
          nativeLedger.filter(
            (entry) =>
              entry.sourceId === 'reward.daily-goal.once' && entry.localDate === goal.localDate,
          ),
        ),
        nativeLedger[0],
      ];
      const expectedFacts = value.goals.flatMap((goal) =>
        nativeFacts.filter((fact) => fact.localDate === goal.localDate),
      );
      const result = inspectWithoutMutation(raw);
      expect(result.snapshot).toEqual({
        ...value,
        dailyFacts: expectedFacts,
        ledger: expectedLedger,
      });
      expect(result.issues).toEqual([]);
      expect(result.writable).toBe(true);
      expect(result.ledgerUncertain).toBe(false);
    });
  }

  it('falls back for a well-shaped receipt without matching progress', () => {
    const value = completedArchive(2);
    const raw = rawSnapshot(value);
    const receipt = raw.receipts.values[0] as StorageSnapshot['receipts'][number];
    receipt.subjectRef = { id: 'lesson.c.unrelated', version: '1.0.0' };
    const result = inspectWithoutMutation(raw);
    expect(result.issues).toEqual([{ store: 'receipts', count: 1 }]);
    expect(result.snapshot?.receipts).toHaveLength(value.receipts.length - 1);
    expect(result.snapshot?.progress).toEqual(value.progress);
    expect(result.snapshot?.ledger).toEqual(value.ledger);
    expect(result.writable).toBe(false);
    expect(result.ledgerUncertain).toBe(false);
  });

  it('rejects an individually valid receipt with a wrong local-date relationship', () => {
    const value = completedArchive(2);
    const raw = rawSnapshot(value);
    (raw.receipts.values[0] as StorageSnapshot['receipts'][number]).localDate = '2026-10-26';
    const result = inspectWithoutMutation(raw);
    expect(result.issues).toEqual([{ store: 'receipts', count: 1 }]);
    expect(result.errorCode).toBe('S_RECORD_INVALID');
    expect(result.snapshot?.receipts).toHaveLength(value.receipts.length - 1);
    expect(result.snapshot?.ledger).toEqual(value.ledger);
    expect(result.writable).toBe(false);
  });

  it('keeps physical-key checks before the healthy path', () => {
    const value = completedArchive(2);
    const raw = rawSnapshot(value);
    raw.receipts.keys[0] = ['foreign-generation', 'wrong-event'];
    const result = inspectWithoutMutation(raw);
    expect(result.issues).toEqual([{ store: 'receipts', count: 1 }]);
    expect(result.snapshot?.receipts).toHaveLength(value.receipts.length - 1);
    expect(result.snapshot?.ledger).toEqual(value.ledger);
    expect(result.writable).toBe(false);
  });

  it('marks an unrelated well-shaped award uncertain without hiding other rewards', () => {
    const value = completedArchive(2);
    const raw = rawSnapshot(value);
    const entry = raw.ledger.values[0] as StorageSnapshot['ledger'][number];
    entry.subjectId = 'lesson.c.unrelated';
    raw.ledger.keys[0] = recordKey('ledger', value.meta.generation, entry);
    const result = inspectWithoutMutation(raw);
    expect(result.issues).toEqual([{ store: 'ledger', count: 1 }]);
    expect(result.snapshot?.ledger).toEqual(value.ledger.slice(1));
    expect(result.snapshot?.progress).toEqual(value.progress);
    expect(result.ledgerUncertain).toBe(true);
    expect(result.writable).toBe(false);
  });

  it('isolates a missing progress row and its dependent fact, award and receipt', () => {
    const value = completedArchive(2);
    const raw = rawSnapshot(value);
    raw.progress.values.splice(3, 1);
    raw.progress.keys.splice(3, 1);
    const result = inspectWithoutMutation(raw);
    expect(result.issues).toEqual([
      { store: 'dailyFacts', count: 1 },
      { store: 'ledger', count: 1 },
      { store: 'receipts', count: 1 },
    ]);
    expect(result.snapshot?.progress).toHaveLength(value.progress.length - 1);
    expect(result.snapshot?.dailyFacts).toHaveLength(value.dailyFacts.length - 1);
    expect(result.snapshot?.ledger).toHaveLength(value.ledger.length - 1);
    expect(result.snapshot?.receipts).toHaveLength(value.receipts.length - 1);
    expect(result.ledgerUncertain).toBe(true);
    expect(result.writable).toBe(false);
  });

  it('falls back for alias cycles and retains every unrelated summary', () => {
    const value = completedArchive(2);
    const raw = rawSnapshot(value);
    const first = { id: 'lesson.c.alias-a', version: '1.0.0' };
    const second = { id: 'lesson.c.alias-b', version: '1.0.0' };
    const aliases: StorageSnapshot['aliases'] = [
      [first, second],
      [second, first],
    ].map(([fromRef, toRef]) => ({
      fromRef,
      toRef,
      fromAcceptedPriorVersions: [],
      kind: 'lesson',
      learningRevision: 1,
      manifestRef: { id: 'manifest.fixture.p0', version: '1.0.0' },
    }));
    raw.aliases.values = aliases;
    raw.aliases.keys = aliases.map((alias) => recordKey('aliases', value.meta.generation, alias));
    const result = inspectWithoutMutation(raw);
    expect(result.issues).toEqual([{ store: 'aliases', count: 2 }]);
    expect(result.snapshot).toEqual(value);
    expect(result.ledgerUncertain).toBe(true);
    expect(result.writable).toBe(false);
  });

  it('retains appearance-only recovery and exhausted-revision write guards', () => {
    const value = completedArchive(2);
    const raw = rawSnapshot(value);
    raw.appearance.values = [{ preset: 'invalid' }];
    const appearance = inspectWithoutMutation(raw);
    expect(appearance.snapshot?.progress).toEqual(value.progress);
    expect(appearance.snapshot?.ledger).toEqual(value.ledger);
    expect(appearance.appearanceReadOnly).toBe(true);
    expect(appearance.issues).toEqual([{ store: 'appearance', count: 1 }]);
    expect(appearance.writable).toBe(true);
    value.meta.revision = Number.MAX_SAFE_INTEGER;
    const exhausted = inspectWithoutMutation(rawSnapshot(value));
    expect(exhausted.snapshot).toEqual(value);
    expect(exhausted.issues).toEqual([{ store: 'meta', count: 1 }]);
    expect(exhausted.writable).toBe(false);
    expect(exhausted.appearanceCanReset).toBe(false);
  });
});
