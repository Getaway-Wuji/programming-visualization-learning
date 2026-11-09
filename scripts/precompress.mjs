import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const root = resolve(process.argv[2] ?? 'web/dist');
let files = 0;
let originalBytes = 0;
let gzipBytes = 0;
let brotliBytes = 0;
function visit(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      visit(path);
      continue;
    }
    if (!/\.(?:html|js|css|json|svg|wasm)$/.test(extname(path))) continue;
    const bytes = readFileSync(path);
    if (bytes.length < 1024) continue;
    const gz = gzipSync(bytes, { level: 9 });
    const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
    if (gz.length < bytes.length) writeFileSync(path + '.gz', gz);
    if (br.length < bytes.length) writeFileSync(path + '.br', br);
    files++;
    originalBytes += bytes.length;
    gzipBytes += Math.min(gz.length, bytes.length);
    brotliBytes += Math.min(br.length, bytes.length);
  }
}
visit(root);
console.log(JSON.stringify({ files, originalBytes, gzipBytes, brotliBytes }));
