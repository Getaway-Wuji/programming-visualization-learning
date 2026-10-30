// Build-only projection and Rust analysis of public teaching material; never user data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { createServer } from 'vite';
import { inspectContentDraft } from '../web/src/content/validator.mjs';
import { schema as contentSchema } from '../web/src/content/schema-p05.mjs';
import * as wasm from '../web/src/generated/c_viz_wasm.js';
import { reviewedP05Paths } from './p05-09-release-inputs.mjs';
import { blockPermissionPaths } from './block-permission-release-inputs.mjs';
import { editorHistoryPaths } from './editor-history-release-inputs.mjs';
import { reconstructionPaths } from './reconstruction-release-inputs.mjs';
import { diagnosticsPaths } from './diagnostics-release-inputs.mjs';
import { bugPaths } from './bug-release-inputs.mjs';
import { memoryBugPaths } from './memory-bug-release-inputs.mjs';
import { knowledgePaths } from './knowledge-release-inputs.mjs';
import { notebookPaths } from './notebook-release-inputs.mjs';
import { achievementPaths } from './achievement-release-inputs.mjs';
import { schedulerPaths } from './scheduler-release-inputs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(new URL(path, new URL('../', import.meta.url)));
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
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
const save = (path, value, immutable = false) => {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (immutable && existsSync(path))
    assert.deepEqual(read(path), bytes, `Immutable resource changed: ${path}`);
  else {
    mkdirSync(new URL('.', new URL(path, new URL('../', import.meta.url))), { recursive: true });
    writeFileSync(path, bytes);
  }
  return { file: path.replace(/^web\/public\//, ''), bytes: bytes.length, sha256: sha(bytes) };
};
const sourcePath = 'content/c/p05/course-1.0.0.json';
assert.deepEqual(contentSchema, json('项目文档/契约/P0.5-09-内容结构-1.1.0.schema.json'));
const source = JSON.parse(JSON.stringify(inspectContentDraft(read(sourcePath))));
const sourceSha256 = sha(read(sourcePath));
const oldCourse = json('content/c/p0/course-1.0.1.json');
const oldCases = json('content/c/p0/case-view-1.0.1.json');
for (const old of oldCourse.programs) {
  const prior = oldCases.catalogs.find((entry) => entry.program.id === old.id)?.program ?? old;
  assert.deepEqual(
    source.programs.find((entry) => entry.id === old.id),
    prior,
    `Immutable original program changed: ${old.id}`,
  );
}
for (const old of oldCourse.judgeProfiles)
  assert.deepEqual(
    source.judgeProfiles.find((entry) => entry.id === old.id),
    old,
  );
for (const old of oldCourse.exercises)
  assert.deepEqual(source.exercises.find((entry) => entry.id === old.id)?.tests, old.tests);
for (const collection of [
  'languages',
  'subsets',
  'knowledgePoints',
  'inputSpecs',
  'blocks',
  'rewardSources',
])
  for (const old of oldCourse[collection])
    assert.deepEqual(
      source[collection].find((entry) => entry.id === old.id),
      old,
    );
const packageRef = { id: source.packageId, version: source.packageVersion };
const ref = ({ id, version }) => ({ id, version });
const base = (entry) => ({
  ref: ref(entry),
  learningRevision: entry.learningRevision,
  acceptedPriorVersions: entry.acceptedPriorVersions,
});
const find = (collection, target) => {
  const entity = source[collection].find(
    (entry) => entry.id === target.id && entry.version === target.version,
  );
  assert.ok(entity, `Missing ${collection} ${target.id}`);
  return entity;
};
const catalog = {
  purpose: 'lesson-reading',
  packageRef,
  lessons: source.lessons.map((entry) => ({
    ...base(entry),
    requiredExerciseRefs: entry.requiredExerciseRefs,
  })),
  exercises: source.exercises.map((entry) => ({
    ...base(entry),
    lessonRef: entry.lessonRef,
    caseKeys: entry.tests.map((test) => test.caseKey),
  })),
  cases: source.cases.map(base),
};
const reading = {
  readingVersion: '1.0.0',
  sourceSha256,
  packageRef,
  chapters: source.chapters,
  lessons: source.lessons,
  programs: source.programs,
  knowledgePoints: source.knowledgePoints,
  exercises: source.exercises.map(({ id, version, title, lessonRef, prompt }) => ({
    id,
    version,
    title,
    lessonRef,
    prompt,
  })),
  cases: source.cases.map(({ id, version, title }) => ({ id, version, title })),
  catalog: globalThis.structuredClone(catalog),
};
const programs = source.exercises.map((entry) => find('programs', entry.programRef));
const practice = {
  practiceVersion: '1.0.0',
  sourceSha256,
  packageRef,
  exercises: source.exercises,
  programs,
  inputSpecs: source.inputSpecs.filter((entry) =>
    programs.some((program) => program.inputRef.id === entry.id),
  ),
  judgeProfiles: source.judgeProfiles,
};
const cases = source.cases.map((subject) => {
  const program = find('programs', subject.programRef);
  return { packageRef, subject, program, inputSpec: find('inputSpecs', program.inputRef) };
});
const aid = json('content/c/p05/practice-guidance-1.0.0.json');
assert.equal(aid.guidanceVersion, '1.0.0');
assert.deepEqual(aid.packageRef, packageRef);
assert.equal(aid.entries.length, 32);
assert.equal(new Set(aid.entries.map((entry) => entry.exerciseRef.id)).size, 32);
const wasmBytes = read('web/src/generated/c_viz_wasm_bg.wasm');
wasm.initSync({ module: new WebAssembly.Module(wasmBytes) });
const server = await createServer({
  configFile: false,
  root,
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
const guidance = [],
  analysisEvidence = [];
try {
  const { reverseAnalysis } = await server.ssrLoadModule('/web/src/blocks/reverse.ts');
  for (const guide of aid.entries) {
    const subject = find('exercises', guide.exerciseRef),
      program = find('programs', subject.programRef);
    assert.equal(guide.hints.length, 3);
    assert.ok(guide.hints.every((hint) => typeof hint === 'string' && hint.trim()));
    assert.ok(['code', 'blocks'].includes(guide.preferredEditor));
    const selected = {
      packageRef,
      subject,
      program,
      inputSpec: find('inputSpecs', program.inputRef),
      judgeProfile: find('judgeProfiles', subject.judgeRef),
    };
    const request = {
      kind: 'analysisRequest',
      analysisVersion: '1.0.0',
      identity: {
        contextId: 'p05.public.authoring',
        contextRevision: 1,
        documentRevision: 1,
        editId: 'p05.public.edit',
        operationId: `p05.public.${subject.id}`,
      },
      refs: { packageRef, programRef: ref(program), subsetRef: program.subsetRef },
      sourceText: guide.correctionSource,
      input: { specRef: program.inputRef, values: program.exampleInput, random: null },
    };
    let result;
    try {
      result = JSON.parse(
        new TextDecoder().decode(
          wasm.analyze_code_draft(canonical(request), JSON.stringify(selected), 1000),
        ),
      );
    } catch (error) {
      throw new Error(`Correction analysis rejected ${subject.id}`, { cause: error });
    }
    assert.equal(
      result.status,
      'valid',
      `${subject.id}: correction must be supported C: ${JSON.stringify(result.diagnostics)}`,
    );
    const projection = reverseAnalysis(result, guide.correctionSource, program.bindings);
    guidance.push({ ...guide, correctionProgram: projection.program });
    analysisEvidence.push({
      exerciseRef: ref(subject),
      status: result.status,
      nodes: result.checkedAst.nodes.length,
      blocks: result.blockMap.length,
    });
  }
  const { extendBugPractice } = await server.ssrLoadModule('/web/src/bugs/content.ts');
  const extended = extendBugPractice(practice);
  const additions = extended.exercises.slice(practice.exercises.length);
  practice.exercises = extended.exercises;
  catalog.exercises.push(
    ...additions.map((entry) => ({
      ...base(entry),
      lessonRef: entry.lessonRef,
      caseKeys: entry.tests.map((t) => t.caseKey),
    })),
  );
  const { memoryBugLearningExercises } = await server.ssrLoadModule(
    '/web/src/memory-bugs/content.ts',
  );
  catalog.exercises.push(...memoryBugLearningExercises());
  const { createKnowledgeMap } = await server.ssrLoadModule('/web/src/knowledge/model.ts');
  const graph = createKnowledgeMap(reading);
  assert.equal(graph.nodes.length, 10);
  assert.equal(graph.edges.length, 11);
  createKnowledgeMap(json('web/public/content/reading/course-reading-1.0.0.json'));
} finally {
  await server.close();
}
const predecessor = json('content/learning/p05-predecessors-1.0.0.json');
for (const item of predecessor.sources)
  assert.equal(sha(read(item.path)), item.sha256, `Predecessor changed: ${item.path}`);
const permissionRelease = existsSync('content/c/p0/blockly-release-1.0.17.json');
const releaseVersion = existsSync('content/c/p0/blockly-release-1.0.34.json')
  ? '1.0.34'
  : existsSync('content/c/p0/blockly-release-1.0.33.json')
    ? '1.0.33'
    : existsSync('content/c/p0/blockly-release-1.0.32.json')
      ? '1.0.32'
      : existsSync('content/c/p0/blockly-release-1.0.31.json')
        ? '1.0.31'
        : existsSync('content/c/p0/blockly-release-1.0.30.json')
          ? '1.0.30'
          : existsSync('content/c/p0/blockly-release-1.0.29.json')
            ? '1.0.29'
            : existsSync('content/c/p0/blockly-release-1.0.28.json')
              ? '1.0.28'
              : existsSync('content/c/p0/blockly-release-1.0.27.json')
                ? '1.0.27'
                : existsSync('content/c/p0/blockly-release-1.0.26.json')
                  ? '1.0.26'
                  : existsSync('content/c/p0/blockly-release-1.0.25.json')
                    ? '1.0.25'
                    : existsSync('content/c/p0/blockly-release-1.0.24.json')
                      ? '1.0.24'
                      : existsSync('content/c/p0/blockly-release-1.0.23.json')
                        ? '1.0.23'
                        : existsSync('content/c/p0/blockly-release-1.0.22.json')
                          ? '1.0.22'
                          : existsSync('content/c/p0/blockly-release-1.0.21.json')
                            ? '1.0.21'
                            : existsSync('content/c/p0/blockly-release-1.0.20.json')
                              ? '1.0.20'
                              : existsSync('content/c/p0/blockly-release-1.0.19.json')
                                ? '1.0.19'
                                : existsSync('content/c/p0/blockly-release-1.0.18.json')
                                  ? '1.0.18'
                                  : permissionRelease
                                    ? '1.0.17'
                                    : '1.0.16';
const registrationPath = `content/c/p0/blockly-release-${releaseVersion}.json`;
const candidate = process.env.P05_REVIEW_CANDIDATE === '1';
let registered = false;
if (existsSync(registrationPath) && !candidate) {
  const registration = json(registrationPath);
  assert.equal(registration.releaseVersion, releaseVersion);
  assert.deepEqual(
    registration.files.map((entry) => entry.path),
    ['1.0.30', '1.0.31', '1.0.32', '1.0.33', '1.0.34'].includes(releaseVersion)
      ? achievementPaths
      : ['1.0.28', '1.0.29'].includes(releaseVersion)
        ? schedulerPaths
        : ['1.0.26', '1.0.27'].includes(releaseVersion)
          ? notebookPaths
          : releaseVersion === '1.0.25'
            ? knowledgePaths
            : releaseVersion === '1.0.24'
              ? memoryBugPaths
              : ['1.0.22', '1.0.23'].includes(releaseVersion)
                ? bugPaths
                : releaseVersion === '1.0.21'
                  ? diagnosticsPaths
                  : releaseVersion === '1.0.20'
                    ? reconstructionPaths
                    : releaseVersion === '1.0.19'
                      ? editorHistoryPaths
                      : permissionRelease
                        ? blockPermissionPaths
                        : reviewedP05Paths,
  );
  for (const entry of registration.files)
    assert.equal(sha(read(entry.path)), entry.sha256, `Unreviewed source: ${entry.path}`);
  assert.equal(registration.engine.wasmSha256, sha(wasmBytes));
  if (
    [
      '1.0.24',
      '1.0.25',
      '1.0.26',
      '1.0.27',
      '1.0.28',
      '1.0.29',
      '1.0.30',
      '1.0.31',
      '1.0.32',
      '1.0.33',
      '1.0.34',
    ].includes(releaseVersion)
  )
    assert.equal(
      registration.memoryEngine.wasmSha256,
      sha(read('web/src/generated/memory/c_viz_memory_bg.wasm')),
    );
  for (const proof of Object.values(registration.evidence))
    if (proof.path && proof.sha256) assert.equal(sha(read(proof.path)), proof.sha256);
  registered = true;
} else if (!candidate)
  throw new Error(
    'P0.5 course is not registered. Use an explicit review candidate before acceptance.',
  );
const learning = registered ? { ...catalog, purpose: 'course-practice' } : null;
const bundle = {
  bundleVersion: '1.2.0',
  bugSupplement: {
    registryRef: json('content/c/bugs/questions-1.0.0.json').registryRef,
    sourceSha256: sha(read('content/c/bugs/questions-1.0.0.json')),
  },
  memoryBugSupplement: {
    registryRef: json('content/cpp/bugs/questions-1.0.0.json').registryRef,
    sourceSha256: sha(read('content/cpp/bugs/questions-1.0.0.json')),
    questions: json('content/cpp/bugs/questions-1.0.0.json').questions,
  },
  registered,
  sourceSha256,
  reading,
  practice,
  cases,
  learning,
  guidance,
};
const output = registered
  ? 'web/public/content/course/course-bundle-1.2.0.json'
  : 'web/public/content/review/p05-course-candidate.json';
const manifest = {
  enabled: true,
  ...save(output, bundle, registered),
  registered,
  sourceSha256,
  bugSupplement: bundle.bugSupplement,
  memoryBugSupplement: {
    registryRef: bundle.memoryBugSupplement.registryRef,
    sourceSha256: bundle.memoryBugSupplement.sourceSha256,
  },
};
if (registered) {
  const readingProjection = save(
    'web/public/content/reading/course-reading-1.1.0.json',
    reading,
    true,
  );
  const practiceProjection = save(
    'web/public/content/practice/course-practice-1.2.0.json',
    practice,
    true,
  );
  const caseProjection = save(
    'web/public/content/case-view/case-view-1.1.0.json',
    {
      caseViewVersion: '1.1.0',
      purpose: 'case-view',
      capabilities: ['case.view-confirmed'],
      sourceSha256,
      catalogs: cases,
      templateBindings: oldCases.templateBindings,
    },
    true,
  );
  const registration = json(registrationPath);
  const learningProjection = save(
    `web/public/content/learning/course-learning-${releaseVersion}.json`,
    {
      learningVersion: '1.0.0',
      sourceSha256,
      readingSha256: readingProjection.sha256,
      practiceSha256: practiceProjection.sha256,
      blocksBuildSha256: createHash('sha256')
        .update(JSON.stringify(registration.files))
        .digest('hex'),
      capabilities: ['lesson.started', 'lesson.study-confirmed', 'exercise.passed'],
      catalog: learning,
    },
    true,
  );
  manifest.projections = {
    reading: readingProjection,
    practice: practiceProjection,
    cases: caseProjection,
    learning: learningProjection,
  };
  save('web/public/content/course/manifest.json', manifest);
}
writeFileSync(
  'web/src/content/p05-course-release.generated.ts',
  await format(
    `// Generated from the matching reviewed course assembly.\nexport const p05CourseRelease = ${JSON.stringify(manifest)} as const;\n`,
    { parser: 'typescript', singleQuote: true, printWidth: 100 },
  ),
);
save(`.artifacts/${process.env.TASK_EVIDENCE_TASK ?? 'current'}/course-build.json`, {
  candidate: !registered,
  source: { path: sourcePath, sha256: sourceSha256 },
  producerWasmSha256: sha(wasmBytes),
  counts: {
    chapters: 8,
    lessons: 32,
    exercises: catalog.exercises.length,
    practiceExercises: practice.exercises.length,
    memoryBugExercises: 4,
    groups: practice.exercises.reduce((sum, entry) => sum + entry.tests.length, 0) + 16,
    practiceGroups: practice.exercises.reduce((sum, entry) => sum + entry.tests.length, 0),
    memoryBugGroups: 16,
    cases: 7,
  },
  manifest,
  correctionAnalysis: analysisEvidence,
});
console.log(
  `Course: 8 chapters / 32 lessons / 32 required + 4 C Bug + 4 C++ memory Bug exercises; 32 correction drafts analyzed by real Rust; ${registered ? 'registered' : 'review-only, no learning authority'}.`,
);
