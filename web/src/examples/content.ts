import registry from '../../../content/advanced/examples-1.0.0.json';
import twoSum from '../../../content/advanced/example-two-sum-1.0.0.cpp?raw';
import moveZeroes from '../../../content/advanced/example-move-zeroes-1.0.0.cpp?raw';
import searchInsert from '../../../content/advanced/example-search-insert-1.0.0.cpp?raw';
export interface ExampleInput {
  values: number[];
  target?: number;
}
export interface ExampleSpec {
  id: string;
  version: string;
  caseRef: { id: string; version: string };
  solutionRef: { id: string; version: string };
  programRef: { id: string; version: string };
  language: 'cpp';
  engine: 'engine.rust.advanced';
  title: string;
  topic: string;
  source: {
    provider: string;
    problemNumber: number;
    title: string;
    url: string;
    checkedAt: string;
    termsUrl: string;
    authorization: string;
    use: string;
  };
  originalConstraints: string;
  statement: string;
  platformConstraints: string;
  minItems: number;
  maxItems: number;
  min: number;
  max: number;
  hasTarget: boolean;
  strictlyIncreasing: boolean;
  prerequisiteLessonRef: { id: string; version: string };
  knowledgeRefs: { id: string; version: string }[];
  strategy: string;
  explanation: string[];
  complexity: string;
  derivation: string;
  pitfalls: string[];
  reviewQuestion: string;
  sourceFile: string;
  defaults: ExampleInput;
  samples: (ExampleInput & { key: string; expectedStdout: string; expectedReturn: number })[];
}
export const examples = registry.examples as ExampleSpec[];
export const exampleRegistryRef = { id: registry.id, version: registry.version };
export const examplePackageRef = registry.packageRef;
export const findExample = (id: string | undefined) => examples.find((item) => item.id === id);
const templates: Record<string, string> = {
  'example.cpp.two-sum': twoSum,
  'example.cpp.move-zeroes': moveZeroes,
  'example.cpp.search-insert': searchInsert,
};
/** Input shape/order validation only. Answers and uniqueness are computed by Rust. */
export function validExampleInput(spec: ExampleSpec, input: ExampleInput) {
  return (
    input.values.length >= spec.minItems &&
    input.values.length <= spec.maxItems &&
    input.values.every(
      (value) => Number.isInteger(value) && value >= spec.min && value <= spec.max,
    ) &&
    (spec.hasTarget
      ? Number.isInteger(input.target) && input.target! >= spec.min && input.target! <= spec.max
      : input.target === undefined) &&
    (!spec.strictlyIncreasing ||
      input.values.every((value, i) => i === 0 || input.values[i - 1] < value))
  );
}
export function parseExampleInput(spec: ExampleSpec, draft: string, targetDraft: string) {
  const tokens = draft.trim() ? draft.trim().split(/[\s,，]+/) : [];
  const input: ExampleInput = {
    values: tokens.map(Number),
    ...(spec.hasTarget ? { target: Number(targetDraft) } : {}),
  };
  const valid =
    draft.length <= 1024 &&
    tokens.every((token) => /^[+-]?\d+$/.test(token)) &&
    (!spec.hasTarget || (targetDraft.length <= 16 && /^[+-]?\d+$/.test(targetDraft))) &&
    validExampleInput(spec, input);
  return {
    valid,
    input,
    issue: valid
      ? ''
      : `请输入${spec.minItems}～${spec.maxItems}项${spec.min}～${spec.max}的整数${spec.hasTarget ? '及同范围目标' : ''}；${spec.strictlyIncreasing ? '数组必须严格递增且无重复。' : '以空格或逗号分隔，不接受空数组。'}`,
  };
}
export function prepareExample(spec: ExampleSpec, input: ExampleInput) {
  if (!findExample(spec.id) || !validExampleInput(spec, input)) throw Error('E_INPUT_INVALID');
  const template = templates[spec.id];
  if (!template || template.split('{{n}}').length !== 2) throw Error('E_CONTENT_MISMATCH');
  return {
    source: template.replace('{{n}}', String(input.values.length)),
    input: [...input.values, ...(spec.hasTarget ? [input.target!] : [])],
  };
}
