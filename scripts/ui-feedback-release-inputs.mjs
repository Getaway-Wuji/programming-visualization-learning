import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.47.json', 'utf8'));
export const uiFeedbackPaths = [
  ...prior.files.map((item) => item.path),
  'web/src/player/key-steps.ts',
  'web/src/components/StepDetailControl.tsx',
  'scripts/ui-feedback-release-inputs.mjs',
];
