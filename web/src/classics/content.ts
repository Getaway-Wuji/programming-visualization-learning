import manifest from '../../../content/algorithms/cpp/classics-1.0.0.json';
import hanoi from '../../../content/algorithms/cpp/hanoi-1.0.0.cpp?raw';
import gcd from '../../../content/algorithms/cpp/euclidean-gcd-1.0.0.cpp?raw';
import prime from '../../../content/algorithms/cpp/trial-division-prime-1.0.0.cpp?raw';
import palindrome from '../../../content/algorithms/cpp/palindrome-number-1.0.0.cpp?raw';
export interface ClassicCase {
  id: string;
  version: string;
  programId: string;
  programVersion: string;
  language: 'cpp';
  kind: 'hanoi' | 'gcd' | 'prime' | 'palindrome';
  title: string;
  description: string;
  inputArity: number;
  min: number;
  max: number;
  defaultInput: number[];
  inputHelp: string;
  variant: string;
  complexity: string;
  extraSpace: string;
  objectives: string[];
  knowledgeConcepts: string[];
  sourceFile: string;
  sourceOrigin: string;
  boundarySamples: { id: string; title: string; input: number[] }[];
  phases: { id: string; title: string; explanation: string }[];
}
export const classicCases = manifest.cases as ClassicCase[],
  classicCatalog = { id: manifest.id, version: manifest.version };
export const classicCase = (id: string) => classicCases.find((c) => c.id === id);
const sources: Record<string, string> = {
  'case.cpp.hanoi': hanoi,
  'case.cpp.euclidean-gcd': gcd,
  'case.cpp.trial-division-prime': prime,
  'case.cpp.palindrome-number': palindrome,
};
export function parseClassicInput(spec: ClassicCase, draft: string) {
  const parts = draft.trim().split(/[\s,，]+/),
    values = parts.map(Number),
    valid =
      draft.length <= manifest.maxDraftChars &&
      parts.length === spec.inputArity &&
      parts.every((p) => /^[+-]?\d+$/.test(p)) &&
      values.every((v) => Number.isInteger(v) && v >= spec.min && v <= spec.max);
  return {
    valid,
    values: valid ? values.map((v) => (v === 0 ? 0 : v)) : [],
    issue: `${spec.inputHelp}请用空格或逗号分隔，恰${spec.inputArity}项，最多128字符。`,
  };
}
export function prepareClassic(spec: ClassicCase, draft: string) {
  const parsed = parseClassicInput(spec, draft),
    source = sources[spec.id];
  if (!classicCase(spec.id) || !parsed.valid) throw Error('E_INPUT_INVALID');
  if (!source) throw Error('E_CONTENT_MISMATCH');
  const phases = [...source.matchAll(/^[ \t]*\/\/ @phase ([a-z]+)\r?$/gm)].map((m) => {
    const phase = spec.phases.find((p) => p.id === m[1]);
    if (!phase) throw Error('E_CONTENT_MISMATCH');
    return { ...phase, start: new TextEncoder().encode(source.slice(0, m.index)).length };
  });
  if (phases.length !== spec.phases.length) throw Error('E_CONTENT_MISMATCH');
  return { source, input: [...parsed.values], phases };
}
export type PreparedClassic = ReturnType<typeof prepareClassic>;
