// CONTENT3 is independent of the immutable CONTENT2 entry points.
import { c6ChunkSchema } from './c6-course-schema.mjs';
import { c6DiagnosticCodes } from '../generated/c6/diagnostic-codes.ts';

const text = (maxLength = 8192, minLength = 1) => ({ type: 'string', minLength, maxLength });
const number = (maximum = 2147483647, minimum = 0) => ({ type: 'integer', minimum, maximum });
const literal = (value) => ({ const: value });
const nullable = (value) => ({ anyOf: [value, { type: 'null' }] });
const list = (items, maxItems = 1000, minItems = 0) => ({
  type: 'array',
  items,
  maxItems,
  minItems,
});
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const use = (name) => ({ $ref: `#/definitions/${name}` });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const id = { ...text(180), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const sourceId = {
  ...text(80),
  pattern: '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$',
};
const refs = list(use('ref'), 900);
const chunks = [
  ...Array.from({ length: 17 }, (_, i) => `ch${String(i + 1).padStart(2, '0')}`),
  'chA',
  'chB',
];
const chunkId = { enum: chunks };
const packageRef = object({ id: literal('content.c.primer6'), version: literal('2.0.0') });
const judgeOwnerPackageRef = object({
  id: literal('content.c.primer6'),
  version: literal('1.0.0'),
});
const kind = { enum: ['course-chapter', 'reference-appendix'] };
const entityKinds = ['lessons', 'activities', 'examples', 'exercises', 'knowledge', 'programs'];
const countValues = {
  nodes: 650,
  lessons: 404,
  teachingBodies: 505,
  teachingProgramSlots: 576,
  teachingPrograms: 386,
  concepts: 0,
  requiredLessons: 404,
  directoryContainers: 112,
  exerciseGroupContainers: 34,
  referenceNodes: 111,
  activities: 389,
  requiredActivities: 44,
  optionalActivities: 345,
  sourceReviewGuides: 177,
  sourceProgrammingGuides: 168,
  executionExercises: 44,
  judgeGroups: 176,
  examples: 232,
  executableExamples: 124,
  diagnosticExamples: 7,
  readingExamples: 101,
  knowledgeNodes: 421,
  lazyChunks: 19,
};
const definitions = globalThis.structuredClone(c6ChunkSchema.definitions);
// Shared source examples, exercises and compatibility remain closed; new reference
// versions and judge ownership are checked by the independent semantic validator.
delete definitions.check;
definitions.node = object({
  ref: use('ref'),
  sourceNodeId: sourceId,
  parentRef: nullable(use('ref')),
  order: number(650, 1),
  titleOriginal: text(500),
  titleDisplay: text(500),
  category: {
    enum: [
      'directory-container',
      'exercise-group',
      'teaching-lesson',
      'reference-answer-or-bibliography',
    ],
  },
  area: { enum: ['course', 'reference'] },
  locator: use('locator'),
  objective: text(),
  body: text(65536, 100),
  lessonRef: nullable(use('ref')),
  activityRefs: refs,
  exampleRefs: refs,
  programRefs: refs,
  platformSupplement: literal(true),
});
definitions.lesson = object({
  ref: use('ref'),
  sourceNodeRef: use('ref'),
  chapterRef: use('ref'),
  knowledgeRefs: list(use('ref'), 1, 1),
  mandatory: literal(true),
  learningRevision: literal(1),
  acceptedPriorVersions: list(text(20), 0),
  requiredActivityRefs: list(use('ref'), 1),
  optionalActivityRefs: refs,
  exampleRefs: refs,
  programRefs: list(use('ref'), 10, 1),
  rewardGroupId: id,
  completion: object({
    reading: literal('explicit-confirmation'),
    execution: literal('all-bound-judge-groups'),
  }),
});
const activityBase = {
  ref: use('ref'),
  sourceNodeRef: use('ref'),
  lessonRef: use('ref'),
  learningRevision: literal(1),
  goal: text(),
  knowledgeRef: use('ref'),
  platformSupplement: literal(true),
  originalExercisePassClaim: literal(false),
};
definitions.activity = {
  oneOf: [
    object({
      ...activityBase,
      kind: literal('source-design-guide'),
      mandatory: literal(false),
      sourceQuestion: object({
        id: { ...text(100), pattern: '^c6\\.s[0-9]+\\.[0-9]+\\.q[0-9]{2}$' },
        kind: { enum: ['review', 'programming'] },
        locator: use('locator'),
      }),
      discussion: text(20000),
      codingAssessment: nullable(
        object({
          scope: text(),
          design: text(),
          boundaries: list(text(), 30, 1),
          originalExercisePassClaim: literal(false),
        }),
      ),
    }),
    object({
      ...activityBase,
      kind: literal('rust-execution'),
      mandatory: literal(true),
      exerciseRef: use('ref'),
      judgeProfileRef: use('ref'),
    }),
  ],
};
const runtimeProof = object({
  kind: literal('rust-verified'),
  engineBuildSha256: hash,
  sourceSha256: hash,
  bundleSha256: hash,
  inputSha256: hash,
  requestSha256: hash,
  resultSha256: hash,
});
const file = object({
  name: { ...text(80), pattern: '^[a-z][a-z0-9_-]*\\.(?:c|h)$' },
  source: text(32768),
});
const programBase = {
  ref: use('ref'),
  title: text(500),
  files: list(file, 4, 1),
};
const run = {
  input: text(256, 0),
  expectedStdout: text(16384, 0),
  expectedReturn: number(2147483647, -2147483648),
  verification: runtimeProof,
};
definitions.program = {
  oneOf: [
    object({
      ...programBase,
      mode: literal('reading'),
      boundary: text(16000),
      prediction: text(20000),
      verification: object({ kind: literal('reading-not-executed') }),
    }),
    object({
      ...programBase,
      mode: literal('execute'),
      ...run,
      additionalRuns: list(object(run), 30),
    }),
    object({
      ...programBase,
      mode: literal('diagnostic'),
      ...run,
      expectedReturn: literal(null),
      expectedCode: { enum: c6DiagnosticCodes },
      diagnosticExplanation: text(16000),
      additionalRuns: list(
        object({
          ...run,
          expectedReturn: literal(null),
          expectedCode: { enum: c6DiagnosticCodes },
        }),
        30,
      ),
    }),
    object({
      ...programBase,
      mode: literal('diagnostic'),
      ...run,
      expectedCode: literal(null),
      businessExpectedStdout: text(16384, 0),
      diagnosticExplanation: text(16000),
      additionalRuns: list(object(run), 0),
    }),
  ],
};
const metadata = {
  contractVersion: literal('3.0.0'),
  packageRef,
  languageRef: object({ id: literal('lang.c'), version: literal('1.0.0') }),
  engineRef: object({ id: literal('engine.rust.c6'), version: literal('0.1.0') }),
  engineBuildSha256: hash,
  judgeOwnerPackageRef,
  judgeContractVersion: literal('2.0.0'),
  scopeRevision: literal('user-20261102-full-key-teaching'),
  source: object({
    id: literal('source.c.primer6'),
    edition: literal(6),
    sha256: literal('c23d60af4adb9a6d90a91c0709ae3b94ef32063cfcbe1792d97e99792afd14e6'),
  }),
};
export const c6TeachingCounts = Object.freeze(countValues);
export const c6TeachingEntityKinds = Object.freeze(entityKinds);
export const c6TeachingChunkIds = Object.freeze(chunks);
export const c6TeachingChunkSchema = {
  $id: 'urn:cviz:content:c6:chunk:3.0.0',
  definitions,
  ...object({
    contractVersion: literal('3.0.0'),
    packageRef,
    chunkId,
    rootNodeId: sourceId,
    kind,
    nodes: list(use('node'), 100, 1),
    lessons: list(use('lesson'), 60),
    activities: list(use('activity'), 150),
    examples: list(use('example'), 40),
    exercises: list(use('exercise'), 10),
    knowledge: list(use('knowledge'), 70),
    programs: list(use('program'), 80),
    compatibility: use('compatibility'),
  }),
};
export const c6TeachingManifestSchema = {
  $id: 'urn:cviz:content:c6:manifest:3.0.0',
  definitions,
  ...object({
    ...metadata,
    sourceSha256: hash,
    counts: object(
      Object.fromEntries(Object.entries(countValues).map(([key, value]) => [key, literal(value)])),
    ),
    budgets: object({
      packageBytes: literal(20971520),
      manifestBytes: literal(262144),
      chunkBytes: literal(1048576),
      sourceBytes: literal(32768),
    }),
    compatibilityChunkId: literal('chA'),
    chunks: list(
      object({
        id: chunkId,
        kind,
        rootNodeId: sourceId,
        file: { ...text(80), pattern: '^ch(?:[0-9]{2}|[AB])-2\\.0\\.0\\.json$' },
        bytes: number(1048576, 1),
        sha256: hash,
        counts: object(
          Object.fromEntries(['nodes', ...entityKinds].map((key) => [key, number(900)])),
        ),
        entityIds: object(Object.fromEntries(entityKinds.map((key) => [key, list(id, 900)]))),
      }),
      19,
      19,
    ),
    nodes: list(
      object({
        id: sourceId,
        parentId: nullable(sourceId),
        order: number(650, 1),
        titleOriginal: text(500),
        titleDisplay: text(500),
        category: definitions.node.properties.category,
        physicalPage: number(1635, 1),
        chunkId,
      }),
      650,
      650,
    ),
  }),
};
const {
  $id: chapterSchemaId,
  definitions: chapterDefinitions,
  ...chapterShape
} = c6TeachingChunkSchema;
void chapterSchemaId;
void chapterDefinitions;
export const c6TeachingSourceSchema = {
  $id: 'urn:cviz:content:c6:source:3.0.0',
  definitions,
  ...object({ ...metadata, chapters: list(chapterShape, 19, 19) }),
};
