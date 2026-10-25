import goalJson from '../../../content/goals/p0-1.0.0.json?raw';
import policyJson from '../../../content/rewards/daily-goal-p0-1.0.0.json?raw';
import type { StorageMutation } from '../storage/client';
import type { GoalTargets, LedgerEntry, Ref, StorageSnapshot } from '../storage/model';
import { assertGoalTargets, assertRecord, assertSnapshot } from '../storage/validation';

export interface GoalConfiguration {
  readonly configRef: Readonly<Ref>;
  readonly recommended: Readonly<GoalTargets>;
  readonly limits: Readonly<GoalTargets>;
}
export interface DailyGoalRewardPolicy {
  readonly policyRef: Readonly<Ref>;
  readonly sourceId: 'reward.daily-goal.once';
  readonly points: 5;
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
    throw new Error('GOAL_CONFIGURATION_INVALID');
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
/** A narrow configuration capability, independent from full CONTENT publication. */
export function decodeGoalConfiguration(value: unknown): GoalConfiguration {
  row(value, ['configRef', 'recommended', 'limits']);
  row(value.configRef, ['id', 'version']);
  row(value.recommended, ['exercise', 'lesson', 'case']);
  row(value.limits, ['exercise', 'lesson', 'case']);
  if (
    value.configRef.id !== 'goal.config.p0' ||
    value.configRef.version !== '1.0.0' ||
    value.recommended.exercise !== 1 ||
    value.recommended.lesson !== 1 ||
    value.recommended.case !== 0 ||
    value.limits.exercise !== 6 ||
    value.limits.lesson !== 6 ||
    value.limits.case !== 7
  )
    throw new Error('GOAL_CONFIGURATION_INVALID');
  return frozen(structuredClone(value) as unknown as GoalConfiguration);
}
export async function loadGoalConfiguration(): Promise<GoalConfiguration> {
  return decodeGoalConfiguration(JSON.parse(goalJson));
}
export function assertConfiguredTargets(targets: GoalTargets, config: GoalConfiguration): void {
  assertGoalTargets(targets);
  const verified = decodeGoalConfiguration(config);
  if ((['exercise', 'lesson', 'case'] as const).some((key) => targets[key] > verified.limits[key]))
    throw new Error('GOAL_TARGET_UNAVAILABLE');
}
export function decodeDailyGoalRewardPolicy(value: unknown): DailyGoalRewardPolicy {
  row(value, ['policyRef', 'sourceId', 'points']);
  row(value.policyRef, ['id', 'version']);
  if (
    value.policyRef.id !== 'reward.policy.daily-goal.p0' ||
    value.policyRef.version !== '1.0.0' ||
    value.sourceId !== 'reward.daily-goal.once' ||
    value.points !== 5
  )
    throw new Error('DAILY_GOAL_REWARD_POLICY_INVALID');
  return frozen(structuredClone(value) as unknown as DailyGoalRewardPolicy);
}
export async function loadDailyGoalRewardPolicy(): Promise<DailyGoalRewardPolicy> {
  return decodeDailyGoalRewardPolicy(JSON.parse(policyJson));
}
function postDailyReward(entry: LedgerEntry, policy: DailyGoalRewardPolicy): LedgerEntry {
  if (entry.sourceId !== 'reward.daily-goal.once' || entry.status !== 'pending') return entry;
  const value: LedgerEntry = {
    ...entry,
    status: 'posted',
    points: policy.points,
    policyRef: { ...policy.policyRef },
  };
  assertRecord('ledger', value);
  return value;
}
/** This recipe consumes existing rights only; it cannot make a daily check-in. */
export function prepareDailyGoalRewardSettlement(
  snapshot: StorageSnapshot,
  policy: DailyGoalRewardPolicy,
): StorageMutation[] {
  assertSnapshot(snapshot);
  const verified = decodeDailyGoalRewardPolicy(policy);
  return snapshot.ledger.flatMap((entry): StorageMutation[] => {
    const value = postDailyReward(entry, verified);
    return value === entry ? [] : [{ store: 'ledger', mode: 'put', value }];
  });
}
/** Only rights already created by the learning-domain transaction can be posted. */
export function postNewDailyGoalRewards(
  operations: StorageMutation[],
  policy: DailyGoalRewardPolicy | undefined,
): StorageMutation[] {
  if (!policy) return operations;
  const verified = decodeDailyGoalRewardPolicy(policy);
  return operations.map((operation) =>
    operation.store === 'ledger' && operation.mode === 'add'
      ? { ...operation, value: postDailyReward(operation.value, verified) }
      : operation,
  );
}
