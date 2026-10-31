import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.38.json', 'utf8'));
export const iterativeSortPaths = [
  ...new Set([
    ...prior.files.map((item) => item.path),
    ...[
      'AlgorithmCatalog.tsx',
      'AlgorithmPage.tsx',
      'algorithms.css',
      'content.ts',
      'controller.ts',
      'presentation.ts',
      'types.ts',
    ].map((path) => `web/src/algorithms/${path}`),
    ...[
      'algorithm-client.ts',
      'algorithm-module.ts',
      'algorithm-worker.ts',
      'algorithm-protocol.ts',
      'algorithm-player.ts',
    ].map((path) => `web/src/engine/${path}`),
    ...[
      'iterative-sorts-1.0.0.json',
      'insertion-sort-1.0.0.cpp',
      'shell-sort-1.0.0.cpp',
      'counting-sort-1.0.0.cpp',
    ].map((path) => `content/algorithms/cpp/${path}`),
    'scripts/iterative-sort-content.mjs',
    'scripts/iterative-sort-release-inputs.mjs',
    '项目文档/契约/16.4-C++排序案例与教学标注.md',
  ]),
];
