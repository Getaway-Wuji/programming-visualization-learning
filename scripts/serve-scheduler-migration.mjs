// QA-only: actual27 production build, then the actual successor on the same origin.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
const legacy = resolve('.artifacts/15.3/legacy27-dist'),
  current = resolve('web/dist');
const marker = `.artifacts/15.3/migration-switch-${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
if (existsSync(marker)) throw new Error('Use a new migration evidence label');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
createServer((req, res) => {
  try {
    const root = existsSync(marker) ? current : legacy;
    const path = resolve(
      root,
      decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).slice(1) || 'index.html',
    );
    if (!path.startsWith(root + sep) || !statSync(path).isFile()) throw Error();
    const bytes = readFileSync(path);
    res
      .writeHead(200, {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      .end(bytes);
  } catch {
    res.writeHead(404).end();
  }
}).listen(4189, '127.0.0.1', () =>
  console.log('Actual predecessor/successor QA on http://127.0.0.1:4189'),
);
