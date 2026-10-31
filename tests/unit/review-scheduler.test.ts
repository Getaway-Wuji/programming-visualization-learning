import { describe, it, expect } from 'vitest';
import { createMeta } from '../../web/src/storage/model';
import { upgradeV4Meta } from '../../web/src/storage/v4-migration';
import { localDateAt } from '../../web/src/storage/validation';
import {
  synchronizeCards,
  applyReviewCommand,
  scheduled,
  addReviewDays,
  assertReviewCard,
  cardIdFor,
  reviewGroups,
  type ReviewSource,
  type ReviewCommand,
} from '../../web/src/review-scheduler/model';
const at = '2026-10-31T03:00:00.000Z',
  generation = crypto.randomUUID(),
  zone = 'Asia/Shanghai';
const source: ReviewSource = {
  kind: 'exercise',
  packageRef: { id: 'content.c.p05', version: '1.0.0' },
  subjectRef: { id: 'exercise.c.echo', version: '1.1.0' },
  lessonRef: { id: 'lesson.c.variables-output', version: '1.1.0' },
  learningRevision: 1,
  sourceVersion: 8,
  sourceAt: at,
  state: 'active',
};
const fresh = () => synchronizeCards([], [source], generation, at, zone);
const command = (c = fresh()[0], p: Partial<ReviewCommand> = {}): ReviewCommand => ({
  commandId: crypto.randomUUID(),
  cardId: c.cardId,
  expectedVersion: c.revision,
  sourceVersion: c.sourceVersion,
  mode: 'rate',
  rating: 'good',
  targetReviewId: null,
  at: '2026-10-31T04:00:00.000Z',
  localDate: '2026-10-31',
  ...p,
});
describe('calendar-box-1 independently fixed date vectors', () => {
  it.each([
    [0, 'again', 0, 1, '2027-01-01'],
    [0, 'hard', 1, 1, '2027-01-01'],
    [0, 'good', 1, 1, '2027-01-01'],
    [0, 'easy', 2, 3, '2027-01-03'],
    [3, 'again', 0, 1, '2027-01-01'],
    [3, 'hard', 3, 4, '2027-01-04'],
    [3, 'good', 4, 14, '2027-01-14'],
    [3, 'easy', 5, 30, '2027-01-30'],
    [6, 'hard', 6, 30, '2027-01-30'],
    [6, 'good', 6, 60, '2027-03-01'],
    [6, 'easy', 6, 60, '2027-03-01'],
  ] as const)(
    'level%s %s produces explicit level/days/date',
    (base, rating, level, days, dueDate) =>
      expect(scheduled(base, rating, '2026-12-31')).toEqual({ level, days, dueDate }),
  );
  it.each([
    ['2028-02-28', 1, '2028-02-29'],
    ['2028-02-28', 3, '2028-03-02'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-03-08', 1, '2026-03-09'],
    ['2026-11-01', 1, '2026-11-02'],
  ] as const)('calendar%s plus%s is%s', (date, days, want) =>
    expect(addReviewDays(date, days)).toBe(want),
  );
  it('uses the generation zone at both DST changes rather than UTC midnight', () => {
    expect(localDateAt('2026-03-08T04:30:00.000Z', 'America/New_York')).toBe('2026-03-07');
    expect(localDateAt('2026-03-09T03:30:00.000Z', 'America/New_York')).toBe('2026-03-08');
    expect(localDateAt('2026-11-02T04:30:00.000Z', 'America/New_York')).toBe('2026-11-01');
    expect(addReviewDays('2026-03-08', 1)).toBe('2026-03-09');
  });
  it.each(['2026-02-30', '9999-12-31'])('rejects invalid or overflowing date%s', (date) =>
    expect(() => addReviewDays(date, 1)).toThrow(),
  );
});
describe('source identity, schedule revisions and no read progression', () => {
  it('creates one exact source card immediately due and makes repeated sync byte-stable', () => {
    const rows = fresh();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      level: 0,
      reviewCount: 0,
      dueDate: '2026-10-31',
      state: 'active',
      sourceVersion: 8,
    });
    expect(synchronizeCards(rows, [source], generation, '2026-11-15T03:00:00.000Z', zone)).toEqual(
      rows,
    );
    expect(cardIdFor({ ...source, learningRevision: 2 })).not.toBe(rows[0].cardId);
  });
  it('new real error reopens, a pass pauses and explicit restart cannot masquerade as source pass', () => {
    const rows = applyReviewCommand(fresh(), command(), zone);
    const passed = synchronizeCards(
      rows,
      [{ ...source, sourceVersion: 9, state: 'repaired' }],
      generation,
      '2026-10-31T05:00:00.000Z',
      zone,
    );
    expect(passed[0]).toMatchObject({
      state: 'repaired',
      level: 0,
      lastReview: null,
      reviewCount: 1,
    });
    const restarted = applyReviewCommand(
      passed,
      command(passed[0], { mode: 'restart', rating: null, at: '2026-10-31T06:00:00.000Z' }),
      zone,
    );
    expect(restarted[0]).toMatchObject({
      state: 'active',
      sourceVersion: 9,
      level: 0,
      reviewCount: 1,
    });
    expect(
      synchronizeCards(
        restarted,
        [{ ...source, sourceVersion: 9, state: 'repaired' }],
        generation,
        '2026-11-01T06:00:00.000Z',
        zone,
      ),
    ).toEqual(restarted);
    const errored = synchronizeCards(
      restarted,
      [{ ...source, sourceVersion: 10, sourceAt: '2026-11-02T03:00:00.000Z' }],
      generation,
      '2026-11-02T04:00:00.000Z',
      zone,
    );
    expect(errored[0]).toMatchObject({
      state: 'active',
      level: 0,
      dueDate: '2026-11-02',
      lastReview: null,
    });
  });
  it('familiar suspends, re-marking reopens and absent content is preserved unavailable', () => {
    const k = {
      ...source,
      kind: 'knowledge' as const,
      subjectRef: { id: 'knowledge.c.variables', version: '1.0.0' },
      sourceVersion: 1,
    };
    const rows = synchronizeCards([], [k], generation, at, zone);
    const familiar = synchronizeCards(
      rows,
      [{ ...k, sourceVersion: 2, state: 'familiar' }],
      generation,
      '2026-10-31T04:00:00.000Z',
      zone,
    );
    expect(() =>
      applyReviewCommand(
        familiar,
        command(familiar[0], { mode: 'restart', rating: null, at: '2026-10-31T05:00:00.000Z' }),
        zone,
      ),
    ).toThrow('S_CONTENT_INCOMPATIBLE');
    const reopened = synchronizeCards(
      familiar,
      [{ ...k, sourceVersion: 3 }],
      generation,
      '2026-10-31T05:00:00.000Z',
      zone,
    );
    expect(reopened[0].state).toBe('active');
    const absent = synchronizeCards(reopened, [], generation, '2026-10-31T06:00:00.000Z', zone);
    expect(absent[0]).toMatchObject({ cardId: rows[0].cardId, state: 'unavailable' });
    expect(synchronizeCards(absent, [], generation, '2026-11-01T06:00:00.000Z', zone)).toEqual(
      absent,
    );
  });
  it('separates a genuine zero-due future queue from no cards and pauses', () => {
    const rated = applyReviewCommand(fresh(), command(), zone);
    expect(reviewGroups(rated, '2026-10-31')).toMatchObject({ due: [], future: rated, paused: [] });
    expect(reviewGroups(rated, '2026-11-01').due).toEqual(rated);
    expect(reviewGroups([], '2026-11-01')).toEqual({ due: [], future: [], paused: [] });
  });
});
describe('explicit evaluations, corrections and command identity', () => {
  it('retries the last exact command once independent of property order', () => {
    const cmd = command(),
      once = applyReviewCommand(fresh(), cmd, zone);
    const reverse = Object.fromEntries(Object.entries(cmd).reverse()) as unknown as ReviewCommand;
    expect(applyReviewCommand(once, reverse, zone)).toEqual(once);
    expect(once[0].reviewCount).toBe(1);
    expect(() => applyReviewCommand(once, { ...cmd, rating: 'easy' }, zone)).toThrow(
      'S_EVENT_ID_REUSED',
    );
  });
  it('corrects the latest rating from its original base/date without another repetition', () => {
    const once = applyReviewCommand(fresh(), command(), zone);
    const corrected = applyReviewCommand(
      once,
      command(once[0], {
        mode: 'correct',
        targetReviewId: once[0].lastReview!.reviewId,
        rating: 'easy',
        at: '2026-11-02T04:00:00.000Z',
        localDate: '2026-11-02',
      }),
      zone,
    );
    expect(corrected[0]).toMatchObject({ level: 2, dueDate: '2026-11-03', reviewCount: 1 });
    expect(corrected[0].lastReview).toMatchObject({
      at: '2026-10-31T04:00:00.000Z',
      localDate: '2026-10-31',
      baseLevel: 0,
    });
  });
  it('cannot rate a future card or correct an older review or use a stale source/row', () => {
    const old = command(),
      once = applyReviewCommand(fresh(), old, zone);
    expect(() => applyReviewCommand(once, command(once[0]), zone)).toThrow('S_DATE_INVALID');
    expect(() =>
      applyReviewCommand(
        once,
        command(once[0], { mode: 'correct', targetReviewId: crypto.randomUUID() }),
        zone,
      ),
    ).toThrow('S_REVISION_CONFLICT');
    expect(() =>
      applyReviewCommand(once, { ...old, commandId: crypto.randomUUID() }, zone),
    ).toThrow('S_REVISION_CONFLICT');
    expect(() => applyReviewCommand(once, command(once[0], { sourceVersion: 7 }), zone)).toThrow(
      'S_REVISION_CONFLICT',
    );
  });
  it('does not rebase a midnight retry or permit localDate mismatch/clock rollback', () => {
    const cmd = command(),
      once = applyReviewCommand(fresh(), cmd, zone);
    expect(applyReviewCommand(once, cmd, zone)).toEqual(once);
    expect(() => applyReviewCommand(fresh(), { ...cmd, localDate: '2026-11-01' }, zone)).toThrow(
      'S_DATE_INVALID',
    );
    expect(() =>
      applyReviewCommand(
        fresh(),
        { ...cmd, at: '2026-10-30T04:00:00.000Z', localDate: '2026-10-30' },
        zone,
      ),
    ).toThrow('S_DATE_INVALID');
  });
  it.each(['source', 'input', 'stdout', 'diagnostic', 'trace', 'hash'])(
    'rejects private extra%s fields',
    (key) => expect(() => assertReviewCard({ ...fresh()[0], [key]: 'not allowed' })).toThrow(),
  );
  it('rejects an internally inconsistent saved schedule rather than treating it as empty', () => {
    const once = applyReviewCommand(fresh(), command(), zone);
    expect(() => assertReviewCard({ ...once[0], dueDate: '2026-12-01' })).toThrow();
  });
  it('upgrades only known DB4 meta and leaves its original input untouched', () => {
    const old = {
      ...createMeta({
        generation,
        timeZone: zone,
        createdAt: at,
        activePackageRef: source.packageRef,
      }),
      schemaVersion: '4.0.0',
      dbVersion: 4,
      revision: 8,
    };
    const original = structuredClone(old);
    expect(upgradeV4Meta(old)).toMatchObject({ schemaVersion: '8.0.0', dbVersion: 8, revision: 9 });
    expect(old).toEqual(original);
    expect(() => upgradeV4Meta({ ...old, schemaVersion: '9.0.0' })).toThrow('S_VERSION_UNKNOWN');
  });
});
