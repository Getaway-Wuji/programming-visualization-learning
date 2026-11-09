import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';

test('production gzip and Brotli variants reproduce original bytes and keep originals intact', () => {
  const folder = mkdtempSync(join(tmpdir(), 'c-viz-compression-'));
  try {
    const bytes = Buffer.from('const 中文 = "🙂";\n'.repeat(1000));
    writeFileSync(join(folder, 'asset.js'), bytes);
    writeFileSync(join(folder, 'tiny.json'), '{}');
    execFileSync(process.execPath, ['scripts/precompress.mjs', folder]);
    const first = readFileSync(join(folder, 'asset.js.br'));
    expect(readFileSync(join(folder, 'asset.js'))).toEqual(bytes);
    expect(gunzipSync(readFileSync(join(folder, 'asset.js.gz')))).toEqual(bytes);
    expect(brotliDecompressSync(first)).toEqual(bytes);
    expect(existsSync(join(folder, 'tiny.json.br'))).toBe(false);
    execFileSync(process.execPath, ['scripts/precompress.mjs', folder]);
    expect(readFileSync(join(folder, 'asset.js.br'))).toEqual(first);
    expect(existsSync(join(folder, 'asset.js.br.br'))).toBe(false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
