import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodeRewardPolicy,
  loadRewardPolicy,
  postNewRewards,
  prepareRewardSettlement,
} from '../../web/src/learning/rewards';
import { assertSnapshot } from '../../web/src/storage/validation';
import { upgradeV1Snapshot } from '../../web/src/storage/v1-migration';
import type { LedgerEntry, StorageSnapshot } from '../../web/src/storage/model';

const rawPolicy = JSON.parse(readFileSync('content/rewards/p0-1.0.0.json', 'utf8'));
function pendingArchive(): StorageSnapshot {
  const examples = JSON.parse(readFileSync('项目文档/契约/02.3-存档样例.json', 'utf8'));
  const value = upgradeV1Snapshot(examples.snapshots[1].snapshot);
  value.ledger = value.ledger.map((entry) => ({
    ...entry,
    status: 'pending',
    points: null,
    policyRef: null,
  }));
  assertSnapshot(value);
  return value;
}

describe('11.1 formal local P0 reward policy', () => {
  it('loads the versioned production policy with 10/20/5 first rewards and zero repeat rewards', async () => {
    const policy = await loadRewardPolicy();
    expect(policy).toEqual(rawPolicy);
    expect(policy.policyRef).toEqual({ id: 'reward.policy.p0', version: '1.0.0' });
    expect(Object.isFrozen(policy.sources)).toBe(true);
  });
  it.each([
    { repeatPoints: 1 },
    { policyRef: { id: 'policy.fixture.p0', version: '1.0.0' } },
    { policyRef: { id: 'reward.policy.p0', version: '1.0.1' } },
    { sources: { ...rawPolicy.sources, 'reward.exercise.first-pass': 11 } },
    { sources: { ...rawPolicy.sources, 'reward.daily-goal.once': 5 } },
    { dailyGoal: 'enabled' },
    { challenge: 'enabled' },
    { optional: true },
  ])('rejects a changed or expanded same-version policy: %j', (changes) => {
    expect(() => decodeRewardPolicy({ ...rawPolicy, ...changes })).toThrow('REWARD_POLICY_INVALID');
  });
  it('rejects getters and custom prototypes before reading supplied values', () => {
    let read = false;
    const policy = {
      ...rawPolicy,
      get sources() {
        read = true;
        return rawPolicy.sources;
      },
    };
    expect(() => decodeRewardPolicy(policy)).toThrow('REWARD_POLICY_INVALID');
    expect(read).toBe(false);
    expect(() => decodeRewardPolicy(Object.create(rawPolicy))).toThrow('REWARD_POLICY_INVALID');
  });
  it('settles only existing eligible rights while preserving original day, occurrence and every other row', () => {
    const value = pendingArchive();
    const before = structuredClone(value);
    const operations = prepareRewardSettlement(value, decodeRewardPolicy(rawPolicy));
    expect(operations).toHaveLength(2);
    expect(operations.map((operation) => operation.store)).toEqual(['ledger', 'ledger']);
    expect(operations.map((operation) => operation.value)).toEqual(
      before.ledger.slice(0, 2).map((entry, index) => ({
        ...entry,
        status: 'posted',
        points: index ? 20 : 10,
        policyRef: rawPolicy.policyRef,
      })),
    );
    expect(value).toEqual(before);
    for (const operation of operations) {
      const posted = operation.value as LedgerEntry;
      value.ledger[value.ledger.findIndex((entry) => entry.sourceId === posted.sourceId)] = posted;
    }
    assertSnapshot(value);
    expect(prepareRewardSettlement(value, decodeRewardPolicy(rawPolicy))).toEqual([]);
    expect(value.ledger[2]).toMatchObject({
      sourceId: 'reward.daily-goal.once',
      status: 'pending',
    });
  });
  it('does not recalculate previously posted historical policy values', () => {
    const value = pendingArchive();
    value.ledger[0] = {
      ...value.ledger[0],
      status: 'posted',
      points: 77,
      policyRef: { id: 'policy.historical', version: '0.9.0' },
    };
    const before = structuredClone(value.ledger[0]);
    const operations = prepareRewardSettlement(value, decodeRewardPolicy(rawPolicy));
    expect(operations).toHaveLength(1);
    expect(value.ledger[0]).toEqual(before);
  });
  it('posts fresh case rights at five points in the learning recipe while leaving daily rights pending', () => {
    const pending = pendingArchive().ledger[0];
    const operations = postNewRewards(
      [
        {
          store: 'ledger',
          mode: 'add',
          value: {
            ...pending,
            sourceId: 'reward.case.first-view',
            subjectId: 'case.synthetic.reward',
          },
        },
        { store: 'ledger', mode: 'add', value: pendingArchive().ledger[2] },
      ],
      decodeRewardPolicy(rawPolicy),
    );
    expect(operations[0].value).toMatchObject({ status: 'posted', points: 5 });
    expect(operations[1].value).toMatchObject({ status: 'pending', points: null });
    expect(postNewRewards(operations, undefined)).toBe(operations);
  });
});
