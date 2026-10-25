import { describe, expect, it } from 'vitest';
import { assertRewardSettlement } from '../../web/src/storage/client';
import type { LedgerEntry } from '../../web/src/storage/model';

const pending: LedgerEntry = {
  sourceId: 'reward.exercise.first-pass',
  subjectId: 'exercise.synthetic.reward',
  localDate: '2026-10-20',
  occurredAt: '2026-10-20T02:00:00.000Z',
  status: 'pending',
  points: null,
  policyRef: null,
};
const posted: LedgerEntry = {
  ...pending,
  status: 'posted',
  points: 10,
  policyRef: { id: 'reward.policy.p0', version: '1.0.0' },
};

describe('trusted reward settlement transition guard', () => {
  it('allows only an existing pending right to receive points and an exact public policy reference', () => {
    expect(() => assertRewardSettlement(pending, posted)).not.toThrow();
    expect(pending).toMatchObject({ status: 'pending', points: null, policyRef: null });
  });
  it('rejects creation, pending rewrites and any rewrite of already posted points or policy', () => {
    for (const [previous, next] of [
      [undefined, posted],
      [pending, pending],
      [posted, posted],
      [posted, { ...posted, points: 100 }],
      [posted, { ...posted, policyRef: { id: 'reward.policy.other', version: '2.0.0' } }],
    ] as const)
      expect(() => assertRewardSettlement(previous, next)).toThrow('S_RECORD_INVALID');
  });
  it.each([
    { sourceId: 'reward.case.first-view' },
    { subjectId: 'exercise.synthetic.other' },
    { localDate: '2026-10-19' },
    { occurredAt: '2026-10-20T02:00:01.000Z' },
    { points: -1 },
    { policyRef: null },
    { status: 'pending' },
    { source: 'forbidden' },
  ])('rejects changed identity, time or malformed posted rows: %j', (changes) => {
    expect(() => assertRewardSettlement(pending, { ...posted, ...changes } as LedgerEntry)).toThrow(
      'S_RECORD_INVALID',
    );
  });
});
