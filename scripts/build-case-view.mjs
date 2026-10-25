// A limited case publication. No course/practice authority or algorithm results.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { initSync, prepare_input } from '../web/src/generated/c_viz_wasm.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root));
const sha = (value) => createHash('sha256').update(value).digest('hex');
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
const sourceBytes = await read('content/c/p0/case-source-1.0.1.json');
const sourceSha256 = sha(sourceBytes);
assert.equal(sourceSha256, 'c3a70258c17a780c5a3a01090dc6af13734b30d09dbb954fa1f7dc20e5e13d77');
const source = JSON.parse(sourceBytes);
assert.equal(source.sourceVersion, '1.0.0');
assert.equal(source.purpose, 'case-view-source');
for (const [path, hash] of Object.entries(source.predecessors))
  assert.equal(sha(await read(path)), hash, 'Published predecessor is immutable');
const previous = JSON.parse(await read('content/c/p0/case-view-1.0.0.json'));
assert.equal(source.catalogs.length, 7);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
initSync({ module: await read('web/src/generated/c_viz_wasm_bg.wasm') });
const templateBindings = {};
for (const [index, catalog] of source.catalogs.entries()) {
  const old = previous.catalogs[index];
  assert.equal(catalog.subject.id, old.subject.id);
  assert.deepEqual(catalog.packageRef, { id: 'content.c.p0', version: '1.0.2' });
  const expected = globalThis.structuredClone(old);
  expected.packageRef.version = '1.0.2';
  if (['case.c.bubble-sort', 'case.c.selection-sort'].includes(catalog.subject.id)) {
    expected.subject.version = '1.0.2';
    expected.subject.acceptedPriorVersions = ['1.0.1'];
    expected.subject.programRef.version = '1.0.1';
    expected.subject.teaching.exampleProgramRefs.forEach((ref) => {
      ref.version = '1.0.1';
    });
    expected.subject.teaching.explanation = expected.subject.teaching.explanation
      .replace(
        '默认[3,1,2]最后为[1,2,3]，输出1 2 3和换行。',
        '默认[7,-3,0,5,-3,2,9]最后为[-3,-3,0,2,5,7,9]，输出-3 -3 0 2 5 7 9和换行。',
      )
      .replace('默认[3,1,2]成为[1,2,3]。', '默认[7,-3,0,5,-3,2,9]成为[-3,-3,0,2,5,7,9]。');
    expected.program.version = '1.0.1';
    expected.program.exampleInput = { values: [7, -3, 0, 5, -3, 2, 9] };
    expected.program.sourceExample = expected.program.sourceExample
      .replace('int n = 3;', 'int n = 7;')
      .replace('int values[3] = {3, 1, 2};', 'int values[7] = {7, -3, 0, 5, -3, 2, 9};');
  }
  assert.deepEqual(catalog, expected, 'Only the reviewed defaults and references may change');
  const packet = JSON.parse(
    decoder.decode(
      prepare_input(
        JSON.stringify(catalog),
        encoder.encode(canonical(catalog.program.exampleInput)),
        1000,
      ),
    ),
  );
  assert.equal(packet.source.text, catalog.program.sourceExample);
  templateBindings[catalog.subject.id] = packet.source.bindingMap;
}
const release = {
  caseViewVersion: '1.0.1',
  purpose: 'case-view',
  capabilities: ['case.view-confirmed'],
  sourceSha256,
  catalogs: source.catalogs,
  templateBindings,
};
const bytes = Buffer.from(JSON.stringify(release, null, 2) + '\n');
const path = 'content/c/p0/case-view-1.0.1.json';
await writeFile(new URL(path, root), bytes, { flag: 'wx' }).catch(async (error) => {
  if (error.code !== 'EEXIST') throw error;
  assert.deepEqual(await read(path), bytes, 'Case publication is immutable');
});
console.log(
  'P0.5-05: seven reviewed case catalogs, two seven-item defaults; declaration preparation only.',
);
