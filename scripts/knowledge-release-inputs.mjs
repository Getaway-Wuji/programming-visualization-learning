import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.24.json', 'utf8'));
export const knowledgePaths = [
  ...new Set([
    ...prior.files.map((entry) => entry.path),
    'content/c/knowledge/map-1.0.0.json',
    'web/src/knowledge/model.ts',
    'web/src/knowledge/KnowledgeMap.tsx',
    'web/src/knowledge/knowledge.css',
    'scripts/knowledge-release-inputs.mjs',
  ]),
];
