import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.20.json', 'utf8'));
export const diagnosticsPaths = [
  ...new Set([
    ...prior.files.map((entry) => entry.path),
    'web/src/diagnostics/messages.ts',
    'web/src/diagnostics/presentation.ts',
    'web/src/diagnostics/DiagnosticPanel.tsx',
    'web/src/diagnostics/diagnostics.css',
    'web/src/components/SourcePanel.tsx',
    'web/src/workbench/Workbench.tsx',
    'web/src/components/CaseExecution.tsx',
    'web/src/pages/MemoryPage.tsx',
    'web/src/engine/trace-validation.ts',
    'scripts/diagnostics-release-inputs.mjs',
  ]),
];
