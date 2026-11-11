import manifest from '../../../content/algorithms/cpp/iterative-sorts-1.0.0.json';
import insertion from '../../../content/algorithms/cpp/insertion-sort-1.0.0.cpp?raw';
import shell from '../../../content/algorithms/cpp/shell-sort-1.0.0.cpp?raw';
import counting from '../../../content/algorithms/cpp/counting-sort-1.0.0.cpp?raw';
import recursiveManifest from '../../../content/algorithms/cpp/recursive-sorts-1.0.0.json';
import merge from '../../../content/algorithms/cpp/merge-sort-1.0.0.cpp?raw';
import quick from '../../../content/algorithms/cpp/quick-sort-1.0.0.cpp?raw';
import bucketManifest from '../../../content/algorithms/cpp/bucket-sort-1.0.0.json';
import bucket from '../../../content/algorithms/cpp/bucket-sort-1.0.0.cpp?raw';
export interface BucketLayout {
  bucketCount: number;
  bucketCapacity: number;
  width: number;
  ranges: number[][];
  dataObject: string;
  sizesObject: string;
}
export interface SortPhase {
  id: string;
  title: string;
  explanation: string;
}
export interface SortCase {
  id: string;
  version: string;
  programId: string;
  programVersion: string;
  language: 'cpp';
  title: string;
  description: string;
  objectives: string[];
  min: number;
  max: number;
  maxItems: number;
  defaultInput: number[];
  variant: string;
  complexity: string;
  extraSpace: string;
  sourceFile: string;
  phases: SortPhase[];
  boundarySamples: number[][];
  knowledgeConcepts?: string[];
  sourceOrigin?: string;
  bucketLayout?: BucketLayout;
}
export const sortCases = manifest.cases as SortCase[];
export const sortCatalog = { id: manifest.id, version: manifest.version } as const;
export const recursiveSortCases = recursiveManifest.cases as SortCase[];
export const bucketSortCases = bucketManifest.cases as SortCase[];
export const allSortCases = [...sortCases, ...recursiveSortCases, ...bucketSortCases];
export function isRecursiveSort(spec: SortCase) {
  return recursiveSortCases.some((item) => item.id === spec.id);
}
export function sortCatalogFor(spec: SortCase) {
  if (bucketSortCases.some((item) => item.id === spec.id))
    return { id: bucketManifest.id, version: bucketManifest.version };
  return isRecursiveSort(spec)
    ? { id: recursiveManifest.id, version: recursiveManifest.version }
    : sortCatalog;
}
const templates: Record<string, string> = {
  'case.cpp.insertion-sort': insertion,
  'case.cpp.shell-sort': shell,
  'case.cpp.counting-sort': counting,
  'case.cpp.merge-sort': merge,
  'case.cpp.quick-sort': quick,
  'case.cpp.bucket-sort': bucket,
};
export function sortCase(id: string) {
  return allSortCases.find((item) => item.id === id);
}
export function validValues(spec: SortCase, values: readonly number[]) {
  return (
    values.length <= spec.maxItems &&
    values.every((value) => Number.isInteger(value) && value >= spec.min && value <= spec.max)
  );
}
export function parseSortInput(spec: SortCase, draft: string) {
  const text = draft.trim(),
    values = text === '[]' ? [] : text.split(/[\s,，]+/).map(Number);
  const valid =
    text.length > 0 &&
    text.length <= 1024 &&
    (text === '[]' || text.split(/[\s,，]+/).every((token) => /^[+-]?\d+$/.test(token))) &&
    validValues(spec, values);
  return {
    valid,
    values: valid ? values : [],
    issue: valid
      ? ''
      : `请输入0～${spec.maxItems}个${spec.min}～${spec.max}的十进制整数，以空格或逗号分隔；空数组写[]。`,
  };
}
export function prepareSort(spec: SortCase, values: readonly number[]) {
  if (!sortCase(spec.id) || !validValues(spec, values)) throw Error('E_INPUT_INVALID');
  const template = templates[spec.id];
  if (!template || template.split('{{n}}').length !== 2) throw Error('E_CONTENT_MISMATCH');
  const source = template.replace('{{n}}', String(values.length));
  const phases = [...source.matchAll(/^[ \t]*\/\/ @phase ([a-z]+)\r?$/gm)].map((match) => {
    const phase = spec.phases.find((phase) => phase.id === match[1]);
    if (!phase) throw Error('E_CONTENT_MISMATCH');
    const explanation =
      spec.id === 'case.cpp.quick-sort' && phase.id === 'setup'
        ? 'n为真实输入项数，values容量30。此原地分区不分配归并用的scratch数组；较短段递归使用实际调用帧。'
        : phase.explanation;
    return {
      ...phase,
      explanation,
      start: new TextEncoder().encode(source.slice(0, match.index)).length,
    };
  });
  if (phases.length !== spec.phases.length) throw Error('E_CONTENT_MISMATCH');
  return { source, input: [...values], phases };
}
