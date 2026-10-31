// Fail before tool installation if a frozen build receipt was omitted from Git.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = '项目文档/验收/发布凭据';
const tracked = new Set(
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0'),
);
const read = (path) => {
  assert.ok(tracked.has(path), `Required release input is not tracked: ${path}`);
  return readFileSync(new URL(`../${path}`, import.meta.url));
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let archives = 0;
let receipts = 0;
for (const directory of readdirSync(new URL(`../${base}/`, import.meta.url), {
  withFileTypes: true,
})) {
  if (!directory.isDirectory()) continue;
  const folder = `${base}/${directory.name}`;
  const index = JSON.parse(
    read(`${folder}/index.json`)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
  assert.equal(hash(read(index.registration.path)), index.registration.sha256);
  for (const entry of index.files) {
    assert.match(entry.file, /^[A-Za-z0-9_.-]+$/);
    assert.notEqual(entry.file, '.');
    assert.notEqual(entry.file, '..');
    const path = `${folder}/${entry.file}`;
    assert.equal(hash(read(path)), entry.sha256, `Release receipt changed: ${path}`);
    receipts++;
  }
  archives++;
}
assert.ok(archives > 0, 'No release archives found.');
console.log(`Committed release archives: ${archives} indexes / ${receipts} receipts verified.`);
