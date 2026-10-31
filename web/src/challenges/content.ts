import catalogJson from '../../../content/challenges/cases-1.0.0.json?raw';
import policyJson from '../../../content/rewards/challenge-1.0.0.json?raw';
import type { TraceStep } from '../engine/protocol';
import { challengePolicy, challengeSource, challengeQuestion as questionRule } from './rules';
export { challengePackage, challengePolicy, challengeSource } from './rules';

export type AnswerKind = TraceStep['kind'];
export interface ChallengeQuestion {
  readonly ref: { readonly id: string; readonly version: '1.0.0' };
  readonly caseId: string;
  readonly title: string;
  readonly anchorKind: AnswerKind;
  readonly choices: readonly AnswerKind[];
}
const policy = JSON.parse(policyJson);
if (
  JSON.stringify(policy) !==
  JSON.stringify({
    policyRef: challengePolicy,
    sourceId: challengeSource,
    correctPoints: 2,
    incorrectPoints: -1,
    repeatPoints: 0,
  })
)
  throw new Error('CHALLENGE_POLICY_INVALID');
export function challengePoints(result: 'correct' | 'incorrect'): number {
  return result === 'correct'
    ? (policy.correctPoints as number)
    : (policy.incorrectPoints as number);
}
export const kindLabels: Readonly<Record<AnswerKind, string>> = Object.freeze({
  'program.enter': '进入主函数',
  'object.declare': '声明变量或数组',
  'value.initialize': '写入声明时的初值',
  'value.write': '给已有变量或数组槽赋值',
  condition: '判断条件并选择后续路径',
  'scope.enter': '进入一个作用域',
  'scope.exit': '离开作用域并释放局部对象',
  'output.append': '追加程序输出',
  'control.jump': '执行 break 或 continue 跳转',
  'program.return': '返回并结束主函数',
  nop: '执行空语句',
});
const raw = JSON.parse(catalogJson) as {
  version: string;
  questions: ChallengeQuestion[];
};
if (
  raw.version !== '1.0.0' ||
  raw.questions.length !== 21 ||
  new Set(raw.questions.map((q) => q.ref.id)).size !== 21 ||
  raw.questions.some((q) => {
    const rule = questionRule(q.ref.id);
    return (
      !rule ||
      q.ref.version !== rule.ref.version ||
      q.anchorKind !== rule.anchorKind ||
      JSON.stringify(q.choices) !== JSON.stringify(rule.choices)
    );
  })
)
  throw new Error('CHALLENGE_CATALOG_INVALID');
export const challengeQuestions: readonly ChallengeQuestion[] = Object.freeze(
  raw.questions.map((q) =>
    Object.freeze({ ...q, ref: Object.freeze(q.ref), choices: Object.freeze(q.choices) }),
  ),
);
export function challengeQuestion(id: string): ChallengeQuestion | undefined {
  return challengeQuestions.find((q) => q.ref.id === id);
}
/** Select actual Rust steps; a missing anchor produces no question, never a fabricated step. */
export function questionsForTrace(caseId: string, steps: readonly TraceStep[]) {
  return challengeQuestions
    .filter((q) => q.caseId === caseId)
    .flatMap((question) => {
      const cursor = steps.findIndex((step) => step.kind === question.anchorKind);
      return cursor < 0 ? [] : [{ question, cursor }];
    })
    .sort((a, b) => a.cursor - b.cursor);
}
