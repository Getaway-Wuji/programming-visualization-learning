import { studyNotesPaths } from './study-notes-release-inputs.mjs';
export const notesDownloadPaths = [
  ...new Set([
    ...studyNotesPaths,
    'web/src/study-notes/markdown.ts',
    'web/src/study-notes/zip.ts',
    'web/src/study-notes/download.ts',
    'web/src/study-notes/DownloadPanel.tsx',
    'scripts/notes-download-release-inputs.mjs',
    '项目文档/架构决策/20.2-Markdown本地打包与下载边界.md',
    '项目文档/契约/20.2-Markdown下载包契约.md',
  ]),
];
