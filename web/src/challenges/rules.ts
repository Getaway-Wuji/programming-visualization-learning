import type { TraceStep } from '../engine/protocol';
export const challengePackage = Object.freeze({ id: 'content.challenge.c', version: '1.0.0' });
export const challengePolicy = Object.freeze({ id: 'reward.policy.challenge', version: '1.0.0' });
export const challengeSource = 'reward.challenge.first-answer' as const;
const cases = [
  'assignment',
  'branch',
  'loops',
  'array-traversal',
  'bubble-sort',
  'selection-sort',
  'binary-search-first',
];
/** Closed public metadata rules. No raw assets or language evaluation in the storage boundary. */
const rules = cases.flatMap((name, i) =>
  [
    ['initialize', 'value.initialize'],
    ['action', i === 0 ? 'value.write' : 'condition'],
    ['output', 'output.append'],
  ].map(([slot, kind], j) => {
    const distractors =
      kind === 'condition'
        ? ['value.write', 'output.append']
        : kind === 'value.write'
          ? ['condition', 'output.append']
          : kind === 'value.initialize'
            ? ['object.declare', 'value.write']
            : ['program.return', 'value.write'];
    const choices = [kind, ...distractors] as TraceStep['kind'][];
    const rotate = (i + j) % 3;
    return Object.freeze({
      ref: Object.freeze({ id: `challenge.c.${name}.${slot}`, version: '1.0.0' }),
      anchorKind: kind as TraceStep['kind'],
      choices: Object.freeze([...choices.slice(rotate), ...choices.slice(0, rotate)]),
    });
  }),
);
export function challengeQuestion(id: string) {
  return rules.find((q) => q.ref.id === id);
}
