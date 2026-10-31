import catalog from '../../../content/algorithms/cpp/linked-nodes-1.0.0.json';
import list from '../../../content/algorithms/cpp/singly-linked-list-1.0.0.cpp?raw';
import bst from '../../../content/algorithms/cpp/binary-search-tree-1.0.0.cpp?raw';
export interface NodeCase {
  id: string;
  version: string;
  programId: string;
  programVersion: string;
  language: 'cpp';
  kind: 'list' | 'bst';
  title: string;
  description: string;
  objectives: string[];
  capacity: number;
  min: number;
  max: number;
  defaultDraft: string;
  syntax: string;
  variant: string;
  complexity: string;
  extraSpace: string;
  sourceFile: string;
  knowledgeConcepts: string[];
  sourceOrigin: string;
  boundaryDrafts: { id: string; title: string; draft: string }[];
  phases: { id: string; title: string; explanation: string }[];
}
export const nodeCases = catalog.cases as NodeCase[];
export const nodeCatalog = { id: catalog.id, version: catalog.version };
export const nodeEncoding = catalog.inputEncoding;
const templates: Record<string, string> = {
  'case.cpp.singly-linked-list': list,
  'case.cpp.binary-search-tree': bst,
};
export const nodeCase = (id: string) => nodeCases.find((c) => c.id === id);
/** Strict syntax and wire encoding only. Business capacity, positions and duplicate checks run in C++. */
export function parseNodeOperations(spec: NodeCase, draft: string) {
  const reject = (issue: string) => ({
    valid: false,
    issue,
    encoded: [] as number[],
    operationCount: 0,
  });
  if (draft.length > nodeEncoding.maxDraftChars) return reject('操作序列最多1024个字符。');
  if (draft.trim() === '[]')
    return { valid: true, issue: '', encoded: [] as number[], operationCount: 0 };
  if (!draft.trim()) return reject('请按逐行格式输入；空序列写[]。');
  const encoded: number[] = [];
  let operationCount = 0;
  for (const [index, line] of draft.split(/\r\n|\n|\r/).entries()) {
    const text = line.trim();
    if (!text) continue;
    const parts = text.split(/[ \t]+/),
      command = parts[0],
      args = parts.slice(1);
    let code = 0,
      arity = -1;
    if (command === '插') {
      code = 1;
      arity = spec.kind === 'list' ? 2 : 1;
    } else if (spec.kind === 'list' && command === '删') {
      code = 2;
      arity = 1;
    } else if (spec.kind === 'bst' && command === '查') {
      code = 2;
      arity = 1;
    } else if (spec.kind === 'list' && command === '遍历') {
      code = 3;
      arity = 0;
    } else if (spec.kind === 'bst' && ['前序', '中序', '后序'].includes(command)) {
      code = ['前序', '中序', '后序'].indexOf(command) + 3;
      arity = 0;
    }
    if (
      args.length !== arity ||
      !args.every(
        (a) =>
          /^[+-]?\d+$/.test(a) &&
          Number.isInteger(Number(a)) &&
          Number(a) >= spec.min &&
          Number(a) <= spec.max,
      )
    )
      return reject(`第${index + 1}行：使用${spec.syntax}，参数只接受−999～999十进制整数。`);
    encoded.push(code, ...args.map((a) => (Number(a) === 0 ? 0 : Number(a))));
    operationCount++;
    if (encoded.length > nodeEncoding.maxEncodedItems)
      return reject('超过30个输入整数槽，不会截断运行。请缩短序列。');
  }
  return { valid: true, issue: '', encoded, operationCount };
}
export function prepareNodeCase(spec: NodeCase, draft: string) {
  const parsed = parseNodeOperations(spec, draft),
    template = templates[spec.id];
  if (!nodeCase(spec.id) || !parsed.valid) throw Error('E_INPUT_INVALID');
  if (!template || template.split('{{n}}').length !== 2) throw Error('E_CONTENT_MISMATCH');
  const source = template.replace('{{n}}', String(parsed.encoded.length));
  const phases = [...source.matchAll(/^[ \t]*\/\/ @phase ([a-z]+)\r?$/gm)].map((m) => {
    const phase = spec.phases.find((p) => p.id === m[1]);
    if (!phase) throw Error('E_CONTENT_MISMATCH');
    return { ...phase, start: new TextEncoder().encode(source.slice(0, m.index)).length };
  });
  if (phases.length !== spec.phases.length) throw Error('E_CONTENT_MISMATCH');
  return { source, input: [...parsed.encoded], operationCount: parsed.operationCount, phases };
}
export type PreparedNodeCase = ReturnType<typeof prepareNodeCase>;
