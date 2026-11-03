// Verify the reviewed independent package and copy only its bounded public JSON assets.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { c6CourseRelease } from '../../web/src/content/c6-course-release.generated.ts';
import {
  parseC6Chunk,
  parseC6Manifest,
  validateCompleteC6Course,
} from '../../web/src/content/c6-course-validator.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = 'content/c/primer6';
const destination = 'web/public/content/c/primer6';
const manifestBytes = readFileSync(`${source}/${c6CourseRelease.manifestFile}`);
const manifest = await parseC6Manifest(manifestBytes, c6CourseRelease.manifestSha256);
assert.equal(
  sha(readFileSync('web/src/generated/c6/c_viz_c6_bg.wasm')),
  manifest.engineBuildSha256,
);
// The frozen manifest pin authenticates the historical acceptance bindings.
// Local authoring and QA packets are audit records, not production build inputs.
const chunks = [];
const assets = [[c6CourseRelease.manifestFile, manifestBytes]];
for (const entry of manifest.chunks) {
  const bytes = readFileSync(`${source}/${entry.file}`);
  chunks.push(await parseC6Chunk(bytes, manifest, entry.id));
  assets.push([entry.file, bytes]);
}
const result = await validateCompleteC6Course(manifest, chunks);
mkdirSync(destination, { recursive: true });
for (const [file, bytes] of assets) writeFileSync(`${destination}/${file}`, bytes);
console.log(
  JSON.stringify({
    ...result,
    assets: assets.length,
    bytes: assets.reduce((sum, [, bytes]) => sum + bytes.length, 0),
  }),
);
