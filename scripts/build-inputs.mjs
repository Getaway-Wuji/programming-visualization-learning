import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const lockPath = new URL('content/build/source-lock.json', root);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => readFileSync(new URL(path, root));
const productPath = (path) =>
  (/^(?:content|engine|server|shared|scripts|web\/src)\//.test(path) ||
    /^(?:package(?:-lock)?\.json|Cargo\.(?:toml|lock)|rust-toolchain\.toml|vite\.config\.ts|\.cargo\/config\.toml)$/.test(
      path,
    )) &&
  path !== 'content/build/source-lock.json' &&
  !path.startsWith('web/src/generated/') &&
  !/\.generated\./.test(path);

function sourceFiles() {
  return [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: fileURLToPath(root),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      })
        .split('\0')
        .filter((path) => productPath(path) && existsSync(new URL(path, root))),
    ),
  ].sort();
}

export function verifyBuildInputs() {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(lock.formatVersion, 1);
  assert.ok(lock.files.length > 0);
  const paths = lock.files.map((entry) => entry.path);
  assert.deepEqual(paths, [...new Set(paths)].sort());
  assert.deepEqual(
    paths,
    sourceFiles(),
    'Product source list changed; update lock:build after review.',
  );
  for (const entry of lock.files) {
    assert.ok(productPath(entry.path) && !entry.path.split('/').includes('..'));
    assert.equal(hash(read(entry.path)), entry.sha256, `Build input changed: ${entry.path}`);
  }
  console.log(`Product build inputs: ${lock.files.length} source hashes verified.`);
  return lock;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    const releases = readdirSync(new URL('content/c/p0/', root))
      .map((name) => /^blockly-release-(1\.0\.(\d+))\.json$/.exec(name))
      .filter(Boolean)
      .sort((a, b) => Number(b[2]) - Number(a[2]));
    const lock = {
      formatVersion: 1,
      releaseVersion: releases[0][1],
      files: sourceFiles().map((path) => ({ path, sha256: hash(read(path)) })),
    };
    mkdirSync(new URL('content/build/', root), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Recorded ${lock.files.length} product build inputs for ${lock.releaseVersion}.`);
  } else verifyBuildInputs();
}
