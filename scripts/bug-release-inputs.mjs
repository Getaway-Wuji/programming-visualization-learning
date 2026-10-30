import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.21.json', 'utf8'));
export const bugPaths = [
  ...new Set([
    ...prior.files.map((e) => e.path),
    'content/c/bugs/questions-1.0.0.json',
    'web/src/bugs/content.ts',
    'web/src/bugs/source.ts',
    'web/src/bugs/BugPanel.tsx',
    'web/src/bugs/bugs.css',
    'web/src/content/course-bundle.ts',
    'web/src/learning/reviewed-release.ts',
    'web/src/App.tsx',
    'web/src/components/Layout.tsx',
    'web/src/pages/Workspaces.tsx',
    'web/src/pages/HomePage.tsx',
    'scripts/bug-release-inputs.mjs',
  ]),
];
