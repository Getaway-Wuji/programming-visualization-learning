import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.27.json', 'utf8'));
export const schedulerPaths = [
  ...new Set([
    ...prior.files.map((e) => e.path),
    'web/src/review-scheduler/model.ts',
    'web/src/review-scheduler/sources.ts',
    'web/src/review-scheduler/react.tsx',
    'web/src/review-scheduler/ReviewsPage.tsx',
    'web/src/review-scheduler/reviews.css',
    'web/src/storage/review-cards.ts',
    'web/src/storage/v4-migration.ts',
    '项目文档/契约/15.3-存档结构5.0.0.schema.json',
    '项目文档/契约/15.3-复习卡片1.0.0.schema.json',
    'scripts/scheduler-release-inputs.mjs',
  ]),
];
