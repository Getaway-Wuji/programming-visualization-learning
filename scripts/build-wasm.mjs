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
  'c-viz-wasm',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--locked',
]);
const output = fileURLToPath(new URL('../web/src/generated', import.meta.url));
mkdirSync(output, { recursive: true });
run(fileURLToPath(new URL('../.tools/wasm-bindgen/bin/wasm-bindgen.exe', import.meta.url)), [
  '--target',
  'web',
  '--out-dir',
  output,
  '--out-name',
  'c_viz_wasm',
  fileURLToPath(
    new URL('../target/wasm32-unknown-unknown/release/c_viz_wasm.wasm', import.meta.url),
  ),
]);
const bytes = readFileSync(new URL('../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url));
const inspection = inspectWasm(bytes);
if (
  inspection.memories.length !== 1 ||
  inspection.memories[0].maximum !== 2048 ||
  inspection.memories[0].shared
) {
  throw new Error('WASM must declare one unshared memory with maximum 2048 pages.');
}
if (
  inspection.imports.some((entry) => /wasi|thread|socket|proc_/i.test(entry.module + entry.name))
) {
  throw new Error('Unexpected WASI/host execution import.');
}
const paths = [
  'package-lock.json',
  'Cargo.lock',
  'web/src/generated/c_viz_wasm.js',
  'web/src/generated/c_viz_wasm_bg.wasm',
];
const hashes = Object.fromEntries(
  paths.map((path) => [
    path,
    createHash('sha256')
      .update(readFileSync(new URL(`../${path}`, import.meta.url)))
      .digest('hex'),
  ]),
);
writeFileSync(
  new URL('../web/src/generated/engine-build.ts', import.meta.url),
  `// Generated from the locked Rust build.\nexport const engineBuild = ${JSON.stringify({ engineVersion: '0.1.0', wasmBytes: bytes.length, wasmSha256: hashes['web/src/generated/c_viz_wasm_bg.wasm'] })} as const;\n`,
);
mkdirSync(new URL('../.artifacts', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../.artifacts/wasm-build.json', import.meta.url),
  JSON.stringify(
    {
      evidenceLevel: 'engineering-build',
      interpreterReady: true,
      executionProtocol: 'EXEC-01 1.0.0',
      supportedExecutionProtocols: ['EXEC-01 1.0.0', 'EXEC-01 1.1.0'],
      supportedVersionVectors: ['1.0.0/1.0.0/1.0.0/1.0.0/1.0.0', '1.1.0/1.0.0/1.0.0/1.1.0/1.0.0'],
      environment,
      ...inspection,
      bytes: bytes.length,
      hashes,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `WASM ${bytes.length} bytes; maximum 2048 pages; build report .artifacts/wasm-build.json`,
);
