import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.25.json', 'utf8'));
export const notebookPaths = [
  ...new Set([
    ...prior.files.map((e) => e.path),
    'web/src/storage/model.ts',
    'web/src/storage/client.ts',
    'web/src/storage/recovery.ts',
    'web/src/storage/v1-migration.ts',
    'web/src/storage/v2-migration.ts',
    'web/src/storage/v3-migration.ts',
    'web/src/storage/knowledge-marks.ts',
    'web/src/storage/validation.ts',
    'web/src/learning/authority.ts',
    'web/src/learning/domain.ts',
    'web/src/learning/attempt-authority.ts',
    'web/src/learning/service.ts',
    'web/src/review-notebook/marks.tsx',
    'web/src/review-notebook/model.ts',
    'web/src/review-notebook/NotebookPage.tsx',
    'web/src/review-notebook/notebook.css',
    'web/src/App.tsx',
    'web/src/components/Layout.tsx',
    'web/src/pages/LessonPage.tsx',
    'web/src/practice/react.tsx',
    '项目文档/契约/15.2-存档结构4.0.0.schema.json',
    'scripts/notebook-release-inputs.mjs',
  ]),
];
