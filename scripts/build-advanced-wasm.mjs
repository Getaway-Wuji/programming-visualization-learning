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
  'c-viz-advanced-wasm',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--locked',
]);
const folder = new URL('../web/src/generated/advanced/', import.meta.url);
mkdirSync(folder, { recursive: true });
run(fileURLToPath(new URL('../.tools/wasm-bindgen/bin/wasm-bindgen.exe', import.meta.url)), [
  '--target',
  'web',
  '--out-dir',
  fileURLToPath(folder),
  '--out-name',
  'c_viz_advanced',
  fileURLToPath(
    new URL('../target/wasm32-unknown-unknown/release/c_viz_advanced_wasm.wasm', import.meta.url),
  ),
]);
const bytes = readFileSync(new URL('c_viz_advanced_bg.wasm', folder));
const inspection = inspectWasm(bytes);
if (
  inspection.memories.length !== 1 ||
  inspection.memories[0].maximum !== 2048 ||
  inspection.memories[0].shared
)
  throw new Error('P1 WASM must have one unshared advanced bounded to 2048 pages.');
if (inspection.imports.some((entry) => /wasi|thread|socket|proc_/i.test(entry.module + entry.name)))
  throw new Error('Unexpected host execution import.');
const wasmSha256 = createHash('sha256').update(bytes).digest('hex');
const metadata = {
  engineId: 'engine.rust.advanced',
  engineVersion: '0.1.0',
  wasmBytes: bytes.length,
  wasmSha256,
};
writeFileSync(
  new URL('engine-build.ts', folder),
  `// Generated from the locked P1 advanced build.\nexport const engineBuild = ${JSON.stringify(metadata)} as const;\n`,
);
const evidenceTask = process.env.TASK_EVIDENCE_TASK ?? 'current';
mkdirSync(new URL(`../.artifacts/${evidenceTask}/`, import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../.artifacts/${evidenceTask}/advanced-wasm-build.json`, import.meta.url),
  JSON.stringify(
    {
      environment,
      ...metadata,
      ...inspection,
      versions: { exec: '1.4.0', step: '1.3.0', diagnostic: '1.3.0', integer: '1.0.0' },
    },
    null,
    2,
  ) + '\n',
);
console.log(`P1 advanced WASM ${bytes.length} bytes; maximum 2048 pages; ${wasmSha256}`);
