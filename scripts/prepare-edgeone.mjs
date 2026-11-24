import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { workspaceDir } from './process.mjs';

const distDir = resolve(workspaceDir, 'web/dist');
const hashFile = resolve(workspaceDir, '.artifacts/block-style-hashes.json');
const publishDir = resolve(workspaceDir, '.artifacts/edgeone-publish');
const publicDir = join(publishDir, 'public');

assert.ok(
  existsSync(distDir) && existsSync(join(distDir, 'index.html')),
  'Run product build before preparing the EdgeOne Pages bundle.',
);
assert.ok(
  existsSync(hashFile),
  'Missing .artifacts/block-style-hashes.json; run product build first.',
);

const policy = JSON.parse(readFileSync(hashFile, 'utf8'));
assert.equal(policy.version, '13.4.0');
assert.equal(policy.hashes.length, 2);
assert.ok(policy.hashes.every((hash) => /^[A-Za-z0-9+/]{43}=$/.test(hash)));

const csp = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  `style-src 'self' ${policy.hashes.map((hash) => `'sha256-${hash}'`).join(' ')}`,
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

rmSync(publishDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });

let fileCount = 0;
let totalBytes = 0;
let maxBytes = 0;
let maxFile = '';

function copyRawAssets(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const srcPath = join(sourceDir, entry.name);
    const dstPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyRawAssets(srcPath, dstPath);
      continue;
    }
    const ext = extname(entry.name);
    // EdgeOne CDN handles gzip/Brotli compression at the edge; omit local precompressed duplicates.
    if (ext === '.br' || ext === '.gz') continue;
    copyFileSync(srcPath, dstPath);
    const size = statSync(dstPath).size;
    fileCount++;
    totalBytes += size;
    if (size > maxBytes) {
      maxBytes = size;
      maxFile = dstPath.slice(publicDir.length + 1).replaceAll('\\', '/');
    }
  }
}

copyRawAssets(distDir, publicDir);

assert.ok(fileCount <= 20000, `EdgeOne Pages file count limit exceeded: ${fileCount}`);
assert.ok(
  maxBytes <= 25 * 1024 * 1024,
  `EdgeOne Pages 25 MiB single-file limit exceeded: ${maxFile}`,
);

const edgeoneConfig = {
  outputDirectory: './public',
  headers: [
    {
      source: '/*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Cache-Control', value: 'no-cache' },
      ],
    },
    {
      source: '/assets/*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
    {
      source: '/assets/*.wasm',
      headers: [{ key: 'Content-Type', value: 'application/wasm' }],
    },
    {
      source: '/blockly/*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ],
};

writeFileSync(join(publishDir, 'edgeone.json'), JSON.stringify(edgeoneConfig, null, 2) + '\n');

console.log(
  `EdgeOne Pages bundle prepared at .artifacts/edgeone-publish (${fileCount} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB, max ${(maxBytes / 1024 / 1024).toFixed(2)} MiB: ${maxFile}).`,
);
