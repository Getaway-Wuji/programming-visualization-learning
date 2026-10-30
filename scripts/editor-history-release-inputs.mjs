import { readFileSync } from 'node:fs';
const previous = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.18.json', 'utf8'));
export const editorHistoryPaths = [
  ...previous.files.map((entry) => entry.path),
  'web/src/storage/model.ts',
  'web/src/storage/validation.ts',
  'web/src/storage/errors.ts',
  'web/src/storage/v1-migration.ts',
  'web/src/storage/editor-history.ts',
  'web/src/storage/v2-migration.ts',
  'web/src/blocks/history-workspace.ts',
  'web/src/practice/history.ts',
  'web/src/practice/EditorHistory.tsx',
  'web/src/practice/editor-history.css',
  'scripts/editor-history-release-inputs.mjs',
  '项目文档/契约/13.4-存档结构3.0.0.schema.json',
];
