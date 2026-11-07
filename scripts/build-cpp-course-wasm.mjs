import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { checkEnvironment } from './environment.mjs';
import { run, workspaceDir } from './process.mjs';
import { inspectWasm } from './wasm-inspect.mjs';

checkEnvironment({ bindgen: true });
const output = 'web/src/generated/cpp-course';
mkdirSync(output, { recursive: true });
const remap = [
  [resolve(workspaceDir), '/project'],
  [resolve(process.env.CARGO_HOME || resolve(homedir(), '.cargo')), '/cargo'],
].flatMap(([from, to]) =>
  [...new Set([from, from.replaceAll('\\', '/')])].map(
    (path) => `--remap-path-prefix=${path}=${to}`,
  ),
);
run('cargo', [
  '+1.99.0',
  '--config',
  'target.wasm32-unknown-unknown.rustflags=' + JSON.stringify(remap),
  'build',
  '--locked',
  '--package',
  'c-viz-cpp-course-wasm',
  '--target-dir',
  'target/cpp-course',
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
  'c_viz_cpp_course',
  resolve('target/cpp-course/wasm32-unknown-unknown/release/c_viz_cpp_course_wasm.wasm'),
]);
const bytes = readFileSync(output + '/c_viz_cpp_course_bg.wasm');
const info = inspectWasm(bytes);
assert.equal(info.memories.length, 1);
assert.equal(info.memories[0].maximum, 2048);
assert.equal(info.memories[0].shared, false);
assert(!info.imports.some(({ module, name }) => /wasi|thread|socket|proc_/i.test(module + name)));
const build = {
  wasmBytes: bytes.length,
  wasmSha256: createHash('sha256').update(bytes).digest('hex'),
};
const lock = 'content/build/cpp-course-engine-0.1.0.json';
if (process.argv.includes('--record')) {
  writeFileSync(lock, JSON.stringify(build, null, 2) + '\n');
} else {
  assert.deepEqual(build, JSON.parse(readFileSync(lock, 'utf8')));
}
writeFileSync(
  output + '/engine-build.ts',
  'export const cppCourseBuild = ' + JSON.stringify(build) + ' as const;\n',
);
console.log(JSON.stringify(build));
