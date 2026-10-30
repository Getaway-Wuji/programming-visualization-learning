// Production-built, isolated Chrome harness for the P1 interpreter branch.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep, delimiter } from 'node:path';
import { build } from 'vite';

const label = process.argv[2];
assert.match(label ?? '', /^[A-Za-z0-9_.-]+$/, 'Supply a unique evidence label.');
const folder = resolve('.artifacts/12.2');
mkdirSync(folder, { recursive: true });
const report = resolve(folder, `memory-browser-${label}.json`);
assert.equal(existsSync(report), false, 'Earlier evidence is retained; use a new label.');
const output = resolve(folder, `memory-browser-dist-${label}`);
assert.equal(existsSync(output), false, 'Earlier build is retained; use a new label.');
await build({
  configFile: false,
  root: resolve('tests/browser'),
  base: '/',
  worker: { format: 'es' },
  build: {
    outDir: output,
    emptyOutDir: false,
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { input: resolve('tests/browser/memory-harness.html') },
  },
});
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};
const server = createServer((request, response) => {
  try {
    const path = resolve(
      output,
      decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).slice(1),
    );
    assert.ok(path.startsWith(output + sep) && statSync(path).isFile());
    response.writeHead(200, {
      'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; base-uri 'none'",
    });
    response.end(readFileSync(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(4182, '127.0.0.1', accept);
});
const startedAt = new Date().toISOString();
const hashedFiles = [
  'web/src/generated/memory/c_viz_memory_bg.wasm',
  'web/src/generated/memory/c_viz_memory.js',
  'web/src/generated/memory/engine-build.ts',
  'web/src/engine/module.ts',
  ...['pointers.c', 'dangling.c', 'list.cpp', 'tree.cpp', 'buckets.cpp'].map(
    (name) => `shared/fixtures/memory/${name}`,
  ),
  'scripts/memory-browser.mjs',
  ...['client', 'module', 'player', 'protocol', 'worker'].map(
    (name) => `web/src/engine/memory-${name}.ts`,
  ),
  ...['engine.spec.ts', 'harness.ts', 'harness.html', 'playwright.config.ts'].map(
    (name) => `tests/browser/memory-${name}`,
  ),
].map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
try {
  const argv = [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'tests/browser/memory-playwright.config.ts',
    '--output',
    resolve(folder, `memory-browser-output-${label}`),
  ];
  const child = spawn(process.execPath, argv, {
    windowsHide: true,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
      PLAYWRIGHT_BROWSERS_PATH: resolve('.tools/playwright'),
      PLAYWRIGHT_JSON_OUTPUT_NAME: report,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (data) => {
    log += data;
    process.stdout.write(data);
  });
  child.stderr.on('data', (data) => {
    log += data;
    process.stderr.write(data);
  });
  const exitCode = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', accept);
  });
  writeFileSync(resolve(folder, `memory-browser-${label}.log`), log, { flag: 'wx' });
  writeFileSync(
    resolve(folder, `memory-browser-${label}-run.json`),
    JSON.stringify(
      {
        startedAt,
        completedAt: new Date().toISOString(),
        label,
        node: process.version,
        browserScope: ['chrome'],
        productionBuiltHarness: true,
        isolatedLearningStorage: true,
        files: hashedFiles,
        argv,
        exitCode,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  assert.equal(exitCode, 0, 'Original failing evidence retained.');
  const result = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(result.stats.unexpected, 0);
  assert.equal(result.stats.flaky, 0);
  assert.equal(result.stats.skipped, 0);
} finally {
  await new Promise((accept) => server.close(accept));
}
