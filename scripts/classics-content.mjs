import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function validateClassics() {
  const path = 'content/algorithms/cpp/classics-1.0.0.json',
    manifest = JSON.parse(readFileSync(path)),
    files = [path];
  assert.equal(manifest.id, 'catalog.cpp.classics');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.schemaVersion, '1.0.0');
  assert.equal(manifest.maxDraftChars, 128);
  assert.deepEqual(
    manifest.cases.map((s) => s.id),
    [
      'case.cpp.hanoi',
      'case.cpp.euclidean-gcd',
      'case.cpp.trial-division-prime',
      'case.cpp.palindrome-number',
    ],
  );
  for (const s of manifest.cases) {
    assert.equal(s.version, '1.0.0');
    assert.equal(s.programVersion, '1.0.0');
    assert.equal(s.programId, s.id.replace('case.', 'program.'));
    assert.equal(s.language, 'cpp');
    assert.equal(s.sourceOrigin, 'project-original');
    assert.equal(s.inputArity, s.kind === 'gcd' ? 2 : 1);
    assert.equal(s.min, s.kind === 'hanoi' ? 0 : -999);
    assert.equal(s.max, s.kind === 'hanoi' ? 5 : 999);
    assert.equal(s.objectives.length, 3);
    assert.equal(s.knowledgeConcepts.length, 4);
    for (const input of [s.defaultInput, ...s.boundarySamples.map((x) => x.input)])
      assert.ok(
        input.length === s.inputArity &&
          input.every((n) => Number.isInteger(n) && n >= s.min && n <= s.max),
      );
    const source = readFileSync(s.sourceFile, 'utf8');
    files.push(s.sourceFile);
    assert.ok(Buffer.byteLength(source) <= 32768);
    assert.equal(source.includes('{{'), false);
    assert.ok(source.includes('std::cin >>'));
    assert.ok(source.includes('std::cout <<'));
    assert.deepEqual(
      [...source.matchAll(/^[ \t]*\/\/ @phase ([a-z]+)\r?$/gm)].map((m) => m[1]),
      s.phases.map((p) => p.id),
    );
    assert.equal(new Set(s.phases.map((p) => p.id)).size, s.phases.length);
    for (const p of s.phases) assert.ok(p.title && p.explanation);
  }
  return {
    catalog: {
      id: manifest.id,
      version: manifest.version,
      cases: 4,
      language: 'cpp',
      learningAuthority: false,
    },
    engine: 'engine.rust.memory',
    versions: { exec: '1.3.0', dsl: '1.2.0', diagnostic: '1.2.0' },
    input: 'Fixed arity1/2 decimal integers, hanoi0..5, others-999..999',
    files: files.map((path) => ({
      path,
      bytes: readFileSync(path).length,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    })),
  };
}
