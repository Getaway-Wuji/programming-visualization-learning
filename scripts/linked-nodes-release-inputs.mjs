import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.42.json', 'utf8'));
export const linkedNodesPaths = [
  ...new Set([
    ...prior.files.map((f) => f.path),
    'content/algorithms/cpp/linked-nodes-1.0.0.json',
    'content/algorithms/cpp/singly-linked-list-1.0.0.cpp',
    'content/algorithms/cpp/binary-search-tree-1.0.0.cpp',
    ...[
      'content.ts',
      'controller.ts',
      'presentation.ts',
      'NodeGraph.tsx',
      'NodeCaseCatalog.tsx',
      'NodeCasePage.tsx',
      'nodes.css',
    ].map((n) => `web/src/node-cases/${n}`),
    'scripts/linked-nodes-content.mjs',
    'scripts/linked-nodes-release-inputs.mjs',
    '项目文档/契约/16.8-C++节点案例与真实指针投影.md',
  ]),
];
