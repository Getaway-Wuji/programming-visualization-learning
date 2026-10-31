import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.34.json', 'utf8'));
export const challengePaths = [
  ...new Set([
    ...prior.files.map((e) => e.path),
    'content/challenges/cases-1.0.0.json',
    'content/rewards/challenge-1.0.0.json',
    ...[
      'content.ts',
      'rules.ts',
      'authority.ts',
      'domain.ts',
      'explanation.ts',
      'ChallengePanel.tsx',
      'challenges.css',
    ].map((p) => `web/src/challenges/${p}`),
    'web/src/storage/v6-migration.ts',
    'web/src/player/controller.ts',
    'web/src/engine/execution-client.ts',
    'web/src/components/CaseExecution.tsx',
    '项目文档/契约/16.1-存档结构7.0.0.schema.json',
    'scripts/challenge-release-inputs.mjs',
    'scripts/build-p05-course.mjs',
    'scripts/restore-release-evidence.mjs',
  ]),
];
