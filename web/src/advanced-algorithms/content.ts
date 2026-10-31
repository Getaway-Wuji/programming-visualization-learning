import registry from '../../../content/algorithms/cpp/sieve-sequences-1.0.0.json';
import eratosthenes from '../../../content/algorithms/cpp/eratosthenes-sieve-1.0.0.cpp?raw';
import euler from '../../../content/algorithms/cpp/euler-sieve-1.0.0.cpp?raw';
import maximum from '../../../content/algorithms/cpp/maximum-subarray-1.0.0.cpp?raw';
import lis from '../../../content/algorithms/cpp/strict-lis-1.0.0.cpp?raw';
import type { AdvancedState } from '../engine/advanced-protocol';
export interface AdvancedAlgorithmSpec {
  id: string;
  version: string;
  programRef: { id: string; version: string };
  language: 'cpp';
  engine: 'engine.rust.advanced';
  sourceFile: string;
  prerequisiteLessonRef: { id: string; version: string };
  knowledgeRefs: { id: string; version: string }[];
  arrays: { name: string; label: string; extent: 'bound' | 'input' | 'count' }[];
  title: string;
  topic: string;
  inputKind: 'bound' | 'sequence';
  statement: string;
  platformConstraints: string;
  defaults: { values: number[] };
  strategy: string;
  explanation: string[];
  complexity: string;
  derivation: string;
  pitfalls: string[];
  reviewQuestion: string;
  samples: { key: string; values: number[]; expectedStdout: string; expectedReturn: number }[];
}
export const advancedAlgorithms = registry.cases as AdvancedAlgorithmSpec[];
export const advancedAlgorithmRegistryRef = { id: registry.id, version: registry.version };
export const findAdvancedAlgorithm = (id: string | undefined) =>
  advancedAlgorithms.find((s) => s.id === id);
const sources: Record<string, string> = {
  [advancedAlgorithms[0].id]: eratosthenes,
  [advancedAlgorithms[1].id]: euler,
  [advancedAlgorithms[2].id]: maximum,
  [advancedAlgorithms[3].id]: lis,
};
export function validAlgorithmInput(spec: AdvancedAlgorithmSpec, values: readonly number[]) {
  return spec.inputKind === 'bound'
    ? values.length === 1 && Number.isInteger(values[0]) && values[0] >= 0 && values[0] <= 30
    : values.length <= 30 && values.every((v) => Number.isInteger(v) && v >= -999 && v <= 999);
}
/** Formatting/domain validation only; no sieve, DP or expected-answer computation. */
export function parseAlgorithmInput(spec: AdvancedAlgorithmSpec, draft: string) {
  const empty = spec.inputKind === 'sequence' && draft.trim() === '[]',
    tokens = empty ? [] : draft.trim().split(/[\s,，]+/),
    values = tokens.map(Number);
  const valid =
    draft.length <= 1024 &&
    (empty || tokens.every((t) => /^[+-]?\d+$/.test(t))) &&
    validAlgorithmInput(spec, values);
  return {
    valid,
    values,
    issue: valid
      ? ''
      : spec.inputKind === 'bound'
        ? '请输入包含端点的上界整数0～30。'
        : '请输入0～30项−999～999整数，以空格或逗号分隔；空序列明确写[]。',
  };
}
export function prepareAdvancedAlgorithm(spec: AdvancedAlgorithmSpec, values: readonly number[]) {
  if (!findAdvancedAlgorithm(spec.id) || !validAlgorithmInput(spec, values))
    throw Error('E_INPUT_INVALID');
  const template = sources[spec.id];
  if (!template || template.split('{{n}}').length !== (spec.inputKind === 'bound' ? 1 : 2))
    throw Error('E_CONTENT_MISMATCH');
  return { source: template.replace('{{n}}', String(values.length)), input: [...values] };
}
/** Only reads current real objects/cells. Logical extents never invent algorithm values. */
export function projectAlgorithmArrays(
  spec: AdvancedAlgorithmSpec,
  values: readonly number[],
  state: AdvancedState,
) {
  return spec.arrays.map((a) => {
    const object = state.objects.find((o) => o.alive && o.name === a.name && o.typeName === 'int');
    const count = state.objects.find((o) => o.alive && o.name === 'count' && o.length === 1)
      ?.cells[0]?.value;
    const extent =
      a.extent === 'bound'
        ? values[0] + 1
        : a.extent === 'input'
          ? values.length
          : typeof count === 'number'
            ? count
            : null;
    const length = extent === null ? 0 : Math.max(0, Math.min(object?.length ?? 0, extent));
    return {
      ...a,
      present: !!object,
      extent,
      capacity: object?.length ?? null,
      values: object
        ? Array.from(
            { length },
            (_, i) =>
              object.cells.find((c) => c.byteOffset === i * 4)?.value ??
              (object.zeroInitialized ? 0 : null),
          )
        : [],
    };
  });
}
