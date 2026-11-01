import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
const target = '项目文档/验收/20.1-验证原件';
assert.equal(existsSync(`${target}/index.json`), false, 'Never overwrite evidence');
mkdirSync(target, { recursive: true });
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${path}/${e.name}`) : [`${path}/${e.name}`],
  );
const sha = (b) => createHash('sha256').update(b).digest('hex');
const roots = ['.artifacts/20.1', '.artifacts/16.3/browser/r201-snapshot-regression'];
const files = roots
  .flatMap(walk)
  .sort()
  .map((sourcePath, i) => {
    const bytes = readFileSync(sourcePath),
      file = `${String(i).padStart(5, '0')}.gz`,
      archive = gzipSync(bytes);
    writeFileSync(`${target}/${file}`, archive, { flag: 'wx' });
    assert.equal(sha(gunzipSync(archive)), sha(bytes));
    return {
      sourcePath,
      file,
      bytes: bytes.length,
      sha256: sha(bytes),
      archiveSha256: sha(archive),
    };
  });
writeFileSync(
  `${target}/index.json`,
  JSON.stringify({ task: '20.1', createdAt: new Date().toISOString(), files }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ files: files.length, bytes: files.reduce((s, f) => s + f.bytes, 0) }));
