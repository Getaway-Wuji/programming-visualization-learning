// CONTENT2 is an independent closed contract. Legacy CONTENT1 limits stay unchanged.
const text = (maxLength = 8192, minLength = 1) => ({ type: 'string', minLength, maxLength });
const integer = (maximum = 2147483647, minimum = 0) => ({ type: 'integer', minimum, maximum });
const literal = (value) => ({ const: value });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const list = (items, maxItems = 1000, minItems = 0) => ({
  type: 'array',
  items,
  minItems,
  maxItems,
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
const reference = object({ id, version: { ...text(20), pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' } });
const refs = list(use('ref'), 900);
const locator = object({ physicalPage: integer(1635, 1), originalPrintPage: literal(null) });
const kind = { enum: ['course-chapter', 'reference-appendix'] };
const category = {
  enum: [
    'directory-container',
    'exercise-group',
    'teaching-lesson',
    'reference-answer-or-bibliography',
  ],
};
const chunkId = {
  enum: [
    ...Array.from({ length: 17 }, (_, n) => `ch${String(n + 1).padStart(2, '0')}`),
    'chA',
    'chB',
  ],
};
const packageRef = object({ id: literal('content.c.primer6'), version: literal('1.0.0') });
const proof = object({
  kind: literal('rust-verified'),
  engineBuildSha256: hash,
  sourceSha256: hash,
  requestSha256: hash,
  resultSha256: hash,
});
const check = object({
  prompt: text(),
  options: list(
    object({ key: { enum: ['A', 'B', 'C', 'D'] }, text: text(), explanation: text() }),
    4,
    4,
  ),
  answerKey: { enum: ['A', 'B', 'C', 'D'] },
});
const assessment = nullable(
  object({
    scope: text(),
    design: text(),
    boundaries: list(text(), 30, 1),
    originalExercisePassClaim: literal(false),
  }),
);
const activityBase = {
  ref: use('ref'),
  sourceNodeRef: use('ref'),
  lessonRef: use('ref'),
  mandatory: { type: 'boolean' },
  learningRevision: literal(1),
  goal: text(),
  knowledgeRef: use('ref'),
  platformSupplement: literal(true),
  originalExercisePassClaim: literal(false),
};
const exampleBase = {
  ref: use('ref'),
  sourceExampleId: { ...text(80), pattern: '^c6\\.listing[0-9]+\\.[0-9]+$' },
  sourceNodeRef: use('ref'),
  lessonRef: use('ref'),
  titleOriginal: text(500),
  locator: use('locator'),
  source: text(32768),
  input: text(32768, 0),
  expectedStdout: nullable(text(32768, 0)),
  expectedReturn: nullable(integer(2147483647, -2147483648)),
  explanation: text(16000),
  reviewFocus: text(16000),
  platformSupplement: literal(true),
};
const diagnostic = {
  oneOf: [
    object({
      kind: literal('rust-diagnostic'),
      code: { enum: ['E_PARSE_INVALID', 'E_ARGUMENTS', 'E_UNINITIALIZED', 'E_POINTER_BOUNDS'] },
      anchor: text(1000),
    }),
    object({
      kind: literal('semantic-output-mismatch'),
      businessExpectedStdout: text(32768, 0),
      anchor: text(1000),
      correctedExpression: text(1000),
    }),
  ],
};
const definitions = {
  ref: reference,
  locator,
  check,
  proof,
  node: object({
    ref: use('ref'),
    sourceNodeId: sourceId,
    parentRef: nullable(use('ref')),
    order: integer(650, 1),
    titleOriginal: text(500),
    titleDisplay: text(500),
    category,
    area: { enum: ['course', 'reference'] },
    locator: use('locator'),
    objective: text(),
    body: text(30000, 100),
    lessonRef: nullable(use('ref')),
    activityRefs: refs,
    exampleRefs: refs,
    platformSupplement: literal(true),
  }),
  lesson: object({
    ref: use('ref'),
    sourceNodeRef: use('ref'),
    chapterRef: use('ref'),
    knowledgeRefs: list(use('ref'), 1, 1),
    mandatory: literal(true),
    learningRevision: literal(1),
    acceptedPriorVersions: list(text(20), 0),
    requiredActivityRefs: list(use('ref'), 2, 1),
    optionalActivityRefs: refs,
    exampleRefs: refs,
    rewardGroupId: id,
  }),
  activity: {
    oneOf: [
      object({ ...activityBase, kind: literal('concept-check'), check: use('check') }),
      object({
        ...activityBase,
        kind: literal('source-design-check'),
        sourceQuestion: object({
          id: { ...text(100), pattern: '^c6\\.s[0-9]+\\.[0-9]+\\.q[0-9]{2}$' },
          kind: { enum: ['review', 'programming'] },
          locator: use('locator'),
        }),
        discussion: text(20000),
        check: use('check'),
        codingAssessment: assessment,
      }),
      object({
        ...activityBase,
        kind: literal('rust-execution'),
        exerciseRef: use('ref'),
        judgeProfileRef: use('ref'),
      }),
    ],
  },
  example: {
    oneOf: [
      object({
        ...exampleBase,
        mode: literal('c6-independent-executable'),
        verification: use('proof'),
      }),
      object({
        ...exampleBase,
        mode: literal('c6-diagnostic-demo'),
        verification: use('proof'),
        expectedDiagnostic: diagnostic,
      }),
      object(
        {
          ...exampleBase,
          mode: literal('reading-only'),
          reason: text(16000),
          readingBoundary: text(16000),
          verification: object({ kind: literal('reading-not-executed') }),
          sourceFileName: { ...text(80), pattern: '^[a-z][a-z0-9_-]*\\.c$' },
          companionFiles: list(
            object({
              path: { ...text(80), pattern: '^[a-z][a-z0-9_-]*\\.(?:c|h)$' },
              source: text(32768),
            }),
            3,
            1,
          ),
        },
        [...Object.keys(exampleBase), 'mode', 'reason', 'readingBoundary', 'verification'],
      ),
    ],
  },
  exercise: object({
    ref: use('ref'),
    sourceNodeRef: use('ref'),
    lessonRef: use('ref'),
    profileRef: use('ref'),
    programRef: use('ref'),
    learningRevision: literal(1),
    acceptedPriorVersions: list(text(20), 0),
    platformSupplement: literal(true),
    semanticTargets: list(text(150), 10, 1),
    nodeSpecificRequirement: text(),
    tests: list(
      object({
        caseKey: { enum: ['case-1', 'case-2', 'case-3', 'case-4'] },
        stdin: text(256, 0),
        expectedStdout: text(16384, 0),
        expectedReturnCode: literal(0),
        purpose: text(),
        observationRule: text(),
      }),
      4,
      4,
    ),
    verification: object({
      referenceStatus: literal('passed'),
      starterStatus: literal('failed'),
      caseCount: literal(4),
      reference: use('proof'),
      starter: use('proof'),
    }),
    title: text(),
    prompt: text(16000),
    inputContract: text(),
    outputContract: text(),
    starterSource: text(32768),
    referenceSource: text(32768),
    hints: list(text(), 3, 3),
    commonMistakes: list(text(), 30, 1),
    boundaryExplanation: text(16000),
    reviewFocus: text(16000),
  }),
  knowledge: object({
    ref: use('ref'),
    sourceNodeRef: use('ref'),
    kind: { enum: ['chapter', 'lesson'] },
    title: text(500),
    chapterKnowledgeRef: nullable(use('ref')),
    precision: { enum: ['lesson', 'chapter-only-source-design'] },
  }),
  compatibility: nullable(
    object({
      legacyMapSha256: hash,
      rewardMappingSha256: hash,
      legacyLinks: list(
        object({
          kind: { enum: ['lesson', 'exercise', 'case', 'supplemental-exercise'] },
          fromRef: use('ref'),
          targetRef: use('ref'),
          relatedSourceNodeRef: nullable(use('ref')),
          oldPackageRef: nullable(use('ref')),
          language: nullable({ enum: ['c', 'cpp'] }),
          learningRevision: nullable(integer(10000, 1)),
          acceptedPriorVersions: list(text(20), 20),
          transferPass: literal(false),
        }),
        79,
        79,
      ),
      rewardGroups: list(
        object({
          id,
          lessonRefs: refs,
          exerciseRefs: refs,
          legacyLessonRef: nullable(use('ref')),
          legacyExerciseRef: nullable(use('ref')),
          lessonReward: object({
            points: literal(20),
            subjectId: id,
            sourceId: literal('reward.lesson.first-completion'),
          }),
          exerciseReward: object({
            points: literal(10),
            subjectId: id,
            sourceId: literal('reward.exercise.first-pass'),
          }),
          emptyNewGroupCanGrant: literal(false),
        }),
        42,
        42,
      ),
    }),
  ),
};
const chunkCounts = object(
  Object.fromEntries(
    ['nodes', 'lessons', 'activities', 'examples', 'exercises', 'knowledge'].map((k) => [
      k,
      integer(900),
    ]),
  ),
);
const countValues = {
  nodes: 650,
  lessons: 404,
  concepts: 404,
  requiredLessons: 404,
  optionalTeachingLessons: 0,
  directoryContainers: 112,
  exerciseGroupContainers: 34,
  referenceLeaves: 100,
  activities: 793,
  requiredActivities: 448,
  optionalActivities: 345,
  sourceReviewChecks: 177,
  sourceProgrammingChecks: 168,
  executionExercises: 44,
  judgeGroups: 176,
  examples: 232,
  nonreadingExamples: 131,
  readingExamples: 101,
  knowledgeNodes: 421,
  lazyChunks: 19,
};
export const c6ManifestSchema = {
  $id: 'urn:cviz:content:c6:manifest:2.0.0',
  definitions,
  ...object({
    contractVersion: literal('2.0.0'),
    packageRef,
    languageRef: object({ id: literal('lang.c'), version: literal('1.0.0') }),
    engineRef: object({ id: literal('engine.rust.c6'), version: literal('0.1.0') }),
    engineBuildSha256: hash,
    scopeRevision: literal('user-20261102-b-reference-only'),
    source: object({
      id: literal('source.c.primer6'),
      edition: literal(6),
      sha256: literal('c23d60af4adb9a6d90a91c0709ae3b94ef32063cfcbe1792d97e99792afd14e6'),
    }),
    designSha256: literal('72aa3f60dd367263efc6a17706a975be33084dcbd943b0479e63481fe45be6fa'),
    scopeSha256: hash,
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
    executionEvidenceSha256: hash,
    authoredSources: list(object({ path: text(500), sha256: hash }), 200, 100),
    chunks: list(
      object({
        id: chunkId,
        kind,
        rootNodeId: sourceId,
        file: { ...text(80), pattern: '^ch(?:[0-9]{2}|[AB])-1\\.0\\.0\\.json$' },
        bytes: integer(1048576, 1),
        sha256: hash,
        counts: chunkCounts,
        entityIds: object(
          Object.fromEntries(
            ['lessons', 'activities', 'examples', 'exercises', 'knowledge'].map((k) => [
              k,
              list(id, 900),
            ]),
          ),
        ),
      }),
      19,
      19,
    ),
    nodes: list(
      object({
        id: sourceId,
        parentId: nullable(sourceId),
        order: integer(650, 1),
        titleOriginal: text(500),
        titleDisplay: text(500),
        category,
        physicalPage: integer(1635, 1),
        chunkId,
      }),
      650,
      650,
    ),
  }),
};
export const c6ChunkSchema = {
  $id: 'urn:cviz:content:c6:chunk:2.0.0',
  definitions,
  ...object({
    contractVersion: literal('2.0.0'),
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
    compatibility: use('compatibility'),
  }),
};
