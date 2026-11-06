import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import standalone from 'ajv/dist/standalone/index.js';
import { checkEnvironment } from './environment.mjs';
import { run } from './process.mjs';
import { inspectWasm } from './wasm-inspect.mjs';
import {
  python3RequestSchema,
  python3ResponseSchema,
} from '../shared/contracts/python3-execution.mjs';

checkEnvironment({ bindgen: true });
const output = 'web/src/generated/python3';
mkdirSync(output, { recursive: true });
run('cargo', [
  '+1.99.0',
  'build',
  '--locked',
  '--manifest-path',
  'engine/python3/Cargo.toml',
  '--target-dir',
  'target/python3',
  '--package',
  'c-viz-python3-wasm',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
]);
run(resolve('.tools/wasm-bindgen/bin/wasm-bindgen.exe'), [
  '--target',
  'web',
  '--out-dir',
  resolve(output),
  '--out-name',
  'c_viz_python3',
  resolve('target/python3/wasm32-unknown-unknown/release/c_viz_python3_wasm.wasm'),
]);
const bytes = readFileSync(output + '/c_viz_python3_bg.wasm');
const info = inspectWasm(bytes);
assert.equal(info.memories.length, 1);
assert.equal(info.memories[0].maximum, 2048);
assert.equal(info.memories[0].shared, false);
assert(!info.imports.some(({ module, name }) => /wasi|thread|socket|proc_/i.test(module + name)));
const build = {
  wasmBytes: bytes.length,
  wasmSha256: createHash('sha256').update(bytes).digest('hex'),
};
const lock = 'content/build/python3-engine-0.1.0.json';
if (process.argv.includes('--record')) {
  writeFileSync(lock, JSON.stringify(build, null, 2) + '\n');
} else {
  assert.deepEqual(build, JSON.parse(readFileSync(lock, 'utf8')));
}
writeFileSync(
  output + '/engine-build.ts',
  'export const python3Build = ' + JSON.stringify(build) + ' as const;\n',
);

const ajv = new Ajv({ strict: true, ownProperties: true, code: { source: true, esm: true } });
ajv.addSchema(python3RequestSchema, 'python3Request');
ajv.addSchema(python3ResponseSchema, 'python3Response');
const code = standalone(ajv, {
  validateRequest: 'python3Request',
  validateResponse: 'python3Response',
});
writeFileSync(
  output + '/protocol.mjs',
  'import ucs2length from "ajv/dist/runtime/ucs2length.js";\n' +
    code.replaceAll(
      'require("ajv/dist/runtime/ucs2length").default',
      '(ucs2length.default ?? ucs2length)',
    ),
);
writeFileSync(
  output + '/protocol.d.mts',
  'export function validateRequest(value: unknown): boolean;\nexport function validateResponse(value: unknown): boolean;\n',
);
console.log(JSON.stringify(build));
