import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function validateStructures() {
  const path = 'content/algorithms/cpp/stack-queue-1.0.0.json';
  const manifest = JSON.parse(readFileSync(path));
  assert.equal(manifest.id, 'catalog.cpp.stack-queue');
  assert.equal(manifest.schemaVersion, '1.0.0');
  assert.equal(manifest.version, '1.0.0');
  assert.deepEqual(manifest.inputEncoding, {
    version: '1.0.0',
    maxEncodedItems: 30,
    maxDraftChars: 1024,
    inCode: 1,
    outCode: 2,
  });
  assert.deepEqual(
    manifest.cases.map((s) => s.id),
    ['case.cpp.array-stack', 'case.cpp.circular-queue'],
  );
  const files = [path];
  for (const s of manifest.cases) {
    assert.equal(s.version, '1.0.0');
    assert.equal(s.programVersion, '1.0.0');
    assert.equal(s.language, 'cpp');
    assert.equal(s.capacity, 5);
    assert.equal(s.min, -999);
    assert.equal(s.max, 999);
    assert.equal(s.sourceOrigin, 'project-original');
    assert.equal(s.programId, s.id.replace('case.', 'program.'));
    assert.equal(s.boundaryDrafts.length, 4);
    for (const draft of [s.defaultDraft, ...s.boundaryDrafts.map((x) => x.draft)]) {
      assert.ok(draft.length <= 1024);
      let slots = 0;
      if (draft.trim() !== '[]')
        for (const line of draft
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean)) {
          if (line === '出') slots++;
          else {
            const m = /^入\s+([+-]?\d+)$/.exec(line);
            assert.ok(m);
            assert.ok(Number(m[1]) >= -999 && Number(m[1]) <= 999);
            slots += 2;
          }
        }
      assert.ok(slots <= 30);
    }
    const source = readFileSync(s.sourceFile, 'utf8');
    files.push(s.sourceFile);
    assert.equal(source.split('{{n}}').length, 2);
    assert.ok(source.includes('int data[5];'));
    assert.deepEqual(
      [...source.matchAll(/^[ \t]*\/\/ @phase ([a-z]+)\r?$/gm)].map((m) => m[1]),
      s.phases.map((p) => p.id),
    );
    assert.equal(s.phases.length, 10);
    assert.ok(Buffer.byteLength(source.replace('{{n}}', '30')) <= 32768);
    for (const p of s.phases) assert.ok(p.title && p.explanation);
  }
  return {
    catalog: {
      id: manifest.id,
      version: manifest.version,
      cases: 2,
      language: 'cpp',
      learningAuthority: false,
    },
    capacity: 5,
    encoding: manifest.inputEncoding,
    files: files.map((path) => ({
      path,
      bytes: readFileSync(path).length,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    })),
  };
}
