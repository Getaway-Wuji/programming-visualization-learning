// Publish the reviewed build beside the immutable earlier C6 build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { verifyBuildInputs } from '../build-inputs.mjs';
import { checkEnvironment } from '../environment.mjs';
import { run } from '../process.mjs';
import { inspectWasm } from '../wasm-inspect.mjs';

const lock = JSON.parse(readFileSync('content/build/c6-teaching-engine-0.1.0.json', 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, sha256: hash(readFileSync(path)) });
function collect(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return collect(path);
    return /\.(?:rs|json)$/.test(path) || entry.name === 'Cargo.toml' ? [path] : [];
  });
}
const paths = [
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain.toml',
  '.cargo/config.toml',
  'scripts/c6-course/build-teaching-wasm.mjs',
  'scripts/environment.mjs',
  'scripts/process.mjs',
  'scripts/wasm-inspect.mjs',
  ...collect('engine/c6'),
  ...collect('engine/c6-wasm'),
].sort();
assert.equal(lock.formatVersion, 1);
assert.equal(lock.engineId, 'engine.rust.c6');
assert.equal(lock.engineVersion, '0.1.0');
assert.equal(lock.wasmSha256, '804d686bdf75f56ba41970aac199e45c72b805bcb5ac2d0102815bd5236d5069');
assert.equal(lock.wasmBytes, 938812);
assert.deepEqual(
  lock.inputs.map((entry) => entry.path),
  paths,
);
// Shared workspace metadata follows the current product lock. The registered
// C6-only inputs and the published WASM keep their original identities.
verifyBuildInputs();
const workspaceInputs = new Set([
  'Cargo.toml',
  'Cargo.lock',
  'scripts/c6-course/build-teaching-wasm.mjs',
]);
const inputs = paths.map(proof);
const c6Inputs = (rows) => rows.filter(({ path }) => !workspaceInputs.has(path));
assert.deepEqual(c6Inputs(inputs), c6Inputs(lock.inputs));
const previous = [
  'c_viz_wasm_bg.wasm',
  'memory/c_viz_memory_bg.wasm',
  'algorithm/c_viz_algorithm_bg.wasm',
  'advanced/c_viz_advanced_bg.wasm',
  'practice/c_viz_practice_bg.wasm',
  'c6/c_viz_c6_bg.wasm',
].map((file) => proof(`web/src/generated/${file}`));
const folder = 'web/src/generated/c6-teaching';
let environment;
if (!process.argv.includes('--check')) {
  environment = checkEnvironment({ bindgen: true });
  run('cargo', [
    '+1.99.0',
    'build',
    '--package',
    'c-viz-c6-wasm',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
  ]);
  mkdirSync(folder, { recursive: true });
  run(resolve('.tools/wasm-bindgen/bin/wasm-bindgen.exe'), [
    '--target',
    'web',
    '--out-dir',
    resolve(folder),
    '--out-name',
    'c_viz_c6',
    resolve('target/wasm32-unknown-unknown/release/c_viz_c6_wasm.wasm'),
  ]);
}
const bytes = readFileSync(`${folder}/c_viz_c6_bg.wasm`);
assert.equal(hash(bytes), lock.wasmSha256);
assert.equal(bytes.length, lock.wasmBytes);
const inspection = inspectWasm(bytes);
assert.equal(inspection.memories.length, 1);
assert.equal(inspection.memories[0].maximum, 2048);
assert.equal(inspection.memories[0].shared, false);
assert(
  !inspection.imports.some((entry) => /wasi|thread|socket|proc_/i.test(entry.module + entry.name)),
);
assert.deepEqual(paths.map(proof), inputs);
assert.deepEqual(
  previous.map((entry) => proof(entry.path)),
  previous,
);
const metadata = {
  engineId: lock.engineId,
  engineVersion: lock.engineVersion,
  wasmBytes: bytes.length,
  wasmSha256: hash(bytes),
};
const metadataSource = await format(
  `// Generated from the locked C6 teaching interpreter build.\nexport const engineBuild = ${JSON.stringify(metadata)} as const;\n`,
  { ...(await resolveConfig('.prettierrc.json')), parser: 'typescript' },
);
if (process.argv.includes('--check')) {
  assert.equal(readFileSync(`${folder}/engine-build.ts`, 'utf8'), metadataSource);
} else {
  writeFileSync(`${folder}/engine-build.ts`, metadataSource);
  const label =
    process.argv.find((arg) => arg.startsWith('--evidence-label='))?.split('=')[1] ??
    `${Date.now()}-${process.pid}`;
  assert.match(label, /^[a-zA-Z0-9_.-]+$/);
  const evidence = `.artifacts/c6-teaching-build/${label}`;
  assert.equal(existsSync(evidence), false);
  mkdirSync(evidence, { recursive: true });
  writeFileSync(
    `${evidence}/index.json`,
    JSON.stringify(
      {
        environment,
        ...metadata,
        inspection,
        inputs,
        outputs: [
          'c_viz_c6.js',
          'c_viz_c6.d.ts',
          'c_viz_c6_bg.wasm',
          'c_viz_c6_bg.wasm.d.ts',
          'engine-build.ts',
        ].map((file) => proof(`${folder}/${file}`)),
        unchangedEarlierEngines: previous,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
}
console.log(JSON.stringify(metadata));
