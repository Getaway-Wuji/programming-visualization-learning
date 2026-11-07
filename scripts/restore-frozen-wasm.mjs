import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function restoreFrozenWasm({ build, version, prefix, lockHash, output }) {
  const bytes = readFileSync(`content/build/${build}-legacy-runtime-${version}.json`);
  assert.equal(hash(bytes), lockHash);
  const lock = JSON.parse(bytes.toString('utf8'));
  assert.equal(lock.directory, `content/engines/${build}-legacy/${version}`);
  const names = [
    `${prefix}.js`,
    `${prefix}.d.ts`,
    `${prefix}_bg.wasm`,
    `${prefix}_bg.wasm.d.ts`,
    'engine-build.ts',
  ];
  assert.deepEqual(
    lock.files.map((entry) => entry.file),
    names,
  );
  mkdirSync(output, { recursive: true });
  for (const entry of lock.files) {
    const source = readFileSync(`${lock.directory}/${entry.file}`);
    assert.equal(source.length, entry.bytes);
    assert.equal(hash(source), entry.sha256);
    const target = `${output}/${entry.file}`;
    if (!existsSync(target) || hash(readFileSync(target)) !== entry.sha256)
      writeFileSync(target, source);
  }
  console.log(`Frozen ${build} runtime verified for legacy content.`);
}
