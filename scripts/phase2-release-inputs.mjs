import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.44.json', 'utf8'));
export const phase2Paths = [
  ...prior.files.map((item) => item.path),
  'scripts/phase2-release-inputs.mjs',
];
