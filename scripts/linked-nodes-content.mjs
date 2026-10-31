import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function validateLinkedNodes() {
  const path = 'content/algorithms/cpp/linked-nodes-1.0.0.json',
    manifest = JSON.parse(readFileSync(path)),
    files = [path];
  assert.equal(manifest.id, 'catalog.cpp.linked-nodes');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.schemaVersion, '1.0.0');
  assert.deepEqual(manifest.inputEncoding, {
    version: '1.0.0',
    maxEncodedItems: 30,
    maxDraftChars: 1024,
  });
  assert.deepEqual(
    manifest.cases.map((s) => s.id),
    ['case.cpp.singly-linked-list', 'case.cpp.binary-search-tree'],
  );
  for (const s of manifest.cases) {
    assert.equal(s.version, '1.0.0');
    assert.equal(s.programVersion, '1.0.0');
    assert.equal(s.programId, s.id.replace('case.', 'program.'));
    assert.equal(s.language, 'cpp');
    assert.equal(s.capacity, 7);
    assert.equal(s.min, -999);
    assert.equal(s.max, 999);
    assert.equal(s.sourceOrigin, 'project-original');
    assert.equal(s.boundaryDrafts.length, 5);
    assert.equal(s.objectives.length, 3);
    assert.equal(s.knowledgeConcepts.length, 5);
    const source = readFileSync(s.sourceFile, 'utf8');
    files.push(s.sourceFile);
    assert.equal(source.split('{{n}}').length, 2);
    assert.ok(source.includes('new Node{}'));
    assert.ok(source.includes('delete '));
    assert.ok(Buffer.byteLength(source.replace('{{n}}', '30')) <= 32768);
    assert.deepEqual(
      [...source.matchAll(/^[ \t]*\/\/ @phase ([a-z]+)\r?$/gm)].map((m) => m[1]),
      s.phases.map((p) => p.id),
    );
    assert.equal(new Set(s.phases.map((p) => p.id)).size, s.phases.length);
    for (const p of s.phases) assert.ok(p.title && p.explanation);
    for (const draft of [s.defaultDraft, ...s.boundaryDrafts.map((x) => x.draft)]) {
      assert.ok(draft.length <= 1024);
      let slots = 0;
      if (draft !== '[]')
        for (const line of draft.split('\n').filter((x) => x.trim())) {
          const tokens = line.trim().split(/\s+/),
            c = tokens.shift(),
            arity =
              s.kind === 'list'
                ? { 插: 2, 删: 1, 遍历: 0 }[c]
                : { 插: 1, 查: 1, 前序: 0, 中序: 0, 后序: 0 }[c];
          assert.equal(tokens.length, arity);
          assert.ok(
            tokens.every((v) => /^[+-]?\d+$/.test(v) && Number(v) >= -999 && Number(v) <= 999),
          );
          slots += 1 + arity;
        }
      assert.ok(slots <= 30);
    }
  }
  return {
    catalog: {
      id: manifest.id,
      version: manifest.version,
      cases: 2,
      language: 'cpp',
      learningAuthority: false,
    },
    capacity: 7,
    engine: 'engine.rust.memory',
    versions: { exec: '1.3.0', dsl: '1.2.0', diagnostic: '1.2.0' },
    encoding: manifest.inputEncoding,
    files: files.map((path) => ({
      path,
      bytes: readFileSync(path).length,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    })),
  };
}
