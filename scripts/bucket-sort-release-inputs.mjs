import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.40.json', 'utf8'));
export const bucketSortPaths = [
  ...new Set([
    ...prior.files.map((f) => f.path),
    'content/algorithms/cpp/bucket-sort-1.0.0.json',
    'content/algorithms/cpp/bucket-sort-1.0.0.cpp',
    'web/src/algorithms/BucketState.tsx',
    'web/src/algorithms/bucket-presentation.ts',
    'scripts/bucket-sort-content.mjs',
    'scripts/bucket-sort-release-inputs.mjs',
    '项目文档/契约/16.6-C++桶案例与槽位投影.md',
  ]),
];
