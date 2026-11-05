// Local static QA server. Deployment configuration is a later hosting task.
import { createServer } from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { workspaceDir } from './process.mjs';

const port = Number(process.env.CHECK_PORT ?? 4178);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('CHECK_PORT must be a valid local TCP port.');
const productRoot = realpathSync(resolve(workspaceDir, process.env.CHECK_DIST ?? 'web/dist'));
if (
  productRoot !== realpathSync(resolve(workspaceDir, 'web/dist')) &&
  !productRoot.startsWith(realpathSync(resolve(workspaceDir, '.artifacts')) + sep)
)
  throw new Error('CHECK_DIST must be web/dist or a candidate inside workspace .artifacts.');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.cur': 'image/x-icon',
};
const blockStyleHashes = JSON.parse(
  readFileSync(join(workspaceDir, '.artifacts/block-style-hashes.json'), 'utf8'),
);
if (
  blockStyleHashes.version !== '13.4.0' ||
  blockStyleHashes.hashes.length !== 2 ||
  blockStyleHashes.hashes.some((hash) => !/^[A-Za-z0-9+/]{43}=$/.test(hash))
)
  throw new Error('Build the reviewed Blockly styles before starting static QA.');
// Static production-like QA policy. Vite HMR and eventual HTTPS hosting are separate.
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  `style-src 'self' ${blockStyleHashes.hashes.map((hash) => `'sha256-${hash}'`).join(' ')}`,
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');
createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  // Explicit QA fault injection exercises the complete immutable old release.
  if (
    process.env.P05_HIDE_COURSE_BUNDLE === '1' &&
    /^\/content\/(?:course|review)\//.test(url.pathname)
  ) {
    response
      .writeHead(404, { 'Cache-Control': 'no-store' })
      .end('Course bundle intentionally unavailable in legacy regression');
    return;
  }
  const isCheck = url.pathname.startsWith('/checks/');
  // QA entries have their own asset base but consume the same published content.
  const isCheckContent = url.pathname.startsWith('/checks/content/');
  const root =
    isCheck && !isCheckContent ? resolve(workspaceDir, '.artifacts/browser-dist') : productRoot;
  let pathname;
  try {
    pathname = decodeURIComponent(isCheck ? url.pathname.slice('/checks'.length) : url.pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const file = resolve(join(root, pathname === '/' ? 'index.html' : pathname.slice(1)));
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error('Not a file');
    const bytes = readFileSync(file);
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Content-Length': bytes.length,
      'Cache-Control': /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm)$/.test(pathname)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': contentSecurityPolicy,
    });
    response.end(bytes);
  } catch {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Resource not found');
  }
}).listen(port, '127.0.0.1', () =>
  console.log(`Static engineering checks at http://127.0.0.1:${port}`),
);
