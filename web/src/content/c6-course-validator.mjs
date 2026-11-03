import { manifestSchema, chunkSchema } from './c6-course-schema.generated.mjs';

export const C6_CONTENT_LIMITS = Object.freeze({
  manifest: 262144,
  chunk: 1048576,
  package: 20971520,
  source: 32768,
});
export class C6ContentError extends Error {
  constructor(code) {
    super(code);
    this.name = 'C6ContentError';
    this.code = code;
  }
}
const contexts = new WeakMap();
const entityKinds = ['lessons', 'activities', 'examples', 'exercises', 'knowledge'];
const assert = (test, code = 'C6_CONTENT_REFERENCE') => {
  if (!test) throw new C6ContentError(code);
};
const key = (r) => `${r.id}@${r.version}`;
const equalRef = (a, b) => (a === null || b === null ? a === b : key(a) === key(b));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameRefs = (a, b) => same(a.map(key), b.map(key));
const utf8 = (s) => new globalThis.TextEncoder().encode(s);
const sourceFrom = (r) => r.id.slice(5);
function chunkFor(id) {
  if (id === 'c6.appA' || id.startsWith('c6.sA.')) return 'chA';
  if (id === 'c6.appB' || id.startsWith('c6.sB.')) return 'chB';
  return id.startsWith('c6.ch')
    ? `ch${id.slice(5)}`
    : `ch${id.split('.')[1].slice(1).padStart(2, '0')}`;
}
function unique(values) {
  const set = new Set(values);
  assert(set.size === values.length);
  return set;
}
function safe(value) {
  const pending = [[value, 0]],
    seen = new Set();
  let count = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    assert(depth <= 30 && ++count <= 150000, 'C6_CONTENT_INVALID');
    if (typeof item === 'string') assert(!/[\ud800-\udfff]/u.test(item), 'C6_CONTENT_INVALID');
    if (!item || typeof item !== 'object') continue;
    assert(!seen.has(item), 'C6_CONTENT_INVALID');
    seen.add(item);
    assert(
      Array.isArray(item) ||
        Object.getPrototypeOf(item) === Object.prototype ||
        Object.getPrototypeOf(item) === null,
      'C6_CONTENT_INVALID',
    );
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      assert(
        !['__proto__', 'constructor', 'prototype'].includes(name) && 'value' in descriptor,
        'C6_CONTENT_INVALID',
      );
      pending.push([descriptor.value, depth + 1]);
    }
  }
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export async function c6ContentSha256(bytes) {
  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
function json(bytes, max) {
  assert(
    bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= max,
    'C6_CONTENT_SIZE',
  );
  try {
    return JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new C6ContentError('C6_CONTENT_INVALID');
  }
}
function has(context, r, kind) {
  assert(r && r.version === '1.0.0' && context[kind].has(r.id));
}
export function validateC6Manifest(value) {
  safe(value);
  assert(manifestSchema(value), 'C6_CONTENT_INVALID');
  const nav = new Map(value.nodes.map((n) => [n.id, n]));
  assert(
    nav.size === 650 &&
      same(
        value.nodes.map((n) => n.order),
        Array.from({ length: 650 }, (_, i) => i + 1),
      ),
  );
  assert(value.nodes.filter((n) => n.parentId === null).length === 19);
  unique(value.chunks.map((c) => c.id));
  unique(value.authoredSources.map((s) => s.path));
  let bytes = 0;
  const context = {
    nav,
    entries: new Map(),
    nodes: new Set(value.nodes.map((n) => `node.${n.id}`)),
    owner: new Map(),
  };
  for (const kind of entityKinds) context[kind] = new Set();
  const categories = {};
  for (const n of value.nodes) {
    assert(chunkFor(n.id) === n.chunkId);
    categories[n.category] = (categories[n.category] ?? 0) + 1;
    if (n.parentId !== null) {
      const p = nav.get(n.parentId);
      assert(p && p.order < n.order && p.chunkId === n.chunkId);
    }
  }
  assert(
    categories['directory-container'] === 112 &&
      categories['exercise-group'] === 34 &&
      categories['teaching-lesson'] === 404 &&
      categories['reference-answer-or-bibliography'] === 100,
  );
  for (const c of value.chunks) {
    const reference = c.id === 'chA' || c.id === 'chB';
    assert(c.kind === (reference ? 'reference-appendix' : 'course-chapter'));
    assert(c.rootNodeId === (reference ? `c6.app${c.id.slice(2)}` : `c6.${c.id}`));
    assert(c.file === `${c.id}-1.0.0.json`);
    const root = nav.get(c.rootNodeId);
    assert(root && root.parentId === null && root.chunkId === c.id);
    assert(c.counts.nodes === value.nodes.filter((n) => n.chunkId === c.id).length);
    assert(
      c.counts.lessons ===
        value.nodes.filter((n) => n.chunkId === c.id && n.category === 'teaching-lesson').length,
    );
    if (reference) assert(entityKinds.every((k) => c.counts[k] === 0));
    for (const kind of entityKinds) {
      assert(c.entityIds[kind].length === c.counts[kind]);
      unique(c.entityIds[kind]);
      for (const id of c.entityIds[kind]) {
        assert(!context.owner.has(id));
        context.owner.set(id, c.id);
        context[kind].add(id);
      }
    }
    context.entries.set(c.id, c);
    bytes += c.bytes;
  }
  assert(bytes <= C6_CONTENT_LIMITS.package);
  const expected = { lessons: 404, activities: 793, examples: 232, exercises: 44, knowledge: 421 };
  for (const [kind, total] of Object.entries(expected)) assert(context[kind].size === total);
  const teaching = value.nodes.filter((n) => n.category === 'teaching-lesson');
  const expectedLessons = new Set(teaching.map((n) => `lesson.${n.id}`));
  assert([...context.lessons].every((id) => expectedLessons.has(id)));
  for (const id of context.lessons) assert(context.owner.get(id) === chunkFor(id.slice(7)));
  const expectedKnowledge = new Set([
    ...teaching.map((n) => `knowledge.${n.id}`),
    ...value.chunks
      .filter((c) => c.kind === 'course-chapter')
      .map((c) => `knowledge.${c.rootNodeId}`),
  ]);
  assert([...context.knowledge].every((id) => expectedKnowledge.has(id)));
  for (const id of context.knowledge) assert(context.owner.get(id) === chunkFor(id.slice(10)));
  let concepts = 0,
    execution = 0,
    designs = 0;
  for (const id of context.activities) {
    assert(id.startsWith('activity.'));
    const owner = context.owner.get(id),
      source = id.slice('activity.'.length);
    if (source.endsWith('.concept')) {
      assert(
        context.lessons.has(`lesson.${source.slice(0, -8)}`) &&
          owner === chunkFor(source.slice(0, -8)),
      );
      concepts++;
    } else if (source.endsWith('.execute')) {
      assert(
        context.exercises.has(`exercise.${source.slice(0, -8)}`) &&
          owner === chunkFor(source.slice(0, -8)),
      );
      execution++;
    } else {
      const q = /^(c6\.s[0-9]+\.[0-9]+)\.q[0-9]{2}$/.exec(source);
      assert(q && nav.get(q[1])?.category === 'exercise-group' && owner === chunkFor(q[1]));
      designs++;
    }
    assert(owner !== 'chA' && owner !== 'chB');
  }
  assert(concepts === 404 && execution === 44 && designs === 345);
  for (const id of context.exercises)
    assert(
      id.startsWith('exercise.') &&
        context.lessons.has(`lesson.${id.slice(9)}`) &&
        context.owner.get(id) === chunkFor(id.slice(9)),
    );
  for (const id of context.examples) {
    const e = /^example\.c6\.listing([0-9]+)\.[0-9]+$/.exec(id);
    assert(e && context.owner.get(id) === `ch${e[1].padStart(2, '0')}`);
  }
  for (const s of value.authoredSources)
    assert(
      !s.path.startsWith('/') &&
        !s.path.includes('\\') &&
        !s.path.includes(':') &&
        !s.path.split('/').includes('..'),
    );
  contexts.set(value, context);
  return freeze(value);
}
function getContext(manifest) {
  if (!contexts.has(manifest)) validateC6Manifest(manifest);
  return contexts.get(manifest);
}
function checkChoice(check) {
  assert(
    same(
      check.options.map((o) => o.key),
      ['A', 'B', 'C', 'D'],
    ),
  );
  unique(check.options.map((o) => o.text));
  assert(check.options.some((o) => o.key === check.answerKey));
}
function checkSource(source) {
  assert(utf8(source).byteLength <= C6_CONTENT_LIMITS.source, 'C6_CONTENT_SIZE');
  assert(/\bint\s+main\s*\(/.test(source));
}
async function checkProof(proof, source, manifest) {
  assert(proof.engineBuildSha256 === manifest.engineBuildSha256, 'C6_CONTENT_HASH');
  assert(proof.sourceSha256 === (await c6ContentSha256(utf8(source))), 'C6_CONTENT_HASH');
}
export async function validateC6Chunk(value, manifest, id) {
  safe(value);
  assert(chunkSchema(value), 'C6_CONTENT_INVALID');
  const context = getContext(manifest),
    entry = context.entries.get(id);
  assert(
    entry &&
      value.chunkId === id &&
      value.kind === entry.kind &&
      value.rootNodeId === entry.rootNodeId &&
      equalRef(value.packageRef, manifest.packageRef),
  );
  const nav = manifest.nodes.filter((n) => n.chunkId === id);
  assert(
    same(
      value.nodes.map((n) => n.sourceNodeId),
      nav.map((n) => n.id),
    ),
  );
  for (const kind of entityKinds) {
    assert(value[kind].length === entry.counts[kind]);
    assert(
      same(
        value[kind].map((r) => r.ref.id),
        entry.entityIds[kind],
      ),
    );
  }
  const nodeMap = new Map(value.nodes.map((n) => [n.ref.id, n]));
  const lessonMap = new Map(value.lessons.map((n) => [n.ref.id, n]));
  for (const r of [...value.nodes, ...entityKinds.flatMap((k) => value[k])])
    assert(r.ref.version === '1.0.0');
  for (const n of value.nodes) {
    const v = context.nav.get(n.sourceNodeId);
    assert(
      n.ref.id === `node.${v.id}` &&
        n.order === v.order &&
        n.titleOriginal === v.titleOriginal &&
        n.titleDisplay === v.titleDisplay &&
        n.category === v.category &&
        n.locator.physicalPage === v.physicalPage,
    );
    assert(
      equalRef(n.parentRef, v.parentId ? { id: `node.${v.parentId}`, version: '1.0.0' } : null),
    );
    assert(n.area === (entry.kind === 'course-chapter' ? 'course' : 'reference'));
    assert(
      equalRef(
        n.lessonRef,
        n.category === 'teaching-lesson' ? { id: `lesson.${v.id}`, version: '1.0.0' } : null,
      ),
    );
    assert(
      sameRefs(
        n.activityRefs,
        value.activities.filter((a) => a.sourceNodeRef.id === n.ref.id).map((a) => a.ref),
      ),
    );
    assert(
      sameRefs(
        n.exampleRefs,
        value.examples.filter((a) => a.sourceNodeRef.id === n.ref.id).map((a) => a.ref),
      ),
    );
  }
  for (const lesson of value.lessons) {
    has(context, lesson.sourceNodeRef, 'nodes');
    const source = sourceFrom(lesson.sourceNodeRef);
    assert(
      lesson.ref.id === `lesson.${source}` &&
        nodeMap.get(lesson.sourceNodeRef.id)?.category === 'teaching-lesson',
    );
    assert(equalRef(lesson.chapterRef, { id: `node.${entry.rootNodeId}`, version: '1.0.0' }));
    assert(sameRefs(lesson.knowledgeRefs, [{ id: `knowledge.${source}`, version: '1.0.0' }]));
    for (const [field, mandatory] of [
      ['requiredActivityRefs', true],
      ['optionalActivityRefs', false],
    ])
      assert(
        sameRefs(
          lesson[field],
          value.activities
            .filter((a) => equalRef(a.lessonRef, lesson.ref) && a.mandatory === mandatory)
            .map((a) => a.ref),
        ),
      );
    assert(
      sameRefs(
        lesson.exampleRefs,
        value.examples.filter((e) => equalRef(e.lessonRef, lesson.ref)).map((e) => e.ref),
      ),
    );
  }
  for (const a of value.activities) {
    has(context, a.sourceNodeRef, 'nodes');
    has(context, a.lessonRef, 'lessons');
    has(context, a.knowledgeRef, 'knowledge');
    assert(nodeMap.has(a.sourceNodeRef.id) && lessonMap.has(a.lessonRef.id));
    const source = sourceFrom(a.sourceNodeRef);
    if (a.kind === 'source-design-check') {
      assert(
        !a.mandatory &&
          a.ref.id === `activity.${a.sourceQuestion.id}` &&
          a.sourceQuestion.id.startsWith(`${source}.q`),
      );
      assert(
        a.knowledgeRef.id === `knowledge.${entry.rootNodeId}` &&
          Array.from(a.discussion).every((c) => c.charCodeAt(0) >= 32),
      );
      assert((a.sourceQuestion.kind === 'programming') === (a.codingAssessment !== null));
      checkChoice(a.check);
    } else {
      assert(
        a.mandatory &&
          a.lessonRef.id === `lesson.${source}` &&
          a.knowledgeRef.id === `knowledge.${source}`,
      );
      if (a.kind === 'concept-check') {
        assert(a.ref.id === `activity.${source}.concept`);
        checkChoice(a.check);
      } else {
        assert(
          a.ref.id === `activity.${source}.execute` &&
            a.exerciseRef.id === `exercise.${source}` &&
            a.judgeProfileRef.id === `judge.${source}` &&
            a.judgeProfileRef.version === '1.0.0',
        );
        has(context, a.exerciseRef, 'exercises');
      }
    }
  }
  for (const e of value.examples) {
    has(context, e.sourceNodeRef, 'nodes');
    has(context, e.lessonRef, 'lessons');
    assert(
      nodeMap.has(e.sourceNodeRef.id) &&
        lessonMap.has(e.lessonRef.id) &&
        e.ref.id === `example.${e.sourceExampleId}`,
    );
    checkSource(e.source);
    if (e.mode === 'reading-only') {
      assert((e.sourceFileName === undefined) === (e.companionFiles === undefined));
      const files = [
        { path: e.sourceFileName ?? 'main.c', source: e.source },
        ...(e.companionFiles ?? []),
      ];
      const names = unique(files.map((f) => f.path));
      assert(
        files.reduce((sum, f) => sum + utf8(f.source).byteLength, 0) <= C6_CONTENT_LIMITS.source,
        'C6_CONTENT_SIZE',
      );
      assert(files.filter((f) => /\bint\s+main\s*\(/.test(f.source)).length === 1);
      for (const f of files)
        for (const match of f.source.matchAll(/#include\s+"([^"]+)"/g)) assert(names.has(match[1]));
    } else {
      assert(
        typeof e.expectedStdout === 'string' &&
          utf8(e.input).byteLength <= 256 &&
          /^[\t\n\r\x20-\x7e]*$/.test(e.input),
      );
      await checkProof(e.verification, e.source, manifest);
      if (e.mode === 'c6-diagnostic-demo') {
        assert(e.source.includes(e.expectedDiagnostic.anchor));
        if (e.expectedDiagnostic.kind === 'semantic-output-mismatch')
          assert(
            e.expectedDiagnostic.businessExpectedStdout !== e.expectedStdout &&
              e.expectedReturn === 0,
          );
      } else assert(e.expectedReturn === 0);
    }
  }
  for (const e of value.exercises) {
    const source = sourceFrom(e.sourceNodeRef);
    has(context, e.sourceNodeRef, 'nodes');
    has(context, e.lessonRef, 'lessons');
    assert(
      lessonMap.has(e.lessonRef.id) &&
        e.ref.id === `exercise.${source}` &&
        e.lessonRef.id === `lesson.${source}` &&
        e.profileRef.id === `judge.${source}` &&
        e.programRef.id === `program.${source}` &&
        e.profileRef.version === '1.0.0' &&
        e.programRef.version === '1.0.0',
    );
    assert(
      same(
        e.tests.map((t) => t.caseKey),
        ['case-1', 'case-2', 'case-3', 'case-4'],
      ),
    );
    assert(
      e.tests.every((t) => utf8(t.stdin).byteLength <= 256 && /^[\t\n\r\x20-\x7e]*$/.test(t.stdin)),
    );
    checkSource(e.starterSource);
    checkSource(e.referenceSource);
    await checkProof(e.verification.reference, e.referenceSource, manifest);
    await checkProof(e.verification.starter, e.starterSource, manifest);
  }
  for (const k of value.knowledge) {
    has(context, k.sourceNodeRef, 'nodes');
    assert(
      nodeMap.has(k.sourceNodeRef.id) && k.ref.id === `knowledge.${sourceFrom(k.sourceNodeRef)}`,
    );
    if (k.kind === 'chapter')
      assert(
        k.sourceNodeRef.id === `node.${entry.rootNodeId}` &&
          k.chapterKnowledgeRef === null &&
          k.precision === 'chapter-only-source-design',
      );
    else
      assert(
        k.precision === 'lesson' &&
          equalRef(k.chapterKnowledgeRef, {
            id: `knowledge.${entry.rootNodeId}`,
            version: '1.0.0',
          }) &&
          lessonMap.has(`lesson.${sourceFrom(k.sourceNodeRef)}`),
      );
  }
  assert((id === manifest.compatibilityChunkId) === (value.compatibility !== null));
  if (value.compatibility) {
    unique(value.compatibility.legacyLinks.map((r) => `${r.kind}/${key(r.fromRef)}`));
    unique(value.compatibility.rewardGroups.map((r) => r.id));
    for (const r of value.compatibility.legacyLinks)
      if (r.relatedSourceNodeRef) has(context, r.relatedSourceNodeRef, 'nodes');
    const rewardedLessons = [],
      rewardedExercises = [];
    for (const g of value.compatibility.rewardGroups) {
      for (const r of g.lessonRefs) {
        has(context, r, 'lessons');
        rewardedLessons.push(r.id);
      }
      for (const r of g.exerciseRefs) {
        has(context, r, 'exercises');
        rewardedExercises.push(r.id);
      }
    }
    assert(unique(rewardedLessons).size === 404 && unique(rewardedExercises).size === 44);
  }
  // Published chunks use the producer's compact JSON plus one LF. This binds even
  // a direct object-validation caller to the reviewed complete source bundles;
  // include closure alone cannot establish definitions in native C modules.
  assert(
    (await c6ContentSha256(utf8(`${JSON.stringify(value)}\n`))) === entry.sha256,
    'C6_CONTENT_HASH',
  );
  return freeze(value);
}
export async function parseC6Manifest(bytes, expectedSha256) {
  assert(
    bytes instanceof Uint8Array && bytes.byteLength <= C6_CONTENT_LIMITS.manifest,
    'C6_CONTENT_SIZE',
  );
  assert(
    /^[a-f0-9]{64}$/.test(expectedSha256 ?? '') &&
      (await c6ContentSha256(bytes)) === expectedSha256,
    'C6_CONTENT_HASH',
  );
  const result = validateC6Manifest(json(bytes, C6_CONTENT_LIMITS.manifest));
  assert(
    bytes.byteLength + result.chunks.reduce((sum, c) => sum + c.bytes, 0) <=
      C6_CONTENT_LIMITS.package,
    'C6_CONTENT_SIZE',
  );
  return result;
}
export async function parseC6Chunk(bytes, manifest, id) {
  const entry = getContext(manifest).entries.get(id);
  assert(entry);
  assert(
    bytes instanceof Uint8Array &&
      bytes.byteLength === entry.bytes &&
      bytes.byteLength <= C6_CONTENT_LIMITS.chunk,
    'C6_CONTENT_SIZE',
  );
  assert((await c6ContentSha256(bytes)) === entry.sha256, 'C6_CONTENT_HASH');
  return validateC6Chunk(json(bytes, C6_CONTENT_LIMITS.chunk), manifest, id);
}
export async function validateCompleteC6Course(manifest, chunks) {
  const context = getContext(manifest);
  assert(chunks.length === 19 && unique(chunks.map((c) => c.chunkId)).size === 19);
  for (const chunk of chunks) await validateC6Chunk(chunk, manifest, chunk.chunkId);
  const all = (kind) => chunks.flatMap((c) => c[kind]);
  const activities = all('activities'),
    examples = all('examples');
  assert(activities.filter((a) => a.mandatory).length === 448);
  assert(
    activities.filter((a) => a.kind === 'source-design-check' && a.sourceQuestion.kind === 'review')
      .length === 177,
  );
  assert(
    activities.filter((a) => a.kind === 'source-design-check' && a.codingAssessment !== null)
      .length === 168,
  );
  for (const [mode, count] of [
    ['reading-only', 101],
    ['c6-independent-executable', 124],
    ['c6-diagnostic-demo', 7],
  ])
    assert(examples.filter((e) => e.mode === mode).length === count);
  const compatibility = chunks.find(
    (c) => c.chunkId === manifest.compatibilityChunkId,
  ).compatibility;
  const groups = new Map(compatibility.rewardGroups.map((g) => [g.id, g]));
  for (const lesson of all('lessons')) {
    const g = groups.get(lesson.rewardGroupId);
    assert(g && g.lessonRefs.some((r) => equalRef(r, lesson.ref)));
  }
  assert(all('exercises').every((e) => context.exercises.has(e.ref.id)));
  return Object.freeze({
    nodes: 650,
    lessons: 404,
    activities: 793,
    examples: 232,
    exercises: 44,
    knowledge: 421,
    referenceOnlyB: true,
  });
}
