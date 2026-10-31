import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function validateRecursiveSorts() {
  const path = 'content/algorithms/cpp/recursive-sorts-1.0.0.json',
    bytes = readFileSync(path),
    catalog = JSON.parse(bytes);
  const keys = (value, expected) =>
    assert.deepEqual(Object.keys(value).sort(), expected.toSorted());
  const proof = (path) => ({
    path,
    bytes: readFileSync(path).length,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  });
  keys(catalog, ['schemaVersion', 'id', 'version', 'cases']);
  assert.equal(catalog.schemaVersion, '1.1.0');
  assert.equal(catalog.id, 'catalog.cpp.recursive-sorts');
  assert.equal(catalog.version, '1.0.0');
  assert.deepEqual(
    catalog.cases.map((item) => item.id),
    ['case.cpp.merge-sort', 'case.cpp.quick-sort'],
  );
  const files = [proof(path)];
  for (const item of catalog.cases) {
    keys(item, [
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
      'phases',
      'boundarySamples',
      'knowledgeConcepts',
      'sourceOrigin',
    ]);
    const slug = item.id.slice('case.cpp.'.length),
      counting = slug === 'counting-sort';
    assert.equal(item.sourceOrigin, 'project-original');
    assert.deepEqual(item.knowledgeConcepts, ['递归', '数组', '分治', '排序']);
    assert.equal(item.programId, `program.cpp.${slug}`);
    assert.equal(item.version, '1.0.0');
    assert.equal(item.programVersion, '1.0.0');
    assert.equal(item.language, 'cpp');
    assert.equal(item.maxItems, 30);
    assert.equal(item.min, counting ? -20 : -999);
    assert.equal(item.max, counting ? 20 : 999);
    for (const field of ['title', 'description', 'variant', 'complexity', 'extraSpace'])
      assert.ok(typeof item[field] === 'string' && item[field].length > 0);
    assert.equal(item.objectives.length, 3);
    for (const goal of item.objectives) assert.ok(typeof goal === 'string' && goal.length > 0);
    const valid = (values) =>
      Array.isArray(values) &&
      values.length <= 30 &&
      values.every((value) => Number.isInteger(value) && value >= item.min && value <= item.max);
    assert.ok(valid(item.defaultInput));
    assert.equal(item.defaultInput.length, 7);
    assert.equal(item.boundarySamples.length, 5);
    for (const values of item.boundarySamples) assert.ok(valid(values));
    assert.equal(item.sourceFile, `content/algorithms/cpp/${slug}-1.0.0.cpp`);
    const source = readFileSync(item.sourceFile, 'utf8');
    assert.equal(source.split('{{n}}').length, 2);
    assert.ok(source.includes('#include <iostream>'));
    assert.ok(source.includes('std::cin >> values[i]'));
    assert.ok(source.includes('std::cout << values[i]'));
    assert.ok(Buffer.byteLength(source.replace('{{n}}', '30'), 'utf8') <= 32768);
    assert.deepEqual(
      [...source.matchAll(/^[ \t]*\/\/ @phase ([a-z]+)\r?$/gm)].map((match) => match[1]),
      item.phases.map((phase) => phase.id),
    );
    assert.equal(new Set(item.phases.map((phase) => phase.id)).size, item.phases.length);
    for (const phase of item.phases) {
      keys(phase, ['id', 'title', 'explanation']);
      assert.match(phase.id, /^[a-z]+$/);
      assert.ok(phase.title.length > 0 && phase.explanation.length > 0);
    }
    files.push(proof(item.sourceFile));
  }
  return {
    catalog: {
      id: catalog.id,
      version: catalog.version,
      cases: 2,
      language: 'cpp',
      learningAuthority: false,
    },
    files,
  };
}
