import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkEnvironment } from './environment.mjs';
import { run } from './process.mjs';
import { inspectWasm } from './wasm-inspect.mjs';
const environment = checkEnvironment({ bindgen: true });
run('cargo', [
  '+1.99.0',
  'build',
  '--package',
  'c-viz-practice-generator-wasm',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--locked',
]);
const folder = new URL('../web/src/generated/practice/', import.meta.url);
mkdirSync(folder, { recursive: true });
run(fileURLToPath(new URL('../.tools/wasm-bindgen/bin/wasm-bindgen.exe', import.meta.url)), [
  '--target',
  'web',
  '--out-dir',
  fileURLToPath(folder),
  '--out-name',
  'c_viz_practice',
  fileURLToPath(
    new URL(
      '../target/wasm32-unknown-unknown/release/c_viz_practice_generator_wasm.wasm',
      import.meta.url,
    ),
  ),
]);
const bytes = readFileSync(new URL('c_viz_practice_bg.wasm', folder)),
  inspection = inspectWasm(bytes);
if (
  inspection.memories.length !== 1 ||
  inspection.memories[0].maximum !== 2048 ||
  inspection.memories[0].shared ||
  inspection.imports.some((e) => /wasi|thread|socket|proc_/i.test(e.module + e.name))
)
  throw new Error('Unexpected practice generator memory/host imports');
const metadata = {
  engineId: 'engine.rust.practice-generator',
  engineVersion: '1.0.0',
  wasmBytes: bytes.length,
  wasmSha256: createHash('sha256').update(bytes).digest('hex'),
};
writeFileSync(
  new URL('engine-build.ts', folder),
  `// Generated from the locked practice generator build.\nexport const engineBuild = ${JSON.stringify(metadata)} as const;\n`,
);
const task = process.env.TASK_EVIDENCE_TASK ?? 'current';
mkdirSync(new URL(`../.artifacts/${task}/`, import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../.artifacts/${task}/practice-wasm-build.json`, import.meta.url),
  JSON.stringify({ environment, ...metadata, ...inspection }, null, 2) + '\n',
);
console.log(`Practice generator WASM ${bytes.length} bytes; ${metadata.wasmSha256}`);
