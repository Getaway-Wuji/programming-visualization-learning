import catalog from '../../../content/algorithms/cpp/stack-queue-1.0.0.json';
import stack from '../../../content/algorithms/cpp/array-stack-1.0.0.cpp?raw';
import queue from '../../../content/algorithms/cpp/circular-queue-1.0.0.cpp?raw';
export interface StructurePhase {
  id: string;
  title: string;
  explanation: string;
}
export interface StructureCase {
  id: string;
  version: string;
  programId: string;
  programVersion: string;
  language: 'cpp';
  kind: 'stack' | 'circular-queue';
  title: string;
  description: string;
  objectives: string[];
  min: number;
  max: number;
  capacity: number;
  defaultDraft: string;
  variant: string;
  complexity: string;
  extraSpace: string;
  sourceFile: string;
  knowledgeConcepts: string[];
  sourceOrigin: string;
  boundaryDrafts: { id: string; title: string; draft: string }[];
  phases: StructurePhase[];
}
export const structureCases = catalog.cases as StructureCase[];
export const structureCatalog = { id: catalog.id, version: catalog.version };
export const operationEncoding = catalog.inputEncoding;
const templates: Record<string, string> = {
  'case.cpp.array-stack': stack,
  'case.cpp.circular-queue': queue,
};
export const structureCase = (id: string) => structureCases.find((item) => item.id === id);
/** Syntax validation and linear wire encoding only; never executes or predicts operations. */
export function parseOperations(spec: StructureCase, draft: string) {
  const reject = (issue: string) => ({
    valid: false,
    issue,
    encoded: [] as number[],
    operationCount: 0,
  });
  if (draft.length > operationEncoding.maxDraftChars) return reject('操作序列最多1024个字符。');
  const text = draft.trim();
  if (text === '[]') return { valid: true, issue: '', encoded: [] as number[], operationCount: 0 };
  if (!text) return reject('每行写入 整数或出；空序列写[]。');
  const encoded: number[] = [];
  let operationCount = 0;
  for (const [index, line] of draft.split(/\r\n|\n|\r/).entries()) {
    const command = line.trim();
    if (!command) continue;
    if (command === '出') encoded.push(operationEncoding.outCode);
    else {
      const match = /^入[ \t]+([+-]?\d+)$/.exec(command),
        value = match ? Number(match[1]) : NaN;
      if (!match || !Number.isInteger(value) || value < spec.min || value > spec.max)
        return reject(
          `第${index + 1}行：只接受入 ${spec.min}～${spec.max}的十进制整数，或单独写出。`,
        );
      encoded.push(operationEncoding.inCode, value === 0 ? 0 : value);
    }
    operationCount++;
    if (encoded.length > operationEncoding.maxEncodedItems)
      return reject('超过30个输入整数槽：入占2槽，出占1槽。请缩短序列；不会截断运行。');
  }
  return { valid: true, issue: '', encoded, operationCount };
}
export function prepareStructure(spec: StructureCase, draft: string) {
  const parsed = parseOperations(spec, draft);
  if (!structureCase(spec.id) || !parsed.valid) throw Error('E_INPUT_INVALID');
  const template = templates[spec.id];
  if (!template || template.split('{{n}}').length !== 2) throw Error('E_CONTENT_MISMATCH');
  const source = template.replace('{{n}}', String(parsed.encoded.length));
  const phases = [...source.matchAll(/^[ \t]*\/\/ @phase ([a-z]+)\r?$/gm)].map((match) => {
    const phase = spec.phases.find((p) => p.id === match[1]);
    if (!phase) throw Error('E_CONTENT_MISMATCH');
    return { ...phase, start: new TextEncoder().encode(source.slice(0, match.index)).length };
  });
  if (phases.length !== spec.phases.length) throw Error('E_CONTENT_MISMATCH');
  return { source, input: [...parsed.encoded], operationCount: parsed.operationCount, phases };
}
export type PreparedStructure = ReturnType<typeof prepareStructure>;
