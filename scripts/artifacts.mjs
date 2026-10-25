import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { workspaceDir } from './process.mjs';

const entries = [];
function scan(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) scan(file);
    else {
      const bytes = readFileSync(file);
      entries.push({
        path: relative(workspaceDir, file).replaceAll('\\', '/'),
        bytes: bytes.length,
        gzipBytes: gzipSync(bytes).length,
        brotliBytes: brotliCompressSync(bytes).length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
scan(join(workspaceDir, 'web/dist'));
scan(join(workspaceDir, '.artifacts/browser-dist'));
if (entries.some((entry) => /jsdom|node_modules|\.map$/.test(entry.path)))
  throw new Error('Unexpected development resource in build.');
const totals = Object.fromEntries(
  ['web/dist/', '.artifacts/browser-dist/'].map((prefix) => [
    prefix,
    entries
      .filter((entry) => entry.path.startsWith(prefix))
      .reduce((sum, entry) => sum + entry.gzipBytes, 0),
  ]),
);
writeFileSync(
  join(workspaceDir, '.artifacts/artifact-hashes.json'),
  JSON.stringify({ evidenceLevel: 'engineering-build', entries, gzipTotals: totals }, null, 2) +
    '\n',
);
console.log('Production and internal harness hashes recorded.', totals);
