import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = readFileSync('content/build/c6-legacy-runtime-0.1.0.json');
assert.equal(hash(bytes), '5dcfd772aa3c388523ffe4898b2b18ef1090064ed0ea0e6ff3955356fe4dbdf5');
const lock = JSON.parse(bytes.toString('utf8'));
assert.equal(lock.directory, 'content/engines/c6-legacy/0.1.0');
const output = 'web/src/generated/c6';
mkdirSync(output, { recursive: true });
for (const entry of lock.files) {
  assert.match(
    entry.file,
    /^(?:c_viz_c6(?:_bg\.wasm)?\.(?:js|d\.ts)|c_viz_c6_bg\.wasm|engine-build\.ts)$/,
  );
  const source = readFileSync(`${lock.directory}/${entry.file}`);
  assert.equal(source.length, entry.bytes);
  assert.equal(hash(source), entry.sha256);
  const target = `${output}/${entry.file}`;
  if (existsSync(target))
    assert.equal(
      hash(readFileSync(target)),
      entry.sha256,
      'Refuse to replace a different runtime with the frozen legacy build.',
    );
  else writeFileSync(target, source);
}
console.log('Frozen pre-CONTENT3 C6 runtime verified; missing generated files restored.');
