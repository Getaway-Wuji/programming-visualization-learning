// Build-time preparation of public input declarations, never algorithm execution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { initSync, prepare_input } from '../web/src/generated/c_viz_wasm.js';

const root = new URL('../', import.meta.url);
const sourceSha256 = '713133313e65ba9ea000daa18d5feaea84beeb65f296b8102edc5de114fa2611';
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
const entityRef = ({ id, version }) => ({ id, version });
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const sameRef = (left, right) => left.id === right.id && left.version === right.version;

const caseBytes = await readFile(new URL('content/c/p0/case-view-1.0.1.json', root));
const caseView = JSON.parse(decoder.decode(caseBytes));
assert.equal(caseView.caseViewVersion, '1.0.1');
assert.equal(caseView.purpose, 'case-view');
assert.deepEqual(caseView.capabilities, ['case.view-confirmed']);
assert.equal(
  caseView.sourceSha256,
  'c3a70258c17a780c5a3a01090dc6af13734b30d09dbb954fa1f7dc20e5e13d77',
);
assert.equal(caseView.catalogs.length, 7);

const practiceManifestBytes = await readFile(
  new URL('web/public/content/practice/manifest.json', root),
);
const practiceManifest = JSON.parse(decoder.decode(practiceManifestBytes));
assert.equal(practiceManifest.practiceVersion, '1.0.0');
assert.equal(practiceManifest.sourceSha256, sourceSha256);
assert.equal(practiceManifest.file, 'content/practice/course-practice-1.0.0.json');
const practiceBytes = await readFile(new URL(`web/public/${practiceManifest.file}`, root));
assert.equal(practiceBytes.length, practiceManifest.bytes);
assert.equal(sha(practiceBytes), practiceManifest.sha256);
const practice = JSON.parse(decoder.decode(practiceBytes));
assert.equal(practice.practiceVersion, '1.0.0');
assert.equal(practice.sourceSha256, sourceSha256);
assert.equal(practice.exercises.length, 6);
const practiceCatalogs = practice.exercises.map((subject) => {
  const program = practice.programs.find((entry) => sameRef(entry, subject.programRef));
  assert.ok(program);
  const inputSpec = practice.inputSpecs.find((entry) => sameRef(entry, program.inputRef));
  const judgeProfile = practice.judgeProfiles.find((entry) => sameRef(entry, subject.judgeRef));
  assert.ok(inputSpec && judgeProfile);
  return { packageRef: practice.packageRef, subject, program, inputSpec, judgeProfile };
});
const catalogs = [...caseView.catalogs, ...practiceCatalogs];
assert.equal(catalogs.length, 13);
assert.equal(new Set(catalogs.map((entry) => entry.subject.id)).size, 13);
assert.equal(new Set(catalogs.map((entry) => entry.program.id)).size, 10);
for (const catalog of catalogs) {
  assert.deepEqual(catalog.packageRef, {
    id: 'content.c.p0',
    version: catalog.subject.id.startsWith('case.') ? '1.0.2' : '1.0.1',
  });
  assert.ok(sameRef(catalog.subject.programRef, catalog.program));
  assert.ok(sameRef(catalog.program.inputRef, catalog.inputSpec));
  assert.ok(encoder.encode(canonical(catalog)).length <= 65536);
}

// This independent build process is allowed to compile/instantiate the producer.
// No product ModuleStore is imported, populated or prewarmed by this script.
const wasmBytes = await readFile(new URL('web/src/generated/c_viz_wasm_bg.wasm', root));
initSync({ module: wasmBytes });
const entries = [];
for (const catalog of catalogs) {
  const packet = prepare_input(
    JSON.stringify(catalog),
    encoder.encode(canonical(catalog.program.exampleInput)),
    1000,
  );
  assert.ok(packet.byteLength <= 65536);
  const prepared = JSON.parse(decoder.decode(packet));
  assert.deepEqual(Object.keys(prepared), ['source']);
  const template = prepared.source;
  assert.deepEqual(Object.keys(template).sort(), ['bindingMap', 'blockMap', 'text']);
  assert.equal(typeof template.text, 'string');
  assert.ok(Array.isArray(template.blockMap));
  assert.ok(encoder.encode(template.text).length <= 32768);
  assert.equal(template.bindingMap.length, catalog.program.bindings.length);
  assert.equal(
    new Set(template.bindingMap.map((entry) => entry.bindingKey)).size,
    template.bindingMap.length,
  );
  let previous = 0;
  const bytes = encoder.encode(template.text);
  for (const binding of template.bindingMap) {
    assert.ok(catalog.program.bindings.some((entry) => entry.bindingKey === binding.bindingKey));
    const { start, end } = binding.byteRange;
    assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end));
    assert.ok(start >= previous && end > start && end <= bytes.length);
    decoder.decode(bytes.subarray(0, start));
    decoder.decode(bytes.subarray(start, end));
    decoder.decode(bytes.subarray(end));
    previous = end;
  }
  const blockIds = new Set();
  for (const block of template.blockMap) {
    assert.deepEqual(Object.keys(block).sort(), ['blockId', 'byteRange']);
    assert.ok(/^control-(if|while|for)-[1-9][0-9]*$/.test(block.blockId));
    assert.ok(!blockIds.has(block.blockId));
    blockIds.add(block.blockId);
    const { start, end } = block.byteRange;
    assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end));
    assert.ok(start >= 0 && end > start && end <= bytes.length);
    decoder.decode(bytes.subarray(0, start));
    decoder.decode(bytes.subarray(start, end));
    decoder.decode(bytes.subarray(end));
  }
  entries.push({
    catalogSha256: sha(canonical(catalog)),
    packageRef: entityRef(catalog.packageRef),
    subjectRef: entityRef(catalog.subject),
    programRef: entityRef(catalog.program),
    inputSpecRef: entityRef(catalog.inputSpec),
    sourceSha256: sha(catalog.program.sourceExample),
    templateSha256: sha(canonical(template)),
    template,
  });
}
const manifest = { preparationVersion: '1.0.0', protocolVersion: '1.0.0', entries };
const generated = await format(
  '// Generated by real Rust prepare_input from the 7 published cases and 6 published exercises.\n' +
    '// Public declaration templates only; no execution results or user data.\n' +
    "import type { PreparedSourceManifest } from '../engine/prepared-source';\n" +
    `export const preparedSourceManifest: PreparedSourceManifest = ${JSON.stringify(manifest)};\n`,
  { parser: 'typescript', singleQuote: true, printWidth: 100 },
);
await writeFile(new URL('web/src/generated/prepared-sources.ts', root), generated);
const report = new URL(
  process.env.PREPARED_SOURCE_REPORT ?? '.artifacts/prepared-source-build.json',
  root,
);
assert.ok(report.href.startsWith(new URL('.artifacts/', root).href));
await mkdir(new URL('.', report), { recursive: true });
await writeFile(
  report,
  JSON.stringify(
    {
      evidenceLevel: 'build-time-real-rust-input-preparation',
      algorithmExecution: false,
      userData: false,
      publicCatalogs: entries.length,
      programs: 10,
      producerWasmSha256: sha(wasmBytes),
      sources: {
        'content/c/p0/case-view-1.0.1.json': sha(caseBytes),
        'web/public/content/practice/manifest.json': sha(practiceManifestBytes),
        [practiceManifest.file]: sha(practiceBytes),
      },
      generatedSha256: sha(generated),
    },
    null,
    2,
  ) + '\n',
  { flag: process.env.PREPARED_SOURCE_REPORT ? 'wx' : 'w' },
);
console.log(
  '11.4 prepared declarations: 13 published catalogs / 10 programs, real Rust preparation only.',
);
