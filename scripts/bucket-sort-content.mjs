import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function validateBucketSort() {
  const path = 'content/algorithms/cpp/bucket-sort-1.0.0.json',
    catalog = JSON.parse(readFileSync(path));
  const keys = (v, k) => assert.deepEqual(Object.keys(v).sort(), k.toSorted()),
    proof = (p) => ({
      path: p,
      bytes: readFileSync(p).length,
      sha256: createHash('sha256').update(readFileSync(p)).digest('hex'),
    });
  keys(catalog, ['schemaVersion', 'id', 'version', 'cases']);
  assert.equal(catalog.schemaVersion, '1.2.0');
  assert.equal(catalog.id, 'catalog.cpp.bucket-sort');
  assert.equal(catalog.version, '1.0.0');
  assert.equal(catalog.cases.length, 1);
  const spec = catalog.cases[0];
  keys(spec, [
    'id',
    'version',
    'programId',
    'programVersion',
    'language',
    'title',
    'description',
    'objectives',
    'min',
    'max',
    'maxItems',
    'defaultInput',
    'variant',
    'complexity',
    'extraSpace',
    'sourceFile',
    'knowledgeConcepts',
    'sourceOrigin',
    'bucketLayout',
    'phases',
    'boundarySamples',
  ]);
  assert.equal(spec.id, 'case.cpp.bucket-sort');
  assert.equal(spec.programId, 'program.cpp.bucket-sort');
  assert.equal(spec.version, '1.0.0');
  assert.equal(spec.programVersion, '1.0.0');
  assert.equal(spec.language, 'cpp');
  assert.equal(spec.sourceOrigin, 'project-original');
  assert.equal(spec.min, -20);
  assert.equal(spec.max, 29);
  assert.equal(spec.maxItems, 30);
  assert.equal(spec.objectives.length, 3);
  assert.equal(spec.knowledgeConcepts.length, 5);
  for (const field of ['title', 'description', 'variant', 'complexity', 'extraSpace'])
    assert.ok(typeof spec[field] === 'string' && spec[field].length > 0);
  const valid = (v) =>
    Array.isArray(v) &&
    v.length <= 30 &&
    v.every((n) => Number.isInteger(n) && n >= -20 && n <= 29);
  assert.ok(valid(spec.defaultInput));
  assert.equal(spec.defaultInput.length, 7);
  assert.equal(spec.boundarySamples.length, 6);
  for (const sample of spec.boundarySamples) assert.ok(valid(sample));
  assert.deepEqual(spec.bucketLayout, {
    bucketCount: 5,
    bucketCapacity: 30,
    width: 10,
    ranges: [
      [-20, -11],
      [-10, -1],
      [0, 9],
      [10, 19],
      [20, 29],
    ],
    dataObject: 'bucketData',
    sizesObject: 'bucketSizes',
  });
  assert.equal(spec.sourceFile, 'content/algorithms/cpp/bucket-sort-1.0.0.cpp');
  const source = readFileSync(spec.sourceFile, 'utf8');
  assert.equal(source.split('{{n}}').length, 2);
  assert.ok(source.includes('int bucketData[150];'));
  assert.ok(source.includes('int bucketSizes[5] = {};'));
  assert.ok(source.includes('int bucket = (values[i] + 20) / 10;'));
  assert.ok(source.includes('std::cin >> values[i]'));
  assert.ok(source.includes('std::cout << values[i]'));
  assert.ok(Buffer.byteLength(source.replace('{{n}}', '30')) <= 32768);
  assert.deepEqual(
    [...source.matchAll(/^[ \t]*\/\/ @phase ([a-z]+)\r?$/gm)].map((m) => m[1]),
    spec.phases.map((p) => p.id),
  );
  assert.equal(new Set(spec.phases.map((p) => p.id)).size, spec.phases.length);
  for (const p of spec.phases) {
    keys(p, ['id', 'title', 'explanation']);
    assert.match(p.id, /^[a-z]+$/);
    assert.ok(p.title.length > 0 && p.explanation.length > 0);
  }
  return {
    catalog: {
      id: catalog.id,
      version: catalog.version,
      cases: 1,
      language: 'cpp',
      learningAuthority: false,
    },
    layout: spec.bucketLayout,
    auxiliaryPhysicalBytes: 620,
    files: [proof(path), proof(spec.sourceFile)],
  };
}
