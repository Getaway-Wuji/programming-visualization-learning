import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.39.json', 'utf8'));
export const recursiveSortPaths = [
  ...new Set([
    ...prior.files.map((item) => item.path),
    ...[
      'SortArray.tsx',
      'SortState.tsx',
      'SortSource.tsx',
      'pair-controller.ts',
      'RecursiveComparisonPage.tsx',
    ].map((p) => 'web/src/algorithms/' + p),
    ...['recursive-sorts-1.0.0.json', 'merge-sort-1.0.0.cpp', 'quick-sort-1.0.0.cpp'].map(
      (p) => 'content/algorithms/cpp/' + p,
    ),
    'scripts/recursive-sort-content.mjs',
    'scripts/recursive-sort-release-inputs.mjs',
    '项目文档/契约/16.5-C++递归案例与配对对比.md',
  ]),
];
