import { aiDebugPaths } from './ai-debug-release-inputs.mjs';
export const studyNotesPaths = [
  ...new Set([
    ...aiDebugPaths,
    'web/src/study-notes/types.ts',
    'web/src/study-notes/model.ts',
    'web/src/study-notes/session.tsx',
    'web/src/study-notes/NotesPage.tsx',
    'web/src/study-notes/SnapshotPreview.tsx',
    'web/src/study-notes/notes.css',
    'scripts/study-notes-release-inputs.mjs',
    '项目文档/架构决策/20.1-笔记选择与临时快照边界.md',
    '项目文档/契约/20.1-笔记选择与预览契约.md',
  ]),
];
