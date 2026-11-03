import {
  teachingManifestSchema,
  teachingChunkSchema,
  teachingSourceSchema,
} from './c6-teaching-schema.generated.mjs';

export const C6_TEACHING_LIMITS = Object.freeze({
  manifest: 262144,
  chunk: 1048576,
  package: 20971520,
  source: 32768,
});
const kinds = ['lessons', 'activities', 'examples', 'exercises', 'knowledge', 'programs'];
const contexts = new WeakMap();
export class C6TeachingContentError extends Error {
  constructor(code) {
    super(code);
    this.name = 'C6TeachingContentError';
    this.code = code;
  }
}
function assert(value, code = 'C6_TEACHING_REFERENCE') {
  if (!value) throw new C6TeachingContentError(code);
}
const utf8 = (value) => new globalThis.TextEncoder().encode(value);
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const key = (ref) => `${ref.id}@${ref.version}`;
const equalRef = (a, b) => (a === null || b === null ? a === b : key(a) === key(b));
const sameRefs = (a, b) => same(a.map(key), b.map(key));
const ref = (id) => ({ id, version: '2.0.0' });
function unique(values) {
  const result = new Set(values);
  assert(result.size === values.length);
  return result;
}
function safe(value, limit = 150000) {
  const pending = [[value, 0]],
    seen = new Set();
  let count = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    assert(depth <= 30 && ++count <= limit, 'C6_TEACHING_INVALID');
    if (typeof item === 'string') assert(!/[\ud800-\udfff]/u.test(item), 'C6_TEACHING_INVALID');
    if (!item || typeof item !== 'object') continue;
    assert(!seen.has(item), 'C6_TEACHING_INVALID');
    seen.add(item);
    assert(
      Array.isArray(item) ||
        Object.getPrototypeOf(item) === Object.prototype ||
        Object.getPrototypeOf(item) === null,
      'C6_TEACHING_INVALID',
    );
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      assert(
        !['__proto__', 'constructor', 'prototype'].includes(name) && 'value' in descriptor,
        'C6_TEACHING_INVALID',
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
export async function c6TeachingSha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((name) => `${JSON.stringify(name)}:${canonical(value[name])}`)
    .join(',')}}`;
}
function json(bytes, limit) {
  assert(
    bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= limit,
    'C6_TEACHING_SIZE',
  );
  try {
    return JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new C6TeachingContentError('C6_TEACHING_INVALID');
  }
}
function chunkFor(source) {
  if (source === 'c6.appA' || source.startsWith('c6.sA.')) return 'chA';
  if (source === 'c6.appB' || source.startsWith('c6.sB.')) return 'chB';
  return source.startsWith('c6.ch')
    ? `ch${source.slice(5)}`
    : `ch${source.split('.')[1].slice(1).padStart(2, '0')}`;
}
function has(context, value, kind) {
  assert(value?.version === '2.0.0' && context[kind].has(value.id));
}
function makeContext(manifest) {
  const nav = new Map(manifest.nodes.map((node) => [node.id, node]));
  assert(nav.size === 650);
  assert(
    same(
      manifest.nodes.map((node) => node.order),
      Array.from({ length: 650 }, (_, index) => index + 1),
    ),
  );
  assert(manifest.nodes.filter((node) => node.parentId === null).length === 19);
  const context = {
    nav,
    nodes: new Set(manifest.nodes.map((node) => `node.${node.id}`)),
    entries: new Map(),
    owner: new Map(),
  };
  for (const kind of kinds) context[kind] = new Set();
  const categories = {};
  let referenceCount = 0;
  for (const node of manifest.nodes) {
    assert(node.chunkId === chunkFor(node.id));
    categories[node.category] = (categories[node.category] ?? 0) + 1;
    if (['chA', 'chB'].includes(node.chunkId)) {
      ++referenceCount;
      assert(['directory-container', 'reference-answer-or-bibliography'].includes(node.category));
    }
    if (node.parentId !== null) {
      const parent = nav.get(node.parentId);
      assert(parent && parent.order < node.order && parent.chunkId === node.chunkId);
    }
  }
  assert(
    referenceCount === 111 &&
      categories['directory-container'] === 112 &&
      categories['exercise-group'] === 34 &&
      categories['teaching-lesson'] === 404 &&
      categories['reference-answer-or-bibliography'] === 100,
  );
  assert(
    same(
      manifest.chunks.map((entry) => entry.id),
      [
        ...Array.from({ length: 17 }, (_, i) => `ch${String(i + 1).padStart(2, '0')}`),
        'chA',
        'chB',
      ],
    ),
  );
  let bytes = 0;
  for (const entry of manifest.chunks) {
    const isReference = ['chA', 'chB'].includes(entry.id);
    assert(entry.kind === (isReference ? 'reference-appendix' : 'course-chapter'));
    assert(entry.rootNodeId === (isReference ? `c6.app${entry.id.slice(2)}` : `c6.${entry.id}`));
    assert(nav.get(entry.rootNodeId)?.parentId === null);
    assert(entry.file === `${entry.id}-2.0.0.json`);
    assert(
      entry.counts.nodes === manifest.nodes.filter((node) => node.chunkId === entry.id).length,
    );
    assert(
      entry.counts.lessons ===
        manifest.nodes.filter(
          (node) => node.chunkId === entry.id && node.category === 'teaching-lesson',
        ).length,
    );
    for (const kind of kinds) {
      assert(entry.entityIds[kind].length === entry.counts[kind]);
      unique(entry.entityIds[kind]);
      if (isReference) assert(entry.counts[kind] === 0);
      for (const id of entry.entityIds[kind]) {
        assert(!context.owner.has(id));
        context.owner.set(id, entry.id);
        context[kind].add(id);
      }
    }
    context.entries.set(entry.id, entry);
    bytes += entry.bytes;
  }
  assert(bytes <= C6_TEACHING_LIMITS.package, 'C6_TEACHING_SIZE');
  for (const [kind, count] of Object.entries({
    lessons: 404,
    activities: 389,
    examples: 232,
    exercises: 44,
    knowledge: 421,
    programs: 386,
  }))
    assert(context[kind].size === count);
  const teaching = manifest.nodes.filter((node) => node.category === 'teaching-lesson');
  assert(
    same(
      [...context.lessons],
      teaching.map((node) => `lesson.${node.id}`),
    ),
  );
  const expectedKnowledge = new Set([
    ...teaching.map((node) => `knowledge.${node.id}`),
    ...manifest.chunks.slice(0, 17).map((entry) => `knowledge.${entry.rootNodeId}`),
  ]);
  assert([...context.knowledge].every((id) => expectedKnowledge.has(id)));
  for (const [kind, prefix] of [
    ['lessons', 'lesson.'],
    ['exercises', 'exercise.'],
    ['knowledge', 'knowledge.'],
  ]) {
    for (const id of context[kind]) {
      assert(id.startsWith(prefix) && context.owner.get(id) === chunkFor(id.slice(prefix.length)));
      if (kind === 'exercises') assert(context.lessons.has(`lesson.${id.slice(prefix.length)}`));
    }
  }
  let execution = 0,
    guides = 0;
  for (const id of context.activities) {
    const source = id.slice('activity.'.length),
      owner = context.owner.get(id);
    assert(id.startsWith('activity.') && !['chA', 'chB'].includes(owner));
    if (source.endsWith('.execute')) {
      const lesson = source.slice(0, -8);
      assert(context.exercises.has(`exercise.${lesson}`) && owner === chunkFor(lesson));
      ++execution;
    } else {
      const match = /^(c6\.s[0-9]+\.[0-9]+)\.q[0-9]{2}$/.exec(source);
      assert(
        match && nav.get(match[1])?.category === 'exercise-group' && owner === chunkFor(match[1]),
      );
      ++guides;
    }
  }
  assert(execution === 44 && guides === 345);
  for (const id of context.examples) {
    const match = /^example\.c6\.listing([0-9]+)\.[0-9]+$/.exec(id);
    assert(match && context.owner.get(id) === `ch${match[1].padStart(2, '0')}`);
  }
  for (const id of context.programs) {
    const match = /^teach\.c6\.ch([0-9]{2})\.[A-Za-z0-9._-]+$/.exec(id);
    assert(match && context.owner.get(id) === `ch${match[1]}`);
  }
  return context;
}
export function validateC6TeachingManifest(value) {
  safe(value);
  assert(teachingManifestSchema(value), 'C6_TEACHING_INVALID');
  contexts.set(value, makeContext(value));
  return freeze(value);
}
function getContext(manifest) {
  if (!contexts.has(manifest)) validateC6TeachingManifest(manifest);
  return contexts.get(manifest);
}
function sourceFiles(files) {
  unique(files.map((file) => file.name));
  assert(
    files.reduce((sum, file) => sum + utf8(file.source).byteLength, 0) <= C6_TEACHING_LIMITS.source,
    'C6_TEACHING_SIZE',
  );
  assert(files.filter((file) => /\bint\s+main\s*\(/.test(file.source)).length === 1);
  const names = new Set(files.map((file) => file.name));
  for (const file of files)
    for (const include of file.source.matchAll(/#include\s+"([^"]+)"/g))
      assert(names.has(include[1]));
}
async function proofMatches(proof, source, manifest) {
  assert(proof.engineBuildSha256 === manifest.engineBuildSha256, 'C6_TEACHING_HASH');
  assert(proof.sourceSha256 === (await c6TeachingSha256(utf8(source))), 'C6_TEACHING_HASH');
}
function stdin(value) {
  assert(utf8(value).byteLength <= 256 && /^[\t\n\r\x20-\x7e]*$/.test(value));
}
async function validateProgram(program, manifest) {
  sourceFiles(program.files);
  if (program.mode === 'reading') return;
  assert(program.files.length === 1);
  const source = program.files[0].source;
  const bundleHash = await c6TeachingSha256(utf8(canonical(program.files)));
  for (const run of [program, ...program.additionalRuns]) {
    stdin(run.input);
    await proofMatches(run.verification, source, manifest);
    assert(
      run.verification.bundleSha256 === bundleHash &&
        run.verification.inputSha256 === (await c6TeachingSha256(utf8(run.input))),
      'C6_TEACHING_HASH',
    );
    assert(utf8(run.expectedStdout).byteLength <= 16384, 'C6_TEACHING_SIZE');
  }
  if (program.mode === 'diagnostic' && program.expectedCode === null) {
    assert(
      program.expectedReturn === 0 && program.businessExpectedStdout !== program.expectedStdout,
    );
  }
}
export async function validateC6TeachingChunk(value, manifest, id) {
  safe(value);
  assert(teachingChunkSchema(value), 'C6_TEACHING_INVALID');
  const context = getContext(manifest),
    entry = context.entries.get(id);
  assert(
    entry &&
      value.chunkId === id &&
      value.kind === entry.kind &&
      value.rootNodeId === entry.rootNodeId &&
      equalRef(value.packageRef, manifest.packageRef),
  );
  const navigation = manifest.nodes.filter((node) => node.chunkId === id);
  assert(
    same(
      value.nodes.map((node) => node.sourceNodeId),
      navigation.map((node) => node.id),
    ),
  );
  for (const kind of kinds) {
    assert(value[kind].length === entry.counts[kind]);
    assert(
      same(
        value[kind].map((row) => row.ref.id),
        entry.entityIds[kind],
      ),
    );
  }
  const nodes = new Map(value.nodes.map((node) => [node.ref.id, node]));
  const lessons = new Map(value.lessons.map((lesson) => [lesson.ref.id, lesson]));
  const programs = new Map(value.programs.map((program) => [program.ref.id, program]));
  for (const row of [...value.nodes, ...kinds.flatMap((kind) => value[kind])])
    assert(row.ref.version === '2.0.0');
  for (const node of value.nodes) {
    const nav = context.nav.get(node.sourceNodeId);
    assert(
      node.ref.id === `node.${nav.id}` &&
        node.order === nav.order &&
        node.titleOriginal === nav.titleOriginal &&
        node.titleDisplay === nav.titleDisplay &&
        node.category === nav.category &&
        node.locator.physicalPage === nav.physicalPage,
    );
    assert(equalRef(node.parentRef, nav.parentId ? ref(`node.${nav.parentId}`) : null));
    assert(node.area === (entry.kind === 'course-chapter' ? 'course' : 'reference'));
    assert(
      equalRef(
        node.lessonRef,
        node.category === 'teaching-lesson' ? ref(`lesson.${nav.id}`) : null,
      ),
    );
    assert(
      sameRefs(
        node.activityRefs,
        value.activities.filter((a) => equalRef(a.sourceNodeRef, node.ref)).map((a) => a.ref),
      ),
    );
    assert(
      sameRefs(
        node.exampleRefs,
        value.examples.filter((a) => equalRef(a.sourceNodeRef, node.ref)).map((a) => a.ref),
      ),
    );
    const teaching = node.area === 'course' && node.category !== 'exercise-group';
    assert(teaching === node.programRefs.length > 0);
    unique(node.programRefs.map(key));
    for (const programRef of node.programRefs) {
      has(context, programRef, 'programs');
      const program = programs.get(programRef.id);
      assert(program);
      for (const file of program.files)
        assert(node.body.includes(`\`\`\`c\n${file.source.trimEnd()}\n\`\`\``));
    }
  }
  for (const lesson of value.lessons) {
    has(context, lesson.sourceNodeRef, 'nodes');
    const source = lesson.sourceNodeRef.id.slice(5),
      node = nodes.get(lesson.sourceNodeRef.id);
    assert(node?.category === 'teaching-lesson' && lesson.ref.id === `lesson.${source}`);
    assert(equalRef(lesson.chapterRef, ref(`node.${entry.rootNodeId}`)));
    assert(sameRefs(lesson.knowledgeRefs, [ref(`knowledge.${source}`)]));
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
        value.examples
          .filter((example) => equalRef(example.lessonRef, lesson.ref))
          .map((example) => example.ref),
      ),
    );
    assert(sameRefs(lesson.programRefs, node.programRefs));
  }
  for (const activity of value.activities) {
    has(context, activity.sourceNodeRef, 'nodes');
    has(context, activity.lessonRef, 'lessons');
    has(context, activity.knowledgeRef, 'knowledge');
    assert(nodes.has(activity.sourceNodeRef.id) && lessons.has(activity.lessonRef.id));
    const source = activity.sourceNodeRef.id.slice(5);
    if (activity.kind === 'source-design-guide') {
      assert(
        activity.ref.id === `activity.${activity.sourceQuestion.id}` &&
          activity.sourceQuestion.id.startsWith(`${source}.q`) &&
          nodes.get(activity.sourceNodeRef.id).category === 'exercise-group',
      );
      assert(activity.knowledgeRef.id === `knowledge.${entry.rootNodeId}`);
      assert(
        (activity.sourceQuestion.kind === 'programming') === (activity.codingAssessment !== null),
      );
    } else {
      assert(
        activity.lessonRef.id === `lesson.${source}` &&
          activity.knowledgeRef.id === `knowledge.${source}` &&
          activity.ref.id === `activity.${source}.execute` &&
          activity.exerciseRef.id === `exercise.${source}` &&
          activity.judgeProfileRef.id === `judge.${source}` &&
          activity.judgeProfileRef.version === '1.0.0',
      );
      has(context, activity.exerciseRef, 'exercises');
    }
  }
  for (const example of value.examples) {
    has(context, example.sourceNodeRef, 'nodes');
    has(context, example.lessonRef, 'lessons');
    assert(
      nodes.has(example.sourceNodeRef.id) &&
        lessons.has(example.lessonRef.id) &&
        example.ref.id === `example.${example.sourceExampleId}`,
    );
    if (example.mode === 'reading-only') {
      assert((example.sourceFileName === undefined) === (example.companionFiles === undefined));
      sourceFiles([
        { name: example.sourceFileName ?? 'main.c', source: example.source },
        ...(example.companionFiles ?? []).map((file) => ({ name: file.path, source: file.source })),
      ]);
    } else {
      sourceFiles([{ name: 'main.c', source: example.source }]);
      stdin(example.input);
      await proofMatches(example.verification, example.source, manifest);
      if (example.mode === 'c6-independent-executable') assert(example.expectedReturn === 0);
      else {
        assert(example.source.includes(example.expectedDiagnostic.anchor));
        if (example.expectedDiagnostic.kind === 'semantic-output-mismatch')
          assert(
            example.expectedDiagnostic.businessExpectedStdout !== example.expectedStdout &&
              example.expectedReturn === 0,
          );
      }
    }
  }
  for (const exercise of value.exercises) {
    has(context, exercise.sourceNodeRef, 'nodes');
    has(context, exercise.lessonRef, 'lessons');
    const source = exercise.sourceNodeRef.id.slice(5);
    assert(
      lessons.has(exercise.lessonRef.id) &&
        exercise.ref.id === `exercise.${source}` &&
        exercise.lessonRef.id === `lesson.${source}` &&
        exercise.profileRef.id === `judge.${source}` &&
        exercise.programRef.id === `program.${source}` &&
        exercise.profileRef.version === '1.0.0' &&
        exercise.programRef.version === '1.0.0',
    );
    assert(
      same(
        exercise.tests.map((test) => test.caseKey),
        ['case-1', 'case-2', 'case-3', 'case-4'],
      ),
    );
    for (const test of exercise.tests) stdin(test.stdin);
    sourceFiles([{ name: 'main.c', source: exercise.starterSource }]);
    sourceFiles([{ name: 'main.c', source: exercise.referenceSource }]);
    await proofMatches(exercise.verification.starter, exercise.starterSource, manifest);
    await proofMatches(exercise.verification.reference, exercise.referenceSource, manifest);
  }
  for (const knowledge of value.knowledge) {
    has(context, knowledge.sourceNodeRef, 'nodes');
    assert(
      nodes.has(knowledge.sourceNodeRef.id) &&
        knowledge.ref.id === `knowledge.${knowledge.sourceNodeRef.id.slice(5)}`,
    );
    if (knowledge.kind === 'chapter')
      assert(
        knowledge.sourceNodeRef.id === `node.${entry.rootNodeId}` &&
          knowledge.chapterKnowledgeRef === null &&
          knowledge.precision === 'chapter-only-source-design',
      );
    else
      assert(
        equalRef(knowledge.chapterKnowledgeRef, ref(`knowledge.${entry.rootNodeId}`)) &&
          knowledge.precision === 'lesson' &&
          lessons.has(`lesson.${knowledge.sourceNodeRef.id.slice(5)}`),
      );
  }
  for (const program of value.programs) await validateProgram(program, manifest);
  assert((id === manifest.compatibilityChunkId) === (value.compatibility !== null));
  if (value.compatibility) {
    unique(value.compatibility.legacyLinks.map((row) => `${row.kind}/${key(row.fromRef)}`));
    unique(value.compatibility.rewardGroups.map((row) => row.id));
    for (const row of value.compatibility.legacyLinks) {
      if (row.relatedSourceNodeRef) has(context, row.relatedSourceNodeRef, 'nodes');
      if (row.targetRef.id.startsWith('lesson.c6.')) has(context, row.targetRef, 'lessons');
      if (row.targetRef.id.startsWith('exercise.c6.')) has(context, row.targetRef, 'exercises');
    }
    const rewardedLessons = [],
      rewardedExercises = [];
    for (const group of value.compatibility.rewardGroups) {
      for (const row of group.lessonRefs) {
        has(context, row, 'lessons');
        rewardedLessons.push(row.id);
      }
      for (const row of group.exerciseRefs) {
        has(context, row, 'exercises');
        rewardedExercises.push(row.id);
      }
    }
    assert(unique(rewardedLessons).size === 404 && unique(rewardedExercises).size === 44);
  }
  assert(
    (await c6TeachingSha256(utf8(`${JSON.stringify(value)}\n`))) === entry.sha256,
    'C6_TEACHING_HASH',
  );
  return freeze(value);
}
export async function parseC6TeachingManifest(bytes, expectedSha256) {
  assert(
    bytes instanceof Uint8Array && bytes.byteLength <= C6_TEACHING_LIMITS.manifest,
    'C6_TEACHING_SIZE',
  );
  assert(
    /^[a-f0-9]{64}$/.test(expectedSha256 ?? '') &&
      (await c6TeachingSha256(bytes)) === expectedSha256,
    'C6_TEACHING_HASH',
  );
  const manifest = validateC6TeachingManifest(json(bytes, C6_TEACHING_LIMITS.manifest));
  assert(
    bytes.byteLength + manifest.chunks.reduce((sum, entry) => sum + entry.bytes, 0) <=
      C6_TEACHING_LIMITS.package,
    'C6_TEACHING_SIZE',
  );
  return manifest;
}
export async function parseC6TeachingChunk(bytes, manifest, id) {
  const entry = getContext(manifest).entries.get(id);
  assert(entry);
  assert(
    bytes instanceof Uint8Array &&
      bytes.byteLength === entry.bytes &&
      bytes.byteLength <= C6_TEACHING_LIMITS.chunk,
    'C6_TEACHING_SIZE',
  );
  assert((await c6TeachingSha256(bytes)) === entry.sha256, 'C6_TEACHING_HASH');
  return validateC6TeachingChunk(json(bytes, C6_TEACHING_LIMITS.chunk), manifest, id);
}
export async function validateCompleteC6Teaching(manifest, chapters) {
  const context = getContext(manifest);
  assert(
    same(
      chapters.map((chapter) => chapter.chunkId),
      manifest.chunks.map((entry) => entry.id),
    ),
  );
  for (const chapter of chapters) await validateC6TeachingChunk(chapter, manifest, chapter.chunkId);
  const all = (kind) => chapters.flatMap((chapter) => chapter[kind]);
  const activities = all('activities'),
    examples = all('examples'),
    programs = all('programs');
  assert(activities.filter((activity) => activity.mandatory).length === 44);
  assert(
    activities.filter(
      (activity) =>
        activity.kind === 'source-design-guide' && activity.sourceQuestion.kind === 'review',
    ).length === 177,
  );
  assert(
    activities.filter(
      (activity) => activity.kind === 'source-design-guide' && activity.codingAssessment !== null,
    ).length === 168,
  );
  for (const [mode, count] of [
    ['reading-only', 101],
    ['c6-independent-executable', 124],
    ['c6-diagnostic-demo', 7],
  ])
    assert(examples.filter((example) => example.mode === mode).length === count);
  for (const [mode, count] of [
    ['execute', 226],
    ['diagnostic', 20],
    ['reading', 140],
  ])
    assert(programs.filter((program) => program.mode === mode).length === count);
  const bodyNodes = all('nodes').filter((node) => node.programRefs.length > 0);
  assert(
    bodyNodes.length === 505 &&
      bodyNodes.reduce((sum, node) => sum + node.programRefs.length, 0) === 576,
  );
  const used = new Set(bodyNodes.flatMap((node) => node.programRefs.map((value) => value.id)));
  assert(used.size === 386 && programs.every((program) => used.has(program.ref.id)));
  const groups = new Map(
    chapters
      .find((chapter) => chapter.chunkId === 'chA')
      .compatibility.rewardGroups.map((group) => [group.id, group]),
  );
  for (const lesson of all('lessons')) {
    const group = groups.get(lesson.rewardGroupId);
    assert(group && group.lessonRefs.some((value) => equalRef(value, lesson.ref)));
  }
  assert(all('exercises').every((exercise) => context.exercises.has(exercise.ref.id)));
  return freeze({
    nodes: 650,
    lessons: 404,
    teachingBodies: 505,
    teachingProgramSlots: 576,
    teachingPrograms: 386,
    activities: 389,
    examples: 232,
    exercises: 44,
    knowledge: 421,
    referenceNodes: 111,
  });
}
export function parseC6TeachingSource(bytes) {
  const value = json(bytes, C6_TEACHING_LIMITS.package);
  safe(value, 500000);
  assert(teachingSourceSchema(value), 'C6_TEACHING_INVALID');
  return freeze(value);
}
