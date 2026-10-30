import { readFileSync } from 'node:fs';
const previous = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.16.json', 'utf8'));
export const blockPermissionPaths = [
  ...previous.files.map((entry) => entry.path),
  'web/src/blocks/block-kinds.ts',
  'web/src/blocks/permissions.ts',
  'web/src/blocks/BlockPermissions.tsx',
  'web/src/blocks/block-permissions.css',
  'content/c/permissions/block-permissions-1.0.0.json',
  'scripts/block-permission-release-inputs.mjs',
  'scripts/restore-release-evidence.mjs',
];
