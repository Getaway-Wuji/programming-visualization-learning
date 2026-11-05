import { browserScope } from '../browser-projects.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep, delimiter } from 'node:path';
import { build } from 'vite';

const label = process.argv[2];
assert.match(label ?? '', /^[A-Za-z0-9_.-]+$/);
const folder = resolve(`.artifacts/21.5/browser-${label}`);
assert(!existsSync(folder), 'Preserve earlier browser evidence.');
mkdirSync(folder, { recursive: true });
const output = resolve(folder, 'dist');
await build({
  configFile: false,
  root: resolve('tests/browser'),
  publicDir: false,
  worker: { format: 'es' },
  build: {
    outDir: output,
    emptyOutDir: false,
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { input: resolve('tests/browser/c6-learning-harness.html') },
  },
});
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};
const server = createServer((request, response) => {
  try {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const assetRoot =
      path.startsWith('/content/c/primer6-teaching/') ||
      path.startsWith('/content/c/primer6-learning/')
        ? resolve('web/public')
        : output;
    const file = resolve(assetRoot, decodeURIComponent(path).slice(1));
    assert(file.startsWith(assetRoot + sep) && statSync(file).isFile());
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; base-uri 'none'",
    });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(4198, '127.0.0.1', accept);
});
const sources = [
  'package.json',
  'package-lock.json',
  'scripts/c6-course/browser-learning.mjs',
  'web/src/storage/c6-reset.ts',
  'web/src/storage/c6-activation.ts',
  'web/src/storage/c6-course.ts',
  'web/src/storage/client.ts',
  'web/src/storage/recovery.ts',
  'web/src/c6-learning/index.ts',
  'web/src/c6-learning/release.generated.ts',
  'web/src/c6-learning/authority.ts',
  'web/src/c6-learning/model.ts',
  'web/src/c6-learning/recipe.ts',
  'web/src/c6-learning/rewards.ts',
  'web/src/c6-learning/rewards.generated.ts',
  'web/src/learning/domain.ts',
  'web/src/engine/c6-client.ts',
  'web/src/engine/c6-module.ts',
  'web/src/engine/c6-worker.ts',
  'web/src/generated/c6-teaching/engine-build.ts',
  'web/src/generated/c6-teaching/c_viz_c6_bg.wasm',
  'content/c/primer6-learning/index-1.0.0.json',
  'web/src/storage/model.ts',
  'web/src/storage/validation.ts',
  'web/src/storage/errors.ts',
  'tests/browser/c6-reset.spec.ts',
  'tests/browser/c6-learning-harness.ts',
  'tests/browser/c6-learning-harness.html',
  'tests/browser/c6-learning-playwright.config.ts',
];
const hashed = sources.map((path) => ({
  path,
  sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
}));
try {
  const argv = [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'tests/browser/c6-learning-playwright.config.ts',
    '--output',
    resolve(folder, 'output'),
  ];
  const child = spawn(process.execPath, argv, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: dirname(process.execPath) + delimiter + process.env.PATH,
      PLAYWRIGHT_BROWSERS_PATH: resolve('.tools/playwright'),
      PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(folder, 'results.json'),
    },
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (bytes) => {
    stdout += bytes;
    process.stdout.write(bytes);
  });
  child.stderr.on('data', (bytes) => {
    stderr += bytes;
    process.stderr.write(bytes);
  });
  const code = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', accept);
  });
  writeFileSync(
    resolve(folder, 'run.json'),
    JSON.stringify({ label, code, browserScope, sources: hashed, stdout, stderr }, null, 2) + '\n',
  );
  assert.equal(code, 0);
} finally {
  await new Promise((accept) => server.close(accept));
}
