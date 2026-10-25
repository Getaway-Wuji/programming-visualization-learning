import policyJson from '../../../content/rewards/p0-1.0.0.json?raw';
import type { StorageMutation } from '../storage/client';
import type { LedgerEntry, Ref, StorageSnapshot } from '../storage/model';
import { assertRecord, assertSnapshot } from '../storage/validation';

const sources = [
  'reward.exercise.first-pass',
  'reward.lesson.first-completion',
  'reward.case.first-view',
] as const;
export interface RewardPolicy {
  readonly policyRef: Readonly<Ref>;
  readonly repeatPoints: 0;
  readonly sources: Readonly<Record<(typeof sources)[number], number>>;
  readonly dailyGoal: 'deferred-11.2';
  readonly challenge: 'reserved-p1';
}

function row(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length ||
    Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some((entry) => !('value' in entry))
  )
    throw new Error('REWARD_POLICY_INVALID');
}

/** Closed, versioned P0 policy; daily/challenge cannot silently become enabled. */
export function decodeRewardPolicy(value: unknown): RewardPolicy {
  row(value, ['policyRef', 'repeatPoints', 'sources', 'dailyGoal', 'challenge']);
  row(value.policyRef, ['id', 'version']);
  row(value.sources, sources);
  if (
    value.policyRef.id !== 'reward.policy.p0' ||
    value.policyRef.version !== '1.0.0' ||
    value.repeatPoints !== 0 ||
    value.dailyGoal !== 'deferred-11.2' ||
    value.challenge !== 'reserved-p1' ||
    value.sources[sources[0]] !== 10 ||
    value.sources[sources[1]] !== 20 ||
    value.sources[sources[2]] !== 5
  )
    throw new Error('REWARD_POLICY_INVALID');
  const result = structuredClone(value) as unknown as RewardPolicy;
  Object.freeze(result.policyRef);
  Object.freeze(result.sources);
  return Object.freeze(result);
}

export async function loadRewardPolicy(): Promise<RewardPolicy> {
  return decodeRewardPolicy(JSON.parse(policyJson));
}

export function postReward(entry: LedgerEntry, policy: RewardPolicy): LedgerEntry {
  if (entry.status !== 'pending' || !sources.includes(entry.sourceId as (typeof sources)[number]))
    return structuredClone(entry);
  const posted: LedgerEntry = {
    ...entry,
    status: 'posted',
    points: policy.sources[entry.sourceId as (typeof sources)[number]],
    policyRef: { ...policy.policyRef },
  };
  assertRecord('ledger', posted);
  return posted;
}

/** Settlement changes existing rights only; it never produces learning facts. */
export function prepareRewardSettlement(
  snapshot: StorageSnapshot,
  policy: RewardPolicy,
): StorageMutation[] {
  assertSnapshot(snapshot);
  const verified = decodeRewardPolicy(policy);
  return snapshot.ledger.flatMap((entry): StorageMutation[] => {
    const posted = postReward(entry, verified);
    return entry.status === 'pending' && posted.status === 'posted'
      ? [{ store: 'ledger', mode: 'put', value: posted }]
      : [];
  });
}

/** Fresh rights can be posted in the same transaction as their learning receipt. */
export function postNewRewards(
  operations: StorageMutation[],
  policy: RewardPolicy | undefined,
): StorageMutation[] {
  if (!policy) return operations;
  const verified = decodeRewardPolicy(policy);
  return operations.map((operation) =>
    operation.store === 'ledger' && operation.mode === 'add'
      ? { ...operation, value: postReward(operation.value, verified) }
      : operation,
  );
}
