// Compile the independent CONTENT3 contracts; no runtime schema compilation.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { format, resolveConfig } from 'prettier';
import {
  c6TeachingManifestSchema,
  c6TeachingChunkSchema,
  c6TeachingSourceSchema,
} from '../../web/src/content/c6-teaching-schema.mjs';

const ajv = new Ajv({
  strict: true,
  allErrors: false,
  ownProperties: true,
  code: { source: true, esm: true },
});
ajv.addSchema(c6TeachingManifestSchema, 'teachingManifest');
ajv.addSchema(c6TeachingChunkSchema, 'teachingChunk');
ajv.addSchema(c6TeachingSourceSchema, 'teachingSource');
const raw = standaloneCode(ajv, {
  teachingManifestSchema: 'teachingManifest',
  teachingChunkSchema: 'teachingChunk',
  teachingSourceSchema: 'teachingSource',
});
const source = await format(
  `/* eslint-disable */\n// Generated from the independent closed CONTENT3 schema.\nimport ucs2length from 'ajv/dist/runtime/ucs2length.js';\n${raw.replaceAll('require("ajv/dist/runtime/ucs2length").default', '(ucs2length.default ?? ucs2length)')}`,
  { ...(await resolveConfig('.prettierrc.json')), parser: 'babel' },
);
const path = 'web/src/content/c6-teaching-schema.generated.mjs';
if (process.argv.includes('--check')) {
  assert.ok(existsSync(path));
  assert.equal(readFileSync(path, 'utf8'), source);
} else writeFileSync(path, source);
// The browser needs the small directory validator before any chapter is read.
// Compile each entry from the same schemas without changing validation rules.
for (const [name, id] of Object.entries({
  teachingManifestSchema: 'teachingManifest',
  teachingChunkSchema: 'teachingChunk',
  teachingSourceSchema: 'teachingSource',
})) {
  const code = standaloneCode(ajv, { [name]: id });
  const split = await format(
    `/* eslint-disable */\n// Generated from the independent closed CONTENT3 schema.\nimport ucs2length from 'ajv/dist/runtime/ucs2length.js';\n${code.replaceAll('require("ajv/dist/runtime/ucs2length").default', '(ucs2length.default ?? ucs2length)')}`,
    { ...(await resolveConfig('.prettierrc.json')), parser: 'babel' },
  );
  const entry = `web/src/content/c6-teaching-${id.slice('teaching'.length).toLowerCase()}.generated.mjs`;
  if (process.argv.includes('--check')) assert.equal(readFileSync(entry, 'utf8'), split);
  else writeFileSync(entry, split);
}
console.log('C6 CONTENT3 standalone schema verified.');
