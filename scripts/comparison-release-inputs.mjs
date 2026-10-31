import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.35.json', 'utf8'));
export const comparisonPaths = [
  ...new Set([
    ...prior.files.map((entry) => entry.path),
    ...['content.ts', 'controller.ts', 'ComparisonPage.tsx', 'comparison.css'].map(
      (path) => `web/src/comparison/${path}`,
    ),
    'web/src/App.tsx',
    'web/src/components/Layout.tsx',
    'web/src/pages/CatalogPages.tsx',
    '项目文档/契约/16.2-双算法对比生命周期.md',
    'scripts/comparison-release-inputs.mjs',
  ]),
];
