import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.41.json', 'utf8'));
export const structuresPaths = [
  ...new Set([
    ...prior.files.map((f) => f.path),
    'content/algorithms/cpp/stack-queue-1.0.0.json',
    'content/algorithms/cpp/array-stack-1.0.0.cpp',
    'content/algorithms/cpp/circular-queue-1.0.0.cpp',
    ...[
      'content.ts',
      'controller.ts',
      'presentation.ts',
      'StructureState.tsx',
      'StructureCatalog.tsx',
      'StructurePage.tsx',
      'structures.css',
    ].map((n) => `web/src/structures/${n}`),
    'scripts/structures-content.mjs',
    'scripts/structures-release-inputs.mjs',
    '项目文档/契约/16.7-C++结构案例与操作编码.md',
  ]),
];
