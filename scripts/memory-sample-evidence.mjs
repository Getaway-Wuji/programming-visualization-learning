// Fixed public QA source and input only; this script never records learner data.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { initSync, execute_memory } from '../web/src/generated/memory/c_viz_memory.js';

const label = process.argv[2];
assert.match(label ?? '', /^[A-Za-z0-9_.-]+$/);
const destination = `.artifacts/12.2/public-samples-${label}.json`;
assert.equal(existsSync(destination), false);
const metadata = JSON.parse(readFileSync('.artifacts/12.2/wasm-build.json', 'utf8'));
const wasm = initSync({
  module: new WebAssembly.Module(readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm')),
});
const source = (name) => readFileSync(`shared/fixtures/memory/${name}`, 'utf8');
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
const examples = [
  ['c-pointers', source('pointers.c'), 'c', [], '9 6\n', null],
  ['c-edited', source('pointers.c').replace('set(p, 9)', 'set(p, 7)'), 'c', [], '7 6\n', null],
  ['c-dangling', source('dangling.c'), 'c', [], '', 'E_DANGLING_POINTER'],
  ['c-null', 'int main(){int* p=0;return *p;}', 'c', [], '', 'E_NULL_POINTER'],
  ['list-a', source('list.cpp'), 'cpp', [4, 2, 9], '4 2 9 \n4 9 \n', null],
  ['list-b', source('list.cpp'), 'cpp', [0, 0, 0], '0 0 0 \n0 0 \n', null],
  ['tree-empty', source('tree.cpp'), 'cpp', [0], '\n', null],
  ['tree-five', source('tree.cpp'), 'cpp', [5, 3, 1, 4, 1, 5], '1 1 3 4 5 \n', null],
  [
    'tree-edited',
    source('tree.cpp').replace('value < root->value', 'value > root->value'),
    'cpp',
    [3, 1, 3, 2],
    '3 2 1 \n',
    null,
  ],
  ['buckets-six', source('buckets.cpp'), 'cpp', [6, 8, 1, 4, 0, 3, 7], '0 1 3 4 7 8 \n', null],
  ['buckets-empty', source('buckets.cpp'), 'cpp', [0], '\n', null],
  [
    'deleted-alias',
    'int main(){int* p=new int{};delete p;return *p;}',
    'cpp',
    [],
    '',
    'E_DANGLING_POINTER',
  ],
  [
    'double-delete',
    'int main(){int* p=new int{};delete p;delete p;return 0;}',
    'cpp',
    [],
    '',
    'E_DOUBLE_DELETE',
  ],
  [
    'field-one-past',
    'struct Pair{int a;int b;};int main(){Pair p{};int* q=&p.a;q=q+1;return *q;}',
    'cpp',
    [],
    '',
    'E_POINTER_BOUNDS',
  ],
];
const reports = [];
for (const [name, text, language, input, expected, code] of examples) {
  const request = {
    execVersion: '1.3.0',
    dslVersion: '1.2.0',
    diagnosticVersion: '1.2.0',
    integerEncoding: '1.0.0',
    language,
    engineId: 'engine.rust.memory',
    runId: name,
    sourceRevision: 'public.1',
    source: text,
    input,
  };
  const start = performance.now();
  const bytes = execute_memory(
    new TextEncoder().encode(canonical(request)),
    metadata.wasmSha256,
    1000,
  );
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const result = JSON.parse(raw);
  const canonicalBytes = raw === canonical(result);
  const output =
    result.trace?.steps
      .flatMap((step) => step.changes)
      .filter((change) => change.op === 'output')
      .map((change) => change.append)
      .join('') ?? '';
  reports.push({
    name,
    request,
    result,
    canonicalBytes,
    rustCallMs: performance.now() - start,
    bytes: bytes.length,
    wasmPages: wasm.memory.buffer.byteLength / 65536,
  });
  console.log(`${name}: ${result.terminal.status}/${result.terminal.code ?? 'ok'}`);
  if (
    !canonicalBytes ||
    result.terminal.code !== code ||
    (!code && result.terminal.status !== 'completed') ||
    output !== expected
  ) {
    writeFileSync(
      destination,
      JSON.stringify({ accepted: false, buildId: metadata.wasmSha256, reports }) + '\n',
      { flag: 'wx' },
    );
    assert.fail(`Unexpected real result for ${name}`);
  }
}
writeFileSync(
  destination,
  JSON.stringify({ accepted: true, buildId: metadata.wasmSha256, reports }) + '\n',
  { flag: 'wx' },
);
console.log(`${reports.length} genuine memory runs matched public expectations.`);
