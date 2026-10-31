import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.37.json', 'utf8'));
export const snapshotPaths = [
  ...new Set([
    ...prior.files.map((entry) => entry.path),
    ...[
      'types.ts',
      'document.ts',
      'layout.ts',
      'png.ts',
      'browser.ts',
      'controller.ts',
      'ExportPanel.tsx',
      'snapshot-export.css',
    ].map((path) => `web/src/snapshot-export/${path}`),
    'web/src/components/CaseExecution.tsx',
    'web/src/pages/MemoryPage.tsx',
    '项目文档/契约/16.3-当前快照格式与捕获生命周期.md',
    'scripts/snapshot-release-inputs.mjs',
  ]),
];
