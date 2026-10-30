import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.29.json', 'utf8'));
export const achievementPaths = [
  ...new Set([
    ...prior.files.map((e) => e.path),
    'web/src/components/Icon.tsx',
    'web/src/engine/module.ts',
    'web/src/memory/memory.css',
    'web/src/stack/examples.ts',
    'web/src/stack/StackPanel.tsx',
    'web/src/stack/presentation.ts',
    'web/src/stack/stack.css',
    'shared/fixtures/p1/functions.c',
    'shared/fixtures/p1/hanoi.cpp',
    ...[
      'content/achievements/catalog-1.0.0.json',
      'web/src/achievements/model.ts',
      'web/src/achievements/observation.ts',
      'web/src/achievements/react.tsx',
      'web/src/achievements/AchievementsPage.tsx',
      'web/src/achievements/achievements.css',
      'web/src/storage/achievements.ts',
      'web/src/storage/v5-migration.ts',
      'web/src/engine/memory-client.ts',
      'web/src/memory/controller.ts',
      'web/src/pages/MemoryPage.tsx',
      '项目文档/契约/15.4-存档结构6.0.0.schema.json',
      '项目文档/契约/15.4-成就1.0.0.schema.json',
      'scripts/achievement-release-inputs.mjs',
    ],
  ]),
];
