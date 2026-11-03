// Build-time compilation: the browser never uses eval or Function to validate content.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { format, resolveConfig } from 'prettier';
import { c6ManifestSchema, c6ChunkSchema } from '../../web/src/content/c6-course-schema.mjs';

const ajv = new Ajv({
  strict: true,
  allErrors: false,
  ownProperties: true,
  code: { source: true, esm: true },
});
ajv.addSchema(c6ManifestSchema, 'manifest');
ajv.addSchema(c6ChunkSchema, 'chunk');
const raw = standaloneCode(ajv, { manifestSchema: 'manifest', chunkSchema: 'chunk' });
const source = await format(
  `/* eslint-disable */\n// Generated at build time from the closed CONTENT2 schema.\nimport ucs2length from 'ajv/dist/runtime/ucs2length.js';\n${raw.replaceAll('require("ajv/dist/runtime/ucs2length").default', '(ucs2length.default ?? ucs2length)')}`,
  { ...(await resolveConfig('.prettierrc.json')), parser: 'babel' },
);
const path = 'web/src/content/c6-course-schema.generated.mjs';
if (process.argv.includes('--check')) {
  assert.ok(existsSync(path));
  assert.equal(readFileSync(path, 'utf8'), source);
} else writeFileSync(path, source);
console.log('C6 CONTENT2 standalone schema verified.');
