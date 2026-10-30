// Independent P1 crate; the reviewed P0 engine remains byte-for-byte intact.
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
  'c-viz-algorithm-wasm',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--locked',
]);
const folder = new URL('../web/src/generated/algorithm/', import.meta.url);
mkdirSync(folder, { recursive: true });
run(fileURLToPath(new URL('../.tools/wasm-bindgen/bin/wasm-bindgen.exe', import.meta.url)), [
  '--target',
  'web',
  '--out-dir',
  fileURLToPath(folder),
  '--out-name',
  'c_viz_algorithm',
  fileURLToPath(
    new URL('../target/wasm32-unknown-unknown/release/c_viz_algorithm_wasm.wasm', import.meta.url),
  ),
]);
const bytes = readFileSync(new URL('c_viz_algorithm_bg.wasm', folder));
const inspection = inspectWasm(bytes);
if (
  inspection.memories.length !== 1 ||
  inspection.memories[0].maximum !== 2048 ||
  inspection.memories[0].shared
)
  throw new Error('P1 WASM must have one unshared memory bounded to 2048 pages.');
if (inspection.imports.some((entry) => /wasi|thread|socket|proc_/i.test(entry.module + entry.name)))
  throw new Error('Unexpected host execution import.');
const wasmSha256 = createHash('sha256').update(bytes).digest('hex');
const metadata = {
  engineId: 'engine.rust.p1',
  engineVersion: '0.1.0',
  wasmBytes: bytes.length,
  wasmSha256,
};
writeFileSync(
  new URL('engine-build.ts', folder),
  `// Generated from the locked P1 algorithm build.\nexport const engineBuild = ${JSON.stringify(metadata)} as const;\n`,
);
mkdirSync(new URL('../.artifacts/12.1/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../.artifacts/12.1/wasm-build.json', import.meta.url),
  JSON.stringify(
    {
      environment,
      ...metadata,
      ...inspection,
      versions: { exec: '1.2.0', step: '1.1.0', diagnostic: '1.1.0', integer: '1.0.0' },
    },
    null,
    2,
  ) + '\n',
);
console.log(`P1 algorithm WASM ${bytes.length} bytes; maximum 2048 pages; ${wasmSha256}`);
