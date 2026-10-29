import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const source = 'content/c/presentation/teaching-presentation-1.0.0.json';
const bytes = await readFile(new URL(source, root));
const value = JSON.parse(bytes.toString('utf8'));
assert.equal(value.contractVersion, '1.0.0');
assert.equal(value.schemaVersion, '1.0.0');
assert.deepEqual(value.configRef, { id: 'teaching.presentation.c.p05', version: '1.0.0' });
const manifest = {
  purpose: 'teaching-presentation',
  contractVersion: '1.0.0',
  schemaVersion: '1.0.0',
  configRef: value.configRef,
  source,
  file: 'content/presentation/teaching-presentation-1.0.0.json',
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  load: 'same-reviewed-bytes-bundled-in-application',
};
await mkdir(new URL('web/public/content/presentation/', root), { recursive: true });
await writeFile(new URL(`web/public/${manifest.file}`, root), bytes, { flag: 'wx' }).catch(
  async (error) => {
    if (error.code !== 'EEXIST') throw error;
    assert.deepEqual(await readFile(new URL(`web/public/${manifest.file}`, root)), bytes);
  },
);
await writeFile(
  new URL('web/public/content/presentation/manifest.json', root),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log('Teaching presentation 1.0.0: exact course recommendations, no learning authority.');
