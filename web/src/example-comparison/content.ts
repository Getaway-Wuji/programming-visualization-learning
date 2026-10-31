import registry from '../../../content/advanced/example-solutions-1.0.0.json';
import twoSum from '../../../content/advanced/example-two-sum-1.0.0.cpp?raw';
import sortedSum from '../../../content/advanced/example-two-sum-merge-pointers-1.0.0.cpp?raw';
import moveZeroes from '../../../content/advanced/example-move-zeroes-1.0.0.cpp?raw';
import swapZeroes from '../../../content/advanced/example-move-zeroes-swap-1.0.0.cpp?raw';
import searchInsert from '../../../content/advanced/example-search-insert-1.0.0.cpp?raw';
import closedInsert from '../../../content/advanced/example-search-insert-closed-1.0.0.cpp?raw';
import {
  examples,
  validExampleInput,
  type ExampleInput,
  type ExampleSpec,
} from '../examples/content';
import type { AdvancedResult } from '../engine/advanced-protocol';
export interface SolutionSpec {
  solutionRef: { id: string; version: string };
  programRef: { id: string; version: string };
  sourceFile: string;
  title: string;
  strategy: string;
  time: string;
  space: string;
  derivation: string;
  suitable: string;
  cautions: string;
}
export const solutionSets = registry.examples;
export function solutionsFor(spec: ExampleSpec): readonly SolutionSpec[] {
  return (
    solutionSets.find(
      (set) => set.exampleRef.id === spec.id && set.exampleRef.version === spec.version,
    )?.solutions ?? []
  );
}
export function samplesFor(spec: ExampleSpec): ExampleSpec['samples'] {
  return [
    ...spec.samples,
    ...(solutionSets.find((set) => set.exampleRef.id === spec.id)?.supplementalSamples ?? []),
  ];
}
const sources: Record<string, string> = {
  [examples[0].sourceFile]: twoSum,
  'content/advanced/example-two-sum-merge-pointers-1.0.0.cpp': sortedSum,
  [examples[1].sourceFile]: moveZeroes,
  'content/advanced/example-move-zeroes-swap-1.0.0.cpp': swapZeroes,
  [examples[2].sourceFile]: searchInsert,
  'content/advanced/example-search-insert-closed-1.0.0.cpp': closedInsert,
};
export function prepareSolution(spec: ExampleSpec, solution: SolutionSpec, input: ExampleInput) {
  if (!validExampleInput(spec, input)) throw Error('E_INPUT_INVALID');
  const registered = solutionsFor(spec).find(
    (s) =>
      s.solutionRef.id === solution.solutionRef.id &&
      s.solutionRef.version === solution.solutionRef.version,
  );
  if (!registered || registered.sourceFile !== solution.sourceFile)
    throw Error('E_CONTENT_MISMATCH');
  const source = sources[registered.sourceFile];
  if (!source || source.split('{{n}}').length !== 2) throw Error('E_CONTENT_MISMATCH');
  return {
    source: source.replace('{{n}}', String(input.values.length)),
    input: [...input.values, ...(spec.hasTarget ? [input.target!] : [])],
    logicalLength: input.values.length,
  };
}
export type Outcome = 'unavailable' | 'equal' | 'rejected' | 'different';
/** Compare only actual outputs. This does not solve, sort or alter the original input. */
export function compareResults(
  spec: ExampleSpec,
  n: number,
  results: readonly (AdvancedResult | null)[],
): Outcome {
  if (results.length !== 2 || results.some((r) => !r?.trace || r.terminal.status !== 'completed'))
    return 'unavailable';
  const rows = results.map((r) => ({
    code: r!.terminal.returnValue,
    output: r!
      .trace!.steps.flatMap((s) => s.changes.filter((c) => c.op === 'output').map((c) => c.append))
      .join(''),
  }));
  if (rows.every((r) => r.code === 1 && r.output === 'INVALID_INPUT\n')) return 'rejected';
  if (rows.some((r) => r.code !== 0)) return 'different';
  const parsed = rows.map((r) => {
    if (!/^-?\d+(?: -?\d+)*\n$/.test(r.output)) return null;
    const values = r.output.trim().split(' ').map(Number);
    if (values.some((v) => !Number.isSafeInteger(v))) return null;
    if (spec.id === 'example.cpp.two-sum') {
      if (values.length !== 2 || values[0] === values[1] || values.some((v) => v < 0 || v >= n))
        return null;
      return [Math.min(...values), Math.max(...values)];
    }
    if (spec.id === 'example.cpp.move-zeroes') return values.length === n ? values : null;
    return values.length === 1 && values[0] >= 0 && values[0] <= n ? values : null;
  });
  return parsed.every(Boolean) && JSON.stringify(parsed[0]) === JSON.stringify(parsed[1])
    ? 'equal'
    : 'different';
}
