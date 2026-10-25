import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const source = 'content/c/appearance/config-1.0.1.json';
const bytes = await readFile(new URL(source, root));
const value = JSON.parse(bytes.toString('utf8'));
assert.equal(value.contractVersion, '1.0.0');
assert.equal(value.schemaVersion, '1.0.0');
assert.deepEqual(value.configRef, { id: 'appearance.config.p05', version: '1.0.1' });
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = {
  purpose: 'appearance-configuration',
  contractVersion: '1.0.0',
  schemaVersion: '1.0.0',
  configRef: value.configRef,
  source,
  file: 'content/appearance/config-1.0.1.json',
  bytes: bytes.length,
  sha256,
  load: 'same-reviewed-bytes-bundled-in-application',
};
await mkdir(new URL('web/public/content/appearance/', root), { recursive: true });
await writeFile(new URL(`web/public/${manifest.file}`, root), bytes, { flag: 'wx' }).catch(
  async (error) => {
    if (error.code !== 'EEXIST') throw error;
    assert.deepEqual(
      await readFile(new URL(`web/public/${manifest.file}`, root)),
      bytes,
      'Published appearance configuration is immutable; use a new version.',
    );
  },
);
await writeFile(
  new URL('web/public/content/appearance/manifest.json', root),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  `Appearance configuration ${value.configRef.version}: six fixed profiles; no learning authority.`,
);
