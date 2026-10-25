import type { InputValues } from '../../web/src/content/types';

/** Project-authored public acceptance data, never a production result provider. */
export interface CaseSetSample {
  key: string;
  caseId: string;
  values: InputValues;
  stdout: string;
  /** One representative per case traverses every visible state in both directions. */
  walk?: boolean;
  finalArray?: readonly number[];
}

export const caseSetIds = [
  'case.c.assignment',
  'case.c.branch',
  'case.c.loops',
  'case.c.array-traversal',
  'case.c.bubble-sort',
  'case.c.selection-sort',
  'case.c.binary-search-first',
] as const;

const ascending30 = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30,
];
const descending30 = [
  30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5,
  4, 3, 2, 1,
];
const alternating30 = [
  -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999,
  -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999,
];
const sortVariants = [
  {
    key: 'mixed',
    values: [4, -1, 4, 0],
    finalArray: [-1, 0, 4, 4],
    stdout: '-1 0 4 4\n',
    walk: true,
  },
  { key: 'empty', values: [], finalArray: [], stdout: '\n' },
  { key: 'single', values: [-999], finalArray: [-999], stdout: '-999\n' },
  { key: 'ordered', values: [-3, 0, 4], finalArray: [-3, 0, 4], stdout: '-3 0 4\n' },
  { key: 'reverse', values: [4, 0, -3], finalArray: [-3, 0, 4], stdout: '-3 0 4\n' },
  { key: 'equal', values: [2, 2, 2], finalArray: [2, 2, 2], stdout: '2 2 2\n' },
  {
    key: 'limits',
    values: [-999, 999, -999],
    finalArray: [-999, -999, 999],
    stdout: '-999 -999 999\n',
  },
  {
    key: 'maximum',
    values: descending30,
    finalArray: ascending30,
    stdout: '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30\n',
  },
];

export const caseSetSamples: readonly CaseSetSample[] = [
  {
    key: 'assignment-negative',
    caseId: caseSetIds[0],
    values: { x: -7 },
    stdout: '-5\n',
    walk: true,
  },
  { key: 'assignment-zero', caseId: caseSetIds[0], values: { x: 0 }, stdout: '2\n' },
  { key: 'assignment-min', caseId: caseSetIds[0], values: { x: -999 }, stdout: '-997\n' },
  { key: 'assignment-max', caseId: caseSetIds[0], values: { x: 999 }, stdout: '1001\n' },
  { key: 'branch-positive', caseId: caseSetIds[1], values: { x: 1 }, stdout: '1\n', walk: true },
  { key: 'branch-zero', caseId: caseSetIds[1], values: { x: 0 }, stdout: '1\n' },
  { key: 'branch-negative', caseId: caseSetIds[1], values: { x: -1 }, stdout: '0\n' },
  { key: 'loops-normal', caseId: caseSetIds[2], values: { n: 5 }, stdout: '15\n15\n', walk: true },
  { key: 'loops-zero', caseId: caseSetIds[2], values: { n: 0 }, stdout: '0\n0\n' },
  { key: 'loops-single', caseId: caseSetIds[2], values: { n: 1 }, stdout: '1\n1\n' },
  { key: 'loops-maximum', caseId: caseSetIds[2], values: { n: 30 }, stdout: '465\n465\n' },
  {
    key: 'array-mixed',
    caseId: caseSetIds[3],
    values: { values: [-2, 5, 5, 0] },
    stdout: '8\n',
    walk: true,
  },
  { key: 'array-empty', caseId: caseSetIds[3], values: { values: [] }, stdout: '0\n' },
  { key: 'array-single', caseId: caseSetIds[3], values: { values: [-999] }, stdout: '-999\n' },
  { key: 'array-maximum', caseId: caseSetIds[3], values: { values: alternating30 }, stdout: '0\n' },
  ...(['bubble-sort', 'selection-sort'] as const).flatMap((name) =>
    sortVariants.map((variant) => ({
      ...variant,
      key: `${name}-${variant.key}`,
      caseId: `case.c.${name}`,
      values: { values: variant.values },
    })),
  ),
  {
    key: 'search-duplicate',
    caseId: caseSetIds[6],
    values: { values: [-2, 0, 0, 4, 8], target: 0 },
    stdout: '1\n',
    walk: true,
  },
  {
    key: 'search-head',
    caseId: caseSetIds[6],
    values: { values: [-2, 0, 0, 4, 8], target: -2 },
    stdout: '0\n',
  },
  {
    key: 'search-tail',
    caseId: caseSetIds[6],
    values: { values: [-2, 0, 0, 4, 8], target: 8 },
    stdout: '4\n',
  },
  {
    key: 'search-missing',
    caseId: caseSetIds[6],
    values: { values: [-2, 0, 0, 4, 8], target: 1 },
    stdout: '-1\n',
  },
  {
    key: 'search-below',
    caseId: caseSetIds[6],
    values: { values: [-2, 0, 0, 4, 8], target: -9 },
    stdout: '-1\n',
  },
  {
    key: 'search-above',
    caseId: caseSetIds[6],
    values: { values: [-2, 0, 0, 4, 8], target: 9 },
    stdout: '-1\n',
  },
  { key: 'search-empty', caseId: caseSetIds[6], values: { values: [], target: 0 }, stdout: '-1\n' },
  {
    key: 'search-single-hit',
    caseId: caseSetIds[6],
    values: { values: [-4], target: -4 },
    stdout: '0\n',
  },
  {
    key: 'search-single-miss',
    caseId: caseSetIds[6],
    values: { values: [-4], target: 0 },
    stdout: '-1\n',
  },
  {
    key: 'search-equal',
    caseId: caseSetIds[6],
    values: { values: [2, 2, 2], target: 2 },
    stdout: '0\n',
  },
  {
    key: 'search-maximum',
    caseId: caseSetIds[6],
    values: { values: ascending30, target: 30 },
    stdout: '29\n',
  },
];
