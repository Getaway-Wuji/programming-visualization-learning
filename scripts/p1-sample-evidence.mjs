// Only fixed public QA programs are recorded here, never learner input.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { initSync, execute_algorithm } from '../web/src/generated/algorithm/c_viz_algorithm.js';

const label = process.argv[2];
assert.match(label ?? '', /^[A-Za-z0-9_.-]+$/);
const destination = `.artifacts/12.1/public-samples-${label}.json`;
assert.equal(existsSync(destination), false);
const metadata = JSON.parse(readFileSync('.artifacts/12.1/wasm-build.json', 'utf8'));
const wasm = initSync({
  module: new WebAssembly.Module(
    readFileSync('web/src/generated/algorithm/c_viz_algorithm_bg.wasm'),
  ),
});
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const source = (name) => readFileSync(`shared/fixtures/p1/${name}`, 'utf8');
const quick30 = source('quicksort.cpp')
  .replace('a[5]', 'a[30]')
  .replaceAll('i < 5', 'i < 30')
  .replace('quicksort(a, 0, 4)', 'quicksort(a, 0, 29)');
const examples = [
  ['c-functions', source('functions.c'), 'c', [], '5 99 120\n'],
  ['c-edited', source('functions.c').replace('int n = 5;', 'int n = 4;'), 'c', [], '4 99 24\n'],
  ['hanoi-empty', source('hanoi.cpp'), 'cpp', [0], ''],
  ['hanoi-one', source('hanoi.cpp'), 'cpp', [1], '1->3\n'],
  ['hanoi-three', source('hanoi.cpp'), 'cpp', [3], '1->3\n1->2\n3->2\n1->3\n2->1\n2->3\n1->3\n'],
  ['quick-five', source('quicksort.cpp'), 'cpp', [5, 1, 4, 1, -2], '-2 1 1 4 5 \n'],
  ...[
    Array.from({ length: 30 }, (_, i) => i),
    Array.from({ length: 30 }, (_, i) => 29 - i),
    Array(30).fill(4),
  ].map((input, i) => [
    `quick-thirty-${i}`,
    quick30,
    'cpp',
    input,
    [...input].sort((a, b) => a - b).join(' ') + ' \n',
  ]),
];
const reports = [];
for (const [name, text, language, input, expected] of examples) {
  console.log(`Public sample ${name}`);
  const request = {
    execVersion: '1.2.0',
    dslVersion: '1.1.0',
    diagnosticVersion: '1.1.0',
    integerEncoding: '1.0.0',
    language,
    engineId: 'engine.rust.p1',
    runId: name,
    sourceRevision: 'public.1',
    source: text,
    input,
  };
  const start = performance.now();
  const bytes = execute_algorithm(
    new TextEncoder().encode(canonical(request)),
    metadata.wasmSha256,
    1000,
  );
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const rustCallMs = performance.now() - start;
  const output = result.trace?.steps
    .flatMap((step) => step.changes)
    .filter((change) => change.op === 'output')
    .map((change) => change.append)
    .join('');
  reports.push({
    name,
    request,
    result,
    rustCallMs,
    bytes: bytes.length,
    wasmPages: wasm.memory.buffer.byteLength / 65536,
  });
  if (result.terminal.status !== 'completed' || output !== expected) {
    writeFileSync(
      destination,
      JSON.stringify({ accepted: false, buildId: metadata.wasmSha256, reports }) + '\n',
      { flag: 'wx' },
    );
    assert.fail(`${name}: ${result.terminal.status}/${result.terminal.code} or unexpected output`);
  }
}
writeFileSync(
  destination,
  JSON.stringify({ accepted: true, buildId: metadata.wasmSha256, reports }) + '\n',
  { flag: 'wx' },
);
console.log(
  `${reports.length} real-WASM public sample outputs match; original source and full results available for schema validation.`,
);
