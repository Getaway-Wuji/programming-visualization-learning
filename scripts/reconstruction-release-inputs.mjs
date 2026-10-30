import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.19.json', 'utf8'));
export const reconstructionPaths = [
  ...new Set([
    ...prior.files.map((entry) => entry.path),
    'content/c/reconstruction/questions-1.0.0.json',
    'web/src/practice/reconstruction.ts',
    'web/src/practice/ReconstructionPanel.tsx',
    'web/src/practice/reconstruction.css',
    'web/src/practice/answer.ts',
    'web/src/pages/CatalogPages.tsx',
    'scripts/reconstruction-release-inputs.mjs',
  ]),
];
