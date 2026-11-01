import { describe, it, expect } from 'vitest';
import {
  achievementCatalog,
  mergeAchievements,
  assertAchievement,
  achievementPassSources,
  type AchievementEvidence,
} from '../../web/src/achievements/model';
import {
  AdjacentCoverage,
  createObservationWatch,
  observationSubject,
} from '../../web/src/achievements/observation';
import { acceptedMemoryRequest } from '../../web/src/engine/memory-client';
import type { MemoryResult } from '../../web/src/engine/memory-protocol';
import { upgradeV5Meta } from '../../web/src/storage/v5-migration';
import { p05Catalog, p05Empty } from '../fixtures/p05-learning';
import { createMeta } from '../../web/src/storage/model';

const generation = crypto.randomUUID(),
  at = '2026-10-31T03:00:00.000Z';
const source = (
  id: string,
  kind: AchievementEvidence['kind'] = 'exercise',
  time = at,
): AchievementEvidence => ({
  kind,
  eventId: crypto.randomUUID(),
  subjectRef: { id, version: '1.0.0' },
  learningRevision: 1,
  occurredAt: time,
});
const bubble = () => source('exercise.c.bubble-sort');
const pointers = ['exercise.cpp.bug-uninitialized-pointer', 'exercise.cpp.bug-dangling-pointer'];
const observations = ['observation.stack.functions', 'observation.stack.hanoi'];
describe('fixed local achievements and minimal original evidence', () => {
  it('fixes exactly three honest badges with one or two conditions', () => {
    expect(achievementCatalog.badges.map((b) => [b.id, b.requirements.length])).toEqual([
      ['badge.c.bubble-pass', 1],
      ['badge.recursion.observer', 2],
      ['badge.cpp.pointer-repair', 2],
    ]);
  });
  it('empty sync creates no rows or implied completions', () =>
    expect(mergeAchievements([], [], generation)).toEqual([]));
  it('one actual bubble source unlocks at its original time and retry is byte-stable', () => {
    const e = bubble(),
      rows = mergeAchievements([], [e], generation);
    expect(rows[0]).toMatchObject({ unlockedAt: at, evidence: [e] });
    expect(mergeAchievements(rows, [e], generation)).toEqual(rows);
    expect(mergeAchievements(rows, [bubble()], generation)).toEqual(rows);
  });
  it('both pointer repairs are required, commute across pages and survive absence of sources', () => {
    const a = source(pointers[0]),
      b = source(pointers[1], 'exercise', '2026-11-01T03:00:00.000Z');
    const partial = mergeAchievements([], [a], generation);
    expect(partial[0].unlockedAt).toBeNull();
    const rows = mergeAchievements(partial, [b], generation);
    expect(rows[0].unlockedAt).toBe(b.occurredAt);
    expect(mergeAchievements(mergeAchievements([], [b], generation), [a], generation)[0]).toEqual(
      rows[0],
    );
    expect(mergeAchievements(rows, [], generation)).toEqual(rows);
  });
  it('observations require their exact kind and both exact references', () => {
    expect(mergeAchievements([], [source(observations[0])], generation)).toEqual([]);
    const rows = mergeAchievements(
      [],
      [source(observations[0], 'observation'), source(observations[1], 'observation')],
      generation,
    );
    expect(rows[0].badgeRef.id).toBe('badge.recursion.observer');
    expect(rows[0].unlockedAt).toBe(at);
  });
  it.each([
    { subjectRef: { id: 'exercise.c.bubble-sort', version: '2.0.0' } },
    { learningRevision: 2 },
    { subjectRef: { id: 'exercise.c.selection-sort', version: '1.0.0' } },
  ])('unrelated/future conditions do not unlock: %o', (patch) => {
    const e = { ...bubble(), ...patch };
    if ('learningRevision' in patch) expect(() => mergeAchievements([], [e], generation)).toThrow();
    else expect(mergeAchievements([], [e], generation)).toEqual([]);
  });
  it('same event ID with conflicting payload is rejected', () => {
    const e = bubble();
    expect(() =>
      mergeAchievements(
        mergeAchievements([], [e], generation),
        [{ ...e, occurredAt: '2026-11-01T03:00:00.000Z' }],
        generation,
      ),
    ).toThrow('S_RECORD_INVALID');
  });
  it.each(['generation', 'extra', 'unlockedAt', 'evidence', 'version'])(
    'rejects corrupt or unknown achievement %s without changing input',
    (kind) => {
      const row = mergeAchievements([], [bubble()], generation)[0];
      const broken = structuredClone(row) as unknown as Record<string, unknown>;
      if (kind === 'generation') broken.generation = '';
      if (kind === 'extra') broken.code = 'private source';
      if (kind === 'unlockedAt') broken.unlockedAt = null;
      if (kind === 'evidence') broken.evidence = [...row.evidence, ...row.evidence];
      if (kind === 'version') broken.catalogRef = { ...row.catalogRef, version: '9.0.0' };
      const before = structuredClone(broken);
      expect(() => assertAchievement(broken)).toThrow();
      expect(broken).toEqual(before);
    },
  );
  it('rejects duplicate badge keys and stale generations', () => {
    const row = mergeAchievements([], [bubble()], generation)[0];
    expect(() => mergeAchievements([row, row], [], generation)).toThrow();
    expect(() => mergeAchievements([row], [], crypto.randomUUID())).toThrow();
  });
  it('rejects an IDB array carrying hidden extra private content', () => {
    const r = mergeAchievements([], [bubble()], generation)[0];
    Object.assign(r.evidence, { sourceCode: 'private body' });
    expect(() => assertAchievement(r)).toThrow('S_RECORD_INVALID');
  });
  it('persists only the closed reference/event/time evidence', () => {
    const r = mergeAchievements([], [bubble()], generation)[0];
    expect(Object.keys(r.evidence[0]).sort()).toEqual([
      'eventId',
      'kind',
      'learningRevision',
      'occurredAt',
      'subjectRef',
    ]);
    expect(JSON.stringify(r)).not.toMatch(/sourceRevision|trace|input|output|sourceCode|address/);
  });
});
describe('receipt compatibility is distinct from progress', () => {
  const snapshot = () => p05Empty();
  it('a passed progress row without its receipt cannot unlock', () => {
    const s = snapshot();
    s.progress.push({
      eventType: 'exercise.passed',
      packageRef: s.meta.activePackageRef,
      subjectRef: bubble().subjectRef,
      learningRevision: 1,
      firstAt: at,
      lastAt: at,
      result: 'passed',
    });
    expect(achievementPassSources(s, p05Catalog())).toEqual([]);
  });
  it('accepts only compatible pass receipts, retaining original event and time', () => {
    const s = snapshot(),
      e = bubble();
    s.receipts.push({
      eventType: 'exercise.passed',
      packageRef: s.meta.activePackageRef,
      subjectRef: e.subjectRef,
      learningRevision: 1,
      occurredAt: at,
      eventId: e.eventId,
      committedRevision: 2,
      localDate: '2026-10-31',
      goalVersion: 1,
      result: 'passed',
    });
    expect(achievementPassSources(s, p05Catalog())).toEqual([e]);
    s.receipts[0] = {
      ...s.receipts[0],
      packageRef: { id: 'content.foreign', version: '1.0.0' },
    } as (typeof s.receipts)[0];
    expect(achievementPassSources(s, p05Catalog())).toEqual([]);
  });
});
describe('visible adjacent coverage cannot be replaced by seek or hidden playback', () => {
  it('jumping to terminal does not complete; replaying every state does', () => {
    const c = new AdjacentCoverage(3);
    c.present(0);
    c.present(3);
    expect(c.snapshot()).toEqual({ seen: 1, total: 4, complete: false });
    for (const p of [0, 1, 2, 3]) c.present(p);
    expect(c.snapshot().complete).toBe(true);
  });
  it('hidden gap requires revisiting the last seen state before continuing', () => {
    const c = new AdjacentCoverage(3);
    c.present(0);
    c.present(1);
    c.interrupt();
    c.present(2);
    c.present(3);
    expect(c.snapshot().seen).toBe(2);
    for (const p of [1, 2, 3]) c.present(p);
    expect(c.snapshot().complete).toBe(true);
  });
  it('backwards visits and duplicates do not invent missing forward states', () => {
    const c = new AdjacentCoverage(4);
    for (const p of [0, 0, 4, 3, 2, 1, 2]) c.present(p);
    expect(c.snapshot().seen).toBe(1);
  });
  it.each([-1, 1.5, 99])('out-of-range cursor%s is rejected', (p) => {
    const c = new AdjacentCoverage(3);
    c.present(p);
    expect(c.snapshot().seen).toBe(0);
  });
  it('forged results and public lookalike facts have no production receipt', () => {
    const fake = {} as MemoryResult;
    expect(acceptedMemoryRequest(fake)).toBeNull();
    expect(createObservationWatch(fake, () => true)).toBeNull();
    expect(observationSubject({ type: 'observation.view-confirmed' })).toBeNull();
  });
});
describe('SAVE5 to SAVE6 meta migration', () => {
  const old = () => ({
    ...createMeta({
      activePackageRef: achievementCatalog.packageRef,
      generation,
      createdAt: at,
      timeZone: 'Asia/Shanghai',
    }),
    schemaVersion: '5.0.0',
    dbVersion: 5,
    revision: 8,
  });
  it('changes only version and one meta revision, leaving original input intact', () => {
    const before = old();
    expect(upgradeV5Meta(before)).toEqual({
      ...before,
      schemaVersion: '9.0.0',
      dbVersion: 9,
      revision: 9,
    });
    expect(before).toEqual(old());
  });
  it('preserves and rejects unknown future meta', () => {
    const v = { ...old(), schemaVersion: '9.0.0' };
    expect(() => upgradeV5Meta(v)).toThrow('S_VERSION_UNKNOWN');
    expect(v.schemaVersion).toBe('9.0.0');
  });
  it.each([{ revision: Number.MAX_SAFE_INTEGER }, { dbVersion: 4 }, { generation: '' }])(
    'cannot migrate invalid or exhausted predecessor %o',
    (patch) => expect(upgradeV5Meta({ ...old(), ...patch })).toBeNull(),
  );
});
